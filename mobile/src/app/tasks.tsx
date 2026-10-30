import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { FilterChip, TaskRow } from '../components/ui';
import { TASKS, type Task } from '../data';
import { useApp } from '../state/app';
import { C, type } from '../theme';

const FILTERS: [Task['bucket'], string][] = [['today', 'Bugün'], ['late', 'Gecikmiş'], ['upcoming', 'Yaklaşan']];

export default function TasksRoute() {
  const { done, toggleTask } = useApp();
  const [filter, setFilter] = useState<Task['bucket']>('today');
  return (
    <Screen title="Görevler" titleEn="Tasks" gap={11}>
      <View style={{ flexDirection: 'row', gap: 7, paddingBottom: 2 }}>
        {FILTERS.map(([k, label]) => <FilterChip key={k} label={label} active={filter === k} onPress={() => setFilter(k)} />)}
      </View>
      {TASKS.filter(t => t.bucket === filter).map(t => (
        <TaskRow key={t.id} title={t.title} meta={t.meta} sev={t.sev} done={!!done[t.id]}
          onToggle={() => toggleTask(t.id)} onOpen={() => router.push(`/task/${t.id}`)} />
      ))}
      <Text style={[type(12, 400, { lh: 1.5, color: C.t3 }), { paddingTop: 8, paddingHorizontal: 4 }]}>
        Sıralama son teslim tarihine göre değil; yasal ağırlık, sağlık riski, gecikme süresi ve tekrar geçmişine göre yapılır.
      </Text>
    </Screen>
  );
}
