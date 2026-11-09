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
    kind: 'correction' | 'corrective_action' | 'follow_up'; iteration: number; status: 'open' | 'done' | 'cancelled';
    /** Who pressed "done" in the app (declared it). */
    doneBy: string | null;
    /** A "done" is a claim: it counts only once verified. */
    verification?: 'not_declared' | 'declared' | 'verified' | 'rejected' | 'legacy';
    /** The action's RESPONSIBLE person (aksiyon sorumlusu) — not the business owner role. */
    ownerId?: string | null;
    /** Who actually did the work, when someone else declared it. */
    performedBy?: string | null;
    /** People who uploaded evidence for this action. */
    evidenceBy?: string[];
  }[];
  /** Users behind a provider profile that did a service job linked to this case. */
  providerUsers?: string[];
};

/**
 * A completed action counts toward the flow only when its result was verified.
 * "legacy" (completed before claims needed verification) is history: it stands for a case that
 * was already closed, but an OPEN case cannot be closed on it until someone verifies it.
 */
export const counts = (a: FlowInput['actions'][number], caseClosed = false) =>
  a.status === 'done' && (a.verification === undefined || a.verification === 'verified' || (a.verification === 'legacy' && caseClosed));

/**
 * Who may verify a claim or a closure without contributing to it. Self-verification (a contributor
 * verifying, with a reason, clearly labelled) is allowed only for low risk, and for medium risk only
 * for corrections and follow-ups. High and critical risk always need someone independent.
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export function selfVerifyAllowed(risk: RiskLevel, kind: 'correction' | 'corrective_action' | 'follow_up' | 'closure'): boolean {
  if (risk === 'low') return true;
  if (risk === 'medium') return kind === 'correction' || kind === 'follow_up';
  return false;
}
export const SELF_VERIFY_MIN_REASON = 20;

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
  const closed = n.status === 'closed';
  const ok = (a: FlowInput['actions'][number]) => counts(a, closed);

  const containment = has(n.steps, s => s.step === 'containment');
  const assignment = !!n.ownerId && !!n.dueAt;
  const cause = has(n.causes, c => c.stage === 'initial');
  const openCurrent = cur.filter(a => a.status === 'open' && a.kind !== 'follow_up').length;
  const awaiting = cur.filter(a => a.status === 'done' && a.kind !== 'follow_up' && !ok(a)).length;
  const legacyOpen = cur.filter(a => a.status === 'done' && a.kind !== 'follow_up' && a.verification === 'legacy' && !closed).length;
  const pendingText = legacyOpen
    ? `${legacyOpen} eski aksiyon (doğrulama şartından önce "tamamlandı" denmiş) doğrulanmadı; kapanış için bir yetkili doğrulamalı.`
    : awaiting ? `${awaiting} aksiyonun "yapıldı" beyanı kanıtla doğrulanmayı bekliyor.` : null;
  let actionsOk: boolean;
  let actionsMissing: string | null = null;
  if (capa && it === 1) {
    const corr = has(n.actions, a => a.kind === 'correction' && ok(a));
    const ca = has(cur, a => a.kind === 'corrective_action' && ok(a));
    actionsOk = corr && ca && openCurrent === 0 && awaiting === 0;
    actionsMissing = pendingText ?? (!corr ? 'En az bir düzeltme tamamlanıp doğrulanmalı.' : !ca ? 'En az bir düzeltici faaliyet tamamlanıp doğrulanmalı.' : openCurrent ? `${openCurrent} açık aksiyon tamamlanmalı ya da iptal edilmeli.` : null);
  } else {
    const any = has(cur, a => a.kind !== 'follow_up' && ok(a));
    actionsOk = any && openCurrent === 0 && awaiting === 0;
    actionsMissing = pendingText ?? (!any ? (it > 1 ? 'Bu tur için yeni bir aksiyon tamamlanıp doğrulanmalı (önceki doğrulama başarısız oldu).' : 'En az bir aksiyon tamamlanıp doğrulanmalı.')
      : openCurrent ? `${openCurrent} açık aksiyon tamamlanmalı ya da iptal edilmeli.` : null);
  }
  // Full CAPA needs a root cause confirmed in this round (a failed check means the cause may have been wrong).
  const rootCause = !capa || has(n.causes, c => c.stage === 'verified' && (c.iteration === it || (v1 && c.migrated)));
  const effectiveness = has(n.steps, s => s.step === 'effectiveness_check' && s.iteration === it);

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

/** Everyone with a part in one action: responsible person, doer, declarer, evidence givers. */
export function actionContributors(a: FlowInput['actions'][number]): Set<string> {
  return new Set([a.ownerId, a.performedBy, a.doneBy, ...(a.evidenceBy ?? [])].filter((x): x is string => !!x));
}

