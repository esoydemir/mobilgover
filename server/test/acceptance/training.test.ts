import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { createSession } from '../../src/services/principal';
import { client, fakeJpeg, freshEnv, type Env } from '../support/env';

/**
 * Delivery 5A: outside verifier limited to selected cases; issuer-check attribution; training
 * content lifecycle (separate authoring and publishing), assignment, read / completed / passed /
 * effective-in-the-field as separate facts, and the end-to-end path from a knowledge gap in a case
 * to field verification. Training never closes a case. Real HTTP + PostgreSQL.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const sessionFor = async (email: string) => env.db.system(async tx => {
  const u = (await tx.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id as string;
  return { id: u, token: await createSession(tx, u) };
});
const notes = async (userId: string, kind: string) => (await env.ownerDb.query(`SELECT entity_id FROM notifications WHERE user_id = $1 AND kind = $2`, [userId, kind])).rows;
async function openCase(title: string, severity = 'major') {
  const r = await manager().post(`${C()}/nonconformities`, { siteId: demo.siteId, title, description: 'Test kaydı açıklaması.', hazardType: 'cold_chain_temperature', severity, containment: 'Ürünler taşındı.' });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
});
afterAll(async () => { await env?.close(); });

describe('outside verifier limited to selected cases', () => {
  it('sees and verifies only the chosen case and its evidence; expiry is enforced by the server', async () => {
    const a = await openCase('Kayıt A: kapı contası');
    const b = await openCase('Kayıt B: başka konu');
    // Evidence on both cases.
    const addPhoto = async (ncr: string) => {
      const act = (await manager().post(`${C()}/nonconformities/${ncr}/actions`, { kind: 'correction', description: 'Düzelt.', evidenceRequired: 'photo' })).body.id;
      const img = fakeJpeg(ncr);
      const ev = await manager().post(`${C()}/nonconformities/${ncr}/actions/${act}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: createHash('sha256').update(img).digest('hex'), sizeBytes: img.length });
      await manager().put(`${C()}/evidence/${ev.body.id}/content`, img, 'image/jpeg');
      await manager().post(`${C()}/nonconformities/${ncr}/actions/${act}`, { op: 'done', notes: 'Yapıldı.' });
      return { act, ev: ev.body.id as string };
    };
    const ea = await addPhoto(a), eb = await addPhoto(b);
    expect((await owner().post(`${C()}/verifiers`, { email: 'kayit.dogrulayici@ornek.test', days: 7, note: 'Yalnız A kaydı için', ncrIds: [a], documents: true })).status).toBe(422);
    const inv = await owner().post(`${C()}/verifiers`, { email: 'kayit.dogrulayici@ornek.test', days: 7, note: 'Yalnız A kaydı için', ncrIds: [a] });
    expect(inv.status).toBe(201);
    const v = await sessionFor('kayit.dogrulayici@ornek.test');
    const vc = client(env, v.token);
    expect((await vc.get(`${C()}/nonconformities/${a}`)).status).toBe(200);
    expect((await vc.get(`${C()}/nonconformities/${b}`)).status).toBe(404);
    expect((await vc.get(`${C()}/nonconformities`)).body.map((x: any) => x.id)).toEqual([a]);
    expect((await vc.get(`${C()}/verification-queue`)).body.map((x: any) => x.ncrId)).toEqual([a]);
    const file = (ev: string) => env.app.inject({ method: 'GET', url: `${C()}/evidence/${ev}/content`, headers: { authorization: `Bearer ${v.token}` } });
    expect((await file(ea.ev)).statusCode).toBe(200);
    expect((await file(eb.ev)).statusCode).toBe(404);
    expect((await vc.get(`${C()}/documents`)).body).toEqual([]);
    expect((await vc.post(`${C()}/nonconformities/${b}/actions/${eb.act}`, { op: 'verify', result: 'accepted', notes: 'Denedim.' })).status).toBe(404);
    expect((await vc.post(`${C()}/nonconformities/${a}/actions/${ea.act}`, { op: 'verify', result: 'accepted', notes: 'Fotoğrafı inceledim.' })).status).toBe(200);
    const list = (await owner().get(`${C()}/verifiers`)).body.find((g: any) => g.user_id === v.id);
    expect(list.ncrs).toEqual([{ id: a, title: 'Kayıt A: kapı contası' }]);
    // Expiry is checked on every request by the server, not by the app.
    await env.ownerDb.query(`UPDATE access_grants SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [v.id]);
    expect((await vc.get(`${C()}/nonconformities/${a}`)).status).toBe(404);
    expect((await file(ea.ev)).statusCode).toBe(404);
  });
});

describe('issuer check is shown with who recorded it, how and the reference', () => {
  it('the document carries the recorder, method and reference; the app did not query anything', async () => {
    const d = (await owner().post(`${C()}/documents`, { docType: 'business_license', title: 'Ruhsat', siteId: demo.siteId })).body.id;
    const pdf = Buffer.from('%PDF-1.4\nruhsat\n');
    const v = (await owner().post(`${C()}/documents/${d}/versions`, { validFrom: null, validUntil: null, file: { mime: 'application/pdf', sha256: createHash('sha256').update(pdf).digest('hex'), sizeBytes: pdf.length } })).body;
    await owner().put(`${C()}/evidence/${v.evidenceId}/content`, pdf, 'application/pdf');
    await manager().post(`${C()}/documents/${d}/versions/${v.versionId}/review`, { decision: 'verified', notes: 'Aslıyla karşılaştırıldı.' });
    await manager().post(`${C()}/documents/${d}/versions/${v.versionId}/issuer-check`, { method: 'issuer_portal', reference: 'Belediye e-sorgu 2026/123' });
    const doc = (await owner().get(`${C()}/documents/${d}`)).body;
    expect(doc.status).toBe('issuer_verified');
    expect(doc.issuerCheck).toMatchObject({ recordedBy: 'Selin (şube yöneticisi)', method: 'issuer_portal', reference: 'Belediye e-sorgu 2026/123', queriedByApp: false });
    expect((await owner().get(`${C()}/documents`)).body.find((x: any) => x.id === d).issuerCheck.recordedBy).toBe('Selin (şube yöneticisi)');
  });
});

describe('training content: versions, separate authoring and publishing, example labels', () => {
  let course: string, v1: string;
  const quiz = [{ q: 'Conta yırtıksa?', options: ['Bildiririm', 'Görmezden gelirim'], answer: 0 }, { q: 'Ne ile ölçülür?', options: ['Kalibre termometre', 'El'], answer: 0 }];

  it('example courses are labelled; learners see published content without answers', async () => {
    const list = (await staff().get(`${C()}/training/courses`)).body;
    const ex = list.find((c: any) => c.is_example);
    expect(ex.exampleNote).toContain('ÖRNEK');
    const detail = (await staff().get(`${C()}/training/courses/${ex.id}`)).body;
    expect(detail.versions[0].quiz[0].answer).toBeUndefined();
    expect(detail.permissions).toMatchObject({ author: false, publish: false });
  });

  it('a site manager drafts and submits; cannot publish; the owner publishes; staff cannot write', async () => {
    expect((await staff().post(`${C()}/training/courses`, { title: 'Personel', body: 'x' })).status).toBe(403);
    const r = await manager().post(`${C()}/training/courses`, { title: 'Kapı contası kontrolü', summary: 'Haftalık conta kontrolü', minutes: 5,
      body: 'Contayı haftada bir kontrol et. Yırtık ya da boşluk varsa yöneticine bildir ve kapıyı kapalı tut.', quiz, passScore: 100,
      links: [{ kind: 'hazard', ref: 'cold_chain_temperature' }, { kind: 'task_template', ref: 'fridge_temp' }] });
    expect(r.status).toBe(201);
    ({ id: course, versionId: v1 } = r.body);
    expect((await staff().get(`${C()}/training/courses`)).body.some((c: any) => c.id === course)).toBe(false); // draft hidden
    expect((await manager().post(`${C()}/training/versions/${v1}/publish`, {})).status).toBe(403);
    expect((await manager().post(`${C()}/training/versions/${v1}/submit`, {})).status).toBe(200);
    expect((await manager().post(`${C()}/training/versions/${v1}`, { title: 'Değiştir', body: 'yeni metin yeni metin yeni metin' })).body.error.code).toBe('NOT_DRAFT');
    expect((await owner().post(`${C()}/training/versions/${v1}/reject`, { notes: 'kı' })).status).toBe(422);
    expect((await owner().post(`${C()}/training/versions/${v1}/publish`, { notes: 'Uygun.' })).status).toBe(200);
    const d = (await staff().get(`${C()}/training/courses/${course}`)).body;
    expect(d.versions.map((v: any) => v.status)).toEqual(['published']);
    expect((await notes(demo.users.owner.id, 'training_review_requested')).length).toBe(1);
  });

  it('a new version is a draft until published; the previous one is archived, not deleted', async () => {
    const nv = await manager().post(`${C()}/training/courses/${course}/new-version`, {});
    expect(nv.status).toBe(201);
    expect((await manager().post(`${C()}/training/courses/${course}/new-version`, {})).body.error.code).toBe('DRAFT_EXISTS');
    await manager().post(`${C()}/training/versions/${nv.body.versionId}/submit`, {});
    // When someone else can publish, the author cannot publish their own version.
    const hq = await env.db.system(async tx => {
      const u = (await tx.query(`INSERT INTO users (display_name, email) VALUES ('Deniz (merkez)', 'deniz.egitim@ornek.test') RETURNING id`)).rows[0].id;
      await tx.query(`INSERT INTO memberships (user_id, company_id, site_id, role, status, activated_at) VALUES ($1,$2,NULL,'hq_manager','active',now())`, [u, demo.companyId]);
      return { id: u as string, token: await createSession(tx, u) };
    });
    const own = await owner().post(`${C()}/training/courses`, { title: 'Sahibin içeriği', body: 'Sahibin yazdığı kısa içerik metni burada.' });
    await owner().post(`${C()}/training/versions/${own.body.versionId}/submit`, {});
    expect((await owner().post(`${C()}/training/versions/${own.body.versionId}/publish`, {})).body.error.code).toBe('PUBLISHER_IS_AUTHOR');
    expect((await client(env, hq.token).post(`${C()}/training/versions/${own.body.versionId}/publish`, {})).status).toBe(200);
    expect((await client(env, hq.token).post(`${C()}/training/versions/${nv.body.versionId}/publish`, {})).status).toBe(200);
    const d = (await owner().get(`${C()}/training/courses/${course}`)).body;
    expect(d.versions.map((v: any) => [v.version, v.status])).toEqual([[2, 'published'], [1, 'archived']]);
  });
});

describe('end to end: knowledge gap → training → field application → field effectiveness; the case stays open', () => {
  let ncr: string, assignment: string, action: string, courseId: string;

  it('a case with a knowledge cause suggests training and lists related courses', async () => {
    ncr = await openCase('Personel kapıyı açık bırakıyor');
    await manager().post(`${C()}/nonconformities/${ncr}/assignment`, { ownerId: demo.users.staff.id, dueAt: later(48) });
    await manager().post(`${C()}/nonconformities/${ncr}/causes`, { stage: 'initial', categories: ['knowledge'], notes: 'Personel kapının kontrol edileceğini bilmiyordu.' });
    const d = (await manager().get(`${C()}/nonconformities/${ncr}`)).body;
    expect(d.suggestions.find((s: any) => s.kind === 'training')).toMatchObject({ available: true });
    expect(d.relatedTraining.length).toBeGreaterThan(0);
    courseId = d.relatedTraining.find((c: any) => c.title === 'Kapı contası kontrolü').id;
  });

  it('the manager assigns the training for the case; the learner is told once', async () => {
    expect((await staff().post(`${C()}/training/assignments`, { courseId, userId: demo.users.staff.id, siteId: demo.siteId, reason: 'Kendime' })).status).toBe(403);
    const r = await manager().post(`${C()}/training/assignments`, { courseId, userId: demo.users.staff.id, siteId: demo.siteId, dueAt: later(24),
      reason: 'Uygunsuzlukta bilgi eksikliği: kapı kontrolü bilinmiyordu.', ncrId: ncr });
    expect(r.status).toBe(201);
    assignment = r.body.id;
    expect((await manager().post(`${C()}/training/assignments`, { courseId, userId: demo.users.staff.id, siteId: demo.siteId, reason: 'Tekrar atama', ncrId: ncr })).body.error.code).toBe('ALREADY_ASSIGNED');
    expect((await notes(demo.users.staff.id, 'training_assigned')).length).toBe(1);
  });

  it('read, completed and passed are separate; answers are never sent to the learner', async () => {
    const A = `${C()}/training/assignments/${assignment}`;
    let a = (await staff().get(A)).body;
    expect(a.quiz.every((q: any) => q.answer === undefined)).toBe(true);
    expect(a.participationNote).toContain('resmî sertifika');
    expect(a.state).toMatchObject({ read: false, completed: false, passed: false, fieldVerified: null });
    expect((await staff().post(`${A}/complete`, {})).body.error.code).toBe('NOT_READ');
    expect((await staff().post(`${A}/attempt`, { answers: [0, 0] })).body.error.code).toBe('NOT_READ');
    expect((await manager().post(`${A}/read`, {})).status).toBe(403);
    await staff().post(`${A}/read`, {});
    const wrong = (await staff().post(`${A}/attempt`, { answers: [1, 0] })).body;
    expect(wrong).toMatchObject({ score: 50, passed: false, wrong: [0] });
    expect((await staff().post(`${A}/attempt`, { answers: [0, 0] })).body).toMatchObject({ score: 100, passed: true });
    a = (await staff().get(A)).body;
    expect(a.state).toMatchObject({ read: true, completed: false, passed: true });
    // Not completed yet: the field check cannot start.
    expect((await manager().post(`${A}/field-verify`, { result: 'effective', notes: 'Sahada gördüm, kapı kapalı.' })).body.error.code).toBe('NOT_COMPLETED');
    await staff().post(`${A}/complete`, {});
    expect((await notes(demo.users.manager.id, 'training_completed')).length).toBe(1);
    expect((await manager().get(`${C()}/nonconformities/${ncr}`)).body.status).toBe('open');
  });

  it('application in the field is evidenced by the learner\'s own action; someone else confirms effectiveness', async () => {
    const N = `${C()}/nonconformities/${ncr}`;
    action = (await manager().post(`${N}/actions`, { kind: 'correction', description: 'Kapı kontrolünü açılışta uygula.', ownerId: demo.users.staff.id, evidenceRequired: 'photo' })).body.id;
    const img = fakeJpeg('kapi-kapali');
    const ev = await staff().post(`${N}/actions/${action}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: createHash('sha256').update(img).digest('hex'), sizeBytes: img.length });
    await staff().put(`${C()}/evidence/${ev.body.id}/content`, img, 'image/jpeg');
    await staff().post(`${N}/actions/${action}`, { op: 'done', notes: 'Açılışta kapıyı kontrol ettim, kapalı.' });
    const A = `${C()}/training/assignments/${assignment}`;
    expect((await staff().post(`${A}/field-verify`, { result: 'effective', notes: 'Kendim kontrol ettim, iyi.' })).body.error.code).toBe('VERIFIER_IS_LEARNER');
    const other = (await manager().post(`${N}/actions`, { kind: 'follow_up', description: 'Müdürün işi.' })).body.id;
    expect((await manager().post(`${A}/field-verify`, { result: 'effective', notes: 'Sahada gördüm, kapı kapalı.', actionId: other })).status).toBe(422);
    const a = (await manager().get(A)).body;
    expect(a.fieldActions.map((x: any) => x.id)).toEqual([action]);
    expect((await manager().post(`${A}/field-verify`, { result: 'effective', notes: 'Üç açılışta kapıyı kapalı ve contayı kontrol edilmiş gördüm.', actionId: action })).status).toBe(200);
    const after = (await staff().get(A)).body;
    expect(after.state).toMatchObject({ read: true, completed: true, passed: true, fieldVerified: 'effective' });
    expect((await notes(demo.users.staff.id, 'training_field_verified')).length).toBe(1);
    // The case is still open: its own action verification, effectiveness check and closure remain.
    const d = (await manager().get(N)).body;
    expect(d.status).toBe('open');
    expect(d.trainings[0].state.fieldVerified).toBe('effective');
    expect(d.history.map((h: any) => h.event_type)).toEqual(expect.arrayContaining(['nonconformity.training_assigned', 'nonconformity.training_field_verified']));
    // A new assignment of the same course is possible again after the field check.
    expect((await manager().post(`${C()}/training/assignments`, { courseId, userId: demo.users.staff.id, siteId: demo.siteId, reason: 'Yenileme eğitimi', ncrId: ncr })).status).toBe(201);
  });
});
