import { evaluate, unknownFacts, type Condition, type Facts, type TraceNode } from './conditions';
import type { FactKey } from './facts';

export type Decision = 'applies' | 'not_applicable' | 'needs_info' | 'needs_review';

export type RuleForDecision = {
  ruleVersionId: string;
  condition: Condition;
  effectiveFrom: string;
  effectiveTo: string | null;
  ambiguityNote: string | null;
};

export type ApplicabilityResult = {
  decision: Decision;
  trace: TraceNode;
  missingFacts: FactKey[];
  reason: string;
};

/**
 * Turns a three-valued evaluation into an obligation decision.
 * UNKNOWN becomes "needs_info", never "not_applicable"; an ambiguous provision
 * that could match is routed to human review instead of being decided silently.
 */
export function decide(rule: RuleForDecision, facts: Facts, onDate: string): ApplicabilityResult | null {
  if (rule.effectiveFrom > onDate || (rule.effectiveTo && rule.effectiveTo < onDate)) return null;
  const trace = evaluate(rule.condition, facts, onDate);
  const missingFacts = unknownFacts(trace);
  if (trace.result === 'false') {
    return { decision: 'not_applicable', trace, missingFacts: [], reason: 'Koşullar doğrulanmış profil bilgileriyle karşılanmıyor.' };
  }
  if (rule.ambiguityNote) {
    return { decision: 'needs_review', trace, missingFacts, reason: `Uzman incelemesi gerekiyor: ${rule.ambiguityNote}` };
  }
  if (trace.result === 'unknown') {
    return { decision: 'needs_info', trace, missingFacts, reason: 'Karar için eksik veya onaylanmamış profil bilgisi var.' };
  }
  return { decision: 'applies', trace, missingFacts: [], reason: 'Koşullar doğrulanmış profil bilgileriyle karşılanıyor.' };
}
