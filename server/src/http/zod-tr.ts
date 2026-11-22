import type { z } from 'zod';

/**
 * B-10: a rejected form says which field is wrong and why, in Turkish, so the person can fix it without losing what they typed.
 * The message names every field at once; `details` carries one Turkish line per field for the screen to show next to the input.
 */
const LABEL: Record<string, string> = {
  title: 'Başlık', description: 'Açıklama', notes: 'Not', note: 'Not', reason: 'Gerekçe', rationale: 'Gerekçe', name: 'Ad', email: 'E-posta',
  product: 'Ürün / parti', firstAction: 'Alınan ilk önlem', quantity: 'Miktar', unit: 'Birim', containment: 'Alınan ilk önlem', severity: 'Önem',
  hazardType: 'Tehlike türü', siteId: 'Şube', equipmentId: 'Ekipman', assessorId: 'Değerlendiren kişi', decision: 'Karar', value: 'Değer', result: 'Sonuç',
  days: 'Gün sayısı', role: 'Rol', phone: 'Telefon', message: 'Mesaj', summary: 'Özet', serial: 'Seri no', type: 'Tür', code: 'Kod', body: 'İçerik',
};

export type FieldIssue = { field: string; label: string; message: string };

const tail = (path: PropertyKey[]) => path.filter(p => typeof p !== 'number').map(String).join('.') || 'istek';

function say(i: z.core.$ZodIssue): string {
  const x = i as any;
  switch (i.code) {
    case 'too_small':
      if (x.origin === 'string') return x.minimum === 1 ? 'Bu alan boş bırakılamaz.' : `En az ${x.minimum} karakter olmalı.`;
      if (x.origin === 'array') return `En az ${x.minimum} öğe seçilmeli.`;
      return `En az ${x.minimum} olmalı.`;
    case 'too_big':
      if (x.origin === 'string') return `En fazla ${x.maximum} karakter olabilir.`;
      if (x.origin === 'array') return `En fazla ${x.maximum} öğe seçilebilir.`;
      return `En fazla ${x.maximum} olabilir.`;
    case 'invalid_type':
      return x.input === undefined || /received undefined/.test(String(i.message)) ? 'Bu alan gerekli.' : 'Değerin türü uygun değil.';
    case 'invalid_format':
      return x.format === 'email' ? 'Geçerli bir e-posta adresi yaz.' : x.format === 'uuid' ? 'Geçerli bir seçim yap.' : x.format === 'date' ? 'Geçerli bir tarih yaz (YYYY-AA-GG).' : 'Biçim uygun değil.';
    case 'invalid_value':
      return 'Listedeki seçeneklerden birini seç.';
    case 'not_multiple_of':
      return 'Değer uygun adımda değil.';
    default:
      return 'Değer geçersiz.';
  }
}

export function fieldIssues(err: z.ZodError): FieldIssue[] {
  return err.issues.map(i => {
    const field = tail(i.path);
    const last = String(i.path.filter(p => typeof p !== 'number').slice(-1)[0] ?? '');
    return { field, label: LABEL[last] ?? field, message: say(i) };
  });
}

export function invalidMessage(issues: FieldIssue[]): string {
  if (!issues.length) return 'İstek alanları geçersiz.';
  const shown = issues.slice(0, 3).map(i => `${i.label}: ${i.message}`).join(' ');
  return `Alanları düzelt — ${shown}${issues.length > 3 ? ` (+${issues.length - 3} alan daha)` : ''}`;
}
