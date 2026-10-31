import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useQueue } from '../../api/queue';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { GradientFill } from '../../components/Gradient';
import { Screen } from '../../components/Screen';
import { ErrorBox, Field, Loading, StaleNote } from '../../components/states';
import { Card, Eyebrow, GhostButton, Pill, PrimaryButton, StepMark } from '../../components/ui';
import { fmtDateTime } from '../../features/dates';
import { useUi } from '../../state/app';
import { C, tint, type } from '../../theme';
import { SEVERITY_LABEL } from '../../features/labels';
import { RISK } from '../ncrs';

type Step = 'containment' | 'correction' | 'root_cause' | 'corrective_action' | 'effectiveness_check';
type Ncr = {
  id: string; title: string; description: string; risk_level: string; depth: string; status: string; recurrence_count: number;
  emergency_instruction: string | null; detected_at: string; due_at: string | null; closed_at: string | null;
  risk_rationale: { severity: string; base: string; escalatedBy: number; policy: string; independentVerification: boolean };
  requiredSteps: Step[]; steps: { step: Step; notes: string; done_by: string; done_at: string }[];
  closable: { ok: boolean; code?: string; message?: string };
};

const STEP_TEXT: Record<Step, [string, string]> = {
  containment: ['Kontrol altına alma', 'Etkiyi şimdi sınırla (ör. ürünü güvenli üniteye taşı).'],
  correction: ['Düzeltme', 'Bu sorunu gider (ör. arızayı onar).'],
  root_cause: ['Kök neden', 'Neden oldu? Ekipman, süreç, insan, malzeme.'],
  corrective_action: ['Düzeltici faaliyet', 'Tekrarını önleyecek değişiklik.'],
  effectiveness_check: ['Etkinlik doğrulaması', 'Önlem işe yaradı mı? Ölçüm veya gözlemle göster.'],
};

