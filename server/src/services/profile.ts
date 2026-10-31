import type { Tx } from '../db/pool';
import type { Facts } from '../domain/conditions';
import { AppError, forbidden, invalid } from '../domain/errors';
import { FACTS, isFactKey, matchesType, type FactKey, type FactRecord, type FactSource, type FactVerification } from '../domain/facts';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';

const toRecord = (r: any): FactRecord => ({
  id: r.id, key: r.key, value: r.value, source: r.source, verification: r.verification,
  validFrom: r.valid_from, validTo: r.valid_to, recordedAt: r.recorded_at,
});

/**
 * Current facts for a site: the latest record per key, site-level before
 * company-level. With `asOf`, the facts as they stood at that moment.
 */
export async function currentFacts(tx: Tx, companyId: string, siteId: string, asOf?: string): Promise<Facts> {
  const r = await tx.query(
    `SELECT DISTINCT ON (key) * FROM profile_facts
      WHERE company_id = $1 AND (site_id IS NULL OR site_id = $2) AND ($3::timestamptz IS NULL OR recorded_at <= $3)
      ORDER BY key, (site_id IS NULL), recorded_at DESC`,
    [companyId, siteId, asOf ?? null]);
  const facts: Facts = {};
  for (const row of r.rows) if (isFactKey(row.key)) facts[row.key] = toRecord(row);
  return facts;
}

export async function factHistory(tx: Tx, companyId: string, key: string) {
  const r = await tx.query(`SELECT * FROM profile_facts WHERE company_id = $1 AND key = $2 ORDER BY recorded_at`, [companyId, key]);
  return r.rows.map(toRecord);
}

export type FactInput = {
  siteId: string | null;
  key: string;
  value: unknown;
  source: FactSource;
  verification: FactVerification;
  sourceRef?: string | null;
  confidence?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  note?: string | null;
};

/**
 * Records a new fact version. Nothing is overwritten: the previous value
 * stays in history, and decisions already made keep pointing at it.
 */
export async function recordFact(tx: Tx, p: Principal | 'system', companyId: string, f: FactInput): Promise<string> {
  if (!isFactKey(f.key)) throw invalid(`Bilinmeyen profil alanı: ${f.key}`);
  const def = FACTS[f.key as FactKey];
  if (f.verification !== 'rejected' && !matchesType(def.type, f.value)) throw invalid(`${def.label} için değer tipi ${def.type} olmalı.`);
  if (def.level === 'site' && !f.siteId) throw invalid(`${def.label} şube düzeyinde tutulur; şube belirtilmeli.`);

  if (p !== 'system') {
    // Who may assert what: users declare and confirm, experts verify, OCR stays unverified until confirmed.
    if (f.source === 'system') throw forbidden('Sistem kaynaklı bilgi kullanıcı tarafından girilemez.');
    if (f.source === 'ocr' && f.verification !== 'unverified') throw invalid('OCR sonucu doğrulanmış olarak kaydedilemez; önce kullanıcı onayı gerekir.');
    const action = f.verification === 'expert_verified' || f.source === 'expert' ? 'profile.verify' : 'profile.write';
    if (!can(p, action, { companyId, siteId: f.siteId }).ok) throw forbidden();
  }

  const userId = p === 'system' ? null : p.userId;
  const r = await tx.query<{ id: string }>(
    `INSERT INTO profile_facts (company_id, site_id, key, value, source, verification, source_ref, confidence, valid_from, valid_to, note, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [companyId, f.siteId, f.key, f.verification === 'rejected' ? null : JSON.stringify(f.value), f.source, f.verification,
      f.sourceRef ?? null, f.confidence ?? null, f.validFrom ?? null, f.validTo ?? null, f.note ?? null, userId]);
  const id = r.rows[0]!.id;
  await appendAudit(tx, {
    companyId, actorId: userId, eventType: 'profile.fact_recorded', entityType: 'profile_fact', entityId: id,
    payload: { key: f.key, value: f.value, source: f.source, verification: f.verification, siteId: f.siteId },
  });
  return id;
}

/** Keeps the system-derived `equipment.types` fact in step with the equipment register. */
export async function syncEquipmentTypes(tx: Tx, companyId: string, siteId: string) {
  const r = await tx.query<{ type: string }>(
    `SELECT DISTINCT type FROM equipment WHERE company_id = $1 AND site_id = $2 AND active ORDER BY type`, [companyId, siteId]);
  const types = r.rows.map(x => x.type);
  const cur = (await currentFacts(tx, companyId, siteId))['equipment.types'];
  if (cur && JSON.stringify(cur.value) === JSON.stringify(types)) return;
  await recordFact(tx, 'system', companyId, { siteId, key: 'equipment.types', value: types, source: 'system', verification: 'user_confirmed' });
}

export function assertSiteOfCompany(row: unknown, what = 'Şube'): asserts row {
  if (!row) throw new AppError(404, 'NOT_FOUND', `${what} bulunamadı.`);
}
