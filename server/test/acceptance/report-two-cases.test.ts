import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureReportRules, seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Two cases on the SAME fridge in the SAME branch (door gasket, thermostat), each with its own service request and report.
 * Product decision: a report that belongs to another case can be the REQUIRED service evidence of a follow-up task only when an authorised person has linked
 * that service job to the second case (source case, target case, job, report version, person, basis). Without the link it is visible as supporting
 * material and the mandatory document step stays open. A single visit that really covered both faults is linked explicitly. An unreviewed report of the
 * other case never holds the task. A branch's report never reaches another branch's task or PDF. A daily check that does not take reports lists none.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let pro: { id: string; token: string };
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const P1 = () => client(env, pro.token);
const pdf = (seed: string) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(seed)]);
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const detail = async (id: string) => (await owner().get(`${C()}/tasks/${id}`)).body;
let measTask: string;
const range = () => `from=${encodeURIComponent(new Date(Date.now() - 864e5).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 46 * 864e5).toISOString())}`;

beforeAll(async () => {
  env = await freshEnv();
  const platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  await ensureReportRules(env.db);
  await topUpAllSites(env.db, 45);
  pro = await seedDemoProvider(env.db, platform.marketReviewer.id, 'murat.ikivaka@ornek.test');
  const list = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}&${range()}`)).body as any[];
  measTask = list.find(t => t.title === 'Servis sonrası sıcaklık doğrulaması').id;
});
afterAll(async () => { await env?.close(); });

async function serviceFor(opts: { siteId?: string; ncrId: string | null; taskId: string | null; title: string; verify: boolean }) {
  const siteId = opts.siteId ?? demo.siteId;
  const reqId = (await owner().post(`${C()}/service-requests`, { siteId, categoryCode: 'refrigeration_service', title: opts.title, description: 'Servis.', city: 'İstanbul', ncrId: opts.ncrId, taskId: opts.taskId })).body.id;
  const q = (await P1().post(`/pro/requests/${reqId}/quotes`, { scope: 'Servis', exclusions: 'Kompresör', priceNet: 1500, vatRate: 20, materials: 'Parça', durationText: '2 saat', warrantyText: '3 ay', validUntil: later(48), deliverable: 'Servis raporu (PDF)' })).body.id;
  const jobId = (await owner().post(`${C()}/quotes/${q}/accept`)).body.jobId;
  await P1().post(`/pro/jobs/${jobId}/check-in`, { code: (await owner().get(`${C()}/service-requests/${reqId}`)).body.job.checkin_code });
  const f = pdf(`rapor-${jobId}`);
  const r = await P1().post(`/pro/jobs/${jobId}/report`, { report: `${opts.title}: servis yapıldı, ölçümler rapora eklendi.`, file: { mime: 'application/pdf', sha256: createHash('sha256').update(f).digest('hex'), sizeBytes: f.length } });
  expect(r.status).toBe(200);
  expect((await P1().put(`/pro/jobs/${jobId}/report/${r.body.evidenceId}/content`, f, 'application/pdf')).status).toBe(200);
  const vid = (await owner().get(`${C()}/documents/${r.body.documentId}`)).body.versions[0].id as string;
  if (opts.verify) expect((await (opts.siteId ? owner() : manager()).post(`${C()}/documents/${r.body.documentId}/versions/${vid}/review`, { decision: 'verified', notes: 'Rapor okundu.' })).status).toBe(200);
  return { documentId: r.body.documentId as string, versionId: vid, requestId: reqId as string, jobId: jobId as string };
}
async function newCase(title: string, siteId = demo.siteId, equipmentId: string | null = demo.fridgeId) {
  const ncr = await manager().post(`${C()}/nonconformities`, { siteId, title, description: 'Test kaydı.', hazardType: 'cold_chain_temperature', severity: 'major', equipmentId, containment: 'Ürün taşındı.' });
  expect(ncr.status).toBe(201);
  return ncr.body.id as string;
}
const select = (taskId: string, r: { documentId: string; versionId: string }) => owner().post(`${C()}/tasks/${taskId}/report-evidence`, { documentId: r.documentId, versionId: r.versionId });
const opt = async (taskId: string, documentId: string) => (await detail(taskId)).reportEvidence.options.find((o: any) => o.documentId === documentId);

describe('two cases on the same equipment, one follow-up task', () => {
  let a: Awaited<ReturnType<typeof serviceFor>>, b: Awaited<ReturnType<typeof serviceFor>>, caseA: string, caseB: string;

  it('each offered report says which case, request, equipment, date and provider it belongs to; the other case’s unreviewed report does not hold the task', async () => {
    caseA = await newCase('Kapı contası kaçağı');
    caseB = await newCase('Termostat arızası');
    a = await serviceFor({ ncrId: caseA, taskId: null, title: 'Conta servisi', verify: true });
    b = await serviceFor({ ncrId: caseB, taskId: null, title: 'Termostat servisi', verify: false });
    const oa = await opt(measTask, a.documentId), ob = await opt(measTask, b.documentId);
    expect(oa).toMatchObject({ relation: 'equipment', caseId: caseA, caseTitle: 'Kapı contası kaçağı', requestTitle: 'Conta servisi' });
    expect(ob).toMatchObject({ relation: 'equipment', caseId: caseB, caseTitle: 'Termostat arızası' });
    expect(oa.caseDetectedAt && oa.requestCreatedAt && oa.providerName && oa.equipmentName && oa.serviceDate).toBeTruthy();
    expect((await detail(measTask)).serviceReports.blocked).toBe(false);
  });

  it('scenario 2 — the report belongs only to the gasket case: it cannot be chosen, free text changes nothing, the document step stays open', async () => {
    const o = await opt(measTask, a.documentId);
    expect(o.reason).toContain('ilişkisi kayıtlı değil');
    const no = await owner().post(`${C()}/tasks/${measTask}/report-evidence`, { documentId: a.documentId, versionId: a.versionId, basisNote: 'Bu servis termostatı da kapsıyordu, eminim.' });
    expect(no.status).toBe(422);
    expect(no.body.error.code).toBe('REPORT_NOT_LINKED');
    const d = await detail(measTask);
    expect(d.progress.missing.some((m: string) => m.startsWith('Belge'))).toBe(true);
    // still visible as supporting material
    expect(d.serviceReports.reports.map((r: any) => r.documentId)).toContain(a.documentId);
    // a measurement alone does not close it: the document step is open
    expect((await owner().post(`${C()}/tasks/${measTask}/measurements`, { quantity: 'temperature', value: 3, unit: '°C', measuredAt: new Date().toISOString(), instrumentId: demo.thermometerId })).status).toBe(201);
    expect((await owner().post(`${C()}/tasks/${measTask}/complete`, {})).status).toBe(422);
  });

  it('linking needs authority, a real basis, the same branch and equipment, and is recorded with source case, target case, job, version and person', async () => {
    const url = `${C()}/nonconformities/${caseB}/service-links`;
    expect((await staff().post(url, { jobId: a.jobId, basis: 'Servis hem conta hem termostatı kapsadı (rapor 2. sayfa).' })).status).not.toBe(201);
    expect((await manager().post(url, { jobId: a.jobId, basis: 'kısa' })).status).toBe(422);
    expect((await manager().post(`${C()}/nonconformities/${caseA}/service-links`, { jobId: a.jobId, basis: 'Kendi vakasının servisi; ilişkilendirme gereksiz.' })).status).toBe(409);
    const ok = await manager().post(url, { jobId: a.jobId, basis: 'Servis hem conta hem termostatı kapsadı (rapor 2. sayfa, madde 4).' });
    expect(ok.status).toBe(201);
    expect((await manager().post(url, { jobId: a.jobId, basis: 'Aynı servis ikinci kez ilişkilendirilmeye çalışılıyor.' })).status).toBe(409);
    const row = (await env.ownerDb.query(`SELECT ncr_id, source_ncr_id, job_id, version_number, linked_by, basis FROM service_case_links WHERE id = $1`, [ok.body.id])).rows[0];
    expect(row).toMatchObject({ ncr_id: caseB, source_ncr_id: caseA, job_id: a.jobId, version_number: 1, linked_by: demo.users.manager.id });
    const ev = (await env.ownerDb.query(`SELECT payload FROM audit_events WHERE event_type = 'nonconformity.service_linked' AND entity_id = $1`, [caseB])).rows[0].payload;
    expect(ev).toMatchObject({ sourceCaseId: caseA, targetCaseId: caseB, jobId: a.jobId, version: 1 });
    const n = (await manager().get(`${C()}/nonconformities/${caseB}`)).body;
    expect(n.serviceLinks.linked.map((l: any) => l.job_id)).toEqual([a.jobId]);
  });

  it('scenario 1 — one visit covering both faults: once linked it is chosen as required evidence, the new measurement stays mandatory, the task closes and the record names everything', async () => {
    const o = await opt(measTask, a.documentId);
    expect(o).toMatchObject({ relation: 'linked', reason: null, linkedCaseTitle: 'Termostat arızası', linkedBy: expect.any(String) });
    expect((await select(measTask, a)).status).toBe(200);
    expect((await owner().post(`${C()}/tasks/${measTask}/complete`, {})).status).toBe(200); // measurement was entered above
    const ev = (await env.ownerDb.query(`SELECT payload FROM audit_events WHERE event_type = 'task.completed' AND entity_id = $1`, [measTask])).rows[0].payload;
    expect(ev.serviceReportBasis[0]).toMatchObject({ documentId: a.documentId, relation: 'linked', caseId: caseA });
    const sel = (await env.ownerDb.query(`SELECT payload FROM audit_events WHERE event_type = 'task.report_evidence_selected' AND entity_id = $1`, [measTask])).rows[0].payload;
    expect(sel).toMatchObject({ relation: 'linked', sourceCaseId: caseA, targetCaseId: caseB });
  });
});

describe('a daily check that does not take service reports', () => {
  it('lists none of the equipment’s other-case reports', async () => {
    const list = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}&${range()}`)).body as any[];
    const daily = list.find(t => t.title === 'Soğutucu sıcaklık kontrolü' && t.status === 'open');
    const d = await detail(daily.id);
    expect(d.reportEvidence.accepted).toBe(false);
    expect(d.serviceReports.reports).toEqual([]);
  });
});

