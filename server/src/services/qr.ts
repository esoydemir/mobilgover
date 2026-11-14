import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import type { Tx } from '../db/pool';
import { forbidden, invalid, notFound } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { canReadDoc } from './documents';

/*
 * QR codes bound to a record (equipment, document, site).
 *  - The code carries only a random token. Scanning asks the server, which opens the record only for a person whose own rights
 *    cover it; everything else looks like "no such code". A deactivated code opens nothing.
 *  - Making and switching codes needs the right to write that record.
 */

const newToken = () => randomBytes(18).toString('base64url');

async function target(tx: Tx, companyId: string, kind: string, refId: string): Promise<{ siteId: string | null; label: string }> {
  if (kind === 'equipment') {
    const e = (await tx.query(`SELECT site_id, name, type FROM equipment WHERE id = $1 AND company_id = $2`, [refId, companyId])).rows[0];
    if (!e) throw notFound('Ekipman');
    return { siteId: e.site_id, label: e.name };
  }
  if (kind === 'document') {
    const d = (await tx.query(`SELECT site_id, title FROM documents WHERE id = $1 AND company_id = $2 AND archived_at IS NULL`, [refId, companyId])).rows[0];
    if (!d) throw notFound('Belge');
    return { siteId: d.site_id, label: d.title };
  }
  const s = (await tx.query(`SELECT id, name FROM sites WHERE id = $1 AND company_id = $2`, [refId, companyId])).rows[0];
  if (!s) throw notFound('Şube');
  return { siteId: s.id, label: s.name };
}

const writeRight = (p: Principal, companyId: string, kind: string, siteId: string | null) =>
  can(p, kind === 'document' ? 'document.write' : 'equipment.write', { companyId, siteId }).ok;

export async function createQr(tx: Tx, p: Principal, companyId: string, b: { kind: 'equipment' | 'document' | 'site'; refId: string; label?: string | null }) {
  const t = await target(tx, companyId, b.kind, b.refId);
  if (!writeRight(p, companyId, b.kind, t.siteId)) throw forbidden('Bu kayıt için QR üretme yetkin yok.');
  // One live code per record: a second request returns the same code instead of printing a conflicting second label.
  const live = (await tx.query(`SELECT id, token, label FROM qr_codes WHERE company_id = $1 AND kind = $2 AND ref_id = $3 AND active`, [companyId, b.kind, b.refId])).rows[0];
  if (live) return { id: live.id as string, token: live.token as string, label: live.label as string, duplicate: true };
  const label = (b.label ?? '').trim() || t.label;
  const r = (await tx.query<{ id: string; token: string }>(
    `INSERT INTO qr_codes (company_id, site_id, kind, ref_id, label, token, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, token`,
    [companyId, t.siteId, b.kind, b.refId, label, newToken(), p.userId])).rows[0]!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'qr.created', entityType: 'qr_code', entityId: r.id, payload: { kind: b.kind, refId: b.refId } });
  return { id: r.id, token: r.token, label, duplicate: false };
}

export async function listQr(tx: Tx, p: Principal, companyId: string, f: { kind?: string; refId?: string } = {}) {
  const rows = (await tx.query(
    `SELECT q.id, q.kind, q.ref_id, q.label, q.token, q.active, q.site_id, q.created_at, q.deactivated_at, q.deactivate_reason, s.name AS site_name
       FROM qr_codes q LEFT JOIN sites s ON s.id = q.site_id WHERE q.company_id = $1 AND ($2::text IS NULL OR q.kind = $2) AND ($3::uuid IS NULL OR q.ref_id = $3)
      ORDER BY q.created_at DESC`, [companyId, f.kind ?? null, f.refId ?? null])).rows;
  return rows.filter(q => writeRight(p, companyId, q.kind, q.site_id));
}

export async function setQrActive(tx: Tx, p: Principal, companyId: string, id: string, b: { active: boolean; reason?: string | null }) {
  const q = (await tx.query(`SELECT * FROM qr_codes WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, companyId])).rows[0];
  if (!q || !writeRight(p, companyId, q.kind, q.site_id)) throw notFound('QR kodu');
  if (!b.active && (b.reason ?? '').trim().length < 3) throw invalid('Pasifleştirirken kısa bir gerekçe yaz.');
  if (b.active) {
    const other = (await tx.query(`SELECT 1 FROM qr_codes WHERE company_id = $1 AND kind = $2 AND ref_id = $3 AND active AND id <> $4`, [companyId, q.kind, q.ref_id, id])).rowCount;
    if (other) throw invalid('Bu kayıt için zaten etkin bir QR kodu var.');
  }
  await tx.query(`UPDATE qr_codes SET active = $2, deactivated_by = $3, deactivated_at = $4, deactivate_reason = $5 WHERE id = $1`,
    [id, b.active, b.active ? null : p.userId, b.active ? null : new Date().toISOString(), b.active ? null : b.reason!.trim()]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: b.active ? 'qr.activated' : 'qr.deactivated', entityType: 'qr_code', entityId: id, payload: { reason: b.reason?.trim() ?? null } });
  return { active: b.active };
}

/** The QR image as a PNG data URL for the given link (the app origin + /q/<token>). */
export async function qrImage(tx: Tx, p: Principal, companyId: string, id: string, base: string) {
  const q = (await tx.query(`SELECT * FROM qr_codes WHERE id = $1 AND company_id = $2`, [id, companyId])).rows[0];
  if (!q || !writeRight(p, companyId, q.kind, q.site_id)) throw notFound('QR kodu');
  const url = `${base.replace(/\/$/, '')}/q/${q.token}`;
  return { url, label: q.label, kind: q.kind, active: q.active, dataUrl: await QRCode.toDataURL(url, { margin: 2, width: 360, errorCorrectionLevel: 'M' }) };
}

/**
 * A scan. Looks the token up across businesses (the scanner may belong to several), then checks the scanner's own rights.
 * Unknown, inactive and not-allowed all answer the same, so a printed code reveals nothing to an outsider.
 */
export async function resolveQr(tx: Tx, p: Principal, token: string) {
  const q = (await tx.query(`SELECT * FROM qr_codes WHERE token = $1`, [token])).rows[0];
  if (!q || !q.active) throw notFound('QR kodu');
  const companyId = q.company_id as string;
  let ok = false; let route = '';
  if (q.kind === 'equipment') {
    ok = can(p, 'equipment.read', { companyId, siteId: q.site_id }).ok;
    route = `/equipment/${q.ref_id}`;
  } else if (q.kind === 'document') {
    const d = (await tx.query(`SELECT id, site_id FROM documents WHERE id = $1 AND company_id = $2 AND archived_at IS NULL`, [q.ref_id, companyId])).rows[0];
    ok = !!d && await canReadDoc(tx, p, companyId, d);
    route = `/documents/${q.ref_id}`;
  } else {
    ok = can(p, 'task.read', { companyId, siteId: q.site_id }).ok;
    route = '/tasks';
  }
  if (!ok) throw notFound('QR kodu');
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'qr.scanned', entityType: 'qr_code', entityId: q.id, payload: { kind: q.kind, refId: q.ref_id } });
  return { companyId, siteId: q.site_id as string | null, kind: q.kind as string, refId: q.ref_id as string, label: q.label as string, route };
}
