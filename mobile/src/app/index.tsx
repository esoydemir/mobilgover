import { Redirect, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import type { Indicators, Obligation, TaskRow as Task } from '../api/types';
import { useApi } from '../api/useApi';
import { WarnIcon } from '../components/Icons';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Field, Loading, StaleNote } from '../components/states';
import { Bar, Card, Eyebrow, GhostButton, PrimaryButton, SevPill, Tap, TimelineRow } from '../components/ui';
import { addDays, fmtDate, fmtTime, shortDay, startOfDay } from '../features/dates';
import { KIND_LABEL, useRiskItems } from '../features/risk';
import { bucketTasks, taskWindowPath } from '../features/work';
import { goRoot } from '../state/app';
import { C, lift, tint, type } from '../theme';

export type Gap = { kind: 'equipment' | 'question' | 'conflict'; siteId: string; siteName: string; ruleCode: string; obligation: string; message: string; missing: string[];
  action: { kind: 'add_equipment' | 'answer_question'; label: string; equipmentType?: string; factKey?: string; siteId: string } };
type Ncr = { id: string; site_id: string; title: string; risk_level: string; status: string; due_at: string | null; owner_name: string | null };

const STATUS_TEXT: Record<Indicators['status'], [string, string]> = {
  critical_risk: ['Kritik risk açık', C.crit],
  insufficient_data: ['Veri yetersiz', C.warn],
  attention: ['İzleme gerekiyor', C.warn],
  on_track: ['Yolunda', C.lime],
};

/** An invited outside verifier has no business role: their start page is the verification list. */
export default function HomeRoute() {
  const { company, role } = useSession();
  if (company && !role && company.grants?.some(g => g.scopes.includes('ncr_verify'))) return <Redirect href="/verify-queue" />;
  return <HomeScreen />;
}

