import { router } from 'expo-router';
import { useEffect } from 'react';
import { useSession } from '../api/session';
import type { TaskRow } from '../api/types';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Loading } from '../components/states';
import { addDays, startOfDay } from '../features/dates';

/** Centre tab: jumps to the open check due soonest. */
export default function NextRoute() {
  const { company, siteId } = useSession();
  const today = startOfDay();
  const q = useApi<TaskRow[]>(company && siteId ? `/companies/${company.id}/tasks?siteId=${siteId}&status=open&from=${encodeURIComponent(addDays(today, -14).toISOString())}&to=${encodeURIComponent(addDays(today, 2).toISOString())}` : null);
  const next = q.data?.[0];
  useEffect(() => { if (next) router.replace(`/task/${next.id}`); }, [next]);
  return (
    <Screen title="Sıradaki kontrol" titleEn="Next check">
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {q.loading || next ? <Loading /> : <Empty title="Açık kontrol yok" body="Bugün ve yarın için bekleyen kontrol kalmadı." />}
    </Screen>
  );
}
