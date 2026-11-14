import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureReportRules, seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/**
 * GM-30 devamı: when a task's rule accepts a service report as its document evidence, a reviewed latest version of the task-linked
 * report of the same site can be tied to the task without uploading the file again. The other requirements (measurement,
 * note, photo, approval) still apply; a later revision re-evaluates an open task; a closed task keeps the version it rested on.
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
const fileOf = (b: Buffer) => ({ mime: 'application/pdf', sha256: createHash('sha256').update(b).digest('hex'), sizeBytes: b.length });
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const TXT = (n: number) => `GM31 servis raporu sürüm ${n}: conta değiştirildi, gaz basıncı normal, ölçümler rapora eklendi.`;

let docTask: string, measTask: string;

beforeAll(async () => {
  env = await freshEnv();
  const platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  expect(await ensureReportRules(env.db)).toBe(2);
  expect(await ensureReportRules(env.db)).toBe(0); // idempotent
  await topUpAllSites(env.db, 45);
  pro = await seedDemoProvider(env.db, platform.marketReviewer.id, 'murat.gm31@ornek.test');
  const from = new Date(Date.now() - 864e5).toISOString(), to = new Date(Date.now() + 46 * 864e5).toISOString();
  const list = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}&from=${from}&to=${to}`)).body as any[];
  docTask = list.find(t => t.title === 'Soğutucu servis raporu kaydı').id;
  measTask = list.find(t => t.title === 'Servis sonrası sıcaklık doğrulaması').id;
});
afterAll(async () => { await env?.close(); });

/** task → request → quote → accepted → check-in; returns the job. */
async function startService(taskId: string, title: string) {
  const reqId = (await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title, description: 'Görevden açılan servis.', city: 'İstanbul', taskId })).body.id;
  const q = (await P1().post(`/pro/requests/${reqId}/quotes`, { scope: 'Conta değişimi', exclusions: 'Kompresör', priceNet: 1500, vatRate: 20, materials: 'Conta', durationText: '2 saat',
    warrantyText: '3 ay', validUntil: later(48), deliverable: 'Servis raporu (PDF)' })).body.id;
  const jobId = (await owner().post(`${C()}/quotes/${q}/accept`)).body.jobId;
  await P1().post(`/pro/jobs/${jobId}/check-in`, { code: (await owner().get(`${C()}/service-requests/${reqId}`)).body.job.checkin_code });
  return { reqId, jobId };
}
async function upload(jobId: string, n: number) {
  const f = pdf(`rapor-${jobId}-${n}`);
  const r = await P1().post(`/pro/jobs/${jobId}/report`, { report: TXT(n), file: fileOf(f) });
  expect(r.status).toBe(200);
  expect((await P1().put(`/pro/jobs/${jobId}/report/${r.body.evidenceId}/content`, f, 'application/pdf')).status).toBe(200);
  return r.body as { documentId: string };
}
const latestVersionId = async (docId: string) => (await owner().get(`${C()}/documents/${docId}`)).body.versions[0].id as string;
const review = async (docId: string, decision: 'verified' | 'rejected') =>
  manager().post(`${C()}/documents/${docId}/versions/${await latestVersionId(docId)}/review`, { decision, notes: 'Rapor ve ölçümler okundu.' });
const select = (taskId: string, documentId: string, versionId: string, who = owner()) => who.post(`${C()}/tasks/${taskId}/report-evidence`, { documentId, versionId });
const detail = async (taskId: string) => (await owner().get(`${C()}/tasks/${taskId}`)).body;

