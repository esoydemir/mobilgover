import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { checkVerdict, llmConfigFromEnv, type LlmConfig } from '../../src/services/llm';
import { client, freshEnv, type Env } from '../support/env';

/**
 * AM-3: the language model is a connection, not a source. It sees only the sources the server already filtered for this person, its output is
 * checked, and the assistant still works (and still shows its sources) when the model is missing, slow, wrong or unreachable.
 * The model here is a small local server speaking the same chat protocol, so the connection, prompt and checks are exercised for real.
 */
type Call = { auth: string | undefined; body: any };
let calls: Call[] = [];
let responder: (body: any) => { status?: number; content?: string; hang?: boolean } = () => ({ content: '{"status":"insufficient","answer":"","citations":[]}' });
let fake: http.Server; let fakeUrl = '';

let env: Env; let demo: Awaited<ReturnType<typeof seedDemoCompany>>; let other: Awaited<ReturnType<typeof seedDemoCompany>>;
const cfg = (over: Partial<LlmConfig> = {}): LlmConfig => ({ baseUrl: fakeUrl, model: 'test-model', apiKey: 'sk-test-secret', timeoutMs: 5000, ...over });
const C = () => `/companies/${demo.companyId}`;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const promptOf = (c: Call) => (c.body.messages as { role: string; content: string }[]).at(-1)!.content as string;

