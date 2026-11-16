import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { LlmConfig } from './llm';

// Which optional building blocks are present, and which user-facing function is missing when one is not.
// Nothing here changes behavior; it only tells the truth so the screen (and the operator) can name the missing piece.
const require_ = createRequire(import.meta.url);
const has = (spec: string) => { try { require_.resolve(spec); return true; } catch { return false; } };

export type ModuleState = { id: 'ocr' | 'pdf' | 'model'; name: string; available: boolean; missing: string | null; effect: string | null; fix: string | null };

export function ocrModule(): ModuleState {
  let tur = false;
  try { tur = existsSync(path.join(path.dirname(require_.resolve('@tesseract.js-data/tur/package.json')), '4.0.0')); } catch { /* not installed */ }
  const available = has('tesseract.js') && tur;
  return {
    id: 'ocr', name: 'Belgeden okuma (Türkçe OCR)', available,
    missing: available ? null : (has('tesseract.js') ? 'Türkçe dil verisi (@tesseract.js-data/tur)' : 'tesseract.js'),
    effect: available ? null : 'Taranmış belge ve fotoğraftan alan önerisi çıkmaz; metin katmanlı PDF yine okunur. Alanları elle girebilirsin.',
    fix: available ? null : 'Sunucu klasöründe `npm ci` çalıştır (Docker kullanıyorsan imajı yeniden derle: `baslat.cmd`).',
  };
}

export function pdfModule(): ModuleState {
  const font = has('dejavu-fonts-ttf/package.json');
  const available = has('pdfkit') && font;
  return {
    id: 'pdf', name: 'PDF denetim dosyası', available,
    missing: available ? null : (has('pdfkit') ? 'Türkçe karakterli yazı tipi (dejavu-fonts-ttf)' : 'pdfkit'),
    effect: available ? null : 'PDF denetim dosyası indirilemez; ekrandaki özet kayıtlar çalışır.',
    fix: available ? null : 'Sunucu klasöründe `npm ci` çalıştır (Docker: imajı yeniden derle).',
  };
}

/** `probe` is a cheap reachability check of the model endpoint; the real answer quality is tested separately. */
export async function modelModule(cfg: LlmConfig | null, fetchImpl: typeof fetch = fetch): Promise<ModuleState> {
  const base = { id: 'model' as const, name: 'Yerel dil modeli (asistan)' };
  if (!cfg) return { ...base, available: false, missing: 'Model ayarı (LLM_BASE_URL ve LLM_MODEL)', effect: 'Asistan yalnız kaynakları listeler; cümle kurmaz.', fix: 'Yerel modeli (ör. Ollama) başlat ve `LLM_BASE_URL`, `LLM_MODEL` değerlerini ayarla.' };
  try {
    const r = await fetchImpl(`${cfg.baseUrl}/models`, { signal: AbortSignal.timeout(2500), headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {} });
    if (r.ok) return { ...base, available: true, missing: null, effect: null, fix: null };
    return { ...base, available: false, missing: `Model sunucusu ${r.status} döndü`, effect: 'Asistan yalnız kaynakları listeler; "Dil modeline ulaşılamadı" notu görünür.', fix: 'Model sunucusunun çalıştığını ve adresin doğru olduğunu kontrol et.' };
  } catch {
    return { ...base, available: false, missing: 'Model sunucusuna ulaşılamadı', effect: 'Asistan yalnız kaynakları listeler; "Dil modeline ulaşılamadı" notu görünür.', fix: 'Yerel modeli başlat (ör. Ollama) ve adresi kontrol et.' };
  }
}

export async function moduleStatus(cfg: LlmConfig | null, fetchImpl?: typeof fetch) {
  const items = [ocrModule(), pdfModule(), await modelModule(cfg, fetchImpl)];
  return { allAvailable: items.every(i => i.available), items };
}