describe('flow 1: a task that asks for document evidence is completed with a reviewed report', () => {
  let job: { reqId: string; jobId: string }, docId: string;

  it('the rule accepts a report; nothing can be chosen before a report exists', async () => {
    const d = await detail(docTask);
    expect(d.requirements.find((r: any) => r.kind === 'document')).toMatchObject({ min: 1, acceptsServiceReport: true });
    expect(d.reportEvidence).toMatchObject({ accepted: true, links: [], options: [] });
    expect(d.progress.missing).toEqual(['Belge: 0/1 yüklendi ya da incelenmiş servis raporu seçildi', 'Açıklama notu']);
  });

  it('an unreviewed report cannot be chosen; reviewing it makes the latest version selectable', async () => {
    job = await startService(docTask, 'Soğutucu servis (belge görevi)');
    docId = (await upload(job.jobId, 1)).documentId;
    const v1 = await latestVersionId(docId);
    const opt = (await detail(docTask)).reportEvidence.options[0];
    expect(opt).toMatchObject({ documentId: docId, version: 1, selected: false, siteName: expect.any(String) });
    expect(opt.reason).toMatch(/henüz incelenmedi/);
    const no = await select(docTask, docId, v1);
    expect(no.status).toBe(422);
    expect(no.body.error.code).toBe('REPORT_NOT_SELECTABLE');
    expect((await review(docId, 'verified')).status).toBe(200);
    expect((await detail(docTask)).reportEvidence.options[0]).toMatchObject({ reason: null, selected: false });
  });

  it('only people who may read documents can choose; the choice is idempotent and needs no re-upload', async () => {
    const v1 = await latestVersionId(docId);
    expect((await select(docTask, docId, v1, staff())).status).toBe(404);
    const a = await select(docTask, docId, v1);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ duplicate: false, version: 1 });
    const again = await select(docTask, docId, v1);
    expect(again.body).toMatchObject({ duplicate: true, id: a.body.id });
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM task_report_evidence WHERE task_id = $1`, [docTask])).rows[0].n).toBe(1);
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM evidence WHERE task_id = $1 AND kind = 'document'`, [docTask])).rows[0].n).toBe(0); // no second upload
    const d = await detail(docTask);
    expect(d.reportEvidence.links[0]).toMatchObject({ documentId: docId, version: 1, counts: true, status: 'active', completionBasis: false });
    expect(d.progress.missing).toEqual(['Açıklama notu']); // the document step is met by the report; the note is still needed
  });

  it('other requirements still apply: the task closes only after the note, and records the version it rests on', async () => {
    const early = await owner().post(`${C()}/tasks/${docTask}/complete`, {});
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('EVIDENCE_INCOMPLETE');
    expect(early.body.error.details.missing).toEqual(['Açıklama notu']);
    expect((await owner().post(`${C()}/tasks/${docTask}/evidence`, { kind: 'note', text: 'Servis raporu okundu, conta değişimi doğrulandı.' })).status).toBe(201);
    const done = await owner().post(`${C()}/tasks/${docTask}/complete`, {});
    expect(done.status).toBe(200);
    const d = await detail(docTask);
    expect(d.status).toBe('done');
    expect(d.reportEvidence.links).toHaveLength(1);
    expect(d.reportEvidence.links[0]).toMatchObject({ version: 1, completionBasis: true });
    const audit = (await env.ownerDb.query(`SELECT payload FROM audit_events WHERE entity_id = $1 AND event_type = 'task.completed'`, [docTask])).rows[0].payload;
    expect(audit.serviceReportBasis).toEqual([expect.objectContaining({ documentId: docId, version: 1, versionId: expect.any(String), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
  });

  it('a revision after closing does not change what the closed task rested on', async () => {
    expect((await owner().post(`${C()}/jobs/${job.jobId}/acceptance`, { accept: false, note: 'Revizyon: ek ölçüm gerekli, rapora eklenmeli.' })).status).toBe(200);
    await upload(job.jobId, 2);
    const d = await detail(docTask);
    expect(d.reportEvidence.links).toEqual([expect.objectContaining({ version: 1, completionBasis: true, status: 'active' })]);
    expect(d.status).toBe('done');
    expect(d.progress).toMatchObject({ complete: true, missing: [] }); // the closed task still counts the version it was closed on
    expect(d.serviceReports.blocked).toBe(false); // a later revision does not hold a closed task open
  });
});

describe('flow 2: a task with a measurement requirement stays open with the report alone', () => {
  let job: { reqId: string; jobId: string }, docId: string;

  it('a rule that does not accept reports offers no choice', async () => {
    const list = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}`)).body as any[];
    const fridge = list.find(t => t.title === 'Soğutucu sıcaklık kontrolü');
    const sel = await select(fridge.id, '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000001');
    expect(sel.status).toBe(422);
    expect(sel.body.error.code).toBe('REPORT_EVIDENCE_NOT_ACCEPTED');
  });

  it('reviewed report chosen: the document step is met, the measurement step stays missing and is named', async () => {
    job = await startService(measTask, 'Soğutucu servis (ölçüm görevi)');
    docId = (await upload(job.jobId, 1)).documentId;
    expect((await review(docId, 'verified')).status).toBe(200);
    // A report that belongs to another site cannot be tied to this task.
    const other = (await env.ownerDb.query(`INSERT INTO sites (company_id, name) VALUES ($1, 'Başka şube') RETURNING id`, [demo.companyId])).rows[0].id;
    await env.ownerDb.query(`UPDATE documents SET site_id = $2 WHERE id = $1`, [docId, other]);
    expect((await detail(measTask)).reportEvidence.options[0].reason).toMatch(/şubesine ait değil/);
    const wrongSite = await select(measTask, docId, await latestVersionId(docId));
    expect(wrongSite.status).toBe(422);
    expect(wrongSite.body.error.code).toBe('REPORT_NOT_SELECTABLE');
    await env.ownerDb.query(`UPDATE documents SET site_id = $2 WHERE id = $1`, [docId, demo.siteId]);
    expect((await select(measTask, docId, await latestVersionId(docId))).status).toBe(200);
    const d = await detail(measTask);
    expect(d.progress.complete).toBe(false);
    expect(d.progress.missing).toEqual(['Ölçüm: temperature (°C)']);
    const done = await owner().post(`${C()}/tasks/${measTask}/complete`, {});
    expect(done.status).toBe(422);
    expect(done.body.error.code).toBe('EVIDENCE_INCOMPLETE');
    expect(done.body.error.details.missing).toEqual(['Ölçüm: temperature (°C)']);
    expect((await detail(measTask)).status).toBe('open');
  });

  it('a later revision re-evaluates the open task: the earlier choice stops counting and the document step is missing again', async () => {
    expect((await owner().post(`${C()}/jobs/${job.jobId}/acceptance`, { accept: false, note: 'Revizyon: sonrası ölçüm süresi raporda yok.' })).status).toBe(200);
    await upload(job.jobId, 2);
    const d = await detail(measTask);
    expect(d.reportEvidence.links[0]).toMatchObject({ version: 1, status: 'stale', counts: false });
    expect(d.reportEvidence.links[0].reason).toMatch(/Yeni rapor sürümü \(2\)/);
    expect(d.progress.missing).toEqual(['Ölçüm: temperature (°C)', 'Belge: 0/1 yüklendi ya da incelenmiş servis raporu seçildi']);
    expect(d.reportEvidence.options[0]).toMatchObject({ version: 2, selected: false });
    expect(d.reportEvidence.options[0].reason).toMatch(/henüz incelenmedi/);
    const stale = (await env.ownerDb.query(`SELECT payload FROM audit_events WHERE entity_id = $1 AND event_type = 'task.report_evidence_stale'`, [measTask])).rows;
    expect(stale).toHaveLength(1);
    expect(stale[0].payload).toMatchObject({ previousVersion: 1, newVersion: 2 });
    // The old version can no longer be chosen; the new one only after its review.
    const oldV = (await owner().get(`${C()}/documents/${docId}`)).body.versions[1].id;
    expect((await select(measTask, docId, oldV)).body.error.code).toBe('REPORT_NOT_LATEST');
  });

  it('review of the revision, the measurement and the new choice close the task; the basis is version 2', async () => {
    expect((await review(docId, 'verified')).status).toBe(200);
    expect((await select(measTask, docId, await latestVersionId(docId))).body).toMatchObject({ duplicate: false, version: 2 });
    expect((await owner().post(`${C()}/tasks/${measTask}/measurements`, { quantity: 'temperature', value: 3, unit: '°C', measuredAt: new Date().toISOString(), instrumentId: demo.thermometerId })).status).toBe(201);
    // Accepting the delivery is a different step and is not needed here; the report review is.
    expect((await owner().post(`${C()}/tasks/${measTask}/complete`, {})).status).toBe(200);
    const links = (await env.ownerDb.query(`SELECT version_number, status, completion_basis FROM task_report_evidence WHERE task_id = $1 ORDER BY version_number`, [measTask])).rows;
    expect(links).toEqual([{ version_number: 1, status: 'stale', completion_basis: false }, { version_number: 2, status: 'active', completion_basis: true }]);
    expect((await detail(measTask)).reportEvidence.links).toEqual([expect.objectContaining({ version: 2, completionBasis: true })]);
  });
});
