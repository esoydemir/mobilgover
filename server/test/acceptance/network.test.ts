import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { createSession } from '../../src/services/principal';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Delivery 5B: professional network, first version, over real HTTP + PostgreSQL.
 * Profile → specialties and experience → search → follow → post → comment → service request from a
 * profile; plus contact privacy, declared vs checked vs verified history, drafts, blocking, reports and
 * moderation, case sharing with permission/preview/data check, and "network profile ≠ approval".
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let pro: { id: string; token: string };
let ali: { id: string; token: string }, mod: { id: string; token: string };
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const P = () => client(env, pro.token);
const A = () => client(env, ali.token);
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const newUser = async (name: string, email: string, role?: string) => env.db.system(async tx => {
  const u = (await tx.query(`INSERT INTO users (display_name, email) VALUES ($1,$2) RETURNING id`, [name, email])).rows[0].id;
  if (role) await tx.query(`INSERT INTO platform_roles (user_id, role) VALUES ($1,$2)`, [u, role]);
  return { id: u as string, token: await createSession(tx, u) };
});

beforeAll(async () => {
  env = await freshEnv();
  const platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  pro = await seedDemoProvider(env.db, platform.marketReviewer.id, 'murat.ag@ornek.test');
  ali = await newUser('Ali Yılmaz', 'ali.ag@ornek.test');
  mod = await newUser('Moderatör', 'mod.ag@ornek.test', 'network_moderator');
});
afterAll(async () => { await env?.close(); });

describe('profile, experience, separate sections, contact privacy', () => {
  it('without a profile the network is closed; a profile is a statement, not an approval', async () => {
    expect((await A().get('/network/feed')).body.error.code).toBe('NO_NETWORK_PROFILE');
    expect((await A().post('/network/profile', { displayName: 'Ali Yılmaz', title: 'Soğutma ustası', city: 'İstanbul', specialties: ['soğutma'],
      categories: ['refrigeration_service'], phone: '0532 111 22 33', bio: 'On yıllık deneyim.' })).status).toBe(200);
    expect((await A().post('/network/experience', { roleTitle: 'Soğutma ustası', organization: 'Serbest', startYear: 2015, endYear: null })).status).toBe(201);
    const me = (await A().get(`/network/profiles/${ali.id}`)).body;
    expect(me.note).toContain('hizmet verme onayı değildir');
    expect(me.declared.categories).toEqual([{ code: 'refrigeration_service', name: expect.any(String), approved: false }]);
    expect(me.approvals).toEqual([]);
    expect(me.contact).toMatchObject({ email: 'ali.ag@ornek.test', phone: '0532 111 22 33' }); // own view
  });

  it('a provider profile shows declared info, checked credentials (no files) and approvals apart; contacts hidden by default', async () => {
    await P().post('/network/profile', { displayName: 'Murat Yıldız', title: 'Soğutma teknisyeni', city: 'İstanbul', specialties: ['soğutma', 'kalibrasyon'], categories: ['refrigeration_service'], phone: '0533 000 00 00' });
    const v = (await A().get(`/network/profiles/${pro.id}`)).body;
    expect(v.contact).toMatchObject({ email: null, phone: null });
    expect(v.checked.credentials.length).toBeGreaterThan(0);
    expect(JSON.stringify(v.checked)).not.toMatch(/document_ref|storage_key|evidence/);
    expect(v.approvals.map((a: any) => a.category_code)).toEqual(['refrigeration_service']);
    expect(v.verifiedHistory).toMatchObject({ count: 0 });
    expect(v.requestableCategories.map((c: any) => c.code)).toEqual(['refrigeration_service']);
    await P().post('/network/profile', { displayName: 'Murat Yıldız', title: 'Soğutma teknisyeni', city: 'İstanbul', specialties: ['soğutma', 'kalibrasyon'], categories: ['refrigeration_service'], phone: '0533 000 00 00', showPhone: true });
    expect((await A().get(`/network/profiles/${pro.id}`)).body.contact).toMatchObject({ email: null, phone: '0533 000 00 00' });
  });
});

