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
    <Card style={{ padding: 15, gap: 8 }}>
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
    <Card style={{ padding: 15, gap: 8 }}>
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

type Complaint = { id: string; opened_side: 'business' | 'provider'; reason: string; status: 'open' | 'responded' | 'resolved'; response: string | null; resolution: string | null; created_at: string };
const COMPLAINT_TR: Record<string, string> = { open: 'Yanıt bekliyor', responded: 'Yanıtlandı · karar bekliyor', resolved: 'Karara bağlandı' };

/**
 * Complaints of one job, from either side. A complaint is its own record: it does not change the job's status,
 * the review of the report document or the nonconformity. The other side answers; a marketplace reviewer decides in writing.
 */
export function ComplaintCard({ jobId, provider }: { jobId: string; provider?: boolean }) {
  const { company, call } = useSession();
  const side = provider ? 'provider' : 'business';
  const base = provider ? '/pro' : `/companies/${company?.id}`;
  const q = useApi<Complaint[]>(provider || company ? `${base}/jobs/${jobId}/complaints` : null);
  const [text, setText] = useState(''); const [answer, setAnswer] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); setError(null); try { await f(); setText(''); setAnswer(''); q.reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const mineOpen = (q.data ?? []).some(c => c.opened_side === side && c.status !== 'resolved');
  return (
    <Card style={{ padding: 15, gap: 8 }}>
      <View testID="complaint-card"><Eyebrow>ŞİKÂYET</Eyebrow></View>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data && q.loading ? <Loading /> : null}
      {q.data?.length === 0 ? <Text style={type(12, 400, { color: C.t2 })}>Bu iş için şikâyet yok.</Text> : null}
      {(q.data ?? []).map(c => (
        <View key={c.id} style={{ gap: 4, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 8 }}>
          <Text style={type(11, 600, { color: C.warn })}>{c.opened_side === side ? 'Senin şikâyetin' : 'Karşı tarafın şikâyeti'} · {COMPLAINT_TR[c.status]} · {fmtDateTime(c.created_at)}</Text>
          <Text style={type(13, 400, { lh: 1.4 })}>{c.reason}</Text>
          {c.response ? <Text style={type(12.5, 400, { color: C.t2, lh: 1.4 })}>Yanıt: {c.response}</Text> : null}
          {c.resolution ? <Text style={type(12.5, 600, { color: C.lime, lh: 1.4 })}>Karar: {c.resolution}</Text> : null}
          {c.status === 'open' && c.opened_side !== side ? (
            <View style={{ gap: 6 }}>
              <Field label="Yanıtın" testID="complaint-answer" value={answer} onChangeText={setAnswer} multiline />
              <PrimaryButton testID="complaint-respond" label="Yanıtla" disabled={busy || answer.trim().length < 10} onPress={() => run(() => call('POST', `${base}/complaints/${c.id}/respond`, { response: answer }))} />
            </View>
          ) : null}
        </View>
      ))}
      {!mineOpen ? (
        <View style={{ gap: 6 }}>
          <Field label="Şikâyetin nedeni" testID="complaint-reason" value={text} onChangeText={setText} multiline />
          <GhostButton testID="complaint-open" label="Şikâyet aç" height={38} size={12} disabled={busy || text.trim().length < 10} onPress={() => run(() => call('POST', `${base}/jobs/${jobId}/complaints`, { reason: text }))} />
        </View>
      ) : null}
      {error ? <ErrorBox message={error} /> : null}
      <Text style={type(11, 400, { color: C.t3, lh: 1.4 })}>Şikâyet iş durumunu, rapor incelemesini veya uygunsuzluğu değiştirmez; platform değerlendiricisi gerekçeli karar verir.</Text>
    </Card>
  );
}

type Suggestion = { category: { code: string; name: string }; urgency: 'case' | 'planned'; reason: string; providers: { id: string; name: string; authorization: { validUntil: string | null } }[]; leftOutExpiredApproval: number; noMatch: boolean; openRequest: { note: string } | null };

