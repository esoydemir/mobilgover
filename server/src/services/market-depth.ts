import type { Tx } from '../db/pool';
import { conflict, forbidden, invalid, notFound } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { notify, notifyUser, siteManagers } from './notifications';

/*
 * Appointments and request-linked messages of the service marketplace.
 *  - An appointment belongs to an awarded job that has not been checked in yet. One live slot at a time; a change supersedes the
 *    earlier slot and keeps it in the history. The other side confirms or declines; either side can cancel with a reason.
 *  - Messages belong to one request and one provider. The provider does not learn who the business is until their quote is accepted.
 * Provider-side calls run in system mode, so every query filters by the provider's own profile explicitly.
 */

const today = () => new Date().toISOString().slice(0, 10);
type Side = 'business' | 'provider';

async function providerProfile(tx: Tx, p: Principal) {
  const r = (await tx.query(`SELECT id, display_name, status FROM professional_profiles WHERE user_id = $1`, [p.userId])).rows[0];
  if (!r) throw notFound('Mesleki profil');
  if (r.status !== 'active') throw forbidden('Profil askıya alınmış.');
  return r as { id: string; display_name: string; status: string };
}

async function jobFor(tx: Tx, jobId: string) {
  const j = (await tx.query(`SELECT j.*, r.site_id, r.title, r.created_by, pp.user_id AS provider_user FROM service_jobs j JOIN service_requests r ON r.id = j.request_id
     JOIN professional_profiles pp ON pp.id = j.provider_profile_id WHERE j.id = $1`, [jobId])).rows[0];
  if (!j) throw notFound('İş');
  return j;
}

/** Which side the caller is on for this job; the other side is the one who gets told. */
async function sideOf(tx: Tx, p: Principal, j: any): Promise<Side> {
  if (j.provider_user === p.userId) return 'provider';
  if (can(p, 'service.request', { companyId: j.company_id, siteId: j.site_id }).ok) return 'business';
  throw notFound('İş');
}

const slot = (startsAt: string, endsAt: string) => {
  const a = new Date(startsAt), b = new Date(endsAt);
  if (Number.isNaN(+a) || Number.isNaN(+b)) throw invalid('Tarih geçersiz.');
  if (a.getTime() < Date.now() - 60_000) throw invalid('Randevu geçmişte olamaz.');
  if (b <= a) throw invalid('Bitiş başlangıçtan sonra olmalı.');
  if (b.getTime() - a.getTime() > 12 * 3600_000) throw invalid('Randevu en fazla 12 saat olabilir.');
};

