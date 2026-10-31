import { describe, expect, it } from 'vitest';
import { assessEvidence, selectLimit, type Limit } from '../../src/domain/evidence';
import { GENESIS, eventHash, verifyChain } from '../../src/domain/hashchain';
import { CRITICAL_CAP, computeIndicators } from '../../src/domain/indicators';
import { assessRisk, canClose } from '../../src/domain/nonconformity';
import { can, type Principal } from '../../src/domain/permissions';
import { occurrences, zonedToUtc } from '../../src/domain/schedule';

describe('schedule', () => {
  it('converts site wall-clock time to UTC (Istanbul is UTC+3)', () => {
    expect(zonedToUtc('2026-10-31', '18:00', 'Europe/Istanbul').toISOString()).toBe('2026-10-31T15:00:00.000Z');
  });
  it('handles daylight-saving zones', () => {
    expect(zonedToUtc('2026-07-01', '18:00', 'Europe/Berlin').toISOString()).toBe('2026-07-01T16:00:00.000Z');
    expect(zonedToUtc('2026-12-01', '18:00', 'Europe/Berlin').toISOString()).toBe('2026-12-01T17:00:00.000Z');
  });
  it('skips closed weekdays and holidays', () => {
    const occ = occurrences({ freq: 'daily', at: '09:00' }, { timezone: 'Europe/Istanbul', openingDays: [1, 2, 3, 4, 5, 6], closures: ['2026-10-29'] }, '2026-10-26', '2026-11-01');
    // 26 Oct (Mon) … 1 Nov (Sun): Sunday closed, 29 Oct holiday.
    expect(occ.map(o => o.periodKey)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-30', '2026-10-31']);
  });
  it('monthly recurrence gives one stable period key', () => {
    const occ = occurrences({ freq: 'monthly', day: 1, at: '10:00' }, { timezone: 'Europe/Istanbul', openingDays: [1, 2, 3, 4, 5, 6, 7], closures: [] }, '2026-10-01', '2026-11-30');
    expect(occ.map(o => o.periodKey)).toEqual(['M:2026-10', 'M:2026-11']);
  });
});

describe('measurement limits and evidence', () => {
  const limits: Limit[] = [{ quantity: 'temperature', equipmentType: 'refrigerator', unit: '°C', min: 0, max: 4, basis: 'example' }];
  it('never falls back to a generic limit', () => {
    expect(selectLimit(limits, 'temperature', 'freezer', '°C')).toMatchObject({ ok: false, code: 'LIMIT_UNDEFINED' });
    expect(selectLimit(limits, 'temperature', 'refrigerator', '°F')).toMatchObject({ ok: false, code: 'UNIT_MISMATCH' });
  });
  it('an out-of-limit result is complete evidence with a nonconforming outcome', () => {
    const a = assessEvidence([{ kind: 'measurement', quantity: 'temperature', unit: '°C' }, { kind: 'photo', min: 1 }],
      { measurements: [{ quantity: 'temperature', withinLimit: false }], files: [{ kind: 'photo', status: 'stored' }], checklist: null, notes: 0, approvals: [] });
    expect(a.complete).toBe(true);
    expect(a.nonconforming).toHaveLength(1);
  });
  it('a pending upload does not count as evidence', () => {
    const a = assessEvidence([{ kind: 'photo', min: 1 }], { measurements: [], files: [{ kind: 'photo', status: 'pending_upload' }], checklist: null, notes: 0, approvals: [] });
    expect(a.complete).toBe(false);
    expect(a.pending).toHaveLength(1);
  });
  it('a note becomes mandatory once the result is nonconforming', () => {
    const reqs = [{ kind: 'checklist' as const, items: [{ id: 'a', label: 'A', critical: true }] }, { kind: 'note' as const, requiredWhen: 'nonconforming' as const }];
    const base = { measurements: [], files: [], notes: 0, approvals: [] };
    expect(assessEvidence(reqs, { ...base, checklist: { a: 'pass' } }).complete).toBe(true);
    expect(assessEvidence(reqs, { ...base, checklist: { a: 'fail' } }).missing).toContain('Açıklama notu');
  });
});

describe('nonconformity depth', () => {
  it('scales with severity and structured recurrence', () => {
    expect(assessRisk('minor', 0)).toMatchObject({ level: 'low', depth: 'correction', independentVerification: false });
    expect(assessRisk('minor', 2)).toMatchObject({ level: 'medium', depth: 'capa' });
    expect(assessRisk('critical', 0)).toMatchObject({ level: 'high', depth: 'capa', independentVerification: true });
    expect(assessRisk('major', 3).level).toBe('critical');
  });
  it('high risk needs a verifier who did not perform the fix', () => {
    const a = assessRisk('critical', 0);
    const done = a.steps.map(step => ({ step, doneBy: 'u1' }));
    expect(canClose(a, done, 'u1')).toMatchObject({ ok: false, code: 'VERIFIER_NOT_INDEPENDENT' });
    expect(canClose(a, done, 'u2')).toEqual({ ok: true });
    expect(canClose(a, done.slice(0, 2), 'u2')).toMatchObject({ ok: false, code: 'STEPS_INCOMPLETE' });
  });
});

describe('indicators', () => {
  const good = { dueTasks: 10, onTimeTasks: 10, doneTasks: 10, conformingTasks: 10, doneWithCompleteEvidence: 10, overdueTasks: 0,
    openCriticalOrHighNcrs: 0, recurringNcrs: 0, obligationsNeedingInfo: 0, obligationsNeedingReview: 0 };
  it('a perfect period is on track', () => {
    expect(computeIndicators(good)).toMatchObject({ status: 'on_track', score: 100 });
  });
  it('an open critical risk cannot hide behind a high score', () => {
    const r = computeIndicators({ ...good, openCriticalOrHighNcrs: 1 });
    expect(r.status).toBe('critical_risk');
    expect(r.score).toBe(CRITICAL_CAP);
    expect(r.scoreCappedBy).toBeTruthy();
  });
  it('missing data is not read as compliance', () => {
    const r = computeIndicators({ ...good, dueTasks: 0, onTimeTasks: 0, doneTasks: 0, conformingTasks: 0, doneWithCompleteEvidence: 0 });
    expect(r.score).toBeNull();
    expect(r.status).toBe('insufficient_data');
    expect(computeIndicators({ ...good, obligationsNeedingInfo: 1 }).status).toBe('insufficient_data');
  });
});

describe('audit hash chain', () => {
  const body = (seq: number) => ({ seq, occurredAt: '2026-10-31T10:00:00.000Z', actorId: 'u', eventType: 'x', entityType: 'task', entityId: 't', payload: { v: seq } });
  const chain = () => {
    let prev = GENESIS;
    return [1, 2, 3].map(seq => { const b = body(seq); const hash = eventHash(prev, b); const e = { ...b, prevHash: prev, hash }; prev = hash; return e; });
  };
  it('verifies an untouched chain', () => expect(verifyChain(chain())).toMatchObject({ ok: true, count: 3 }));
  it('detects an edited payload', () => {
    const c = chain(); c[1]!.payload = { v: 99 };
    expect(verifyChain(c)).toMatchObject({ ok: false, brokenAtSeq: 2 });
  });
  it('detects a removed event', () => {
    const c = chain(); c.splice(1, 1);
    expect(verifyChain(c)).toMatchObject({ ok: false, brokenAtSeq: 3 });
  });
});

describe('permissions', () => {
  const staff: Principal = { userId: 's', platformRoles: [], memberships: [{ companyId: 'A', siteId: 'S1', role: 'staff' }], grants: [] };
  const manager: Principal = { userId: 'm', platformRoles: [], memberships: [{ companyId: 'A', siteId: 'S1', role: 'site_manager' }], grants: [] };
  it('staff only act on their own assignments and never see indicators', () => {
    expect(can(staff, 'task.execute', { companyId: 'A', siteId: 'S1', assigneeId: 's' }).ok).toBe(true);
    expect(can(staff, 'task.execute', { companyId: 'A', siteId: 'S1', assigneeId: 'x' }).ok).toBe(false);
    expect(can(staff, 'indicators.read', { companyId: 'A', siteId: 'S1' }).ok).toBe(false);
  });
  it('a site-scoped manager gets neither other sites nor company-wide data', () => {
    expect(can(manager, 'task.read', { companyId: 'A', siteId: 'S1' }).ok).toBe(true);
    expect(can(manager, 'task.read', { companyId: 'A', siteId: 'S2' }).ok).toBe(false);
    expect(can(manager, 'indicators.read', { companyId: 'A', siteId: null }).ok).toBe(false);
  });
  it('nothing crosses companies', () => {
    expect(can(manager, 'task.read', { companyId: 'B', siteId: 'S1' }).ok).toBe(false);
  });
});
