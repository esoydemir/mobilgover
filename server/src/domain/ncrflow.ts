/**
 * Nonconformity flow (v2). Pure logic: which stages are done, what comes next and
 * what still blocks the effectiveness check and the verification.
 *
 *   risk + first response → owner and due date → cause assessment → support suggestion
 *   → actions → (full CAPA: verified root cause) → effectiveness check → verification / close
 *
 * A failed verification or a reopening starts a new round (iteration): new actions,
 * a new effectiveness check and a new verification are needed. Nothing is closed by
 * anything other than an explicit verification.
 */
export type CauseCategory = 'knowledge' | 'equipment' | 'resource' | 'process';
export const CAUSE_CATEGORIES: CauseCategory[] = ['knowledge', 'equipment', 'resource', 'process'];

export type FlowInput = {
  flowVersion: number;
  depth: 'correction' | 'capa';
  status: 'open' | 'awaiting_verification' | 'closed';
  iteration: number;
  ownerId: string | null;
  dueAt: string | Date | null;
  independentVerification: boolean;
  steps: { step: string; iteration: number; doneBy: string }[];
  causes: { stage: 'initial' | 'verified'; iteration: number; categories: string[]; migrated: boolean }[];
  actions: {
    kind: 'correction' | 'corrective_action' | 'follow_up'; iteration: number; status: 'open' | 'done' | 'cancelled'; doneBy: string | null;
    /** A "done" is a claim: it counts only once verified (or recorded before this rule existed: legacy). */
    verification?: 'not_declared' | 'declared' | 'verified' | 'rejected' | 'legacy';
    ownerId?: string | null;
    /** People who uploaded evidence for this action. */
    evidenceBy?: string[];
  }[];
};

/** A completed action counts toward the flow only when its result was verified (or is legacy). */
export const counts = (a: FlowInput['actions'][number]) => a.status === 'done' && (a.verification === undefined || a.verification === 'verified' || a.verification === 'legacy');

export type StageKey = 'containment' | 'assignment' | 'cause' | 'actions' | 'root_cause' | 'effectiveness' | 'verification';
export type StageState = 'done' | 'active' | 'todo';
export type Stage = { key: StageKey; state: StageState; missing: string | null };

export type Flow = {
  stages: Stage[];
  /** Everything before the effectiveness check is in place for the current round. */
  readyForEffectiveness: boolean;
  blockers: string[];
};

const has = <T>(xs: T[], f: (x: T) => boolean) => xs.some(f);

export function flow(n: FlowInput): Flow {
  const it = n.iteration;
  const v1 = n.flowVersion === 1;
  const capa = n.depth === 'capa';
  const cur = n.actions.filter(a => a.iteration === it);

  const containment = has(n.steps, s => s.step === 'containment');
  const assignment = !!n.ownerId && !!n.dueAt;
  const cause = has(n.causes, c => c.stage === 'initial');
  const openCurrent = cur.filter(a => a.status === 'open' && a.kind !== 'follow_up').length;
  const awaiting = cur.filter(a => a.status === 'done' && a.kind !== 'follow_up' && !counts(a)).length;
  const pendingText = awaiting ? `${awaiting} aksiyonun "yapıldı" beyanı kanıtla doğrulanmayı bekliyor.` : null;
  let actionsOk: boolean;
  let actionsMissing: string | null = null;
  if (capa && it === 1) {
    const corr = has(n.actions, a => a.kind === 'correction' && counts(a));
    const ca = has(cur, a => a.kind === 'corrective_action' && counts(a));
    actionsOk = corr && ca && openCurrent === 0 && awaiting === 0;
    actionsMissing = pendingText ?? (!corr ? 'En az bir düzeltme tamamlanıp doğrulanmalı.' : !ca ? 'En az bir düzeltici faaliyet tamamlanıp doğrulanmalı.' : openCurrent ? `${openCurrent} açık aksiyon tamamlanmalı ya da iptal edilmeli.` : null);
  } else {
    const any = has(cur, a => a.kind !== 'follow_up' && counts(a));
    actionsOk = any && openCurrent === 0 && awaiting === 0;
    actionsMissing = pendingText ?? (!any ? (it > 1 ? 'Bu tur için yeni bir aksiyon tamamlanıp doğrulanmalı (önceki doğrulama başarısız oldu).' : 'En az bir aksiyon tamamlanıp doğrulanmalı.')
      : openCurrent ? `${openCurrent} açık aksiyon tamamlanmalı ya da iptal edilmeli.` : null);
  }
  // Full CAPA needs a root cause confirmed in this round (a failed check means the cause may have been wrong).
  const rootCause = !capa || has(n.causes, c => c.stage === 'verified' && (c.iteration === it || (v1 && c.migrated)));
  const effectiveness = has(n.steps, s => s.step === 'effectiveness_check' && s.iteration === it);
  const closed = n.status === 'closed';

  const raw: [StageKey, boolean, string][] = [
    ['containment', containment, 'İlk müdahaleyi kaydet.'],
    ['assignment', assignment || v1, 'Sorumlu ve termin belirlenmeli.'],
    ['cause', cause || v1, 'Neden değerlendirmesi yapılmalı (ilk değerlendirme).'],
    ['actions', actionsOk, actionsMissing ?? ''],
    ...(capa ? [['root_cause', rootCause, 'Kök neden yetkili tarafından doğrulanmalı.'] as [StageKey, boolean, string]] : []),
    ['effectiveness', effectiveness || closed, 'Etkinlik kontrolü kaydedilmeli.'],
    ['verification', closed, n.status === 'awaiting_verification' ? 'Yetkili doğrulaması bekleniyor.' : 'Önce etkinlik kontrolü.'],
  ];
  let activeSet = false;
  const stages: Stage[] = raw.map(([key, ok, missing]) => {
    if (ok) return { key, state: 'done', missing: null };
    const state: StageState = activeSet ? 'todo' : 'active';
    activeSet = true;
    return { key, state, missing };
  });
  const before = stages.filter(s => s.key !== 'effectiveness' && s.key !== 'verification');
  return {
    stages,
    readyForEffectiveness: before.every(s => s.state === 'done'),
    blockers: before.filter(s => s.state !== 'done').map(s => s.missing!).filter(Boolean),
  };
}

