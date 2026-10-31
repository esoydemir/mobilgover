/**
 * Compliance indicators. The single score is an internal guide, never an
 * official audit result, and it is always shown next to the components it
 * summarises so that an open critical risk cannot hide behind a good average.
 */
export const FORMULA_VERSION = 'indicators-v1';

export type IndicatorInput = {
  dueTasks: number;
  onTimeTasks: number;
  doneTasks: number;
  conformingTasks: number;
  doneWithCompleteEvidence: number;
  overdueTasks: number;
  openCriticalOrHighNcrs: number;
  recurringNcrs: number;
  obligationsNeedingInfo: number;
  obligationsNeedingReview: number;
};

export type Ratio = { value: number | null; numerator: number; denominator: number };

export type Indicators = {
  formulaVersion: string;
  status: 'critical_risk' | 'insufficient_data' | 'attention' | 'on_track';
  score: number | null;
  scoreCappedBy: string | null;
  components: {
    onTime: Ratio;
    conforming: Ratio;
    evidenceCoverage: Ratio;
    overdueTasks: number;
    openCriticalRisks: number;
    recurringNonconformities: number;
    unknowns: { needsInfo: number; needsReview: number };
  };
  disclaimer: string;
};

const ratio = (n: number, d: number): Ratio => ({ value: d === 0 ? null : n / d, numerator: n, denominator: d });

/** Weights are a product choice for v1, not a legal ranking; they are versioned with the formula. */
export const WEIGHTS = { onTime: 0.4, conforming: 0.4, evidenceCoverage: 0.2 } as const;
/** With an open critical/high risk the score cannot read as "good". */
export const CRITICAL_CAP = 49;

export function computeIndicators(i: IndicatorInput): Indicators {
  const onTime = ratio(i.onTimeTasks, i.dueTasks);
  const conforming = ratio(i.conformingTasks, i.doneTasks);
  const evidenceCoverage = ratio(i.doneWithCompleteEvidence, i.doneTasks);

  // Missing data is reported as missing, never filled in as compliant.
  let score: number | null = null;
  if (onTime.value !== null && conforming.value !== null && evidenceCoverage.value !== null) {
    score = Math.round(100 * (WEIGHTS.onTime * onTime.value + WEIGHTS.conforming * conforming.value + WEIGHTS.evidenceCoverage * evidenceCoverage.value));
  }
  let scoreCappedBy: string | null = null;
  if (score !== null && i.openCriticalOrHighNcrs > 0 && score > CRITICAL_CAP) {
    score = CRITICAL_CAP;
    scoreCappedBy = `${i.openCriticalOrHighNcrs} açık kritik/yüksek risk`;
  }

  const unknown = i.obligationsNeedingInfo + i.obligationsNeedingReview;
  const status: Indicators['status'] =
    i.openCriticalOrHighNcrs > 0 ? 'critical_risk'
    : score === null || unknown > 0 ? 'insufficient_data'
    : i.overdueTasks > 0 || i.recurringNcrs > 0 || score < 80 ? 'attention'
    : 'on_track';

  return {
    formulaVersion: FORMULA_VERSION, status, score, scoreCappedBy,
    components: {
      onTime, conforming, evidenceCoverage,
      overdueTasks: i.overdueTasks,
      openCriticalRisks: i.openCriticalOrHighNcrs,
      recurringNonconformities: i.recurringNcrs,
      unknowns: { needsInfo: i.obligationsNeedingInfo, needsReview: i.obligationsNeedingReview },
    },
    disclaimer: 'GoverHub iç göstergesidir; resmî denetim sonucu veya hukuki uygunluk garantisi değildir.',
  };
}
