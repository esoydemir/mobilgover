import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../../api/client';
import { useSession } from '../../../api/session';
import { useApi } from '../../../api/useApi';
import { Screen } from '../../../components/Screen';
import { ErrorBox, ExampleBadge, Field, Loading } from '../../../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, PrimaryButton, StepMark, Tap } from '../../../components/ui';
import { fmtDateTime } from '../../../features/dates';
import { useUi } from '../../../state/app';
import { C, tint, type } from '../../../theme';

type A = {
  id: string; title: string; version: number; summary: string; body: string; videoUrl: string | null; minutes: number | null; isExample: boolean; exampleNote: string | null;
  participationNote: string; quiz: { q: string; options: string[] }[]; passScore: number; userName: string; assignedByName: string; assignedAt: string; dueAt: string | null;
  reason: string; ncrId: string | null; ncrTitle: string | null; readAt: string | null; completedAt: string | null; passedAt: string | null; bestScore: number | null;
  attempts: { score: number; passed: boolean; created_at: string }[]; fieldVerifiedAt: string | null; fieldVerifiedByName: string | null; fieldNotes: string | null;
  fieldResult: 'effective' | 'not_effective' | null; fieldActionId: string | null; cancelledAt: string | null; cancelReason: string | null;
  fieldActions: { id: string; description: string; verification_status: string }[];
  permissions: { read: boolean; complete: boolean; attempt: boolean; fieldVerify: boolean; fieldVerifyBlockedReason: string | null; cancel: boolean };
};

