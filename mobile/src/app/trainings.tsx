import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, ExampleBadge, Loading } from '../components/states';
import { Chevron, FilterChip, Pill, PrimaryButton, Tap } from '../components/ui';
import { fmtDateTime } from '../features/dates';
import { trainingStateLabel, type TrainingRow } from '../features/ncr/parts';
import { VERSION_STATUS } from '../features/training';
import { C, type } from '../theme';

type Course = { id: string; is_example: boolean; exampleNote: string | null; published: { title: string; summary: string; minutes: number | null; questions: number; version: number } | null;
  latest: { status: string; title: string; version: number } | null };

/** Training: my assignments, the content library, and (for managers) who was assigned what. */
export default function TrainingsRoute() {
  const { company, role } = useSession();
  const manager = role === 'owner' || role === 'hq_manager' || role === 'site_manager';
  const [tab, setTab] = useState<'mine' | 'courses' | 'managed'>('mine');
  const base = company ? `/companies/${company.id}/training` : null;
  const mine = useApi<TrainingRow[]>(base && tab === 'mine' ? `${base}/assignments?scope=mine` : null);
  const managed = useApi<TrainingRow[]>(base && tab === 'managed' ? `${base}/assignments?scope=managed` : null);
  const courses = useApi<Course[]>(base && tab === 'courses' ? `${base}/courses` : null);
  const q = tab === 'mine' ? mine : tab === 'managed' ? managed : courses;
  return (
    <Screen title="Eğitimler" titleEn="Training" gap={11} onRefresh={q.reload} refreshing={q.loading}>
      <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
        <FilterChip testID="tr-tab-mine" label="Eğitimlerim" active={tab === 'mine'} onPress={() => setTab('mine')} />
        <FilterChip testID="tr-tab-courses" label="İçerikler" active={tab === 'courses'} onPress={() => setTab('courses')} />
        {manager ? <FilterChip testID="tr-tab-managed" label="Atamalar" active={tab === 'managed'} onPress={() => setTab('managed')} /> : null}
      </View>
      <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Okundu, tamamlandı, sınavı geçti ve sahada etkinliği doğrulandı ayrı durumlardır. Katılım kaydı resmî sertifika değildir.</Text>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data && q.loading ? <Loading /> : null}
      {tab !== 'courses' ? (
        <>
          {(q.data as TrainingRow[] | null)?.length === 0 ? <Empty title={tab === 'mine' ? 'Sana atanmış eğitim yok' : 'Atama yok'} /> : null}
          {((q.data as TrainingRow[] | null) ?? []).map(t => {
            const [label, color] = trainingStateLabel(t.state);
            return (
              <Tap key={t.id} testID={`tr-assignment-${t.id}`} onPress={() => router.push(`/training/a/${t.id}`)} style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 22, backgroundColor: C.card, padding: 15, gap: 7 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text style={type(10, 700, { ls: 0.08, color: color as string })}>{label}</Text>
                  {t.isExample ? <ExampleBadge label="ÖRNEK İÇERİK" /> : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Text style={[type(14, 600), { flex: 1 }]}>{t.title}</Text>
                  <Chevron />
                </View>
                <Text style={type(11.5, 400, { color: C.t3 })}>{tab === 'managed' ? `${t.userName} · ` : ''}{t.reason}{t.dueAt ? ` · termin ${fmtDateTime(t.dueAt)}` : ''}</Text>
              </Tap>
            );
          })}
        </>
      ) : (
        <>
          {manager ? <PrimaryButton testID="tr-new" label="Yeni eğitim içeriği" onPress={() => router.push('/training/edit')} /> : null}
          {(q.data as Course[] | null)?.length === 0 ? <Empty title="İçerik yok" /> : null}
          {((q.data as Course[] | null) ?? []).map(c => {
            const st = VERSION_STATUS[c.published ? 'published' : c.latest?.status ?? 'draft']!;
            return (
              <Tap key={c.id} testID={`tr-course-${c.id}`} onPress={() => router.push(`/training/${c.id}`)} style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 22, backgroundColor: C.card, padding: 15, gap: 7 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Pill label={st[0]} fg={st[1]} bg={st[2]} />
                  {c.latest && c.published && c.latest.status !== 'published' ? <Pill label={`SÜRÜM ${c.latest.version} ${VERSION_STATUS[c.latest.status]![0]}`} fg={C.warn} bg={C.chip} /> : null}
                  {c.is_example ? <ExampleBadge label="ÖRNEK İÇERİK" /> : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Text style={[type(14, 600), { flex: 1 }]}>{c.published?.title ?? c.latest?.title}</Text>
                  <Chevron />
                </View>
                {c.published ? <Text style={type(11.5, 400, { color: C.t3 })}>{c.published.summary}{c.published.minutes ? ` · ${c.published.minutes} dk` : ''}{c.published.questions ? ` · ${c.published.questions} soru` : ''}</Text> : null}
              </Tap>
            );
          })}
        </>
      )}
    </Screen>
  );
}
