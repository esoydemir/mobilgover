import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueue } from '../../api/queue';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { GradientFill } from '../../components/Gradient';
import { Screen } from '../../components/Screen';
import { ErrorBox, Field, Loading, StaleNote } from '../../components/states';
import { Callout, Card, Eyebrow, GhostButton, Pill, PrimaryButton } from '../../components/ui';
import { fmtDateTime } from '../../features/dates';
import { SEVERITY_LABEL } from '../../features/labels';
import { ActionsCard, AssignmentCard, CaseSummary, CauseCard, CriticalFirst, FlowStepper, HistoryCard, LinkedRecords, ServiceLinkCard, SupportCard, TrainingCard, VerificationCard } from '../../features/ncr/parts';
import { HAZARDS, type NcrDetail } from '../../features/ncr/types';
import { useUi } from '../../state/app';
import { C, tint, type } from '../../theme';
import { RISK } from '../ncrs';

/**
 * Nonconformity: risk and first response → owner and due date → cause assessment →
 * support suggestion → actions → effectiveness check → verification / close (or reopen).
 */
export default function NcrRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { company, me, role } = useSession();
  const { enqueue, ops } = useQueue();
  const { showToast } = useUi();
  const base = `/companies/${company?.id}/nonconformities/${id}`;
  const q = useApi<NcrDetail>(company ? base : null);
  // Coming back from training assignment or the service form: show the latest state.
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } void q.reload(); }, [q.reload]));
  const [formKind, setFormKind] = useState<string | null>(null);
  const [assignNudge, setAssignNudge] = useState(0);
  const n = q.data;
  if (!n) return <Screen title="Uygunsuzluk" titleEn="Nonconformity">{q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : <Loading />}</Screen>;

  const pending = ops.filter(o => o.path === `${base}/steps`).map(o => (o.body as { step: string }).step);
  const containment = n.steps.find(s => s.step === 'containment');
  const effectiveness = n.steps.find(s => s.step === 'effectiveness_check' && s.iteration === n.iteration);
  const step = (s: 'containment' | 'effectiveness_check', notes: string, label: string, value?: number | null) => {
    enqueue({ companyId: company!.id, label: `Uygunsuzluk: ${label}`, path: `${base}/steps`, body: { step: s, notes, ...(value != null ? { measurement: { value } } : {}) } });
    showToast(`${label} kaydedildi`, 'Cihazda; bağlantı varsa hemen gönderilir.');
  };

  return (
    <Screen title="Uygunsuzluk" titleEn="Nonconformity" onRefresh={q.reload} refreshing={q.loading} siteId={n.site_id}>
      {q.stale ? <StaleNote /> : null}
      <View style={{ borderWidth: 1, borderColor: tint.crit(0.3), borderRadius: 28, padding: 20, overflow: 'hidden' }}>
        <GradientFill angle={155} stops={[[0, '#1a0a0a'], [0.6, '#0a0505'], [1, C.bg]]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Pill label={RISK[n.risk_level]![0]} fg={RISK[n.risk_level]![1]} bg={RISK[n.risk_level]![2]} />
          <Text testID="ncr-status" style={type(10, 700, { ls: 0.1, color: n.status === 'closed' ? C.lime : C.crit })}>
            {n.status === 'closed' ? 'KAPALI' : n.status === 'awaiting_verification' ? 'DOĞRULAMA BEKLİYOR' : 'AÇIK'}
            {n.recurrence_count ? ` · ${n.recurrence_count + 1}. TEKRAR` : ''}{n.reopened_count ? ` · ${n.reopened_count} KEZ YENİDEN AÇILDI` : ''}
          </Text>
        </View>
        <Text style={[type(21, 600, { family: 'outfit', ls: -0.03, lh: 1.15 }), { marginTop: 12 }]}>{n.title}</Text>
        <Text style={[type(13, 400, { lh: 1.5, color: C.t2 }), { marginTop: 8 }]}>{n.description}</Text>
        <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 8 }]}>
          {n.source === 'manual' ? 'Elle bildirildi' : 'Görevden açıldı'} · tespit {fmtDateTime(n.detected_at)}
          {n.source === 'manual' ? ` · ${HAZARDS.find(h => h[0] === n.hazard_type)?.[1] ?? n.hazard_type}` : ''}{n.equipment ? ` · ${n.equipment.name}` : ''}
        </Text>
        <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 4 }]}>
          Risk: önem {SEVERITY_LABEL[n.risk_rationale.severity] ?? n.risk_rationale.severity}{n.risk_rationale.escalatedBy ? `, tekrar nedeniyle +${n.risk_rationale.escalatedBy} seviye` : ''}{n.risk_rationale.independentVerification ? ' · bağımsız doğrulama gerekir' : ''}
        </Text>
      </View>

      {n.emergency_instruction && n.status !== 'closed' ? (
        <View style={{ borderWidth: 1, borderColor: tint.crit(0.3), backgroundColor: tint.crit(0.06), borderRadius: 18, padding: 14, gap: 6 }}>
          <Text style={type(10, 700, { ls: 0.1, color: C.crit })}>ONAYLI ACİL TALİMAT</Text>
          <Text style={type(13, 500, { lh: 1.5 })}>{n.emergency_instruction}</Text>
          <Text style={type(11, 400, { color: C.t3 })}>Ürünün kullanımı, imhası veya faaliyetin sürmesi kararını yetkili kişi verir; sistem bu kararı vermez.</Text>
        </View>
      ) : null}

      <CriticalFirst n={n} onAssign={() => setAssignNudge(x => x + 1)} />
      <CaseSummary n={n} />
      <FlowStepper n={n} />

      <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
        <Eyebrow>İLK MÜDAHALE</Eyebrow>
        {containment ? (
          <>
            <Text style={type(13, 500, { lh: 1.45 })}>{containment.notes}</Text>
            <Text style={type(11, 400, { color: C.t3 })}>{containment.done_by_name} · {fmtDateTime(containment.done_at)}</Text>
          </>
        ) : pending.includes('containment') ? <Text style={type(12.5, 500, { color: C.warn })}>Cihazda · gönderilecek</Text>
          : n.permissions.act && n.status !== 'closed' ? <StepForm testID="ncr-containment" placeholder="Etkiyi şimdi nasıl sınırladın? (ör. ürünleri güvenli üniteye taşıdım)" label="İlk müdahaleyi kaydet"
            onSave={notes => step('containment', notes, 'İlk müdahale')} />
          : <Text style={type(12.5, 400, { color: C.t2 })}>Henüz kaydedilmedi.</Text>}
      </Card>

      <AssignmentCard key={`a${assignNudge}-${n.owner?.id}-${n.due_at}`} n={n} base={base} reload={q.reload} initialOpen={assignNudge > 0} />
      <CauseCard n={n} base={base} reload={q.reload} />
      {/* Suggestions lead to the business's own screens; an outside verifier (no role here) cannot open them. */}
      {role ? <SupportCard n={n} base={base} reload={q.reload} onFollowUp={() => setFormKind('follow_up')} onAssign={() => setAssignNudge(x => x + 1)} /> : null}
      <TrainingCard n={n} />
      <LinkedRecords n={n} />
      <ActionsCard n={n} base={base} reload={q.reload} me={me?.userId ?? null} formKind={formKind} setFormKind={setFormKind} />

      {n.status === 'open' ? (
        <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
          <Eyebrow>ETKİNLİK KONTROLÜ{n.iteration > 1 ? ` · ${n.iteration}. TUR` : ''}</Eyebrow>
          {pending.includes('effectiveness_check') ? <Text style={type(12.5, 500, { color: C.warn })}>Cihazda · gönderilecek</Text>
            : !n.flow.readyForEffectiveness ? (
              <View style={{ gap: 4 }}>
                <Text style={type(12.5, 500, { color: C.t2 })}>Önce tamamlanmalı:</Text>
                {n.flow.blockers.map(b => <Text key={b} style={type(12, 400, { color: C.t3, lh: 1.45 })}>· {b}</Text>)}
              </View>
            ) : n.permissions.act ? <EffectivenessForm n={n} onSave={(notes, value) => step('effectiveness_check', notes, 'Etkinlik kontrolü', value)} />
              : <Text style={type(12.5, 400, { color: C.t2 })}>Sorumlu kişi kaydeder.</Text>}
        </Card>
      ) : effectiveness && n.status === 'awaiting_verification' ? (
        <Callout tone="info" title="Etkinlik kontrolü" body={`${effectiveness.notes}${effectiveness.data?.measurement ? ` · yeni ölçüm ${effectiveness.data.measurement.value} ${effectiveness.data.measurement.unit ?? ''}${effectiveness.data.measurement.within ? ' (limit içinde)' : ''}` : ''} · ${effectiveness.done_by_name}, ${fmtDateTime(effectiveness.done_at)}`} />
      ) : null}

      <VerificationCard n={n} base={base} reload={q.reload} />
      <ServiceLinkCard n={n} base={base} reload={q.reload} />
      {n.status !== 'closed' && n.permissions.serviceRequest ? (
        <GhostButton testID="ncr-service-request" label="Bu sorun için uzman hizmeti iste"
          onPress={() => router.push(`/service/new?ncrId=${n.id}&title=${encodeURIComponent(n.title)}`)} />
      ) : null}
      {n.permissions.manage && n.permissions.inviteVerifier ? (
        <GhostButton testID="ncr-share-case" label="Vakayı mesleki ağda paylaş (önizlemeli, anonim)"
          onPress={() => router.push(`/network/share-case?ncrId=${n.id}`)} />
      ) : null}
      {n.permissions.inviteVerifier ? <Text testID="ncr-case-posts" onPress={() => router.push('/network/case-posts')} style={type(12, 600, { color: C.info })}>İşletmenin vaka paylaşımları: onay ve geri çekme ›</Text> : null}
      <HistoryCard n={n} />
    </Screen>
  );
}

