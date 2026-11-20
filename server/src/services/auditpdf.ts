import { createRequire } from 'node:module';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { Tx } from '../db/pool';
import { forbidden, invalid, notFound } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { listDocuments } from './documents';

/**
 * Audit file (6D) for a site (or all sites the person may see) and a date range: open critical cases,
 * overdue checks, documents out of date or running out, work waiting for verification, and the rule
 * sources and versions behind the obligations. Only records (and attachments) this person can open go in;
 * an attachment is a link to the app, which checks access again when it is opened. Built as data first
 * (testable), then rendered to PDF with an embedded font that has the Turkish letters.
 */
const ROLE_TR: Record<string, string> = { owner: 'İşletme sahibi', hq_manager: 'Merkez yöneticisi', site_manager: 'Şube yöneticisi', staff: 'Personel' };
const RISK_TR: Record<string, string> = { low: 'Düşük', medium: 'Orta', high: 'Yüksek', critical: 'Kritik' };
const DOC_TR: Record<string, string> = { expired: 'Süresi doldu', internally_reviewed: 'Kurum içi incelendi', issuer_verified: 'Kurumdan doğrulandı (kişi kaydı)',
  unreviewed: 'İnceleme bekliyor', rejected: 'Reddedildi', file_pending: 'Dosya bekleniyor', no_file: 'Dosya yok' };
const tr = (d: string | Date | null) => (d ? new Date(d).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' }) : '—');
const trDay = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '—');

