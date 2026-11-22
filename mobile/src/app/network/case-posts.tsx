import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { Empty, ErrorBox, Field, Loading } from '../../components/states';
import { Card, GhostButton, PrimaryButton, Tap, shortWhy } from '../../components/ui';
import { fmtDateTime } from '../../features/dates';
import { useUi } from '../../state/app';
import { C, tint, type } from '../../theme';

type Row = { id: string; status: string; body: string; case_ncr_id: string; case_reapproval_needed: boolean; published_at: string | null; withdrawn_at: string | null;
  withdraw_reason: string | null; hidden_at: string | null; author_name: string; ncr_title: string | null };
const STATUS: Record<string, [string, string]> = { draft: ['TASLAK', C.warn], published: ['YAYINDA', C.lime], withdrawn: ['GERİ ÇEKİLDİ', C.crit] };

/** The business's case shares: permit the current text again after a change, or withdraw from the network. */
export default function CasePostsRoute() {
  const { company } = useSession();
  const q = useApi<Row[]>(company ? `/companies/${company.id}/network/case-posts` : null);
  return (
    <Screen title="Vaka paylaşımları" titleEn="Case shares" onRefresh={q.reload} refreshing={q.loading}>
      <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>İzin, önizlenen metne verilir. Metin sonradan değişirse paylaşım ağdan kalkar ve yeniden izin gerekir. Geri çekilen paylaşıma ağdan erişim hemen kapanır; kayıt denetim geçmişinde kalır.</Text>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data ? <Loading /> : q.data.length === 0 ? <Empty title="Vaka paylaşımı yok" /> : q.data.map(r => <Row key={r.id} r={r} reload={q.reload} />)}
    </Screen>
  );
}

function Row({ r, reload }: { r: Row; reload: () => void }) {
  const { company, call } = useSession();
  const { showToast } = useUi();
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'withdraw' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => { setError(null); try { await fn(); showToast(ok); reload(); } catch (e) { setError(errorText(e)); } };
  const [label, color] = STATUS[r.status] ?? [r.status, C.t2];
  return (
    <Card style={{ gap: 7 }} border={r.case_reapproval_needed ? tint.warn(0.4) : C.bd}>
      <Text style={type(10, 700, { ls: 0.08, color })}>{label}{r.case_reapproval_needed ? ' · YENİDEN ONAY BEKLİYOR' : ''}{r.hidden_at ? ' · MODERASYONLA GİZLİ' : ''}</Text>
      <Tap onPress={() => router.push(`/network/post/${r.id}`)}><Text style={type(13, 500, { lh: 1.5 })} numberOfLines={4}>{r.body}</Text></Tap>
      <Text style={type(11, 400, { color: C.t3 })}>{r.author_name}{r.ncr_title ? ` · kayıt: ${r.ncr_title}` : ''}{r.published_at ? ` · yayın ${fmtDateTime(r.published_at)}` : ''}</Text>
      {r.withdraw_reason ? <Text style={type(12, 500, { color: C.crit })}>Geri çekme gerekçesi: {r.withdraw_reason}</Text> : null}
      {error ? <ErrorBox message={error} /> : null}
      {r.case_reapproval_needed && r.status !== 'withdrawn' ? (
        <PrimaryButton testID={`case-reapprove-${r.id}`} label="Bu metnin paylaşılmasına yeniden izin ver" glow={false} height={40} size={12}
          onPress={() => run(() => call('POST', `/companies/${company!.id}/network/case-posts/${r.id}/approve`, { permit: true }), 'Yeniden izin verildi; yazar yayımlayabilir.')} />
      ) : null}
      {r.status !== 'withdrawn' ? (mode === 'withdraw' ? (
        <View style={{ gap: 6 }}>
          <Field label="Geri çekme gerekçesi" testID={`case-withdraw-reason-${r.id}`} value={reason} onChangeText={setReason} />
          <GhostButton testID={`case-withdraw-${r.id}`} label="Ağdan geri çek" color={C.crit} border={tint.crit(0.35)} height={40} size={12} disabled={reason.trim().length < 10} why={shortWhy(reason, 10, 'Gerekçe')}
            onPress={() => run(() => call('POST', `/companies/${company!.id}/network/case-posts/${r.id}/withdraw`, { reason: reason.trim() }), 'Geri çekildi; ağdan erişim kapandı.')} />
        </View>
      ) : <Text testID={`case-withdraw-open-${r.id}`} onPress={() => setMode('withdraw')} style={type(12, 600, { color: C.crit })}>Geri çek</Text>) : null}
    </Card>
  );
}