/** Either side proposes a slot. A live proposal or confirmed slot is replaced (kept as superseded). */
export async function proposeAppointment(tx: Tx, p: Principal, jobId: string, b: { startsAt: string; endsAt: string; note?: string | null }) {
  const j = await jobFor(tx, jobId);
  const side = await sideOf(tx, p, j);
  if (j.status !== 'scheduled') throw conflict('INVALID_STATE', 'Randevu yalnız işe başlanmadan önce planlanır.');
  slot(b.startsAt, b.endsAt);
  const prev = (await tx.query(`UPDATE service_appointments SET status = 'superseded', decided_by = $2, decided_at = now(), reason = 'Yeni zaman önerildi'
     WHERE job_id = $1 AND status IN ('proposed','confirmed') RETURNING id, status`, [jobId, p.userId])).rows[0];
  const a = (await tx.query<{ id: string }>(
    `INSERT INTO service_appointments (company_id, job_id, starts_at, ends_at, proposed_by, proposed_side, note) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [j.company_id, jobId, b.startsAt, b.endsAt, p.userId, side, b.note?.trim() || null])).rows[0]!;
  await appendAudit(tx, { companyId: j.company_id, actorId: p.userId, eventType: prev ? 'service.appointment_rescheduled' : 'service.appointment_proposed', entityType: 'service_job', entityId: jobId,
    payload: { appointmentId: a.id, startsAt: b.startsAt, endsAt: b.endsAt, side, replaced: prev?.id ?? null } });
  await told(tx, j, side, prev ? 'Randevu zamanı değiştirilmek isteniyor' : 'Randevu zamanı öneriliyor', `${j.title} · ${new Date(b.startsAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`, `appt:${a.id}`);
  return { id: a.id, status: 'proposed', side };
}

/** The other side confirms or declines. The proposer cannot confirm their own proposal. */
export async function decideAppointment(tx: Tx, p: Principal, appointmentId: string, b: { accept: boolean; reason?: string | null }) {
  const a = (await tx.query(`SELECT * FROM service_appointments WHERE id = $1 FOR UPDATE`, [appointmentId])).rows[0];
  if (!a) throw notFound('Randevu');
  const j = await jobFor(tx, a.job_id);
  const side = await sideOf(tx, p, j);
  if (a.status !== 'proposed') throw conflict('INVALID_STATE', 'Bu randevu artık yanıt beklemiyor.');
  if (side === a.proposed_side) throw forbidden('Kendi önerini onaylayamazsın; karşı tarafın yanıtı beklenir.');
  if (!b.accept && !b.reason?.trim()) throw invalid('Reddederken kısa bir gerekçe yaz.');
  await tx.query(`UPDATE service_appointments SET status = $2, decided_by = $3, decided_at = now(), reason = $4 WHERE id = $1`,
    [appointmentId, b.accept ? 'confirmed' : 'declined', p.userId, b.reason?.trim() || null]);
  await appendAudit(tx, { companyId: j.company_id, actorId: p.userId, eventType: b.accept ? 'service.appointment_confirmed' : 'service.appointment_declined', entityType: 'service_job', entityId: j.id,
    payload: { appointmentId, side, reason: b.reason?.trim() || null } });
  await told(tx, j, side, b.accept ? 'Randevu onaylandı' : 'Randevu önerisi reddedildi', `${j.title}${b.reason ? ` · ${b.reason.trim()}` : ''}`, `appt-d:${appointmentId}`);
  return { status: b.accept ? 'confirmed' : 'declined' };
}

export async function cancelAppointment(tx: Tx, p: Principal, appointmentId: string, reason: string) {
  const a = (await tx.query(`SELECT * FROM service_appointments WHERE id = $1 FOR UPDATE`, [appointmentId])).rows[0];
  if (!a) throw notFound('Randevu');
  const j = await jobFor(tx, a.job_id);
  const side = await sideOf(tx, p, j);
  if (!['proposed', 'confirmed'].includes(a.status)) throw conflict('INVALID_STATE', 'Bu randevu zaten kapanmış.');
  if (reason.trim().length < 3) throw invalid('İptal için gerekçe yaz.');
  await tx.query(`UPDATE service_appointments SET status = 'cancelled', decided_by = $2, decided_at = now(), reason = $3 WHERE id = $1`, [appointmentId, p.userId, reason.trim()]);
  await appendAudit(tx, { companyId: j.company_id, actorId: p.userId, eventType: 'service.appointment_cancelled', entityType: 'service_job', entityId: j.id, payload: { appointmentId, side, reason: reason.trim() } });
  await told(tx, j, side, 'Randevu iptal edildi', `${j.title} · ${reason.trim()}`, `appt-c:${appointmentId}`);
  return { status: 'cancelled' };
}

async function told(tx: Tx, j: any, from: Side, title: string, body: string, key: string) {
  if (from === 'business') {
    await notifyUser(tx, { companyId: j.company_id, siteId: null, userId: j.provider_user, kind: 'appointment', entityType: 'pro_job', entityId: j.id, dedupeKey: key, title, body });
  } else {
    await notify(tx, { companyId: j.company_id, siteId: j.site_id, userIds: [j.created_by, ...(await siteManagers(tx, j.company_id, j.site_id))],
      kind: 'appointment', entityType: 'service_request', entityId: j.request_id, dedupeKey: key, title, body });
  }
}

const apptView = (a: any) => ({ id: a.id, jobId: a.job_id, startsAt: a.starts_at, endsAt: a.ends_at, status: a.status, proposedSide: a.proposed_side, note: a.note, reason: a.reason, decidedAt: a.decided_at, createdAt: a.created_at });

/** History of a job's appointments (business side: needs the right on the request's site). */
export async function jobAppointments(tx: Tx, p: Principal, jobId: string) {
  const j = await jobFor(tx, jobId);
  const side = await sideOf(tx, p, j);
  const rows = (await tx.query(`SELECT * FROM service_appointments WHERE job_id = $1 ORDER BY created_at, decided_at NULLS LAST`, [jobId])).rows;
  const live = rows.find(r => ['proposed', 'confirmed'].includes(r.status)) ?? null;
  return { side, live: live ? apptView(live) : null, history: rows.map(apptView), canAnswer: !!live && live.status === 'proposed' && live.proposed_side !== side };
}

/** Provider calendar: live appointments of the provider's own jobs in a window. The business name is shown because the job is awarded to them. */
export async function providerCalendar(tx: Tx, p: Principal, f: { from: string; to: string }) {
  const pr = await providerProfile(tx, p);
  const rows = (await tx.query(
    `SELECT a.*, r.title, r.city, co.name AS company_name, s.name AS site_name FROM service_appointments a JOIN service_jobs j ON j.id = a.job_id
       JOIN service_requests r ON r.id = j.request_id JOIN companies co ON co.id = j.company_id JOIN sites s ON s.id = r.site_id
      WHERE j.provider_profile_id = $1 AND a.status IN ('proposed','confirmed') AND a.ends_at >= $2::timestamptz AND a.starts_at < $3::timestamptz ORDER BY a.starts_at`,
    [pr.id, f.from, f.to])).rows;
  return { items: rows.map(r => ({ ...apptView(r), title: r.title, city: r.city, companyName: r.company_name, siteName: r.site_name, awaitingMyAnswer: r.status === 'proposed' && r.proposed_side === 'business' })) };
}

// ── Messages ──

type Thread = { requestId: string; profileId: string; companyId: string; siteId: string; title: string; createdBy: string; providerUser: string; providerName: string; awarded: boolean };

/** A thread exists for a provider who can see the request: open market, chosen, or holding a quote / the job. */
async function threadFor(tx: Tx, requestId: string, profileId: string): Promise<Thread> {
  const r = (await tx.query(`SELECT r.id, r.company_id, r.site_id, r.title, r.created_by, r.status, r.invited_profile_id, r.category_code FROM service_requests r WHERE r.id = $1`, [requestId])).rows[0];
  const pp = (await tx.query(`SELECT id, user_id, display_name, status FROM professional_profiles WHERE id = $1`, [profileId])).rows[0];
  if (!r || !pp || pp.status !== 'active') throw notFound('Hizmet talebi');
  const quoted = (await tx.query(`SELECT 1 FROM quotes WHERE request_id = $1 AND provider_profile_id = $2`, [requestId, profileId])).rowCount;
  const chosen = r.invited_profile_id === profileId || (await tx.query(`SELECT 1 FROM service_request_invites WHERE request_id = $1 AND profile_id = $2`, [requestId, profileId])).rowCount;
  const authorized = (await tx.query(`SELECT 1 FROM service_authorizations a WHERE a.profile_id = $1 AND a.category_code = $2 AND a.status = 'approved' AND a.valid_until >= $3::date`, [profileId, r.category_code, today()])).rowCount;
  const hasInvites = r.invited_profile_id || (await tx.query(`SELECT 1 FROM service_request_invites WHERE request_id = $1`, [requestId])).rowCount;
  if (!quoted && !chosen && !(authorized && !hasInvites)) throw notFound('Hizmet talebi');
  const awarded = !!(await tx.query(`SELECT 1 FROM service_jobs WHERE request_id = $1 AND provider_profile_id = $2`, [requestId, profileId])).rowCount;
  return { requestId, profileId, companyId: r.company_id, siteId: r.site_id, title: r.title, createdBy: r.created_by, providerUser: pp.user_id, providerName: pp.display_name, awarded };
}

const msgView = (m: any, me: string) => ({ id: m.id, side: m.sender_side as Side, body: m.body, at: m.created_at, mine: m.sender_id === me });

export async function businessThread(tx: Tx, p: Principal, companyId: string, requestId: string, profileId: string) {
  const t = await threadFor(tx, requestId, profileId);
  if (t.companyId !== companyId || !can(p, 'service.request', { companyId, siteId: t.siteId }).ok) throw notFound('Hizmet talebi');
  const rows = (await tx.query(`SELECT * FROM service_messages WHERE request_id = $1 AND profile_id = $2 ORDER BY created_at`, [requestId, profileId])).rows;
  return { providerName: t.providerName, requestTitle: t.title, messages: rows.map(m => msgView(m, p.userId)), note: 'Yazışma bu talebe bağlıdır; ödeme ve sözleşme bu uygulamanın dışındadır.' };
}

export async function businessSend(tx: Tx, p: Principal, companyId: string, requestId: string, profileId: string, body: string) {
  const t = await threadFor(tx, requestId, profileId);
  if (t.companyId !== companyId || !can(p, 'service.request', { companyId, siteId: t.siteId }).ok) throw notFound('Hizmet talebi');
  return send(tx, p, t, 'business', body);
}

export async function providerThread(tx: Tx, p: Principal, requestId: string) {
  const pr = await providerProfile(tx, p);
  const t = await threadFor(tx, requestId, pr.id);
  const rows = (await tx.query(`SELECT * FROM service_messages WHERE request_id = $1 AND profile_id = $2 ORDER BY created_at`, [requestId, pr.id])).rows;
  return { requestTitle: t.title, awarded: t.awarded, messages: rows.map(m => msgView(m, p.userId)), note: t.awarded ? 'Teklifin kabul edildi; işletme bilgisi iş ekranında.' : 'İşletmenin adı teklifin kabul edilmesinden sonra görünür.' };
}

export async function providerSend(tx: Tx, p: Principal, requestId: string, body: string) {
  const pr = await providerProfile(tx, p);
  const t = await threadFor(tx, requestId, pr.id);
  return send(tx, p, t, 'provider', body);
}

async function send(tx: Tx, p: Principal, t: Thread, side: Side, body: string) {
  const text = body.trim();
  if (text.length < 1 || text.length > 2000) throw invalid('Mesaj 1–2000 karakter olmalı.');
  const open = (await tx.query(`SELECT status FROM service_requests WHERE id = $1`, [t.requestId])).rows[0]?.status;
  if (open === 'cancelled') throw conflict('INVALID_STATE', 'İptal edilen talepte yeni mesaj yazılamaz.');
  const m = (await tx.query<{ id: string; created_at: string }>(`INSERT INTO service_messages (company_id, request_id, profile_id, sender_id, sender_side, body) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
    [t.companyId, t.requestId, t.profileId, p.userId, side, text])).rows[0]!;
  await appendAudit(tx, { companyId: t.companyId, actorId: p.userId, eventType: 'service.message_sent', entityType: 'service_request', entityId: t.requestId, payload: { side, profileId: t.profileId, length: text.length } });
  const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  if (side === 'business') {
    await notifyUser(tx, { companyId: t.companyId, siteId: null, userId: t.providerUser, kind: 'service_message', entityType: 'pro_request', entityId: t.requestId, dedupeKey: `msg:${m.id}`, title: 'Talebinde yeni mesaj', body: `${t.title} · ${preview}` });
  } else {
    await notify(tx, { companyId: t.companyId, siteId: t.siteId, userIds: [t.createdBy, ...(await siteManagers(tx, t.companyId, t.siteId))], kind: 'service_message', entityType: 'service_request', entityId: t.requestId,
      dedupeKey: `msg:${m.id}`, title: `${t.providerName} yazdı`, body: `${t.title} · ${preview}` });
  }
  return { id: m.id, at: m.created_at };
}
