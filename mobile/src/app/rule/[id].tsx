import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, ExampleBadge, Field, Loading } from '../../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, PrimaryButton, Tap } from '../../components/ui';
import { HAZARDS } from '../../features/ncr/types';
import { useUi } from '../../state/app';
import { C, tint, type } from '../../theme';

type Fact = { key: string; type: 'boolean' | 'number' | 'string' | 'string[]'; label: string };
type Cond = { fact: string; op: 'eq' | 'neq' | 'gte' | 'lte' | 'contains'; value: string };
type Tpl = { code: string; title: string; instructions: string; freq: 'daily' | 'weekly' | 'monthly'; at: string; weekday: string; day: string; per: string;
  photo: boolean; note: boolean; measure: boolean; unit: string; min: string; max: string; severity: 'minor' | 'major' | 'critical'; hazard: string };
type Detail = { id: string; code: string; title: string; version: number; status: string; kind: string; isExample: boolean; condition: any; obligationTitle: string; obligationSummary: string;
  effectiveFrom: string; effectiveTo: string | null; changeReason: string; ambiguityNote: string | null; requiredReviewAreas: string[]; pendingAreaReviews: string[]; provisionIds: string[];
  sources: { id: string; ref: string; title: string; is_example: boolean }[]; reviews: { area: string; decision: string; notes: string; reviewer: string }[];
  templates: any[]; usedByTasks: number; sourceNote: string | null; canEdit: boolean; effectivePlaceholder?: boolean; effectiveConfirmation?: { at: string; basis: string } | null;
  samplePreview: { profile: string; label: string; decision: string; reason: string; missingFacts: string[]; tasks: { code: string; title: string; schedule: string; count: number; note: string }[] }[] };

const STATUS: Record<string, string> = { draft: 'TASLAK', in_review: 'İNCELEMEDE', approved: 'ONAYLI', published: 'YAYINDA', retired: 'ESKİ SÜRÜM' };
const DECISION: Record<string, [string, string]> = { applies: ['GÖREV OLUŞUR', C.lime], not_applicable: ['UYGULANMAZ', C.t3], needs_info: ['BİLGİ EKSİK', C.warn], needs_review: ['UZMAN İNCELEMESİ', C.warn], not_in_force: ['YÜRÜRLÜKTE DEĞİL', C.t3] };
const AREAS: [string, string][] = [['food_safety', 'Gıda güvenliği'], ['gas_safety', 'Gaz güvenliği'], ['occupational_safety', 'İş güvenliği']];
const EQ: [string, string][] = [['', 'Ekipmana bağlı değil'], ['refrigerator', 'Buzdolabı'], ['freezer', 'Dondurucu'], ['thermometer', 'Termometre']];
const emptyTpl = (): Tpl => ({ code: '', title: '', instructions: '', freq: 'daily', at: '09:00', weekday: '1', day: '1', per: '', photo: true, note: false, measure: false, unit: '°C', min: '', max: '',
  severity: 'minor', hazard: 'other' });
const today = () => new Date().toISOString().slice(0, 10);

