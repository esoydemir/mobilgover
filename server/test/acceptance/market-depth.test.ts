import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { createSession } from '../../src/services/principal';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Group 3: selected-provider requests with comparison, provider search filters, appointments, request-linked messages,
 * reviews tied to accepted jobs with a distribution, and persisted "helpful" / "saved" on network posts.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let p1: { id: string; token: string }, p2: { id: string; token: string }, outsider: { id: string; token: string };
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const P1 = () => client(env, p1.token);
const P2 = () => client(env, p2.token);
const OUT = () => client(env, outsider.token);
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const quote = (price: number) => ({ scope: 'Conta ve gaz kontrolü', exclusions: 'Kompresör', priceNet: price, vatRate: 20, materials: 'Conta', durationText: '2 saat', warrantyText: '3 ay', validUntil: later(48), deliverable: 'Servis raporu (PDF)' });
const profileOf = async (token: string) => (await client(env, token).get('/pro/profile')).body.profile.id as string;

beforeAll(async () => {
  env = await freshEnv();
  const platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  p1 = await seedDemoProvider(env.db, platform.marketReviewer.id, 'p1.depth@ornek.test');
  p2 = await seedDemoProvider(env.db, platform.marketReviewer.id, 'p2.depth@ornek.test');
  await env.ownerDb.query(`UPDATE professional_profiles SET display_name = 'Ayşe Soğutma', city = 'Ankara', district = 'Çankaya', headline = 'Endüstriyel soğutma servisi' WHERE user_id = $1`, [p2.id]);
  outsider = await env.db.system(async tx => {
    const id = (await tx.query<{ id: string }>(`INSERT INTO users (display_name) VALUES ('Üçüncü uzman') RETURNING id`)).rows[0]!.id;
    return { id, token: await createSession(tx, id, 24) };
  });
});
afterAll(async () => { await env?.close(); });

describe('provider search filters', () => {
  it('filters by text and city; the review summary rides along; no invented fields', async () => {
    const all = (await owner().get(`${C()}/providers?category=refrigeration_service`)).body as any[];
    expect(all.length).toBe(2);
    const ank = (await owner().get(`${C()}/providers?category=refrigeration_service&city=ankara`)).body as any[];
    expect(ank.map(x => x.display_name)).toEqual(['Ayşe Soğutma']);
    expect(((await owner().get(`${C()}/providers?category=refrigeration_service&q=endüstriyel`)).body as any[]).length).toBe(1);
    expect(((await owner().get(`${C()}/providers?category=refrigeration_service&q=%25`)).body as any[]).length).toBe(2); // wildcard is not a wildcard
    expect(((await owner().get(`${C()}/providers?category=refrigeration_service&reviewedOnly=true`)).body as any[]).length).toBe(0); // nobody reviewed yet
    expect(all[0]).toMatchObject({ reviewed_jobs: 0, rating: null });
  });
});

