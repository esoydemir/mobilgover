import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedPlatform } from '../../src/seed/demo';
import { runScan } from '../../src/services/legislation';
import { istanbulDay } from '../../src/services/legislation-sources';
import { createSession } from '../../src/services/principal';
import { client, freshEnv, type Env } from '../support/env';
import { SyntheticSource } from '../support/legislation-fixtures';

/** Platform ana sayfası: bekleyen işler rol bazlı, sayaç = tıklanınca açılan liste, üç durum (boş / hata / yetki yok) ayrı. SENTETİK veri. */
let env: Env; let platform: Awaited<ReturnType<typeof seedPlatform>>;
const src = new SyntheticSource(); const today = istanbulDay(); let seq = 0;
const user = async (name: string, role?: string) => { const id = (await env.ownerDb.query(`INSERT INTO users (display_name, email) VALUES ($1, $2) RETURNING id`, [name, `gh18-${++seq}@test.invalid`])).rows[0].id as string;
  if (role) await env.ownerDb.query(`INSERT INTO platform_roles VALUES ($1, $2)`, [id, role]); return { id, c: client(env, await env.db.system(tx => createSession(tx, id, 24))) }; };
const admin = () => client(env, platform.admin.token); const author = () => client(env, platform.author.token); const mreview = () => client(env, platform.marketReviewer.token);
const work = async (c: ReturnType<typeof client>) => (await c.get('/admin/work')).body as any;
const area = (w: any, a: string) => w.areas.find((x: any) => x.area === a); const ctr = (w: any, a: string, k: string) => area(w, a).counters.find((c: any) => c.key === k);
let mod: Awaited<ReturnType<typeof user>>, nobody: Awaited<ReturnType<typeof user>>, ids: string[] = [];

