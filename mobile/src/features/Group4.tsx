import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { ErrorBox, Field, Loading } from '../components/states';
import { Card, Eyebrow, GhostButton, PrimaryButton } from '../components/ui';
import { C, tint, type } from '../theme';
import { DOC_TYPE } from './documents';

/* ── QR: one code per record (equipment / document), shown for printing; scanning is checked on the server ── */

type QrItem = { id: string; kind: string; ref_id: string; label: string; token: string; active: boolean };
type QrImage = { url: string; label: string; active: boolean; dataUrl: string };

export function QrCard({ kind, refId }: { kind: 'equipment' | 'document'; refId: string }) {
  const { company, call } = useSession();
  const list = useApi<QrItem[]>(company ? `/companies/${company.id}/qr?kind=${kind}&refId=${refId}` : null);
  const live = (list.data ?? []).find(q => q.active) ?? null;
  const origin = Platform.OS === 'web' && typeof location !== 'undefined' ? location.origin : 'https://app.goverhub.example';
  const img = useApi<QrImage>(company && live ? `/companies/${company.id}/qr/${live.id}/image?base=${encodeURIComponent(origin)}` : null);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [off, setOff] = useState(false);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); setError(null); try { await f(); setOff(false); setReason(''); await list.reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  if (list.error && /403|404/.test(list.error)) return null;
  return (
    <Card style={{ padding: 15, gap: 8 }}>
      <View testID="qr-card"><Eyebrow>QR KODU</Eyebrow></View>
      {!list.data && list.loading ? <Loading /> : null}
      {live ? (
        <>
          {img.data ? <Image testID="qr-image" accessibilityLabel={`${live.label} QR kodu`} source={{ uri: img.data.dataUrl }} style={{ width: 180, height: 180, alignSelf: 'center', backgroundColor: '#fff' }} /> : <Loading />}
          <Text testID="qr-url" style={type(11, 400, { color: C.t3, lh: 1.4 })}>{img.data?.url ?? ''}</Text>
          <Text style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>Kodu okutan kişi kaydı yalnız kendi yetkisi varsa görür; yetkisi yoksa "böyle bir kod yok" yanıtı alır.</Text>
          {Platform.OS === 'web' ? <GhostButton testID="qr-print" label="Yazdır" height={36} size={12} onPress={() => (globalThis as any).print?.()} /> : null}
          {off ? (
            <View style={{ gap: 8 }}>
              <Field label="Pasifleştirme gerekçesi" testID="qr-off-reason" value={reason} onChangeText={setReason} />
              <GhostButton testID="qr-off-confirm" label="Kodu pasifleştir" disabled={busy || reason.trim().length < 3} onPress={() => run(() => call('POST', `/companies/${company!.id}/qr/${live.id}/active`, { active: false, reason }))} />
            </View>
          ) : <GhostButton testID="qr-off" label="Pasifleştir" height={34} size={12} onPress={() => setOff(true)} />}
        </>
      ) : (
        <>
          <Text style={type(12.5, 400, { color: C.t2, lh: 1.45 })}>Bu kayıt için etkin QR kodu yok. Üretince yazdırıp ekipmanın ya da panonun üzerine yapıştırabilirsin.</Text>
          <GhostButton testID="qr-create" label="QR kodu oluştur" disabled={busy} onPress={() => run(() => call('POST', `/companies/${company!.id}/qr`, { kind, refId }))} />
        </>
      )}
      {error ? <ErrorBox message={error} /> : null}
    </Card>
  );
}

/* ── Smart Vault: fields proposed from document text; a person edits and confirms ── */

type Suggestion = { field: 'docType' | 'issuer' | 'documentNo' | 'validFrom' | 'validUntil'; value: string; snippet: string; confidence: 'medium' | 'low'; note?: string };
type Extraction = { id: string; version: number; status: string; suggestions: Suggestion[]; createdAt: string; method?: string | null; sourceText?: string | null; readConfidence?: number | null };
const METHOD_TR: Record<string, string> = { pdf_text: 'PDF metin katmanından okundu', ocr_pdf: 'Taranmış PDF, OCR ile okundu', ocr_image: 'Fotoğraf, OCR ile okundu' };
const FIELD_TR: Record<string, string> = { docType: 'Belge türü', issuer: 'Düzenleyen kurum', documentNo: 'Belge no', validFrom: 'Başlangıç', validUntil: 'Bitiş' };