/**
 * People who took part in this round's fix: for every correction or corrective action of the round,
 * its responsible person, whoever did it, whoever declared it done and whoever gave evidence;
 * plus the provider of a service done for this case. Holding the business-owner ROLE is not a part.
 */
export function roundPerformers(n: Pick<FlowInput, 'iteration' | 'actions' | 'providerUsers'>): Set<string> {
  const out = new Set<string>(n.providerUsers ?? []);
  for (const a of n.actions) {
    if (a.iteration !== n.iteration || a.kind === 'follow_up' || a.status !== 'done') continue;
    for (const u of actionContributors(a)) out.add(u);
  }
  return out;
}

/** True when this verifier took part in the round (they may still self-verify where the risk allows). */
export function verifierConflict(n: Pick<FlowInput, 'independentVerification' | 'iteration' | 'actions' | 'providerUsers'>, verifierId: string): boolean {
  if (!n.independentVerification) return false;
  return roundPerformers(n).has(verifierId);
}

/**
 * Support suggestions per cause category. They only point somewhere; nothing is ordered,
 * assigned or closed without the user doing it.
 */
export type Suggestion = { key: string; category: CauseCategory; kind: 'explanation' | 'training' | 'service_request' | 'equipment' | 'equipment_history' | 'assign' | 'team' | 'follow_up' | 'evidence';
  title: string; body: string; available: boolean };

export function suggestions(categories: CauseCategory[], ctx: { hasEquipment: boolean; hasObligation: boolean; serviceCategory: string | null;
  relatedTraining?: number; equipmentHistory?: number }): Suggestion[] {
  const out: Omit<Suggestion, 'key'>[] = [];
  for (const c of categories) {
    if (c === 'knowledge') {
      out.push({ category: c, kind: 'explanation', title: 'Talimatı ve "neden?" açıklamasını birlikte gözden geçir', available: ctx.hasObligation,
        body: ctx.hasObligation ? 'Görevin talimatı ve yükümlülüğün açıklaması, kaynağı ve kural sürümüyle açılır.' : 'Bu kayıt bir yükümlülüğe bağlı değil; açıklama yok.' });
      out.push({ category: c, kind: 'training', title: 'Kişiye eğitim ata', available: true,
        body: `${ctx.relatedTraining ? `Bu konuyla ilgili ${ctx.relatedTraining} eğitim var. ` : ''}İlgili eğitimi ata: okuma, kısa değerlendirme ve sahada etkinlik doğrulaması ayrı kaydedilir. Eğitimin tamamlanması bu kaydı kapatmaz.` });
    }
    if (c === 'equipment') {
      if (ctx.hasEquipment) out.push({ category: c, kind: 'equipment_history', title: 'Ekipmanın geçmişine bak', available: true,
        body: ctx.equipmentHistory ? `Bu ekipmanda önceden ${ctx.equipmentHistory} kayıt var: önceki müdahaleler, hizmetler, belgeler ve son ölçümler.` : 'Bu ekipmanda önceki kayıt yok; belgeleri ve son ölçümleri gör.' });
      out.push({ category: c, kind: 'service_request', title: ctx.serviceCategory ? 'Uygun hizmet kategorisinde talep hazırla' : 'Uzman hizmeti için talep hazırla', available: true,
        body: 'Talep formu bu kayda bağlı ve uygun kategori seçili açılır. Sen göndermedikçe talep oluşmaz; teklif kabul etmedikçe iş başlamaz ve ödeme uygulama dışındadır.' });
      if (ctx.hasEquipment) out.push({ category: c, kind: 'equipment', title: 'Ekipmanı kullanım dışı bırakmayı değerlendir', available: true,
        body: 'Ekipmanlar ekranından gerekçeyle kullanımdan kaldırılabilir; karar senin.' });
    }
    if (c === 'resource') {
      out.push({ category: c, kind: 'assign', title: 'İşi yapacak kişiyi ve terminini netleştir', available: true, body: 'Sorumlu ve termin bu kayıtta değiştirilebilir; değişiklik geçmişte görünür.' });
      out.push({ category: c, kind: 'team', title: 'Ekibe kişi ekle', available: true, body: 'Personel veya şube yöneticisi davet edilebilir.' });
    }
    if (c === 'process') {
      out.push({ category: c, kind: 'assign', title: 'Süreç sorumlusunu belirle', available: true, body: 'Sürecin sahibini ve terminini bu kayıtta belirle; değişiklik geçmişte görünür.' });
      out.push({ category: c, kind: 'follow_up', title: 'Süreç için sorumlusu ve termini belli bir takip aksiyonu aç', available: true,
        body: 'Ne değişecek, kim yapacak, ne zamana kadar: aksiyon olarak kaydedilir ve terminine yaklaşınca bildirim gider.' });
    }
  }
  return out.map(x => ({ ...x, key: `${x.category}:${x.kind}` }));
}

