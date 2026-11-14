import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/**
 * GM-30: an expert's report file for a task-linked service becomes a vault document of the business (site, task and
 * request visible), starts "unreviewed", is versioned on revision, is seen only by roles that may read documents, and
 * the task stays open until the file itself is reviewed (accepting the delivery is a different step).
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let pro: { id: string; token: string }, pro2: { id: string; token: string };
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const P1 = () => client(env, pro.token);
const P2 = () => client(env, pro2.token);
const pdf = (seed: string) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(seed)]);
const fileOf = (b: Buffer) => ({ mime: 'application/pdf', sha256: createHash('sha256').update(b).digest('hex'), sizeBytes: b.length });
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const R1 = 'Conta değiştirildi, gaz basıncı normal. Öncesi 9 °C, sonrası 3 °C. Rapor ekte.';
const R2 = 'Conta değiştirildi. Öncesi 9 °C, sonrası 3 °C (30 dk sonra). Kullanılan parça: conta seti. Rapor ekte (revize).';

let taskId: string, reqId: string, jobId: string, docId: string;
const f1 = pdf('rapor-1'), f2 = pdf('rapor-2');

beforeAll(async () => {
  env = await freshEnv();
  const platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  await topUpAllSites(env.db, 7);
  pro = await seedDemoProvider(env.db, platform.marketReviewer.id, 'murat.gm30@ornek.test');
  pro2 = await seedDemoProvider(env.db, platform.marketReviewer.id, 'deniz.gm30@ornek.test');
});
afterAll(async () => { await env?.close(); });

describe('service report file → vault document', () => {
  it('task → service request → quote → accepted → check-in → report with a file: one document waits for review, with site, task and request', async () => {
    const list = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}`)).body as any[];
    taskId = list.filter(t => t.equipment_name).sort((a, b) => a.due_at.localeCompare(b.due_at))[0]!.id;
    reqId = (await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Soğutucu servis', description: 'Görevden açılan servis talebi.', city: 'İstanbul', taskId })).body.id;
    const q = (await P1().post(`/pro/requests/${reqId}/quotes`, { scope: 'Conta değişimi', exclusions: 'Kompresör', priceNet: 1500, vatRate: 20, materials: 'Conta', durationText: '2 saat',
      warrantyText: '3 ay', validUntil: later(48), deliverable: 'Servis raporu (PDF)' })).body.id;
    jobId = (await owner().post(`${C()}/quotes/${q}/accept`)).body.jobId;
    const code = (await owner().get(`${C()}/service-requests/${reqId}`)).body.job.checkin_code;
    await P1().post(`/pro/jobs/${jobId}/check-in`, { code });

    const r = await P1().post(`/pro/jobs/${jobId}/report`, { report: R1, file: fileOf(f1) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ duplicate: false, version: 1 });
    expect(r.body.evidenceId).toBeTruthy();
    docId = r.body.documentId;
    // The expert uploads the bytes; another expert cannot.
    expect((await P2().put(`/pro/jobs/${jobId}/report/${r.body.evidenceId}/content`, f1, 'application/pdf')).status).toBe(404);
    const up = await P1().put(`/pro/jobs/${jobId}/report/${r.body.evidenceId}/content`, f1, 'application/pdf'); if (up.status !== 200) console.log('UP', JSON.stringify(up.body)); expect(up.status).toBe(200);

    const list2 = (await owner().get(`${C()}/documents`)).body as any[];
    const d = list2.find(x => x.id === docId);
    expect(d).toMatchObject({ docType: 'maintenance_report', status: 'unreviewed', pendingReview: true, siteId: demo.siteId, versionCount: 1 });
    expect(d.serviceOrigin).toMatchObject({ requestId: reqId, taskId, siteName: expect.any(String) });
    const detail = (await owner().get(`${C()}/documents/${docId}`)).body;
    expect(detail.origin).toMatchObject({ requestId: reqId, requestTitle: 'Soğutucu servis', taskId, jobStatus: 'report_submitted' });
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0]).toMatchObject({ review_status: 'unreviewed', isLatest: true, file_status: 'stored' });
    // The same detail is reachable from the task, with the same site and request.
    const td = (await owner().get(`${C()}/tasks/${taskId}`)).body;
    expect(td.serviceReports.reports).toHaveLength(1);
    expect(td.serviceReports.reports[0]).toMatchObject({ documentId: docId, requestId: reqId, siteName: detail.origin.siteName });
    expect(td.serviceReports.blocked).toBe(true);
  });

  it('sending the same report again creates no second document or version', async () => {
    const again = await P1().post(`/pro/jobs/${jobId}/report`, { report: R1, file: fileOf(f1) });
    expect(again.body).toMatchObject({ duplicate: true, version: 1, documentId: docId });
    const n = await env.ownerDb.query(`SELECT (SELECT count(*)::int FROM documents WHERE service_job_id = $1) AS docs,
      (SELECT count(*)::int FROM document_versions WHERE document_id = $2) AS versions, (SELECT count(*)::int FROM service_job_reports WHERE job_id = $1) AS reports`, [jobId, docId]);
    expect(n.rows[0]).toEqual({ docs: 1, versions: 1, reports: 1 });
  });

  it('only roles that may read documents see it: staff and the other expert get nothing', async () => {
    expect((await staff().get(`${C()}/documents`)).body.find((x: any) => x.id === docId)).toBeUndefined();
    expect((await staff().get(`${C()}/documents/${docId}`)).status).toBe(404);
    const ev = (await owner().get(`${C()}/documents/${docId}`)).body.versions[0].evidence_id;
    expect((await owner().get(`${C()}/evidence/${ev}/content`)).status).toBe(200);
    expect((await manager().get(`${C()}/evidence/${ev}/content`)).status).toBe(200);
    expect((await staff().get(`${C()}/evidence/${ev}/content`)).status).toBe(404);
    expect((await P2().get(`${C()}/documents`)).status).toBeGreaterThanOrEqual(400);
  });

  it('revision: the first file is marked rejected, the second is the marked latest, both stay in the history', async () => {
    expect((await owner().post(`${C()}/jobs/${jobId}/acceptance`, { accept: false, note: 'Revizyon: sonrası ölçüm süresi raporda yok.' })).body.status).toBe('revision_requested');
    expect((await P1().post(`/pro/jobs/${jobId}/report`, { report: R1, file: fileOf(f1) })).status).toBe(422); // identical revision refused
    const r2 = await P1().post(`/pro/jobs/${jobId}/report`, { report: R2, file: fileOf(f2) });
    expect(r2.body).toMatchObject({ duplicate: false, version: 2, documentId: docId });
    expect((await P1().put(`/pro/jobs/${jobId}/report/${r2.body.evidenceId}/content`, f2, 'application/pdf')).status).toBe(200);
    const d = (await owner().get(`${C()}/documents/${docId}`)).body;
    expect(d.versions.map((v: any) => [v.version, v.review_status, v.isLatest])).toEqual([[2, 'unreviewed', true], [1, 'rejected', false]]);
    expect(d.status).toBe('unreviewed');
    const td = (await owner().get(`${C()}/tasks/${taskId}`)).body.serviceReports.reports[0];
    expect(td.versions.map((v: any) => [v.version, v.reviewStatus, v.isLatest])).toEqual([[2, 'unreviewed', true], [1, 'rejected', false]]);
  });

  it('accepting the delivery leaves the file unreviewed and the task open; verifying the file lifts the block', async () => {
    expect((await owner().post(`${C()}/jobs/${jobId}/acceptance`, { accept: true, note: 'Ölçümleri kontrol ettim.' })).body.status).toBe('accepted');
    const d = (await owner().get(`${C()}/documents/${docId}`)).body;
    expect(d.versions[0]).toMatchObject({ review_status: 'unreviewed', isLatest: true });
    const td = (await owner().get(`${C()}/tasks/${taskId}`)).body;
    expect(td.status).toBe('open');
    expect(td.serviceReports.blocked).toBe(true);
    const done = await owner().post(`${C()}/tasks/${taskId}/complete`, {});
    expect(done.status).toBe(422);
    expect(done.body.error.code).toBe('SERVICE_REPORT_UNVERIFIED');
    // Review by someone other than the uploader (the expert is not in the business, so any reviewer qualifies).
    const rv = await manager().post(`${C()}/documents/${docId}/versions/${d.versions[0].id}/review`, { decision: 'verified', notes: 'Rapor ve ölçümler okundu.' });
    expect(rv.status).toBe(200);
    const after = (await owner().get(`${C()}/tasks/${taskId}`)).body.serviceReports;
    expect(after.blocked).toBe(false);
    expect((await owner().get(`${C()}/documents`)).body.find((x: any) => x.id === docId).status).toBe('internally_reviewed');
    // The gate no longer reports SERVICE_REPORT_UNVERIFIED (other evidence rules still apply).
    const again = await owner().post(`${C()}/tasks/${taskId}/complete`, {});
    expect(again.body?.error?.code).not.toBe('SERVICE_REPORT_UNVERIFIED');
  });
});