function toTpl(t: any): Tpl {
  const m = t.evidence.find((e: any) => e.kind === 'measurement'); const l = t.limits[0];
  return { code: t.code, title: t.title, instructions: t.instructions, freq: t.recurrence.freq, at: t.recurrence.at, weekday: String(t.recurrence.weekday ?? 1), day: String(t.recurrence.day ?? 1),
    per: t.recurrence.perEquipmentType ?? '', photo: t.evidence.some((e: any) => e.kind === 'photo'), note: t.evidence.some((e: any) => e.kind === 'note'), measure: !!m, unit: m?.unit ?? '°C',
    min: l?.min != null ? String(l.min) : '', max: l?.max != null ? String(l.max) : '', severity: t.severity, hazard: t.hazard_type };
}
function fromTpl(t: Tpl) {
  const recurrence = { freq: t.freq, at: t.at, ...(t.freq === 'weekly' ? { weekday: Number(t.weekday) } : t.freq === 'monthly' ? { day: Number(t.day) } : {}), ...(t.per ? { perEquipmentType: t.per } : {}) };
  const evidence = [...(t.measure ? [{ kind: 'measurement', quantity: 'temperature', unit: t.unit }] : []), ...(t.photo ? [{ kind: 'photo', min: 1 }] : []), ...(t.note ? [{ kind: 'note', requiredWhen: 'nonconforming' }] : [])];
  const limits = t.measure ? [{ quantity: 'temperature', ...(t.per ? { equipmentType: t.per } : {}), unit: t.unit, ...(t.min ? { min: Number(t.min.replace(',', '.')) } : {}), ...(t.max ? { max: Number(t.max.replace(',', '.')) } : {}),
    basis: 'example', note: 'Örnek değer; uzman incelemesi gerekir.' }] : [];
  return { code: t.code, title: t.title, instructions: t.instructions, recurrence, evidence, limits, severity: t.severity, hazardType: t.hazard };
}
function condOut(rows: Cond[], join: 'all' | 'any', facts: Fact[]) {
  const parsed = rows.map(r => {
    const f = facts.find(x => x.key === r.fact);
    const value = f?.type === 'boolean' ? r.value === 'true' : f?.type === 'number' ? Number(r.value) : r.value;
    return { fact: r.fact, op: r.op, value };
  });
  return parsed.length === 1 ? parsed[0] : { [join]: parsed };
}
function condIn(c: any): { rows: Cond[]; join: 'all' | 'any' } {
  const leaf = (x: any): Cond => ({ fact: x.fact, op: x.op, value: String(x.value) });
  if (c?.all) return { rows: c.all.filter((x: any) => x.fact).map(leaf), join: 'all' };
  if (c?.any) return { rows: c.any.filter((x: any) => x.fact).map(leaf), join: 'any' };
  return { rows: c?.fact ? [leaf(c)] : [], join: 'all' };
}