function StepForm({ placeholder, label, onSave, testID }: { placeholder: string; label: string; onSave: (notes: string) => void; testID: string }) {
  const [notes, setNotes] = useState('');
  return (
    <View style={{ gap: 10 }}>
      <Field testID={`${testID}-notes`} value={notes} onChangeText={setNotes} multiline placeholder={placeholder} />
      <PrimaryButton testID={`${testID}-save`} label={label} disabled={notes.trim().length < 5} height={46} size={13}
        onPress={() => { onSave(notes.trim()); setNotes(''); }} />
    </View>
  );
}

/** Effectiveness: what was observed, optionally a new measurement compared with the finding's limits. */
function EffectivenessForm({ n, onSave }: { n: NcrDetail; onSave: (notes: string, value: number | null) => void }) {
  const [notes, setNotes] = useState('');
  const [val, setVal] = useState('');
  const m = n.measurement;
  const value = val.trim() ? Number(val.replace(',', '.')) : null;
  const lo = m?.limit_min != null ? Number(m.limit_min) : null, hi = m?.limit_max != null ? Number(m.limit_max) : null;
  const out = value != null && Number.isFinite(value) && m ? (lo != null && value < lo) || (hi != null && value > hi) : false;
  const serviceDone = n.services.some(s => s.job_status === 'accepted');
  return (
    <View style={{ gap: 10 }}>
      {serviceDone ? <Text style={type(12, 500, { color: C.info, lh: 1.45 })}>Hizmet teslim alındı. Teslim kabulü teknik etkinlik değildir: sorunun giderildiğini burada ölçüm ya da gözlemle göster.</Text> : null}
      <Field testID="ncr-effectiveness-notes" value={notes} onChangeText={setNotes} multiline placeholder="Önlem işe yaradı mı? Ölçüm veya gözlemle göster (ör. 3 gün boyunca 2–4 °C)" />
      {m ? (
        <>
          <Field label={`Yeni ölçüm (${m.unit}) · ilk bulgu ${Number(m.value)} ${m.unit}, limit ${lo ?? '—'}…${hi ?? '—'} ${m.unit}`} testID="ncr-effectiveness-value" value={val}
            onChangeText={setVal} keyboardType="decimal-pad" placeholder="ör. 3,5" />
          {out ? <Text testID="ncr-effectiveness-out" style={type(12, 600, { color: C.crit, lh: 1.45 })}>Bu değer hâlâ limit dışında; etkinlik kontrolü olarak kaydedilemez. Yeni aksiyon ekle ya da ölçümü tekrarla.</Text> : null}
        </>
      ) : null}
      <PrimaryButton testID="ncr-effectiveness-save" label="Etkinlik kontrolünü kaydet ve doğrulama iste" disabled={notes.trim().length < 5 || out || (value != null && !Number.isFinite(value))} height={46} size={13}
        onPress={() => { onSave(notes.trim(), value); setNotes(''); setVal(''); }} />
    </View>
  );
}
