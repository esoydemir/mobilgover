import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { createSession } from '../../src/services/principal';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Delivery 6C: plain-language search with a category suggestion and filter relaxations; specialist
 * card facts; request preview; open vs direct requests; quote comparison in a fixed order; approval
 * checked at accept and shown when it lapses; report → revision with a reason → new version → accept;
 * review only after acceptance; cancel; idempotent provider submissions; case share permission tied to
 * the previewed content, re-approval and withdrawal; report status for the reporter; appeals never
 * decided by the first moderator; demo reset with case posts. Categories are EXAMPLES.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let pro: { id: string; token: string }, pro2: { id: string; token: string };
let mod1: { id: string; token: string }, mod2: { id: string; token: string };
let reviewerToken: string;
let pp1: string, pp2: string;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const P1 = () => client(env, pro.token);
const P2 = () => client(env, pro2.token);
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const quote = (extra: Record<string, unknown> = {}) => ({ scope: 'Conta değişimi ve gaz kontrolü', exclusions: 'Kompresör değişimi', priceNet: 1500, vatRate: 20, materials: 'Conta',
  durationText: '2 saat', warrantyText: '3 ay', validUntil: later(48), deliverable: 'Servis raporu ve öncesi/sonrası sıcaklık ölçümü', ...extra });
const newUser = async (name: string, email: string, role?: string) => env.db.system(async tx => {
  const u = (await tx.query(`INSERT INTO users (display_name, email) VALUES ($1,$2) RETURNING id`, [name, email])).rows[0].id;
  if (role) await tx.query(`INSERT INTO platform_roles (user_id, role) VALUES ($1,$2)`, [u, role]);
  return { id: u as string, token: await createSession(tx, u) };
});

beforeAll(async () => {
  env = await freshEnv();
  const platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  pro = await seedDemoProvider(env.db, platform.marketReviewer.id, 'murat.6c@ornek.test');
  pro2 = await seedDemoProvider(env.db, platform.marketReviewer.id, 'deniz.6c@ornek.test');
  pp1 = (await env.ownerDb.query(`SELECT id FROM professional_profiles WHERE user_id = $1`, [pro.id])).rows[0].id;
  pp2 = (await env.ownerDb.query(`SELECT id FROM professional_profiles WHERE user_id = $1`, [pro2.id])).rows[0].id;
  await env.ownerDb.query(`UPDATE professional_profiles SET display_name = 'Deniz Kaya' WHERE id = $1`, [pp2]);
  reviewerToken = await env.db.system(tx => createSession(tx, platform.marketReviewer.id));
  mod1 = await newUser('Moderatör Bir', 'mod1.6c@ornek.test', 'network_moderator');
  mod2 = await newUser('Moderatör İki', 'mod2.6c@ornek.test', 'network_moderator');
  await owner().post('/network/profile', { displayName: 'Ahmet (işletme)', city: 'İstanbul' });
  await P1().post('/network/profile', { displayName: 'Murat Yıldız', title: 'Soğutma teknisyeni', city: 'İstanbul', specialties: ['soğutma'], categories: ['refrigeration_service'] });
  await P2().post('/network/profile', { displayName: 'Deniz Kaya', title: 'Teknisyen', city: 'Ankara', specialties: ['soğutma'], categories: ['refrigeration_service'] });
});
afterAll(async () => { await env?.close(); });

describe('finding the right specialist without knowing the trade', () => {
  it('"dolabım soğutmuyor" suggests the refrigeration category and finds approved specialists, with the reason', async () => {
    const r = (await owner().get(`/network/search?text=${encodeURIComponent('dolabım soğutmuyor')}`)).body;
    expect(r.suggestedCategories[0]).toMatchObject({ code: 'refrigeration_service', matched: expect.arrayContaining(['soğut', 'dolab']) });
    expect(r.suggestedCategories[0].why).toContain('teşhis değildir');
    expect(r.questions.join(' ')).toContain('Hangi ilde');
    expect(r.results.map((x: any) => x.userId)).toEqual(expect.arrayContaining([pro.id, pro2.id]));
    const card = r.results.find((x: any) => x.userId === pro.id);
    expect(card).toMatchObject({ approvedCategories: ['refrigeration_service'], identityVerified: true, checkedCredentials: 1, verifiedJobs: 0 });
    expect(card.reasons.join(' ')).toContain('Soğutma');
    const s = (await client(env, demo.users.owner.token).get('/service-categories/suggest?text=' + encodeURIComponent('ocakta gaz kokusu var'))).body;
    expect(s.suggestions[0].code).toBe('gas_installation_check');
  });

  it('zero results say which filter to drop and how many would show', async () => {
    const r = (await owner().get(`/network/search?text=${encodeURIComponent('dolabım soğutmuyor')}&city=Van`)).body;
    expect(r.results).toEqual([]);
    expect(r.relaxations).toEqual(expect.arrayContaining([{ filter: 'city', label: 'Bölge filtresini kaldır', count: 2 }]));
  });
});