/**
 * One look at a case: how far it is, who does what next, and what is still missing for closure.
 * People are named where the case knows them; otherwise the role that acts.
 */
export type NextStep = { stage: StageKey | 'closed'; who: string; what: string; mine: boolean };
export function nextStep(f: Flow, ctx: {
  status: FlowInput['status']; ownerName: string | null; openActions: { ownerName: string | null; mine: boolean }[]; declaredActions: number;
  serviceAccepted: boolean; can: { act: boolean; manage: boolean; verify: boolean; verifyAction: boolean }; independent: boolean;
}): NextStep {
  if (ctx.status === 'closed') return { stage: 'closed', who: '—', what: 'Kayıt doğrulanıp kapatıldı. Yeniden görülürse yeniden açılabilir.', mine: false };
  const active = f.stages.find(s => s.state === 'active');
  const owner = ctx.ownerName ?? 'Sorumlu (henüz atanmadı)';
  const verifier = ctx.independent ? 'Bu turda payı olmayan bir yetkili ya da davet edilen dış doğrulayıcı' : 'Şube yöneticisi ya da işletme sahibi';
  switch (active?.key) {
    case 'containment': return { stage: 'containment', who: ctx.ownerName ?? 'Şubede çalışan herkes', what: 'İlk müdahaleyi kaydet: etkiyi şimdi nasıl sınırladın?', mine: ctx.can.act };
    case 'assignment': return { stage: 'assignment', who: 'Şube yöneticisi ya da işletme sahibi', what: 'Sorumlu ve termin belirle.', mine: ctx.can.manage };
    case 'cause': return { stage: 'cause', who: owner, what: 'İlk neden değerlendirmesini yap (bilgi, ekipman, kaynak, süreç).', mine: ctx.can.act };
    case 'actions': {
      if (ctx.declaredActions) return { stage: 'actions', who: verifier, what: `${ctx.declaredActions} aksiyonun "yapıldı" beyanını kanıtla doğrula.`, mine: ctx.can.verifyAction };
      if (ctx.openActions.length) {
        const names = [...new Set(ctx.openActions.map(a => a.ownerName ?? 'atanmamış'))];
        return { stage: 'actions', who: names.join(', '), what: `${ctx.openActions.length} açık aksiyonu tamamla ve "yapıldı" bildir.`, mine: ctx.openActions.some(a => a.mine) };
      }
      return { stage: 'actions', who: owner, what: active.missing ?? 'Aksiyon ekle.', mine: ctx.can.act };
    }
    case 'root_cause': return { stage: 'root_cause', who: 'Şube yöneticisi ya da işletme sahibi', what: 'Kök nedeni dayanağıyla doğrula.', mine: ctx.can.manage };
    case 'effectiveness': return { stage: 'effectiveness', who: owner,
      what: ctx.serviceAccepted ? 'Hizmet teslim alındı; teknik etkinliği ayrıca kontrol et (ör. yeni ölçümle sıcaklığın limitte olduğunu göster).' : 'Önlemin işe yaradığını ölçüm ya da gözlemle kontrol et.', mine: ctx.can.act };
    case 'verification': return { stage: 'verification', who: verifier, what: 'Etkinlik kontrolünü doğrula: etkiliyse kapat, değilse yeni tur başlar.', mine: ctx.can.verify };
    default: return { stage: 'verification', who: verifier, what: 'Doğrulama bekleniyor.', mine: ctx.can.verify };
  }
}
