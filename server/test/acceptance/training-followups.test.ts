import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { scanDeadlines } from '../../src/services/notifications';
import { client, freshEnv, type Env } from '../support/env';

/** Delivery 5B training follow-ups: in-house label, related training on a check, due reminders, "not effective" → retraining. */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const notes = async (userId: string, kind: string) => (await env.ownerDb.query(`SELECT entity_id FROM notifications WHERE user_id = $1 AND kind = $2`, [userId, kind])).rows;

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  await topUpAllSites(env.db, 2);
});
afterAll(async () => { await env?.close(); });

describe('training follow-ups', () => {
  let course: string;
  it('content a single manager published alone is labelled "no independent review"; it stays in the business', async () => {
    const c = await owner().post(`${C()}/training/courses`, { title: 'Açılış kontrolü', body: 'Açılışta kapıları ve sıcaklıkları kontrol et, sapmayı bildir.',
      quiz: [{ q: 'Sapma görürsen?', options: ['Bildiririm', 'Beklerim'], answer: 0 }], passScore: 100, links: [{ kind: 'task_template', ref: 'fridge_temp' }] });
    course = c.body.id;
    await owner().post(`${C()}/training/versions/${c.body.versionId}/submit`, {});
    expect((await owner().post(`${C()}/training/versions/${c.body.versionId}/publish`, {})).status).toBe(200); // nobody else can publish
    const d = (await staff().get(`${C()}/training/courses/${course}`)).body;
    expect(d.inhouseNote).toBe('İşletme içi içerik · bağımsız inceleme yapılmadı');
    expect((await staff().get(`${C()}/training/courses`)).body.find((x: any) => x.id === course).inhouseNote).toContain('bağımsız inceleme yapılmadı');
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM network_posts`)).rows[0].n).toBe(0);
    expect((await env.ownerDb.query(`SELECT company_id FROM training_courses WHERE id = $1`, [course])).rows[0].company_id).toBe(demo.companyId);
  });

  it('the check screen lists training related to that check', async () => {
    const task = (await env.ownerDb.query(`SELECT id FROM tasks WHERE company_id = $1 AND template_code = 'fridge_temp' LIMIT 1`, [demo.companyId])).rows[0].id;
    const t = (await manager().get(`${C()}/tasks/${task}`)).body;
    expect(t.relatedTraining.map((x: any) => x.title)).toEqual(expect.arrayContaining(['Açılış kontrolü', 'Soğutucu kapısı ve sıcaklık kontrolü (ÖRNEK)']));
  });

  let a1: string;
  it('due soon and overdue are announced once each; a due change needs a reason', async () => {
    a1 = (await manager().post(`${C()}/training/assignments`, { courseId: course, userId: demo.users.staff.id, siteId: demo.siteId, dueAt: later(3), reason: 'Açılış kontrolü eğitimi' })).body.id;
    await scanDeadlines(env.db); await scanDeadlines(env.db);
    expect((await notes(demo.users.staff.id, 'training_due_soon')).length).toBe(1);
    await scanDeadlines(env.db, new Date(Date.now() + 5 * 3600_000)); await scanDeadlines(env.db, new Date(Date.now() + 6 * 3600_000));
    expect((await notes(demo.users.staff.id, 'training_overdue')).length).toBe(1);
    expect((await notes(demo.users.manager.id, 'training_overdue')).length).toBe(1);
    expect((await manager().post(`${C()}/training/assignments/${a1}/due`, { dueAt: later(48), reason: 'x' })).status).toBe(422);
    expect((await manager().post(`${C()}/training/assignments/${a1}/due`, { dueAt: later(48), reason: 'Vardiya değişti' })).status).toBe(200);
    expect((await notes(demo.users.staff.id, 'training_due_changed')).length).toBe(1);
  });

  it('"not effective in the field" keeps the record and allows retraining once', async () => {
    const A = `${C()}/training/assignments/${a1}`;
    await staff().post(`${A}/read`, {});
    await staff().post(`${A}/attempt`, { answers: [0] });
    await staff().post(`${A}/complete`, {});
    expect((await manager().post(`${A}/retrain`, { reason: 'Tekrar' })).body.error.code).toBe('NOT_INEFFECTIVE');
    await manager().post(`${A}/field-verify`, { result: 'not_effective', notes: 'Sahada kapı iki kez açık bulundu; uygulanmıyor.' });
    expect((await manager().get(A)).body.permissions.retrain).toBe(true);
    const r = await manager().post(`${A}/retrain`, { dueAt: later(24), reason: 'Sahada uygulanmadı; yeniden eğitim.' });
    expect(r.status).toBe(200);
    expect((await manager().post(`${A}/retrain`, { reason: 'Bir daha' })).body.error.code).toBe('ALREADY_RETRAINED');
    const old = (await manager().get(A)).body;
    expect(old.state).toMatchObject({ read: true, completed: true, passed: true, fieldVerified: 'not_effective' });
    expect(old.laterAssignmentId).toBe(r.body.id);
    const fresh = (await staff().get(`${C()}/training/assignments/${r.body.id}`)).body;
    expect(fresh).toMatchObject({ previousAssignmentId: a1, state: { read: false, completed: false } });
  });
});
