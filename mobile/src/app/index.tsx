import { router } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useSession } from '../api/session';
import type { Indicators, Obligation, TaskRow as Task } from '../api/types';
import { useApi } from '../api/useApi';
import { GradientFill } from '../components/Gradient';
import { WarnIcon } from '../components/Icons';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Loading, StaleNote } from '../components/states';
import { Bar, Card, Eyebrow, PrimaryButton, SevPill, Tap, TimelineRow } from '../components/ui';
import { addDays, dayKey, fmtDate, fmtTime, shortDay, startOfDay } from '../features/dates';
import { goRoot } from '../state/app';
import { C, tint, type } from '../theme';

type Ncr = { id: string; title: string; risk_level: string; status: string; due_at: string | null };

const STATUS_TEXT: Record<Indicators['status'], [string, string]> = {
  critical_risk: ['Kritik risk açık', C.crit],
  insufficient_data: ['Veri yetersiz', C.warn],
  attention: ['İzleme gerekiyor', C.warn],
  on_track: ['Yolunda', C.lime],
};

/** Command center: today's checks, the one thing that matters most, and the score with its caveats. */
export default function HomeRoute() {
  const { company, siteId, role } = useSession();
  const base = company ? `/companies/${company.id}` : null;
  const today = startOfDay();
  const weekFrom = addDays(today, -6);
  const tasks = useApi<Task[]>(base && siteId ? `${base}/tasks?siteId=${siteId}&from=${encodeURIComponent(weekFrom.toISOString())}&to=${encodeURIComponent(addDays(today, 8).toISOString())}` : null);
  const isStaff = role === 'staff';
  // Staff get only the cases they own or hold an action in (server-side).
  const ncrs = useApi<Ncr[]>(base ? `${base}/nonconformities?status=open` : null);
  const obligations = useApi<Obligation[]>(base && !isStaff ? `${base}/obligations` : null);
  const ind = useApi<Indicators>(base && siteId && !isStaff ? `${base}/indicators?siteId=${siteId}&from=${encodeURIComponent(addDays(today, -30).toISOString())}&to=${encodeURIComponent(addDays(today, 1).toISOString())}` : null);

  const derived = useMemo(() => {
    const all = (tasks.data ?? []).filter(t => t.status !== 'cancelled');
    const todayKey = dayKey(today);
    const todays = all.filter(t => dayKey(new Date(t.due_at)) === todayKey);
    const overdue = all.filter(t => t.status === 'open' && new Date(t.due_at) < new Date());
    const upcoming = all.filter(t => t.status === 'open' && new Date(t.due_at) > addDays(today, 1)).slice(0, 4);
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekFrom, i);
      const k = dayKey(d);
      const dayTasks = all.filter(t => dayKey(new Date(t.due_at)) === k);
      const done = dayTasks.filter(t => t.status === 'done').length;
      return { label: shortDay(d), isToday: k === todayKey, total: dayTasks.length, done };
    });
    return { todays, overdue, upcoming, week, done: todays.filter(t => t.status === 'done').length };
  }, [tasks.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = () => { void tasks.reload(); void ncrs.reload(); void obligations.reload(); void ind.reload(); };
  const critical = (ncrs.data ?? []).find(n => n.risk_level === 'high' || n.risk_level === 'critical');
  const needsInfo = (obligations.data ?? []).filter(o => o.decision === 'needs_info' || o.decision === 'needs_review');
  const total = derived.todays.length;
  const remaining = total - derived.done;

  return (
    <Screen gap={13} onRefresh={reload} refreshing={tasks.loading}>
      {tasks.stale ? <StaleNote /> : null}
      {tasks.error ? <ErrorBox message={tasks.error} onRetry={reload} /> : null}
      {!tasks.data && tasks.loading ? <Loading /> : null}

      {tasks.data && (
        <View style={{ borderWidth: 1, borderColor: tint.lime(0.14), borderRadius: 32, padding: 22, overflow: 'hidden' }}>
          <GradientFill angle={165} stops={[[0, '#171d09'], [0.55, '#0b0d05'], [1, C.page]]}
            radial={{ cx: 0.88, cy: 0, r: 1, stops: [[0, tint.lime(0.16)], [0.42, tint.lime(0.03)], [0.7, tint.lime(0)]] }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            <Ring done={derived.done} total={total} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={type(10.5, 600, { ls: 0.13, color: C.t3 })}>BUGÜN · {fmtDate(today.toISOString())} {shortDay(today).toUpperCase()}</Text>
              <Text testID="home-remaining" style={[type(21, 600, { family: 'outfit', ls: -0.03, lh: 1.15 }), { marginTop: 9 }]}>
                {total === 0 ? 'Bugün görev yok' : remaining === 0 ? 'Bugünkü kontroller tamam' : `${remaining} görev kaldı`}
              </Text>
              <Text style={[type(13, 400, { lh: 1.4, color: C.t2 }), { marginTop: 5 }]}>
                {derived.overdue.length ? `${derived.overdue.length} gecikmiş kontrol var.` : 'Gecikmiş kontrol yok.'}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginTop: 22, paddingTop: 20, borderTopWidth: 1, borderTopColor: C.bd }}>
            {derived.week.map(d => {
              const complete = d.total > 0 && d.done === d.total;
              return (
                <View key={d.label + d.isToday} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 34, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 2,
                    borderColor: complete ? C.lime : d.isToday ? tint.lime(0.55) : tint.white(0.09), backgroundColor: complete ? C.lime : 'transparent' }}>
                    <Text style={type(complete ? 13 : 10, 800, { color: complete ? C.ink : C.t3 })}>{complete ? '✓' : d.total ? `${d.done}/${d.total}` : ''}</Text>
                  </View>
                  <Text style={type(10, 600, { ls: 0.04, color: d.isToday ? C.t1 : C.t3 })}>{d.label}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {!isStaff && (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Tap testID="home-score" onPress={() => goRoot('/report')} style={{ flex: 1, borderWidth: 1, borderColor: C.bd, borderRadius: 26, backgroundColor: C.card, paddingVertical: 17, paddingHorizontal: 18 }}>
            <Eyebrow>UYUM GÖSTERGESİ</Eyebrow>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 12 }}>
              <Text style={type(34, 600, { family: 'outfit', ls: -0.04 })}>{ind.data?.score ?? '—'}</Text>
              <Text style={type(14, 400, { color: C.t3 })}>/100</Text>
            </View>
            <Bar pct={(ind.data?.score ?? 0) / 100} height={5} track={C.track} color={ind.data ? STATUS_TEXT[ind.data.status][1] : C.t3} style={{ marginTop: 14 }} />
            <Text style={[type(11, 600, { color: ind.data ? STATUS_TEXT[ind.data.status][1] : C.t3 }), { marginTop: 9 }]}>{ind.data ? STATUS_TEXT[ind.data.status][0] : 'Hesaplanıyor'}</Text>
          </Tap>
          <Tap onPress={() => router.push('/ncrs')} style={{ flex: 1, borderWidth: 1, borderColor: (ncrs.data?.length ?? 0) ? tint.crit(0.22) : C.bd, borderRadius: 26, backgroundColor: C.card, paddingVertical: 17, paddingHorizontal: 18 }}>
            <Eyebrow>AÇIK UYGUNSUZLUK</Eyebrow>
            <Text style={[type(34, 600, { family: 'outfit', ls: -0.04, color: (ncrs.data?.length ?? 0) ? C.crit : C.t1 }), { marginTop: 12 }]}>{ncrs.data?.length ?? '—'}</Text>
            <Text style={[type(11, 400, { color: C.t3 }), { marginTop: 9 }]}>{critical ? 'Yüksek riskli kayıt var' : 'Yüksek riskli kayıt yok'}</Text>
          </Tap>
        </View>
      )}

      {critical ? (
        <View style={{ borderWidth: 1, borderColor: tint.crit(0.3), borderRadius: 26, overflow: 'hidden', paddingTop: 18, paddingHorizontal: 19, paddingBottom: 16, marginTop: 5 }}>
          <GradientFill angle={160} stops={[[0, '#1a0b0b'], [0.45, '#110d0d'], [1, C.card]]} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <WarnIcon />
            <Text style={type(10, 700, { ls: 0.11, color: C.crit })}>{critical.risk_level === 'critical' ? 'KRİTİK' : 'YÜKSEK RİSK'} · AÇIK UYGUNSUZLUK</Text>
          </View>
          <Text style={[type(16.5, 600, { ls: -0.015, lh: 1.3 }), { marginTop: 9 }]}>{critical.title}</Text>
          {critical.due_at ? <Text style={[type(13, 400, { lh: 1.45, color: C.t2 }), { marginTop: 6 }]}>Termin: {fmtDate(critical.due_at)} {fmtTime(critical.due_at)}</Text> : null}
          <PrimaryButton label="Uygunsuzluğu aç" onPress={() => router.push(`/ncr/${critical.id}`)} height={44} size={13.5} style={{ marginTop: 14 }} />
        </View>
      ) : derived.overdue[0] ? (
        <Tap onPress={() => router.push(`/task/${derived.overdue[0]!.id}`)} style={{ borderWidth: 1, borderColor: tint.warn(0.3), borderRadius: 26, backgroundColor: C.card, padding: 18 }}>
          <Text style={type(10, 700, { ls: 0.11, color: C.warn })}>GECİKMİŞ KONTROL</Text>
          <Text style={[type(16, 600), { marginTop: 8 }]}>{derived.overdue[0].title}{derived.overdue[0].equipment_name ? ` · ${derived.overdue[0].equipment_name}` : ''}</Text>
          <Text style={[type(12.5, 400, { color: C.t2 }), { marginTop: 4 }]}>Son tarih {fmtDate(derived.overdue[0].due_at)} {fmtTime(derived.overdue[0].due_at)}</Text>
        </Tap>
      ) : null}

      {isStaff && !critical && (ncrs.data?.length ?? 0) > 0 ? (
        <Tap testID="home-my-ncrs" onPress={() => router.push('/ncrs')} style={{ borderWidth: 1, borderColor: tint.warn(0.3), borderRadius: 26, backgroundColor: C.card, padding: 18 }}>
          <Text style={type(10, 700, { ls: 0.11, color: C.warn })}>SANA ATANAN UYGUNSUZLUK</Text>
          <Text style={[type(16, 600), { marginTop: 8 }]}>{ncrs.data!.length} açık kayıt</Text>
          <Text style={[type(12.5, 400, { color: C.t2 }), { marginTop: 4 }]}>{ncrs.data![0]!.title}</Text>
        </Tap>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
        <Text style={type(10.5, 600, { ls: 0.12, color: C.t3 })}>BUGÜNÜN GÖREVLERİ</Text>
        <Tap onPress={() => goRoot('/tasks')} hitSlop={8}><Text style={type(11, 600, { ls: 0.08, color: C.t2 })}>TÜMÜ →</Text></Tap>
      </View>
      {tasks.data && derived.todays.length === 0 ? <Empty title="Bugün için görev yok" body={isStaff ? 'Sana atanmış görev yok. Yöneticin bir kontrolü sana atadığında burada görünür.' : 'Görevler, uygulanan yükümlülüklerden oluşturulur. Profil yanıtlarını ve ekipmanları kontrol et.'} /> : null}
      {derived.todays.map(t => <TaskLine key={t.id} t={t} showAssignee={!isStaff} />)}

      {derived.upcoming.length > 0 && (
        <Card style={{ marginTop: 12 }}>
          <Eyebrow>YAKLAŞAN</Eyebrow>
          <View style={{ marginTop: 12 }}>
            {derived.upcoming.map(t => <TimelineRow key={t.id} left={fmtDate(t.due_at)} title={t.title} meta={t.equipment_name ?? fmtTime(t.due_at)} dot={t.severity === 'critical' ? C.crit : t.severity === 'major' ? C.warn : C.info} />)}
          </View>
        </Card>
      )}

      {!isStaff && needsInfo.length > 0 && (
        <Tap onPress={() => router.push('/profile')} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: tint.lime(0.32), borderRadius: 22, backgroundColor: tint.lime(0.04), paddingVertical: 16, paddingHorizontal: 18, marginTop: 4 }}>
          <Text style={type(10, 600, { ls: 0.11, color: C.lime })}>PROFİL EKSİK</Text>
          <Text style={[type(14.5, 600, { ls: -0.01 }), { marginTop: 8 }]}>{needsInfo.length} yükümlülük için bilgi veya inceleme bekleniyor</Text>
          <Text style={[type(12, 400, { color: C.t2 }), { marginTop: 4 }]}>Eksik bilgi "uygulanmaz" sayılmaz; yanıtlayınca netleşir.</Text>
        </Tap>
      )}
    </Screen>
  );
}

function Ring({ done, total }: { done: number; total: number }) {
  const circ = 2 * Math.PI * 41;
  const p = total ? done / total : 0;
  return (
    <View style={{ width: 96, height: 96 }}>
      <Svg width={96} height={96} viewBox="0 0 96 96" style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={48} cy={48} r={41} fill="none" stroke={C.track} strokeWidth={7} />
        <Circle cx={48} cy={48} r={41} fill="none" stroke={C.lime} strokeWidth={7} strokeLinecap="round" strokeDasharray={`${circ * p} ${circ}`} />
      </Svg>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 1 }}>
        <Text style={type(30, 600, { family: 'outfit', ls: -0.04, lh: 1 })}>{done}</Text>
        <Text style={type(13, 600, { family: 'outfit', color: C.t3 })}>/{total}</Text>
      </View>
    </View>
  );
}

