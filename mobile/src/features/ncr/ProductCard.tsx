import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { ErrorBox, Field } from '../../components/states';
import { Callout, Card, Eyebrow, GhostButton, PrimaryButton } from '../../components/ui';
import { C, type } from '../../theme';
import { fmtDateTime } from '../dates';

export type ProductAssessment = { id: string; product: string; quantity: number | null; unit: string | null; quantityUnknown: boolean; firstAction: string; assessor: { id: string; name: string };
  state: 'open' | 'decided'; decision: { code: string; label: string; rationale: string | null; by: string | null; at: string | null } | null };
export type ProductState = { applies: boolean; required: boolean; suggested: boolean; suggestionText: string | null; assessments: ProductAssessment[]; openCount: number; unknownQuantity: boolean; closureBlocker: string | null };

const DECISIONS: [string, string][] = [['hold', 'Beklet (karantina)'], ['destroy', 'İmha'], ['rework', 'Yeniden işle'], ['return_supplier', 'Tedarikçiye iade'], ['release', 'Kullanıma uygun'], ['no_product_effect', 'Ürün etkisi yok']];

/**
 * The fate of the affected product, kept apart from the device fix. Only shown where a product can be affected.
 * The device can be repaired and measuring normal while this stays open; an open decision blocks closing the case.
 */
export function ProductCard({ product, base, reload, closed }: { product: ProductState; base: string; reload: () => void; closed: boolean }) {
  const { me, call } = useSession();
  const [form, setForm] = useState(false);
  const [name, setName] = useState(''); const [qty, setQty] = useState(''); const [unit, setUnit] = useState(''); const [unknown, setUnknown] = useState(false); const [first, setFirst] = useState('');
  const [pick, setPick] = useState<Record<string, string>>({}); const [why, setWhy] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); setError(null); try { await f(); setForm(false); setName(''); setQty(''); setFirst(''); reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const q = Number(qty.replace(',', '.'));
  const qtyOk = unknown || (qty.trim() !== '' && Number.isFinite(q) && q >= 0);
  return (
    <Card radius={22} style={{ padding: 15, gap: 8 }}>
      <View testID="product-card"><Eyebrow>ÜRÜN KARARI · cihazın düzelmesinden ayrı</Eyebrow></View>
      {product.suggestionText ? <Callout tone="warn">{product.suggestionText}</Callout> : null}
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
                onPress={() => run(() => call('POST', `${base}/product-assessments/${a.id}/decision`, { decision: pick[a.id], rationale: why[a.id] }))} />
            </View>
          ) : null}
        </View>
      ))}
      {!closed ? (form ? (
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
