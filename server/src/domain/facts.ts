/**
 * Catalogue of business-profile facts that rules may refer to.
 * A rule can only use keys listed here, so every condition is checkable
 * against a known type, and the UI can show a human label for each fact.
 */
export type FactType = 'boolean' | 'number' | 'string' | 'string[]';

export type FactDef = {
  type: FactType;
  label: string;
  /** Critical facts change obligations; an OCR value is not trusted until confirmed. */
  critical: boolean;
  /** Site-level facts (location, equipment) may differ between branches. */
  level: 'company' | 'site';
};

export const FACTS = {
  'activity.food_preparation': { type: 'boolean', label: 'Yemek / içecek hazırlama', critical: true, level: 'site' },
  'activity.food_business': { type: 'boolean', label: 'Gıda ürünü hazırlayan / satan faaliyet', critical: true, level: 'site' },
  'activity.nace_codes': { type: 'string[]', label: 'Faaliyet (NACE) kodları', critical: true, level: 'company' },
  'site.province': { type: 'string', label: 'İl', critical: true, level: 'site' },
  'site.district': { type: 'string', label: 'İlçe', critical: false, level: 'site' },
  'utility.lpg': { type: 'boolean', label: 'LPG / tüp gaz kullanımı', critical: true, level: 'site' },
  'service.delivery': { type: 'boolean', label: 'Paket servis', critical: true, level: 'site' },
  'activity.onsite_installation': { type: 'boolean', label: 'Müşteri yerinde montaj / kurulum işi', critical: true, level: 'site' },
  'activity.brokerage': { type: 'boolean', label: 'Emlak / aracılık faaliyeti', critical: true, level: 'site' },
  'activity.client_contracts': { type: 'boolean', label: 'Müşteri adına sözleşme / yetki belgesi dosyası tutma', critical: true, level: 'site' },
  'storage.cold': { type: 'boolean', label: 'Soğuk depolama', critical: true, level: 'site' },
  'staff.count': { type: 'number', label: 'Çalışan sayısı', critical: true, level: 'company' },
  'equipment.types': { type: 'string[]', label: 'Kayıtlı ekipman türleri', critical: false, level: 'site' },
} as const satisfies Record<string, FactDef>;

export type FactKey = keyof typeof FACTS;

export const isFactKey = (k: string): k is FactKey => Object.hasOwn(FACTS, k);

export type FactSource = 'user_declared' | 'ocr' | 'expert' | 'system';
export type FactVerification = 'unverified' | 'user_confirmed' | 'expert_verified' | 'rejected';

export type FactRecord = {
  id: string;
  key: string;
  value: unknown;
  source: FactSource;
  verification: FactVerification;
  validFrom: string | null;
  validTo: string | null;
  recordedAt: string;
};

export type UsableFact = { status: 'known'; value: unknown; record: FactRecord }
  | { status: 'unknown'; why: 'missing' | 'unconfirmed_ocr' | 'rejected' | 'expired' | 'not_yet_valid' | 'type_mismatch'; record?: FactRecord };

/**
 * Decides whether a stored fact can be used as true input on `onDate`.
 * Missing, rejected, expired or unconfirmed-OCR facts are "unknown" — never "false".
 */
export function usableFact(key: FactKey, record: FactRecord | undefined, onDate: string): UsableFact {
  if (!record) return { status: 'unknown', why: 'missing' };
  if (record.verification === 'rejected' || record.value === null) return { status: 'unknown', why: 'rejected', record };
  if (record.source === 'ocr' && record.verification === 'unverified') return { status: 'unknown', why: 'unconfirmed_ocr', record };
  if (record.validFrom && record.validFrom > onDate) return { status: 'unknown', why: 'not_yet_valid', record };
  if (record.validTo && record.validTo < onDate) return { status: 'unknown', why: 'expired', record };
  if (!matchesType(FACTS[key].type, record.value)) return { status: 'unknown', why: 'type_mismatch', record };
  return { status: 'known', value: record.value, record };
}

export function matchesType(type: FactType, v: unknown): boolean {
  switch (type) {
    case 'boolean': return typeof v === 'boolean';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'string': return typeof v === 'string';
    case 'string[]': return Array.isArray(v) && v.every(x => typeof x === 'string');
  }
}
