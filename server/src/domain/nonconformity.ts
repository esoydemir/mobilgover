/**
 * Risk-based depth for nonconformities. A one-off minor deviation needs a
 * correction; serious or repeated problems need root cause and corrective
 * action, plus independent verification before closing.
 */
export type Severity = 'minor' | 'major' | 'critical';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type Step = 'containment' | 'correction' | 'root_cause' | 'corrective_action' | 'effectiveness_check';

const LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
const BASE: Record<Severity, RiskLevel> = { minor: 'low', major: 'medium', critical: 'high' };

/** Window used to count repeats of the same hazard on the same equipment. */
export const RECURRENCE_WINDOW_DAYS = 30;

export type RiskAssessment = {
  level: RiskLevel;
  depth: 'correction' | 'capa';
  steps: Step[];
  independentVerification: boolean;
  rationale: { severity: Severity; base: RiskLevel; recurrenceCount: number; escalatedBy: number; policy: string };
};

/**
 * `recurrenceCount` = earlier nonconformities with the same equipment and
 * hazard type in the window (structured match, not text similarity).
 */
export function assessRisk(severity: Severity, recurrenceCount: number): RiskAssessment {
  const base = BASE[severity];
  const escalatedBy = recurrenceCount >= 3 ? 2 : recurrenceCount >= 1 ? 1 : 0;
  const level = LEVELS[Math.min(LEVELS.indexOf(base) + escalatedBy, LEVELS.length - 1)]!;
  const capa = level === 'high' || level === 'critical' || recurrenceCount >= 2;
  const steps: Step[] = capa
    ? ['containment', 'correction', 'root_cause', 'corrective_action', 'effectiveness_check']
    : ['containment', 'correction', 'effectiveness_check'];
  return {
    level, depth: capa ? 'capa' : 'correction', steps,
    independentVerification: level === 'high' || level === 'critical',
    rationale: { severity, base, recurrenceCount, escalatedBy, policy: 'risk-policy-v1 (örnek politika, işletme onayı gerekir)' },
  };
}

export type StepRecord = { step: Step; doneBy: string };

export type CloseCheck = { ok: true } | { ok: false; code: 'STEPS_INCOMPLETE' | 'VERIFIER_NOT_INDEPENDENT'; message: string };

/**
 * Closing needs every required step and, where risk demands it, a verifier
 * who did not perform the correction or corrective action.
 */
export function canClose(a: Pick<RiskAssessment, 'steps' | 'independentVerification'>, done: StepRecord[], verifierId: string): CloseCheck {
  const doneSteps = new Set(done.map(d => d.step));
  const missing = a.steps.filter(s => !doneSteps.has(s));
  if (missing.length) return { ok: false, code: 'STEPS_INCOMPLETE', message: `Tamamlanmamış adımlar: ${missing.join(', ')}` };
  if (a.independentVerification) {
    const performers = done.filter(d => d.step === 'correction' || d.step === 'corrective_action').map(d => d.doneBy);
    if (performers.includes(verifierId)) {
      return { ok: false, code: 'VERIFIER_NOT_INDEPENDENT', message: 'Yüksek riskli kayıtta kapanışı, düzeltmeyi yapan kişiden farklı bir yetkili doğrulamalı.' };
    }
  }
  return { ok: true };
}
