export type Cause = 'knowledge' | 'equipment' | 'resource' | 'process';
export type StageKey = 'containment' | 'assignment' | 'cause' | 'actions' | 'root_cause' | 'effectiveness' | 'verification';

import type { ProductState } from './ProductCard';

export type NcrDetail = {
  /** Null in sectors where no product can be affected. */
  product?: ProductState | null;
  id: string; site_id: string; title: string; description: string; risk_level: string; depth: 'correction' | 'capa';
  status: 'open' | 'awaiting_verification' | 'closed'; recurrence_count: number; source: 'task' | 'manual'; flow_version: number;
  iteration: number; reopened_count: number; severity: string | null; hazard_type: string;
  emergency_instruction: string | null; detected_at: string; due_at: string | null; closed_at: string | null;
  risk_rationale: { severity: string; base: string; escalatedBy: number; policy: string; independentVerification: boolean };
  owner: { id: string; name: string | null; active: boolean } | null;
  overdue: boolean;
  equipment: { id: string; name: string; type: string } | null;
  task: { id: string; obligation_id: string; title: string; instructions: string } | null;
  flow: { stages: { key: StageKey; state: 'done' | 'active' | 'todo'; missing: string | null }[]; readyForEffectiveness: boolean; blockers: string[] };
  steps: { step: string; notes: string; done_by: string; done_by_name: string; done_at: string; iteration: number;
    data: { measurement?: { value: number; unit: string | null; limitMin: number | null; limitMax: number | null; within: boolean | null; basis: string } } | null }[];
  causes: { id: string; stage: 'initial' | 'verified'; iteration: number; categories: Cause[]; notes: string; migrated: boolean; done_by_name: string; done_at: string }[];
  actions: { id: string; iteration: number; kind: 'correction' | 'corrective_action' | 'follow_up'; description: string; owner_id: string | null; owner_name: string | null;
    owner_inactive: boolean; due_at: string | null; status: 'open' | 'done' | 'cancelled'; result_notes: string | null; done_by_name: string | null; done_at: string | null; overdue: boolean; created_by: string;
    evidence_required: 'none' | 'photo' | 'document'; verification_status: 'not_declared' | 'declared' | 'verified' | 'rejected' | 'legacy';
    verified_by_name: string | null; verified_at: string | null; verification_notes: string | null;
    evidence: { id: string; kind: string; status: 'pending_upload' | 'stored' | 'rejected'; mime: string | null; created_by: string; created_at: string; rejection_reason: string | null }[];
    can_verify: boolean; verify_blocked_reason: string | null; can_add_evidence: boolean;
    can_self_verify: boolean; legacy_unverified: boolean; performed_by: string | null; performed_by_name: string | null; done_by: string | null;
    verification_mode: 'independent' | 'self' | null; verified_via: 'membership' | 'grant' | null }[];
  verifications: { iteration: number; result: 'effective' | 'not_effective' | 'reopened'; notes: string; verified_by_name: string; verified_at: string;
    verification_mode: 'independent' | 'self' | null; verified_via: 'membership' | 'grant' | null }[];
  verificationPolicy: string;
  trainings: import('./parts').TrainingRow[];
  relatedTraining: { id: string; title: string; summary: string; is_example: boolean }[];
  services: { id: string; title: string; status: string; category_code: string; job_status: string | null }[];
  serviceLinks?: { linked: { id: string; job_id: string; version_number: number; basis: string; linked_at: string; linked_by: string; request_title: string; source_case_title: string | null }[];
    linkable: { job_id: string; request_title: string; request_created_at: string; source_case_title: string | null; version: number; uploaded_at: string }[] };
  history: { event_type: string; payload: any; occurred_at: string; actor_name: string | null }[];
  cause: { initial: NcrDetail['causes'][number] | null; verified: NcrDetail['causes'][number] | null };
  suggestions: { key: string; category: Cause; kind: string; title: string; body: string; available: boolean; serviceCategory: string | null; equipmentId: string | null;
    dismissed: { reason: string; replacement: string | null; by: string; at: string } | null }[];
  next: { stage: string; who: string; what: string; mine: boolean };
  firstAction: { level: string; items: { key: 'containment' | 'assignment'; text: string }[]; note: string } | null;
  closureMissing: { stage: StageKey; missing: string | null }[];
  progress: { done: number; total: number };
  measurement: { value: string; unit: string; limit_min: string | null; limit_max: string | null; measured_at: string; limit_basis?: string | null } | null;
  documents: { id: string; title: string; docType: string }[];
  /** What the case rests on; only for people who manage or may close it. */
  proof: { task: { completedBy: string | null; completedAt: string | null; measurements: { value: string | number; unit: string; withinLimit: boolean; measuredAt: string }[]; notes: string[]; files: { evidenceId: string; kind: string; mime: string }[] } | null;
    reports: { title: string; version: number; report: string; submittedAt: string; decision: string | null; decisionNote: string | null; reviewStatus: string | null; evidenceId: string | null }[] } | null;
  permissions: { act: boolean; manage: boolean; verify: boolean; selfVerify: boolean; verifyBlockedReason: string | null; reopen: boolean; serviceRequest: boolean; inviteVerifier: boolean };
};

export const CAUSE_LABEL: Record<Cause, [string, string]> = {
  knowledge: ['Bilgi eksikliği', 'Ne yapılacağı ya da nasıl yapılacağı bilinmiyordu'],
  equipment: ['Ekipman eksikliği', 'Arıza, bakım ya da uygun ekipman yok'],
  resource: ['Kaynak eksikliği', 'Kişi, zaman ya da malzeme yetmedi'],
  process: ['Süreç eksikliği', 'Sorumlu, sıra ya da kontrol adımı tanımlı değil'],
};

