import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { ErrorBox, Field } from '../../components/states';
import { Callout, Card, Eyebrow, GhostButton, missingWhy, PrimaryButton, shortWhy } from '../../components/ui';
import { C, type } from '../../theme';
import { fmtDateTime } from '../dates';

export type ProductAssessment = { id: string; product: string; quantity: number | null; unit: string | null; quantityUnknown: boolean; firstAction: string; assessor: { id: string; name: string };
  state: 'open' | 'decided'; decision: { code: string; label: string; rationale: string | null; by: string | null; at: string | null } | null;
  corrections?: { previous: { code: string; label: string; rationale: string; by: string; at: string }; now: { code: string; label: string; rationale: string }; reason: string; correctedBy: string; correctedAt: string; caseWasClosed: boolean }[] };
export type ProductState = { applies: boolean; unknown?: boolean; needsAnswer?: string; required: boolean; suggested: boolean; suggestionText: string | null; assessments: ProductAssessment[]; openCount: number; unknownQuantity: boolean; closureBlocker: string | null };

const NL = String.fromCharCode(10);
const DECISIONS:[string, string][] = [['hold', 'Beklet (karantina)'], ['destroy', 'İmha'], ['rework', 'Yeniden işle'], ['return_supplier', 'Tedarikçiye iade'], ['release', 'Kullanıma uygun'], ['no_product_effect', 'Ürün etkisi yok']];

/**
 * The fate of the affected product, kept apart from the device fix. Only shown where a product can be affected.
 * The device can be repaired and measuring normal while this stays open; an open decision blocks closing the case.
 */
