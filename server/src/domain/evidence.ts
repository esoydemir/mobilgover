import { z } from 'zod';

/**
 * Evidence a task template can require. Different checks need different proof;
 * nothing assumes every task wants a temperature and a photo.
 */
export const evidenceRequirementSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('measurement'), quantity: z.string(), unit: z.string() }),
  z.object({ kind: z.literal('photo'), min: z.number().int().min(1) }),
  // acceptsServiceReport: the rule lets a reviewed service report (latest version) count as this document evidence.
  z.object({ kind: z.literal('document'), min: z.number().int().min(1), acceptsServiceReport: z.boolean().optional() }),
  z.object({ kind: z.literal('checklist'), items: z.array(z.object({ id: z.string(), label: z.string(), critical: z.boolean() })).min(1) }),
  z.object({ kind: z.literal('note'), requiredWhen: z.enum(['always', 'nonconforming']) }),
  z.object({ kind: z.literal('approval'), role: z.enum(['owner', 'hq_manager', 'site_manager']) }),
  z.object({ kind: z.literal('device_record'), quantity: z.string() }),
]);
export type EvidenceRequirement = z.infer<typeof evidenceRequirementSchema>;

/**
 * A measurement limit is tied to equipment type (and optionally product
 * category) and to its basis. 'example' limits are illustrative only.
 */
export const limitSchema = z.object({
  quantity: z.string(),
  equipmentType: z.string(),
  productCategory: z.string().optional(),
  unit: z.string(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  basis: z.enum(['rule', 'manufacturer', 'haccp_plan', 'example']),
  note: z.string().optional(),
});
export type Limit = z.infer<typeof limitSchema>;

/** Turkish labels for measured quantities shown to users. */
export const QUANTITY_LABEL: Record<string, string> = { temperature: 'sıcaklık' };
const qLabel = (q: string) => QUANTITY_LABEL[q] ?? q;

export type SelectedLimit = { ok: true; limit: Limit } | { ok: false; code: 'LIMIT_UNDEFINED' | 'UNIT_MISMATCH'; message: string };

/** Picks the one limit that applies; never falls back to a generic number. */
export function selectLimit(limits: Limit[], quantity: string, equipmentType: string | null, unit: string, productCategory?: string): SelectedLimit {
  const candidates = limits.filter(l => l.quantity === quantity && l.equipmentType === equipmentType);
  const match = candidates.find(l => l.productCategory === productCategory) ?? candidates.find(l => !l.productCategory);
  if (!match) return { ok: false, code: 'LIMIT_UNDEFINED', message: `Bu ekipman türü (${equipmentType ?? 'yok'}) için "${quantity}" limiti tanımlı değil. Limit tahmin edilmez; kural sahibine bildirin.` };
  if (match.unit !== unit) return { ok: false, code: 'UNIT_MISMATCH', message: `Birim ${match.unit} olmalı, ${unit} gönderildi.` };
  return { ok: true, limit: match };
}

export const withinLimit = (v: number, l: Limit) => (l.min === null || v >= l.min) && (l.max === null || v <= l.max);

export type CollectedEvidence = {
  measurements: { quantity: string; withinLimit: boolean }[];
  files: { kind: 'photo' | 'document' | 'device_record'; status: 'pending_upload' | 'stored' | 'rejected'; quantity?: string }[];
  checklist: Record<string, 'pass' | 'fail' | 'na'> | null;
  notes: number;
  approvals: string[];
  /** Reviewed, still-current service report versions the task is tied to (count only for rules that accept them). */
  serviceReports?: number;
};

export type Completeness = { complete: boolean; missing: string[]; pending: string[]; nonconforming: string[] };

/**
 * Checks collected evidence against the template. "Done" needs complete
 * evidence; the result (conforming or not) is reported separately, so an
 * out-of-limit value can still be recorded honestly.
 */
export function assessEvidence(reqs: EvidenceRequirement[], ev: CollectedEvidence): Completeness {
  const missing: string[] = [];
  const pending: string[] = [];
  const nonconforming: string[] = [];
  for (const r of reqs) {
    if (r.kind === 'measurement') {
      const ms = ev.measurements.filter(m => m.quantity === r.quantity);
      if (!ms.length) missing.push(`Ölçüm: ${r.quantity} (${r.unit})`);
      else if (ms.some(m => !m.withinLimit)) nonconforming.push(`Ölçüm limit dışı: ${qLabel(r.quantity)}`);
    } else if (r.kind === 'photo' || r.kind === 'document') {
      const label = r.kind === 'photo' ? 'Fotoğraf' : 'Belge';
      const viaReport = r.kind === 'document' && r.acceptsServiceReport ? (ev.serviceReports ?? 0) : 0;
      const stored = ev.files.filter(f => f.kind === r.kind && f.status === 'stored').length + viaReport;
      const waiting = ev.files.filter(f => f.kind === r.kind && f.status === 'pending_upload').length;
      if (stored < r.min) (waiting ? pending : missing).push(`${label}: ${stored}/${r.min} ${r.kind === 'document' && r.acceptsServiceReport ? 'yüklendi ya da incelenmiş servis raporu seçildi' : 'yüklendi'}`);
    } else if (r.kind === 'device_record') {
      if (!ev.files.some(f => f.kind === 'device_record' && f.status === 'stored')) missing.push(`Cihaz kaydı: ${r.quantity}`);
    } else if (r.kind === 'checklist') {
      const answers = ev.checklist ?? {};
      const unanswered = r.items.filter(i => !answers[i.id]);
      if (unanswered.length) missing.push(`Kontrol listesi: ${unanswered.map(i => i.label).join(', ')}`);
      for (const i of r.items) if (answers[i.id] === 'fail' && i.critical) nonconforming.push(`Kontrol listesi uygunsuz: ${i.label}`);
    } else if (r.kind === 'approval') {
      if (!ev.approvals.includes(r.role)) missing.push(`Onay: ${r.role}`);
    }
  }
  // A written explanation is required once the result is nonconforming.
  for (const r of reqs) {
    if (r.kind === 'note' && ev.notes === 0 && (r.requiredWhen === 'always' || nonconforming.length)) missing.push('Açıklama notu');
  }
  return { complete: missing.length === 0 && pending.length === 0, missing, pending, nonconforming };
}
