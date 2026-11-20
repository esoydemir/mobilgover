import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedPlatform } from '../../src/seed/demo';
import { client, freshEnv, type Env } from '../support/env';

/**
 * A real (non-example) rule cannot be approved or published on the date it was drafted with: an authorised person must state the real
 * effective date AND its basis. Nothing defaults, the author cannot do it, and editing the date afterwards withdraws the confirmation.
 */
let env: Env;
let platform: Awaited<ReturnType<typeof seedPlatform>>;
const author = () => client(env, platform.author.token);
const reviewer = () => client(env, platform.reviewer.token);
const specialist = () => client(env, platform.specialist.token);
const draft = (extra: Record<string, unknown> = {}) => ({
  code: 'MV-TEST-TARIH', title: 'Kaynaklı taslak (tarih kapısı testi)', kind: 'good_practice', isExample: false, provisionIds: [], ambiguityNote: 'Dayanak: test belgesi md. 1.',
  condition: { fact: 'activity.food_preparation', op: 'eq', value: true },
  obligationTitle: 'Sıcaklık kaydı işletme limitine göre tutulur', obligationSummary: 'Limit kuraldan gelmez; işletme kendi planına göre girer.',
  effectiveFrom: '2026-12-01', effectiveTo: null, changeReason: 'Taslak; tarih yer tutucudur.', requiredReviewAreas: ['food_safety'],
  templates: [{ code: 'kayit', title: 'Kayıt', instructions: 'Değeri kaydet ve fotoğrafla.', recurrence: { freq: 'daily', at: '09:00' }, evidence: [{ kind: 'photo', min: 1 }], limits: [], severity: 'minor', hazardType: 'hygiene' }],
  ...extra,
});
let id: string;

beforeAll(async () => { env = await freshEnv(); platform = await seedPlatform(env.db); });
afterAll(async () => { await env?.close(); });

describe('explicit effective date and basis for real rules', () => {
  it('the draft is a placeholder: the detail says so; review cannot start, and approval is refused even if it somehow were in review', async () => {
    id = (await author().post('/admin/rule-versions', draft())).body.id;
    expect((await author().get(`/admin/rule-versions/${id}`)).body).toMatchObject({ effectivePlaceholder: true, effectiveConfirmation: null, effectiveFrom: expect.stringContaining('2026-12-01') });
    const sub = await author().post(`/admin/rule-versions/${id}/submit`);
    expect(sub.status).toBe(409);
    expect(sub.body.error.code).toBe('EFFECTIVE_NOT_CONFIRMED');
    // Defence in depth: even forced into review by hand (database), the approval itself still refuses.
    await env.ownerDb.query(`UPDATE rule_versions SET status = 'in_review' WHERE id = $1`, [id]);
    expect((await specialist().post(`/admin/rule-versions/${id}/area-review`, { area: 'food_safety', decision: 'approved', notes: 'Alan incelemesi tamam.' })).status).toBe(200);
    const r = await reviewer().post(`/admin/rule-versions/${id}/approve`, { reason: 'Kaynak okundu, onaylıyorum.' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('EFFECTIVE_NOT_CONFIRMED');
    await env.ownerDb.query(`UPDATE rule_versions SET status = 'draft' WHERE id = $1`, [id]);
  });
  it('the author cannot confirm; missing/invalid date and empty or short basis are refused; nothing is defaulted', async () => {
    expect((await author().post(`/admin/rule-versions/${id}/confirm-effective`, { date: '2026-12-01', basis: 'Resmî Gazete 33426 md. 22' })).status).toBe(403);
    expect((await reviewer().post(`/admin/rule-versions/${id}/confirm-effective`, { basis: 'Resmî Gazete 33426 md. 22' })).status).toBe(422);
    expect((await reviewer().post(`/admin/rule-versions/${id}/confirm-effective`, { date: '1.12.2026', basis: 'Resmî Gazete 33426 md. 22' })).status).toBe(422);
    expect((await reviewer().post(`/admin/rule-versions/${id}/confirm-effective`, { date: '2026-12-01', basis: '   ' })).status).toBe(422);
    expect((await reviewer().post(`/admin/rule-versions/${id}/confirm-effective`, { date: '2026-12-01', basis: 'kısa' })).status).toBe(422);
    expect((await author().post(`/admin/rule-versions/${id}/submit`)).body.error.code).toBe('EFFECTIVE_NOT_CONFIRMED');
  });
  it('after the reviewer states date and basis, approval works; the confirmation is on the audit trail with who/when/basis', async () => {
    const ok = await reviewer().post(`/admin/rule-versions/${id}/confirm-effective`, { date: '2027-01-15', basis: 'Resmî Gazete 33426, geçici md. 1: uyum 30/4/2027; uzman kararı' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const d = (await reviewer().get(`/admin/rule-versions/${id}`)).body;
    expect(d.effectivePlaceholder).toBe(false);
    expect(d.effectiveFrom).toContain('2027-01-15');
    expect(d.effectiveConfirmation.basis).toContain('geçici md. 1');
    const ev = (await env.ownerDb.query(`SELECT actor_id, payload FROM audit_events WHERE event_type = 'rule.effective_confirmed' AND entity_id = $1`, [id])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].actor_id).toBe(platform.reviewer.id);
    expect(ev[0].payload).toMatchObject({ date: '2027-01-15', previousPlaceholder: '2026-12-01' });
    expect((await author().post(`/admin/rule-versions/${id}/submit`)).status).toBe(200);
    expect((await specialist().post(`/admin/rule-versions/${id}/area-review`, { area: 'food_safety', decision: 'approved', notes: 'Alan incelemesi tamam (ikinci).' })).status).toBe(200);
    expect((await reviewer().post(`/admin/rule-versions/${id}/approve`, { reason: 'Tarih ve dayanak belirlendi; onay.' })).status).toBe(200);
    // Once in review the date is locked.
    expect((await reviewer().post(`/admin/rule-versions/${id}/confirm-effective`, { date: '2027-05-01', basis: 'Sonradan değiştirme denemesi (reddedilmeli)' })).status).toBe(409);
  });
  it('editing the date of a draft withdraws an earlier confirmation', async () => {
    const id2 = (await author().post('/admin/rule-versions', draft({ code: 'MV-TEST-TARIH-2' }))).body.id;
    expect((await reviewer().post(`/admin/rule-versions/${id2}/confirm-effective`, { date: '2027-02-01', basis: 'Tebliğ md. 5; uzman kararı' + ' (yeterince uzun)' })).status).toBe(200);
    expect((await author().putJson(`/admin/rule-versions/${id2}`, draft({ code: 'MV-TEST-TARIH-2', effectiveFrom: '2027-03-01' }))).status).toBe(200);
    expect((await author().get(`/admin/rule-versions/${id2}`)).body).toMatchObject({ effectivePlaceholder: true, effectiveConfirmation: null });
  });
});
