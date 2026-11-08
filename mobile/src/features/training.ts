import { C, tint } from '../theme';

export const VERSION_STATUS: Record<string, [string, string, string]> = {
  draft: ['TASLAK', C.t2, tint.white(0.08)], in_review: ['İNCELEMEDE', C.warn, tint.warn(0.14)],
  published: ['YAYIMLANDI', C.lime, tint.lime(0.14)], archived: ['ARŞİVLENDİ', C.t3, tint.white(0.06)],
};
export const LINK_KIND: Record<string, string> = { hazard: 'Konu', task_template: 'Kontrol', rule: 'Yükümlülük' };
/** Example link targets in the demo rule set (labels only; the server stores the codes). */
export const LINK_OPTIONS: { kind: 'hazard' | 'task_template' | 'rule'; ref: string; label: string }[] = [
  { kind: 'hazard', ref: 'cold_chain_temperature', label: 'Sıcaklık / soğuk zincir' }, { kind: 'hazard', ref: 'personal_hygiene', label: 'Kişisel hijyen' },
  { kind: 'hazard', ref: 'gas_leak', label: 'Gaz / LPG' }, { kind: 'hazard', ref: 'equipment_failure', label: 'Ekipman arızası' }, { kind: 'hazard', ref: 'cleaning', label: 'Temizlik' },
  { kind: 'task_template', ref: 'fridge_temp', label: 'Soğutucu sıcaklık kontrolü' }, { kind: 'task_template', ref: 'glove_daily', label: 'Eldiven kontrolü' },
  { kind: 'task_template', ref: 'lpg_monthly', label: 'LPG aylık kontrol' },
  { kind: 'rule', ref: 'EX-COLD-CHAIN', label: 'Soğuk muhafaza (örnek kural)' }, { kind: 'rule', ref: 'EX-GLOVE', label: 'Eldiven (örnek kural)' }, { kind: 'rule', ref: 'EX-LPG-CHECK', label: 'LPG (örnek kural)' },
];
export const linkLabel = (l: { kind: string; ref: string }) => LINK_OPTIONS.find(o => o.kind === l.kind && o.ref === l.ref)?.label ?? l.ref;
export const PARTICIPATION = 'Bu bir GoverHub katılım kaydıdır; resmî sertifika ya da yetkili kurum belgesi değildir.';