export function ProductCard({ product, base, reload, closed }: { product: ProductState; base: string; reload: () => void; closed: boolean }) {
  const { me, call } = useSession();
  const [form, setForm] = useState(false);
  const [name, setName] = useState(''); const [qty, setQty] = useState(''); const [unit, setUnit] = useState(''); const [unknown, setUnknown] = useState(false); const [first, setFirst] = useState('');
  const [pick, setPick] = useState<Record<string, string>>({}); const [why, setWhy] = useState<Record<string, string>>({});
  const [fix, setFix] = useState<string | null>(null); const [fixWhy, setFixWhy] = useState(''); const [fixNew, setFixNew] = useState(''); const [fixPick, setFixPick] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); setError(null); try { await f(); setForm(false); setFix(null); setFixWhy(''); setFixNew(''); setFixPick(''); setName(''); setQty(''); setFirst(''); reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const q = Number(qty.replace(',', '.'));
  const qtyOk = unknown || (qty.trim() !== '' && Number.isFinite(q) && q >= 0);
  return (
    <Card radius={22} style={{ padding: 15, gap: 8 }}>
      <View testID="product-card"><Eyebrow>ÜRÜN KARARI · cihazın düzelmesinden ayrı</Eyebrow></View>
      {product.unknown ? <View testID="product-needs-answer"><Callout tone="warn">{product.suggestionText}</Callout></View> : product.suggestionText ? <Callout tone="warn">{product.suggestionText}</Callout> : null}
      {product.closureBlocker && !closed ? <Text testID="product-blocker" style={type(12.5, 600, { color: C.warn, lh: 1.4 })}>Kapatmayı engelliyor: {product.closureBlocker}</Text> : null}
      {product.unknownQuantity ? <Text style={type(12, 600, { color: C.warn })}>Miktarı bilinmeyen ürün var.</Text> : null}
      {product.assessments.map(a => (
        <View key={a.id} style={{ gap: 4, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 8 }}>
          <Text style={type(13.5, 600)}>{a.product} · {a.quantityUnknown ? 'MİKTAR BİLİNMİYOR' : `${a.quantity}${a.unit ? ' ' + a.unit : ''}`}</Text>
          <Text style={type(12, 400, { color: C.t2, lh: 1.4 })}>İlk önlem: {a.firstAction}</Text>
          <Text style={type(11.5, 400, { color: C.t3 })}>Değerlendiren: {a.assessor.name}</Text>
          {a.decision ? (
            <Text style={type(12.5, 600, { color: C.lime, lh: 1.4 })}>Karar: {a.decision.label} · {a.decision.by} · {a.decision.at ? fmtDateTime(a.decision.at) : ''}{'\n'}Gerekçe: {a.decision.rationale}</Text>
          ) : !closed ? (
            <View style={{ gap: 6 }}>
              <Text style={type(12, 600, { color: C.warn })}>Karar açık{a.assessor.id === me?.userId ? ' · sende' : ''}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {DECISIONS.map(([code, label]) => <GhostButton key={code} testID={`product-pick-${code}`} label={(pick[a.id] === code ? '● ' : '') + label} height={34} size={11.5} onPress={() => setPick(s => ({ ...s, [a.id]: code }))} />)}
              </View>
              <Field label="Kararın gerekçesi" testID="product-why" value={why[a.id] ?? ''} onChangeText={t => setWhy(s => ({ ...s, [a.id]: t }))} multiline />
              <PrimaryButton testID="product-decide" label="Kararı kaydet" glow={false} height={40} size={12.5} disabled={busy || !pick[a.id] || (why[a.id] ?? '').trim().length < 10}
                why={missingWhy([[!pick[a.id], 'karar'], [(why[a.id] ?? '').trim().length < 10, `gerekçe (en az 10 karakter, şu an ${(why[a.id] ?? '').trim().length})`]])}
                onPress={() => run(() => call('POST', `${base}/product-assessments/${a.id}/decision`, { decision: pick[a.id], rationale: why[a.id] }))} />
            </View>
          ) : null}
          {(a.corrections ?? []).map((c, i) => (
            <View key={i} testID="product-correction" style={{ gap: 2, borderLeftWidth: 2, borderLeftColor: C.warn, paddingLeft: 8 }}>
              <Text style={type(12, 600, { color: C.warn })}>Karar düzeltildi · {c.correctedBy} · {fmtDateTime(c.correctedAt)}{c.caseWasClosed ? ' · kapalı vaka yeniden açıldı' : ''}</Text>
              <Text style={type(11.5, 400, { color: C.t2, lh: 1.4 })}>Önceki karar: {c.previous.label} · {c.previous.by} · {fmtDateTime(c.previous.at)}{NL}Önceki gerekçe: {c.previous.rationale}{NL}Düzeltme nedeni: {c.reason}</Text>
            </View>
          ))}
          {a.decision ? (fix === a.id ? (
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {DECISIONS.map(([code, label]) => <GhostButton key={code} testID={`product-fix-pick-${code}`} label={(fixPick === code ? '● ' : '') + label} height={34} size={11.5} onPress={() => setFixPick(code)} />)}
              </View>
              <Field label="Yeni kararın gerekçesi" testID="product-fix-new" value={fixNew} onChangeText={setFixNew} multiline />
              <Field label="Önceki karar neden yanlıştı? (düzeltme nedeni)" testID="product-fix-why" value={fixWhy} onChangeText={setFixWhy} multiline />
              {closed ? <Text style={type(11.5, 600, { color: C.warn })}>Kapalı vaka: düzeltme vakayı yeniden açar; önceki kapanış geçmişte kalır.</Text> : null}
              <PrimaryButton testID="product-fix-save" label="Kararı düzelt" glow={false} height={40} size={12.5} disabled={busy || !fixPick || fixNew.trim().length < 10 || fixWhy.trim().length < 20}
                why={missingWhy([[!fixPick, 'yeni karar'], [fixNew.trim().length < 10, `yeni gerekçe (en az 10 karakter, şu an ${fixNew.trim().length})`], [fixWhy.trim().length < 20, `düzeltme nedeni (en az 20 karakter, şu an ${fixWhy.trim().length})`]])}
                onPress={() => run(() => call('POST', `${base}/product-assessments/${a.id}/correction`, { decision: fixPick, rationale: fixNew, reason: fixWhy }))} />
            </View>
          ) : <GhostButton testID="product-fix" label="Kararı düzelt" height={34} size={11.5} onPress={() => { setFix(a.id); setFixPick(a.decision!.code); setFixNew(a.decision!.rationale ?? ''); }} />) : null}
        </View>
      ))}
      {!closed && !product.unknown ? (form ? (
        <View style={{ gap: 6 }}>
          <Field label="Ürün / parti" testID="product-name" value={name} onChangeText={setName} />
          <Field label="Miktar" testID="product-qty" value={unknown ? '' : qty} onChangeText={setQty} keyboardType="decimal-pad" editable={!unknown} />
          <Field label="Birim (kg, adet, litre…)" value={unit} onChangeText={setUnit} />
          <GhostButton testID="product-unknown" label={unknown ? '● Miktar bilinmiyor' : 'Miktar bilinmiyor'} height={36} size={12} onPress={() => setUnknown(v => !v)} />
          <Field label="Alınan ilk önlem" testID="product-first" value={first} onChangeText={setFirst} multiline />
          <PrimaryButton testID="product-open" label="Değerlendirmeyi başlat" glow={false} height={40} size={12.5} disabled={busy || name.trim().length < 2 || first.trim().length < 5 || !qtyOk || !me}
            onPress={() => run(() => call('POST', `${base}/product-assessments`, { product: name, quantity: unknown ? null : q, unit: unit.trim() || null, quantityUnknown: unknown, firstAction: first, assessorId: me!.userId }))} />
        </View>
      ) : <GhostButton testID="product-new" label="Etkilenen ürün için değerlendirme başlat" height={38} size={12} onPress={() => setForm(true)} />) : null}
      {error ? <ErrorBox message={error} /> : null}
    </Card>
  );
}