describe('two branches, same equipment name', () => {
  it('a report of one branch never reaches the other branch’s task, selection or audit PDF', async () => {
    const site2 = await env.db.system(async tx => (await tx.query(`INSERT INTO sites (company_id, name) VALUES ($1, 'Şube 2') RETURNING id`, [demo.companyId])).rows[0].id as string);
    const eqName = (await env.ownerDb.query(`SELECT name FROM equipment WHERE id = $1`, [demo.fridgeId])).rows[0].name as string;
    const eq2 = await owner().post(`${C()}/equipment`, { siteId: site2, type: 'refrigerator', name: eqName });
    expect([200, 201]).toContain(eq2.status);
    const c2 = (await owner().post(`${C()}/nonconformities`, { siteId: site2, title: 'Şube 2 buzdolabı arızası', description: 'Test kaydı.', hazardType: 'cold_chain_temperature', severity: 'major', equipmentId: eq2.body.id, containment: 'Ürün taşındı.' })).body.id as string;
    const s2 = await serviceFor({ siteId: site2, ncrId: c2, taskId: null, title: 'Şube 2 servisi', verify: true });
    const from = new Date(Date.now() - 864e5).toISOString(), to = new Date(Date.now() + 46 * 864e5).toISOString();
    // open follow-up task of branch 1 (new occurrence: take any open one of the template)
    const l1 = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}&from=${from}&to=${to}`)).body as any[];
    const t1 = l1.find(t => t.title === 'Servis sonrası sıcaklık doğrulaması' && t.status === 'open');
    if (t1) {
      expect((await detail(t1.id)).serviceReports.reports.map((r: any) => r.documentId)).not.toContain(s2.documentId);
      expect((await select(t1.id, s2)).status).toBe(404);
    }
    const pdfRes = await owner().get(`${C()}/audit-report?siteId=${demo.siteId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=json`);
    expect(JSON.stringify(pdfRes.body)).not.toContain(s2.documentId);
    expect(JSON.stringify(pdfRes.body)).not.toContain('Şube 2');
  });
});
