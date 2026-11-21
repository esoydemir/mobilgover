import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from '../../src/services/principal';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { deliverPending, MAX_DELIVERY_ATTEMPTS, type DeliveryChannel } from '../../src/services/notifications';
import { client, fakeJpeg, freshEnv, type Env } from '../support/env';

/**
 * GH-04: görev ataması, bildirim, listeler. Her şey public API'den; görev ve bildirim elle eklenmez
 * (yalnızca "vadesi geçmiş" durumu için tek bir zaman kaydırması yapılır, testte belirtilir). Kurallar ÖRNEKTİR.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let siteB: string, siteBName: string;
let workerA: { id: string; token: string }, workerB: { id: string; token: string };
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);          // şube A yöneticisi
const staff = () => client(env, demo.users.staff.token);              // şube A personeli (Elif)
const wA = () => client(env, workerA.token);                          // şube A, yeni çalışan
const wB = () => client(env, workerB.token);                          // şube B çalışanı
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const DAY = 86_400_000;

async function invite(email: string, siteId: string) {
  expect((await owner().post(`${C()}/members`, { email, role: 'staff', siteId })).status).toBe(201);
  const id = (await env.ownerDb.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id as string;
  const token = await env.db.system(tx => createSession(tx, id, 24));
  const inv = (await client(env, token).get('/me/invitations')).body as any[];
  expect((await client(env, token).post(`/me/invitations/${inv[0].membershipId ?? inv[0].id}/accept`)).status).toBe(200);
  return { id, token };
}
const inbox = async (c: ReturnType<typeof client>) => (await c.get(`${C()}/notifications`)).body as { items: any[]; unread: number };
const kindOf = (items: any[], kind: string) => items.filter(i => i.kind === kind);
const tasksOf = async (siteId: string, q = '') => (await owner().get(`${C()}/tasks?siteId=${siteId}${q}`)).body as any[];
const fridgeOpen = async () => (await tasksOf(demo.siteId)).filter(t => t.equipment_id === demo.fridgeId && t.status === 'open' && new Date(t.due_at).getTime() > Date.now() + 2 * DAY);

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  await topUpAllSites(env.db, 14);
  // İkinci şube: aynı cevaplar ve bir buzdolabı, böylece kendi görevleri olur.
  siteBName = 'Beşiktaş Çarşı';
  siteB = (await owner().post(`${C()}/sites`, { name: siteBName })).body.id;
  const catalog = (await owner().get('/fact-catalog')).body as { key: string; level: string }[];
  const first = (await owner().get(`${C()}/sites/${demo.siteId}/profile`)).body as Record<string, { value: unknown }>;
  for (const item of catalog.filter(c => c.level === 'site' && first[c.key] && c.key !== 'equipment.types'))
    await owner().post(`${C()}/profile/facts`, { siteId: siteB, key: item.key, value: first[item.key]!.value, source: 'user_declared', verification: 'user_confirmed' });
  await owner().post(`${C()}/equipment`, { siteId: siteB, type: 'fridge', name: 'Çarşı buzdolabı' });
  await topUpAllSites(env.db, 14);
  workerA = await invite('calisan.a@test.invalid', demo.siteId);
  workerB = await invite('calisan.b@test.invalid', siteB);
});
afterAll(async () => { await env?.close(); });

describe('atama bildirimi', () => {
  let taskId: string, period: string;

  it('yönetici aynı şubedeki çalışana atar; çalışan üç soruya yanıt veren tek bildirim alır', async () => {
    const t = (await fridgeOpen())[0]!;
    taskId = t.id; period = t.period_key;
    expect((await staff().get(`${C()}/tasks/${taskId}`)).status).toBe(404); // atanmadan görmez
    expect((await manager().post(`${C()}/tasks/${taskId}/assign`, { userId: demo.users.staff.id, applyToFuture: false })).status).toBe(200);
    const items = kindOf((await inbox(staff())).items, 'task_assigned');
    expect(items).toHaveLength(1);
    const n = items[0];
    expect(n.body).toMatch(/Ne değişti\?/);
    expect(n.body).toMatch(/Hangi şubemi etkiliyor\?/);
    expect(n.body).toMatch(/Ne zamana kadar ne yapmalıyım\?/);
    expect(n.meta.branch.id).toBe(demo.siteId);
    expect(n.meta.link).toEqual({ type: 'task', id: taskId });
    expect(n.meta.requiredEvidence).toEqual(expect.arrayContaining(['ölçüm', 'fotoğraf']));
    // Duyuru anı ile görevin başlangıç günü ayrı alanlardır: görev ileri tarihli, duyuru bugün.
    expect(n.meta.startsAt).toBe(period.slice(0, 10));
    expect(new Date(n.meta.announcedAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(n.meta.startsAt > new Date().toISOString().slice(0, 10)).toBe(true);
    expect(n.meta.assignedBy).toBeTruthy();
    // Bildirimden göreve gidilir.
    expect((await staff().get(`${C()}/tasks/${n.meta.link.id}`)).status).toBe(200);
  });

  it('aynı atamayı tekrar göndermek ikinci bildirim ve ikinci geçmiş satırı üretmez', async () => {
    expect((await manager().post(`${C()}/tasks/${taskId}/assign`, { userId: demo.users.staff.id, applyToFuture: false })).status).toBe(200);
    expect(kindOf((await inbox(staff())).items, 'task_assigned')).toHaveLength(1);
    expect((await owner().get(`${C()}/tasks/${taskId}`)).body.assignmentHistory).toHaveLength(1);
  });

  it('sorumlu değişince geçmiş önceki ve yeni sorumluyu gösterir; önceki kişi bilgilendirilir', async () => {
    expect((await manager().post(`${C()}/tasks/${taskId}/assign`, { userId: workerA.id, applyToFuture: false })).status).toBe(200);
    const h = (await owner().get(`${C()}/tasks/${taskId}`)).body.assignmentHistory as any[];
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ previous: null, current: { id: demo.users.staff.id }, source: 'single' });
    expect(h[1]).toMatchObject({ previous: { id: demo.users.staff.id }, current: { id: workerA.id }, changedBy: { id: demo.users.manager.id } });
    expect(kindOf((await inbox(staff())).items, 'task_unassigned')).toHaveLength(1);
    expect(kindOf((await inbox(wA())).items, 'task_assigned')).toHaveLength(1);
    // Eski sorumlu artık görevi göremez.
    expect((await staff().get(`${C()}/tasks/${taskId}`)).status).toBe(404);
  });
});

describe('şube yalıtımı ve rol görünürlüğü', () => {
  it('başka şubenin görevi başka şubenin çalışanına atanamaz; bildirim başka şubeye gitmez', async () => {
    const bTask = (await tasksOf(siteB)).find(t => t.status === 'open')!;
    expect((await manager().post(`${C()}/tasks/${bTask.id}/assign`, { userId: workerB.id, applyToFuture: false })).status).toBe(404); // A yöneticisi B'yi göremez
    expect((await owner().post(`${C()}/tasks/${bTask.id}/assign`, { userId: workerA.id, applyToFuture: false })).status).toBe(422);  // A çalışanı B'de görev alamaz
    expect((await owner().post(`${C()}/tasks/${bTask.id}/assign`, { userId: workerB.id, applyToFuture: false })).status).toBe(200);
    expect(kindOf((await inbox(wB())).items, 'task_assigned')).toHaveLength(1);
    for (const who of [manager(), staff(), wA()]) {
      const items = (await inbox(who)).items;
      expect(items.every(i => i.site_id !== siteB)).toBe(true);
    }
  });

  it('sahip tüm şubeleri, yönetici yalnız kendini, çalışan yalnız atanmışı görür', async () => {
    const own = (await owner().get(`${C()}/tasks`)).body as any[];
    expect(new Set(own.map(t => t.site_id))).toEqual(new Set([demo.siteId, siteB]));
    const mine = (await manager().get(`${C()}/tasks`)).body as any[];
    expect(new Set(mine.map(t => t.site_id))).toEqual(new Set([demo.siteId]));
    const w = (await wB().get(`${C()}/tasks`)).body as any[];
    expect(w.length).toBe(1);
    expect(w.every(t => t.assignee_id === workerB.id)).toBe(true);
  });
});

describe('okundu bilgisi görev tamamlamadan bağımsızdır', () => {
  it('okumak görevi tamamlamaz; tamamlamak okunmamış bildirimi okundu yapmaz', async () => {
    const [read, unread] = (await fridgeOpen()).slice(1, 3);
    for (const t of [read!, unread!]) expect((await manager().post(`${C()}/tasks/${t.id}/assign`, { userId: workerA.id, applyToFuture: false })).status).toBe(200);
    const items = kindOf((await inbox(wA())).items, 'task_assigned');
    const nRead = items.find(i => i.entity_id === read!.id), nUnread = items.find(i => i.entity_id === unread!.id);
    expect((await wA().post(`${C()}/notifications/read`, { ids: [nRead.id] })).status).toBe(200);
    expect((await wA().get(`${C()}/tasks/${read!.id}`)).body.status).toBe('open');

    // Okunmamış bildirimin görevi tamamlanır: bildirim okunmamış kalır.
    const photo = fakeJpeg('gh04-foto');
    expect((await wA().post(`${C()}/tasks/${unread!.id}/measurements`, { quantity: 'temperature', value: 3, unit: '°C', measuredAt: new Date(Date.now() - 60_000).toISOString(), instrumentId: demo.thermometerId })).status).toBe(201);
    const reg = await wA().post(`${C()}/tasks/${unread!.id}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: sha(photo), sizeBytes: photo.length });
    expect((await wA().put(`${C()}/evidence/${reg.body.id}/content`, photo, 'image/jpeg')).body.status).toBe('stored');
    const key = { 'idempotency-key': 'gh04-complete-1' };
    const sameBody = { clientCompletedAt: new Date().toISOString() };
    const first = await wA().post(`${C()}/tasks/${unread!.id}/complete`, sameBody, key);
    expect(first.status).toBe(200);
    const after = kindOf((await inbox(wA())).items, 'task_assigned');
    expect(after.find(i => i.entity_id === unread!.id).read_at).toBeNull();
    expect(after.find(i => i.entity_id === read!.id).read_at).not.toBeNull();

    // Çevrimdışı yeniden gönderim: aynı anahtar aynı yanıtı verir, ikinci tamamlama yazılmaz; yeni anahtar çakışma olur.
    const again = await wA().post(`${C()}/tasks/${unread!.id}/complete`, sameBody, key);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM audit_events WHERE entity_id = $1 AND event_type = 'task.completed'`, [unread!.id])).rows[0].n).toBe(1);
    const other = await wA().post(`${C()}/tasks/${unread!.id}/complete`, {}, { 'idempotency-key': 'gh04-complete-2' });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('TASK_ALREADY_DONE');
  });

  it('yönetici sonucu görür: tamamlayan, kanıt ve ölçüm', async () => {
    const done = (await tasksOf(demo.siteId, '&status=done')).find(t => t.assignee_id === workerA.id)!;
    const d = (await manager().get(`${C()}/tasks/${done.id}`)).body;
    expect(d.status).toBe('done');
    expect(d.completedBy).toBe(workerA.id);
    expect(d.measurements.length).toBe(1);
    expect(d.evidence.some((e: any) => e.kind === 'photo' && e.status === 'stored')).toBe(true);
  });
});

describe('bugün / yaklaşan / geciken / atanmamış listeleri', () => {
  it('her açık iş doğru listede; geciken iş yaklaşanda görünmez; atanmamışlar ayrı listelenir', async () => {
    const open = (await tasksOf(demo.siteId, '&status=open')).filter(t => t.equipment_id === demo.fridgeId).sort((a, b) => +new Date(a.due_at) - +new Date(b.due_at));
    // Tek zaman kaydırması: bir açık işi "vadesi geçmiş", birini "bir dakika sonra" yap (kural/atama değişmez).
    const overdueId = open[0]!.id, todayId = open[1]!.id;
    await env.ownerDb.query(`ALTER TABLE tasks DISABLE TRIGGER USER`);
    await env.ownerDb.query(`UPDATE tasks SET due_at = now() - interval '3 hours' WHERE id = $1`, [overdueId]);
    await env.ownerDb.query(`UPDATE tasks SET due_at = now() + interval '1 minute' WHERE id = $1`, [todayId]);
    await env.ownerDb.query(`ALTER TABLE tasks ENABLE TRIGGER USER`);
    const ids = async (b: string) => (await tasksOf(demo.siteId, `&bucket=${b}`)).map(t => t.id) as string[];
    const [overdue, today, upcoming, unassigned] = await Promise.all(['overdue', 'today', 'upcoming', 'unassigned'].map(ids));
    expect(overdue).toContain(overdueId);
    expect(today).toContain(todayId);
    expect(upcoming).not.toContain(overdueId);
    expect(upcoming).not.toContain(todayId);
    expect(new Set([...overdue!, ...today!]).size).toBe(overdue!.length + today!.length); // ayrık
    expect(overdue!.filter(i => today!.includes(i) || upcoming!.includes(i))).toEqual([]);
    const all = (await tasksOf(demo.siteId, '&bucket=unassigned'));
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(t => t.assignee_id === null && t.status === 'open')).toBe(true);
    expect(unassigned).toEqual(all.map(t => t.id));
  });
});

describe('toplu atama', () => {
  it('önizleme kişiyi, şubeyi, son tarihi ve gerekli kanıtı gösterir; uygulama tek bildirim ve geçmiş yazar', async () => {
    const body = { userId: workerA.id, siteIds: [demo.siteId], from: new Date(Date.now() + 3 * DAY).toISOString(), to: new Date(Date.now() + 9 * DAY).toISOString(), onlyUnassigned: true };
    const pre = await manager().post(`${C()}/tasks/bulk-assign/preview`, body);
    const scope = body;
    expect(pre.status).toBe(200);
    expect(pre.body.total).toBeGreaterThan(0);
    expect(pre.body.assignee.name).toBeTruthy();
    const s = pre.body.sites[0];
    expect(s.siteName).toBeTruthy();
    expect(new Date(s.earliestDue).getTime()).toBeLessThanOrEqual(new Date(s.latestDue).getTime());
    expect(s.requiredEvidence.length).toBeGreaterThan(0);

    const before = kindOf((await inbox(wA())).items, 'task_assigned').length;
    const applied = await manager().post(`${C()}/tasks/bulk-assign`, { ...scope, expectedTotal: pre.body.total, reason: 'Hafta planı' });
    expect(applied.status).toBe(200);
    const items = kindOf((await inbox(wA())).items, 'task_assigned');
    expect(items.length).toBe(before + 1); // şube başına tek özet bildirim
    const sum = items[0];
    expect(sum.meta.count).toBe(pre.body.total);
    expect(sum.meta.branch.id).toBe(demo.siteId);
    const logged = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM task_assignment_log WHERE source = 'bulk' AND new_id = $1`, [workerA.id])).rows[0].n;
    expect(logged).toBe(pre.body.total);
  });
});

describe('pasifleştirilen çalışanın açık işleri', () => {
  it('yeniden atama listesine düşer; yeni sorumlu atanınca listeden çıkar, geçmiş eski ve yeni kişiyi gösterir', async () => {
    const members = (await owner().get(`${C()}/members`)).body as any[];
    const m = members.find(x => x.id === workerA.id)!;
    expect((await owner().post(`${C()}/members/${m.membership_id}/suspend`, { reason: 'işten ayrıldı' })).status).toBe(200);
    const q = (await manager().get(`${C()}/reassignment-queue`)).body.tasks as any[];
    expect(q.length).toBeGreaterThan(0);
    expect(q.every(t => t.owner_name)).toBe(true);
    expect(kindOf((await inbox(manager())).items, 'reassignment_needed').length).toBe(1);
    expect(q.every(t => t.site_id === demo.siteId)).toBe(true);

    const target = q[0];
    expect((await manager().post(`${C()}/tasks/${target.id}/assign`, { userId: demo.users.staff.id, applyToFuture: false })).status).toBe(200);
    const after = (await manager().get(`${C()}/reassignment-queue`)).body.tasks as any[];
    expect(after.map(t => t.id)).not.toContain(target.id);
    const h = (await manager().get(`${C()}/tasks/${target.id}`)).body.assignmentHistory as any[];
    expect(h[h.length - 1]).toMatchObject({ previous: { id: workerA.id }, current: { id: demo.users.staff.id } });
  });
});

describe('bildirim teslimi: yeniden deneme, tekrar göndermeme', () => {
  const sentIds = new Map<string, number>();
  let mode: 'fail' | 'ok' = 'fail';
  const channel: DeliveryChannel = { async send(n) {
    sentIds.set(n.id, (sentIds.get(n.id) ?? 0) + 1);
    if (mode === 'fail') throw new Error('push servisi yanıt vermedi');
  } };
  const row = async (id: string) => (await env.ownerDb.query(`SELECT delivered_at, delivery_attempts AS a, delivery_error, next_attempt_at FROM notifications WHERE id = $1`, [id])).rows[0];
  let id: string;

  it('başarısız gönderim kaydı bozmaz, gecikmeyle yeniden denenir; başarıdan sonra bir daha gönderilmez', async () => {
    id = (await env.ownerDb.query(`SELECT id FROM notifications WHERE kind = 'task_assigned' AND user_id = $1 ORDER BY created_at LIMIT 1`, [workerB.id])).rows[0].id;
    const t0 = new Date();
    await deliverPending(env.db, channel, t0);
    let r = await row(id);
    expect(r.delivered_at).toBeNull();
    expect(r.a).toBe(1);
    expect(r.delivery_error).toMatch(/push servisi/);
    expect((await wB().get(`${C()}/notifications`)).body.items.some((i: any) => i.id === id)).toBe(true); // gelen kutusu teslimden bağımsız

    await deliverPending(env.db, channel, t0); // bekleme süresi dolmadan tekrar denenmez
    expect(sentIds.get(id)).toBe(1);

    mode = 'ok';
    await deliverPending(env.db, channel, new Date(t0.getTime() + 2 * 60_000));
    r = await row(id);
    expect(r.delivered_at).not.toBeNull();
    expect(sentIds.get(id)).toBe(2);
    await deliverPending(env.db, channel, new Date(t0.getTime() + 3_600_000));
    expect(sentIds.get(id)).toBe(2); // ikinci kez gönderilmedi
  });

  it('en çok deneme sonunda vazgeçilir ve hata kayıtta kalır', async () => {
    mode = 'fail';
    const free = (await tasksOf(siteB)).find(t => t.status === 'open' && t.assignee_id === null)!;
    expect((await owner().post(`${C()}/tasks/${free.id}/assign`, { userId: workerB.id, applyToFuture: false })).status).toBe(200);
    const other = (await env.ownerDb.query(`SELECT id FROM notifications WHERE delivered_at IS NULL AND delivery_attempts = 0 AND user_id = $1 LIMIT 1`, [workerB.id])).rows[0]?.id as string;
    expect(other).toBeTruthy();
    let at = Date.now() + 10 * 3_600_000;
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS + 2; i++) { await deliverPending(env.db, channel, new Date(at)); at += 7 * 3_600_000; }
    const r = await row(other);
    expect(r.a).toBe(MAX_DELIVERY_ATTEMPTS);
    expect(r.delivered_at).toBeNull();
    expect(r.delivery_error).toMatch(/push servisi/);
    expect(r.next_attempt_at).toBeNull();
    expect(sentIds.get(other)).toBe(MAX_DELIVERY_ATTEMPTS);
  });
});