const CAUSE_TR: Record<string, string> = { knowledge: 'bilgi', equipment: 'ekipman', resource: 'kaynak', process: 'süreç' };
const ACTION_TR: Record<string, string> = { correction: 'düzeltme', corrective_action: 'düzeltici faaliyet', follow_up: 'takip' };
const clip = (x: unknown, n = 150) => { const t = String(x ?? '').replace(/s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
/** One readable line per audit event of a closed case; null for events that add nothing to the sequence. */
function caseLine(type: string, pl: any): string | null {
  switch (type) {
    case 'nonconformity.opened': return `Vaka açıldı: ${(pl.reasons ?? []).join('; ') || 'elle bildirildi'} · risk ${RISK_TR[pl.riskLevel] ?? pl.riskLevel ?? '—'}`;
    case 'nonconformity.step_done': return pl.step === 'containment' ? `İlk müdahale: ${clip(pl.notes)}`
      : pl.step === 'effectiveness_check' ? `Etkinlik kontrolü: ${clip(pl.notes)}${pl.measurement ? ` (ölçüm ${String(pl.measurement.value).replace('.', ',')} ${pl.measurement.unit ?? ''})` : ''}` : null;
    case 'nonconformity.assigned': return 'Sorumlu ve termin atandı';
    case 'nonconformity.cause_assessed': return `Neden ${pl.stage === 'verified' ? 'doğrulandı' : 'değerlendirildi'} (${(pl.categories ?? []).map((c: string) => CAUSE_TR[c] ?? c).join(', ')}): ${clip(pl.notes)}`;
    case 'nonconformity.action_added': return `Aksiyon eklendi (${ACTION_TR[pl.kind] ?? pl.kind}): ${clip(pl.description)}`;
    case 'nonconformity.action_done': return `Aksiyon yapıldı beyanı: ${clip(pl.notes)}`;
    case 'nonconformity.action_verified': return `Aksiyon ${pl.mode === 'independent' ? 'bağımsız ' : pl.mode === 'self' ? 'öz ' : ''}doğrulandı: ${clip(pl.notes)}`;
    case 'nonconformity.closed': return `Vaka kapandı (${pl.mode === 'independent' ? 'bağımsız doğrulama' : pl.mode === 'self' ? 'öz doğrulama' : 'doğrulama'}): ${clip(pl.notes)}`;
    case 'service.requested': return 'Uzman hizmeti talep edildi';
    case 'service.quote_accepted': return 'Teklif kabul edildi';
    case 'service.report_submitted': return `Servis raporu teslim edildi (sürüm ${pl.version ?? '—'})`;
    case 'service.accepted': return 'Servis teslimi işletmece kabul edildi';
    case 'service.revision_requested': return `Servis raporunda revizyon istendi: ${clip(pl.note)}`;
    default: return null;
  }
}

export type ReportQuery = { siteId?: string | null; from: string; to: string };

export async function auditReport(tx: Tx, p: Principal, companyId: string, q: ReportQuery) {
  if (new Date(q.to) <= new Date(q.from)) throw invalid('Bitiş tarihi başlangıçtan sonra olmalı.');
  const company = (await tx.query(`SELECT id, name, is_demo FROM companies WHERE id = $1`, [companyId])).rows[0];
  if (!company) throw notFound('İşletme');
  const allSites = (await tx.query<{ id: string; name: string }>(`SELECT id, name FROM sites WHERE company_id = $1 ORDER BY created_at`, [companyId])).rows;
  const sites = allSites.filter(s => can(p, 'audit.export', { companyId, siteId: s.id }).ok && (!q.siteId || s.id === q.siteId));
  if (q.siteId && !sites.length) throw notFound('Şube');
  if (!sites.length) throw forbidden('Denetim dosyası alma yetkin yok.');
  const siteIds = sites.map(s => s.id);
  const siteName = (id: string | null) => (id ? allSites.find(s => s.id === id)?.name ?? '—' : 'Tüm işletme');
  const role = p.memberships.filter(m => m.companyId === companyId).map(m => ROLE_TR[m.role]).join(', ') || (p.grants.some(g => g.companyId === companyId) ? 'Davetli dış kullanıcı' : '—');

  const critical = (await tx.query(`SELECT n.id, n.site_id, n.title, n.risk_level, n.status, n.detected_at, n.due_at, u.display_name AS owner FROM nonconformities n
     LEFT JOIN users u ON u.id = n.owner_id WHERE n.company_id = $1 AND n.site_id = ANY($2) AND n.status <> 'closed' AND n.risk_level IN ('high','critical')
       AND n.detected_at < $3 ORDER BY CASE n.risk_level WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, n.detected_at`, [companyId, siteIds, q.to])).rows
    .filter(n => can(p, 'ncr.read', { companyId, siteId: n.site_id, recordId: n.id }).ok);
  const overdue = (await tx.query(`SELECT t.id, t.site_id, tt.title, t.due_at, u.display_name AS assignee FROM tasks t JOIN task_templates tt ON tt.id = t.template_id
     LEFT JOIN users u ON u.id = t.assignee_id WHERE t.company_id = $1 AND t.site_id = ANY($2) AND t.status IN ('open','missed') AND t.due_at < now()
       AND t.due_at >= $3 AND t.due_at < $4 ORDER BY t.due_at`, [companyId, siteIds, q.from, q.to])).rows
    .filter(t => can(p, 'task.read', { companyId, siteId: t.site_id, assigneeId: p.userId }).ok);
  const documents = (await listDocuments(tx, p, companyId, {})).filter(d => d.siteId == null || siteIds.includes(d.siteId));
  const docEvidence = documents.length ? (await tx.query(`SELECT v.document_id, v.version, e.id AS evidence_id FROM document_versions v JOIN evidence e ON e.document_version_id = v.id
     WHERE v.document_id = ANY($1) AND e.status = 'stored' AND v.review_status = 'verified'`, [documents.map(d => d.id)])).rows : [];
  const docRows = documents.filter(d => d.status === 'expired' || d.expiring || d.pendingReview || d.status === 'rejected').map(d => {
    const latest = docEvidence.filter(e => e.document_id === d.id).sort((a, b) => b.version - a.version)[0];
    return { id: d.id, title: d.title, site: siteName(d.siteId), status: d.expiring && d.status !== 'expired' ? 'Süresi yaklaşıyor' : DOC_TR[d.status] ?? d.status,
      validUntil: d.validUntil, pendingReview: d.pendingReview,
      // Link to the file of the reviewed version; the app checks access again when it is opened.
      attachment: latest ? `/companies/${companyId}/evidence/${latest.evidence_id}/content` : null };
  });
  const awaiting = (await tx.query(`SELECT n.id, n.site_id, n.title, n.status,
       (SELECT count(*)::int FROM ncr_actions a WHERE a.ncr_id = n.id AND a.status = 'done' AND a.verification_status IN ('declared','legacy')) AS declared
     FROM nonconformities n WHERE n.company_id = $1 AND n.site_id = ANY($2) AND n.status <> 'closed' ORDER BY n.detected_at`, [companyId, siteIds])).rows
    .filter(n => (n.status === 'awaiting_verification' || n.declared > 0) && can(p, 'ncr.read', { companyId, siteId: n.site_id, recordId: n.id }).ok);
  const sources = (await tx.query(`SELECT DISTINCT ON (o.site_id, o.rule_id) o.site_id, r.code, rv.version, rv.kind, rv.is_example, rv.obligation_title, o.decision,
       (SELECT string_agg(DISTINCT ls.title || ' ' || pr.ref, '; ') FROM provisions pr JOIN source_versions sv ON sv.id = pr.source_version_id JOIN legal_sources ls ON ls.id = sv.source_id
         WHERE pr.id = ANY(rv.provision_ids)) AS source
     FROM obligations o JOIN rule_versions rv ON rv.id = o.rule_version_id JOIN rules r ON r.id = o.rule_id
     WHERE o.company_id = $1 AND o.site_id = ANY($2) ORDER BY o.site_id, o.rule_id, o.decided_at DESC`, [companyId, siteIds])).rows;
  // Closure trail: what was closed in the period, by whom, and the document version it rested on.
  const closedTasks = (await tx.query(`SELECT t.id, t.site_id, tt.title, t.completed_at, t.outcome, u.display_name AS by FROM tasks t JOIN task_templates tt ON tt.id = t.template_id
     LEFT JOIN users u ON u.id = t.completed_by WHERE t.company_id = $1 AND t.site_id = ANY($2) AND t.status = 'done' AND t.completed_at >= $3 AND t.completed_at < $4
     ORDER BY t.completed_at DESC LIMIT 200`, [companyId, siteIds, q.from, q.to])).rows
    .filter(t => can(p, 'task.read', { companyId, siteId: t.site_id, assigneeId: p.userId }).ok);
  const basis = closedTasks.length ? (await tx.query(`SELECT r.task_id, r.document_id, d.title, r.version_number, r.file_sha256, v.review_status, v.reviewed_at FROM task_report_evidence r
     JOIN documents d ON d.id = r.document_id JOIN document_versions v ON v.id = r.document_version_id WHERE r.task_id = ANY($1) AND r.completion_basis ORDER BY r.version_number`, [closedTasks.map(t => t.id)])).rows : [];
  const closedCases = (await tx.query(`SELECT n.id, n.site_id, n.title, n.closed_at, u.display_name AS by,
       (SELECT v.verification_mode FROM ncr_verifications v WHERE v.ncr_id = n.id ORDER BY v.verified_at DESC LIMIT 1) AS mode
     FROM nonconformities n LEFT JOIN users u ON u.id = n.closed_by WHERE n.company_id = $1 AND n.site_id = ANY($2) AND n.status = 'closed' AND n.closed_at >= $3 AND n.closed_at < $4
     ORDER BY n.closed_at DESC LIMIT 200`, [companyId, siteIds, q.from, q.to])).rows.filter(n => can(p, 'ncr.read', { companyId, siteId: n.site_id, recordId: n.id }).ok);
  const taskMeas = closedTasks.length ? (await tx.query(`SELECT task_id, value, unit, within_limit, measured_at FROM measurements WHERE task_id = ANY($1) ORDER BY measured_at`, [closedTasks.map(t => t.id)])).rows : [];
  // Case sequence (6D): what happened in which order, from the audit trail of the case and of the service work linked to it.
  const caseIds = closedCases.map(n => n.id);
  const caseEvents = caseIds.length ? (await tx.query(
    `SELECT e.occurred_at, e.event_type, e.payload, u.display_name AS actor, e.entity_id::text AS ref FROM audit_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.company_id = $1 AND ((e.entity_id = ANY($2::uuid[]::text[]) AND e.event_type LIKE 'nonconformity.%')
         OR (e.event_type IN ('service.requested','service.quote_accepted','service.report_submitted','service.revision_requested','service.accepted')
             AND (e.entity_id IN (SELECT id::text FROM service_requests WHERE ncr_id = ANY($2::uuid[])) OR e.entity_id IN (SELECT j.id::text FROM service_jobs j JOIN service_requests r ON r.id = j.request_id WHERE r.ncr_id = ANY($2::uuid[])))))
      ORDER BY e.occurred_at`, [companyId, caseIds])).rows : [];
  const caseLink = caseIds.length ? (await tx.query(`SELECT r.ncr_id, r.id AS request_id, j.id AS job_id FROM service_requests r LEFT JOIN service_jobs j ON j.request_id = r.id WHERE r.ncr_id = ANY($1)`, [caseIds])).rows : [];
  const example = company.is_demo || sources.some(s => s.is_example);
  const generatedAt = new Date().toISOString();
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'audit.report_generated', entityType: 'company', entityId: companyId,
    payload: { siteIds, from: q.from, to: q.to, counts: { critical: critical.length, overdue: overdue.length, documents: docRows.length, awaiting: awaiting.length, closedTasks: closedTasks.length, closedCases: closedCases.length } } });
  return {
    title: 'Denetim dosyası', company: company.name, sites: sites.map(s => s.name), period: { from: q.from, to: q.to }, generatedAt, generatedAtText: tr(generatedAt),
    requestedBy: { name: p.displayName ?? null, role }, example,
    exampleNote: example ? 'ÖRNEK VERİ: Bu dosya örnek kurallara ve/veya demo işletme verisine dayanır; hukuki dayanakları doğrulanmamıştır.' : null,
    disclaimer: 'Bu dosya GoverHub kayıtlarının dökümüdür; resmî denetim sonucu ya da hukuki uygunluk beyanı değildir. Yalnız dosyayı alan kişinin erişebildiği kayıtlar ve ekler yer alır.',
    sections: {
      critical: critical.map(n => ({ id: n.id, title: n.title, site: siteName(n.site_id), risk: RISK_TR[n.risk_level], status: n.status === 'awaiting_verification' ? 'Doğrulama bekliyor' : 'Açık',
        detected: tr(n.detected_at), owner: n.owner ?? '—' })),
      overdue: overdue.map(t => ({ id: t.id, title: t.title, site: siteName(t.site_id), due: tr(t.due_at), assignee: t.assignee ?? 'atanmamış' })),
      documents: docRows,
      awaiting: awaiting.map(n => ({ id: n.id, title: n.title, site: siteName(n.site_id), what: n.status === 'awaiting_verification' ? 'Kapanış doğrulaması' : `${n.declared} aksiyon beyanı` })),
      closures: {
        tasks: closedTasks.map(t => ({ id: t.id, title: t.title, site: siteName(t.site_id), closed: tr(t.completed_at), by: t.by ?? '—', outcome: t.outcome ?? null,
          measurements: taskMeas.filter(m => m.task_id === t.id).map(m => ({ value: Number(m.value), unit: m.unit, within: m.within_limit, at: tr(m.measured_at) })),
          basis: basis.filter(b => b.task_id === t.id).map(b => ({ documentId: b.document_id, title: b.title, version: b.version_number, sha256: b.file_sha256 ?? null, review: b.review_status === 'verified' ? 'İncelendi' : 'İncelenmedi' })) })),
        cases: closedCases.map(n => ({ id: n.id, title: n.title, site: siteName(n.site_id), closed: tr(n.closed_at), by: n.by ?? '—', verification: n.mode === 'independent' ? 'Bağımsız doğrulama' : n.mode === 'self' ? 'Öz doğrulama (etiketli)' : 'Kayıtlı doğrulama',
          sequence: caseEvents.filter(e => e.ref === n.id || caseLink.some(l => l.ncr_id === n.id && (l.request_id === e.ref || l.job_id === e.ref)))
            .map(e => ({ at: tr(e.occurred_at), who: e.actor ?? '—', text: caseLine(e.event_type, e.payload) })).filter(x => x.text) })),
      },
      sources: sources.map(s => ({ site: siteName(s.site_id), rule: `${s.code} v${s.version}`, title: s.obligation_title, kind: s.kind === 'legal_requirement' ? 'Mevzuat' : 'İyi uygulama',
        example: s.is_example, source: s.source ?? 'Kaynak hükmü bağlı değil', decision: s.decision })),
    },
  };
}

