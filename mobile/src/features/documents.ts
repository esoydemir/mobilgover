import { C, tint } from '../theme';

/** Document types (examples of what a business keeps; not a statement of what the law requires). */
export const DOC_TYPE: Record<string, string> = {
  business_license: 'İşyeri açma ve çalışma ruhsatı', food_registration: 'Gıda işletme kayıt / onay belgesi',
  calibration_certificate: 'Kalibrasyon sertifikası', maintenance_report: 'Bakım / servis raporu', training_certificate: 'Eğitim sertifikası',
  health_certificate: 'Sağlık raporu', insurance: 'Sigorta poliçesi', contract: 'Sözleşme', other: 'Diğer belge',
};

/**
 * Status → [label, color, background]. Kept apart: an upload and an internal review are NOT an
 * official confirmation; only "issuer_verified" records a check with the issuing authority.
 */
export const DOC_STATUS: Record<string, [string, string, string]> = {
  no_file: ['DOSYA YOK', C.t2, tint.white(0.08)],
  file_pending: ['DOSYA YÜKLENMEDİ', C.warn, tint.warn(0.14)],
  unreviewed: ['İNCELEME BEKLİYOR', C.warn, tint.warn(0.14)],
  internally_reviewed: ['KURUM İÇİ İNCELENDİ', C.info, tint.info(0.14)],
  issuer_verified: ['KURUMDAN DOĞRULANDI · KİŞİ KAYDI', C.lime, tint.lime(0.14)],
  rejected: ['REDDEDİLDİ', C.crit, tint.crit(0.14)],
  expired: ['SÜRESİ DOLDU', C.crit, tint.crit(0.14)],
};

export const STATUS_NOTE: Record<string, string> = {
  no_file: 'Henüz dosya yok.',
  file_pending: 'Dosya sunucuya ulaşmadı; yeniden dene ya da yeni sürüm ekle.',
  unreviewed: 'Yüklendi ama kimse incelemedi. Yüklenmiş olması geçerli olduğu anlamına gelmez.',
  internally_reviewed: 'İşletmeden biri aslıyla karşılaştırdı. Bu, düzenleyen kurumun resmî doğrulaması değildir.',
  issuer_verified: 'Düzenleyen kurumla doğrulandığı bir kişi tarafından yöntem ve referansla kaydedildi. Uygulama kurumu kendisi sorgulamadı.',
  rejected: 'Son sürüm kabul edilmedi.',
  expired: 'İncelenen sürümün geçerlilik süresi bitti.',
};

export const ISSUER_METHOD: Record<string, string> = {
  barcode_query: 'Barkod / doğrulama kodu sorgusu', issuer_portal: 'Kurumun çevrim içi sistemi',
  issuer_written_confirmation: 'Kurumdan yazılı teyit', other: 'Diğer',
};

export const fmtDay = (d: string | null) => (d ? d.split('-').reverse().join('.') : 'süresiz');

export type IssuerCheck = { recordedBy: string | null; method: string; reference: string; recordedAt: string; queriedByApp: boolean } | null;
/** Always shown next to "kurumdan doğrulandı": who recorded it, how, with which reference. */
export const issuerLine = (c: NonNullable<IssuerCheck>) =>
  `Uygulama sorgulamadı · ${c.recordedBy ?? 'bir yetkili'} kaydetti · ${ISSUER_METHOD[c.method] ?? c.method} · ref. ${c.reference} · ${c.recordedAt.slice(0, 10).split('-').reverse().join('.')}`;
