import type { Tx } from '../db/pool';
import { conflict, forbidden, invalid, notFound } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { notify, notifyUser, siteManagers } from './notifications';
import { currentFacts } from './profile';
import { providersFor } from './marketplace';

/**
 * GH-06 · GoverUp: need-based service suggestions, complaints from both sides, and the operations lists.
 * Suggestions only read: they never open a request, share business data, or rank by payment. The user chooses.
 * Delivery of the service, review of the report document and closing of the nonconformity stay three separate decisions elsewhere;
 * a complaint here changes none of them.
 */
const ds = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: Date | string, b: Date) => Math.max(0, Math.floor((b.getTime() - new Date(a).getTime()) / 86400_000));

type Basis = { kind: 'profile' | 'case' | 'document' | 'location'; text: string; ref?: string };

/** Signals → categories. A category is suggested only with a reason the person can read and check. */
export async function suggestServices(tx: Tx, p: Principal, companyId: string, siteId: string) {
  if (!can(p, 'service.request', { companyId, siteId }).ok) throw forbidden();
  const site = (await tx.query<{ name: string }>(`SELECT name FROM sites WHERE id = $1 AND company_id = $2`, [siteId, companyId])).rows[0];
  if (!site) throw notFound('Şube');
  const facts = await currentFacts(tx, companyId, siteId);
  const city = typeof facts['site.province']?.value === 'string' ? (facts['site.province']!.value as string) : null;
  const district = typeof facts['site.district']?.value === 'string' ? (facts['site.district']!.value as string) : null;
  const need = new Map<string, Basis[]>();
  const add = (cat: string, b: Basis) => need.set(cat, [...(need.get(cat) ?? []), b]);

  // Profile: what the business said about this branch.
  const fridges = (await tx.query<{ id: string; name: string }>(`SELECT id, name FROM equipment WHERE company_id = $1 AND site_id = $2 AND type IN ('refrigerator','freezer') AND active`, [companyId, siteId])).rows;
  if (facts['storage.cold']?.value === true && fridges.length) add('refrigeration_service', { kind: 'profile', text: 'Bu şubede soğukta saklanan ürün olduğunu ve soğutucu kaydettiğinizi belirttiniz; düzenli bakım ve arıza için soğutma servisi gerekebilir.' });
  if (facts['utility.lpg']?.value === true) add('gas_installation_check', { kind: 'profile', text: 'Bu şubede LPG / tüp gaz kullandığınızı belirttiniz; bağlantı ve kaçak kontrolü için gaz tesisatı kontrolü gerekebilir.' });

  // Case: an open nonconformity at this branch, by its cause.
  const ncrs = (await tx.query<{ id: string; title: string; hazard_type: string }>(
    `SELECT id, title, hazard_type FROM nonconformities WHERE company_id = $1 AND site_id = $2 AND status <> 'closed' ORDER BY detected_at DESC LIMIT 20`, [companyId, siteId])).rows;
  for (const n of ncrs) {
    if (n.hazard_type === 'cold_chain_temperature') add('refrigeration_service', { kind: 'case', text: `Açık uygunsuzluk: “${n.title}” (soğuk zincir sıcaklığı).`, ref: n.id });
    if (n.hazard_type === 'gas_leak') add('gas_installation_check', { kind: 'case', text: `Açık uygunsuzluk: “${n.title}” (gaz).`, ref: n.id });
  }

  // Document need: a registered fridge with no current, reviewed maintenance report.
  for (const f of fridges) {
    const ok = (await tx.query(
      `SELECT 1 FROM documents d JOIN document_versions v ON v.document_id = d.id AND v.review_status = 'verified'
        WHERE d.company_id = $1 AND d.equipment_id = $2 AND d.doc_type = 'maintenance_report' AND d.archived_at IS NULL
          AND (v.valid_until IS NULL OR v.valid_until >= $3::date) LIMIT 1`, [companyId, f.id, today()])).rowCount;
    if (!ok && facts['storage.cold']?.value === true) add('refrigeration_service', { kind: 'document', text: `“${f.name}” için incelenmiş ve süresi geçerli bir bakım/servis raporu yok.`, ref: f.id });
  }

  const out = [];
  for (const [code, basis] of need) {
    const cat = (await tx.query<{ code: string; name: string; is_example: boolean }>(`SELECT code, name, is_example FROM service_categories WHERE code = $1`, [code])).rows[0];
    if (!cat) continue;
    const loc: Basis | null = city ? { kind: 'location', text: `Konum: ${district ? `${city} / ${district}` : city}` } : null;
    const found = city ? await providersFor(tx, code, { city }) : [];
    // Providers whose approval for this category ran out are not matched; say how many were left out and why.
    const left = city ? (await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM service_authorizations a JOIN professional_profiles pp ON pp.id = a.profile_id
        WHERE a.category_code = $1 AND a.status = 'approved' AND lower(pp.city) = lower($2) AND a.valid_until < $3::date`, [code, city, today()])).rows[0]!.n : 0;
    const now = new Date();
    out.push({
      category: { code: cat.code, name: cat.name, isExample: cat.is_example },
      urgency: basis.some(b => b.kind === 'case') ? 'case' : 'planned',
      reason: basis.map(b => b.text).join(' '), basis: loc ? [...basis, loc] : basis,
      providers: found.map(f => ({ id: f.id, name: f.display_name, city: f.city, district: f.district, verifiedCredentials: f.verified_credentials, rating: f.rating,
        authorization: { status: 'approved' as const, validUntil: f.auth_valid_until ? ds(f.auth_valid_until) : null,
          daysLeft: f.auth_valid_until ? Math.ceil((new Date(ds(f.auth_valid_until)).getTime() - now.getTime()) / 86400_000) : null } })),
      leftOutExpiredApproval: left,
      // No match: the business can still open an open request with location and category only.
      noMatch: found.length === 0,
      openRequest: found.length === 0 ? { siteId, categoryCode: code, city, note: 'Eşleşen onaylı uzman yok. Konum ve kategori bilgisiyle açık talep oluşturabilirsiniz; işletme adı teklif kabul edilene kadar paylaşılmaz.' } : null,
    });
  }
  out.sort((a, b) => Number(b.urgency === 'case') - Number(a.urgency === 'case'));
  return { siteId, siteName: site.name, location: city ? { city, district } : null, suggestions: out };
}

// ── Complaints ──

type Side = 'business' | 'provider';
async function loadJob(tx: Tx, jobId: string) {
  const j = (await tx.query(`SELECT j.id, j.company_id, j.status, j.provider_profile_id, r.site_id, r.title, pp.user_id AS provider_user
       FROM service_jobs j JOIN service_requests r ON r.id = j.request_id JOIN professional_profiles pp ON pp.id = j.provider_profile_id WHERE j.id = $1`, [jobId])).rows[0];
  if (!j) throw notFound('Hizmet işi');
  return j;
}

/** Either side opens one complaint per job at a time; the other side is told and may answer; a platform reviewer decides. */
export async function openComplaint(tx: Tx, p: Principal, side: Side, jobId: string, reason: string, companyId?: string) {
  const j = await loadJob(tx, jobId);
  if (side === 'business') {
    if (!companyId || j.company_id !== companyId || !can(p, 'service.request', { companyId, siteId: j.site_id }).ok) throw notFound('Hizmet işi');
  } else if (j.provider_user !== p.userId) throw notFound('Hizmet işi');
  if (reason.trim().length < 10) throw invalid('Şikâyetin nedenini en az bir cümleyle yaz.');
  const dup = (await tx.query(`SELECT 1 FROM service_complaints WHERE job_id = $1 AND opened_side = $2 AND status <> 'resolved'`, [jobId, side])).rowCount;
  if (dup) throw conflict('COMPLAINT_OPEN', 'Bu iş için açık bir şikâyetin zaten var.');
  const id = (await tx.query<{ id: string }>(`INSERT INTO service_complaints (company_id, job_id, opened_side, opened_by, reason) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [j.company_id, jobId, side, p.userId, reason.trim()])).rows[0]!.id;
  await appendAudit(tx, { companyId: j.company_id, actorId: p.userId, eventType: 'service.complaint_opened', entityType: 'service_job', entityId: jobId, payload: { complaintId: id, side, reason: reason.trim() } });
  if (side === 'business') {
    await notifyUser(tx, { companyId: j.company_id, siteId: null, userId: j.provider_user, kind: 'complaint_opened', entityType: 'pro_job', entityId: jobId, dedupeKey: `complaint:${id}`,
      title: 'İşletme hizmetin hakkında şikâyet açtı', body: reason.trim() });
  } else {
    await notify(tx, { companyId: j.company_id, siteId: j.site_id, userIds: await siteManagers(tx, j.company_id, j.site_id), kind: 'complaint_opened', entityType: 'service_request',
      entityId: (await tx.query<{ request_id: string }>(`SELECT request_id FROM service_jobs WHERE id = $1`, [jobId])).rows[0]!.request_id, dedupeKey: `complaint:${id}`,
      title: 'Uzman bu iş hakkında şikâyet açtı', body: reason.trim() });
  }
  return { id, status: 'open' as const };
}

