import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import type { Obligation, TaskRow } from '../api/types';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Loading, StaleNote } from '../components/states';
import { FilterChip, GhostButton } from '../components/ui';
import { addDays, dayKey } from '../features/dates';
import { FILTER_NOTE, TASK_FILTERS, bucketTasks, criticalReason, isTaskFilter, taskWindowPath, type TaskFilter } from '../features/work';
import { C, tint, type } from '../theme';
import { TaskLine } from './index';


/**
 * This site has no tasks at all in the window: say why. Tasks come from obligations that apply to the site;
 * an obligation waits for profile answers ("bilgi eksik") or for equipment (per-unit checks).
 */
function NoTasksReason({ companyId, siteId }: { companyId: string; siteId: string }) {
  const { call } = useSession();
  const q = useApi<Obligation[]>(`/companies/${companyId}/obligations?siteId=${siteId}`);
  const catalog = useApi<{ key: string; label: string }[]>('/fact-catalog');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!q.data) return null;
  const labelOf = (k: string) => catalog.data?.find(c => c.key === k)?.label ?? k;
  const applies = q.data.filter(o => o.decision === 'applies').length;
  const waiting = q.data.filter(o => o.decision === 'needs_info');
  const missing = [...new Set(waiting.flatMap(o => o.missingFacts))];
  const generate = async () => {
    setBusy(true); setMsg(null);
    try {
      const today = new Date();
      const r = await call<{ created: number }>('POST', `/companies/${companyId}/tasks/generate`, { siteId, fromDay: dayKey(today), toDay: dayKey(addDays(today, 13)) });
      setMsg(r.created ? `${r.created} görev oluşturuldu.` : 'Yeni görev oluşmadı; aşağıdaki neden geçerli.');
      await q.reload();
    } catch (e) { setMsg(errorText(e)); } finally { setBusy(false); }
  };
  const why = q.data.length === 0 ? 'Bu şube için yükümlülükler henüz hesaplanmadı. "Görevleri oluştur" hesaplamayı başlatır.'
    : applies === 0 && waiting.length ? `Görev üretimi ${waiting.length} yükümlülüğün bilgisini bekliyor${missing.length ? ` (eksik: ${missing.map(labelOf).join(' · ')})` : ''}. Bu şubenin profil sorularını yanıtlayınca görevler oluşur.`
    : applies === 0 ? 'Bu şubeye uygulanan bir yükümlülük yok.'
    : 'Uygulanan yükümlülükler var ama bu aralıkta görev çıkmadı; ekipman bekleniyor olabilir (ör. soğutucu eklenince sıcaklık kontrolü oluşur).';
  return (
    <View testID="tasks-no-tasks-reason" style={{ borderWidth: 1, borderColor: tint.warn(0.3), backgroundColor: tint.warn(0.06), borderRadius: 18, padding: 15, gap: 10 }}>
      <Text style={type(12.5, 600, { color: C.warn })}>Bu şubede neden görev yok?</Text>
      <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>{why}</Text>
      {msg ? <Text style={type(12, 600, { color: C.lime })}>{msg}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {waiting.length || q.data.length === 0 ? <GhostButton testID="tasks-reason-profile" label="Şube profilini doldur" height={36} size={12} onPress={() => router.push('/profile')} /> : null}
        {applies > 0 ? <GhostButton testID="tasks-reason-equipment" label="Ekipman" height={36} size={12} onPress={() => router.push('/equipment')} /> : null}
        <GhostButton testID="tasks-reason-generate" label={busy ? 'Oluşturuluyor…' : 'Görevleri oluştur'} height={36} size={12} disabled={busy} onPress={generate} />
      </View>
    </View>
  );
}

export default function TasksRoute() {
  const params = useLocalSearchParams<{ filter?: string }>();
  const { company, siteId, sites, role } = useSession();
  const [filter, setFilter] = useState<TaskFilter>(isTaskFilter(params.filter) ? params.filter : 'today');
  // Opened from a card ("gecikmiş", "bugün"): show exactly that filter.
  useEffect(() => { if (isTaskFilter(params.filter)) setFilter(params.filter); }, [params.filter]);
  const q = useApi<TaskRow[]>(company && siteId ? taskWindowPath(`/companies/${company.id}`, siteId) : null);
  const buckets = useMemo(() => bucketTasks(q.data ?? []), [q.data]);
  const list = buckets[filter];
  const siteName = sites.find(s => s.id === siteId)?.name;

  return (
    <Screen title="Görevler" titleEn="Tasks" gap={11} onRefresh={q.reload} refreshing={q.loading}>
      {company ? <Text testID="tasks-context" style={type(12, 500, { color: C.t3 })}>{company.name}{siteName ? ` · ${siteName}` : ''}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingBottom: 2 }}>
        {TASK_FILTERS.map(([k, label]) => <FilterChip key={k} testID={`tasks-filter-${k}`} label={q.data ? `${label} ${buckets[k].length}` : label} px={13} active={filter === k} onPress={() => setFilter(k)} />)}
      </View>
      <Text testID="tasks-filter-note" style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>{FILTER_NOTE[filter]}</Text>
      {q.stale ? <StaleNote /> : null}
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data && q.loading ? <Loading /> : null}
      {q.data && list.length === 0 ? <Empty title="Bu listede görev yok" body={role === 'staff' ? 'Yalnızca sana atanan görevler görünür.' : undefined} /> : null}
      {q.data && q.data.length === 0 && role !== 'staff' && company && siteId ? <NoTasksReason companyId={company.id} siteId={siteId} /> : null}
      {list.map(t => <TaskLine key={t.id} t={t} showAssignee={role !== 'staff'} note={filter === 'critical' ? (() => { const r = criticalReason(t); return `Neden kritik: ${r.why || '—'}. ${r.exit}`; })() : undefined} />)}
      <Text style={[type(12, 400, { lh: 1.5, color: C.t3 }), { paddingTop: 8, paddingHorizontal: 4 }]}>
        "Yapıldı" ile "uygun" ayrı gösterilir: limit dışı sonuç da kayda geçer ve uygunsuzluk olarak izlenir.
      </Text>
    </Screen>
  );
}
