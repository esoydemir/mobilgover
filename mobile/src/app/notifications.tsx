import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Loading } from '../components/states';
import { GhostButton, Tap } from '../components/ui';
import { fmtDateTime } from '../features/dates';
import { C, tint, type } from '../theme';

export type Note = { id: string; kind: string; entity_type: string; entity_id: string; title: string; body: string; created_at: string; read_at: string | null };
type Inbox = { items: Note[]; unread: number };

const TONE: Record<string, string> = {
  ncr_overdue: C.crit, action_overdue: C.crit, ncr_verification_failed: C.crit, ncr_reopened: C.warn,
  ncr_due_soon: C.warn, action_due_soon: C.warn, reassignment_needed: C.warn, obligation_review_requested: C.warn,
  ncr_verification_requested: C.lime, ncr_assigned: C.info, action_assigned: C.info, ncr_reported: C.info, obligation_review_done: C.info,
};

/** In-app notifications for this business: only what the person can still open. */
export default function NotificationsRoute() {
  const { company, call } = useSession();
  const base = company ? `/companies/${company.id}/notifications` : null;
  const q = useApi<Inbox>(base);
  const open = async (n: Note) => {
    if (!n.read_at) { try { await call('POST', `${base}/read`, { ids: [n.id] }); } catch { /* opening still works */ } }
    if (n.entity_type === 'nonconformity') router.push(`/ncr/${n.entity_id}`);
    else if (n.entity_type === 'obligation') router.push(`/obligation/${n.entity_id}`);
    else if (n.entity_type === 'membership') router.push('/ncrs');
  };
  return (
    <Screen title="Bildirimler" titleEn="Notifications" gap={10} onRefresh={q.reload} refreshing={q.loading}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data && !q.error ? <Loading /> : null}
      {q.data && q.data.unread > 0 ? (
        <GhostButton testID="notes-read-all" label={`Tümünü okundu say (${q.data.unread})`} height={36} size={12} style={{ alignSelf: 'flex-start' }}
          onPress={async () => { await call('POST', `${base}/read`, { ids: 'all' }); await q.reload(); }} />
      ) : null}
      {q.data && q.data.items.length === 0 ? <Empty title="Bildirim yok" body="Atama, yaklaşan termin, gecikme ve doğrulama istekleri burada görünür." /> : null}
      {(q.data?.items ?? []).map(n => (
        <Tap key={n.id} testID={`note-${n.kind}`} onPress={() => void open(n)}
          style={{ flexDirection: 'row', gap: 12, borderWidth: 1, borderColor: n.read_at ? C.bd : tint.white(0.16), backgroundColor: n.read_at ? C.bg : C.card, borderRadius: 20, padding: 14 }}>
          <View style={{ width: 8, height: 8, borderRadius: 999, marginTop: 6, backgroundColor: n.read_at ? 'transparent' : (TONE[n.kind] ?? C.t2) }} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={type(13.5, n.read_at ? 500 : 700, { color: n.read_at ? C.t2 : C.t1 })}>{n.title}</Text>
            <Text style={type(12, 400, { color: C.t3, lh: 1.45 })}>{n.body}</Text>
            <Text style={type(10.5, 400, { color: C.t3 })}>{fmtDateTime(n.created_at)}</Text>
          </View>
        </Tap>
      ))}
    </Screen>
  );
}