/** The other side's answer. It does not close the complaint. */
export async function respondComplaint(tx: Tx, p: Principal, side: Side, complaintId: string, response: string, companyId?: string) {
  const c = (await tx.query(`SELECT * FROM service_complaints WHERE id = $1 FOR UPDATE`, [complaintId])).rows[0];
  if (!c) throw notFound('Şikâyet');
  const j = await loadJob(tx, c.job_id);
  if (side === 'business') { if (!companyId || j.company_id !== companyId || !can(p, 'service.request', { companyId, siteId: j.site_id }).ok) throw notFound('Şikâyet'); }
  else if (j.provider_user !== p.userId) throw notFound('Şikâyet');
  if (c.opened_side === side) throw forbidden('Şikâyete karşı taraf yanıt verir.');
  if (c.status === 'resolved') throw conflict('COMPLAINT_RESOLVED', 'Bu şikâyet karara bağlandı.');
  if (response.trim().length < 10) throw invalid('Yanıtını en az bir cümleyle yaz.');
  await tx.query(`UPDATE service_complaints SET status = 'responded', response = $2, responded_by = $3, responded_at = clock_timestamp() WHERE id = $1`, [complaintId, response.trim(), p.userId]);
  await appendAudit(tx, { companyId: j.company_id, actorId: p.userId, eventType: 'service.complaint_responded', entityType: 'service_job', entityId: c.job_id, payload: { complaintId, side } });
  const opener = c.opened_by as string;
  await notifyUser(tx, { companyId: j.company_id, siteId: null, userId: opener, kind: 'complaint_responded', entityType: side === 'business' ? 'pro_job' : 'service_request',
    entityId: side === 'business' ? c.job_id : (await tx.query<{ request_id: string }>(`SELECT request_id FROM service_jobs WHERE id = $1`, [c.job_id])).rows[0]!.request_id,
    dedupeKey: `complaint_response:${complaintId}`, title: 'Şikâyetine yanıt geldi', body: response.trim() });
  return { status: 'responded' as const };
}

