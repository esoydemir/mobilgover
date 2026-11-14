import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { ErrorBox, Field, Loading } from '../components/states';
import { Card, Eyebrow, GhostButton, PrimaryButton } from '../components/ui';
import { C, tint, type } from '../theme';
import { fmtDateTime } from './dates';

type Appt = { id: string; startsAt: string; endsAt: string; status: string; proposedSide: 'business' | 'provider'; note: string | null; reason: string | null };
type ApptView = { side: 'business' | 'provider'; live: Appt | null; history: Appt[]; canAnswer: boolean };
const STATUS_TR: Record<string, string> = { proposed: 'Yanıt bekliyor', confirmed: 'Onaylandı', declined: 'Reddedildi', cancelled: 'İptal edildi', superseded: 'Yeni zaman önerildi' };

/** YYYY-AA-GG + SS:DD (Istanbul wall time) → ISO. Plain text fields keep this working on every device. */
function toIso(day: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${day}T${time}:00+03:00`);
  return Number.isNaN(+d) ? null : d.toISOString();
}

/**
 * Appointment of an awarded job (before check-in). Either side proposes a slot, the other side confirms or declines,
 * either side can cancel with a reason; earlier slots stay in the history.
 */
export function AppointmentCard({ jobId, provider, editable }: { jobId: string; provider?: boolean; editable: boolean }) {
  const { company, call } = useSession();
  const base = provider ? `/pro` : `/companies/${company?.id}`;
  const q = useApi<ApptView>(provider || company ? `${base}/jobs/${jobId}/appointments` : null);
  const [day, setDay] = useState(''); const [from, setFrom] = useState('09:00'); const [to, setTo] = useState('11:00'); const [note, setNote] = useState('');
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [form, setForm] = useState(false);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); setError(null); try { await f(); setForm(false); setReason(''); q.reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const v = q.data;
  const startsAt = toIso(day, from), endsAt = toIso(day, to);
  return (
    <Card radius={22} style={{ padding: 15, gap: 8 }}>
      <View testID="appt-card"><Eyebrow>RANDEVU</Eyebrow></View>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!v && q.loading ? <Loading /> : null}
      {v?.live ? (
        <View testID="appt-live" style={{ gap: 4 }}>
          <Text style={type(14, 700)}>{fmtDateTime(v.live.startsAt)} – {fmtDateTime(v.live.endsAt).slice(-5)}</Text>
          <Text style={type(12, 600, { color: v.live.status === 'confirmed' ? C.lime : C.warn })}>{STATUS_TR[v.live.status]}{v.live.status === 'proposed' ? ` · öneren: ${v.live.proposedSide === v.side ? 'sen' : 'karşı taraf'}` : ''}</Text>
          {v.live.note ? <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{v.live.note}</Text> : null}
        </View>
      ) : <Text testID="appt-none" style={type(12.5, 400, { color: C.t2 })}>Henüz planlanmış randevu yok.</Text>}
      {editable && v?.canAnswer && v.live ? (
        <View style={{ gap: 8 }}>
          <PrimaryButton testID="appt-accept" label="Randevuyu onayla" disabled={busy} onPress={() => run(() => call('POST', `${base}/appointments/${v.live!.id}/decision`, { accept: true }))} />
          <Field label="Reddederken gerekçe" testID="appt-reason" value={reason} onChangeText={setReason} />
          <GhostButton testID="appt-decline" label="Reddet" disabled={busy || reason.trim().length < 3} onPress={() => run(() => call('POST', `${base}/appointments/${v.live!.id}/decision`, { accept: false, reason }))} />
        </View>
      ) : null}
      {editable && v?.live && !v.canAnswer ? (
        <View style={{ gap: 8 }}>
          <Field label="İptal gerekçesi" testID="appt-cancel-reason" value={reason} onChangeText={setReason} />
          <GhostButton testID="appt-cancel" label="Randevuyu iptal et" disabled={busy || reason.trim().length < 3} onPress={() => run(() => call('POST', `${base}/appointments/${v.live!.id}/cancel`, { reason }))} />
        </View>
      ) : null}
      {editable ? (
        form ? (
          <View style={{ gap: 8 }}>
            <Field label="Gün (YYYY-AA-GG)" testID="appt-day" value={day} onChangeText={setDay} placeholder="2026-12-01" />
            <Field label="Başlangıç (SS:DD)" testID="appt-from" value={from} onChangeText={setFrom} />
            <Field label="Bitiş (SS:DD)" testID="appt-to" value={to} onChangeText={setTo} />
            <Field label="Not (isteğe bağlı)" testID="appt-note" value={note} onChangeText={setNote} />
            <PrimaryButton testID="appt-send" label={v?.live ? 'Yeni zaman öner' : 'Zaman öner'} disabled={busy || !startsAt || !endsAt}
              onPress={() => run(() => call('POST', `${base}/jobs/${jobId}/appointments`, { startsAt, endsAt, note: note.trim() || null }))} />
          </View>
        ) : <GhostButton testID="appt-new" label={v?.live ? 'Başka zaman öner' : 'Randevu planla'} height={38} size={12} onPress={() => setForm(true)} />
      ) : <Text style={type(11.5, 400, { color: C.t3 })}>Randevu yalnız işe başlamadan önce planlanır.</Text>}
      {error ? <ErrorBox message={error} /> : null}
      {v && v.history.length > 1 ? (
        <View style={{ gap: 2 }}>
          {v.history.filter(h => h.id !== v.live?.id).map(h => <Text key={h.id} style={type(11, 400, { color: C.t3 })}>{fmtDateTime(h.startsAt)} · {STATUS_TR[h.status]}{h.reason ? ` · ${h.reason}` : ''}</Text>)}
        </View>
      ) : null}
    </Card>
  );
}

type Msg = { id: string; side: 'business' | 'provider'; body: string; at: string; mine: boolean };
/** Messages of one request with one provider. Tied to the request: payment and contract stay outside the app. */
export function MessageThread({ requestId, profileId, provider }: { requestId: string; profileId?: string; provider?: boolean }) {
  const { company, call } = useSession();
  const path = provider ? `/pro/requests/${requestId}/messages` : `/companies/${company?.id}/service-requests/${requestId}/messages`;
  const q = useApi<{ providerName?: string; requestTitle: string; messages: Msg[]; note: string }>(provider || (company && profileId) ? `${path}${provider ? '' : `?profileId=${profileId}`}` : null);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true); setError(null);
    try { await call('POST', path, provider ? { body: text } : { profileId, body: text }); setText(''); q.reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Card radius={22} style={{ padding: 15, gap: 8 }}>
      <View testID="msg-thread"><Eyebrow>YAZIŞMA{q.data?.providerName ? ` · ${q.data.providerName}` : ''}</Eyebrow></View>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data && q.loading ? <Loading /> : null}
      {q.data?.messages.length === 0 ? <Text style={type(12, 400, { color: C.t2 })}>Henüz mesaj yok.</Text> : null}
      {(q.data?.messages ?? []).map(m => (
        <View key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '88%', borderRadius: 14, padding: 10, backgroundColor: m.mine ? tint.lime(0.12) : C.card, borderWidth: 1, borderColor: C.bd }}>
          <Text style={type(13, 400, { lh: 1.4 })}>{m.body}</Text>
          <Text style={type(10, 400, { color: C.t3 })}>{m.side === 'business' ? 'İşletme' : 'Uzman'} · {fmtDateTime(m.at)}</Text>
        </View>
      ))}
      <Field label="Mesajın" testID="msg-input" value={text} onChangeText={setText} multiline />
      <PrimaryButton testID="msg-send" label="Gönder" disabled={busy || text.trim().length === 0} onPress={send} />
      {error ? <ErrorBox message={error} /> : null}
      {q.data ? <Text style={type(11, 400, { color: C.t3, lh: 1.4 })}>{q.data.note}</Text> : null}
    </Card>
  );
}
