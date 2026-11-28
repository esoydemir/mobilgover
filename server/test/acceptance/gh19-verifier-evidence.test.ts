import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { createSession } from '../../src/services/principal';
import { topUpAllSites } from '../../src/services/horizon';
import { client, fakeJpeg, freshEnv, type Env } from '../support/env';

/**
 * GH-19: the person who verifies a closure must see what the case rests on: the first measurement with its note and photo,
 * and each version of the service report. An outside verifier gets exactly that, through the one case they were invited to,
 * and nothing else of the vault or the tasks.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let pro: { id: string; token: string };
let ex: ReturnType<typeof client>;
let ncr: string, taskId: string, photoId: string, otherPhotoId: string, reportEvidenceId: string, otherDocEvidenceId: string;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const staff = () => client(env, demo.users.staff.token);
const manager = () => client(env, demo.users.manager.token);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const pdf = (seed: string) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(seed)]);
const fileOf = (b: Buffer) => ({ mime: 'application/pdf', sha256: sha(b), sizeBytes: b.length });
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

/** The staff member measures out of limit on a cold task, adds a note and a photo, and completes it. */
async function coldCheck(id: string, seed: string, value: number) {
  expect((await owner().post(`${C()}/tasks/${id}/assign`, { userId: demo.users.staff.id })).status).toBe(200);
  expect((await staff().post(`${C()}/tasks/${id}/measurements`, { quantity: 'temperature', value, unit: '°C', measuredAt: new Date(Date.now() - 60_000).toISOString() })).status).toBe(201);
  const photo = fakeJpeg(seed);
  const reg = await staff().post(`${C()}/tasks/${id}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: sha(photo), sizeBytes: photo.length });
  expect((await staff().put(`${C()}/evidence/${reg.body.id}/content`, photo, 'image/jpeg')).body.status).toBe('stored');
  await staff().post(`${C()}/tasks/${id}/evidence`, { kind: 'note', text: `Termometre notu ${seed}` });
  expect((await staff().post(`${C()}/tasks/${id}/complete`)).status).toBe(200);
  return reg.body.id as string;
}

beforeAll(async () => {
  env = await freshEnv();
  const platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  await topUpAllSites(env.db, 7);
  pro = await seedDemoProvider(env.db, platform.marketReviewer.id, 'murat.gh19@ornek.test');
  const cold = ((await owner().get(`${C()}/tasks?siteId=${demo.siteId}&status=open`)).body as any[]).filter(t => t.title === 'Soğutucu sıcaklık kontrolü').sort((a, b) => a.due_at.localeCompare(b.due_at));
  taskId = cold[0].id;
  photoId = await coldCheck(taskId, 'vaka-foto', 9);
  otherPhotoId = await coldCheck(cold[1].id, 'baska-foto', 3);
  ncr = (await env.ownerDb.query(`SELECT id FROM nonconformities WHERE task_id = $1`, [taskId])).rows[0].id;

  const reqId = (await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Soğutucu servis', description: 'Vakadan açılan servis talebi.', city: 'İstanbul', ncrId: ncr })).body.id;
  const P = client(env, pro.token);
  const q = (await P.post(`/pro/requests/${reqId}/quotes`, { scope: 'Conta değişimi', exclusions: 'Kompresör', priceNet: 1500, vatRate: 20, materials: 'Conta', durationText: '2 saat', warrantyText: '3 ay', validUntil: later(48), deliverable: 'Servis raporu (PDF)' })).body.id;
  const jobId = (await owner().post(`${C()}/quotes/${q}/accept`)).body.jobId;
  const code = (await owner().get(`${C()}/service-requests/${reqId}`)).body.job.checkin_code;
  await P.post(`/pro/jobs/${jobId}/check-in`, { code });
  const f = pdf('rapor-vaka');
  const r = await P.post(`/pro/jobs/${jobId}/report`, { report: 'Conta değiştirildi. Öncesi 9 °C, sonrası 3 °C.', file: fileOf(f) });
  reportEvidenceId = r.body.evidenceId;
  expect((await P.put(`/pro/jobs/${jobId}/report/${reportEvidenceId}/content`, f, 'application/pdf')).status).toBe(200);

  const doc = (await owner().post(`${C()}/documents`, { docType: 'signature_circular', title: 'Kasadaki başka belge' })).body.id;
  const g = pdf('baska-belge');
  const v = await owner().post(`${C()}/documents/${doc}/versions`, { endKind: 'unknown', file: fileOf(g) });
  otherDocEvidenceId = (await owner().get(`${C()}/documents/${doc}`)).body.versions[0]?.evidence_id;
  expect(v.status).toBe(201);
  if (otherDocEvidenceId) await owner().put(`${C()}/evidence/${otherDocEvidenceId}/content`, g, 'application/pdf');

  expect((await owner().post(`${C()}/verifiers`, { email: 'dis.gh19@ornek.test', siteId: demo.siteId, ncrIds: [ncr], days: 30, note: 'Bağımsız doğrulama için.' })).status).toBe(201);
  ex = await env.db.system(async tx => { const id = (await tx.query(`SELECT id FROM users WHERE email = 'dis.gh19@ornek.test'`)).rows[0].id; return client(env, await createSession(tx, id)); });
});
afterAll(async () => { await env?.close(); });

describe('GH-19 evidence a verifier needs', () => {
  it('the case shows the first measurement, note, photo and the report versions to the invited verifier and to the manager', async () => {
    for (const who of [ex, manager()]) {
      const d = (await who.get(`${C()}/nonconformities/${ncr}`)).body;
      expect(d.proof.task.completedBy).toBeTruthy();
      expect(d.proof.task.measurements).toEqual([expect.objectContaining({ unit: '°C', withinLimit: false })]);
      expect(Number(d.proof.task.measurements[0].value)).toBe(9);
      expect(d.proof.task.notes).toEqual(['Termometre notu vaka-foto']);
      expect(d.proof.task.files).toEqual([expect.objectContaining({ evidenceId: photoId, kind: 'photo' })]);
      expect(d.proof.reports).toEqual([expect.objectContaining({ title: 'Soğutucu servis', version: 1, evidenceId: reportEvidenceId, report: expect.stringContaining('sonrası 3 °C') })]);
    }
  });

  it('the verifier opens exactly those files; another task photo, another document and the vault stay closed', async () => {
    expect((await ex.get(`${C()}/evidence/${photoId}/content`)).status).toBe(200);
    expect((await ex.get(`${C()}/evidence/${reportEvidenceId}/content`)).status).toBe(200);
    expect((await ex.get(`${C()}/evidence/${otherPhotoId}/content`)).status).toBe(404);
    expect(otherDocEvidenceId).toBeTruthy();
    expect((await ex.get(`${C()}/evidence/${otherDocEvidenceId}/content`)).status).toBe(404);
    expect((await ex.get(`${C()}/documents`)).body).toEqual([]);
    expect((await ex.get(`${C()}/tasks`)).body).toEqual([]);
  });

  it('after the invitation is revoked the files close again', async () => {
    const g = ((await owner().get(`${C()}/verifiers`)).body as any[]).find(x => x.email === 'dis.gh19@ornek.test');
    expect((await owner().post(`${C()}/verifiers/${g.id}/revoke`, {})).status).toBe(200);
    expect((await ex.get(`${C()}/evidence/${photoId}/content`)).status).toBeGreaterThanOrEqual(403);
    expect((await ex.get(`${C()}/evidence/${reportEvidenceId}/content`)).status).toBeGreaterThanOrEqual(403);
  });
});
