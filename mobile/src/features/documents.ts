import { C, tint } from '../theme';

/** Document types (examples of what a business keeps; not a statement of what the law requires). */
export const DOC_TYPE: Record<string, string> = {
  business_license: 'İşyeri açma ve çalışma ruhsatı', food_registration: 'Gıda işletme kayıt / onay belgesi',
  calibration_certificate: 'Kalibrasyon sertifikası', maintenance_report: 'Bakım / servis raporu', training_certificate: 'Eğitim sertifikası',
  health_certificate: 'Sağlık raporu', insurance: 'Sigorta poliçesi', contract: 'Sözleşme', other: 'Diğer belge',
};

/** Status → [label, color, background]. Only "valid" and "expiring" come from a reviewed version. */
export const DOC_STATUS: Record<string, [string, string, string]> = {
  no_file: ['DOSYA YOK', C.t2, tint.white(0.08)],
  file_pending: ['DOSYA YÜKLENMEDİ', C.warn, tint.warn(0.14)],
  awaiting_review: ['İNCELEME BEKLİYOR · GEÇERLİ SAYILMAZ', C.warn, tint.warn(0.14)],
  rejected: ['REDDEDİLDİ', C.crit, tint.crit(0.14)],
  not_yet_valid: ['HENÜZ YÜRÜRLÜKTE DEĞİL', C.info, tint.info(0.14)],
  valid: ['GEÇERLİ · İNCELENDİ', C.lime, tint.lime(0.14)],
  expiring: ['SÜRESİ YAKLAŞIYOR', C.warn, tint.warn(0.14)],
  expired: ['SÜRESİ DOLDU', C.crit, tint.crit(0.14)],
};

export const fmtDay = (d: string | null) => (d ? d.split('-').reverse().join('.') : 'süresiz');