const require = createRequire(import.meta.url);
const FONT = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf', 'DejaVuSans-Bold.ttf');

/** A4 PDF: Turkish letters (embedded DejaVu), long text wraps, page breaks, "Sayfa x / y" on every page. */
export function renderPdf(r: Awaited<ReturnType<typeof auditReport>>, appBase: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `${r.title} · ${r.company}`, Creator: 'GoverHub', Producer: 'GoverHub' } });
    const chunks: Buffer[] = [];
    doc.on('data', c => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('body', FONT);
    doc.registerFont('bold', FONT_BOLD);
    const W = doc.page.width - 96;
    const h1 = (t: string) => { doc.moveDown(0.6); doc.font('bold').fontSize(13).fillColor('#111').text(t, { width: W }); doc.moveDown(0.25); };
    const p = (t: string, opts: { size?: number; color?: string; bold?: boolean } = {}) =>
      doc.font(opts.bold ? 'bold' : 'body').fontSize(opts.size ?? 9.5).fillColor(opts.color ?? '#222').text(t, { width: W });
    const none = () => p('Kayıt yok.', { color: '#777' });

    if (r.exampleNote) { doc.rect(48, 40, W, 26).fill('#fff3cd'); doc.fillColor('#7a5a00').font('bold').fontSize(9.5).text(r.exampleNote, 56, 47, { width: W - 16 }); doc.moveDown(1.2); }
    doc.font('bold').fontSize(18).fillColor('#111').text(`${r.title} · ${r.company}`, 48, r.exampleNote ? 78 : 48, { width: W });
    p(`Şube: ${r.sites.join(', ')}`);
    p(`Tarih aralığı: ${trDay(r.period.from)} – ${trDay(r.period.to)}`);
    p(`Oluşturulma: ${r.generatedAtText} · Raporu alan: ${r.requestedBy.name ?? '—'} · rol: ${r.requestedBy.role}`);
    p(r.disclaimer, { color: '#555', size: 8.5 });

    h1(`1. Açık kritik ve yüksek riskli kayıtlar (${r.sections.critical.length})`);
    if (!r.sections.critical.length) none();
    for (const n of r.sections.critical) { p(`${n.risk} · ${n.title}`, { bold: true }); p(`${n.site} · ${n.status} · tespit ${n.detected} · sorumlu ${n.owner}`, { color: '#555' }); doc.moveDown(0.2); }

    h1(`2. Geciken kontroller (${r.sections.overdue.length})`);
    if (!r.sections.overdue.length) none();
    for (const t of r.sections.overdue) p(`${t.title} · ${t.site} · son saat ${t.due} · ${t.assignee}`);

    h1(`3. Belgeler: süresi dolan, yaklaşan, inceleme bekleyen, reddedilen (${r.sections.documents.length})`);
    if (!r.sections.documents.length) none();
    for (const d of r.sections.documents) {
      p(`${d.title} · ${d.site} · ${d.status}${d.validUntil ? ` · geçerlilik ${trDay(d.validUntil)}` : ''}${d.pendingReview ? ' · yeni sürüm inceleme bekliyor' : ''}`);
      if (d.attachment) doc.font('body').fontSize(8).fillColor('#1a56db').text(`Ek (oturum ve yetki gerekir): ${appBase}${d.attachment}`, { width: W, link: `${appBase}${d.attachment}`, underline: false });
    }

    h1(`4. Doğrulama bekleyen işlemler (${r.sections.awaiting.length})`);
    if (!r.sections.awaiting.length) none();
    for (const n of r.sections.awaiting) p(`${n.title} · ${n.site} · ${n.what}`);

    h1(`5. Kaynak ve kural sürümleri (${r.sections.sources.length})`);
    if (!r.sections.sources.length) none();
    for (const s of r.sections.sources) {
      p(`${s.rule} · ${s.title}${s.example ? ' · ÖRNEK KURAL' : ''}`, { bold: true });
      p(`${s.site} · ${s.kind} · karar: ${s.decision} · kaynak: ${s.source}`, { color: '#555' });
    }

    h1(`6. Kapanış izi: dönemde kapanan görevler ve kayıtlar (${r.sections.closures.tasks.length + r.sections.closures.cases.length})`);
    if (!r.sections.closures.tasks.length && !r.sections.closures.cases.length) none();
    for (const t of r.sections.closures.tasks) {
      p(`${t.title} · ${t.site} · kapanış ${t.closed} · ${t.by}`, { bold: true });
      for (const m of t.measurements) p(`   Ölçüm: ${String(m.value).replace('.', ',')} ${m.unit ?? ''} · ${m.within === false ? 'LİMİT DIŞI' : m.within ? 'limit içinde' : 'limit yok'} · ${m.at}`, { color: '#555' });
      for (const b of t.basis) p(`   Dayanak: ${b.title} · sürüm ${b.version} · ${b.review}${b.sha256 ? ` · özet ${b.sha256.slice(0, 12)}…` : ''}`, { color: '#555' });
    }
    for (const n of r.sections.closures.cases) {
      p(`Kayıt kapandı: ${n.title} · ${n.site} · ${n.closed} · ${n.by} · ${n.verification}`, { bold: true });
      for (const e of n.sequence) p(`   ${e.at} · ${e.who} · ${e.text}`, { color: '#555', size: 8.5 });
      doc.moveDown(0.2);
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('body').fontSize(7.5).fillColor('#777').text(`GoverHub denetim dosyası · ${r.company} · ${r.generatedAtText} · Sayfa ${i + 1} / ${range.count}${r.example ? ' · ÖRNEK VERİ' : ''}`,
        48, doc.page.height - 34, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
