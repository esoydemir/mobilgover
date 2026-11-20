import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureReportRules, seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Two cases on the SAME fridge in the SAME branch (door gasket, thermostat), each with its own service request and report.
 * The follow-up measurement task is not owned by either case, so a report of a case may be offered on it only with its case shown,
 * and may be used as the task's document step only with a stated basis. An unreviewed report of the other case must not hold the task.
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
  pro = await seedDemoProvider(env.db, platform.marketReviewer.id, 'murat.ikivaka@ornek.test');
  const from = new Date(Date.now() - 864e5).toISOString(), to = new Date(Date.now() + 46 * 864e5).toISOString();
  const list = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}&from=${from}&to=${to}`)).body as any[];
  measTask = list.find(t => t.title === 'Servis sonrası sıcaklık doğrulaması').id;
});
afterAll(async () => { await env?.close(); });

async function serviceFor(opts: { ncrId: string | null; taskId: string | null; title: string; verify: boolean }) {
  const reqId = (await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: opts.title, description: 'Servis.', city: 'İstanbul', ncrId: opts.ncrId, taskId: opts.taskId })).body.id;
  const q = (await P1().post(`/pro/requests/${reqId}/quotes`, { scope: 'Servis', exclusions: 'Kompresör', priceNet: 1500, vatRate: 20, materials: 'Parça', durationText: '2 saat', warrantyText: '3 ay', validUntil: later(48), deliverable: 'Servis raporu (PDF)' })).body.id;
  const jobId = (await owner().post(`${C()}/quotes/${q}/accept`)).body.jobId;
  await P1().post(`/pro/jobs/${jobId}/check-in`, { code: (await owner().get(`${C()}/service-requests/${reqId}`)).body.job.checkin_code });
  const f = pdf(`rapor-${jobId}`);
  const r = await P1().post(`/pro/jobs/${jobId}/report`, { report: `${opts.title}: servis yapıldı, ölçümler rapora eklendi.`, file: { mime: 'application/pdf', sha256: createHash('sha256').update(f).digest('hex'), sizeBytes: f.length } });
  expect(r.status).toBe(200);
  expect((await P1().put(`/pro/jobs/${jobId}/report/${r.body.evidenceId}/content`, f, 'application/pdf')).status).toBe(200);
  const vid = (await owner().get(`${C()}/documents/${r.body.documentId}`)).body.versions[0].id as string;
  if (opts.verify) expect((await manager().post(`${C()}/documents/${r.body.documentId}/versions/${vid}/review`, { decision: 'verified', notes: 'Rapor okundu.' })).status).toBe(200);
  return { documentId: r.body.documentId as string, versionId: vid, requestId: reqId as string };
}
async function newCase(title: string) {
  const ncr = await manager().post(`${C()}/nonconformities`, { siteId: demo.siteId, title, description: 'Test kaydı.', hazardType: 'cold_chain_temperature', severity: 'major', equipmentId: demo.fridgeId, containment: 'Ürün taşındı.' });
  expect(ncr.status).toBe(201);
  return ncr.body.id as string;
}

describe('two cases on the same equipment, one follow-up task', () => {
  let a: Awaited<ReturnType<typeof serviceFor>>, b: Awaited<ReturnType<typeof serviceFor>>, caseA: string, caseB: string;

  it('each offered report says which case, request, date and provider it belongs to', async () => {
    caseA = await newCase('Kapı contası kaçağı');
    caseB = await newCase('Termostat arızası');
    a = await serviceFor({ ncrId: caseA, taskId: null, title: 'Conta servisi', verify: true });
    b = await serviceFor({ ncrId: caseB, taskId: null, title: 'Termostat servisi', verify: false });
    const opts = (await detail(measTask)).reportEvidence.options as any[];
    const oa = opts.find(o => o.documentId === a.documentId), ob = opts.find(o => o.documentId === b.documentId);
    expect(oa).toMatchObject({ relation: 'equipment', caseId: caseA, caseTitle: 'Kapı contası kaçağı', requestTitle: 'Conta servisi' });
    expect(ob).toMatchObject({ relation: 'equipment', caseId: caseB, caseTitle: 'Termostat arızası' });
    expect(oa.caseDetectedAt).toBeTruthy(); expect(oa.requestCreatedAt).toBeTruthy(); expect(oa.providerName).toBeTruthy();
  });

  it('the other case’s unreviewed report does not hold this task', async () => {
    const d = await detail(measTask);
    expect(d.serviceReports.blocked).toBe(false);
  });

  it('a report of another case is not accepted silently: a stated basis is required, then it is recorded', async () => {
    const no = await owner().post(`${C()}/tasks/${measTask}/report-evidence`, { documentId: a.documentId, versionId: a.versionId });
    expect(no.status).toBe(422);
    expect(no.body.error?.code ?? no.body.code).toBe('REPORT_BASIS_REQUIRED');
    const short = await owner().post(`${C()}/tasks/${measTask}/report-evidence`, { documentId: a.documentId, versionId: a.versionId, basisNote: 'evet' });
    expect(short.status).toBe(422);
    const ok = await owner().post(`${C()}/tasks/${measTask}/report-evidence`, { documentId: a.documentId, versionId: a.versionId, basisNote: 'Conta servisi sonrası ilk sıcaklık doğrulaması bu görevde yapıldı.' });
    expect(ok.status).toBe(200);
    const d = await detail(measTask);
    const link = d.reportEvidence.links.find((l: any) => l.documentId === a.documentId);
    expect(link).toMatchObject({ relation: 'equipment', caseId: caseA, basisNote: expect.stringContaining('Conta servisi') });
    const ev = await env.ownerDb.query(`SELECT payload FROM audit_events WHERE event_type = 'task.report_evidence_selected' AND entity_id = $1 ORDER BY seq DESC LIMIT 1`, [measTask]);
    expect(ev.rows[0].payload).toMatchObject({ relation: 'equipment', caseId: caseA });
    expect(ev.rows[0].payload.basisNote).toContain('Conta servisi');
  });

  it('wrong report + new measurement closes the task, but the record names the case the report belonged to', async () => {
    expect((await owner().post(`${C()}/tasks/${measTask}/measurements`, { quantity: 'temperature', value: 3, unit: '°C', measuredAt: new Date().toISOString(), instrumentId: demo.thermometerId })).status).toBe(201);
    expect((await owner().post(`${C()}/tasks/${measTask}/complete`, {})).status).toBe(200);
    const ev = await env.ownerDb.query(`SELECT payload FROM audit_events WHERE event_type = 'task.completed' AND entity_id = $1`, [measTask]);
    expect(ev.rows[0].payload.serviceReportBasis[0]).toMatchObject({ documentId: a.documentId, relation: 'equipment', caseId: caseA });
  });
});

describe('a request opened directly from the task needs no basis', () => {
  it('direct relation: selectable without a note and blocks while unreviewed', async () => {
    const from = new Date(Date.now() + 864e5).toISOString(), to = new Date(Date.now() + 46 * 864e5).toISOString();
    const list = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}&from=${from}&to=${to}`)).body as any[];
    const t2 = list.find(t => t.title === 'Servis sonrası sıcaklık doğrulaması' && t.id !== measTask && t.status === 'open')?.id as string | undefined;
    if (!t2) return; // no second occurrence in the seeded horizon
    const s = await serviceFor({ ncrId: null, taskId: t2, title: 'Görevden açılan servis', verify: false });
    const d = await detail(t2);
    expect(d.serviceReports.blocked).toBe(true);
    expect(d.reportEvidence.options.find((o: any) => o.documentId === s.documentId)).toMatchObject({ relation: 'direct' });
  });
});
