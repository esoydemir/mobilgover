import type { Tx } from '../db/pool';
import { GENESIS, eventHash, verifyChain, type ChainVerification } from '../domain/hashchain';

export type AuditInput = {
  /** null = platform-level chain (rule publishing, admin actions). */
  companyId: string | null;
  actorId: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  clientTime?: string | null;
};

/**
 * Appends one event to the company's hash chain. A per-company advisory lock
 * serialises appends so sequence numbers and previous hashes never fork.
 */
export async function appendAudit(tx: Tx, e: AuditInput): Promise<{ seq: number; hash: string }> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [e.companyId ?? 'platform']);
  const last = await tx.query<{ seq: number; hash: string }>(
    `SELECT seq, hash FROM audit_events WHERE company_id IS NOT DISTINCT FROM $1 ORDER BY seq DESC LIMIT 1`, [e.companyId]);
  const seq = (last.rows[0]?.seq ?? 0) + 1;
  const prevHash = last.rows[0]?.hash ?? GENESIS;
  const occurredAt = new Date().toISOString();
  // Round-trip through JSON so the hashed payload equals what jsonb stores.
  const payload = JSON.parse(JSON.stringify(e.payload ?? {}));
  const hash = eventHash(prevHash, { seq, occurredAt, actorId: e.actorId, eventType: e.eventType, entityType: e.entityType, entityId: e.entityId, payload });
  await tx.query(
    `INSERT INTO audit_events (company_id, seq, occurred_at, client_time, actor_id, event_type, entity_type, entity_id, payload, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [e.companyId, seq, occurredAt, e.clientTime ?? null, e.actorId, e.eventType, e.entityType, e.entityId, payload, prevHash, hash]);
  return { seq, hash };
}

/** Verifies one company's chain; `null` verifies the platform chain. */
export async function verifyCompanyChain(tx: Tx, companyId: string | null): Promise<ChainVerification> {
  const r = await tx.query(
    `SELECT seq, occurred_at, actor_id, event_type, entity_type, entity_id, payload, prev_hash, hash
       FROM audit_events WHERE company_id IS NOT DISTINCT FROM $1 ORDER BY seq`, [companyId]);
  return verifyChain(r.rows.map(x => ({
    seq: x.seq, occurredAt: x.occurred_at, actorId: x.actor_id, eventType: x.event_type,
    entityType: x.entity_type, entityId: x.entity_id, payload: x.payload, prevHash: x.prev_hash, hash: x.hash,
  })));
}
