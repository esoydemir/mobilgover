import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureFoodScopeRevision, ensureSectorGateRevisions, ensureSectorRules, seedPlatform } from '../../src/seed/demo';
import { createSession } from '../../src/services/principal';
import { client, fakeJpeg, freshEnv, type Env } from '../support/env';

/**
 * Emlak ofisi: görev yalnız dosya VARLIĞINI teyit eder; sözleşme/yetki belgesinin İÇERİĞİNİ ilgili sürümü görebilen yetkili kişi belge kasasında inceler.
 * Sentetik belge; hiçbir kayıt elle eklenmez. Kural ÖRNEKTİR.
 */
let env: Env; let company: string, site: string, taskId: string, docId: string, versionId: string, evidenceId: string;
let owner: ReturnType<typeof client>, mgr: ReturnType<typeof client>, wrk: ReturnType<typeof client>, mgrId: string, wrkId: string;
const C = () => `/companies/${company}`;
const user = async (name: string) => {
  const id = (await env.ownerDb.query(`INSERT INTO users (display_name, email) VALUES ($1, $2) RETURNING id`, [name, `${name.replace(/\W/g, '').toLowerCase()}@test.invalid`])).rows[0].id as string;
  return { id, token: await env.db.system(tx => createSession(tx, id, 24)) };
};
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('sentetik yetki sozlesmesi')]);
const fileOf = (b: Buffer) => ({ mime: 'application/pdf', sha256: createHash('sha256').update(b).digest('hex'), sizeBytes: b.length });
const task = async (c: ReturnType<typeof client>) => (await c.get(`${C()}/tasks/${taskId}`)).body;

beforeAll(async () => {
  env = await freshEnv(); await seedPlatform(env.db); await ensureSectorRules(env.db); await ensureFoodScopeRevision(env.db);
  expect((await ensureSectorGateRevisions(env.db)).map(m => m.code)).toContain('EX-ESTATE-FILES');
  const o = await user('Emlak Sahibi'); owner = client(env, o.token);
  const r = await owner.post('/companies', { name: 'Güven Emlak', siteName: 'Merkez ofis' }); company = r.body.companyId; site = r.body.siteId;
  await owner.post(`${C()}/activity`, { naceCodes: ['68.31'], confirmed: true });
  await owner.post(`${C()}/profile/facts`, { siteId: site, key: 'activity.client_contracts', value: true, source: 'user_declared', verification: 'user_confirmed' });
  const m = await user('Emlak Yonetici'), w = await user('Emlak Calisan'); mgrId = m.id; wrkId = w.id;
  await owner.post(`${C()}/members`, { email: 'emlakyonetici@test.invalid', role: 'site_manager', siteId: site });
  await owner.post(`${C()}/members`, { email: 'emlakcalisan@test.invalid', role: 'staff', siteId: site });
  mgr = client(env, m.token); wrk = client(env, w.token);
  for (const c of [mgr, wrk]) { const inv = (await c.get('/me/invitations')).body as any[]; await c.post(`/me/invitations/${inv[0].membershipId ?? inv[0].id}/accept`); }
});
afterAll(async () => { await env?.close(); });

