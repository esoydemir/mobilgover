import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, fakeJpeg, freshEnv, type Env } from '../support/env';

/**
 * Two units with the same task title are only distinguishable by branch and equipment name.
 * The audit file must carry the equipment name on overdue checks, closed checks and closed cases,
 * and the "why does this apply" answer must say which branch it is about.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const range = () => `from=${encodeURIComponent(new Date(Date.now() - 30 * 864e5).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 864e5).toISOString())}`;
let overdueId: string, doneId: string, fridgeName: string;

async function pdfText(buf: Buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) out += ((await (await doc.getPage(i)).getTextContent()).items as { str: string }[]).map(x => x.str).join(' ') + ' ';
  return out.replace(/\s+/g, ' ');
}

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  await topUpAllSites(env.db, 14);
  fridgeName = (await env.ownerDb.query(`SELECT name FROM equipment WHERE id = $1`, [demo.fridgeId])).rows[0].name;
  // The same check the explainable-obligation test completes: first open check of the fridge.
  const list = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}`)).body as any[];
  const open = list.filter(t => t.equipment_id === demo.fridgeId && t.status === 'open').map(t => t.id as string);
  [doneId, overdueId] = open as [string, string];
  await env.ownerDb.query(`UPDATE tasks SET due_at = now() - interval '2 days' WHERE id = $1`, [overdueId]);
  const photo = fakeJpeg('sube-ekipman');
  await owner().post(`${C()}/tasks/${doneId}/measurements`, { quantity: 'temperature', value: 3, unit: '°C', measuredAt: new Date(Date.now() - 60_000).toISOString(), instrumentId: demo.thermometerId });
  const reg = await owner().post(`${C()}/tasks/${doneId}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: createHash('sha256').update(photo).digest('hex'), sizeBytes: photo.length });
  await owner().put(`${C()}/evidence/${reg.body.id}/content`, photo, 'image/jpeg');
  const done = await owner().post(`${C()}/tasks/${doneId}/complete`);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
});
afterAll(async () => { await env?.close(); });

describe('branch and equipment stay visible', () => {
  it('audit file: overdue and closed checks name the equipment, in data and in the PDF text', async () => {
    const j = (await owner().get(`${C()}/audit-report?format=json&${range()}`)).body;
    expect(j.sections.overdue.find((t: any) => t.id === overdueId).equipment).toBe(fridgeName);
    expect(j.sections.closures.tasks.find((t: any) => t.id === doneId).equipment).toBe(fridgeName);
    const pdf = await owner().get(`${C()}/audit-report?format=pdf&${range()}`);
    const text = await pdfText(pdf.body as Buffer);
    expect(text.split(`ekipman: ${fridgeName.replace(/\s+/g, ' ')}`).length - 1).toBeGreaterThanOrEqual(2);
    // The rule list is read by people: no internal decision codes in the file.
    expect(text).toContain('karar: uygulanıyor');
    expect(text).not.toMatch(/karar: (applies|not_applicable|needs_info|needs_review|not_in_force)/);
  });

  it('audit file: a closed case names the equipment', async () => {
    const id = (await owner().post(`${C()}/nonconformities`, { siteId: demo.siteId, title: 'Conta kaçağı', description: 'Test kaydı.', hazardType: 'cold_chain_temperature', severity: 'minor', equipmentId: demo.fridgeId, containment: 'Ürün taşındı.' })).body.id;
    await env.ownerDb.query(`UPDATE nonconformities SET status = 'closed', closed_at = now(), closed_by = $2 WHERE id = $1`, [id, demo.users.owner.id]);
    const j = (await owner().get(`${C()}/audit-report?format=json&${range()}`)).body;
    expect(j.sections.closures.cases.find((n: any) => n.id === id).equipment).toBe(fridgeName);
  });

  it('a case opened from a measurement says where its limit came from', async () => {
    const list = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}`)).body as any[];
    const t = list.find(x => x.equipment_id === demo.fridgeId && x.status === 'open' && x.id !== overdueId)!.id as string;
    await owner().post(`${C()}/tasks/${t}/measurements`, { quantity: 'temperature', value: 9, unit: '°C', measuredAt: new Date(Date.now() - 60_000).toISOString(), instrumentId: demo.thermometerId });
    const photo = fakeJpeg('limit-kaynagi');
    const reg = await owner().post(`${C()}/tasks/${t}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: createHash('sha256').update(photo).digest('hex'), sizeBytes: photo.length });
    await owner().put(`${C()}/evidence/${reg.body.id}/content`, photo, 'image/jpeg');
    await owner().post(`${C()}/tasks/${t}/evidence`, { kind: 'note', text: 'Kapı yarım açık kalmış.' });
    const done = await owner().post(`${C()}/tasks/${t}/complete`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const n = (await owner().get(`${C()}/nonconformities/${done.body.nonconformityId}`)).body;
    expect(n.measurement).toMatchObject({ unit: '°C', limit_basis: 'example' });
  });

  it('a service request cannot be filed under another branch than its source case', async () => {
    const other = await env.db.system(async tx => (await tx.query(`INSERT INTO sites (company_id, name) VALUES ($1, 'İkinci şube') RETURNING id`, [demo.companyId])).rows[0].id as string);
    const ncrId = (await owner().post(`${C()}/nonconformities`, { siteId: demo.siteId, title: 'Fan sesi', description: 'Test kaydı.', hazardType: 'cold_chain_temperature', severity: 'minor', equipmentId: demo.fridgeId, containment: 'İzleniyor.' })).body.id;
    const body = { categoryCode: 'refrigeration_service', title: 'Fan kontrolü', description: 'Fan sesli çalışıyor.', city: 'İstanbul', ncrId };
    const count = async () => (await env.ownerDb.query(`SELECT count(*)::int AS n FROM service_requests WHERE ncr_id = $1`, [ncrId])).rows[0].n;
    expect((await owner().post(`${C()}/service-requests/preview`, { ...body, siteId: other })).status).toBe(422);
    const wrong = await owner().post(`${C()}/service-requests`, { ...body, siteId: other });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('SOURCE_OTHER_SITE');
    expect(await count()).toBe(0);
    expect((await owner().post(`${C()}/service-requests`, { ...body, siteId: demo.siteId })).status).toBe(201);
    expect(await count()).toBe(1);
  });

  it('obligation explanation says which branch it is about', async () => {
    const list = (await owner().get(`${C()}/obligations`)).body as any[];
    const o = list.find(x => x.siteId === demo.siteId);
    const e = (await owner().get(`${C()}/obligations/${o.id}/explanation`)).body;
    const name = (await env.ownerDb.query(`SELECT name FROM sites WHERE id = $1`, [demo.siteId])).rows[0].name;
    expect(e.obligation).toMatchObject({ siteId: demo.siteId, siteName: name });
  });
});