describe('request → quotes → revision → acceptance', () => {
  let req: string, q1: string, q2: string, job: string;
  it('the preview shows exactly what a specialist sees; private photos, staff and documents stay closed', async () => {
    const pv = (await owner().post(`${C()}/service-requests/preview`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Dolap soğutmuyor', description: 'Tezgâh altı dolap 9 °C.', city: 'İstanbul' })).body;
    expect(pv.shown.map((x: any) => x.label)).toEqual(['Başlık', 'Açıklama', 'Şehir', 'Kategori']);
    expect(pv.never.join(' ')).toMatch(/fotoğraf.*Çalışan.*belgeleri/s);
    expect(pv.afterAward[0]).toBe('İşletme adı');
    req = (await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Dolap soğutmuyor', description: 'Tezgâh altı dolap 9 °C.', city: 'İstanbul' })).body.id;
  });

  it('quotes need a deliverable; a resent quote answers once; comparison rows are in a fixed order', async () => {
    const { deliverable, ...noDeliv } = quote();
    expect(deliverable).toBeTruthy();
    expect((await P1().post(`/pro/requests/${req}/quotes`, noDeliv)).status).toBe(422);
    const key = { 'idempotency-key': 'pro-quote-6c-0001' };
    const body = quote();
    const a = await P1().post(`/pro/requests/${req}/quotes`, body, key);
    const again = await P1().post(`/pro/requests/${req}/quotes`, body, key);
    expect([again.status, again.body?.error?.code, again.headers['idempotent-replay']]).toEqual([201, undefined, 'true']);
    expect(again.body).toEqual(a.body);
    q1 = a.body.id;
    q2 = (await P2().post(`/pro/requests/${req}/quotes`, quote({ priceNet: 1200, deliverable: 'Servis raporu' }))).body.id;
    const d = (await owner().get(`${C()}/service-requests/${req}`)).body;
    expect(d.mode).toBe('open');
    expect(d.comparison.map((r: any) => r.key)).toEqual(['scope', 'exclusions', 'price', 'duration_text', 'deliverable', 'warranty_text', 'valid_until']);
    expect(d.quotes).toHaveLength(2);
    expect(d.quotes.every((x: any) => x.providerStatus.live)).toBe(true);
  });

  it('when no quote can be accepted any more, neither side is told to evaluate or accept one', async () => {
    const listed = async () => (await owner().get(`${C()}/service-requests`)).body.find((x: any) => x.id === req);
    const followUp = async () => JSON.stringify((await client(env, reviewerToken).get('/admin/marketplace/operations')).body);
    expect(await listed()).toMatchObject({ open_quotes: 2, acceptable_quotes: 2 });
    expect(await followUp()).toContain('teklifleri karşılaştırıp kabul etmesini');
    await env.ownerDb.query(`UPDATE service_authorizations SET valid_until = current_date - 1 WHERE profile_id = ANY($1)`, [[pp1, pp2]]);
    expect(await listed()).toMatchObject({ open_quotes: 2, acceptable_quotes: 0 });
    const d = (await owner().get(`${C()}/service-requests/${req}`)).body;
    expect(d.quotes.map((x: any) => x.acceptable)).toEqual([false, false]);
    const text = await followUp();
    expect(text).not.toContain('teklifleri karşılaştırıp kabul etmesini');
    expect(text).toContain('Gelen teklif artık kabul edilemiyor');
    await env.ownerDb.query(`UPDATE service_authorizations SET valid_until = current_date + 365 WHERE profile_id = ANY($1)`, [[pp1, pp2]]);
    expect(await listed()).toMatchObject({ acceptable_quotes: 2 });
  });

  it('an approval suspended after quoting is shown and the quote cannot be accepted', async () => {
    await env.ownerDb.query(`UPDATE service_authorizations SET status = 'suspended' WHERE profile_id = $1`, [pp2]);
    const d = (await owner().get(`${C()}/service-requests/${req}`)).body;
    expect(d.quotes.find((x: any) => x.id === q2).providerStatus).toMatchObject({ live: false, label: 'Kategori onayı askıya alındı' });
    expect((await owner().post(`${C()}/quotes/${q2}/accept`)).body.error.code).toBe('PROVIDER_NOT_AUTHORIZED');
    await env.ownerDb.query(`UPDATE service_authorizations SET status = 'approved' WHERE profile_id = $1`, [pp2]);
  });

  it('report → revision with a reason → new version → accept; review only after acceptance; history kept', async () => {
    job = (await owner().post(`${C()}/quotes/${q1}/accept`)).body.jobId;
    const code = (await owner().get(`${C()}/service-requests/${req}`)).body.job.checkin_code;
    await P1().post(`/pro/jobs/${job}/check-in`, { code });
    await P1().post(`/pro/jobs/${job}/report`, { report: 'Conta değiştirildi, gaz basıncı normal. Sıcaklık ölçülmedi.' });
    expect((await owner().post(`${C()}/jobs/${job}/acceptance`, { accept: false, note: 'Eksik' })).status).toBe(422);
    expect((await owner().post(`${C()}/jobs/${job}/acceptance`, { accept: false, note: 'Teklifte söz verilen öncesi/sonrası sıcaklık ölçümü raporda yok.' })).body.status).toBe('revision_requested');
    expect((await owner().post(`${C()}/jobs/${job}/review`, { quality: 4, timeliness: 4, communication: 4, comment: null, showOnProfile: false })).body.error.code).toBe('JOB_NOT_ACCEPTED');
    await P1().post(`/pro/jobs/${job}/report`, { report: 'Conta değiştirildi. Öncesi 9 °C, sonrası 3 °C (30 dk sonra). Gaz basıncı normal.' });
    expect((await owner().post(`${C()}/jobs/${job}/acceptance`, { accept: true, note: 'Ölçümleri kontrol ettim.' })).body.status).toBe('accepted');
    const d = (await owner().get(`${C()}/service-requests/${req}`)).body;
    expect(d.reports.map((r: any) => [r.version, r.decision])).toEqual([[1, 'revision_requested'], [2, 'accepted']]);
    expect(d.history.map((h: any) => h.event_type)).toEqual(expect.arrayContaining(['service.requested', 'service.quote_accepted', 'service.report_submitted', 'service.revision_requested', 'service.accepted']));
    expect(d.canReview).toBe(true);
  });

  it('a direct request is marked as such (no comparison); an open request can be cancelled with a reason', async () => {
    const direct = (await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Bakım', description: 'Yıllık bakım.', city: 'İstanbul', invitedProfileId: pp1 })).body.id;
    const d = (await owner().get(`${C()}/service-requests/${direct}`)).body;
    expect(d).toMatchObject({ mode: 'direct', comparison: null });
    expect(d.modeNote).toContain('Murat Yıldız');
    expect((await owner().post(`${C()}/service-requests/${direct}/cancel`, { reason: 'kısa' })).status).toBe(422);
    expect((await owner().post(`${C()}/service-requests/${direct}/cancel`, { reason: 'Başka bir yoldan çözüldü, gerek kalmadı.' })).body.status).toBe('cancelled');
    expect((await P1().post(`/pro/requests/${direct}/quotes`, quote())).status).toBe(409);
  });
});

describe('case share permission belongs to the previewed content', () => {
  let ncr: string, post: string;
  it('changed text needs a new permission from an authorised person before it is published again', async () => {
    ncr = (await manager().post(`${C()}/nonconformities`, { siteId: demo.siteId, title: 'Soğutucu sıcak', description: 'Test kaydı.', hazardType: 'cold_chain_temperature', severity: 'major', containment: 'Ürün taşındı.' })).body.id;
    post = (await owner().post(`${C()}/nonconformities/${ncr}/share`, { fields: ['hazard', 'risk'], summary: 'Conta yırtılınca sıcaklık hızla yükseliyor; haftalık kontrol işe yaradı.', permit: true })).body.postId;
    expect((await owner().post(`/network/posts/${post}`, { op: 'publish' })).status).toBe(200);
    await owner().post(`/network/posts/${post}`, { body: 'Conta yırtılınca sıcaklık hızla yükseliyor; haftalık kontrol ve yedek conta işe yaradı.' });
    expect((await P1().get(`/network/posts/${post}`)).status).toBe(404); // off the network until permitted again
    const mine = (await owner().get(`/network/posts/${post}`)).body;
    expect(mine).toMatchObject({ status: 'draft', reapprovalNeeded: true });
    expect((await owner().post(`/network/posts/${post}`, { op: 'publish' })).body.error.code).toBe('CASE_REAPPROVAL_NEEDED');
    expect((await manager().post(`${C()}/network/case-posts/${post}/approve`, { permit: true })).status).toBe(403);
    expect((await owner().post(`${C()}/network/case-posts/${post}/approve`, { permit: true })).status).toBe(200);
    expect((await owner().post(`/network/posts/${post}`, { op: 'publish' })).status).toBe(200);
    expect((await P1().get(`/network/posts/${post}`)).status).toBe(200);
  });

  it('withdrawn by the business: closed to the network at once; the author sees why', async () => {
    expect((await owner().post(`${C()}/network/case-posts/${post}/withdraw`, { reason: 'Kayıt yeniden açıldı, paylaşım erken.' })).body.status).toBe('withdrawn');
    expect((await P1().get(`/network/posts/${post}`)).status).toBe(404);
    expect((await P1().get('/network/feed')).body.posts.map((x: any) => x.id)).not.toContain(post);
    expect((await P1().post(`/network/posts/${post}/comments`, { body: 'Teşekkürler' })).status).toBe(404);
    expect((await owner().get(`/network/posts/${post}`)).body.withdrawn.reason).toContain('erken');
    expect((await owner().post(`/network/posts/${post}`, { op: 'publish' })).body.error.code).toBe('WITHDRAWN');
  });
});

describe('reports: status for the reporter; appeals not decided by the first moderator', () => {
  let post: string, rep: string;
  it('reporter follows the status; a non-moderator has no queue', async () => {
    post = (await P1().post('/network/posts', { body: 'Bu kural yasal zorunluluktur, uymayan kapatılır.', publish: true })).body.id;
    rep = (await owner().post('/network/reports', { targetType: 'post', targetId: post, reason: 'misleading', details: 'Kaynak yok.' })).body.id;
    expect((await owner().get('/network/my-reports')).body[0]).toMatchObject({ id: rep, statusLabel: 'İnceleniyor' });
    expect((await P2().get('/network/moderation/reports')).status).toBe(403);
    expect((await P2().get('/network/moderation/appeals')).status).toBe(403);
    await client(env, mod1.token).post(`/network/moderation/reports/${rep}`, { decision: 'hide', notes: 'Kaynaksız biçimde mevzuat gibi sunulmuş.' });
    expect((await owner().get('/network/my-reports')).body[0]).toMatchObject({ statusLabel: 'İçerik gizlendi', decision_notes: expect.stringContaining('Kaynaksız') });
  });

  it('the author appeals once; the first moderator cannot decide it; another one can overturn', async () => {
    const d = (await P1().get('/network/decisions-on-me')).body;
    expect(d.map((x: any) => x.id)).toContain(rep);
    expect((await P1().post(`/network/reports/${rep}/appeal`, { reason: 'Kısa' })).status).toBe(422);
    const ap = (await P1().post(`/network/reports/${rep}/appeal`, { reason: 'Kaynak ekledim, yanlış anlaşılmış: bu bir iyi uygulama önerisiydi.' })).body.id;
    expect((await P1().post(`/network/reports/${rep}/appeal`, { reason: 'Kaynak ekledim, yanlış anlaşılmış: bu bir iyi uygulama önerisiydi.' })).body.error.code).toBe('ALREADY_APPEALED');
    const q1 = (await client(env, mod1.token).get('/network/moderation/appeals')).body;
    expect(q1.find((x: any) => x.id === ap).mine_first).toBe(true);
    expect((await client(env, mod1.token).post(`/network/moderation/appeals/${ap}`, { decision: 'overturned', notes: 'Kendi kararımı geri alıyorum.' })).status).toBe(403);
    expect((await client(env, mod2.token).post(`/network/moderation/appeals/${ap}`, { decision: 'overturned', notes: 'İyi uygulama olarak okunabilir; gizleme kaldırıldı.' })).body.status).toBe('overturned');
    expect((await owner().get(`/network/posts/${post}`)).status).toBe(200);
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM audit_events WHERE event_type = 'network.appeal_decided'`)).rows[0].n).toBe(1);
  });
});

describe('demo reset', () => {
  it('a demo business with a case share is reset without errors', async () => {
    await env.ownerDb.query(`SELECT demo_reset()`);
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM network_posts WHERE case_company_id = $1`, [demo.companyId])).rows[0].n).toBe(0);
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM companies WHERE id = $1`, [demo.companyId])).rows[0].n).toBe(0);
  });
});
