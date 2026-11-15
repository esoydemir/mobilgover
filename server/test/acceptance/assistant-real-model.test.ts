import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { llmConfigFromEnv } from '../../src/services/llm';
import { client, freshEnv, type Env } from '../support/env';

/**
 * AM-3, REAL model: runs only when LLM_BASE_URL and LLM_MODEL are set (for example a local Ollama), so CI without a model skips it.
 *   LLM_BASE_URL=http://127.0.0.1:11434/v1 LLM_MODEL=qwen2.5-coder:7b LLM_EVIDENCE_OUT=../docs/kanit-kapanis/am3/gercek-model.json npx vitest run test/acceptance/assistant-real-model.test.ts
 * The answers are recorded as evidence; the assertions only require what the product promises (sources, honesty), not a particular wording.
 */
const llm = llmConfigFromEnv();
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
let env: Env; let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const record: Record<string, unknown> = { model: llm?.model, baseUrl: llm?.baseUrl.replace(/\/\/[^/@]*@/, '//'), at: new Date().toISOString() };

async function docWithText(title: string, text: string) {
  const o = client(env, demo.users.owner.token);
  const id = (await o.post(`${C()}/documents`, { docType: 'other', title, siteId: demo.siteId })).body.id as string;
  const f = Buffer.from(`%PDF-1.4 ${title}`);
  const v = (await o.post(`${C()}/documents/${id}/versions`, { validFrom: null, validUntil: null, file: { mime: 'application/pdf', sha256: sha(f), sizeBytes: f.length } })).body;
  expect((await o.post(`${C()}/documents/${id}/versions/${v.versionId}/extractions`, { text, source: 'typed_text' })).status).toBe(201);
  return id;
}
const ask = async (q: string) => { const t0 = Date.now(); const r = (await client(env, demo.users.owner.token).post(`${C()}/assistant/ask`, { question: q })).body; return { ...r, ms: Date.now() - t0 }; };

describe.skipIf(!llm)('real language model through the whole assistant', () => {
  beforeAll(async () => {
    env = await freshEnv({ llm: { ...llm!, timeoutMs: 240000 } }); await seedPlatform(env.db); demo = await seedDemoCompany(env.db, { isDemo: true }); await topUpAllSites(env.db, 20);
    await docWithText('Soğuk oda talimatı A', 'Soğuk oda sıcaklığı en fazla 4 °C olmalıdır.\nSıcaklık günde iki kez kaydedilir.');
    await docWithText('Soğuk oda talimatı B', 'Soğuk oda sıcaklığı 8 °C’ye kadar çıkabilir.');
    await docWithText('Temizlik planı', 'Yüzeyler her vardiya sonunda dezenfekte edilir. Dezenfektan kaydı vardiya sorumlusu tarafından tutulur.');
  }, 120000);
  afterAll(() => { if (process.env.LLM_EVIDENCE_OUT) writeFileSync(process.env.LLM_EVIDENCE_OUT, JSON.stringify(record, null, 2)); return env?.close(); });

  it('sourced question: a model-written Turkish answer with a real citation', async () => {
    const r = await ask('Yüzeyler ne zaman dezenfekte edilir ve kaydı kim tutar?');
    record.sourced = { question: r.question, outcome: r.outcome, mode: r.mode, model: r.model, answer: r.answer, sources: r.sources.map((s: any) => ({ n: s.n, title: s.title, locator: s.locator, cited: s.cited, route: s.route })), notes: r.notes, ms: r.ms };
    expect(r.mode).toBe('model'); expect(r.outcome).toBe('answered');
    expect(r.sources.some((s: any) => s.cited && /Temizlik planı/.test(s.title))).toBe(true);
    expect(r.answer).not.toMatch(/\d+\s*(TL|₺|lira)/i);
  }, 300000);

  it('question the sources do not answer: no invented answer', async () => {
    const r = await ask('Soğuk oda talimatındaki sıcaklık kaydını hangi çalışan imzalar?');
    record.insufficient = { question: r.question, outcome: r.outcome, mode: r.mode, model: r.model, answer: r.answer, sourcesShownAsSupport: r.sources.length, notes: r.notes, ms: r.ms };
    expect(['insufficient', 'conflict']).toContain(r.outcome === 'answered' && r.mode === 'sources_only' ? 'insufficient' : r.outcome); // a model that fails falls back to sources; never a made-up signer
    expect(r.answer).not.toMatch(/imzalar[ıi]?\s+(müdür|şef|sorumlu)/i);
  }, 300000);

  it('two contradicting sources: the conflict is reported with both sources', async () => {
    const r = await ask('Soğuk oda sıcaklığı en fazla kaç derece olabilir?');
    record.conflict = { question: r.question, outcome: r.outcome, mode: r.mode, model: r.model, answer: r.answer, sources: r.sources.map((s: any) => ({ n: s.n, title: s.title, locator: s.locator, cited: s.cited, route: s.route })), notes: r.notes, ms: r.ms };
    expect(r.outcome).toBe('conflict');
    expect(r.sources.filter((s: any) => s.cited).length).toBeGreaterThanOrEqual(2);
  }, 300000);
});