/** One assignment. Four separate facts: read, completed, passed, effective in the field. */
export default function AssignmentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { company, call } = useSession();
  const { showToast } = useUi();
  const q = useApi<A>(company ? `/companies/${company.id}/training/assignments/${id}` : null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [result, setResult] = useState<{ score: number; passed: boolean; wrong: number[] } | null>(null);
  const [notes, setNotes] = useState('');
  const [verdict, setVerdict] = useState<'effective' | 'not_effective'>('effective');
  const [actionId, setActionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = q.data;
  const base = `/companies/${company?.id}/training/assignments/${id}`;
  const run = async (fn: () => Promise<unknown>, ok?: string, sub?: string) => {
    setBusy(true); setError(null);
    try { await fn(); if (ok) showToast(ok, sub); await q.reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  if (!a) return <Screen title="Eğitim" titleEn="Training">{q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : <Loading />}</Screen>;
  const steps: [string, boolean, string | null][] = [
    ['Okundu / izlendi', !!a.readAt, a.readAt ? fmtDateTime(a.readAt) : null],
    ['Tamamlandı', !!a.completedAt, a.completedAt ? fmtDateTime(a.completedAt) : null],
    ...(a.quiz.length ? [['Değerlendirmeyi geçti', !!a.passedAt, a.passedAt ? `%${a.bestScore} · ${fmtDateTime(a.passedAt)}` : a.attempts.length ? `en iyi %${a.bestScore}, geçme %${a.passScore}` : null] as [string, boolean, string | null]] : []),
    ['Sahada etkinliği doğrulandı', a.fieldResult === 'effective', a.fieldVerifiedAt ? `${a.fieldResult === 'effective' ? 'Etkili' : 'Yetersiz'} · ${a.fieldVerifiedByName} · ${fmtDateTime(a.fieldVerifiedAt)}` : null],
  ];
  const firstOpen = steps.findIndex(s => !s[1]);
  return (
    <Screen title="Eğitim" titleEn="Training" onRefresh={q.reload} refreshing={q.loading}>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{a.isExample ? <ExampleBadge label="ÖRNEK İÇERİK" /> : null}</View>
      <Text style={type(23, 600, { family: 'outfit', ls: -0.03, lh: 1.15 })}>{a.title}</Text>
      <Text style={type(12, 400, { color: C.t3, lh: 1.45 })}>{a.userName} · atayan {a.assignedByName} · {fmtDateTime(a.assignedAt)}{a.dueAt ? ` · termin ${fmtDateTime(a.dueAt)}` : ''} · sürüm {a.version}</Text>
      <Text style={type(12.5, 400, { color: C.t2, lh: 1.45 })}>Neden: {a.reason}</Text>
      {a.ncrId ? <GhostButton testID="tr-open-ncr" label={`Bağlı uygunsuzluk: ${a.ncrTitle}`} height={38} size={12} style={{ alignSelf: 'flex-start' }} onPress={() => router.push(`/ncr/${a.ncrId}`)} /> : null}
      {a.cancelledAt ? <Text style={type(12.5, 600, { color: C.crit })}>İptal edildi: {a.cancelReason}</Text> : null}
      <Card>
        <Eyebrow>DURUM</Eyebrow>
        <View style={{ marginTop: 12 }}>
          {steps.map(([label, done, sub], i) => (
            <View key={label} testID={`tr-step-${i}`} style={{ flexDirection: 'row', gap: 12, paddingBottom: i < steps.length - 1 ? 12 : 0 }}>
              <StepMark state={done ? 'done' : i === firstOpen ? 'active' : 'todo'} />
              <View style={{ flex: 1 }}>
                <Text style={type(13.5, 600, { color: done ? C.t1 : i === firstOpen ? C.warn : C.t2 })}>{label}</Text>
                {sub ? <Text style={type(11.5, 400, { color: C.t3 })}>{sub}</Text> : null}
              </View>
            </View>
          ))}
        </View>
        <Text style={[type(11, 400, { color: C.t3, lh: 1.45 }), { marginTop: 10 }]}>{a.participationNote} Eğitimin tamamlanması bağlı uygunsuzluğu kapatmaz.</Text>
      </Card>
      {a.exampleNote ? <Text style={type(12, 500, { color: C.warn, lh: 1.45 })}>{a.exampleNote}</Text> : null}
      <Card style={{ gap: 8 }}>
        <Eyebrow>İÇERİK</Eyebrow>
        {a.summary ? <Text style={type(12.5, 500, { color: C.t2 })}>{a.summary}</Text> : null}
        <Text testID="tr-content" style={type(13.5, 400, { lh: 1.6 })}>{a.body}</Text>
        {a.videoUrl ? <Text style={type(12, 500, { color: C.info })}>Video: {a.videoUrl}</Text> : null}
        {a.permissions.read ? <PrimaryButton testID="tr-read" label={busy ? 'Kaydediliyor…' : 'Okudum / izledim'} glow={false} height={44} size={13} disabled={busy} onPress={() => run(() => call('POST', `${base}/read`, {}), 'Okundu olarak kaydedildi')} /> : null}
      </Card>
      {a.quiz.length && (a.permissions.attempt || a.attempts.length) ? (
        <Card style={{ gap: 10 }}>
          <Eyebrow>KISA DEĞERLENDİRME · GEÇME %{a.passScore}</Eyebrow>
          {a.permissions.attempt ? a.quiz.map((qq, i) => (
            <View key={i} style={{ gap: 6 }}>
              <Text style={type(13, 600, { color: result?.wrong.includes(i) ? C.crit : C.t1 })}>{i + 1}. {qq.q}</Text>
              <View style={{ gap: 6 }}>
                {qq.options.map((o, j) => <FilterChip key={j} testID={`tr-ans-${i}-${j}`} label={o} px={12} active={answers[i] === j} onPress={() => { setResult(null); setAnswers(x => { const n = [...x]; n[i] = j; return n; }); }} />)}
              </View>
            </View>
          )) : null}
          {result ? <Text testID="tr-result" style={type(13, 600, { color: result.passed ? C.lime : C.crit })}>{result.passed ? `Geçtin: %${result.score}` : `%${result.score} · geçme puanı %${a.passScore}. Kırmızı sorulara tekrar bak.`}</Text> : null}
          {a.permissions.attempt ? <PrimaryButton testID="tr-attempt" label={busy ? 'Gönderiliyor…' : 'Cevapları gönder'} glow={false} height={44} size={13}
            disabled={busy || a.quiz.some((_, i) => answers[i] == null)}
            onPress={() => run(async () => { setResult(await call('POST', `${base}/attempt`, { answers })); })} /> : null}
          {a.attempts.length ? <Text style={type(11.5, 400, { color: C.t3 })}>{a.attempts.length} deneme · en iyi %{a.bestScore}</Text> : null}
        </Card>
      ) : null}
      {a.permissions.complete ? (
        <PrimaryButton testID="tr-complete" label={busy ? 'Kaydediliyor…' : 'Eğitimi tamamladım'} glow={false} disabled={busy}
          onPress={() => run(() => call('POST', `${base}/complete`, {}), 'Tamamlandı olarak kaydedildi', 'Sahada etkinliğini yöneticin ayrıca doğrular.')} />
      ) : null}
      {a.fieldVerifiedAt ? (
        <Card style={{ gap: 6 }} border={a.fieldResult === 'effective' ? tint.lime(0.3) : tint.crit(0.3)}>
          <Eyebrow color={a.fieldResult === 'effective' ? C.lime : C.crit}>SAHADA ETKİNLİK</Eyebrow>
          <Text style={type(12.5, 400, { lh: 1.5 })}>{a.fieldNotes}</Text>
          <Text style={type(11.5, 400, { color: C.t3 })}>{a.fieldVerifiedByName} · {fmtDateTime(a.fieldVerifiedAt)}{a.fieldActionId ? ' · uygulama kanıtı: bağlı aksiyon' : ''}</Text>
        </Card>
      ) : null}
      {a.permissions.fieldVerifyBlockedReason ? <Text style={type(12, 500, { color: C.t3 })}>{a.permissions.fieldVerifyBlockedReason}</Text> : null}
      {a.permissions.fieldVerify ? (
        <Card style={{ gap: 9 }} border={tint.lime(0.3)}>
          <Eyebrow color={C.lime}>SAHADA ETKİNLİĞİ DOĞRULA</Eyebrow>
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Kişinin işi sahada doğru yaptığını gördün mü? Mümkünse bağlı kayıtta onun yaptığı aksiyonu uygulama kanıtı olarak seç.</Text>
          {a.fieldActions.length ? (
            <View style={{ gap: 6 }}>
              {a.fieldActions.map(x => <FilterChip key={x.id} testID={`tr-field-action-${x.id}`} label={`Uygulama kanıtı: ${x.description}`} px={12} active={actionId === x.id} onPress={() => setActionId(actionId === x.id ? null : x.id)} />)}
            </View>
          ) : a.ncrId ? <Text style={type(11.5, 400, { color: C.t3 })}>Bağlı kayıtta bu kişinin yaptığı bir aksiyon yok; gözlemini yaz.</Text> : null}
          <View style={{ flexDirection: 'row', gap: 7 }}>
            <FilterChip testID="tr-field-effective" label="Etkili" active={verdict === 'effective'} onPress={() => setVerdict('effective')} />
            <FilterChip testID="tr-field-not" label="Yetersiz" active={verdict === 'not_effective'} onPress={() => setVerdict('not_effective')} />
          </View>
          <Field label="Sahada ne gördün?" testID="tr-field-notes" value={notes} onChangeText={setNotes} multiline placeholder="ör. Üç açılışta kapıyı kapalı ve contayı kontrol edilmiş gördüm." />
          <PrimaryButton testID="tr-field-save" label={busy ? 'Kaydediliyor…' : 'Kaydet'} glow={false} height={44} size={13} disabled={busy || notes.trim().length < 10}
            onPress={() => run(() => call('POST', `${base}/field-verify`, { result: verdict, notes: notes.trim(), actionId }), 'Sahadaki etkinlik kaydedildi', 'Uygunsuzluk kendi doğrulamasıyla kapanır.')} />
        </Card>
      ) : null}
      {error ? <ErrorBox message={error} /> : null}
      {a.permissions.cancel ? <Tap testID="tr-cancel" onPress={() => run(() => call('POST', `${base}/cancel`, { reason: 'Yönetici iptal etti' }), 'Atama iptal edildi')}><Text style={type(12, 500, { color: C.crit })}>Atamayı iptal et</Text></Tap> : null}
    </Screen>
  );
}