/** A platform marketplace reviewer decides with a written resolution; the job's own status is untouched. */
export async function resolveComplaint(tx: Tx, p: Principal, complaintId: string, resolution: string) {
  if (!p.platformRoles.includes('marketplace_reviewer')) throw forbidden();
  const c = (await tx.query(`SELECT * FROM service_complaints WHERE id = $1 FOR UPDATE`, [complaintId])).rows[0];
  if (!c) throw notFound('Şikâyet');
  if (c.status === 'resolved') throw conflict('COMPLAINT_RESOLVED', 'Bu şikâyet zaten karara bağlandı.');
  if (resolution.trim().length < 10) throw invalid('Kararın gerekçesini en az bir cümleyle yaz.');
  await tx.query(`UPDATE service_complaints SET status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = clock_timestamp() WHERE id = $1`, [complaintId, resolution.trim(), p.userId]);
  const j = await loadJob(tx, c.job_id);
  await appendAudit(tx, { companyId: j.company_id, actorId: p.userId, eventType: 'service.complaint_resolved', entityType: 'service_job', entityId: c.job_id, payload: { complaintId, resolution: resolution.trim() } });
  await notifyUser(tx, { companyId: j.company_id, siteId: null, userId: j.provider_user, kind: 'complaint_resolved', entityType: 'pro_job', entityId: c.job_id, dedupeKey: `complaint_resolved:${complaintId}:p`,
    title: 'Şikâyet karara bağlandı', body: resolution.trim() });
  await notify(tx, { companyId: j.company_id, siteId: j.site_id, userIds: await siteManagers(tx, j.company_id, j.site_id), kind: 'complaint_resolved', entityType: 'service_request',
    entityId: (await tx.query<{ request_id: string }>(`SELECT request_id FROM service_jobs WHERE id = $1`, [c.job_id])).rows[0]!.request_id, dedupeKey: `complaint_resolved:${complaintId}:b`,
    title: 'Şikâyet karara bağlandı', body: resolution.trim() });
  return { status: 'resolved' as const };
}

