import { z } from 'zod';
import { FACTS, isFactKey, matchesType, usableFact, type FactKey, type FactRecord, type UsableFact } from './facts';

/**
 * Rule conditions are a small JSON expression tree, never executable code.
 * Evaluation uses three-valued (Kleene) logic: a missing or unconfirmed fact
 * is UNKNOWN, and UNKNOWN can never turn into "does not apply" by itself.
 */
export type Tri = 'true' | 'false' | 'unknown';

export type Op = 'eq' | 'neq' | 'in' | 'contains' | 'gte' | 'lte' | 'gt' | 'lt';

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fact: string; op: Op; value: unknown };

const MAX_DEPTH = 6;
const MAX_NODES = 60;

const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).min(1) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1) }).strict(),
    z.object({ not: conditionSchema }).strict(),
    z.object({
      fact: z.string(),
      op: z.enum(['eq', 'neq', 'in', 'contains', 'gte', 'lte', 'gt', 'lt']),
      value: z.unknown(),
    }).strict(),
  ]),
);

export type ValidationResult = { ok: true; condition: Condition; facts: FactKey[] } | { ok: false; errors: string[] };

/** Parses and type-checks a condition against the fact catalogue. */
export function validateCondition(input: unknown): ValidationResult {
  const parsed = conditionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
  const errors: string[] = [];
  const facts = new Set<FactKey>();
  let nodes = 0;
  const walk = (c: Condition, depth: number, path: string) => {
    nodes++;
    if (depth > MAX_DEPTH) errors.push(`${path}: koşul ${MAX_DEPTH} seviyeden derin olamaz`);
    if ('all' in c) c.all.forEach((x, i) => walk(x, depth + 1, `${path}.all[${i}]`));
    else if ('any' in c) c.any.forEach((x, i) => walk(x, depth + 1, `${path}.any[${i}]`));
    else if ('not' in c) walk(c.not, depth + 1, `${path}.not`);
    else {
      if (!isFactKey(c.fact)) { errors.push(`${path}: bilinmeyen profil alanı "${c.fact}"`); return; }
      facts.add(c.fact);
      const t = FACTS[c.fact].type;
      const okOperand =
        c.op === 'in' ? Array.isArray(c.value) && c.value.every(v => matchesType(t === 'string[]' ? 'string' : t, v))
        : c.op === 'contains' ? t === 'string[]' && typeof c.value === 'string'
        : ['gte', 'lte', 'gt', 'lt'].includes(c.op) ? t === 'number' && typeof c.value === 'number'
        : matchesType(t, c.value);
      if (!okOperand) errors.push(`${path}: "${c.fact}" (${t}) için "${c.op}" işleci ve değeri uyumsuz`);
    }
  };
  walk(parsed.data, 1, '$');
  if (nodes > MAX_NODES) errors.push(`koşul en fazla ${MAX_NODES} düğüm içerebilir`);
  return errors.length ? { ok: false, errors } : { ok: true, condition: parsed.data, facts: [...facts] };
}

export type TraceNode =
  | { kind: 'all' | 'any' | 'not'; result: Tri; children: TraceNode[] }
  | { kind: 'fact'; result: Tri; fact: FactKey; label: string; op: Op; expected: unknown;
      actual: unknown; factStatus: UsableFact['status']; unknownReason?: string; factId?: string; source?: string; verification?: string };

export type Facts = Partial<Record<FactKey, FactRecord>>;

/** Evaluates a validated condition and returns the result with a full trace. */
export function evaluate(c: Condition, facts: Facts, onDate: string): TraceNode {
  if ('all' in c) {
    const children = c.all.map(x => evaluate(x, facts, onDate));
    const r = children.some(x => x.result === 'false') ? 'false' : children.some(x => x.result === 'unknown') ? 'unknown' : 'true';
    return { kind: 'all', result: r, children };
  }
  if ('any' in c) {
    const children = c.any.map(x => evaluate(x, facts, onDate));
    const r = children.some(x => x.result === 'true') ? 'true' : children.some(x => x.result === 'unknown') ? 'unknown' : 'false';
    return { kind: 'any', result: r, children };
  }
  if ('not' in c) {
    const child = evaluate(c.not, facts, onDate);
    const r: Tri = child.result === 'unknown' ? 'unknown' : child.result === 'true' ? 'false' : 'true';
    return { kind: 'not', result: r, children: [child] };
  }
  const key = c.fact as FactKey;
  const f = usableFact(key, facts[key], onDate);
  const base = {
    kind: 'fact' as const, fact: key, label: FACTS[key].label, op: c.op, expected: c.value,
    factStatus: f.status, factId: f.record?.id, source: f.record?.source, verification: f.record?.verification,
  };
  if (f.status === 'unknown') return { ...base, result: 'unknown', actual: f.record?.value ?? null, unknownReason: f.why };
  return { ...base, result: compare(c.op, f.value, c.value) ? 'true' : 'false', actual: f.value };
}

function compare(op: Op, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case 'eq': return actual === expected;
    case 'neq': return actual !== expected;
    case 'in': return Array.isArray(expected) && (Array.isArray(actual) ? actual.some(a => expected.includes(a)) : expected.includes(actual));
    case 'contains': return Array.isArray(actual) && actual.includes(expected);
    case 'gte': return (actual as number) >= (expected as number);
    case 'lte': return (actual as number) <= (expected as number);
    case 'gt': return (actual as number) > (expected as number);
    case 'lt': return (actual as number) < (expected as number);
  }
}

/**
 * Facts whose unknown state actually blocked the decision, for "we need this
 * information" prompts. Branches that were decided anyway are not listed.
 */
export function unknownFacts(t: TraceNode): FactKey[] {
  if (t.result !== 'unknown') return [];
  if (t.kind === 'fact') return [t.fact];
  return [...new Set(t.children.flatMap(unknownFacts))];
}