describe('GH-12 emlak belgesi: varlık teyidi ≠ içerik incelemesi', () => {
  it('görev v2: yalnız VARLIK teyidi ister; içerik iddiası (imza, süre) çalışandan istenmez', async () => {
    taskId = ((await mgr.get(`${C()}/tasks?siteId=${site}&status=open`)).body as any[]).find(t => /Sözleşme ve yetki/.test(t.title)).id;
    const t = await task(mgr);
    expect(t.basis ?? t.why ?? {}).toBeDefined();
    const items = (t.requirements as any[]).find(r => r.kind === 'checklist').items.map((i: any) => i.id);
    expect(items).toEqual(['files_present', 'missing_noted']);
    expect(t.instructions).toMatch(/içeriğini incelemez/); expect(t.instructions).toMatch(/yetkili yönetici/);
    expect((await env.ownerDb.query(`SELECT rv.version FROM tasks x JOIN task_templates tt ON tt.id = x.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id WHERE x.id = $1`, [taskId])).rows[0].version).toBe(2);
  });

  it('sahip belgeyi oluşturup göreve bağlar ve dosyayı yükler; çalışan belgeyi GÖRMEZ, yalnız varlığını ve sonraki adımı öğrenir', async () => {
    docId = (await owner.post(`${C()}/documents`, { docType: 'contract', title: 'Mülk sahibi yetki sözleşmesi (sentetik)', siteId: site })).body.id;
    expect((await owner.post(`${C()}/documents/${docId}/uses`, { op: 'add', kind: 'task_template', ref: 'estate_file_check', purpose: 'Aylık dosya kontrolünde içeriği incelenecek sözleşme' })).status).toBe(201);
    const up = await owner.post(`${C()}/documents/${docId}/versions`, { validFrom: null, validUntil: null, file: fileOf(pdf) });
    versionId = up.body.versionId; evidenceId = up.body.evidenceId;
    expect((await owner.put(`${C()}/evidence/${evidenceId}/content`, pdf, 'application/pdf')).status).toBe(200);
    expect((await mgr.post(`${C()}/tasks/${taskId}/assign`, { userId: wrkId })).status).toBe(200);
    const asWorker = await task(wrk);
    expect(asWorker.relatedDocuments).toEqual([]); expect(asWorker.relatedDocumentsHidden).toBe(1); expect(asWorker.documentHistory).toEqual([]);
    expect((await wrk.get(`${C()}/documents/${docId}`)).status).toBe(404);
  });

  it('yetkili yönetici aynı görevde belgeyi, dosya durumunu ve "içerik incelenmedi" bilgisini görür; yükleyen sahip inceleyemez ve nedenini görür', async () => {
    const d = (await task(mgr)).relatedDocuments[0];
    expect(d).toMatchObject({ id: docId, canReview: true, latest: { version: 1, file: 'stored', review: 'unreviewed' } });
    const o = (await task(owner)).relatedDocuments[0];
    expect(o).toMatchObject({ canReview: false, reviewBlockedReason: 'uploader', latest: { review: 'unreviewed' } });
  });

  it('içerik incelemesi: çalışan kaydedemez (belgeyi göremez), yükleyen kaydedemez, yetkili yönetici kaydeder; yalnız bir kez', async () => {
    const R = `${C()}/documents/${docId}/versions/${versionId}/review`;
    expect((await wrk.post(R, { decision: 'verified', notes: 'Okudum, uygun.' })).status).toBe(404);
    const own = await owner.post(R, { decision: 'verified', notes: 'Okudum, uygun.' });
    expect(own.status).toBe(422); expect(own.body.error.code).toBe('REVIEWER_IS_UPLOADER');
    expect((await mgr.post(R, { decision: 'verified', notes: 'İmzalar ve yetki süresi sözleşmede doğru.', validFrom: '2026-01-01', validUntil: '2027-01-01' })).status).toBe(200);
    expect((await mgr.post(R, { decision: 'verified', notes: 'Tekrar.' })).body.error.code).toBe('ALREADY_REVIEWED');
  });

  it('çalışan varlık teyidini kendi hesabıyla yapar ve tamamlar; kanıtlar yalnız varlık teyidi + fotoğraf', async () => {
    const w = (await task(wrk)).requirements as any[];
    expect(w.map(r => r.kind).sort()).toEqual(['checklist', 'photo']);
    const base = `${C()}/tasks/${taskId}`;
    expect((await wrk.post(`${base}/evidence`, { kind: 'checklist', answers: { files_present: 'pass', missing_noted: 'pass' } })).status).toBe(201);
    const ph = fakeJpeg('emlak-eksik-dosya'); const e = await wrk.post(`${base}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: createHash('sha256').update(ph).digest('hex'), sizeBytes: ph.length });
    expect((await wrk.put(`${C()}/evidence/${e.body.id}/content`, ph, 'image/jpeg')).status).toBe(200);
    expect((await wrk.post(`${base}/complete`)).status).toBe(200);
  });

  it('görev geçmişi: kim, hangi sürüm için, hangi işlemi yaptı — yetkili görür, çalışan görmez', async () => {
    const h = (await task(mgr)).documentHistory as any[];
    const line = (a: string) => h.find(x => x.action.includes(a));
    expect(line('dosya yükledi')).toMatchObject({ actor: 'Emlak Sahibi', version: 1 });
    expect(line('içeriği inceledi: uygun')).toMatchObject({ actor: 'Emlak Yonetici', version: 1 });
    expect(line('bu kontrole bağladı')).toMatchObject({ actor: 'Emlak Sahibi' });
    const d = (await task(mgr)).relatedDocuments[0];
    expect(d.latest).toMatchObject({ review: 'verified', reviewedBy: 'Emlak Yonetici' });
    expect((await task(wrk)).documentHistory).toEqual([]);
  });
});
