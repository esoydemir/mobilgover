import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureReportRules, seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Report ties made before the relation was recorded (migration 028 labelled all of them "direct"). Migration 029 keeps the closure, the file digest, the person and
 * the time, and gives each tie the label the record ids can support: direct (request or case tied to the task), sole (the report's case was the only case of that
 * equipment in the 90 days before the choice), legacy (not provable). The audit file says so in plain words.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let pro: { id: string; token: string };
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const P1 = () => client(env, pro.token);
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

beforeAll(async () => {
  env = await freshEnv();
  const platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  await ensureReportRules(env.db);
  await topUpAllSites(env.db, 45);
  pro = await seedDemoProvider(env.db, platform.marketReviewer.id, 'murat.eski@ornek.test');
});
afterAll(async () => { await env?.close(); });

async function caseWithReport(equipmentId: string, title: string, taskId: string | null = null) {
  const ncr = (await manager().post(`${C()}/nonconformities`, { siteId: demo.siteId, title, description: 'Test kaydı.', hazardType: 'cold_chain_temperature', severity: 'major', equipmentId, containment: 'Ürün taşındı.' })).body.id as string;
  const reqId = (await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: `${title} servisi`, description: 'Servis.', city: 'İstanbul', ncrId: ncr, taskId })).body.id;
  const q = (await P1().post(`/pro/requests/${reqId}/quotes`, { scope: 'Servis', exclusions: 'Kompresör', priceNet: 1500, vatRate: 20, materials: 'Parça', durationText: '2 saat', warrantyText: '3 ay', validUntil: later(48), deliverable: 'Servis raporu (PDF)' })).body.id;
  const jobId = (await owner().post(`${C()}/quotes/${q}/accept`)).body.jobId;
  await P1().post(`/pro/jobs/${jobId}/check-in`, { code: (await owner().get(`${C()}/service-requests/${reqId}`)).body.job.checkin_code });
  const f = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(`rapor-${jobId}`)]);
  const r = await P1().post(`/pro/jobs/${jobId}/report`, { report: `${title}: servis yapıldı.`, file: { mime: 'application/pdf', sha256: createHash('sha256').update(f).digest('hex'), sizeBytes: f.length } });
  await P1().put(`/pro/jobs/${jobId}/report/${r.body.evidenceId}/content`, f, 'application/pdf');
  const vid = (await owner().get(`${C()}/documents/${r.body.documentId}`)).body.versions[0].id as string;
  return { ncr, documentId: r.body.documentId as string, versionId: vid };
}
const oldTie = async (taskId: string, rep: { documentId: string; versionId: string }) => (await env.ownerDb.query(
  `INSERT INTO task_report_evidence (company_id, task_id, document_id, document_version_id, version_number, file_sha256, selected_by, completion_basis, relation)
   VALUES ($1,$2,$3,$4,1,'abc',$5,true,'direct') RETURNING id`, [demo.companyId, taskId, rep.documentId, rep.versionId, demo.users.manager.id])).rows[0].id as string;
const relabel = async () => {
  const sql = readFileSync(new URL('../../migrations/029_service_case_links.sql', import.meta.url), 'utf8');
  const a = sql.indexOf('UPDATE task_report_evidence l SET relation = CASE'); const b = sql.indexOf('WHERE l.id = x.id;', a) + 'WHERE l.id = x.id;'.length;
  await env.ownerDb.query(sql.slice(a, b));
};

describe('older report ties get the label their records support', () => {
  it('ambiguous (two cases) → legacy; the only case → sole; request tied to the task → direct; everything else kept', async () => {
    const tasks = (await env.ownerDb.query(`SELECT t.id FROM tasks t JOIN task_templates tt ON tt.id = t.template_id WHERE t.company_id = $1 AND tt.title = 'Servis sonrası sıcaklık doğrulaması' AND t.status = 'open' ORDER BY t.due_at`, [demo.companyId])).rows.map(r => r.id as string);
    const t1 = tasks[0]!;
    // Two cases on the fridge → a report chosen from one of them is not provable.
    const a = await caseWithReport(demo.fridgeId, 'Kapı contası');
    await caseWithReport(demo.fridgeId, 'Termostat');
    const ambiguous = await oldTie(t1, a);
    // Another equipment with a single case → sole.
    const eq2 = (await owner().post(`${C()}/equipment`, { siteId: demo.siteId, type: 'refrigerator', name: 'Tek vakalı buzdolabı' })).body.id as string;
    const s = await caseWithReport(eq2, 'Tek vaka');
    const t2 = (await env.ownerDb.query(`SELECT t.id FROM tasks t JOIN task_templates tt ON tt.id = t.template_id WHERE t.equipment_id = $1 AND tt.title = 'Servis sonrası sıcaklık doğrulaması' LIMIT 1`, [eq2])).rows[0].id as string;
    const sole = await oldTie(t2, s);
    // A request opened from the task itself → direct.
    const d = await caseWithReport(demo.fridgeId, 'Görevden açılan', tasks[1] ?? t1);
    const direct = await oldTie(tasks[1] ?? t1, d);
    const before = (await env.ownerDb.query(`SELECT id, version_number, file_sha256, selected_by, selected_at, completion_basis FROM task_report_evidence WHERE id = ANY($1) ORDER BY id`, [[ambiguous, sole, direct]])).rows;
    await relabel();
    const rows = (await env.ownerDb.query(`SELECT id, relation, case_id, version_number, file_sha256, selected_by, selected_at, completion_basis FROM task_report_evidence WHERE id = ANY($1) ORDER BY id`, [[ambiguous, sole, direct]])).rows;
    const by = (id: string) => rows.find(r => r.id === id)!;
    expect(by(ambiguous)).toMatchObject({ relation: 'legacy', case_id: a.ncr });
    expect(by(sole)).toMatchObject({ relation: 'sole', case_id: s.ncr });
    expect(by(direct).relation).toBe('direct');
    // The closure, the digest, the person and the time are untouched.
    for (const r of before) expect(rows.find(x => x.id === r.id)).toMatchObject({ version_number: r.version_number, file_sha256: r.file_sha256, selected_by: r.selected_by, selected_at: r.selected_at, completion_basis: r.completion_basis });
    // The task screen says so for the ambiguous one.
    await env.ownerDb.query(`UPDATE tasks SET status = 'done', outcome = 'conforming', completed_by = $2, completed_at = now() WHERE id = $1`, [t1, demo.users.manager.id]);
    const links = (await owner().get(`${C()}/tasks/${t1}`)).body.reportEvidence.links as any[];
    expect(links.find(l => l.id === ambiguous)).toMatchObject({ relation: 'legacy', caseTitle: 'Kapı contası' });
    // …and the audit file carries the same words.
    const from = new Date(Date.now() - 864e5).toISOString(), to = new Date(Date.now() + 864e5).toISOString();
    const rep = (await owner().get(`${C()}/audit-report?siteId=${demo.siteId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=json`)).body;
    expect(JSON.stringify(rep)).toContain('"relation":"legacy"');
  });
});
