import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../api/session';
import type { TaskRow } from '../api/types';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Loading, StaleNote } from '../components/states';
import { FilterChip } from '../components/ui';
import { addDays, dayKey, startOfDay } from '../features/dates';
import { C, type } from '../theme';
import { TaskLine } from './index';

type Filter = 'today' | 'late' | 'upcoming' | 'done';
const FILTERS: [Filter, string][] = [['today', 'Bugün'], ['late', 'Gecikmiş'], ['upcoming', 'Yaklaşan'], ['done', 'Tamamlanan']];

export default function TasksRoute() {
  const { company, siteId, role } = useSession();
  const [filter, setFilter] = useState<Filter>('today');
  const today = startOfDay();
  const q = useApi<TaskRow[]>(company && siteId ? `/companies/${company.id}/tasks?siteId=${siteId}&from=${encodeURIComponent(addDays(today, -14).toISOString())}&to=${encodeURIComponent(addDays(today, 15).toISOString())}` : null);
  const list = useMemo(() => {
    const now = new Date();
    const k = dayKey(today);
    const rows = (q.data ?? []).filter(t => t.status !== 'cancelled');
    if (filter === 'today') return rows.filter(t => dayKey(new Date(t.due_at)) === k);
    if (filter === 'late') return rows.filter(t => (t.status === 'open' || t.status === 'missed') && new Date(t.due_at) < now);
    if (filter === 'upcoming') return rows.filter(t => t.status === 'open' && new Date(t.due_at) >= addDays(today, 1));
    return rows.filter(t => t.status === 'done').reverse();
  }, [q.data, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen title="Görevler" titleEn="Tasks" gap={11} onRefresh={q.reload} refreshing={q.loading}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingBottom: 2 }}>
        {FILTERS.map(([k, label]) => <FilterChip key={k} label={label} px={13} active={filter === k} onPress={() => setFilter(k)} />)}
      </View>
      {q.stale ? <StaleNote /> : null}
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data && q.loading ? <Loading /> : null}
      {q.data && list.length === 0 ? <Empty title="Bu listede görev yok" body={role === 'staff' ? 'Yalnızca sana atanan görevler görünür.' : undefined} /> : null}
      {list.map(t => <TaskLine key={t.id} t={t} showAssignee={role !== 'staff'} />)}
      <Text style={[type(12, 400, { lh: 1.5, color: C.t3 }), { paddingTop: 8, paddingHorizontal: 4 }]}>
        "Yapıldı" ile "uygun" ayrı gösterilir: limit dışı sonuç da kayda geçer ve uygunsuzluk olarak izlenir.
      </Text>
    </Screen>
  );
}