/** Rule writing: scope, source, version, effective date, frequency, unit, evidence, review state; sample-profile preview before publishing. */
export default function RuleEditorRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { call, me } = useSession();
  const { showToast } = useUi();
  const facts = useApi<Fact[]>('/fact-catalog');
  const provisions = useApi<{ id: string; ref: string; title: string; is_example: boolean }[]>('/admin/provisions');
  const q = useApi<Detail>(isNew ? null : `/admin/rule-versions/${id}`);
  const d = q.data;
  const [effDate, setEffDate] = useState('');
  const [effBasis, setEffBasis] = useState('');
  const [f, setF] = useState({ code: '', title: '', kind: 'good_practice' as 'legal_requirement' | 'good_practice', isExample: true, obligationTitle: '', obligationSummary: '',
    effectiveFrom: today(), effectiveTo: '', changeReason: '', ambiguityNote: '' });
  const [prov, setProv] = useState<string[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [rows, setRows] = useState<Cond[]>([{ fact: 'service.delivery', op: 'eq', value: 'true' }]);
  const [join, setJoin] = useState<'all' | 'any'>('all');
  const [tpls, setTpls] = useState<Tpl[]>([emptyTpl()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!d) return;
    setF({ code: d.code, title: d.title, kind: d.kind as never, isExample: d.isExample, obligationTitle: d.obligationTitle, obligationSummary: d.obligationSummary,
      effectiveFrom: String(d.effectiveFrom).slice(0, 10), effectiveTo: d.effectiveTo ? String(d.effectiveTo).slice(0, 10) : '', changeReason: d.changeReason, ambiguityNote: d.ambiguityNote ?? '' });
    setProv(d.provisionIds); setAreas(d.requiredReviewAreas);
    const c = condIn(d.condition); setRows(c.rows); setJoin(c.join);
    setTpls(d.templates.map(toTpl));
  }, [d?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = isNew || !!d?.canEdit;
  const author = me?.platformRoles.includes('rule_author');
  const body = () => ({ code: f.code.trim(), title: f.title.trim(), kind: f.kind, isExample: f.isExample, provisionIds: prov, ambiguityNote: f.ambiguityNote.trim() || null,
    condition: condOut(rows, join, facts.data ?? []), obligationTitle: f.obligationTitle.trim(), obligationSummary: f.obligationSummary.trim(), effectiveFrom: f.effectiveFrom,
    effectiveTo: f.effectiveTo || null, changeReason: f.changeReason.trim(), requiredReviewAreas: areas, templates: tpls.map(fromTpl) });
  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (isNew) { const r = await call<{ id: string }>('POST', '/admin/rule-versions', body()); showToast('Taslak kaydedildi', 'Örnek profillerde önizleme aşağıda.'); router.replace(`/rule/${r.id}`); }
      else { await call('PUT', `/admin/rule-versions/${id}`, body()); showToast('Taslak güncellendi'); await q.reload(); }
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const setT = (i: number, patch: Partial<Tpl>) => setTpls(ts => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  if (!isNew && !d) return <Screen title="Kural" titleEn="Rule">{q.error ? <ErrorBox message={q.error} /> : <Loading />}</Screen>;
  if (!author && isNew) return <Screen title="Kural" titleEn="Rule"><ErrorBox message="Kural taslağını yalnız kural yazarı oluşturur." /></Screen>;
  const factOf = (k: string) => facts.data?.find(x => x.key === k);

  return (
    <Screen title={isNew ? 'Yeni kural taslağı' : `${d!.code} v${d!.version}`} titleEn="Rule writing">
      {d ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text testID="rule-status" style={type(10.5, 700, { ls: 0.08, color: d.status === 'published' ? C.lime : C.warn })}>{STATUS[d.status] ?? d.status}</Text>
          {d.isExample ? <ExampleBadge /> : null}
          <Text style={type(11, 400, { color: C.t3 })}>Bu sürümle üretilmiş görev: {d.usedByTasks}</Text>
        </View>
      ) : null}
      <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Yayımlanan sürüm değişmez; değişiklik yeni sürümle yapılır ve geçmiş görevler üretildikleri sürüme bağlı kalır. Kaynağı doğrulanmamış kural örnek ya da taslak olarak kalır.</Text>
      {d?.sourceNote ? <Text style={type(12, 600, { color: C.warn, lh: 1.45 })}>{d.sourceNote}</Text> : null}

      {editable ? (
        <>
          {isNew ? <Field label="Kural kodu (BÜYÜK-HARF)" testID="rule-code" value={f.code} onChangeText={v => setF({ ...f, code: v.toUpperCase() })} placeholder="EX-DELIVERY-BAG" autoCapitalize="characters" /> : null}
          {isNew ? <Field label="Kural adı" testID="rule-title" value={f.title} onChangeText={v => setF({ ...f, title: v })} /> : null}
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <FilterChip testID="rule-kind-good" label="İyi uygulama" active={f.kind === 'good_practice'} onPress={() => setF({ ...f, kind: 'good_practice' })} />
            <FilterChip testID="rule-kind-legal" label="Mevzuat yükümlülüğü" active={f.kind === 'legal_requirement'} onPress={() => setF({ ...f, kind: 'legal_requirement' })} />
            <FilterChip testID="rule-example" label={f.isExample ? 'ÖRNEK (işaretli)' : 'Gerçek kural'} active={f.isExample} onPress={() => setF({ ...f, isExample: !f.isExample })} />
          </View>
          <Eyebrow>KAYNAK VE MADDE</Eyebrow>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {(provisions.data ?? []).map(p => <FilterChip key={p.id} testID={`rule-prov-${p.id}`} label={`${p.ref}${p.is_example ? ' · örnek' : ''}`} px={11} active={prov.includes(p.id)}
              onPress={() => setProv(prov.includes(p.id) ? prov.filter(x => x !== p.id) : [...prov, p.id])} />)}
          </View>
          {(provisions.data ?? []).filter(p => prov.includes(p.id)).map(p => <Text key={p.id} style={type(11.5, 400, { color: C.t2, lh: 1.4 })}>Seçili: {p.title} · {p.ref}</Text>)}
          <Eyebrow>KAPSAM KOŞULLARI</Eyebrow>
          {rows.map((r, i) => {
            const fd = factOf(r.fact);
            return (
              <View key={i} style={{ gap: 6, borderWidth: 1, borderColor: C.bd, borderRadius: 14, padding: 10 }}>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {(facts.data ?? []).map(x => <FilterChip key={x.key} testID={`rule-fact-${i}-${x.key}`} label={x.label} px={10} active={r.fact === x.key}
                    onPress={() => setRows(rs => rs.map((y, j) => (j === i ? { fact: x.key, op: 'eq', value: x.type === 'boolean' ? 'true' : '' } : y)))} />)}
                </View>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {(fd?.type === 'number' ? (['eq', 'gte', 'lte'] as const) : fd?.type === 'string[]' ? (['contains'] as const) : (['eq', 'neq'] as const)).map(op =>
                    <FilterChip key={op} label={{ eq: '=', neq: '≠', gte: '≥', lte: '≤', contains: 'içerir' }[op]} px={10} active={r.op === op} onPress={() => setRows(rs => rs.map((y, j) => (j === i ? { ...y, op } : y)))} />)}
                  {fd?.type === 'boolean' ? (['true', 'false'] as const).map(v => <FilterChip key={v} testID={`rule-val-${i}-${v}`} label={v === 'true' ? 'Evet' : 'Hayır'} px={10} active={r.value === v}
                    onPress={() => setRows(rs => rs.map((y, j) => (j === i ? { ...y, value: v } : y)))} />)
                    : <View style={{ flex: 1, minWidth: 120 }}><Field testID={`rule-val-input-${i}`} value={r.value} onChangeText={v => setRows(rs => rs.map((y, j) => (j === i ? { ...y, value: v } : y)))} /></View>}
                  {rows.length > 1 ? <Text onPress={() => setRows(rs => rs.filter((_, j) => j !== i))} style={type(12, 600, { color: C.crit })}>Kaldır</Text> : null}
                </View>
              </View>
            );
          })}
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <GhostButton testID="rule-cond-add" label="Koşul ekle" height={34} size={11.5} onPress={() => setRows(rs => [...rs, { fact: 'activity.food_preparation', op: 'eq', value: 'true' }])} />
            {rows.length > 1 ? <><FilterChip label="Hepsi" active={join === 'all'} onPress={() => setJoin('all')} /><FilterChip label="Herhangi biri" active={join === 'any'} onPress={() => setJoin('any')} /></> : null}
          </View>
          <Field label="Yükümlülük başlığı" testID="rule-ob-title" value={f.obligationTitle} onChangeText={v => setF({ ...f, obligationTitle: v })} />
          <Field label="Kısa açıklama" testID="rule-ob-summary" value={f.obligationSummary} onChangeText={v => setF({ ...f, obligationSummary: v })} multiline />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Field label="Yürürlük başlangıcı" testID="rule-from" value={f.effectiveFrom} onChangeText={v => setF({ ...f, effectiveFrom: v })} placeholder="YYYY-AA-GG" /></View>
            <View style={{ flex: 1 }}><Field label="Bitiş (boş: süresiz)" value={f.effectiveTo} onChangeText={v => setF({ ...f, effectiveTo: v })} placeholder="YYYY-AA-GG" /></View>
          </View>
          <Field label="Sürüm notu (neden değişti)" testID="rule-reason" value={f.changeReason} onChangeText={v => setF({ ...f, changeReason: v })} />
          <Field label="Belirsizlik notu (varsa; uzman incelemesine yönlendirir)" value={f.ambiguityNote} onChangeText={v => setF({ ...f, ambiguityNote: v })} />
          <Eyebrow>ALAN İNCELEMESİ</Eyebrow>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {AREAS.map(([k, l]) => <FilterChip key={k} testID={`rule-area-${k}`} label={l} px={11} active={areas.includes(k)} onPress={() => setAreas(areas.includes(k) ? areas.filter(x => x !== k) : [...areas, k])} />)}
          </View>
          {tpls.map((t, i) => (
            <Card key={i} style={{ gap: 8 }}>
              <Eyebrow>GÖREV ŞABLONU {i + 1}</Eyebrow>
              <Field label="Kod (küçük_harf)" testID={`tpl-code-${i}`} value={t.code} onChangeText={v => setT(i, { code: v.toLowerCase() })} />
              <Field label="Görev adı" testID={`tpl-title-${i}`} value={t.title} onChangeText={v => setT(i, { title: v })} />
              <Field label="Talimat" testID={`tpl-instr-${i}`} value={t.instructions} onChangeText={v => setT(i, { instructions: v })} multiline />
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {(['daily', 'weekly', 'monthly'] as const).map(fr => <FilterChip key={fr} testID={`tpl-freq-${i}-${fr}`} label={{ daily: 'Her gün', weekly: 'Haftalık', monthly: 'Aylık' }[fr]} px={11} active={t.freq === fr} onPress={() => setT(i, { freq: fr })} />)}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Field label="Saat" value={t.at} onChangeText={v => setT(i, { at: v })} placeholder="09:00" /></View>
                {t.freq === 'weekly' ? <View style={{ flex: 1 }}><Field label="Gün (1=Pzt)" value={t.weekday} onChangeText={v => setT(i, { weekday: v })} keyboardType="number-pad" /></View> : null}
                {t.freq === 'monthly' ? <View style={{ flex: 1 }}><Field label="Ayın günü" value={t.day} onChangeText={v => setT(i, { day: v })} keyboardType="number-pad" /></View> : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {EQ.map(([k, l]) => <FilterChip key={k || 'none'} label={l} px={10} active={t.per === k} onPress={() => setT(i, { per: k })} />)}
              </View>
              <Text style={type(12, 600, { color: C.t2 })}>Kanıt</Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <FilterChip testID={`tpl-ev-photo-${i}`} label="Fotoğraf" px={10} active={t.photo} onPress={() => setT(i, { photo: !t.photo })} />
                <FilterChip testID={`tpl-ev-measure-${i}`} label="Ölçüm" px={10} active={t.measure} onPress={() => setT(i, { measure: !t.measure })} />
                <FilterChip label="Not (uygunsuzsa)" px={10} active={t.note} onPress={() => setT(i, { note: !t.note })} />
              </View>
              {t.measure ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}><Field label="Birim" value={t.unit} onChangeText={v => setT(i, { unit: v })} /></View>
                  <View style={{ flex: 1 }}><Field label="En az" testID={`tpl-min-${i}`} value={t.min} onChangeText={v => setT(i, { min: v })} keyboardType="decimal-pad" /></View>
                  <View style={{ flex: 1 }}><Field label="En çok" testID={`tpl-max-${i}`} value={t.max} onChangeText={v => setT(i, { max: v })} keyboardType="decimal-pad" /></View>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {(['minor', 'major', 'critical'] as const).map(sv => <FilterChip key={sv} label={{ minor: 'Düşük', major: 'Önemli', critical: 'Kritik' }[sv]} px={10} active={t.severity === sv} onPress={() => setT(i, { severity: sv })} />)}
              </View>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {HAZARDS.map(([k, l]) => <FilterChip key={k} label={l} px={10} active={t.hazard === k} onPress={() => setT(i, { hazard: k })} />)}
              </View>
              {tpls.length > 1 ? <Text onPress={() => setTpls(ts => ts.filter((_, j) => j !== i))} style={type(12, 600, { color: C.crit })}>Şablonu kaldır</Text> : null}
            </Card>
          ))}
          <GhostButton testID="tpl-add" label="Görev şablonu ekle" height={38} size={12} onPress={() => setTpls(ts => [...ts, emptyTpl()])} />
          {error ? <ErrorBox message={error} /> : null}
          <PrimaryButton testID="rule-save" label={busy ? 'Kaydediliyor…' : isNew ? 'Taslağı kaydet' : 'Taslağı güncelle'} disabled={busy} onPress={save} />
        </>
      ) : d ? (
        <Card style={{ gap: 6 }}>
          <Text style={type(14, 600)}>{d.obligationTitle}</Text>
          <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{d.obligationSummary}</Text>
          <Text style={type(11.5, 400, { color: C.t3 })}>Yürürlük {String(d.effectiveFrom).slice(0, 10)}{d.effectiveTo ? ` – ${String(d.effectiveTo).slice(0, 10)}` : ''} · {d.changeReason}</Text>
          {d.effectivePlaceholder ? <Text testID="rule-eff-placeholder" style={type(11.5, 700, { color: C.warn, lh: 1.45 })}>⚠ Bu tarih YER TUTUCUDUR; yetkili kişi gerçek tarihi ve dayanağını belirlemeden incelemeye gönderilemez, onaylanamaz, yayımlanamaz.</Text> : null}
          {d.effectiveConfirmation ? <Text testID="rule-eff-confirmed" style={type(11.5, 500, { color: C.t2, lh: 1.45 })}>Yürürlük tarihi yetkili kişice belirlendi ({String(d.effectiveConfirmation.at).slice(0, 10)}). Dayanak: {d.effectiveConfirmation.basis}</Text> : null}
          {d.templates.map(t => <Text key={t.code} style={type(12, 500)}>{t.title} · {t.recurrence.freq}{t.recurrence.perEquipmentType ? ` · ${t.recurrence.perEquipmentType}` : ''}</Text>)}
        </Card>
      ) : null}

      {d ? (
        <>
          <Card style={{ gap: 6 }}>
            <Eyebrow>KAYNAK VE İNCELEME DURUMU</Eyebrow>
            {d.sources.map(s => <Text key={s.id} style={type(12, 400, { color: C.t2 })}>{s.title} · {s.ref}{s.is_example ? ' (örnek kaynak)' : ''}</Text>)}
            <Text style={type(12, 400, { color: C.t2 })}>Gerekli alan incelemesi: {d.requiredReviewAreas.join(', ') || 'yok'}{d.pendingAreaReviews.length ? ` · bekleyen: ${d.pendingAreaReviews.join(', ')}` : ''}</Text>
            {d.reviews.map((r, i) => <Text key={i} style={type(11.5, 400, { color: C.t3 })}>{r.area}: {r.decision === 'approved' ? 'onaylandı' : 'değişiklik istendi'} · {r.reviewer} · {r.notes}</Text>)}
          </Card>
          <Card style={{ gap: 8 }}>
            <Eyebrow>ÖRNEK PROFİLLERDE ÖNİZLEME</Eyebrow>
            <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Sentetik işletme profilleri; hiçbir işletmeye yazılmaz. Kaydettikçe güncellenir.</Text>
            {d.samplePreview.map(sp => {
              const [label, color] = DECISION[sp.decision] ?? [sp.decision, C.t2];
              return (
                <View key={sp.profile} testID={`rule-preview-${sp.profile}`} style={{ borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 7, gap: 3 }}>
                  <Text style={type(12.5, 600)}>{sp.label}</Text>
                  <Text style={type(10.5, 700, { ls: 0.06, color })}>{label}</Text>
                  {sp.tasks.map(t => <Text key={t.code} style={type(12, 400, { color: C.t2, lh: 1.4 })}>• {t.title} · {t.schedule} · {t.count ? `${t.count} görev dizisi` : 'görev yok'} · {t.note}</Text>)}
                  {sp.missingFacts.length ? <Text style={type(11.5, 400, { color: C.warn })}>Eksik bilgi: {sp.missingFacts.join(', ')}</Text> : null}
                </View>
              );
            })}
          </Card>
          {d.status === 'draft' && (me?.platformRoles ?? []).some(r => r === 'rule_reviewer' || r === 'platform_admin') ? (
            <Card style={{ gap: 8 }}>
              <Eyebrow>YÜRÜRLÜK TARİHİNİ VE DAYANAĞINI SEN BELİRLE</Eyebrow>
              <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Taslaktaki tarih yer tutucudur ve kendiliğinden kabul edilmez. Gerçek tarihi ve nereden çıktığını (belge, madde, bağlantı) yaz; inceleme başlayınca tarih kilitlenir.</Text>
              <Field testID="rule-eff-date" label="Gerçek yürürlük tarihi (YYYY-AA-GG)" value={effDate} onChangeText={setEffDate} placeholder="" />
              <Field testID="rule-eff-basis" label="Dayanak (belge, madde, bağlantı)" value={effBasis} onChangeText={setEffBasis} />
              <GhostButton testID="rule-eff-save" label="Tarihi ve dayanağı kaydet" height={38} size={12} disabled={!/^d{4}-d{2}-d{2}$/.test(effDate) || effBasis.trim().length < 15}
                onPress={async () => { try { await call('POST', `/admin/rule-versions/${d.id}/confirm-effective`, { date: effDate, basis: effBasis.trim() }); showToast('Yürürlük tarihi belirlendi'); setEffDate(''); setEffBasis(''); await q.reload(); } catch (e) { setError(errorText(e)); } }} />
            </Card>
          ) : null}
          {d.status === 'draft' && d.canEdit ? (
            <GhostButton testID="rule-submit" label="İncelemeye gönder" onPress={async () => { try { await call('POST', `/admin/rule-versions/${d.id}/submit`); showToast('İncelemeye gönderildi'); await q.reload(); } catch (e) { setError(errorText(e)); } }} />
          ) : null}
          {d.status !== 'draft' ? <Tap onPress={() => router.push('/admin')}><Text style={type(12.5, 600, { color: C.info })}>İnceleme, onay ve yayın: Yönetim ekranı ›</Text></Tap> : null}
        </>
      ) : null}
      <View style={{ height: 1, backgroundColor: tint.white(0.03) }} />
    </Screen>
  );
}