/** Command center: today's checks, the one thing that matters most, and the score with its caveats. */
function HomeScreen() {
  const { company, siteId, role, sites, selectSite } = useSession();
  const base = company ? `/companies/${company.id}` : null;
  const today = startOfDay();
  // Same window and same buckets as the task list, so a count here is the length of the list it opens.
  const tasks = useApi<Task[]>(base && siteId ? taskWindowPath(base, siteId) : null);
  const isStaff = role === 'staff';
  const gaps = useApi<Gap[]>(base && !isStaff ? `${base}/gaps${role === 'site_manager' && siteId ? `?siteId=${siteId}` : ''}` : null);
  // Staff get only the cases they own or hold an action in (server-side).
  const ncrs = useApi<Ncr[]>(base ? `${base}/nonconformities?status=open` : null);
  const obligations = useApi<Obligation[]>(base && !isStaff ? `${base}/obligations${role === 'site_manager' && siteId ? `?siteId=${siteId}` : ''}` : null);
  const ind = useApi<Indicators>(base && siteId && !isStaff ? `${base}/indicators?siteId=${siteId}&from=${encodeURIComponent(addDays(today, -30).toISOString())}&to=${encodeURIComponent(addDays(today, 1).toISOString())}` : null);

  const derived = useMemo(() => {
    const b = bucketTasks(tasks.data ?? []);
    const all = b.all;
    const todays = b.today;
    const overdue = b.late;
    const upcoming = b.upcoming.slice(0, 4);
    return { todays, overdue, upcoming, done: todays.filter(t => t.status === 'done').length, counts: { critical: b.critical.length, todo: b.todo.length, service: b.service.length } };
  }, [tasks.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const risk = useRiskItems('site');
  const reload = () => { void gaps.reload(); void tasks.reload(); void ncrs.reload(); void obligations.reload(); void ind.reload(); risk.reload(); };
  const critical = (ncrs.data ?? []).find(n => n.risk_level === 'high' || n.risk_level === 'critical');
  // The one thing that matters most: the first critical risk item (any kind), not only a nonconformity.
  const topRisk = risk.items.find(i => i.sev === 'crit');
  // The profile page answers for the selected branch, so this card counts only its gaps; other branches are named separately.
  const waiting = (obligations.data ?? []).filter(o => o.decision === 'needs_info' || o.decision === 'needs_review');
  const needsInfo = waiting.filter(o => o.siteId === siteId);
  const otherSites = sites.filter(s => s.id !== siteId).map(s => ({ ...s, n: waiting.filter(o => o.siteId === s.id).length })).filter(s => s.n > 0);
  const siteLabel = sites.length > 1 ? sites.find(s => s.id === siteId)?.name : undefined;
  const firstMissing = needsInfo.flatMap(o => o.missingFacts ?? [])[0];
  const total = derived.todays.length;
  const remaining = total - derived.done;

  // One thing first. Managers: a critical open item of this branch; otherwise (and for staff) the oldest late check, then today's open checks, critical first.
  const rank = (t: Task) => (t.severity === 'critical' ? 0 : t.severity === 'major' ? 1 : 2);
  const nextTask = derived.overdue[0] ?? [...derived.todays].filter(t => t.status === 'open').sort((a, b) => rank(a) - rank(b) || +new Date(a.due_at) - +new Date(b.due_at))[0];
  const topNcr = topRisk?.kind === 'ncr' ? (ncrs.data ?? []).find(n => `ncr-${n.id}` === topRisk.key) : undefined;
  const siteOf = (id: string | null | undefined) => sites.find(x => x.id === id)?.name;
  const ready = !!tasks.data && (isStaff ? ncrs.data !== null || !!ncrs.error : risk.ready || !!risk.error);

  return (
    <Screen gap={12} onRefresh={reload} refreshing={tasks.loading}>
      {tasks.stale ? <StaleNote /> : null}
      {tasks.error ? <ErrorBox message={tasks.error} onRetry={reload} /> : null}
      {!tasks.data && tasks.loading ? <Loading /> : null}
      {!isStaff && risk.error ? <ErrorBox message={`Açık kayıtlar okunamadı: ${risk.error}`} onRetry={reload} /> : null}

      {!ready ? (tasks.data ? <Loading label="Öncelikli iş belirleniyor…" /> : null) : !isStaff && topRisk ? (
        <Priority testID="home-top-risk" tone="crit" eyebrow={`ŞİMDİ · KRİTİK ${KIND_LABEL[topRisk.kind]}`} title={topRisk.title}
          lines={[`${siteOf(topRisk.siteId) ? `${siteOf(topRisk.siteId)} · ` : ''}${topRisk.sub}`]}
          who={topRisk.kind === 'ncr' ? (topNcr?.owner_name ? `Sorumlu: ${topNcr.owner_name}` : 'Sorumlu atanmadı') : undefined}>
          <PrimaryButton testID="home-risk-open" label={topRisk.kind === 'ncr' ? 'Vakayı aç' : topRisk.kind === 'doc' ? 'Belgeyi aç' : 'Görevi aç'} onPress={() => router.push(topRisk.href)} height={48} style={{ flex: 1 }} />
          {topRisk.service ? <GhostButton testID="home-risk-service" label="Servis bul" onPress={() => router.push(topRisk.service!)} height={48} /> : null}
        </Priority>
      ) : isStaff && critical ? (
        <Priority testID="home-staff-ncr" tone="crit" eyebrow={`ŞİMDİ · ${critical.risk_level === 'critical' ? 'KRİTİK' : 'YÜKSEK RİSK'} AÇIK UYGUNSUZLUK`} title={critical.title}
          lines={critical.due_at ? [`Termin: ${fmtDate(critical.due_at)} ${fmtTime(critical.due_at)}`] : []}>
          <PrimaryButton testID="home-priority-open" label="Uygunsuzluğu aç" onPress={() => router.push(`/ncr/${critical.id}`)} height={48} style={{ flex: 1 }} />
        </Priority>
      ) : nextTask ? (
        <Priority testID="home-next-task" tone={derived.overdue[0] ? 'warn' : 'lime'} eyebrow={derived.overdue[0] ? 'ŞİMDİ · GECİKMİŞ KONTROL' : 'SIRADAKİ İŞ · BUGÜN'} title={nextTask.title}
          lines={[[nextTask.equipment_name, `son saat ${derived.overdue[0] ? `${fmtDate(nextTask.due_at)} ` : ''}${fmtTime(nextTask.due_at)}`].filter(Boolean).join(' · ')]}
          who={isStaff ? undefined : nextTask.assignee_name ? `Sorumlu: ${nextTask.assignee_name}` : 'Sorumlu atanmadı'}>
          <PrimaryButton testID="home-priority-open" label={isStaff ? 'Görevi yap' : nextTask.assignee_name ? 'Görevi aç' : 'Görevi aç ve ata'} onPress={() => router.push(`/task/${nextTask.id}`)} height={48} style={{ flex: 1 }} />
        </Priority>
      ) : tasks.data ? (
        <Card testID="home-clear" style={{ gap: 4 }}>
          <Text style={type(17, 700)}>{(gaps.data?.length ?? 0) > 0 && !isStaff ? 'Önce eksik bilgiyi tamamla' : 'Şu an bekleyen kontrol yok'}</Text>
          <Text style={type(13, 400, { color: C.t2, lh: 1.45 })}>{(gaps.data?.length ?? 0) > 0 && !isStaff ? 'Aşağıdaki kart tamamlanınca ilgili görevler oluşur.' : isStaff ? 'Sana yeni bir kontrol atandığında burada görünür.' : 'Yeni görev oluştuğunda burada görünür.'}</Text>
        </Card>
      ) : null}

      {isStaff && !critical && (ncrs.data?.length ?? 0) > 0 ? (
        <Tap testID="home-my-ncrs" onPress={() => router.push('/ncrs')} style={{ borderWidth: 1, borderColor: tint.warn(0.45), borderRadius: 18, backgroundColor: C.card, padding: 16 }}>
          <Text style={type(11, 700, { ls: 0.08, color: C.warn })}>SANA ATANAN UYGUNSUZLUK</Text>
          <Text style={[type(16, 600), { marginTop: 6 }]}>{ncrs.data!.length} açık kayıt ›</Text>
          <Text style={[type(13, 400, { color: C.t2 }), { marginTop: 3 }]}>{ncrs.data![0]!.title}</Text>
        </Tap>
      ) : null}

      {!isStaff && gaps.data ? gaps.data.filter(g => g.ruleCode === 'EX-COLD-CHAIN' || g.kind === 'equipment').map(g => <GapCard key={`${g.kind}-${g.siteId}-${g.ruleCode}-${g.missing.join()}`} gap={g} onDone={reload} onOpenSite={selectSite} />) : null}

      {tasks.data ? (
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Tap testID="home-ring" accessibilityLabel="Bugünün görevleri" onPress={() => router.push('/tasks?filter=today')}><Ring done={derived.done} total={total} /></Tap>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={type(11, 600, { ls: 0.08, color: C.t3 })}>BUGÜN · {fmtDate(today.toISOString())} {shortDay(today).toLocaleUpperCase('tr')}</Text>
              <Text testID="home-remaining" style={[type(17, 700, { lh: 1.2 }), { marginTop: 3 }]}>
                {total === 0 ? 'Bugün görev yok' : remaining === 0 ? 'Bugünkü kontroller tamam' : `${remaining} görev kaldı`}
              </Text>
              {derived.overdue.length ? <Tap testID="home-late" hitSlop={8} onPress={() => router.push('/tasks?filter=late')} style={{ justifyContent: 'center' }}><Text style={type(13, 700, { color: C.warn })}>{derived.overdue.length} gecikmiş kontrol · aç ›</Text></Tap>
                : <Text style={[type(13, 400, { color: C.t2 }), { marginTop: 2 }]}>Gecikmiş kontrol yok.</Text>}
            </View>
          </View>
          {!isStaff ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {([['critical', 'Kritik görev'], ['todo', 'Açık görev'], ['service', 'Servis bekleyen']] as const).map(([k, label]) => (
                <Tap key={k} testID={`home-count-${k}`} onPress={() => router.push(`/tasks?filter=${k}`)} style={{ flex: 1, minWidth: 0, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: k === 'critical' && derived.counts.critical ? tint.crit(0.4) : C.bd, backgroundColor: C.chip }}>
                  <Text style={type(17, 700, { color: k === 'critical' && derived.counts.critical ? C.crit : C.t1 })}>{derived.counts[k]}</Text>
                  <Text style={type(11, 600, { color: C.t2, lh: 1.25 })}>{label}</Text>
                </Tap>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 10 }}>
        <Text numberOfLines={1} style={[type(15, 700), { flexShrink: 1 }]}>Bugünün görevleri</Text>
        <Tap testID="home-today-all" onPress={() => goRoot('/tasks?filter=today')} hitSlop={8} style={{ flexShrink: 0, justifyContent: 'center' }}><Text numberOfLines={1} style={type(13, 700, { color: C.lime })}>Tümü ›</Text></Tap>
      </View>
      {tasks.data && derived.todays.length === 0 ? <Empty title="Bugün için görev yok" body={isStaff ? 'Sana atanmış görev yok. Yöneticin bir kontrolü sana atadığında burada görünür.' : 'Görevler, uygulanan yükümlülüklerden oluşturulur. Profil yanıtlarını ve ekipmanları kontrol et.'} /> : null}
      {derived.todays.map(t => <TaskLine key={t.id} t={t} showAssignee={!isStaff} />)}

      {!isStaff && needsInfo.length > 0 && (
        <Tap testID="home-profile-missing" onPress={() => router.push(`/profile${firstMissing ? `?focus=${firstMissing}` : ''}` as never)} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: tint.lime(0.5), borderRadius: 18, backgroundColor: tint.lime(0.06), paddingVertical: 14, paddingHorizontal: 16 }}>
          <Text testID="home-profile-missing-site" style={type(11, 700, { ls: 0.08, color: C.lime })}>PROFİL EKSİK{siteLabel ? ` · ${siteLabel.toLocaleUpperCase('tr')}` : ''}</Text>
          <Text style={[type(15, 600), { marginTop: 6 }]}>{needsInfo.length} yükümlülük için bilgi veya inceleme bekleniyor</Text>
          <Text testID="home-profile-missing-list" style={[type(13, 400, { color: C.t2, lh: 1.45 }), { marginTop: 3 }]}>{needsInfo.slice(0, 3).map(o => o.title).join(' · ')}{needsInfo.length > 3 ? ` · +${needsInfo.length - 3}` : ''}</Text>
          <Text style={[type(12, 400, { color: C.t2 }), { marginTop: 3 }]}>Eksik bilgi "uygulanmaz" sayılmaz; ilk soruyu açmak için dokun.</Text>
        </Tap>
      )}
      {!isStaff && otherSites.length > 0 && (
        <Tap testID="home-profile-missing-other" onPress={() => router.push('/obligations')} style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 14, backgroundColor: C.card, paddingVertical: 12, paddingHorizontal: 16 }}>
          <Text style={type(13, 500, { color: C.t2, lh: 1.45 })}>Diğer şubelerde bilgi veya inceleme bekleyen: {otherSites.map(s => `${s.name} (${s.n})`).join(' · ')} ›</Text>
        </Tap>
      )}

      {derived.upcoming.length > 0 && (
        <Card>
          <Eyebrow>YAKLAŞAN</Eyebrow>
          <View style={{ marginTop: 12 }}>
            {derived.upcoming.map(t => <TimelineRow key={t.id} left={fmtDate(t.due_at)} title={t.title} meta={t.equipment_name ?? fmtTime(t.due_at)} dot={t.severity === 'critical' ? C.crit : t.severity === 'major' ? C.warn : C.info} />)}
          </View>
        </Card>
      )}

      {!isStaff && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Tap testID="home-score" onPress={() => goRoot('/report')} style={{ flex: 1, borderWidth: 1, borderColor: C.bd, borderRadius: 18, backgroundColor: C.card, padding: 14 }}>
            <Eyebrow>UYUM GÖSTERGESİ</Eyebrow>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 8 }}>
              <Text style={type(24, 700)}>{ind.data?.score ?? '—'}</Text>
              <Text style={type(13, 400, { color: C.t3 })}>/100</Text>
            </View>
            <Bar pct={(ind.data?.score ?? 0) / 100} height={5} color={ind.data ? STATUS_TEXT[ind.data.status][1] : C.t3} style={{ marginTop: 8 }} />
            <Text style={[type(12, 600, { color: ind.data ? STATUS_TEXT[ind.data.status][1] : C.t3 }), { marginTop: 7 }]}>{ind.data ? STATUS_TEXT[ind.data.status][0] : 'Hesaplanıyor'}</Text>
          </Tap>
          <Tap testID="home-risk" onPress={() => router.push('/risk')} style={{ flex: 1, borderWidth: 1, borderColor: risk.counts.crit ? tint.crit(0.4) : C.bd, borderRadius: 18, backgroundColor: C.card, padding: 14 }}>
            <Eyebrow>CEZA VE YASAL RİSK</Eyebrow>
            <Text testID="home-risk-count" style={[type(24, 700, { color: risk.counts.crit ? C.crit : C.t1 }), { marginTop: 8 }]}>{risk.ready ? risk.counts.all : '—'}</Text>
            <Text style={[type(12, 400, { color: C.t2, lh: 1.35 }), { marginTop: 7 }]}>
              {risk.ready ? `${risk.counts.all} açık kalem${risk.counts.crit ? ` · ${risk.counts.crit} kritik` : ''} · tutar modellenmedi` : 'Hesaplanıyor'}
            </Text>
          </Tap>
        </View>
      )}
    </Screen>
  );
}

