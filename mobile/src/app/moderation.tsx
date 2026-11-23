import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Field, Loading } from '../components/states';
import { Card, FilterChip, PrimaryButton, Tap, shortWhy } from '../components/ui';
import { fmtDateTime } from '../features/dates';
import { REPORT_REASONS } from '../features/network';
import { useUi } from '../state/app';
import { C, tint, type } from '../theme';

type Report = { id: string; target_type: 'post' | 'comment' | 'profile'; target_id: string; reason: string; details: string; status: string; decision: string | null;
  decision_notes: string | null; reporter_name: string; handled_by_name: string | null; created_at: string; handled_at: string | null; reportsOnTarget: number;
  target: { body: string | null; author_name: string; author_id: string; hidden_at?: string | null; status?: string } | null };

const REASON = Object.fromEntries(REPORT_REASONS);
const TARGET: Record<string, string> = { post: 'Paylaşım', comment: 'Yorum', profile: 'Profil' };
const DECISION: Record<string, string> = { hide: 'İçeriği gizle', dismiss: 'Şikâyeti reddet', suspend_profile: 'Profili askıya al' };

/** Network moderation: every decision needs a reason and is recorded in the audit log. */
export default function ModerationRoute() {
  const params = useLocalSearchParams<{ status?: string }>();
  const [status, setStatus] = useState<'open' | 'closed' | 'appeals'>(params.status === 'closed' || params.status === 'appeals' ? params.status : 'open');
  const q = useApi<Report[]>(status === 'appeals' ? null : `/network/moderation/reports?status=${status}`);
  const ap = useApi<Appeal[]>(status === 'appeals' ? '/network/moderation/appeals' : null);
  return (
    <Screen title="Moderasyon" titleEn="Moderation" gap={10} onRefresh={q.reload} refreshing={q.loading}>
      <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>Mesleki ağ şikâyetleri. Karar gerekçesi zorunludur; karar, aynı içerikteki tüm açık şikâyetleri kapatır ve denetim kaydına yazılır. Kendi şikâyetini karara bağlayamazsın.</Text>
      <View style={{ flexDirection: 'row', gap: 7 }}>
        <FilterChip testID="mod-open" label="Açık" active={status === 'open'} onPress={() => setStatus('open')} />
        <FilterChip testID="mod-closed" label="Karara bağlanan" active={status === 'closed'} onPress={() => setStatus('closed')} />
        <FilterChip testID="mod-appeals" label="İtirazlar" active={status === 'appeals'} onPress={() => setStatus('appeals')} />
      </View>
      {status === 'appeals' ? (ap.error ? <ErrorBox message={ap.error} /> : !ap.data ? <Loading /> : ap.data.length === 0 ? <Empty title="Açık itiraz yok" /> : ap.data.map(a => <AppealCard key={a.id} a={a} reload={ap.reload} />)) : null}
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {status === 'appeals' ? null : !q.data ? <Loading /> : q.data.length === 0 ? <Empty title={status === 'open' ? 'Açık şikâyet yok' : 'Karar yok'} /> : q.data.map(r => <ReportCard key={r.id} r={r} reload={q.reload} />)}
    </Screen>
  );
}

