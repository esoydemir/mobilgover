import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Loading, StaleNote } from '../components/states';
import { Card, Chevron, Eyebrow, FilterChip, GhostButton, Pill, PrimaryButton, Tap } from '../components/ui';
import { fmtDateTime } from '../features/dates';
import { C, tint, type } from '../theme';

type Ncr = { id: string; site_id?: string | null; title: string; risk_level: string; depth: string; status: string; detected_at: string; due_at: string | null;
  owner_id: string | null; owner_name: string | null; overdue: boolean; source: 'task' | 'manual'; iteration: number; reopened_count: number };
type Queue = { nonconformities: { id: string; title: string; owner_name: string; due_at: string | null }[];
  actions: { id: string; ncr_id: string; description: string; ncr_title: string; owner_name: string; due_at: string | null }[];
  tasks: { id: string; title: string; owner_name: string; due_at: string }[] };

export const RISK: Record<string, [string, string, string]> = {
  low: ['DÜŞÜK', C.info, tint.info(0.14)], medium: ['ORTA', C.warn, tint.warn(0.14)],
  high: ['YÜKSEK', C.crit, tint.crit(0.14)], critical: ['KRİTİK', C.crit, tint.crit(0.2)],
};

export default function NcrsRoute() {
  const { company, role, me } = useSession();
  const [status, setStatus] = useState<'open' | 'closed' | 'mine'>('open');
  const q = useApi<Ncr[]>(company ? `/companies/${company.id}/nonconformities?status=${status === 'closed' ? 'closed' : 'open'}` : null);
  const manager = role === 'owner' || role === 'hq_manager' || role === 'site_manager';
  const queue = useApi<Queue>(company && manager ? `/companies/${company.id}/reassignment-queue` : null);
  const rows = (q.data ?? []).filter(n => status !== 'mine' || n.owner_id === me?.userId);
  const waiting = queue.data ? queue.data.nonconformities.length + queue.data.actions.length + queue.data.tasks.length : 0;
  return (
    <Screen title="Uygunsuzluklar" titleEn="Nonconformities" gap={11} onRefresh={() => { void q.reload(); void queue.reload(); }} refreshing={q.loading}>
      <PrimaryButton testID="ncr-new" label="Sorun bildir · yeni uygunsuzluk" height={46} size={13.5} glow={false} onPress={() => router.push('/ncr/new')} />
      {waiting > 0 ? <ReassignCard queue={queue.data!} /> : null}
      <View style={{ flexDirection: 'row', gap: 7 }}>
        <FilterChip label="Açık" active={status === 'open'} onPress={() => setStatus('open')} />
        <FilterChip label="Bana atanan" active={status === 'mine'} onPress={() => setStatus('mine')} />
        <FilterChip label="Kapalı" active={status === 'closed'} onPress={() => setStatus('closed')} />
      </View>
      {q.stale ? <StaleNote /> : null}
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data && q.loading ? <Loading /> : null}
      {q.data && rows.length === 0 ? <Empty title={status === 'closed' ? 'Kapalı kayıt yok' : status === 'mine' ? 'Sana atanan açık kayıt yok' : 'Açık uygunsuzluk yok'}
        body={role === 'staff' && status !== 'closed' ? 'Yalnızca sana atanan ya da aksiyonu sende olan kayıtlar görünür.' : undefined} /> : null}
      {rows.map(n => (
        <Tap key={n.id} testID={`ncr-row-${n.id}`} onPress={() => router.push(`/ncr/${n.id}`)} style={{ borderWidth: 1, borderColor: n.overdue ? tint.crit(0.35) : n.risk_level === 'high' || n.risk_level === 'critical' ? tint.crit(0.25) : C.bd, borderRadius: 22, backgroundColor: C.card, padding: 15, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Pill label={RISK[n.risk_level]![0]} fg={RISK[n.risk_level]![1]} bg={RISK[n.risk_level]![2]} />
            {n.status === 'awaiting_verification' ? <Pill label="DOĞRULAMA BEKLİYOR" fg={C.lime} bg={tint.lime(0.12)} /> : null}
            {n.overdue ? <Pill label="GECİKMİŞ" fg={C.crit} bg={tint.crit(0.14)} /> : null}
            <Text style={type(11, 500, { color: C.t3 })}>{n.depth === 'capa' ? 'Tam CAPA' : 'Düzeltme'}{n.source === 'manual' ? ' · elle' : ''}{n.iteration > 1 ? ` · ${n.iteration}. tur` : ''}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Text style={[type(14, 600), { flex: 1 }]}>{n.title}</Text>
            <Chevron />
          </View>
          <Text style={type(11.5, 400, { color: n.overdue ? C.crit : C.t3 })}>
            {(company?.sites.length ?? 0) > 1 && n.site_id ? `${company!.sites.find(s => s.id === n.site_id)?.name ?? 'Şube'} · ` : ''}{n.owner_name ?? 'Sorumlu yok'}{n.due_at && n.status !== 'closed' ? ` · termin ${fmtDateTime(n.due_at)}` : ''} · tespit {fmtDateTime(n.detected_at)}
          </Text>
        </Tap>
      ))}
    </Screen>
  );
}

/** Open work whose responsible person was suspended or moved: managers reassign it. */
function ReassignCard({ queue }: { queue: Queue }) {
  const [open, setOpen] = useState(false);
  const n = queue.nonconformities.length + queue.actions.length + queue.tasks.length;
  return (
    <Card radius={22} border={tint.warn(0.35)} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
      <Eyebrow color={C.warn}>YENİDEN ATAMA BEKLİYOR · {n}</Eyebrow>
      <Text style={type(12.5, 400, { color: C.t2, lh: 1.45 })}>Sorumlusu pasifleştirilen ya da bu şubeden ayrılan açık işler. Açıp yeni sorumlu seç.</Text>
      {!open ? <GhostButton testID="reassign-open" label="Listeyi göster" height={36} size={12} style={{ alignSelf: 'flex-start' }} onPress={() => setOpen(true)} /> : (
        <View style={{ gap: 6 }}>
          {queue.nonconformities.map(x => <Line key={x.id} label={`Uygunsuzluk · ${x.title}`} who={x.owner_name} onPress={() => router.push(`/ncr/${x.id}`)} />)}
          {queue.actions.map(x => <Line key={x.id} label={`Aksiyon · ${x.description}`} who={x.owner_name} onPress={() => router.push(`/ncr/${x.ncr_id}`)} />)}
          {queue.tasks.slice(0, 20).map(x => <Line key={x.id} label={`Görev · ${x.title} · ${fmtDateTime(x.due_at)}`} who={x.owner_name} onPress={() => router.push(`/task/${x.id}`)} />)}
          {queue.tasks.length > 20 ? <Text style={type(11.5, 400, { color: C.t3 })}>+{queue.tasks.length - 20} görev daha (görev ekranında "sonraki görevleri de" ile toplu atanabilir)</Text> : null}
        </View>
      )}
    </Card>
  );
}

function Line({ label, who, onPress }: { label: string; who: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 6 }}>
      <View style={{ flex: 1 }}>
        <Text style={type(12.5, 600)}>{label}</Text>
        <Text style={type(11, 400, { color: C.crit })}>{who} · pasif</Text>
      </View>
      <Chevron />
    </Tap>
  );
}
