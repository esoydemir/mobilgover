import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, ExampleBadge, Field, Loading, SectionLabel } from '../../components/states';
import { Card, GhostButton, PrimaryButton } from '../../components/ui';
import { fmtDateTime } from '../../features/dates';
import { useUi } from '../../state/app';
import { C, tint, type } from '../../theme';
import { dayTr, STATUS_TR } from '../../features/legislation';

type Impact = { onDate: string; affectedSites: number; notifiedSites: number; outOfScopeSites: number; openTasksAffected: number;
  sites: { siteId: string; site: string; company: string; from: string | null; to: string; effect: string; reason: string; openTasks: number; openTaskEffect: string; notify: boolean; missingFacts: string[] }[] };
type Detail = {
  id: string; status: string; changeType: string; typeLabel: string; docRef: string; docTitle: string; articleRef: string | null; sourceUrl: string; sourceCode: string; publishedOn: string | null; effectiveFrom: string | null;
  dateStatus: 'known' | 'unclear'; dateNote: string | null; oldText: string | null; newText: string | null; suggestion: { relevance?: string; addedWords?: string[]; removedWords?: string[]; changedNumbers?: { from: string[]; to: string[] } } | null;
  isExample: boolean; exampleNote: string | null; proposal: any | null; rule: { id: string; code: string; version: number; status: string } | null; missingAreaReviews: string[];
  approveReason: string | null; rejectReason: string | null; applyOn: string | null; appliedAt: string | null; applyResult: any | null;
  impact: Impact | null; impactNote: string | null; history: { seq: number; occurred_at: string; event_type: string; payload: any; actor: string | null }[];
  publishedRules: { code: string; title: string }[]; blockers: string[];
  can: { edit: boolean; resolveDate: boolean; prepare: boolean; approve: boolean; reject: boolean };
};
const EFFECT: Record<string, [string, string]> = { new_obligation: ['YENİ YÜKÜMLÜLÜK', C.lime], version_change: ['KURAL SÜRÜMÜ DEĞİŞİR', C.info], ended: ['YÜKÜMLÜLÜK SONA ERER', C.warn], needs_info: ['BİLGİ EKSİK', C.warn] };
const EVENT_TR: Record<string, string> = {
  'legislation.detected': 'Taramada bulundu', 'legislation.date_resolved': 'Yürürlük tarihi belirlendi', 'legislation.proposal_saved': 'Öneri yazıldı/güncellendi', 'legislation.drafted': 'Kural taslağı hazırlandı',
  'legislation.approved': 'Onaylandı', 'legislation.rejected': 'Reddedildi', 'legislation.applied': 'Yürürlük gününde uygulandı',
};