function ReportCard({ r, reload }: { r: Report; reload: () => Promise<void> }) {
  const { call } = useSession();
  const { showToast } = useUi();
  const [decision, setDecision] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const options = r.target_type === 'profile' ? ['suspend_profile', 'dismiss'] : ['hide', 'suspend_profile', 'dismiss'];
  return (
    <Card style={{ gap: 8 }} border={r.status === 'open' ? tint.warn(0.3) : C.bd}>
      <Text style={type(10, 700, { ls: 0.08, color: C.warn })}>{TARGET[r.target_type]} · {REASON[r.reason] ?? r.reason}{r.reportsOnTarget > 1 ? ` · ${r.reportsOnTarget} şikâyet` : ''}</Text>
      <Tap onPress={() => r.target_type === 'post' ? router.push(`/network/post/${r.target_id}`) : r.target ? router.push(`/network/p/${r.target.author_id}`) : undefined}>
        <Text style={type(12.5, 600)}>{r.target?.author_name ?? 'silinmiş'}</Text>
        {r.target?.body ? <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })} numberOfLines={5}>{r.target.body}</Text> : null}
      </Tap>
      <Text style={type(11.5, 400, { color: C.t3 })}>Şikâyet eden: {r.reporter_name} · {fmtDateTime(r.created_at)}{r.details ? ` · "${r.details}"` : ''}</Text>
      {r.status !== 'open' ? (
        <Text style={type(12, 500, { color: r.status === 'dismissed' ? C.t2 : C.lime, lh: 1.45 })}>
          Karar: {DECISION[r.decision ?? ''] ?? r.decision} · {r.handled_by_name} · {r.handled_at ? fmtDateTime(r.handled_at) : ''}{'\n'}Gerekçe: {r.decision_notes}
        </Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {options.map(o => <FilterChip key={o} testID={`mod-decision-${o}-${r.id}`} label={DECISION[o]!} px={11} active={decision === o} onPress={() => setDecision(o)} />)}
          </View>
          <Field label="Gerekçe (zorunlu)" testID={`mod-notes-${r.id}`} value={notes} onChangeText={setNotes} multiline />
          {error ? <ErrorBox message={error} /> : null}
          <PrimaryButton testID={`mod-submit-${r.id}`} label="Kararı kaydet" glow={false} height={40} size={12.5} disabled={!decision || notes.trim().length < 10}
            onPress={async () => { setError(null); try { await call('POST', `/network/moderation/reports/${r.id}`, { decision, notes }); showToast('Karar kaydedildi'); await reload(); } catch (e) { setError(errorText(e)); } }} />
        </>
      )}
    </Card>
  );
}

type Appeal = { id: string; reason: string; created_at: string; target_type: string; decision: string; decision_notes: string; first_moderator: string | null; mine_first: boolean };

/** An appeal is decided by a moderator other than the one who made the first decision (the server enforces it). */
function AppealCard({ a, reload }: { a: Appeal; reload: () => Promise<void> }) {
  const { call } = useSession();
  const { showToast } = useUi();
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const go = async (decision: 'upheld' | 'overturned') => { setError(null); try { await call('POST', `/network/moderation/appeals/${a.id}`, { decision, notes }); showToast('İtiraz karara bağlandı'); await reload(); } catch (e) { setError(errorText(e)); } };
  return (
    <Card style={{ gap: 7 }} border={tint.warn(0.3)}>
      <Text style={type(10, 700, { ls: 0.08, color: C.warn })}>İTİRAZ · {TARGET[a.target_type]} · ilk karar: {DECISION[a.decision]}</Text>
      <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>İlk gerekçe ({a.first_moderator}): {a.decision_notes}</Text>
      <Text style={type(12.5, 500, { lh: 1.45 })}>İtiraz: {a.reason}</Text>
      {a.mine_first ? <Text testID={`appeal-own-${a.id}`} style={type(12, 600, { color: C.crit })}>İlk kararı sen verdin; bu itirazı başka bir moderatör incelemeli.</Text> : (
        <>
          <Field label="Gerekçe (zorunlu)" testID={`appeal-notes-${a.id}`} value={notes} onChangeText={setNotes} multiline />
          {error ? <ErrorBox message={error} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PrimaryButton testID={`appeal-overturn-${a.id}`} label="Kararı kaldır" glow={false} height={38} size={12} style={{ flex: 1 }} disabled={notes.trim().length < 10} why={shortWhy(notes, 10, 'Not')} onPress={() => go('overturned')} />
            <PrimaryButton testID={`appeal-uphold-${a.id}`} label="Karar kalsın" glow={false} height={38} size={12} style={{ flex: 1 }} disabled={notes.trim().length < 10} why={shortWhy(notes, 10, 'Not')} onPress={() => go('upheld')} />
          </View>
        </>
      )}
    </Card>
  );
}
