import { describe, expect, it } from 'vitest';
import { decide } from '../../src/domain/applicability';
import { evaluate, unknownFacts, validateCondition, type Facts } from '../../src/domain/conditions';
import type { FactRecord } from '../../src/domain/facts';

const fact = (key: string, value: unknown, over: Partial<FactRecord> = {}): FactRecord =>
  ({ id: `f-${key}`, key, value, source: 'user_declared', verification: 'user_confirmed', validFrom: null, validTo: null, recordedAt: '2026-01-01T00:00:00Z', ...over });

const COLD = { all: [{ fact: 'activity.food_preparation', op: 'eq', value: true }, { fact: 'storage.cold', op: 'eq', value: true }] };
const rule = (condition: unknown, ambiguityNote: string | null = null) => {
  const v = validateCondition(condition);
  if (!v.ok) throw new Error(v.errors.join());
  return { ruleVersionId: 'rv', condition: v.condition, effectiveFrom: '2024-01-01', effectiveTo: null, ambiguityNote };
};
const D = '2026-10-31';

describe('condition validation', () => {
  it('rejects unknown facts, bad operators and executable-looking input', () => {
    expect(validateCondition({ fact: 'nope', op: 'eq', value: 1 }).ok).toBe(false);
    expect(validateCondition({ fact: 'staff.count', op: 'eq', value: 'ten' }).ok).toBe(false);
    expect(validateCondition({ fact: 'storage.cold', op: 'gte', value: 1 }).ok).toBe(false);
    expect(validateCondition({ js: 'process.exit()' }).ok).toBe(false);
    expect(validateCondition('facts.storage.cold === true').ok).toBe(false);
  });
  it('lists the facts a rule depends on', () => {
    const v = validateCondition(COLD);
    expect(v.ok && v.facts.sort()).toEqual(['activity.food_preparation', 'storage.cold']);
  });
  it('limits nesting depth', () => {
    let c: unknown = { fact: 'storage.cold', op: 'eq', value: true };
    for (let i = 0; i < 8; i++) c = { not: c };
    expect(validateCondition(c).ok).toBe(false);
  });
});

describe('three-valued evaluation', () => {
  it('missing information is unknown, never false', () => {
    const facts: Facts = { 'activity.food_preparation': fact('activity.food_preparation', true) };
    const r = decide(rule(COLD), facts, D)!;
    expect(r.decision).toBe('needs_info');
    expect(r.missingFacts).toEqual(['storage.cold']);
  });
  it('a known false makes the rule not applicable, with the reason in the trace', () => {
    const facts: Facts = { 'storage.cold': fact('storage.cold', false) };
    const r = decide(rule(COLD), facts, D)!;
    expect(r.decision).toBe('not_applicable');
    expect(r.missingFacts).toEqual([]);
  });
  it('unconfirmed OCR, rejected, expired and not-yet-valid facts all count as unknown', () => {
    for (const over of [{ source: 'ocr', verification: 'unverified' }, { verification: 'rejected' }, { validTo: '2025-12-31' }, { validFrom: '2027-01-01' }] as const) {
      const facts: Facts = { 'activity.food_preparation': fact('activity.food_preparation', true), 'storage.cold': fact('storage.cold', true, over) };
      expect(decide(rule(COLD), facts, D)!.decision).toBe('needs_info');
    }
  });
  it('confirmed OCR is usable', () => {
    const facts: Facts = { 'activity.food_preparation': fact('activity.food_preparation', true), 'storage.cold': fact('storage.cold', true, { source: 'ocr', verification: 'user_confirmed' }) };
    expect(decide(rule(COLD), facts, D)!.decision).toBe('applies');
  });
  it('NOT of unknown stays unknown', () => {
    expect(evaluate({ not: { fact: 'utility.lpg', op: 'eq', value: true } }, {}, D).result).toBe('unknown');
  });
  it('ANY is true as soon as one branch is true, and does not ask for the irrelevant unknown', () => {
    const t = evaluate({ any: [{ fact: 'utility.lpg', op: 'eq', value: true }, { fact: 'service.delivery', op: 'eq', value: true }] },
      { 'utility.lpg': fact('utility.lpg', true) }, D);
    expect(t.result).toBe('true');
    expect(unknownFacts(t)).toEqual([]);
  });
  it('an ambiguous provision goes to review instead of being decided', () => {
    const r = decide(rule({ fact: 'staff.count', op: 'gte', value: 10 }, 'eşik belirsiz'), { 'staff.count': fact('staff.count', 12) }, D)!;
    expect(r.decision).toBe('needs_review');
  });
  it('missing information is asked for before an ambiguous rule goes to review', () => {
    expect(decide(rule({ fact: 'staff.count', op: 'gte', value: 10 }, 'eşik belirsiz'), {}, D)!.decision).toBe('needs_info');
  });
  it('a rule outside its effective period produces no decision', () => {
    expect(decide({ ...rule(COLD), effectiveFrom: '2027-01-01' }, {}, D)).toBeNull();
  });
});