describe('a request sent to chosen providers', () => {
  let reqId: string, id1: string, id2: string, idOut: string;

  it('goes only to the chosen providers; others cannot see, quote or write to it', async () => {
    id1 = await profileOf(p1.token); id2 = await profileOf(p2.token);
    const r = await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Soğutucu bakımı (seçili)', description: 'İki uzmandan teklif istiyorum.', city: 'İstanbul', invitedProfileIds: [id1, id2] });
    expect(r.status).toBe(201);
    reqId = r.body.id;
    expect(((await P1().get('/pro/inbox')).body.requests as any[]).map(x => x.id)).toContain(reqId);
    expect(((await P2().get('/pro/inbox')).body.requests as any[]).map(x => x.id)).toContain(reqId);
    const tooMany = await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Çok uzman', description: 'Altı uzman.', city: 'İstanbul', invitedProfileIds: Array(6).fill(id1) });
    expect(tooMany.status).toBe(422);
  });

  it('quotes from both are compared like for like; the mode says so', async () => {
    expect((await P1().post(`/pro/requests/${reqId}/quotes`, quote(1500))).status).toBe(201);
    expect((await P2().post(`/pro/requests/${reqId}/quotes`, quote(1300))).status).toBe(201);
    const d = (await owner().get(`${C()}/service-requests/${reqId}`)).body;
    expect(d.mode).toBe('selected');
    expect(d.invitedProviders).toHaveLength(2);
    expect(d.modeNote).toMatch(/Seçtiğin 2 uzmana/);
    expect(d.comparison).not.toBeNull();
    expect(d.quotes).toHaveLength(2);
  });

  it('an unselected provider sees nothing: not in the inbox, quoting looks like a missing request', async () => {
    await OUT().post('/pro/profile', { kind: 'individual', displayName: 'Üçüncü uzman', headline: 'Soğutma', city: 'İstanbul', bio: 'Deneme profili.' });
    expect(((await OUT().get('/pro/inbox')).body.requests ?? []).map((x: any) => x.id)).not.toContain(reqId);
    expect((await OUT().post(`/pro/requests/${reqId}/quotes`, quote(900))).status).toBe(404);
    idOut = await profileOf(outsider.token);
    expect((await owner().get(`${C()}/service-requests/${reqId}/messages?profileId=${idOut}`)).status).toBe(404);
  });

  it('messages stay inside the request and the provider; the business name is hidden until the award', async () => {
    const m1 = await owner().post(`${C()}/service-requests/${reqId}/messages`, { profileId: id1, body: 'Cuma sabahı gelebilir misiniz?' });
    expect(m1.status).toBe(201);
    const t1 = (await P1().get(`/pro/requests/${reqId}/messages`)).body;
    expect(t1.messages).toHaveLength(1);
    expect(t1.messages[0]).toMatchObject({ side: 'business', body: 'Cuma sabahı gelebilir misiniz?', mine: false });
    expect(JSON.stringify(t1)).not.toMatch(/Kahve Durağı|Kadıköy/);
    expect(t1.awarded).toBe(false);
    expect((await P1().post(`/pro/requests/${reqId}/messages`, { body: 'Evet, 09:00 uygun.' })).status).toBe(201);
    // The other provider has a separate thread and never sees this one.
    expect((await P2().get(`/pro/requests/${reqId}/messages`)).body.messages).toHaveLength(0);
    expect((await owner().get(`${C()}/service-requests/${reqId}/messages?profileId=${id1}`)).body.messages).toHaveLength(2);
    expect((await staff().get(`${C()}/service-requests/${reqId}/messages?profileId=${id1}`)).status).toBe(404);
    expect((await owner().post(`${C()}/service-requests/${reqId}/messages`, { profileId: id1, body: '   ' })).status).toBe(422);
    const notes = (await P1().get('/pro/notifications')).body;
    expect(JSON.stringify(notes)).toMatch(/Talebinde yeni mesaj/);
  });

  describe('appointment', () => {
    let jobId: string, apptId: string;
    const slotOf = (h: number) => ({ startsAt: later(h), endsAt: later(h + 2) });

    it('after the award either side proposes a slot; the proposer cannot confirm it; the other side can', async () => {
      const q = (await owner().get(`${C()}/service-requests/${reqId}`)).body.quotes.find((x: any) => x.provider_profile_id === id2).id;
      jobId = (await owner().post(`${C()}/quotes/${q}/accept`)).body.jobId;
      const early = await P1().post(`/pro/jobs/${jobId}/appointments`, slotOf(24));
      expect(early.status).toBe(404); // the other provider has no access to this job
      const a = await manager().post(`${C()}/jobs/${jobId}/appointments`, { ...slotOf(48), note: 'Giriş arka kapıdan.' });
      expect(a.status).toBe(201);
      apptId = a.body.id;
      expect((await manager().post(`${C()}/appointments/${apptId}/decision`, { accept: true })).status).toBe(403);
      const cal = (await P2().get('/pro/calendar')).body.items;
      expect(cal).toHaveLength(1);
      expect(cal[0]).toMatchObject({ id: apptId, status: 'proposed', awaitingMyAnswer: true, companyName: expect.any(String) });
      expect((await P2().post(`/pro/appointments/${apptId}/decision`, { accept: false })).status).toBe(422); // a refusal needs a reason
    });

    it('a change supersedes the earlier slot and keeps it; confirming makes it the live slot; cancelling needs a reason', async () => {
      const re = await P2().post(`/pro/jobs/${jobId}/appointments`, { ...slotOf(72), note: 'Cuma yerine pazartesi.' });
      expect(re.status).toBe(201);
      const h = (await owner().get(`${C()}/jobs/${jobId}/appointments`)).body;
      expect(h.history.map((x: any) => x.status)).toEqual(['superseded', 'proposed']);
      expect(h.canAnswer).toBe(true);
      expect((await owner().post(`${C()}/appointments/${re.body.id}/decision`, { accept: true })).status).toBe(200);
      const after = (await owner().get(`${C()}/jobs/${jobId}/appointments`)).body;
      expect(after.live).toMatchObject({ id: re.body.id, status: 'confirmed' });
      expect((await P2().post(`/pro/appointments/${re.body.id}/cancel`, { reason: '' })).status).toBe(422);
      expect((await P2().post(`/pro/appointments/${re.body.id}/cancel`, { reason: 'Araç arızası' })).status).toBe(200);
      expect((await owner().get(`${C()}/jobs/${jobId}/appointments`)).body.live).toBeNull();
      expect((await P2().get('/pro/calendar')).body.items).toHaveLength(0);
      const types = (await env.ownerDb.query(`SELECT event_type FROM audit_events WHERE event_type LIKE 'service.appointment_%' ORDER BY seq`)).rows.map((r: any) => r.event_type);
      expect(types).toEqual(['service.appointment_proposed', 'service.appointment_rescheduled', 'service.appointment_confirmed', 'service.appointment_cancelled']);
    });

    it('no appointment can be planned after check-in; a past slot is refused', async () => {
      expect((await owner().post(`${C()}/jobs/${jobId}/appointments`, { startsAt: later(-5), endsAt: later(-3) })).status).toBe(422);
      const code = (await owner().get(`${C()}/service-requests/${reqId}`)).body.job.checkin_code;
      await P2().post(`/pro/jobs/${jobId}/check-in`, { code });
      expect((await owner().post(`${C()}/jobs/${jobId}/appointments`, slotOf(96))).status).toBe(409);
    });

    it('the message thread now names the business to the awarded provider', async () => {
      expect((await P2().get(`/pro/requests/${reqId}/messages`)).body.awarded).toBe(true);
    });

    it('a review rests on an accepted job; the profile shows the distribution of reviewed jobs only', async () => {
      const f = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('depth-rapor')]);
      const sha = (await import('node:crypto')).createHash('sha256').update(f).digest('hex');
      const rep = await P2().post(`/pro/jobs/${jobId}/report`, { report: 'Conta değiştirildi, gaz basıncı normal, ölçümler rapora eklendi.', file: { mime: 'application/pdf', sha256: sha, sizeBytes: f.length } });
      await P2().put(`/pro/jobs/${jobId}/report/${rep.body.evidenceId}/content`, f, 'application/pdf');
      expect((await owner().post(`${C()}/jobs/${jobId}/review`, { quality: 5, timeliness: 4, communication: 5, showOnProfile: true })).status).toBe(422); // not accepted yet
      expect((await owner().post(`${C()}/jobs/${jobId}/acceptance`, { accept: true, note: 'Rapor okundu.' })).status).toBe(200);
      const rv = await owner().post(`${C()}/jobs/${jobId}/review`, { quality: 5, timeliness: 4, communication: 5, comment: 'Zamanında geldi.', showOnProfile: true });
      expect(rv.status).toBe(201);
      const prof = (await owner().get(`/professionals/${id2}`)).body;
      const s = prof.serviceHistory.summary;
      expect(s.count).toBe(1);
      expect(s.distribution).toEqual([{ stars: 1, count: 0 }, { stars: 2, count: 0 }, { stars: 3, count: 0 }, { stars: 4, count: 0 }, { stars: 5, count: 1 }]);
      expect(s.responseTime).toBeNull(); // not measured: nothing invented
      const filtered = (await owner().get(`${C()}/providers?category=refrigeration_service&reviewedOnly=true`)).body as any[];
      expect(filtered.map(x => x.id)).toEqual([id2]);
      expect(filtered[0]).toMatchObject({ reviewed_jobs: 1, rating: 4.7 });
    });
  });
});