/**
 * People who did this round's fix: whoever owns, completed (pressed the button for) or gave
 * evidence for a correction or corrective action in the round.
 */
export function roundPerformers(n: Pick<FlowInput, 'iteration' | 'actions'>): Set<string> {
  const out = new Set<string>();
  for (const a of n.actions) {
    if (a.iteration !== n.iteration || a.kind === 'follow_up' || a.status !== 'done') continue;
    if (a.doneBy) out.add(a.doneBy);
    if (a.ownerId) out.add(a.ownerId);
    for (const e of a.evidenceBy ?? []) out.add(e);
  }
  return out;
}

/**
 * Independent verification: for high risk, nobody who did this round's correction or
 * corrective action (owner, the person who marked it done, or who gave its evidence)
 * may verify the case.
 */
export function verifierConflict(n: Pick<FlowInput, 'independentVerification' | 'iteration' | 'actions'>, verifierId: string): boolean {
  if (!n.independentVerification) return false;
  return roundPerformers(n).has(verifierId);
}

/**
 * Support suggestions per cause category. They only point somewhere; nothing is ordered,
 * assigned or closed without the user doing it.
 */
export type Suggestion = { category: CauseCategory; kind: 'explanation' | 'training' | 'service_request' | 'equipment' | 'assign' | 'team' | 'follow_up' | 'evidence'; title: string; body: string; available: boolean };

export function suggestions(categories: CauseCategory[], ctx: { hasEquipment: boolean; hasObligation: boolean; serviceCategory: string | null }): Suggestion[] {
  const out: Suggestion[] = [];
  for (const c of categories) {
    if (c === 'knowledge') {
      out.push({ category: c, kind: 'explanation', title: 'Talimatı ve "neden?" açıklamasını birlikte gözden geçir', available: ctx.hasObligation,
        body: ctx.hasObligation ? 'Görevin talimatı ve yükümlülüğün açıklaması, kaynağı ve kural sürümüyle açılır.' : 'Bu kayıt bir yükümlülüğe bağlı değil; açıklama yok.' });
      out.push({ category: c, kind: 'training', title: 'Eğitim', available: false, body: 'Eğitim modülü henüz yok. Şimdilik bilgilendirmeyi bir "takip aksiyonu" olarak kaydedebilirsin.' });
    }
    if (c === 'equipment') {
      out.push({ category: c, kind: 'service_request', title: 'Uzman hizmeti için talep hazırla', available: true,
        body: 'Talep formu bu kayda bağlı açılır. Sen göndermedikçe talep oluşmaz; teklif kabul etmedikçe iş başlamaz ve ödeme uygulama dışındadır.' });
      if (ctx.hasEquipment) out.push({ category: c, kind: 'equipment', title: 'Ekipmanı kullanım dışı bırakmayı değerlendir', available: true,
        body: 'Ekipmanlar ekranından gerekçeyle kullanımdan kaldırılabilir; karar senin.' });
    }
    if (c === 'resource') {
      out.push({ category: c, kind: 'assign', title: 'İşi yapacak kişiyi ve terminini netleştir', available: true, body: 'Sorumlu ve termin bu kayıtta değiştirilebilir; değişiklik geçmişte görünür.' });
      out.push({ category: c, kind: 'team', title: 'Ekibe kişi ekle', available: true, body: 'Personel veya şube yöneticisi davet edilebilir.' });
    }
    if (c === 'process') {
      out.push({ category: c, kind: 'follow_up', title: 'Süreç için sorumlusu ve termini belli bir takip aksiyonu aç', available: true,
        body: 'Ne değişecek, kim yapacak, ne zamana kadar: aksiyon olarak kaydedilir ve terminine yaklaşınca bildirim gider.' });
    }
  }
  return out;
}
