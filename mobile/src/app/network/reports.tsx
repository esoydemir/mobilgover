import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, Field, Loading } from '../../components/states';
import { Card, Eyebrow, GhostButton } from '../../components/ui';
import { fmtDateTime } from '../../features/dates';
import { REPORT_REASONS } from '../../features/network';
import { useUi } from '../../state/app';
import { C, type } from '../../theme';

type Mine = { id: string; target_type: string; reason: string; status: string; statusLabel: string; decision_notes: string | null; created_at: string; handled_at: string | null };
type OnMe = { id: string; target_type: string; decision: string; decision_notes: string; handled_at: string; appeal_status: string | null; appeal_notes: string | null };
const REASON = Object.fromEntries(REPORT_REASONS);
const TARGET: Record<string, string> = { post: 'Paylaşım', comment: 'Yorum', profile: 'Profil' };
const APPEAL: Record<string, string> = { open: 'İtirazın inceleniyor (ilk kararı veren moderatör incelemez)', upheld: 'İtirazın reddedildi; karar kaldı', overturned: 'İtirazın kabul edildi; karar kaldırıldı' };

/** Reports I made (with their status) and decisions on my content (which I may appeal once). */
export default function MyReportsRoute() {
  const mine = useApi<Mine[]>('/network/my-reports');
  const onMe = useApi<OnMe[]>('/network/decisions-on-me');
  return (
    <Screen title="Şikâyetler" titleEn="Reports" onRefresh={() => { void mine.reload(); void onMe.reload(); }} refreshing={mine.loading}>
      <Eyebrow>ŞİKÂYETLERİM</Eyebrow>
      {mine.error ? <ErrorBox message={mine.error} /> : !mine.data ? <Loading /> : mine.data.length === 0 ? <Text style={type(12, 400, { color: C.t3 })}>Şikâyetin yok.</Text>
        : mine.data.map(r => (
          <Card key={r.id} style={{ gap: 4 }}>
            <Text testID={`my-report-${r.id}`} style={type(12.5, 700, { color: r.status === 'open' ? C.warn : r.status === 'dismissed' ? C.t2 : C.lime })}>{r.statusLabel}</Text>
            <Text style={type(12, 400, { color: C.t2 })}>{TARGET[r.target_type]} · {REASON[r.reason] ?? r.reason} · {fmtDateTime(r.created_at)}</Text>
            {r.decision_notes ? <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>Moderatör gerekçesi: {r.decision_notes}</Text> : null}
          </Card>
        ))}
      <Eyebrow>İÇERİĞİM HAKKINDAKİ KARARLAR</Eyebrow>
      {onMe.data?.length === 0 ? <Text style={type(12, 400, { color: C.t3 })}>Hakkında karar yok.</Text> : null}
      {(onMe.data ?? []).map(d => <Decision key={d.id} d={d} reload={onMe.reload} />)}
    </Screen>
  );
}

function Decision({ d, reload }: { d: OnMe; reload: () => void }) {
  const { call } = useSession();
  const { showToast } = useUi();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Card style={{ gap: 6 }}>
      <Text style={type(12.5, 700, { color: C.crit })}>{TARGET[d.target_type]} · {d.decision === 'hide' ? 'gizlendi' : 'profil askıya alındı'} · {fmtDateTime(d.handled_at)}</Text>
      <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>Gerekçe: {d.decision_notes}</Text>
      {d.appeal_status ? <Text testID={`appeal-status-${d.id}`} style={type(12, 600, { color: C.warn, lh: 1.45 })}>{APPEAL[d.appeal_status]}{d.appeal_notes ? ` · ${d.appeal_notes}` : ''}</Text> : (
        <View style={{ gap: 6 }}>
          <Field label="İtiraz gerekçen" testID={`appeal-reason-${d.id}`} value={reason} onChangeText={setReason} multiline />
          {error ? <ErrorBox message={error} /> : null}
          <GhostButton testID={`appeal-send-${d.id}`} label="İtiraz et (bir kez)" height={38} size={12} disabled={reason.trim().length < 10}
            onPress={async () => { setError(null); try { await call('POST', `/network/reports/${d.id}/appeal`, { reason: reason.trim() }); showToast('İtiraz gönderildi', 'İlk kararı veren dışında bir moderatör inceler.'); reload(); } catch (e) { setError(errorText(e)); } }} />
        </View>
      )}
    </Card>
  );
}
