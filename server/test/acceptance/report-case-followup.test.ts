import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureReportRules, seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/**
 * The service report of a request opened from a case can be chosen on the open follow-up measurement task of the same branch and the
 * same equipment (not for other equipment or another branch). The report fills only the document step: the new measurement stays mandatory.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let pro: { id: string; token: string };
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const P1 = () => client(env, pro.token);
const pdf = (seed: string) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(seed)]);
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const detail = async (id: string) => (await owner().get(`${C()}/tasks/${id}`)).body;
let measTask: string;

beforeAll(async () => {
  env = await freshEnv();
  const platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  await ensureReportRules(env.db);
  await topUpAllSites(env.db, 45);
  pro = await seedDemoProvider(env.db, platform.marketReviewer.id, 'murat.followup@ornek.test');
  const from = new Date(Date.now() - 864e5).toISOString(), to = new Date(Date.now() + 46 * 864e5).toISOString();
  const list = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}&from=${from}&to=${to}`)).body as any[];
  measTask = list.find(t => t.title === 'Servis sonrası sıcaklık doğrulaması').id;
});
afterAll(async () => { await env?.close(); });

async function caseReport(equipmentId: string | null, title: string) {
  const ncr = await manager().post(`${C()}/nonconformities`, { siteId: demo.siteId, title, description: 'Test kaydı açıklaması.', hazardType: 'cold_chain_temperature', severity: 'major', equipmentId, containment: 'Ürün taşındı.' });
  expect(ncr.status).toBe(201);
  const reqId = (await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: `${title} servisi`, description: 'Vakadan açılan servis.', city: 'İstanbul', ncrId: ncr.body.id, taskId: null })).body.id;
  const q = (await P1().post(`/pro/requests/${reqId}/quotes`, { scope: 'Conta değişimi', exclusions: 'Kompresör', priceNet: 1500, vatRate: 20, materials: 'Conta', durationText: '2 saat', warrantyText: '3 ay', validUntil: later(48), deliverable: 'Servis raporu (PDF)' })).body.id;
  const jobId = (await owner().post(`${C()}/quotes/${q}/accept`)).body.jobId;
  await P1().post(`/pro/jobs/${jobId}/check-in`, { code: (await owner().get(`${C()}/service-requests/${reqId}`)).body.job.checkin_code });
  const f = pdf(`rapor-${jobId}`);
  const r = await P1().post(`/pro/jobs/${jobId}/report`, { report: 'Vaka servis raporu: conta değiştirildi, ölçümler rapora eklendi.', file: { mime: 'application/pdf', sha256: createHash('sha256').update(f).digest('hex'), sizeBytes: f.length } });
  expect(r.status).toBe(200);
  expect((await P1().put(`/pro/jobs/${jobId}/report/${r.body.evidenceId}/content`, f, 'application/pdf')).status).toBe(200);
  const vid = (await owner().get(`${C()}/documents/${r.body.documentId}`)).body.versions[0].id as string;
  expect((await manager().post(`${C()}/documents/${r.body.documentId}/versions/${vid}/review`, { decision: 'verified', notes: 'Rapor okundu.' })).status).toBe(200);
  return { documentId: r.body.documentId as string, versionId: vid };
}

describe('report of a case request → follow-up measurement task', () => {
  it('a case on other equipment (or none) does not offer its report on the task', async () => {
    const d0 = await detail(measTask);
    expect(d0.equipment?.id).toBe(demo.fridgeId);
    const other = await caseReport(null, 'Ekipmansız vaka');
    expect((await detail(measTask)).reportEvidence.options.map((o: any) => o.documentId)).not.toContain(other.documentId);
    const no = await owner().post(`${C()}/tasks/${measTask}/report-evidence`, { documentId: other.documentId, versionId: other.versionId });
    expect(no.status).toBe(404);
  });

  it('the same equipment and branch: selectable; the measurement stays mandatory; then the task closes', async () => {
    const rep = await caseReport(demo.fridgeId, 'Buzdolabı vakası');
    const opt = (await detail(measTask)).reportEvidence.options.find((o: any) => o.documentId === rep.documentId);
    expect(opt).toMatchObject({ reason: null, version: 1 });
    expect((await owner().post(`${C()}/tasks/${measTask}/report-evidence`, { documentId: rep.documentId, versionId: rep.versionId })).status).toBe(422);
    expect((await owner().post(`${C()}/tasks/${measTask}/report-evidence`, { documentId: rep.documentId, versionId: rep.versionId, basisNote: 'Vaka servisinden sonraki ilk ölçüm bu görevde yapılıyor.' })).status).toBe(200);
    const d = await detail(measTask);
    expect(d.progress.missing).toEqual(['Ölçüm: sıcaklık (°C)']);
    const early = await owner().post(`${C()}/tasks/${measTask}/complete`, {});
    expect(early.status).toBe(422);
    expect((await owner().post(`${C()}/tasks/${measTask}/measurements`, { quantity: 'temperature', value: 3, unit: '°C', measuredAt: new Date().toISOString(), instrumentId: demo.thermometerId })).status).toBe(201);
    expect((await owner().post(`${C()}/tasks/${measTask}/complete`, {})).status).toBe(200);
  });
});
