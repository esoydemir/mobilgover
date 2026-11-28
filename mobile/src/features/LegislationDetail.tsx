import { useEffect, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { ErrorBox, ExampleBadge, Field, Loading, SectionLabel } from '../components/states';
import { Card, FilterChip, GhostButton, PrimaryButton } from '../components/ui';
import { fmtDateTime } from './dates';
import { useUi } from '../state/app';
import { C, tint, type } from '../theme';
import { dayTr, STATUS_TR } from './legislation';

/** Article ids come from the parser: "G1" = geçici madde 1, "E2" = ek madde 2. */
const artTr = (id: string) => (/^G\d/.test(id) ? `geçici md. ${id.slice(1)}` : /^E\d/.test(id) ? `ek md. ${id.slice(1)}` : `md. ${id}`);
type Impact = { outOfScopeSample?: { company: string; site: string; reason: string }[]; onDate: string; affectedSites: number; notifiedSites: number; outOfScopeSites: number; openTasksAffected: number;
  sites: { siteId: string; site: string; company: string; plannedText?: string; missingQuestions?: { key: string; label: string }[]; plannedTasks?: { code: string; title: string; dueAt: string[]; firstDue: string | null; unset: boolean; notes?: unknown; upcoming?: string[] }[]; from: string | null; to: string; effect: string; reason: string; openTasks: number; openTaskEffect: string; notify: boolean; missingFacts: string[] }[] };
type Detail = {
  id: string; status: string; changeType: string; typeLabel: string; docRef: string; docTitle: string; articleRef: string | null; sourceUrl: string; sourceCode: string; publishedOn: string | null; effectiveFrom: string | null;
  dateStatus: 'known' | 'unclear'; dateNote: string | null; oldText: string | null; newText: string | null; suggestion: { relevance?: string; sectors?: string[]; matchLevel?: 'clear' | 'uncertain'; addedWords?: string[]; removedWords?: string[]; changedNumbers?: { from: string[]; to: string[] };
    effectiveDetail?: { general: { articleIds: string[]; clause: string | null }; transitional: { articleId: string; dates: string[]; sentence: string }[]; scope: { articleId: string; text: string } | null } } | null;
  isExample: boolean; exampleNote: string | null; proposal: any | null; rule: { id: string; code: string; version: number; status: string } | null; missingAreaReviews: string[];
  approveReason: string | null; rejectReason: string | null; applyOn: string | null; appliedAt: string | null; applyResult: any | null;
  impact: Impact | null; impactNote: string | null; history: { seq: number; occurred_at: string; event_type: string; payload: any; actor: string | null }[];
  publishedRules: { code: string; title: string }[]; blockers: string[];
  frequency?: { effectiveFrom: string | null; applyOn: string; sourceHint: { freq: string; quote: string; supported: boolean } | null; sourceSays: string;
    checks: { code: string; title: string; text: string; unset: boolean; basis: string | null; basisLabel: string; basisNote: string | null }[]; bases: { key: string; label: string }[] };
  reviewAreas?: { suggestion: { sector: string; area: string; why: string }[]; suggestionNote: string;
    required: { area: string; reviewers: number; names: string[]; approved: boolean; canIReview: boolean; waiting: string | null; myAccess: string }[] };
  can: { edit: boolean; resolveDate: boolean; prepare: boolean; approve: boolean; reject: boolean };
  assignment?: { userId: string; name: string | null; at: string; note: string | null } | null;
  compare?: { hasOld: boolean; note: string | null };
  cannot?: Record<'prepare' | 'approve' | 'reject' | 'return' | 'assign', string | null>;
  nextInLine?: string;
};
type Cands = { needAreas: string[]; assignedTo: string | null; note: string | null; candidates: { id: string; name: string; areas: string[]; covers: string[]; eligible: boolean }[] };
const AREAS = ['food_safety', 'occupational_safety', 'gas_safety', 'fire_safety', 'environment', 'consumer', 'good_practice'];
const FREQS: [string, string][] = [['unset', 'Belirlenmedi'], ['once', 'Tek seferlik'], ['daily', 'Her gün'], ['weekly', 'Her hafta'], ['monthly', 'Her ay']];
const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const EFFECT: Record<string, [string, string]> = { new_obligation: ['YENİ YÜKÜMLÜLÜK', C.lime], version_change: ['KURAL SÜRÜMÜ DEĞİŞİR', C.info], ended: ['YÜKÜMLÜLÜK SONA ERER', C.warn], needs_info: ['BİLGİ EKSİK', C.warn] };
const EVENT_TR: Record<string, string> = {
  'legislation.detected': 'Taramada bulundu', 'legislation.date_resolved': 'Yürürlük tarihi belirlendi', 'legislation.proposal_saved': 'Öneri yazıldı/güncellendi', 'legislation.drafted': 'Kural taslağı hazırlandı',
  'legislation.approved': 'Onaylandı', 'legislation.assigned': 'Dosya atandı', 'legislation.unassigned': 'Atama kaldırıldı', 'legislation.returned': 'Gerekçeyle iade edildi', 'platform.area_granted': 'İnceleme alanı yetkisi verildi', 'platform.area_revoked': 'İnceleme alanı yetkisi alındı', 'legislation.rejected': 'Reddedildi', 'legislation.applied': 'Yürürlük gününde uygulandı',
};

/** One detected change: old/new text, source, proposed rule change, impact preview, and the approve/reject decision with a reason. */
export function LegislationDetail({ id, embedded = false, onChanged }: { id: string; embedded?: boolean; onChanged?: () => void }) {
  const { call } = useSession();
  const { showToast } = useUi();
  const q = useApi<Detail>(`/admin/legislation/changes/${id}`);
  const d = q.data;
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [dateIn, setDateIn] = useState('');
  const [dateNote, setDateNote] = useState('');
  const [target, setTarget] = useState('');
  const [prop, setProp] = useState<any | null>(null);
  const [condText, setCondText] = useState('');
  const [asgReason, setAsgReason] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const cands = useApi<Cands>(d?.cannot && d.cannot.assign === null ? `/admin/legislation/changes/${id}/assignees` : null);
  useEffect(() => { if (d?.proposal) { setProp(d.proposal); setCondText(JSON.stringify(d.proposal.condition)); } }, [d?.id, d?.proposal ? 1 : 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<unknown>, msg: string, sub?: string) => {
    setError(null);
    try { await fn(); showToast(msg, sub); await q.reload(); onChanged?.(); } catch (e) { setError(errorText(e)); }
  };
  if (!d) return <Wrap embedded={embedded} reload={q.reload} loading={q.loading}>{q.error ? <ErrorBox message={q.error} /> : <Loading />}</Wrap>;
  const [stLabel, stColor] = STATUS_TR[d.status] ?? [d.status, C.t2];
  const sg = d.suggestion;
  const loadSuggestion = async () => {
    setError(null);
    try {
      const s = await call<any>('GET', `/admin/legislation/changes/${id}/suggest${target.trim() ? `?targetRuleCode=${encodeURIComponent(target.trim())}` : ''}`);
      setProp(s); setCondText(JSON.stringify(s.condition));
    } catch (e) { setError(errorText(e)); }
  };
  const saveProposal = async () => {
    let condition: unknown;
    try { condition = JSON.parse(condText); } catch { setError('Kapsam koşulu geçerli bir JSON olmalı.'); return; }
    const { targetRuleCode: _t, ...rest } = prop;
    await act(() => call('PUT', `/admin/legislation/changes/${id}/proposal`, { ...rest, condition }), 'Öneri kaydedildi', 'Etkilenecek şubeler önizlemede güncellendi.');
  };
  const set = (patch: Record<string, unknown>) => setProp((p: any) => ({ ...p, ...patch }));
  const setTpl = (i: number, patch: Record<string, unknown>) => setProp((p: any) => ({ ...p, templates: p.templates.map((t: any, j: number) => (j === i ? { ...t, ...patch } : t)) }));

  const noReason = reason.trim().length === 0;
  const why = (k: 'prepare' | 'approve' | 'reject' | 'return', needsReason: boolean) => d.cannot?.[k] ?? (needsReason && noReason ? 'Gerekçe yazılmadı: yukarıdaki kutuya gerekçeyi yaz.' : null);
  const Why = ({ k, r }: { k: 'prepare' | 'approve' | 'reject' | 'return'; r: boolean }) => { const w = why(k, r); return w ? <Text testID={`leg-why-${k}`} style={type(10.5, 600, { color: C.warn, lh: 1.35 })}>Pasif: {w}</Text> : null; };
  const open = ['pending', 'drafted'].includes(d.status);
  const decision = open && d.cannot ? (
    <Card testID="leg-decision" style={{ gap: 8, borderRadius: embedded ? 14 : undefined }}>
      <Text style={type(10.5, 700, { ls: 0.06, color: C.t3 })}>KARAR · {(d.nextInLine ?? '').toLocaleUpperCase('tr')}</Text>
      <Field testID="leg-reason" label="Gerekçe (iade, onay ve ret için zorunlu)" value={reason} onChangeText={setReason} placeholder="ör. Resmî kaynak okundu; kapsam LPG kullanan kafeler" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <View style={{ flexBasis: 150, flexGrow: 1, gap: 3, opacity: 1 }}>
          <GhostButton testID="leg-prepare" label="Taslağı hazırla ve gönder" height={42} size={12.5} disabled={!!why('prepare', false)} onPress={() => act(() => call('POST', `/admin/legislation/changes/${id}/prepare`), 'Kural taslağı incelemeye gönderildi', 'Sıra: alan incelemesinde.')} />
          <Why k="prepare" r={false} />
        </View>
        <View style={{ flexBasis: 150, flexGrow: 1, gap: 3, opacity: 1 }}>
          <GhostButton testID="leg-return" label="Gerekçeli iade" height={42} size={12.5} disabled={!!why('return', true)}
            onPress={() => act(() => call('POST', `/admin/legislation/changes/${id}/return`, { reason: reason.trim() }), 'İade edildi', 'Sıra: kural yazarında.')} />
          <Why k="return" r />
        </View>
        <View style={{ flexBasis: 150, flexGrow: 1, gap: 3, opacity: 1 }}>
          <PrimaryButton testID="leg-approve" label="Onayla ve planla" glow={false} height={44} size={13} disabled={!!why('approve', true) || d.missingAreaReviews.length > 0 || d.dateStatus === 'unclear' || (d.frequency?.checks ?? []).some(c => c.unset)}
            onPress={() => act(() => call('POST', `/admin/legislation/changes/${id}/approve`, { reason: reason.trim() }), 'Onaylandı', 'Yürürlük gününde uygulanır.')} />
          <Why k="approve" r />
        </View>
        <View style={{ flexBasis: 150, flexGrow: 1, gap: 3, opacity: 1 }}>
          <GhostButton testID="leg-reject" label="Reddet" height={42} size={12.5} color={C.crit} border={tint.crit(0.35)} disabled={!!why('reject', true)}
            onPress={() => act(() => call('POST', `/admin/legislation/changes/${id}/reject`, { reason: reason.trim() }), 'Reddedildi', 'Hiçbir işletme etkilenmedi.')} />
          <Why k="reject" r />
        </View>
      </View>
    </Card>
  ) : null;

  return (
    <Wrap embedded={embedded} reload={q.reload} loading={q.loading} footer={embedded ? decision : null}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text testID="leg-status" style={type(10.5, 700, { ls: 0.06, color: stColor })}>{stLabel}</Text>
          {d.isExample ? <ExampleBadge label="ÖRNEK / SENTETİK" /> : null}
        </View>
        <Text style={type(18, 700, { lh: 1.3 })}>{d.docTitle}{d.articleRef ? ` · md. ${d.articleRef}` : ''}</Text>
        {d.exampleNote ? <Text style={type(12, 600, { color: C.warn, lh: 1.45 })}>{d.exampleNote}</Text> : null}
      </View>

      <Card style={{ gap: 6 }}>
        <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>DEĞİŞİKLİK TÜRÜ VE KAYNAK</Text>
        <Text testID="leg-type" style={type(14, 600)}>{d.typeLabel}</Text>
        <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>Kaynak: {d.sourceCode === 'resmi_gazete' ? 'Resmî Gazete' : 'Mevzuat Bilgi Sistemi'} · belge {d.docRef}{d.articleRef ? ` · madde ${d.articleRef}` : ''}</Text>
        <Text testID="leg-source-link" style={type(12.5, 600, { color: C.info })} onPress={() => void Linking.openURL(d.sourceUrl)}>{d.sourceUrl}</Text>
        <Text style={type(12.5, 400, { color: C.t2 })}>Yayın tarihi: {dayTr(d.publishedOn)}</Text>
        <Text testID="leg-effective" style={type(12.5, 600, { color: d.dateStatus === 'unclear' ? C.warn : C.t1 })}>Yürürlük tarihi: {d.dateStatus === 'unclear' ? 'BELİRSİZ' : dayTr(d.effectiveFrom)}</Text>
        {d.dateNote ? <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>{d.dateNote}</Text> : null}
        {d.blockers.length ? d.blockers.map(b => <Text key={b} testID="leg-blocker" style={type(12, 600, { color: C.warn, lh: 1.45 })}>⚠ {b}</Text>) : null}
        {d.can.resolveDate ? (
          <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 10 }}>
            <Text style={type(12.5, 600)}>Yürürlük tarihini sen belirle (gerekçeli)</Text>
            <Field testID="leg-date" label="Tarih (YYYY-AA-GG)" value={dateIn} onChangeText={setDateIn} placeholder="2026-12-01" />
            <Field testID="leg-date-note" label="Gerekçe (Resmî Gazete metnine göre)" value={dateNote} onChangeText={setDateNote} />
            <GhostButton testID="leg-date-save" label="Tarihi kaydet" height={38} size={12} disabled={!/^\d{4}-\d{2}-\d{2}$/.test(dateIn) || dateNote.trim().length === 0}
              onPress={() => act(() => call('POST', `/admin/legislation/changes/${id}/resolve-date`, { date: dateIn, note: dateNote.trim() }), 'Yürürlük tarihi kaydedildi')} />
          </View>
        ) : null}
        {sg?.effectiveDetail ? (
          <View testID="leg-effective-detail" style={{ gap: 6, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 10 }}>
            <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>YÜRÜRLÜK AYRINTISI (AYRI ALANLAR)</Text>
            <Text style={type(12.5, 600)}>Genel yürürlük hükmü{sg.effectiveDetail.general.articleIds.length ? ` (md. ${sg.effectiveDetail.general.articleIds.join(', ')})` : ''}</Text>
            <Text testID="leg-eff-general" style={type(12, 400, { color: C.t2, lh: 1.5 })}>{sg.effectiveDetail.general.clause ?? 'Metinde genel yürürlük hükmü bulunamadı.'}</Text>
            <Text style={type(12.5, 600)}>Geçiş / ileri tarihli hükümler</Text>
            {sg.effectiveDetail.transitional.length === 0 ? <Text style={type(12, 400, { color: C.t2 })}>İleri tarihli geçiş hükmü bulunamadı.</Text> :
              sg.effectiveDetail.transitional.map((t, i) => <Text key={i} testID="leg-eff-transition" style={type(12, 400, { color: C.t2, lh: 1.5 })}>• {artTr(t.articleId)} ·{t.dates.map(dayTr).join(', ')} — {t.sentence}</Text>)}
            <Text style={type(12.5, 600)}>Kapsam / faaliyet koşulu</Text>
            <Text testID="leg-eff-scope" style={type(12, 400, { color: C.t2, lh: 1.5 })}>{sg.effectiveDetail.scope ? `${artTr(sg.effectiveDetail.scope.articleId)}: ${sg.effectiveDetail.scope.text}` : 'Ayrı bir kapsam maddesi bulunamadı.'}</Text>
            <Text style={type(11.5, 500, { color: C.warn, lh: 1.45 })}>Tek bir geçiş tarihi tüm işletmelere uygulanmaz; hangi ürün/faaliyet için hangi tarihin geçerli olduğuna uzman/yönetici gerekçeli karar verir.</Text>
          </View>
        ) : null}
      </Card>

      <SectionLabel>ESKİ VE YENİ METİN</SectionLabel>
      {d.compare?.note ? <Text testID="leg-baseline" style={type(12.5, 600, { color: C.info, lh: 1.45 })}>Karşılaştırma tabanı oluşturuldu. {d.compare.note}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Card testID="leg-old" style={{ flexGrow: 1, flexBasis: 260, gap: 6 }}>
          <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>ESKİ METİN</Text>
          <Text style={type(12.5, 400, { color: C.t2, lh: 1.55 })}>{d.oldText ?? '— (önceki metin yok: yeni yayın)'}</Text>
        </Card>
        <Card testID="leg-new" style={{ flexGrow: 1, flexBasis: 260, gap: 6 }} border={tint.lime(0.3)}>
          <Text style={type(11, 700, { ls: 0.08, color: C.lime })}>YENİ METİN</Text>
          <Text style={type(12.5, 500, { lh: 1.55 })}>{d.newText ?? '— (madde yürürlükten kalkmış)'}</Text>
        </Card>
      </View>
      {sg ? (
        <Card style={{ gap: 4 }}>
          <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>OTOMATİK KARŞILAŞTIRMA · YALNIZ ÖNERİDİR</Text>
          {sg.relevance ? <Text testID="leg-relevance" style={type(12, 400, { color: C.t2, lh: 1.45 })}>{sg.relevance}</Text> : null}
          {sg.matchLevel === 'uncertain' ? <Text testID="leg-uncertain-note" style={type(12, 600, { color: C.warn, lh: 1.45 })}>Belirsiz eşleşme: başlıktan hangi iş koluna ait olduğu anlaşılmıyor. Metni oku; ilgisizse reddet, ilgiliyse iş kolunu belirterek taslağa al. Onaylanana kadar hiçbir işletme etkilenmez.</Text> : null}
          {sg.addedWords?.length ? <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>Eklenen sözcükler: {sg.addedWords.join(', ')}</Text> : null}
          {sg.removedWords?.length ? <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>Çıkan sözcükler: {sg.removedWords.join(', ')}</Text> : null}
          {sg.changedNumbers && (sg.changedNumbers.from.length || sg.changedNumbers.to.length) ? <Text style={type(12, 600, { color: C.warn, lh: 1.45 })}>Değişen sayılar: {sg.changedNumbers.from.join(', ') || '—'} → {sg.changedNumbers.to.join(', ') || '—'}</Text> : null}
          {sg.sectors?.includes('electrical') || sg.sectors?.includes('estate') ? (
            <View testID="leg-example-checks" style={{ gap: 3, marginTop: 4 }}>
              <ExampleBadge label="ÖRNEK KONTROLLER" />
              {sg.sectors.includes('electrical') ? <Text testID="leg-example-earthing" style={type(12, 500, { lh: 1.45 })}>ÖRNEK · Elektrik: “Montaj sonrası topraklama ölçümü” — kontrol listesi + ölçüm cihazı fotoğrafı. Gerçek mevzuat değildir; yalnız onaylı kural sürümü görev üretir.</Text> : null}
              {sg.sectors.includes('estate') ? <Text testID="leg-example-contract" style={type(12, 500, { lh: 1.45 })}>ÖRNEK · Emlak: “Sözleşme ve yetki belgesi dosyası kontrolü” — dosya varlık teyidi; içeriği yetkili yönetici belge kasasında inceler. Gerçek mevzuat değildir.</Text> : null}
            </View>
          ) : null}
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Bu karşılaştırma karar vermez; uygulanan koşul, görev ve süre yalnız onaylanan kural sürümünden gelir.</Text>
        </Card>
      ) : null}

      <SectionLabel>ÖNERİLEN KURAL DEĞİŞİKLİĞİ</SectionLabel>
      {d.can.edit ? (
        <Card style={{ gap: 8 }}>
          <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>Mevcut bir kuralı değiştiriyor ya da kaldırıyorsan yayında olan kural kodunu yaz; yeni yayınsa boş bırak.</Text>
          <Field testID="leg-target" label="Etkilenen mevcut kural kodu (isteğe bağlı)" value={target} onChangeText={v => setTarget(v.toUpperCase())} placeholder={d.publishedRules[0]?.code ?? 'EX-…'} autoCapitalize="characters" />
          <GhostButton testID="leg-suggest" label="Öneri taslağını yükle" height={38} size={12} onPress={loadSuggestion} />
          {prop ? (
            <View style={{ gap: 8 }}>
              <Field testID="leg-p-code" label="Kural kodu" value={prop.code} onChangeText={v => set({ code: v.toUpperCase() })} autoCapitalize="characters" />
              <Field testID="leg-p-title" label="Kural adı" value={prop.title} onChangeText={v => set({ title: v })} />
              <Field testID="leg-p-ob-title" label="Yükümlülük başlığı" value={prop.obligationTitle} onChangeText={v => set({ obligationTitle: v })} />
              <Field testID="leg-p-ob-summary" label="Kısa açıklama" value={prop.obligationSummary} onChangeText={v => set({ obligationSummary: v })} multiline />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Field testID="leg-p-from" label="Yürürlük başlangıcı" value={String(prop.effectiveFrom ?? '').slice(0, 10)} onChangeText={v => set({ effectiveFrom: v })} /></View>
                <View style={{ flex: 1 }}><Field testID="leg-p-to" label="Bitiş (boş: süresiz)" value={prop.effectiveTo ? String(prop.effectiveTo).slice(0, 10) : ''} onChangeText={v => set({ effectiveTo: v || null })} /></View>
              </View>
              <Field testID="leg-p-reason" label="Sürüm notu" value={prop.changeReason} onChangeText={v => set({ changeReason: v })} />
              <Field testID="leg-p-cond" label="Kapsam koşulu (JSON; işletme bilgisi alanları)" value={condText} onChangeText={setCondText} multiline />
              {(prop.templates ?? []).map((t: any, i: number) => (
                <View key={i} style={{ gap: 6, borderWidth: 1, borderColor: C.bd, borderRadius: 14, padding: 10 }}>
                  <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>GÖREV ŞABLONU {i + 1}</Text>
                  <Field testID={`leg-t-title-${i}`} label="Görev adı" value={t.title} onChangeText={v => setTpl(i, { title: v })} />
                  <Field testID={`leg-t-instr-${i}`} label="Talimat" value={t.instructions} onChangeText={v => setTpl(i, { instructions: v })} multiline />
                  <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>TEKRAR SIKLIĞI (YÖNETİCİ BELİRLER)</Text>
                  <Text testID={`leg-freq-source-${i}`} style={type(11.5, 400, { color: d.frequency?.sourceHint ? C.info : C.warn, lh: 1.45 })}>{d.frequency?.sourceSays}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                    {FREQS.map(([k, l]) => <FilterChip key={k} testID={`leg-freq-${i}-${k}`} label={l} px={12} active={(t.recurrence?.freq ?? 'unset') === k} onPress={() => {
                      const base = { basis: t.recurrence?.basis ?? 'admin_choice', basisNote: t.recurrence?.basisNote };
                      const at = t.recurrence?.at ?? '10:00';
                      setTpl(i, { recurrence: k === 'unset' ? { freq: 'unset', ...base } : k === 'once' ? { freq: 'once', on: String(prop.effectiveFrom ?? '').slice(0, 10), at, ...base } : k === 'daily' ? { freq: 'daily', at, ...base } : k === 'weekly' ? { freq: 'weekly', weekday: 1, at, ...base } : { freq: 'monthly', day: 1, at, ...base } });
                    }} />)}
                  </View>
                  {t.recurrence?.freq === 'once' ? <Field testID={`leg-freq-on-${i}`} label="İlk (ve tek) görev vadesi · YYYY-AA-GG" value={t.recurrence.on} onChangeText={v => setTpl(i, { recurrence: { ...t.recurrence, on: v } })} /> : null}
                  {t.recurrence?.freq === 'weekly' ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{WEEKDAYS.map((w, n) => <FilterChip key={w} testID={`leg-freq-wd-${i}-${n + 1}`} label={w} px={10} active={t.recurrence.weekday === n + 1} onPress={() => setTpl(i, { recurrence: { ...t.recurrence, weekday: n + 1 } })} />)}</View>
                  ) : null}
                  {t.recurrence?.freq === 'monthly' ? <Field testID={`leg-freq-day-${i}`} label="Ayın günü (1–28)" value={String(t.recurrence.day)} onChangeText={v => setTpl(i, { recurrence: { ...t.recurrence, day: Number(v.replace(/[^0-9]/g, '')) || 1 } })} /> : null}
                  {t.recurrence?.freq && t.recurrence.freq !== 'unset' ? (
                    <>
                      <Field testID={`leg-freq-at-${i}`} label="Saat (SS:DD)" value={t.recurrence.at} onChangeText={v => setTpl(i, { recurrence: { ...t.recurrence, at: v } })} />
                      <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>SIKLIĞIN DAYANAĞI</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                        {(d.frequency?.bases ?? []).map(b => <FilterChip key={b.key} testID={`leg-freq-basis-${i}-${b.key}`} label={b.label} px={12} active={(t.recurrence.basis ?? 'admin_choice') === b.key} onPress={() => setTpl(i, { recurrence: { ...t.recurrence, basis: b.key } })} />)}
                      </View>
                    </>
                  ) : <Text testID={`leg-freq-unset-${i}`} style={type(11.5, 600, { color: C.warn, lh: 1.45 })}>Sıklık seçilmedi: taslak kaydedilebilir, ama bu kural görev üreteceği için sıklık seçilmeden onaylanamaz ve yayımlanamaz.</Text>}
                </View>
              ))}
              <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>İNCELEME ALANI (SEKTÖR YALNIZ ÖNERİ)</Text>
              {d.reviewAreas?.suggestion.length ? <Text testID="leg-area-suggest" style={type(11.5, 400, { color: C.info, lh: 1.45 })}>Öneri: {d.reviewAreas.suggestion.map(x => `${x.area} (${x.why})`).join(' · ')}. {d.reviewAreas.suggestionNote}</Text> : <Text style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>Sektörden alan önerisi yok; alanı sen seç.</Text>}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                {AREAS.map(a => <FilterChip key={a} testID={`leg-area-pick-${a}`} label={a} px={12} active={(prop.requiredReviewAreas ?? []).includes(a)} onPress={() => set({ requiredReviewAreas: (prop.requiredReviewAreas ?? []).includes(a) ? prop.requiredReviewAreas.filter((x: string) => x !== a) : [...(prop.requiredReviewAreas ?? []), a] })} />)}
              </View>
              <PrimaryButton testID="leg-p-save" label="Öneriyi kaydet" glow={false} height={42} size={12.5} onPress={saveProposal} />
            </View>
          ) : null}
        </Card>
      ) : d.proposal ? (
        <Card style={{ gap: 5 }}>
          <Text testID="leg-proposal-summary" style={type(14, 600)}>{d.proposal.obligationTitle} <Text style={type(12, 500, { color: C.t3 })}>({d.proposal.code})</Text></Text>
          <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{d.proposal.obligationSummary}</Text>
          <Text style={type(12, 400, { color: C.t3 })}>Yürürlük {dayTr(d.proposal.effectiveFrom)}{d.proposal.effectiveTo ? ` – ${dayTr(d.proposal.effectiveTo)}` : ''} · {(d.proposal.templates ?? []).map((t: any) => t.title).join(', ')}</Text>
        </Card>
      ) : <Text style={type(12, 400, { color: C.t3 })}>Henüz öneri yazılmadı.</Text>}

      {d.frequency ? (
        <>
          <SectionLabel>SIKLIK VE TARİHLER (AYRI AYRI)</SectionLabel>
          <Card testID="leg-frequency" style={{ gap: 6 }}>
            <Text testID="leg-freq-effective" style={type(12.5, 600)}>Yürürlük tarihi: {d.frequency.effectiveFrom ? dayTr(d.frequency.effectiveFrom) : 'belirsiz'} · Uygulama günü: {dayTr(d.frequency.applyOn)}</Text>
            <Text style={type(12, 400, { color: d.frequency.sourceHint ? C.info : C.warn, lh: 1.45 })}>{d.frequency.sourceSays}</Text>
            {d.frequency.checks.length === 0 ? <Text style={type(12, 400, { color: C.t3 })}>Görev şablonu yok; bu kural görev üretmez.</Text> : null}
            {d.frequency.checks.map(c => (
              <View key={c.code} testID={`leg-freq-check-${c.code}`} style={{ borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 6, gap: 2 }}>
                <Text style={type(12.5, 600)}>{c.title}</Text>
                <Text style={type(12, 500, { color: c.unset ? C.warn : C.t2, lh: 1.45 })}>Tekrar: {c.text}</Text>
                <Text style={type(11.5, 400, { color: C.t3, lh: 1.4 })}>Dayanak: {c.basisLabel}{c.basisNote ? ` — ${c.basisNote}` : ''}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      {d.reviewAreas?.required.length ? (
        <>
          <SectionLabel>İNCELEME ALANI VE YETKİ</SectionLabel>
          <Card testID="leg-areas" style={{ gap: 6 }}>
            {d.reviewAreas.required.map(a => (
              <View key={a.area} testID={`leg-area-${a.area}`} style={{ gap: 2 }}>
                <Text style={type(12.5, 600)}>{a.area} · {a.approved ? 'incelendi' : a.waiting ? 'kuyrukta bekliyor' : 'inceleme bekliyor'}</Text>
                <Text style={type(11.5, 400, { color: a.waiting ? C.warn : C.t2, lh: 1.4 })}>{a.waiting ?? `Tanımlı inceleyici: ${a.names.join(', ')}`}</Text>
                <Text style={type(11.5, 400, { color: C.t3, lh: 1.4 })}>Bu hesap: {a.myAccess}</Text>
                {!a.approved && a.canIReview && d.rule ? (
                  <GhostButton testID={`leg-area-approve-${a.area}`} label={`${a.area} alanını incelendi olarak onayla`} height={38} size={12} disabled={reason.trim().length < 5}
                    why={reason.trim().length < 5 ? 'Karar bölümündeki gerekçe kutusuna en az 5 karakter yaz.' : undefined}
                    onPress={() => act(() => call('POST', `/admin/rule-versions/${d.rule!.id}/area-review`, { area: a.area, decision: 'approved', notes: reason.trim() }), 'Alan incelemesi kaydedildi', a.area)} />
                ) : null}
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionLabel>ETKİLENECEK İŞLETME VE ŞUBELER (ÖNİZLEME)</SectionLabel>
      {d.impact ? (
        <Card testID="leg-impact" style={{ gap: 8 }}>
          <Text style={type(12.5, 600)}>{dayTr(d.impact.onDate)} günü: {d.impact.affectedSites} şube etkilenir · {d.impact.notifiedSites} şubeye bildirim · {d.impact.outOfScopeSites} şube kapsam dışı (hiçbir şey değişmez)</Text>
          {d.impact.sites.map(s => {
            const [lb, col] = EFFECT[s.effect] ?? [s.effect, C.t2];
            return (
              <View key={s.siteId} testID={`leg-impact-${s.siteId}`} style={{ borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 8, gap: 3 }}>
                <Text style={type(13, 600)}>{s.company} · {s.site}</Text>
                <Text style={type(10.5, 700, { ls: 0.06, color: col })}>{lb}</Text>
                <Text testID={`leg-why-applies-${s.siteId}`} style={type(12, 400, { color: C.t2, lh: 1.45 })}>{s.effect === 'needs_info' ? 'Neden hemen uygulanmıyor? ' : 'Neden uygulanıyor? '}{s.reason}</Text>
                {s.missingQuestions?.length ? <Text testID={`leg-need-${s.siteId}`} style={type(12, 600, { color: C.warn, lh: 1.45 })}>Hangi yanıt gerekli: {s.missingQuestions.map(x => x.label).join(' · ')}</Text> : null}
                <Text style={type(12, 500, { color: C.t2, lh: 1.45 })}>Açık görevlere etkisi: {s.openTaskEffect}</Text>
                {s.plannedText ? <Text testID={`leg-planned-${s.siteId}`} style={type(12, 600, { color: C.lime, lh: 1.45 })}>{s.plannedText}</Text> : null}
              </View>
            );
          })}
          {d.impact.outOfScopeSample?.length ? (
            <View testID="leg-out-sample" style={{ borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 8, gap: 3 }}>
              <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>KAPSAM DIŞI ÖRNEKLER · NEDEN?</Text>
              {d.impact.outOfScopeSample.map((o, i) => <Text key={i} testID={`leg-out-${i}`} style={type(12, 400, { color: C.t2, lh: 1.45 })}>{o.company} · {o.site}: {o.reason}</Text>)}
            </View>
          ) : null}
        </Card>
      ) : <Text style={type(12, 400, { color: C.t3 })}>{d.impactNote}</Text>}

      {d.rule ? (
        <Card style={{ gap: 4 }}>
          <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>KURAL SÜRÜMÜ</Text>
          <Text testID="leg-rule" style={type(13.5, 600)}>{d.rule.code} v{d.rule.version} · {d.rule.status}</Text>
          {d.missingAreaReviews.length ? <Text testID="leg-area-missing" style={type(12, 600, { color: C.warn })}>Bekleyen alan incelemesi: {d.missingAreaReviews.join(', ')} (alan uzmanı yukarıdaki alan kartından onaylar)</Text> : null}
        </Card>
      ) : null}
      {d.applyResult ? (
        <Card testID="leg-apply-result" style={{ gap: 4 }}>
          <Text style={type(11, 700, { ls: 0.08, color: C.lime })}>UYGULANDI · {fmtDateTime(d.appliedAt ?? '')}</Text>
          <Text style={type(12.5, 500, { lh: 1.5 })}>{d.applyResult.sites.length} şube · {d.applyResult.tasksCreated} yeni görev · {d.applyResult.notified} bildirim · {d.applyResult.openCancelled} açık görev iptal · {d.applyResult.openMissed} kaçırıldı · {d.applyResult.outOfScopeSites} şube kapsam dışı</Text>
        </Card>
      ) : null}
      {d.status === 'scheduled' ? <Text testID="leg-scheduled" style={type(12.5, 600, { color: C.lime, lh: 1.45 })}>Onaylandı. {dayTr(d.applyOn)} günü kendiliğinden uygulanır; o güne kadar hiçbir işletme etkilenmez.</Text> : null}
      {d.rejectReason ? <Text style={type(12.5, 600, { color: C.t2 })}>Ret gerekçesi: {d.rejectReason}</Text> : null}

      <SectionLabel>ATAMA VE SIRA</SectionLabel>
      <Card testID="leg-assign" style={{ gap: 8 }}>
        <Text testID="leg-assignee" style={type(13, 600)}>{d.assignment ? `Atanan: ${d.assignment.name ?? '—'} · ${fmtDateTime(d.assignment.at)}${d.assignment.note ? ` · ${d.assignment.note}` : ''}` : 'Kayıt kimseye atanmadı (sahipsiz).'}</Text>
        {d.nextInLine ? <Text testID="leg-next" style={type(12, 500, { color: C.t2, lh: 1.45 })}>{d.nextInLine}</Text> : null}
        <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Dosyayı bir kişiye atamak ona kalıcı yetki VERMEZ. Alan yetkisi ayrı bir işlemdir ve ayrı gerekçeyle, denetim kaydına yazılır.</Text>
        {d.cannot?.assign ? <Text testID="leg-cannot-assign" style={type(12, 600, { color: C.warn, lh: 1.45 })}>Atama yapılamaz: {d.cannot.assign}</Text> : cands.data ? ((cd) => (
          <View style={{ gap: 8 }}>
            {cd.note ? <Text testID="leg-assign-note" style={type(12, 600, { color: C.warn, lh: 1.45 })}>{cd.note}</Text> : <Text style={type(12, 400, { color: C.t2 })}>Gerekli alan: {cd.needAreas.join(', ')}</Text>}
            {cd.candidates.length === 0 ? <Text testID="leg-no-reviewer" style={type(12, 600, { color: C.warn, lh: 1.45 })}>Platformda inceleyici rolü olan kimse yok: kayıt bekler; neden: uygun kişi tanımlı değil.</Text> : null}
            <Field testID="leg-asg-reason" label="Atama gerekçesi (zorunlu)" value={asgReason} onChangeText={setAsgReason} placeholder="ör. Tüketici alanı, emlak yayını" />
            {cd.candidates.map(c => (
              <View key={c.id} testID={`leg-cand-${c.id}`} style={{ borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 8, gap: 5 }}>
                <Text style={type(13, 600)}>{c.name} <Text style={type(11.5, 500, { color: C.t3 })}>· alanları: {c.areas.join(', ') || 'yok'}</Text></Text>
                {c.eligible ? (
                  <PrimaryButton testID={`leg-assign-${c.id}`} label={d.assignment?.userId === c.id ? 'Zaten atanmış' : 'Bu kişiye ata'} glow={false} height={40} size={12.5} disabled={d.assignment?.userId === c.id || asgReason.trim().length < 5}
                    onPress={() => act(() => call('POST', `/admin/legislation/changes/${id}/assign`, { userId: c.id, reason: asgReason.trim() }), 'Dosya atandı', c.name)} />
                ) : (
                  <>
                    <Text style={type(11.5, 500, { color: C.warn, lh: 1.4 })}>Bu kişi kaydın alanında yetkili değil; atama yapılamaz. Önce AYRI bir işlemle alan yetkisi verilmeli.</Text>
                    <GhostButton testID={`leg-grant-${c.id}`} label={`Ayrı işlem: "${cd.needAreas[0] ?? '…'}" alanı yetkisi ver`} height={38} size={12} disabled={!cd.needAreas.length || grantReason.trim().length < 10}
                      onPress={() => act(async () => { await call('POST', '/admin/reviewer-areas', { userId: c.id, area: cd.needAreas[0], grant: true, reason: grantReason.trim(), changeId: id }); await cands.reload(); }, 'Alan yetkisi verildi', 'Dosya henüz atanmadı: atamayı ayrıca yap.')} />
                    {!cd.needAreas.length ? <Text style={type(11, 400, { color: C.t3 })}>Önce kayda inceleme alanı seçilmeli.</Text> : grantReason.trim().length < 10 ? <Text testID={`leg-grant-why-${c.id}`} style={type(11, 400, { color: C.t3 })}>Düğme pasif: alan yetkisi gerekçesi en az 10 karakter olmalı.</Text> : null}
                  </>
                )}
              </View>
            ))}
            <Field testID="leg-grant-reason" label="Alan yetkisi gerekçesi (ayrı işlem · en az 10 karakter)" value={grantReason} onChangeText={setGrantReason} placeholder="ör. Tüketici alanı inceleyicisi olarak görevlendirildi" />
            {d.assignment ? <GhostButton testID="leg-unassign" label="Atamayı kaldır" height={36} size={12} disabled={asgReason.trim().length < 5} onPress={() => act(() => call('POST', `/admin/legislation/changes/${id}/assign`, { userId: null, reason: asgReason.trim() }), 'Atama kaldırıldı')} /> : null}
          </View>
        ))(cands.data) : null}
      </Card>

      {!embedded ? decision : null}
      {error ? <ErrorBox message={error} /> : null}

      <SectionLabel>GEÇMİŞ (KİM · NE ZAMAN · NEDEN)</SectionLabel>
      {d.history.map(h => (
        <View key={h.seq} style={{ gap: 2, borderLeftWidth: 2, borderLeftColor: C.bd, paddingLeft: 10 }}>
          <Text style={type(12.5, 600)}>{EVENT_TR[h.event_type] ?? h.event_type}</Text>
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.4 })}>{fmtDateTime(h.occurred_at)} · {h.actor ?? 'sistem (tarama)'}{h.payload?.reason ? ` · gerekçe: ${h.payload.reason}` : ''}</Text>
        </View>
      ))}
    </Wrap>
  );
}

function Wrap({ embedded, reload, loading, children, footer }: { embedded: boolean; reload: () => void; loading: boolean; children: React.ReactNode; footer?: React.ReactNode }) {
  if (!embedded) return <Screen title="Mevzuat kaydı" titleEn="Change review" onRefresh={reload} refreshing={loading}>{children}</Screen>;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView testID="leg-detail-pane" style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      {footer ? <View testID="leg-decision-bar" style={{ padding: 12, borderTopWidth: 1, borderTopColor: C.bd, backgroundColor: C.bg }}>{footer}</View> : null}
    </View>
  );
}