export function ExtractionCard({ documentId, versionId, reviewed, onApplied }: { documentId: string; versionId: string | null; reviewed: boolean; onApplied: () => void }) {
  const { company, call } = useSession();
  const q = useApi<{ ocr: { available: boolean; note: string }; items: Extraction[] }>(company ? `/companies/${company.id}/documents/${documentId}/extractions` : null);
  const [text, setText] = useState(''); const [vals, setVals] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const pending = (q.data?.items ?? []).find(x => x.status === 'pending' && x.suggestions && true) ?? null;
  const shown = (pending?.suggestions ?? []).filter(s => !reviewed || (s.field !== 'validFrom' && s.field !== 'validUntil'));
  const propose = async () => {
    setBusy(true); setError(null);
    try {
      const r = await call<{ id: string; suggestions: Suggestion[] }>('POST', `/companies/${company!.id}/documents/${documentId}/versions/${versionId}/extractions`, { text, source: 'typed_text' });
      setVals(Object.fromEntries(r.suggestions.map(s => [s.field, s.value]))); setText(''); await q.reload();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const [fileErr, setFileErr] = useState<string | null>(null); const [showSrc, setShowSrc] = useState(false);
  const readFile = async () => {
    setBusy(true); setError(null); setFileErr(null);
    try {
      const r = await call<{ id: string; suggestions: Suggestion[] }>('POST', `/companies/${company!.id}/documents/${documentId}/versions/${versionId}/extract-file`, {});
      setVals(Object.fromEntries(r.suggestions.map(s => [s.field, s.value]))); await q.reload();
    } catch (e) { setFileErr(errorText(e)); } finally { setBusy(false); }
  };
  const decide = async (confirm: boolean) => {
    if (!pending) return;
    setBusy(true); setError(null);
    try {
      // A reviewed version keeps the dates the reviewer confirmed; only the document's own details may be filled in.
      const fields = Object.fromEntries(shown.map(s => [s.field, (vals[s.field] ?? s.value).trim() || null]));
      await call('POST', `/companies/${company!.id}/extractions/${pending.id}/decision`, confirm ? { confirm: true, fields } : { confirm: false });
      await q.reload(); if (confirm) onApplied();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  if (!versionId) return null;
  return (
    <Card style={{ padding: 15, gap: 8 }}>
      <View testID="extract-card"><Eyebrow>BELGE METNİNDEN ALAN OKU</Eyebrow></View>
      <Text testID="extract-ocr-note" style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>{q.data?.ocr.note ?? 'Yüklenen dosyadan okunur ya da metin yapıştırılır; sistem yalnızca öneri çıkarır.'}</Text>
      {pending ? (
        <View style={{ gap: 8 }}>
          {pending.method ? <Text testID="extract-method" style={type(11.5, 500, { color: C.t2, lh: 1.45 })}>{METHOD_TR[pending.method] ?? pending.method}{pending.readConfidence != null ? ` · okuma güveni %${pending.readConfidence}` : ''}</Text> : null}
          <Text style={type(12.5, 600, { color: C.warn })}>Öneriler onayını bekliyor · sürüm {pending.version}. Onaylamadıkça belgeye yazılmaz; onaylasan da belge "incelendi" sayılmaz.</Text>
          {reviewed ? <Text testID="extract-reviewed-note" style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>Bu sürüm incelendi: tarihler değişmez, yalnız belge bilgileri kaydedilir. Tarih değiştiyse yeni sürüm yükle.</Text> : null}
          {shown.length === 0 ? <Text style={type(12, 400, { color: C.t2 })}>Metinden alan çıkarılamadı. Alanları elle gir.</Text> : null}
          {shown.map(s => (
            <View key={s.field} style={{ gap: 3 }}>
              <Field label={`${FIELD_TR[s.field]}${s.confidence === 'low' ? ' · düşük güven' : ''}`} testID={`extract-${s.field}`} value={vals[s.field] ?? s.value} onChangeText={v => setVals(x => ({ ...x, [s.field]: v }))} />
              <Text style={type(10.5, 400, { color: C.t3, lh: 1.35 })}>Kaynak satır: “{s.snippet}”{s.field === 'docType' ? ` · ${DOC_TYPE[s.value] ?? s.value}` : ''}{s.note ? ` · ${s.note}` : ''}</Text>
            </View>
          ))}
          {pending.sourceText ? (
            <View style={{ gap: 6 }}>
              <GhostButton testID="extract-source-toggle" label={showSrc ? 'Okunan metni gizle' : 'Okunan metni göster'} height={34} size={12} onPress={() => setShowSrc(x => !x)} />
              {showSrc ? <Text testID="extract-source-text" selectable style={type(11.5, 400, { color: C.t2, lh: 1.5 })}>{pending.sourceText}</Text> : null}
            </View>
          ) : null}
          <PrimaryButton testID="extract-confirm" label="Onayla ve belgeye kaydet" disabled={busy} onPress={() => decide(true)} />
          <GhostButton testID="extract-dismiss" label="Vazgeç, hiçbir şey yazma" height={36} size={12} disabled={busy} onPress={() => decide(false)} />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <GhostButton testID="extract-file" label={busy ? 'Okunuyor…' : 'Yüklenen dosyadan oku'} disabled={busy} onPress={readFile} />
          {fileErr ? (
            <View testID="extract-file-error" style={{ gap: 6 }}>
              <ErrorBox message={fileErr} />
              <GhostButton testID="extract-file-retry" label="Yeniden dene" height={36} size={12} disabled={busy} onPress={readFile} />
              <Text style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>Ya da aşağıya metni yapıştırıp alanları elle öner.</Text>
            </View>
          ) : null}
          <Field label="Belgenin metni (okunan ya da yapıştırılan)" testID="extract-text" value={text} onChangeText={setText} multiline />
          <GhostButton testID="extract-propose" label="Alanları öner" disabled={busy || text.trim().length < 20} onPress={propose} />
        </View>
      )}
      {error ? <ErrorBox message={error} /> : null}
    </Card>
  );
}

/* ── Scan entry: paste/type a code or link (camera reading needs a device and stays open) ── */

export function resolveInput(raw: string): string | null {
  const m = raw.trim().match(/([A-Za-z0-9_-]{20,80})\/?$/);
  return m ? m[1]! : null;
}

export function goTo(route: string, companyId: string, select: (id: string) => void) {
  select(companyId);
  router.push(route as never);
}