export default function NcrRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { company, call, me } = useSession();
  const { enqueue, ops } = useQueue();
  const { showToast } = useUi();
  const base = `/companies/${company?.id}`;
  const q = useApi<Ncr>(company ? `${base}/nonconformities/${id}` : null);
  const [notes, setNotes] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const n = q.data;
  if (!n) return <Screen title="Uygunsuzluk" titleEn="Nonconformity">{q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : <Loading />}</Screen>;

  const done = new Set(n.steps.map(s => s.step));
  const pendingLocal = ops.filter(o => o.path === `${base}/nonconformities/${id}/steps`).map(o => (o.body as { step: Step }).step);
  const next = n.requiredSteps.find(s => !done.has(s) && !pendingLocal.includes(s));
  const performedByMe = n.steps.some(s => (s.step === 'correction' || s.step === 'corrective_action') && s.done_by === me?.userId);

  return (
    <Screen title="Uygunsuzluk" titleEn="Nonconformity" onRefresh={q.reload} refreshing={q.loading}>
      {q.stale ? <StaleNote /> : null}
      <View style={{ borderWidth: 1, borderColor: tint.crit(0.3), borderRadius: 28, padding: 20, overflow: 'hidden' }}>
        <GradientFill angle={155} stops={[[0, '#1a0a0a'], [0.6, '#0a0505'], [1, C.bg]]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Pill label={RISK[n.risk_level]![0]} fg={RISK[n.risk_level]![1]} bg={RISK[n.risk_level]![2]} />
          <Text style={type(10, 700, { ls: 0.1, color: n.status === 'closed' ? C.lime : C.crit })}>{n.status === 'closed' ? 'KAPALI' : n.status === 'awaiting_verification' ? 'DOĞRULAMA BEKLİYOR' : 'AÇIK'}{n.recurrence_count ? ` · ${n.recurrence_count + 1}. TEKRAR` : ''}</Text>
        </View>
        <Text style={[type(21, 600, { family: 'outfit', ls: -0.03, lh: 1.15 }), { marginTop: 12 }]}>{n.title}</Text>
        <Text style={[type(13, 400, { lh: 1.5, color: C.t2 }), { marginTop: 8 }]}>{n.description}</Text>
        <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 8 }]}>Tespit {fmtDateTime(n.detected_at)}{n.due_at ? ` · termin ${fmtDateTime(n.due_at)}` : ''}</Text>
      </View>

      {n.emergency_instruction && n.status !== 'closed' ? (
        <View style={{ borderWidth: 1, borderColor: tint.crit(0.3), backgroundColor: tint.crit(0.06), borderRadius: 18, padding: 14, gap: 6 }}>
          <Text style={type(10, 700, { ls: 0.1, color: C.crit })}>ONAYLI ACİL TALİMAT</Text>
          <Text style={type(13, 500, { lh: 1.5 })}>{n.emergency_instruction}</Text>
          <Text style={type(11, 400, { color: C.t3 })}>Ürünün kullanımı, imhası veya faaliyetin sürmesi kararını yetkili kişi verir; sistem bu kararı vermez.</Text>
        </View>
      ) : null}

      <Card>
        <Eyebrow>{n.depth === 'capa' ? 'DÜZELTİCİ FAALİYET AKIŞI (TAM CAPA)' : 'DÜZELTME AKIŞI'}</Eyebrow>
        <Text style={[type(11.5, 400, { color: C.t3, lh: 1.45 }), { marginTop: 6 }]}>Derinlik riske göre: önem {SEVERITY_LABEL[n.risk_rationale.severity] ?? n.risk_rationale.severity}{n.risk_rationale.escalatedBy ? `, tekrar nedeniyle +${n.risk_rationale.escalatedBy} seviye` : ''}. {n.risk_rationale.policy}</Text>
        <View style={{ marginTop: 14 }}>
          {n.requiredSteps.map(s => {
            const rec = n.steps.find(x => x.step === s);
            const local = pendingLocal.includes(s);
            return (
              <View key={s} style={{ flexDirection: 'row', gap: 12, alignItems: 'stretch' }}>
                <View style={{ width: 22, alignItems: 'center' }}>
                  <StepMark state={rec ? 'done' : local || s === next ? 'active' : 'todo'} />
                  <View style={{ flex: 1, width: 1, backgroundColor: C.bd }} />
                </View>
                <View style={{ flex: 1, paddingBottom: 16 }}>
                  <Text style={type(13.5, 600, { color: rec ? C.t1 : C.t2 })}>{STEP_TEXT[s][0]}</Text>
                  <Text style={[type(11.5, 400, { lh: 1.45, color: C.t3 }), { marginTop: 3 }]}>{rec ? `${rec.notes} · ${fmtDateTime(rec.done_at)}` : local ? 'Cihazda · gönderilecek' : STEP_TEXT[s][1]}</Text>
                </View>
              </View>
            );
          })}
        </View>
      </Card>

      {n.status !== 'closed' && next ? (
        <Card>
          <Eyebrow>SIRADAKİ ADIM · {STEP_TEXT[next][0].toUpperCase()}</Eyebrow>
          <View style={{ marginTop: 10 }}><Field testID="ncr-step-notes" value={notes} onChangeText={setNotes} multiline placeholder={STEP_TEXT[next][1]} /></View>
          <PrimaryButton testID="ncr-step-save" label="Adımı kaydet" disabled={notes.trim().length < 5} style={{ marginTop: 12 }} height={46} size={13.5}
            onPress={() => { enqueue({ companyId: company!.id, label: `Uygunsuzluk: ${STEP_TEXT[next][0]}`, path: `${base}/nonconformities/${id}/steps`, body: { step: next, notes: notes.trim() } }); setNotes(''); showToast('Adım kaydedildi', 'Cihazda; bağlantı varsa gönderilir.'); }} />
        </Card>
      ) : null}

      {n.status === 'awaiting_verification' ? (
        <Card border={tint.lime(0.3)}>
          <Eyebrow color={C.lime}>KAPANIŞ DOĞRULAMASI</Eyebrow>
          {n.risk_rationale.independentVerification ? (
            <Text style={[type(12.5, 400, { color: performedByMe ? C.warn : C.t2, lh: 1.5 }), { marginTop: 8 }]}>
              {performedByMe ? 'Düzeltmeyi sen yaptın; yüksek riskli kaydı başka bir yetkili kapatmalı.' : 'Yüksek risk: düzeltmeyi yapmamış bir yetkili kapatır.'}
            </Text>
          ) : null}
          <View style={{ marginTop: 10 }}><Field testID="ncr-close-notes" value={closeNote} onChangeText={setCloseNote} multiline placeholder="Neyi kontrol ettin? (ölçüm, belge, gözlem)" /></View>
          {error ? <ErrorBox message={error} /> : null}
          <PrimaryButton testID="ncr-close" label="Doğrula ve kapat" disabled={closeNote.trim().length < 5} style={{ marginTop: 12 }} height={46} size={13.5}
            onPress={async () => {
              setError(null);
              try { await call('POST', `${base}/nonconformities/${id}/close`, { notes: closeNote.trim() }); showToast('Uygunsuzluk kapatıldı'); await q.reload(); }
              catch (e) { setError(errorText(e)); }
            }} />
          <Text style={[type(11, 400, { color: C.t3 }), { marginTop: 8 }]}>Kapanış doğrulaması çevrimiçi yapılır.</Text>
        </Card>
      ) : null}

      {n.status !== 'closed' ? (
        <GhostButton label="Bu sorun için uzman hizmeti iste" onPress={() => router.push(`/service/new?ncrId=${id}&title=${encodeURIComponent(n.title)}`)} />
      ) : null}
    </Screen>
  );
}