describe('network: "helpful" and "saved" persist', () => {
  let postId: string, ali: { id: string; token: string }, bo: { id: string; token: string };
  const A = () => client(env, ali.token), B = () => client(env, bo.token);
  const mk = (name: string) => env.db.system(async tx => {
    const id = (await tx.query<{ id: string }>(`INSERT INTO users (display_name) VALUES ($1) RETURNING id`, [name])).rows[0]!.id;
    return { id, token: await createSession(tx, id, 24) };
  });

  it('a reader marks a published post helpful and saves it; marks survive reloads and are per person', async () => {
    ali = await mk('Ali'); bo = await mk('Bo');
    for (const [c, n] of [[A(), 'Ali Yılmaz'], [B(), 'Bo Kaya']] as const) await c.post('/network/profile', { displayName: n, title: 'Soğutma ustası', city: 'İstanbul', specialties: ['soğutma'], categories: ['refrigeration_service'] });
    postId = (await A().post('/network/posts', { body: 'Kapı contası kontrolü için kısa bir ipucu paylaşıyorum.', publish: true })).body.id;
    expect((await A().post(`/network/posts/${postId}/reactions`, { kind: 'helpful', on: true })).status).toBe(422); // own post cannot be rated helpful
    const h = await B().post(`/network/posts/${postId}/reactions`, { kind: 'helpful', on: true });
    expect(h.status).toBe(200);
    expect(h.body).toMatchObject({ helpfulCount: 1, helpfulByMe: true, savedByMe: false });
    expect((await B().post(`/network/posts/${postId}/reactions`, { kind: 'helpful', on: true })).body.helpfulCount).toBe(1); // idempotent
    expect((await B().post(`/network/posts/${postId}/reactions`, { kind: 'saved', on: true })).body).toMatchObject({ savedByMe: true });
    const feedB = (await B().get('/network/feed')).body.posts.find((x: any) => x.id === postId);
    expect(feedB).toMatchObject({ helpfulCount: 1, helpfulByMe: true, savedByMe: true });
    const feedA = (await A().get('/network/feed')).body.posts.find((x: any) => x.id === postId);
    expect(feedA).toMatchObject({ helpfulCount: 1, helpfulByMe: false, savedByMe: false }); // "saved" is private
    expect((await B().get('/network/feed?scope=saved')).body.posts.map((x: any) => x.id)).toEqual([postId]);
    expect((await A().get('/network/feed?scope=saved')).body.posts).toEqual([]);
    expect((await B().get(`/network/posts/${postId}`)).body).toMatchObject({ helpfulCount: 1, savedByMe: true });
  });

  it('can be taken back; a draft, hidden or unknown post cannot be reacted to', async () => {
    expect((await B().post(`/network/posts/${postId}/reactions`, { kind: 'helpful', on: false })).body).toMatchObject({ helpfulCount: 0, helpfulByMe: false });
    expect((await B().post(`/network/posts/${postId}/reactions`, { kind: 'saved', on: false })).body.savedByMe).toBe(false);
    const draft = (await A().post('/network/posts', { body: 'Henüz yayımlanmamış taslak yazı.', publish: false })).body.id;
    expect((await B().post(`/network/posts/${draft}/reactions`, { kind: 'saved', on: true })).status).toBe(404);
    expect((await B().post(`/network/posts/00000000-0000-4000-8000-000000000009/reactions`, { kind: 'saved', on: true })).status).toBe(404);
  });
});
