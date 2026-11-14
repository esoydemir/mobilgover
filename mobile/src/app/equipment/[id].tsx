import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, Loading } from '../../components/states';
import { Card, Eyebrow, Pill, Tap } from '../../components/ui';
import { fmtDateTime } from '../../features/dates';
import { QrCard } from '../../features/Group4';
import { C, tint, type } from '../../theme';
import { RISK } from '../ncrs';

type History = {
  equipment: { id: string; name: string; type: string; serial: string | null; active: boolean; site_name: string; calibrated_until: string | null };
  cases: { id: string; title: string; status: string; risk_level: string; detected_at: string; closed_at: string | null; actions: { kind: string; description: string; status: string; verification: string }[] }[];
  services: { id: string; title: string; status: string; job_status: string | null; created_at: string }[];
  documents: { id: string; title: string; docType: string }[];
  measurements: { value: string; unit: string; within_limit: boolean; measured_at: string; limit_min: string | null; limit_max: string | null }[];
};
const SVC: Record<string, string> = { open: 'teklif bekleniyor', awarded: 'iş verildi', completed: 'tamamlandı', accepted: 'teslim kabul edildi', disputed: 'revizyon istendi', report_submitted: 'rapor geldi' };
const day = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400_000);

/** One piece of equipment over time. Only what this person may see is listed. */
export default function EquipmentHistoryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { company } = useSession();
  const q = useApi<History>(company ? `/companies/${company.id}/equipment/${id}/history` : null);
  const h = q.data;
  if (!h) return <Screen title="Ekipman" titleEn="Equipment">{q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : <Loading />}</Screen>;
  const closedBefore = h.cases.filter(c => c.closed_at);
  return (
    <Screen title={h.equipment.name} titleEn="Equipment history" onRefresh={q.reload} refreshing={q.loading}>
      <Text style={type(12, 400, { color: C.t3 })}>{h.equipment.site_name}{h.equipment.serial ? ` · seri ${h.equipment.serial}` : ''}{h.equipment.active ? '' : ' · KULLANIM DIŞI'}</Text>
      <QrCard kind="equipment" refId={h.equipment.id} />
      <Card style={{ gap: 8 }}>
        <Eyebrow>UYGUNSUZLUKLAR ({h.cases.length})</Eyebrow>
        {h.cases.length === 0 ? <Text style={type(12, 400, { color: C.t3 })}>Görebildiğin kayıt yok.</Text> : null}
        {h.cases.map((c, i) => {
          const prevClosed = h.cases.slice(i + 1).find(x => x.closed_at);
          return (
            <Tap key={c.id} testID={`eq-case-${c.id}`} onPress={() => router.push(`/ncr/${c.id}`)} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: C.bd, paddingTop: i ? 8 : 0, gap: 3 }}>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Pill label={RISK[c.risk_level]![0]} fg={RISK[c.risk_level]![1]} bg={RISK[c.risk_level]![2]} />
                <Text style={type(10, 700, { ls: 0.08, color: c.status === 'closed' ? C.lime : C.warn })}>{c.status === 'closed' ? 'KAPALI' : 'AÇIK'}</Text>
              </View>
              <Text style={type(13, 600, { lh: 1.4 })}>{c.title}</Text>
              <Text style={type(11.5, 400, { color: C.t3 })}>{fmtDateTime(c.detected_at)}{prevClosed?.closed_at ? ` · önceki kapanıştan ${day(prevClosed.closed_at, c.detected_at)} gün sonra` : ''}</Text>
              {c.actions.length ? <Text style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>Müdahaleler: {c.actions.map(a => a.description).join(' · ')}</Text> : null}
            </Tap>
          );
        })}
        {closedBefore.length ? <Text style={type(11, 400, { color: C.t3 })}>Kapanmış kayıt: {closedBefore.length}. Tekrar adayları yönetici ekranında gerekçesiyle listelenir.</Text> : null}
      </Card>
      {h.services.length ? (
        <Card style={{ gap: 6 }}>
          <Eyebrow>HİZMETLER</Eyebrow>
          {h.services.map(s => <Tap key={s.id} onPress={() => router.push(`/service/${s.id}`)}><Text style={type(12.5, 500)}>{s.title} · {SVC[s.job_status ?? s.status] ?? s.status} ›</Text></Tap>)}
        </Card>
      ) : null}
      <Card style={{ gap: 6 }}>
        <Eyebrow>BELGELER</Eyebrow>
        {h.documents.length ? h.documents.map(d => <Tap key={d.id} testID={`eq-doc-${d.id}`} onPress={() => router.push(`/documents/${d.id}`)}><Text style={type(12.5, 500)}>{d.title} ›</Text></Tap>)
          : <Text style={type(12, 400, { color: C.t3 })}>Görebildiğin belge yok.</Text>}
      </Card>
      {h.measurements.length ? (
        <Card style={{ gap: 4 }}>
          <Eyebrow>SON ÖLÇÜMLER</Eyebrow>
          {h.measurements.map((m, i) => (
            <Text key={i} style={type(12, 400, { color: m.within_limit ? C.t2 : C.crit })}>{fmtDateTime(m.measured_at)} · {Number(m.value)} {m.unit}{m.within_limit ? '' : ` · limit dışı (${m.limit_min ?? '—'}…${m.limit_max ?? '—'})`}</Text>
          ))}
        </Card>
      ) : null}
      <View style={{ height: 1, backgroundColor: tint.white(0.03) }} />
    </Screen>
  );
}