describe('search with explained ranking', () => {
  it('filters by specialty, category, region and approval; unapproved profiles are findable; approved ones rank first', async () => {
    await owner().post('/network/profile', { displayName: 'Ahmet (işletme)', city: 'İzmir' });
    const all = (await owner().get('/network/search?category=refrigeration_service')).body;
    expect(all.rankingNote).toContain('Takipçi sayısı yalnız eşitlikte');
    expect(all.results.map((r: any) => r.userId)).toEqual([pro.id, ali.id]);
    expect(all.results[0].reasons).toContain('bu kategoride geçerli hizmet onayı');
    expect(all.results[1].reasons).toContain('bu kategoride çalıştığını beyan ediyor (onay yok)');
    expect((await owner().get('/network/search?category=refrigeration_service&approvedOnly=1')).body.results.map((r: any) => r.userId)).toEqual([pro.id]);
    expect((await owner().get(`/network/search?specialty=${encodeURIComponent('kalibrasyon')}`)).body.results.map((r: any) => r.userId)).toEqual([pro.id]);
    expect((await owner().get(`/network/search?city=${encodeURIComponent('Ankara')}`)).body.results).toEqual([]);
    expect((await owner().get(`/network/search?text=${encodeURIComponent('ustası')}`)).body.results.map((r: any) => r.userId)).toEqual([ali.id]);
  });

  it('a network profile without approval cannot quote', async () => {
    const req = await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Bakım', description: 'Yıllık bakım', city: 'İstanbul' });
    const q = await A().post(`/pro/requests/${req.body.id}/quotes`, { scope: 'Bakım', exclusions: 'Parça', priceNet: 100, vatRate: 20, materials: 'Yok', durationText: '1 saat', warrantyText: '1 ay', validUntil: later(48) });
    expect(q.status).toBe(404);
  });
});

describe('follow, post, comment, drafts, edit, delete', () => {
  let post: string, draft: string;
  it('drafts only for the author; published posts open to network users with a user-content label', async () => {
    expect((await owner().post(`/network/profiles/${pro.id}/follow`)).body).toEqual({ following: true });
    draft = (await P().post('/network/posts', { body: 'Taslak: conta seçimi notlarım' })).body.id;
    expect((await owner().get(`/network/posts/${draft}`)).status).toBe(404);
    expect((await P().get('/network/feed?scope=mine')).body.posts.map((x: any) => x.id)).toContain(draft);
    post = (await P().post('/network/posts', { body: 'Kapı contasını yazın sonunda kontrol etmek sıcaklık sapmalarını azaltıyor.', publish: true })).body.id;
    const f = (await owner().get('/network/feed?scope=following')).body;
    expect(f.posts.map((x: any) => x.id)).toEqual([post]);
    expect(f.posts[0].label).toContain('Kullanıcı paylaşımı');
    expect(f.posts[0].label).toContain('platform onaylı içerik değildir');
  });

  it('comments, edits and deletes; only the author changes their content', async () => {
    const c = (await owner().post(`/network/posts/${post}/comments`, { body: 'Hangi aralıkla kontrol ediyorsunuz?' })).body.id;
    expect((await A().post(`/network/comments/${c}`, { body: 'Değiştirdim' })).status).toBe(403);
    expect((await owner().post(`/network/comments/${c}`, { body: 'Hangi aralıkla kontrol ediyorsunuz? (haftalık mı?)' })).status).toBe(200);
    expect((await owner().post(`/network/posts/${draft}/comments`, { body: 'Taslağa yorum' })).status).toBe(404);
    expect((await A().post(`/network/posts/${post}`, { body: 'Başkasının paylaşımı' })).status).toBe(403);
    expect((await P().post(`/network/posts/${post}`, { body: 'Kapı contasını yazın sonunda kontrol etmek sapmaları azaltıyor (düzenlendi).' })).status).toBe(200);
    const d = (await owner().get(`/network/posts/${post}`)).body;
    expect(d.editedAt).not.toBeNull();
    expect(d.comments[0].body).toContain('haftalık');
    expect((await P().post(`/network/posts/${draft}`, { op: 'delete' })).status).toBe(200);
    expect((await P().get('/network/feed?scope=mine')).body.posts.map((x: any) => x.id)).not.toContain(draft);
  });

  it('blocking hides each other and stops comments and follows', async () => {
    const own = (await A().post('/network/posts', { body: 'Ali\'nin paylaşımı: soğutucu gaz kaçağı belirtileri.', publish: true })).body.id;
    expect((await P().post(`/network/profiles/${ali.id}/block`)).body).toEqual({ blocked: true });
    expect((await P().get('/network/feed')).body.posts.map((x: any) => x.id)).not.toContain(own);
    expect((await A().get(`/network/profiles/${pro.id}`)).status).toBe(404);
    expect((await A().post(`/network/posts/${post}/comments`, { body: 'Engellenmişken yorum' })).status).toBe(404);
    expect((await A().post(`/network/profiles/${pro.id}/follow`)).status).toBe(404);
    await P().post(`/network/profiles/${ali.id}/unblock`);
  });

  it('reports go to moderators only; a decision needs a reason and is recorded; hidden content shows the reason to its author', async () => {
    const r = await owner().post('/network/reports', { targetType: 'post', targetId: post, reason: 'misleading', details: 'Kaynak belirtilmemiş.' });
    expect(r.status).toBe(201);
    expect((await owner().post('/network/reports', { targetType: 'post', targetId: post, reason: 'spam' })).body.error.code).toBe('ALREADY_REPORTED');
    expect((await owner().get('/network/moderation/reports')).status).toBe(403);
    const mq = (await client(env, mod.token).get('/network/moderation/reports')).body;
    expect(mq.map((x: any) => x.target_id)).toEqual([post]);
    expect((await client(env, mod.token).post(`/network/moderation/reports/${r.body.id}`, { decision: 'hide', notes: 'kısa' })).status).toBe(422);
    expect((await client(env, mod.token).post(`/network/moderation/reports/${r.body.id}`, { decision: 'hide', notes: 'Mevzuat gibi sunulmuş, kaynak yok; gizlendi.' })).body.status).toBe('actioned');
    expect((await owner().get(`/network/posts/${post}`)).status).toBe(404);
    const mine = (await P().get(`/network/posts/${post}`)).body;
    expect(mine).toMatchObject({ hidden: true, hiddenReason: 'Mevzuat gibi sunulmuş, kaynak yok; gizlendi.' });
    const audit = (await env.ownerDb.query(`SELECT payload FROM audit_events WHERE event_type = 'network.moderation_decision'`)).rows;
    expect(audit[0].payload).toMatchObject({ decision: 'hide', reason: 'misleading' });
    expect((await client(env, mod.token).get('/network/moderation/reports?status=closed')).body[0]).toMatchObject({ decision: 'hide', handled_by: mod.id });
  });
});