export const STAGE_LABEL: Record<StageKey, string> = {
  containment: 'Risk ve ilk müdahale', assignment: 'Sorumlu ve termin', cause: 'Neden değerlendirmesi', actions: 'Aksiyonlar',
  root_cause: 'Doğrulanmış kök neden', effectiveness: 'Etkinlik kontrolü', verification: 'Doğrulama ve kapanış',
};

export const ACTION_KIND: Record<string, string> = { correction: 'Düzeltme', corrective_action: 'Düzeltici faaliyet', follow_up: 'Takip aksiyonu' };

export const HAZARDS: [string, string][] = [
  ['cold_chain_temperature', 'Sıcaklık / soğuk zincir'], ['personal_hygiene', 'Kişisel hijyen'], ['gas_leak', 'Gaz / LPG'],
  ['equipment_failure', 'Ekipman arızası'], ['cleaning', 'Temizlik'], ['other', 'Diğer'],
];

export const SEVERITIES: [string, string, string][] = [
  ['minor', 'Düşük', 'Küçük sapma; ürün veya kişi için doğrudan tehlike yok'],
  ['major', 'Önemli', 'Tekrarlarsa ya da sürerse sorun yaratır'],
  ['critical', 'Kritik', 'Gıda güvenliği ya da kişi güvenliği için doğrudan tehlike'],
];

/** Audit events → short Turkish lines for the history card. */
const PRODUCT_DECISION_TR: Record<string, string> = { release: 'Satışa/kullanıma uygun', rework: 'Yeniden işleme', hold: 'Bekletme (karantina)', destroy: 'İmha', return_supplier: 'Tedarikçiye iade', no_product_effect: 'Ürün etkisi yok' };

export function historyLine(h: NcrDetail['history'][number]): string {
  const p = h.payload ?? {};
  switch (h.event_type) {
    case 'nonconformity.opened': return p.source === 'manual' ? 'Elle bildirildi' : 'Görevden açıldı';
    case 'nonconformity.assigned': return `Sorumlu / termin belirlendi${p.reason ? ` · gerekçe: ${p.reason}` : ''}`;
    case 'nonconformity.step_done': return p.step === 'containment' ? 'İlk müdahale kaydedildi' : p.step === 'effectiveness_check' ? `Etkinlik kontrolü kaydedildi${p.measurement ? ` · yeni ölçüm ${String(p.measurement.value).replace('.', ',')} ${p.measurement.unit ?? ''}`.trimEnd() : ''}${p.notes ? `: ${p.notes}` : ''}` : `Adım: ${p.step}`;
    case 'nonconformity.cause_assessed': return `${p.stage === 'verified' ? 'Kök neden doğrulandı' : 'İlk değerlendirme'}: ${(p.categories ?? []).map((c: Cause) => CAUSE_LABEL[c]?.[0] ?? c).join(', ')}`;
    case 'nonconformity.suggestion_decided': return `Öneri ${p.decision === 'dismissed' ? 'kenara konuldu' : 'geri alındı'}: ${p.reason}${p.replacement ? ` · yerine: ${p.replacement}` : ''}`;
    case 'nonconformity.action_added': return `${ACTION_KIND[p.kind] ?? 'Aksiyon'} eklendi: ${p.description}`;
    case 'nonconformity.action_done': return `Aksiyon "yapıldı" olarak bildirildi${p.notes ? `: ${p.notes}` : ''} (doğrulama bekliyor)`;
    case 'nonconformity.action_verified': return `Aksiyon sonucu doğrulandı${p.mode === 'self' ? ' (öz doğrulama)' : p.via === 'grant' ? ' (dış doğrulayıcı)' : ''}${p.legacy ? ' · eski kayıt' : ''}${p.notes ? `: ${p.notes}` : ''}`;
    case 'nonconformity.action_rejected': return `Aksiyon sonucu kabul edilmedi${p.notes ? `: ${p.notes}` : ''}`;
    case 'nonconformity.action_cancel': return `Aksiyon iptal edildi${p.notes ? `: ${p.notes}` : ''}`;
    case 'nonconformity.action_reassign': return 'Aksiyon yeniden atandı';
    case 'nonconformity.verification_failed': return `Doğrulama başarısız: ${p.notes}`;
    case 'nonconformity.training_assigned': return `Eğitim atandı: ${p.title}`;
    case 'nonconformity.training_field_verified': return `Eğitimin sahadaki etkinliği kaydedildi (${p.userName}): ${p.result === 'effective' ? 'etkili' : 'etkili değil'}`;
    case 'nonconformity.closed': return `Doğrulandı ve kapatıldı${p.mode === 'self' ? ' (öz doğrulama)' : p.via === 'grant' ? ' (dış doğrulayıcı)' : ''}`;
    case 'nonconformity.reopened': return `Yeniden açıldı: ${p.reason}`;
    case 'nonconformity.product_assessment_opened': return `Ürün değerlendirmesi açıldı: ${p.product}${p.quantityUnknown ? ' · miktar bilinmiyor' : p.quantity != null ? ` · ${p.quantity}${p.unit ? ' ' + p.unit : ''}` : ''}`;
    case 'nonconformity.product_decided': return `Ürün kararı verildi: ${p.product} · ${PRODUCT_DECISION_TR[p.decision] ?? p.decision}`;
    case 'nonconformity.product_decision_corrected': return `Ürün kararı düzeltildi: ${p.product} · ${PRODUCT_DECISION_TR[p.previous?.decision] ?? p.previous?.decision} → ${PRODUCT_DECISION_TR[p.now?.decision] ?? p.now?.decision} · neden: ${p.reason}`;
    default: return h.event_type;
  }
}