export function TaskLine({ t, showAssignee = false }: { t: Task; showAssignee?: boolean }) {
  const done = t.status === 'done';
  return (
    <Tap testID={`task-${t.id}`} onPress={() => router.push(`/task/${t.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderColor: C.bd, borderRadius: 24, backgroundColor: C.card, paddingVertical: 16, paddingHorizontal: 17 }}>
      <View style={{ width: 28, height: 28, borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center',
        borderColor: done ? (t.outcome === 'nonconforming' ? C.crit : C.lime) : C.ringIdle, backgroundColor: done ? (t.outcome === 'nonconforming' ? C.crit : C.lime) : 'transparent' }}>
        <Text style={type(12, 800, { color: C.ink })}>{done ? (t.outcome === 'nonconforming' ? '!' : '✓') : ''}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={type(14.5, 600, { ls: -0.01 })}>{t.title}</Text>
        <Text style={[type(12, 400, { color: C.t3 }), { marginTop: 3 }]}>
          {[t.equipment_name, fmtTime(t.due_at), done ? (t.outcome === 'nonconforming' ? 'yapıldı · uygunsuz' : 'yapıldı · uygun') : t.status === 'missed' ? 'kaçırıldı' : null,
            showAssignee && !done ? (t.assignee_name ?? 'atanmadı') : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <SevPill sev={t.severity === 'critical' ? 'crit' : t.severity === 'major' ? 'imp' : 'low'} />
    </Tap>
  );
}