/** Services the business may need, each with the reason it rests on. Reading only: nothing is sent until the person opens a request. */
export function ServiceSuggestions({ onOpen }: { onOpen: (categoryCode: string) => void }) {
  const { company, siteId } = useSession();
  const q = useApi<{ suggestions: Suggestion[] }>(company && siteId ? `/companies/${company.id}/service-suggestions?siteId=${siteId}` : null);
  if (!q.data?.suggestions.length) return null;
  return (
    <View testID="service-suggestions" style={{ gap: 8 }}>
      <Eyebrow>İHTİYACINA GÖRE ÖNERİLER</Eyebrow>
      {q.data.suggestions.map(s => (
        <Card key={s.category.code} style={{ padding: 15, gap: 6 }}>
          <Text style={type(14, 700)}>{s.category.name}{s.urgency === 'case' ? ' · açık kayıt var' : ''}</Text>
          <Text style={type(12.5, 400, { color: C.t2, lh: 1.45 })}>{s.reason}</Text>
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.4 })}>
            {s.noMatch ? s.openRequest?.note : `${s.providers.length} onaylı uzman${s.providers[0]?.authorization.validUntil ? ` (onay en erken ${s.providers.map(p => p.authorization.validUntil).filter(Boolean).sort()[0]} tarihine kadar)` : ''}`}
            {s.leftOutExpiredApproval ? ` · Onay süresi dolan ${s.leftOutExpiredApproval} uzman eşleştirilmedi.` : ''}
          </Text>
          <PrimaryButton testID={`suggest-${s.category.code}`} label={s.noMatch ? 'Açık talep oluştur' : 'Uzmanları gör, talep aç'} glow={false} height={40} size={12.5} onPress={() => onOpen(s.category.code)} />
        </Card>
      ))}
    </View>
  );
}

type OpsRow = { id: string; title: string; responsible: string; waitingDays: number; nextAction: string; record: { type: string; id: string } };
type Ops = { lists: Record<'openRequests' | 'lateAppointments' | 'rejectedReports' | 'expiringApprovals' | 'openComplaints', OpsRow[]> };
const OPS_TR: Record<keyof Ops['lists'], string> = { openRequests: 'Açık talepler', lateAppointments: 'Geciken randevular', rejectedReports: 'Revizyon bekleyen raporlar', expiringApprovals: 'Biten / bitmek üzere onaylar', openComplaints: 'Açık şikâyetler' };

/** Marketplace reviewer's five work lists: who waits, how long, what comes next, and the record to open. Complaints can be decided here. */
export function MarketOps() {
  const { call } = useSession();
  const q = useApi<Ops>('/admin/marketplace/operations');
  const [resolution, setResolution] = useState(''); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const resolve = async (id: string) => { setBusy(true); setError(null); try { await call('POST', `/admin/marketplace/complaints/${id}/resolve`, { resolution }); setResolution(''); q.reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  return (
    <View testID="market-ops" style={{ gap: 8 }}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data && q.loading ? <Loading /> : null}
      {q.data ? (Object.keys(OPS_TR) as (keyof Ops['lists'])[]).map(k => (
        <Card key={k} style={{ padding: 15, gap: 6 }}>
          <Eyebrow>{OPS_TR[k].toUpperCase()} · {q.data!.lists[k].length}</Eyebrow>
          {q.data!.lists[k].length === 0 ? <Text style={type(12, 400, { color: C.t3 })}>Bekleyen kayıt yok.</Text> : null}
          {q.data!.lists[k].map(r => (
            <View key={r.id} style={{ gap: 2, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 6 }}>
              <Text style={type(13, 600, { lh: 1.35 })}>{r.title}</Text>
              <Text style={type(11.5, 400, { color: C.t2, lh: 1.4 })}>Bekleyen: {r.responsible} · {r.waitingDays} gündür</Text>
              <Text style={type(11.5, 400, { color: C.t3, lh: 1.4 })}>Sıradaki adım: {r.nextAction}</Text>
              {k === 'openComplaints' ? (
                <View style={{ gap: 6 }}>
                  <Field label="Karar gerekçesi" testID={`ops-resolution-${r.id}`} value={resolution} onChangeText={setResolution} multiline />
                  <GhostButton testID={`ops-resolve-${r.id}`} label="Karara bağla" height={36} size={12} disabled={busy || resolution.trim().length < 10} onPress={() => resolve(r.id)} />
                </View>
              ) : null}
            </View>
          ))}
        </Card>
      )) : null}
      {error ? <ErrorBox message={error} /> : null}
    </View>
  );
}