/** One detected change: old/new text, source, proposed rule change, impact preview, and the approve/reject decision with a reason. */
export default function LegislationDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
  useEffect(() => { if (d?.proposal) { setProp(d.proposal); setCondText(JSON.stringify(d.proposal.condition)); } }, [d?.id, d?.proposal ? 1 : 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<unknown>, msg: string, sub?: string) => {
    setError(null);
    try { await fn(); showToast(msg, sub); await q.reload(); } catch (e) { setError(errorText(e)); }
  };
  if (!d) return <Screen title="Mevzuat kaydı" titleEn="Change">{q.error ? <ErrorBox message={q.error} /> : <Loading />}</Screen>;
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
  const needReason = (what: string) => { if (reason.trim().length === 0) { setError(`${what} için gerekçe yazmalısın.`); return false; } return true; };
  const set = (patch: Record<string, unknown>) => setProp((p: any) => ({ ...p, ...patch }));
  const setTpl = (i: number, patch: Record<string, unknown>) => setProp((p: any) => ({ ...p, templates: p.templates.map((t: any, j: number) => (j === i ? { ...t, ...patch } : t)) }));

  return (
    <Screen title="Mevzuat kaydı" titleEn="Change review" onRefresh={q.reload} refreshing={q.loading}>
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
      </Card>

      <SectionLabel>ESKİ VE YENİ METİN</SectionLabel>
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
          {sg.relevance ? <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{sg.relevance}</Text> : null}
          {sg.addedWords?.length ? <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>Eklenen sözcükler: {sg.addedWords.join(', ')}</Text> : null}
          {sg.removedWords?.length ? <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>Çıkan sözcükler: {sg.removedWords.join(', ')}</Text> : null}
          {sg.changedNumbers && (sg.changedNumbers.from.length || sg.changedNumbers.to.length) ? <Text style={type(12, 600, { color: C.warn, lh: 1.45 })}>Değişen sayılar: {sg.changedNumbers.from.join(', ') || '—'} → {sg.changedNumbers.to.join(', ') || '—'}</Text> : null}
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
                  <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>GÖREV ŞABLONU {i + 1} · {t.recurrence?.freq} {t.recurrence?.at}</Text>
                  <Field testID={`leg-t-title-${i}`} label="Görev adı" value={t.title} onChangeText={v => setTpl(i, { title: v })} />
                  <Field testID={`leg-t-instr-${i}`} label="Talimat" value={t.instructions} onChangeText={v => setTpl(i, { instructions: v })} multiline />
                </View>
              ))}
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
                <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{s.reason}</Text>
                <Text style={type(12, 500, { color: C.t2, lh: 1.45 })}>Açık görevlere etkisi: {s.openTaskEffect}</Text>
              </View>
            );
          })}
        </Card>
      ) : <Text style={type(12, 400, { color: C.t3 })}>{d.impactNote}</Text>}

      {d.rule ? (
        <Card style={{ gap: 4 }}>
          <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>KURAL SÜRÜMÜ</Text>
          <Text testID="leg-rule" style={type(13.5, 600)}>{d.rule.code} v{d.rule.version} · {d.rule.status}</Text>
          {d.missingAreaReviews.length ? <Text testID="leg-area-missing" style={type(12, 600, { color: C.warn })}>Bekleyen alan incelemesi: {d.missingAreaReviews.join(', ')} (alan uzmanı Yönetim ekranından onaylar)</Text> : null}
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

      {d.can.prepare || d.can.approve || d.can.reject ? (
        <Card style={{ gap: 8 }}>
          <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>KARAR</Text>
          <Field testID="leg-reason" label="Gerekçe (onay ve ret için zorunlu)" value={reason} onChangeText={setReason} placeholder="ör. Resmî kaynak okundu; kapsam LPG kullanan kafeler" />
          {d.can.prepare ? <GhostButton testID="leg-prepare" label="Kural taslağını hazırla ve incelemeye gönder" height={42} size={12.5} disabled={!d.proposal || d.dateStatus === 'unclear'} onPress={() => act(() => call('POST', `/admin/legislation/changes/${id}/prepare`), 'Kural taslağı incelemeye gönderildi', 'Alan uzmanı ve inceleyici onaylayacak.')} /> : null}
          {d.can.approve ? <PrimaryButton testID="leg-approve" label="Onayla" glow={false} height={44} size={13} disabled={d.missingAreaReviews.length > 0 || d.dateStatus === 'unclear'}
            onPress={() => { if (needReason('Onaylamak')) void act(() => call('POST', `/admin/legislation/changes/${id}/approve`, { reason: reason.trim() }), 'Onaylandı', 'Yürürlük gününde uygulanır.'); }} /> : null}
          {d.can.reject ? <GhostButton testID="leg-reject" label="Reddet" height={42} size={12.5} color={C.crit} border={tint.crit(0.35)}
            onPress={() => { if (needReason('Reddetmek')) void act(() => call('POST', `/admin/legislation/changes/${id}/reject`, { reason: reason.trim() }), 'Reddedildi', 'Hiçbir işletme etkilenmedi.'); }} /> : null}
        </Card>
      ) : null}
      {error ? <ErrorBox message={error} /> : null}

      <SectionLabel>GEÇMİŞ (KİM · NE ZAMAN · NEDEN)</SectionLabel>
      {d.history.map(h => (
        <View key={h.seq} style={{ gap: 2, borderLeftWidth: 2, borderLeftColor: C.bd, paddingLeft: 10 }}>
          <Text style={type(12.5, 600)}>{EVENT_TR[h.event_type] ?? h.event_type}</Text>
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.4 })}>{fmtDateTime(h.occurred_at)} · {h.actor ?? 'sistem (tarama)'}{h.payload?.reason ? ` · gerekçe: ${h.payload.reason}` : ''}</Text>
        </View>
      ))}
    </Screen>
  );
}