const startFake = () => new Promise<void>(res => {
  fake = http.createServer((req, rsp) => {
    const chunks: Buffer[] = []; req.on('data', d => chunks.push(d));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      calls.push({ auth: req.headers.authorization, body });
      const r = responder(body);
      if (r.hang) return; // never answers: the timeout must end the call
      rsp.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      rsp.end(JSON.stringify({ model: 'test-model', choices: [{ message: { role: 'assistant', content: r.content ?? '' } }] }));
    });
  }).listen(0, '127.0.0.1', () => { fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`; res(); });
});

/** An app whose assistant is wired to the fake model (a fresh schema per file; the same companies are reused across tests). */
async function boot(llm: LlmConfig | null) {
  env = await freshEnv({ llm });
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  other = await seedDemoCompany(env.db, { isDemo: true, name: 'Başka İşletme' });
  await topUpAllSites(env.db, 20);
}
const ask = (who: 'owner' | 'staff', question: string) => client(env, who === 'owner' ? demo.users.owner.token : demo.users.staff.token).post(`${C()}/assistant/ask`, { question });

async function docWithText(title: string, text: string) {
  const o = client(env, demo.users.owner.token);
  const id = (await o.post(`${C()}/documents`, { docType: 'other', title, siteId: demo.siteId })).body.id as string;
  const f = Buffer.from(`%PDF-1.4 ${title}`);
  const v = (await o.post(`${C()}/documents/${id}/versions`, { validFrom: null, validUntil: null, file: { mime: 'application/pdf', sha256: sha(f), sizeBytes: f.length } })).body;
  expect((await o.post(`${C()}/documents/${id}/versions/${v.versionId}/extractions`, { text, source: 'typed_text' })).status).toBe(201);
  return id;
}

beforeAll(async () => { await startFake(); await boot(cfg()); });
afterAll(async () => { await env?.close(); await new Promise(r => fake.close(r)); });

const COLD = 'Soğuk muhafaza ünitelerinin sıcaklık kaydı nasıl tutulmalı?';

describe('connection and configuration', () => {
  it('is configured from the environment; no URL or model means no model', () => {
    expect(llmConfigFromEnv({})).toBeNull();
    expect(llmConfigFromEnv({ LLM_BASE_URL: 'http://x.test/v1/' })).toBeNull();
    expect(llmConfigFromEnv({ LLM_BASE_URL: 'http://127.0.0.1:11434/v1/', LLM_MODEL: 'm', LLM_API_KEY: 'k' })).toEqual({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'm', apiKey: 'k', timeoutMs: 60000 });
    expect(() => llmConfigFromEnv({ LLM_BASE_URL: 'ftp://x', LLM_MODEL: 'm' })).toThrow(/http/);
  });

  it('a sourced question reaches the model with numbered sources; the answer, its citations and the key handling are right', async () => {
    calls = [];
    responder = body => {
      const sys = body.messages[0].content as string;
      expect(sys).toMatch(/YALNIZCA/); expect(sys).toMatch(/Ceza ya da para tutarı yazma/);
      return { content: JSON.stringify({ status: 'answered', answer: 'Sıcaklık kaydı kaynaktaki gibi tutulur [1].', citations: [1] }) };
    };
    const r = (await ask('owner', COLD)).body;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.auth).toBe('Bearer sk-test-secret');
    expect(calls[0]!.body).toMatchObject({ model: 'test-model', temperature: 0, stream: false });
    expect(promptOf(calls[0]!)).toMatch(/^KAYNAKLAR:\n\[1\] /);
    expect(r).toMatchObject({ outcome: 'answered', mode: 'model', model: { status: 'used', name: 'test-model' } });
    expect(r.answer).toBe('Sıcaklık kaydı kaynaktaki gibi tutulur [1].');
    expect(r.sources[0]).toMatchObject({ n: 1, cited: true });
    expect(r.sources[0].locator).toBeTruthy();
    expect(r.sources[0].route).toBeTruthy(); // the source can be opened
    expect(r.notes.join(' ')).toMatch(/dil modeli yazdı/);
    expect(r.notes.join(' ')).toMatch(/ÖRNEK|doğrulanmış mevzuat/);
    expect(JSON.stringify(r)).not.toContain('sk-test-secret');
    const audit = (await env.ownerDb.query(`SELECT payload FROM audit_events WHERE event_type = 'assistant.asked' ORDER BY seq DESC LIMIT 1`)).rows[0].payload;
    expect(audit).toMatchObject({ outcome: 'answered', mode: 'model', modelStatus: 'used' });
    expect(JSON.stringify(audit)).not.toContain('Soğuk');
  });
});

describe('what the model is allowed to see and when it is called', () => {
  it('not enough source: the model is never called and the answer says so', async () => {
    calls = [];
    const r = (await ask('owner', 'Uzay istasyonunda kullanılacak roket yakıtı depolama standardı nedir?')).body;
    expect(calls).toHaveLength(0);
    expect(r).toMatchObject({ outcome: 'insufficient', sufficient: false, sources: [] });
    expect(r.answer).toMatch(/yeterince karşılayan bir kaynak bulamadım/);
  });

  it('penalty amounts: declined without calling the model, no figure invented', async () => {
    calls = [];
    const r = (await ask('owner', 'Soğutucu kaydı tutmazsam ne kadar para cezası öderim?')).body;
    expect(calls).toHaveLength(0);
    expect(r.outcome).toBe('fine_declined');
    expect(r.answer).not.toMatch(/\d+\s*(TL|₺|lira)/i);
  });

  it('only sources this person may read go into the prompt: staff never send a manager-only document or obligation text to the model', async () => {
    const id = await docWithText('Yangın sigortası poliçesi gizli', 'Yangın sigortası poliçesi gizli madde: teminat kapsamı yalnızca yönetime açıktır.');
    expect(id).toBeTruthy();
    calls = [];
    const s = (await ask('staff', 'Yangın sigortası poliçesi teminat kapsamı nedir?')).body;
    expect(calls).toHaveLength(0); // staff have no matching source, so there is nothing to send
    expect(JSON.stringify(s)).not.toMatch(/gizli/);
    calls = [];
    responder = () => ({ content: JSON.stringify({ status: 'answered', answer: 'Teminat kapsamı yalnızca yönetime açıktır [1].', citations: [1] }) });
    const o = (await ask('owner', 'Yangın sigortası poliçesi teminat kapsamı nedir?')).body;
    expect(calls).toHaveLength(1);
    expect(promptOf(calls[0]!)).toMatch(/gizli madde/);
    expect(o.sources.some((x: any) => /bölüm 1/.test(x.locator))).toBe(true); // a document section with its version and section number
    // staff who do match a task they own get only their own scope in the prompt
    calls = [];
    await ask('staff', 'Soğuk muhafaza ünitelerinin sıcaklık kaydı nasıl tutulmalı?');
    for (const c of calls) { expect(promptOf(c)).not.toMatch(/gizli/); expect(promptOf(c)).not.toMatch(/Kural /); }
  });

  it("another business's documents never reach the model", async () => {
    const o2 = client(env, other.users.owner.token);
    const id = (await o2.post(`/companies/${other.companyId}/documents`, { docType: 'other', title: 'Rakip kantin belgesi benzersizkelime', siteId: other.siteId })).body.id;
    expect(id).toBeTruthy();
    calls = [];
    await ask('owner', 'Rakip kantin belgesi benzersizkelime nedir?');
    for (const c of calls) expect(promptOf(c)).not.toMatch(/benzersizkelime/);
  });
});

describe('insufficient and contradicting sources', () => {
  let a = '', b = '';
  beforeAll(async () => {
    a = await docWithText('Soğuk oda talimatı A', 'Soğuk oda sıcaklığı en fazla 4 °C olmalıdır.\nSıcaklık günde iki kez kaydedilir.');
    b = await docWithText('Soğuk oda talimatı B', 'Soğuk oda sıcaklığı 8 °C’ye kadar çıkabilir.');
  });
  const Q = 'Soğuk oda sıcaklığı en fazla kaç derece olabilir?';

  it('the model reports a conflict: both sources are named and openable, nothing is chosen', async () => {
    calls = [];
    responder = body => {
      const p = (body.messages.at(-1).content as string);
      const n4 = /\[(\d)\] Soğuk oda talimatı A/.exec(p)?.[1], n8 = /\[(\d)\] Soğuk oda talimatı B/.exec(p)?.[1];
      return { content: JSON.stringify({ status: 'conflict', answer: `Kaynaklar birbiriyle çelişiyor: [${n4}] 4 °C, [${n8}] 8 °C diyor.`, citations: [Number(n4), Number(n8)] }) };
    };
    const r = (await ask('owner', Q)).body;
    expect(r).toMatchObject({ outcome: 'conflict', mode: 'model' });
    const cited = r.sources.filter((s: any) => s.cited);
    expect(cited.map((s: any) => s.route).sort()).toEqual([`/documents/${a}`, `/documents/${b}`].sort());
    expect(r.notes.join(' ')).toMatch(/çelişiyor/);
    expect(r.answer).toMatch(/4 °C/); expect(r.answer).toMatch(/8 °C/);
  });

  it('the model finds the sources insufficient: no answer, no sources offered as support', async () => {
    responder = () => ({ content: '{"status":"insufficient","answer":"","citations":[]}' });
    const r = (await ask('owner', Q)).body;
    expect(r).toMatchObject({ outcome: 'insufficient', sufficient: false, sources: [] });
    expect(r.answer).toMatch(/yeterince karşılamıyor/);
  });

  it('a claimed conflict that names only one source is refused', async () => {
    responder = () => ({ content: '{"status":"conflict","answer":"Çelişki var [1].","citations":[1]}' });
    const r = (await ask('owner', Q)).body;
    expect(r.model.status).toBe('rejected');
    expect(r.sources.length).toBeGreaterThan(0);
  });
});

describe('a model that fails or misbehaves never replaces the sources', () => {
  const show = (r: any, status: string, note: RegExp) => {
    expect(r.model.status).toBe(status);
    expect(r.mode).toBe('sources_only');
    expect(r.outcome).toBe('answered');
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.answer).toContain('[1]');
    expect(r.notes.join(' ')).toMatch(note);
  };

  it('unreachable (nothing listening): the relevant sources are listed and the person is told', async () => {
    await env.close(); await boot(cfg({ baseUrl: 'http://127.0.0.1:9' }));
    show((await ask('owner', COLD)).body, 'unreachable', /Dil modeline ulaşılamadı/);
  });

  it('a server error and a hang (timeout) are the same: sources shown', async () => {
    await env.close(); await boot(cfg({ timeoutMs: 1000 }));
    responder = () => ({ status: 500, content: 'x' });
    show((await ask('owner', COLD)).body, 'unreachable', /Dil modeline ulaşılamadı/);
    responder = () => ({ hang: true });
    const t0 = Date.now();
    show((await ask('owner', COLD)).body, 'unreachable', /Dil modeline ulaşılamadı/);
    expect(Date.now() - t0).toBeLessThan(4000);
  });

  it.each([
    ['not JSON', 'Tabii, işte yanıt.', 'invalid_output'],
    ['a penalty amount', '{"status":"answered","answer":"Kayıt tutulmazsa 25.000 TL ceza kesilir [1].","citations":[1]}', 'rejected'],
    ['a number that the sources do not contain', '{"status":"answered","answer":"Kayıt her 37 dakikada bir tutulur [1].","citations":[1]}', 'rejected'],
    ['a source that does not exist', '{"status":"answered","answer":"Kayıt tutulur [9].","citations":[9]}', 'rejected'],
    ['no citation at all', '{"status":"answered","answer":"Kayıt tutulur.","citations":[]}', 'rejected'],
  ])('output with %s is not used', async (_n, content, status) => {
    await env.close(); await boot(cfg());
    responder = () => ({ content });
    show((await ask('owner', COLD)).body, status, /kullanılamadı|uymadığı/);
  });
});

describe('checkVerdict (pure)', () => {
  const src = [{ n: 1, title: 'T', locator: 'L', text: 'Soğuk oda 4 °C olmalıdır.', isExample: false }, { n: 2, title: 'U', locator: 'L', text: 'Kayıt günde 2 kez tutulur.', isExample: false }];
  it('accepts numbers that are in the sources and string citations', () => {
    expect(checkVerdict({ status: 'answered', answer: 'Soğuk oda 4 °C olmalıdır [1].', citations: ['[1]'] }, src)).toMatchObject({ ok: true });
  });
  it('rejects amounts, alien numbers, unknown citations and a conflict with one source', () => {
    for (const answer of ['Ceza 500 TL [1].', 'Ceza ₺500 [1].', 'Soğuk oda 9 °C [1].', 'Soğuk oda [3].']) expect(checkVerdict({ status: 'answered', answer, citations: [1] }, src)).toMatchObject({ ok: false });
    expect(checkVerdict({ status: 'conflict', answer: 'Çelişiyor [1].', citations: [1] }, src)).toMatchObject({ ok: false });
    expect(checkVerdict({ status: 'x', answer: 'a', citations: [] }, src)).toMatchObject({ ok: false });
  });
});