/** Complaints of one job, for the side that is looking (each side sees both sides' text; the business name stays hidden from the provider before award, and an awarded job is past that). */
export async function jobComplaints(tx: Tx, p: Principal, side: Side, jobId: string, companyId?: string) {
  const j = await loadJob(tx, jobId);
  if (side === 'business') { if (!companyId || j.company_id !== companyId || !can(p, 'service.request', { companyId, siteId: j.site_id }).ok) throw notFound('Hizmet işi'); }
  else if (j.provider_user !== p.userId) throw notFound('Hizmet işi');
  return (await tx.query(`SELECT id, opened_side, reason, status, response, resolution, created_at, responded_at, resolved_at FROM service_complaints WHERE job_id = $1 ORDER BY created_at`, [jobId])).rows;
}

// ── Operations: five work lists for the marketplace reviewer ──

export type OpsRow = { id: string; title: string; responsible: string; waitingDays: number; nextAction: string; record: { type: string; id: string } };
const AUTH_SOON_DAYS = 30;

export async function operations(tx: Tx, p: Principal, now = new Date()) {
  if (!p.platformRoles.includes('marketplace_reviewer')) throw forbidden();
  const d = (t: Date | string) => daysBetween(t, now);

  const open = (await tx.query(
    `SELECT r.id, r.title, r.created_at, c.name AS category, r.city, (SELECT count(*)::int FROM quotes q WHERE q.request_id = r.id AND q.status = 'submitted') AS quotes
       FROM service_requests r JOIN service_categories c ON c.code = r.category_code WHERE r.status = 'open' ORDER BY r.created_at`)).rows
    .map((r): OpsRow => ({ id: r.id, title: `${r.title} · ${r.category} · ${r.city}`, waitingDays: d(r.created_at),
      responsible: r.quotes ? 'İşletme (teklif seçimi)' : 'Kategorideki onaylı uzmanlar (teklif)',
      nextAction: r.quotes ? 'İşletmeye teklifleri karşılaştırıp kabul etmesini hatırlat.' : 'Onaylı uzman var mı kontrol et; yoksa işletmeye kategori/konum değişikliği öner.',
      record: { type: 'service_request', id: r.id } }));

  const lateAppts = (await tx.query(
    `SELECT a.id, a.job_id, a.starts_at, a.status, r.title, pp.display_name AS provider FROM service_appointments a JOIN service_jobs j ON j.id = a.job_id
       JOIN service_requests r ON r.id = j.request_id JOIN professional_profiles pp ON pp.id = j.provider_profile_id
      WHERE a.status IN ('proposed','confirmed') AND a.starts_at < $1::timestamptz AND j.status = 'scheduled' ORDER BY a.starts_at`, [now.toISOString()])).rows
    .map((r): OpsRow => ({ id: r.id, title: `${r.title} · randevu ${new Date(r.starts_at).toISOString().slice(0, 16).replace('T', ' ')}`, waitingDays: d(r.starts_at),
      responsible: r.status === 'confirmed' ? `Uzman (${r.provider})` : 'Randevuyu yanıtlaması gereken taraf',
      nextAction: r.status === 'confirmed' ? 'Uzmandan giriş (check-in) yapmasını veya yeni randevu önermesini iste.' : 'Teklif edilen randevu yanıtsız; tarafları hatırlat.',
      record: { type: 'service_job', id: r.job_id } }));

  const rejected = (await tx.query(
    `SELECT j.id, r.title, pp.display_name AS provider, (SELECT max(decided_at) FROM service_job_reports sr WHERE sr.job_id = j.id AND sr.decision = 'revision_requested') AS at,
            j.business_note FROM service_jobs j JOIN service_requests r ON r.id = j.request_id JOIN professional_profiles pp ON pp.id = j.provider_profile_id
      WHERE j.status = 'revision_requested' ORDER BY at`)).rows
    .map((r): OpsRow => ({ id: r.id, title: `${r.title} · revizyon istendi: ${r.business_note ?? ''}`, waitingDays: r.at ? d(r.at) : 0, responsible: `Uzman (${r.provider})`,
      nextAction: 'Uzmanın yeni rapor sürümü göndermesini bekle; uzun sürerse uzmanı hatırlat.', record: { type: 'service_job', id: r.id } }));

  const expiring = (await tx.query(
    `SELECT a.id, a.valid_until, a.status, pp.display_name, c.name AS category FROM service_authorizations a JOIN professional_profiles pp ON pp.id = a.profile_id
       JOIN service_categories c ON c.code = a.category_code
      WHERE a.status = 'approved' AND a.valid_until <= ($1::date + $2::int) ORDER BY a.valid_until`, [now.toISOString().slice(0, 10), AUTH_SOON_DAYS])).rows
    .map((r): OpsRow => {
      const gone = new Date(ds(r.valid_until)) < new Date(now.toISOString().slice(0, 10));
      return { id: r.id, title: `${r.display_name} · ${r.category} · ${gone ? 'onay süresi doldu (yeni eşleşmeye alınmıyor)' : `onay ${ds(r.valid_until)} tarihinde bitiyor`}`,
        waitingDays: gone ? d(ds(r.valid_until)) : 0, responsible: `Uzman (${r.display_name}) · yenileme isteği`, nextAction: gone ? 'Yenileme başvurusu gelene kadar eşleşme yok; uzmana bildir.' : 'Uzmana süre bitmeden yenileme başvurusu yapmasını hatırlat.',
        record: { type: 'service_authorization', id: r.id } };
    });

  const complaints = (await tx.query(
    `SELECT c.id, c.job_id, c.opened_side, c.status, c.created_at, r.title FROM service_complaints c JOIN service_jobs j ON j.id = c.job_id JOIN service_requests r ON r.id = j.request_id
      WHERE c.status <> 'resolved' ORDER BY c.created_at`)).rows
    .map((r): OpsRow => ({ id: r.id, title: `${r.title} · ${r.opened_side === 'business' ? 'işletme' : 'uzman'} şikâyeti (${r.status === 'open' ? 'yanıt bekliyor' : 'yanıtlandı, karar bekliyor'})`,
      waitingDays: d(r.created_at), responsible: r.status === 'open' ? (r.opened_side === 'business' ? 'Uzman (yanıt)' : 'İşletme (yanıt)') : 'Pazar yeri değerlendiricisi (karar)',
      nextAction: r.status === 'open' ? 'Karşı tarafın yanıtını bekle; gecikirse hatırlat.' : 'İki tarafın metnini oku ve gerekçeli karar ver.', record: { type: 'service_job', id: r.job_id } }));

  return { generatedAt: now.toISOString(), lists: { openRequests: open, lateAppointments: lateAppts, rejectedReports: rejected, expiringApprovals: expiring, openComplaints: complaints },
    counts: { openRequests: open.length, lateAppointments: lateAppts.length, rejectedReports: rejected.length, expiringApprovals: expiring.length, openComplaints: complaints.length } };
}
