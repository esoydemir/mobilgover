import { createHash } from 'node:crypto';

/**
 * Tamper-evidence for the audit log. The chain shows that recorded events
 * were not changed, reordered or removed after the fact *inside our
 * database*. It does not prove the events are true, that device clocks were
 * right, or that the log is legally binding; see docs/MIMARI.md (threat model).
 */
export const GENESIS = '0'.repeat(64);

/** Deterministic JSON: object keys sorted, no whitespace. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export type ChainEvent = {
  seq: number;
  occurredAt: string;
  actorId: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: unknown;
};

export const eventHash = (prevHash: string, e: ChainEvent) => sha256(prevHash + canonical(e));

export type ChainVerification = { ok: true; count: number; head: string } | { ok: false; count: number; brokenAtSeq: number; reason: string };

export function verifyChain(events: (ChainEvent & { prevHash: string; hash: string })[]): ChainVerification {
  let prev = GENESIS;
  let expectedSeq = 1;
  for (const e of events) {
    if (e.seq !== expectedSeq) return { ok: false, count: events.length, brokenAtSeq: e.seq, reason: `sıra numarası ${expectedSeq} bekleniyordu` };
    if (e.prevHash !== prev) return { ok: false, count: events.length, brokenAtSeq: e.seq, reason: 'önceki karma eşleşmiyor' };
    const { prevHash: _p, hash, ...body } = e;
    if (eventHash(prev, body) !== hash) return { ok: false, count: events.length, brokenAtSeq: e.seq, reason: 'kayıt içeriği değişmiş' };
    prev = hash;
    expectedSeq++;
  }
  return { ok: true, count: events.length, head: prev };
}
