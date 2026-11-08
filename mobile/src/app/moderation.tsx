import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Field, Loading } from '../components/states';
import { Card, FilterChip, PrimaryButton, Tap } from '../components/ui';
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
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const q = useApi<Report[]>(`/network/moderation/reports?status=${status}`);
  return (
    <Screen title="Moderasyon" titleEn="Moderation" gap={10} onRefresh={q.reload} refreshing={q.loading}>
      <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>Mesleki ağ şikâyetleri. Karar gerekçesi zorunludur; karar, aynı içerikteki tüm açık şikâyetleri kapatır ve denetim kaydına yazılır. Kendi şikâyetini karara bağlayamazsın.</Text>
      <View style={{ flexDirection: 'row', gap: 7 }}>
        <FilterChip testID="mod-open" label="Açık" active={status === 'open'} onPress={() => setStatus('open')} />
        <FilterChip testID="mod-closed" label="Karara bağlanan" active={status === 'closed'} onPress={() => setStatus('closed')} />
      </View>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data ? <Loading /> : q.data.length === 0 ? <Empty title={status === 'open' ? 'Açık şikâyet yok' : 'Karar yok'} /> : q.data.map(r => <ReportCard key={r.id} r={r} reload={q.reload} />)}
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