describe('case sharing: permission, preview, data check; nothing automatic', () => {
  let ncr: string;
  it('preview shows exactly the shared fields; names, contacts and prices are flagged; a site manager cannot permit', async () => {
    const created = await manager().post(`${C()}/nonconformities`, { siteId: demo.siteId, title: 'Soğutucu sıcaklığı yüksek', description: 'Test kaydı', hazardType: 'cold_chain_temperature', severity: 'major', containment: 'Ürün taşındı.' });
    ncr = created.body.id;
    await manager().post(`${C()}/nonconformities/${ncr}/causes`, { stage: 'initial', categories: ['equipment', 'knowledge'], notes: 'Conta ve bilgi eksik.' });
    const badR = (await owner().post(`${C()}/nonconformities/${ncr}/share-preview`, { fields: ['hazard', 'risk', 'causes'],
      summary: 'Kadıköy Moda şubemizde Elif kapıyı açık bıraktı; servis 1500 TL aldı, 0532 123 45 67.' }));
    const bad = badR.body;
    expect(bad.issues.map((i: any) => i.type)).toEqual(expect.arrayContaining(['şube adı', 'kişi adı', 'telefon', 'fiyat / ticari tutar']));
    expect(bad.snapshot).toMatchObject({ hazard: 'Sıcaklık / soğuk zincir', causes: { initial: ['Ekipman eksikliği', 'Bilgi eksikliği'] } });
    expect(bad.excluded).toContain('işletme ve şube adı');
    expect((await owner().post(`${C()}/nonconformities/${ncr}/share`, { fields: ['hazard'], summary: 'Kadıköy Moda şubemizde yaşandı, conta yırtıktı.', permit: true })).body.error.code).toBe('CASE_SHARE_PRIVATE_DATA');
    await manager().post('/network/profile', { displayName: 'Selin', city: 'İstanbul' });
    expect((await manager().post(`${C()}/nonconformities/${ncr}/share`, { fields: ['hazard'], summary: 'Conta yırtılınca sıcaklık hızla yükseliyor; haftalık kontrol işe yaradı.', permit: true })).status).toBe(403);
    expect((await owner().post(`${C()}/nonconformities/${ncr}/share`, { fields: ['hazard'], summary: 'Conta yırtılınca sıcaklık hızla yükseliyor; haftalık kontrol işe yaradı.', permit: false })).status).toBe(422);
  });

  it('with the owner\'s permission a DRAFT is created; it becomes visible only when published; nothing else leaves the business', async () => {
    const before = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM network_posts`)).rows[0].n;
    const r = await owner().post(`${C()}/nonconformities/${ncr}/share`, { fields: ['hazard', 'risk', 'causes', 'actions'], summary: 'Conta yırtılınca sıcaklık hızla yükseliyor; haftalık kontrol işe yaradı.', permit: true });
    expect(r.status).toBe(201);
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM network_posts`)).rows[0].n).toBe(before + 1);
    expect((await P().get(`/network/posts/${r.body.postId}`)).status).toBe(404); // draft
    await owner().post(`/network/posts/${r.body.postId}`, { op: 'publish' });
    const seen = (await P().get(`/network/posts/${r.body.postId}`)).body;
    expect(seen).toMatchObject({ kind: 'case', label: expect.stringContaining('Kullanıcı paylaşımı') });
    const txt = JSON.stringify(seen);
    for (const secret of ['Kadıköy', 'Kahve Durağı', 'Elif', 'Selin', 'GH-EQ-4471', demo.companyId, ncr]) expect(txt).not.toContain(secret);
    // Editing the case summary later runs the same data check.
    expect((await owner().post(`/network/posts/${r.body.postId}`, { body: 'Elif kapıyı açık bıraktı, 0532 123 45 67.' })).body.error.code).toBe('CASE_SHARE_PRIVATE_DATA');
    // Other records are never posted automatically.
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM network_posts WHERE kind = 'case'`)).rows[0].n).toBe(1);
  });
});

describe('from a profile to a service request', () => {
  it('only an approved category; goes to that provider only; opening the form creates nothing', async () => {
    const before = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM service_requests`)).rows[0].n;
    const v = (await owner().get(`/network/profiles/${pro.id}`)).body;
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM service_requests`)).rows[0].n).toBe(before);
    const bad = await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'lpg_inspection', title: 'LPG', description: 'LPG kontrolü', city: 'İstanbul', invitedProfileId: v.proProfileId });
    expect([404, 422]).toContain(bad.status);
    const ok = await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Profilden talep', description: 'Dolap bakımı', city: 'İstanbul', invitedProfileId: v.proProfileId });
    expect(ok.status).toBe(201);
    expect((await P().get('/pro/inbox')).body.requests.map((r: any) => r.id)).toContain(ok.body.id);
    expect((await P().get('/pro/notifications')).body.items.some((n: any) => n.kind === 'provider_new_request' && n.title.includes('Profilin üzerinden'))).toBe(true);
    // Another approved provider does not see it and cannot quote.
    const other = await env.db.system(async tx => {
      const u = (await tx.query(`INSERT INTO users (display_name, email) VALUES ('Başka uzman', 'baska.uzman@ornek.test') RETURNING id`)).rows[0].id;
      const pp = (await tx.query(`INSERT INTO professional_profiles (user_id, kind, display_name, city) VALUES ($1,'individual','Başka uzman','İstanbul') RETURNING id`, [u])).rows[0].id;
      await tx.query(`INSERT INTO service_authorizations (profile_id, category_code, status, decided_at, decided_by, valid_until, basis_verification_ids)
        SELECT $1, category_code, 'approved', now(), decided_by, valid_until, '{}' FROM service_authorizations WHERE profile_id = $2 LIMIT 1`, [pp, v.proProfileId]);
      return { id: u as string, token: await createSession(tx, u) };
    });
    expect((await client(env, other.token).get('/pro/inbox')).body.requests.map((r: any) => r.id)).not.toContain(ok.body.id);
    const q = await client(env, other.token).post(`/pro/requests/${ok.body.id}/quotes`, { scope: 'Bakım', exclusions: 'Parça', priceNet: 100, vatRate: 20, materials: 'Yok', durationText: '1 saat', warrantyText: '1 ay', validUntil: later(48) });
    expect(q.status).toBe(404);
    expect((await P().post(`/pro/requests/${ok.body.id}/quotes`, { scope: 'Bakım', exclusions: 'Parça', priceNet: 100, vatRate: 20, materials: 'Yok', durationText: '1 saat', warrantyText: '1 ay', validUntil: later(48) })).status).toBe(201);
  });
});