/** The single most important item, with who handles it and the one button that continues it. */
function Priority({ testID, tone, eyebrow: label, title, lines, who, children }: { testID: string; tone: 'crit' | 'warn' | 'lime'; eyebrow: string; title: string; lines: string[]; who?: string; children: React.ReactNode }) {
  const fg = tone === 'crit' ? C.crit : tone === 'warn' ? C.warn : C.lime;
  return (
    <View testID={testID} style={{ borderWidth: 1, borderColor: tint[tone](0.45), borderLeftWidth: 5, borderLeftColor: fg, borderRadius: 18, backgroundColor: C.card, padding: 16, ...lift }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        {tone === 'crit' ? <WarnIcon color={fg} /> : null}
        <Text style={[type(11, 800, { ls: 0.08, color: fg }), { flexShrink: 1 }]}>{label}</Text>
      </View>
      <Text style={[type(19, 700, { ls: -0.015, lh: 1.25 }), { marginTop: 8 }]}>{title}</Text>
      {lines.filter(Boolean).map(l => <Text key={l} style={[type(13.5, 400, { color: C.t2, lh: 1.4 }), { marginTop: 4 }]}>{l}</Text>)}
      {who ? <Text testID="home-priority-who" style={[type(13.5, 700, { color: /atanmadı/.test(who) ? C.warn : C.t1 }), { marginTop: 4 }]}>{who}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>{children}</View>
    </View>
  );
}

function Ring({ done, total }: { done: number; total: number }) {
  const circ = 2 * Math.PI * 25;
  const p = total ? done / total : 0;
  return (
    <View style={{ width: 62, height: 62 }}>
      <Svg width={62} height={62} viewBox="0 0 62 62" style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={31} cy={31} r={25} fill="none" stroke={C.track} strokeWidth={7} />
        {p > 0 ? <Circle cx={31} cy={31} r={25} fill="none" stroke={C.lime} strokeWidth={7} strokeLinecap="round" strokeDasharray={`${circ * p} ${circ}`} /> : null}
      </Svg>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={type(15, 700)}>{done}</Text>
        <Text style={type(11, 600, { color: C.t3 })}>/{total}</Text>
      </View>
    </View>
  );
}

export function TaskLine({ t, showAssignee = false, note }: { t: Task; showAssignee?: boolean; note?: string }) {
  const done = t.status === 'done';
  return (
    <Tap testID={`task-${t.id}`} onPress={() => router.push(`/task/${t.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderColor: C.bd, borderRadius: 16, backgroundColor: C.card, paddingVertical: 14, paddingHorizontal: 14 }}>
      <View style={{ width: 28, height: 28, borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center',
        borderColor: done ? (t.outcome === 'nonconforming' ? C.crit : C.lime) : C.ringIdle, backgroundColor: done ? (t.outcome === 'nonconforming' ? C.crit : C.accent) : 'transparent' }}>
        <Text style={type(12, 800, { color: t.outcome === 'nonconforming' ? C.card : C.ink })}>{done ? (t.outcome === 'nonconforming' ? '!' : '✓') : ''}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={type(14.5, 600, { ls: -0.01 })}>{t.title}</Text>
        <Text style={[type(12, 400, { color: C.t3 }), { marginTop: 3 }]}>
          {[t.equipment_name, fmtTime(t.due_at), done ? (t.outcome === 'nonconforming' ? 'yapıldı · uygunsuz' : 'yapıldı · uygun') : t.status === 'missed' ? 'kaçırıldı' : null,
            showAssignee && !done ? (t.assignee_name ?? 'atanmadı') : null].filter(Boolean).join(' · ')}
        </Text>
        {note ? <Text testID={`task-note-${t.id}`} style={[type(11.5, 500, { color: C.warn, lh: 1.4 }), { marginTop: 4 }]}>{note}</Text> : null}
        {(t.open_services ?? 0) > 0 ? <Text style={[type(11, 600, { color: C.info }), { marginTop: 3 }]}>{`${t.open_services} servis talebi sürüyor`}</Text> : null}
      </View>
      <SevPill sev={t.severity === 'critical' ? 'crit' : t.severity === 'major' ? 'imp' : 'low'} />
    </Tap>
  );
}

/** An obligation that cannot become work yet says what is missing and offers the direct action, so nobody is left on an empty screen. */
function GapCard({ gap, onDone, onOpenSite }: { gap: Gap; onDone: () => void; onOpenSite: (id: string) => void }) {
  const { company, call } = useSession();
  const [open, setOpen] = useState(false); const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const base = company ? `/companies/${company.id}` : null;
  const title = gap.kind === 'equipment' ? 'Soğuk ürün satışı için ekipman bilgisi eksik' : gap.kind === 'conflict' ? 'Yanıtların birbiriyle çelişiyor' : 'Bir bilgi eksik';
  const save = async () => {
    if (!base || !gap.action.equipmentType) return;
    setBusy(true); setErr(null);
    try { await call('POST', `${base}/equipment`, { siteId: gap.siteId, type: gap.action.equipmentType, name: name.trim() }); setOpen(false); setName(''); onDone(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Card testID={`gap-${gap.kind}`} style={{ marginTop: 12, gap: 8 }}>
      <Eyebrow>{title.toUpperCase()} · {gap.siteName}</Eyebrow>
      <Text style={type(13, 400, { color: C.t2, lh: 1.45 })}>{gap.message}</Text>
      {gap.action.kind === 'add_equipment' ? (open ? (
        <View style={{ gap: 6 }}>
          <Field label="Dolabın adı" testID="gap-equipment-name" value={name} onChangeText={setName} />
          <PrimaryButton testID="gap-equipment-save" label="Dolabı kaydet" glow={false} height={42} size={13} disabled={busy || name.trim().length < 2} onPress={save} />
          {err ? <ErrorBox message={err} /> : null}
        </View>
      ) : <PrimaryButton testID="gap-equipment-add" label={gap.action.label} glow={false} height={42} size={13} onPress={() => setOpen(true)} />)
        : <GhostButton testID="gap-answer" label={gap.action.label} height={40} size={12.5} onPress={() => { onOpenSite(gap.siteId); router.push(`/profile${gap.action.factKey ? `?focus=${gap.action.factKey}` : ''}` as never); }} />}
    </Card>
  );
}