beforeAll(async () => {
  env = await freshEnv({ legislation: src.config() }); platform = await seedPlatform(env.db);
  src.publish(today, { id: `${today.replaceAll('-', '')}-31`, category: 'YÖNETMELİKLER', title: 'Sentetik Taşınmaz Aracılık Dosya Yönetmeliği (ÖRNEK)', sayi: 99431, articles: ['Aracılık dosyaları tutulur.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
  src.publish(today, { id: `${today.replaceAll('-', '')}-32`, category: 'YÖNETMELİKLER', title: 'Sentetik İşyeri Denetim Esasları Yönetmeliği (ÖRNEK)', sayi: 99432, articles: ['İşyerlerinde denetim esasları belirlenir.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
  await runScan(env.db, src.config(), { trigger: 'manual' });
  ids = (await env.ownerDb.query(`SELECT id FROM legislation_changes ORDER BY doc_title`)).rows.map(r => r.id);
  mod = await user('Moderatör', 'network_moderator'); nobody = await user('Rolsüz');
  const pro = await user('Usta Ali'); await pro.c.post('/pro/profile', { kind: 'individual', displayName: 'Usta Ali', headline: 'Soğutma', city: 'İstanbul' });
  await pro.c.post('/pro/verifications', { kind: 'identity', issuer: 'T.C. kimlik', documentRef: 'K-1' }); await pro.c.post('/pro/authorizations', { categoryCode: 'refrigeration_service' });
  const rep = await user('Şikâyetçi'); await env.ownerDb.query(`INSERT INTO network_reports (reporter_id, target_type, target_id, reason, created_at) VALUES ($1,'post',gen_random_uuid(),'spam', now() - interval '2 hours')`, [rep.id]);
});
afterAll(async () => { await env?.close(); });

describe('GH-18 platform ana sayfası', () => {
  it('rol ayrımı: her alan yalnız kendi rolüne açılır; yetki yok, boş ve hata ayrı durumlardır; rolsüz hesap reddedilir', async () => {
    const a = await work(admin()); expect(a.areas.map((x: any) => [x.area, x.state])).toEqual([['legislation', 'ok'], ['market', 'forbidden'], ['moderation', 'forbidden']]);
    expect(area(a, 'market').need).toMatch(/pazar yeri inceleyicisi/); expect(area(a, 'market').items).toEqual([]);
    const au = await work(author()); expect(au.areas.map((x: any) => x.state)).toEqual(['ok', 'forbidden', 'forbidden']);
    const m = await work(mreview()); expect(m.areas.map((x: any) => x.state)).toEqual(['forbidden', 'ok', 'forbidden']);
    const mo = await work(mod.c); expect(mo.areas.map((x: any) => x.state)).toEqual(['forbidden', 'forbidden', 'ok']);
    expect((await nobody.c.get('/admin/work')).status).toBe(403);
    expect(a.missing.length).toBeGreaterThan(0); expect(a.missing.every((x: any) => x.key && x.why)).toBe(true);
  });

  it('mevzuat: sayaç = aynı süzgeçle açılan liste; satırda bekleme, sorumlu, durum, işlem, bağlantı; kaynak hatası satırı', async () => {
    await env.ownerDb.query(`UPDATE legislation_sources SET last_error = 'Sentetik bağlantı hatası', last_error_at = now() - interval '90 minutes', failures_in_row = 2 WHERE code = 'resmi_gazete'`);
    await env.ownerDb.query(`UPDATE legislation_changes SET assigned_to = $1, assigned_at = now() WHERE id = $2`, [platform.specialist.id, ids[0]]);
    const w = await work(admin()); const L = area(w, 'legislation');
    const open = (await admin().get('/admin/legislation/changes?status=pending')).body as any[];
    expect(ctr(w, 'legislation', 'leg_unowned').count).toBe(open.filter(r => !r.assigned_to).length); expect(ctr(w, 'legislation', 'leg_unowned').count).toBe(1);
    expect(ctr(w, 'legislation', 'leg_uncertain').count).toBe(open.filter(r => r.match_level === 'uncertain').length);
    expect(ctr(w, 'legislation', 'leg_review').count).toBe(((await admin().get('/admin/legislation/changes?status=drafted')).body as any[]).length);
    const ovr = (await admin().get('/admin/legislation/overview')).body; expect(ctr(w, 'legislation', 'leg_source_errors').count).toBe(ovr.sources.filter((x: any) => x.last_error).length); expect(L.items.filter((i: any) => i.kind === 'source_error').length).toBe(ctr(w, 'legislation', 'leg_source_errors').count); expect(ctr(w, 'legislation', 'leg_unowned').href).toBe('/legislation?quick=unowned');
    const mine = await work(client(env, platform.specialist.token)); expect(ctr(mine, 'legislation', 'leg_mine').count).toBe(1);
    expect(((await client(env, platform.specialist.token).get('/admin/legislation/changes?status=pending&assignee=me')).body as any[]).length).toBe(1);
    const src1 = L.items.find((i: any) => i.id === 'src-resmi_gazete'); expect(src1).toMatchObject({ responsible: 'Platform yöneticisi', action: 'Kaynak sağlığını aç', href: '/legislation?health=1' }); expect(src1.waitingMinutes).toBeGreaterThanOrEqual(89);
    const rows = L.items.filter((i: any) => i.kind === 'legislation_change'); expect(rows).toHaveLength(2);
    expect(rows.find((i: any) => i.id === ids[0])).toMatchObject({ responsible: 'Alan uzmanı (demo)', action: 'İncele' }); expect(rows.find((i: any) => i.id === ids[1])).toMatchObject({ responsible: 'Sahipsiz', action: 'Ata ve incele' });
    expect(rows.every((i: any) => typeof i.waitingMinutes === 'number' && i.status && i.href.startsWith('/legislation?sel='))).toBe(true);
  });

  it('pazar ve moderasyon: sayaç = ilgili listenin uzunluğu; bekleme süresi hesaplanır; sorumlu rol adıyla yazılır (kişi atanmaz)', async () => {
    const m = await work(mreview()); const q = (await mreview().get('/admin/marketplace/queue')).body;
    expect(ctr(m, 'market', 'market_verifications').count).toBe(q.verifications.length); expect(ctr(m, 'market', 'market_authorizations').count).toBe(q.authorizations.length);
    expect(area(m, 'market').total).toBe(q.verifications.length + q.authorizations.length); expect(area(m, 'market').items[0].responsible).toMatch(/atanmadı/);
    const mo = await work(mod.c); const list = (await mod.c.get('/network/moderation/reports?status=open')).body as any[];
    expect(ctr(mo, 'moderation', 'mod_open').count).toBe(list.length); expect(ctr(mo, 'moderation', 'mod_open').count).toBe(1);
    expect(area(mo, 'moderation').items[0].waitingMinutes).toBeGreaterThanOrEqual(119); expect(area(mo, 'moderation').items[0]).toMatchObject({ action: 'Karara bağla', href: '/moderation?status=open' });
  });

  it('pazar: teklifini bekleyen talep bir "takip" sayacıdır; karar sayısına (toplam) katılmaz, ama "iş yok" da denmez', async () => {
    const before = await work(mreview()); const total0 = area(before, 'market').total;
    const owner = (await env.ownerDb.query(`SELECT id FROM users LIMIT 1`)).rows[0].id as string;
    const co = (await env.ownerDb.query(`INSERT INTO companies (name) VALUES ('Takip Sentetik') RETURNING id`)).rows[0].id as string;
    const site = (await env.ownerDb.query(`INSERT INTO sites (company_id, name) VALUES ($1,'Şube') RETURNING id`, [co])).rows[0].id as string;
    await env.ownerDb.query(`INSERT INTO service_requests (company_id, site_id, category_code, title, description, city, status, created_by, created_at) VALUES ($1,$2,'refrigeration_service','Takipte talep','Sentetik','İstanbul','open',$3, now() - interval '3 days')`, [co, site, owner]);
    const after = await work(mreview());
    expect(ctr(after, 'market', 'market_follow_requests')).toMatchObject({ count: 1, kind: 'follow_up' });
    expect(area(after, 'market').total).toBe(total0); // reminders are not decisions
    expect(ctr(after, 'market', 'market_complaints').count).toBe(0);
  });

  it('kayıt işlenince sayı düşer; bir alan yüklenemezse yalnız o alan "hata" olur, diğerleri çalışır', async () => {
    const before = ctr(await work(admin()), 'legislation', 'leg_unowned').count;
    expect((await admin().post(`/admin/legislation/changes/${ids[1]}/reject`, { reason: 'İlgisiz yayın (sentetik).' })).status).toBe(200);
    const after = await work(admin()); expect(ctr(after, 'legislation', 'leg_unowned').count).toBe(before - 1); expect(area(after, 'legislation').items.some((i: any) => i.id === ids[1])).toBe(false);
    await env.ownerDb.query(`ALTER TABLE network_reports RENAME TO network_reports_x`);
    try { const mo = await work(mod.c); expect(area(mo, 'moderation')).toMatchObject({ state: 'error' }); expect(area(mo, 'moderation').message).toBeTruthy(); expect(area(mo, 'moderation').items).toEqual([]); }
    finally { await env.ownerDb.query(`ALTER TABLE network_reports_x RENAME TO network_reports`); }
    // A failing area (market) must not break the areas after it (moderation) that run in the same transaction; the screen gets a plain message, not database text.
    const both = await user('Çift rol', 'marketplace_reviewer'); await env.ownerDb.query(`INSERT INTO platform_roles VALUES ($1, 'network_moderator')`, [both.id]);
    await env.ownerDb.query(`ALTER TABLE professional_verifications RENAME TO professional_verifications_x`);
    try { const w = await work(both.c); expect(area(w, 'market')).toMatchObject({ state: 'error', total: 0, items: [], message: 'Bu bölümün verisi şu an alınamadı' }); expect(JSON.stringify(area(w, 'market'))).not.toMatch(/relation|professional_verifications/); expect(area(w, 'moderation').state).toBe('ok'); expect(area(w, 'moderation').total).toBe(1); }
    finally { await env.ownerDb.query(`ALTER TABLE professional_verifications_x RENAME TO professional_verifications`); }
    const empty = await work(mod.c); await env.ownerDb.query(`UPDATE network_reports SET status = 'dismissed', decision = 'dismiss', decision_notes = 'Sentetik karar notu.', handled_by = $1, handled_at = now()`, [mod.id]);
    expect(area(await work(mod.c), 'moderation')).toMatchObject({ state: 'ok', total: 0, items: [] }); expect(area(empty, 'moderation').total).toBe(1);
  });
});
