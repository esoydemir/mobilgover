import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Field, Loading, StaleNote } from '../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, Pill, PrimaryButton, Tap, shortWhy } from '../components/ui';
import { fmtDateTime } from '../features/dates';
import { HAZARDS } from '../features/ncr/types';
import { useUi } from '../state/app';
import { C, tint, type } from '../theme';
import { RISK } from './ncrs';

type Ref = { id: string; title: string; site: string; risk: string; owner: string | null; detectedAt: string; ageDays: number; what?: string };
type Repeat = { id: string; later: { id: string; title: string; detectedAt: string; status: string; site: string }; earlier: { id: string; title: string; detectedAt: string; closedAt: string | null; status: string };
  daysSinceClosure: number | null; earlierActions: { kind: string; description: string; verified: boolean }[]; reasons: string[];
  decision: { decision: 'linked' | 'unrelated'; reason: string; by: string; at: string } | null };
type Indicator = { key: string; label: string; value: number | null; denominator: number; basis: string; note: string | null };
type Manager = {
  scope: 'manager'; note: string; priority: { key: string; label: string; why: string }[];
  choices: { sites: { id: string; name: string }[]; hazards: string[]; equipment: { id: string; name: string }[]; owners: { id: string; name: string }[] };
  sections: { critical: Ref[]; overdueActions: { id: string; ncrId: string; description: string; ncrTitle: string; site: string; owner: string | null; dueAt: string; lateDays: number }[];
    awaitingVerification: Ref[]; documents: { id: string; title: string; site: string; status: string; expiring: boolean; validUntil: string | null }[]; repeats: Repeat[] };
  indicators: Indicator[];
  comparison: { note: string; sites: { controls: { checkedOk: number; checkedNonconforming: number; notChecked: number; due: number; since: string }; siteId: string; site: string; critical: number; overdueActions: number; awaitingVerification: number; repeats: number; openDaysMedian: number | null; closedCount: number }[] } | null;
};
type Mine = { scope: 'mine'; note: string; sections: { actions: { id: string; ncr_id: string; description: string; due_at: string | null; overdue: boolean; ncr_title: string }[];
  tasks: { id: string; title: string; due_at: string; overdue: boolean }[]; cases: { id: string; title: string; risk_level: string; status: string }[] } };

const PERIODS: [string, number | null][] = [['Tümü', null], ['Son 30 gün', 30], ['Son 90 gün', 90], ['Son 1 yıl', 365]];
const hazardName = (h: string) => HAZARDS.find(x => x[0] === h)?.[1] ?? h;

/** Today for a manager: fixed, explained priority; every number opens the records it counts. */
export default function BoardRoute() {
  const { company } = useSession();
  const [siteId, setSiteId] = useState<string | null>(null);
  const [period, setPeriod] = useState<number | null>(null);
  const [hazard, setHazard] = useState<string | null>(null);
  const [equipmentId, setEquipmentId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>('critical');
  const qs = new URLSearchParams();
  if (siteId) qs.set('siteId', siteId);
  if (period) qs.set('from', new Date(Date.now() - period * 86400_000).toISOString().slice(0, 10) + 'T00:00:00.000Z');
  if (hazard) qs.set('hazard', hazard);
  if (equipmentId) qs.set('equipmentId', equipmentId);
  if (ownerId) qs.set('ownerId', ownerId);
  const q = useApi<Manager | Mine>(company ? `/companies/${company.id}/board?${qs.toString()}` : null);
  const b = q.data;
  if (!b) return <Screen title="Bugün" titleEn="Today">{q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : <Loading />}</Screen>;
  if (b.scope === 'mine') return <MineView b={b} reload={q.reload} loading={q.loading} />;
  const count = (k: string) => (b.sections as Record<string, unknown[]>)[k]!.length;
  const filtered = !!(siteId || period || hazard || equipmentId || ownerId);
  return (
    <Screen title="Bugün" titleEn="Manager board" gap={11} onRefresh={q.reload} refreshing={q.loading}>
      {q.stale ? <StaleNote /> : null}
      {q.error ? <ErrorBox message={`${q.error} Aşağıdaki sayılar seçtiğin filtreye ait değil olabilir.`} onRetry={q.reload} /> : null}
      <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>{b.note}</Text>
      <View style={{ gap: 7 }}>
        {b.choices.sites.length > 1 ? <ChipRow label="Şube" items={[[null, 'Tümü'], ...b.choices.sites.map(s => [s.id, s.name] as [string, string])]} value={siteId} onChange={setSiteId} id="board-site" /> : null}
        <ChipRow label="Tarih" items={PERIODS.map(([l, d]) => [d == null ? null : String(d), l] as [string | null, string])} value={period == null ? null : String(period)} onChange={v => setPeriod(v ? Number(v) : null)} id="board-period" />
        {b.choices.hazards.length > 1 || hazard ? <ChipRow label="Konu" items={[[null, 'Tümü'], ...b.choices.hazards.map(h => [h, hazardName(h)] as [string, string])]} value={hazard} onChange={setHazard} id="board-hazard" /> : null}
        {b.choices.equipment.length || equipmentId ? <ChipRow label="Ekipman" items={[[null, 'Tümü'], ...b.choices.equipment.map(e => [e.id, e.name] as [string, string])]} value={equipmentId} onChange={setEquipmentId} id="board-eq" /> : null}
        {b.choices.owners.length || ownerId ? <ChipRow label="Sorumlu" items={[[null, 'Tümü'], ...b.choices.owners.map(o => [o.id, o.name] as [string, string])]} value={ownerId} onChange={setOwnerId} id="board-owner" /> : null}
        {filtered ? <Text testID="board-clear" onPress={() => { setSiteId(null); setPeriod(null); setHazard(null); setEquipmentId(null); setOwnerId(null); }} style={type(12, 600, { color: C.info })}>Filtreleri temizle</Text> : null}
      </View>

      {b.priority.map((pr, i) => {
        const n = count(pr.key);
        const isOpen = open === pr.key;
        return (
          <Card key={pr.key} radius={22} style={{ paddingVertical: 13, paddingHorizontal: 15, gap: 8 }} border={n && i < 2 ? tint.crit(0.3) : C.bd}>
            <Tap testID={`board-count-${pr.key}`} onPress={() => setOpen(isOpen ? null : pr.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={type(26, 700, { family: 'outfit', color: n ? (i < 2 ? C.crit : C.warn) : C.t3 })}>{n}</Text>
              <View style={{ flex: 1 }}>
                <Text style={type(10, 700, { ls: 0.08, color: C.t3 })}>{i + 1}. ÖNCELİK</Text>
                <Text style={type(13.5, 600)}>{pr.label}</Text>
                <Text style={type(11, 400, { color: C.t3, lh: 1.4 })}>{pr.why}</Text>
              </View>
              <Text style={type(15, 400, { color: C.t3 })}>{isOpen ? '⌄' : '›'}</Text>
            </Tap>
            {isOpen ? <SectionList k={pr.key} b={b} reload={q.reload} /> : null}
          </Card>
        );
      })}

      <Card radius={22} style={{ gap: 9 }}>
        <Eyebrow>GÖSTERGELER · İLK SÜRÜM</Eyebrow>
        {b.indicators.map(ind => (
          <View key={ind.key} testID={`board-ind-${ind.key}`} style={{ gap: 2, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 7 }}>
            <Text style={type(12.5, 600)}>{ind.label}</Text>
            <Text style={type(16, 700, { color: ind.value == null ? C.t3 : C.t1 })}>
              {ind.value == null ? 'veri yok' : ind.key === 'effectiveActions' ? `${ind.value} / ${ind.denominator}` : `${ind.value} gün`}
              <Text style={type(11, 400, { color: C.t3 })}>{ind.key === 'effectiveActions' ? '' : `  ·  ${ind.denominator} kayıt üzerinden`}</Text>
            </Text>
            <Text style={type(11, 400, { color: C.t3, lh: 1.4 })}>{ind.basis}</Text>
            {ind.note ? <Text style={type(11, 600, { color: C.warn })}>{ind.note}</Text> : null}
          </View>
        ))}
        <Text style={type(11, 400, { color: C.t3 })}>{period ? `Tarih aralığı: son ${period} gün.` : 'Tarih aralığı: bütün kayıtlar.'} Göstergeler puan ya da ceza değildir.</Text>
      </Card>

      {b.comparison ? (
        <Card radius={22} style={{ gap: 8 }}>
          <Eyebrow>ŞUBELER YAN YANA</Eyebrow>
          {b.comparison.sites.map(s => (
            <Tap key={s.siteId} testID={`board-cmp-${s.siteId}`} onPress={() => setSiteId(s.siteId)} style={{ borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 7, gap: 2 }}>
              <Text style={type(13, 600)}>{s.site} ›</Text>
              <Text style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>Kritik/yüksek {s.critical} · geciken aksiyon {s.overdueActions} · doğrulama bekleyen {s.awaitingVerification} · tekrar adayı {s.repeats}
                {' · '}açık kalma medyanı {s.openDaysMedian == null ? 'veri yok' : `${s.openDaysMedian} gün (${s.closedCount} kayıt)`}</Text>
              <Text testID={`board-controls-${s.siteId}`} style={type(11.5, 600, { color: s.controls.notChecked ? C.warn : C.t2, lh: 1.45 })}>
                {s.controls.due === 0 ? 'Bu dönemde zamanı gelen kontrol yok.' : `Kontrol (zamanı gelen ${s.controls.due}): ${s.controls.checkedOk} yapıldı ve uygun · ${s.controls.checkedNonconforming} yapıldı, uygunsuz · ${s.controls.notChecked} henüz yapılmadı`}
              </Text>
            </Tap>
          ))}
          <Text style={type(11, 400, { color: C.t3, lh: 1.4 })}>{b.comparison.note}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

function ChipRow({ label, items, value, onChange, id }: { label: string; items: [string | null, string][]; value: string | null; onChange: (v: string | null) => void; id: string }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <Text style={type(11, 700, { ls: 0.06, color: C.t3 })}>{label.toLocaleUpperCase('tr')}</Text>
      {items.map(([v, l]) => <FilterChip key={v ?? 'all'} testID={`${id}-${v ?? 'all'}`} label={l} px={11} active={value === v} onPress={() => onChange(v)} />)}
    </View>
  );
}

function SectionList({ k, b, reload }: { k: string; b: Manager; reload: () => void }) {
  const s = b.sections;
  const empty = <Text style={type(12, 400, { color: C.t3 })}>Bu filtrelerle kayıt yok.</Text>;
  const row = (key: string, title: string, sub: string, go: () => void, pill?: [string, string, string]) => (
    <Tap key={key} testID={`board-item-${key}`} onPress={go} style={{ borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 7, gap: 2 }}>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        {pill ? <Pill label={pill[0]} fg={pill[1]} bg={pill[2]} /> : null}
        <Text style={[type(13, 600, { lh: 1.35 }), { flex: 1 }]} numberOfLines={2}>{title}</Text>
      </View>
      <Text style={type(11, 400, { color: C.t3 })}>{sub}</Text>
    </Tap>
  );
  if (k === 'critical') return s.critical.length ? <>{s.critical.map(n => row(n.id, n.title, `${n.site} · ${n.owner ?? 'sorumlu yok'} · ${n.ageDays} gündür açık`, () => router.push(`/ncr/${n.id}`), RISK[n.risk] as [string, string, string]))}</> : empty;
  if (k === 'overdueActions') return s.overdueActions.length ? <>{s.overdueActions.map(a => row(a.id, a.description, `${a.ncrTitle} · ${a.site} · ${a.owner ?? '—'} · ${a.lateDays} gün gecikti`, () => router.push(`/ncr/${a.ncrId}`)))}</> : empty;
  if (k === 'awaitingVerification') return s.awaitingVerification.length ? <>{s.awaitingVerification.map(n => row(n.id, n.title, `${n.what} · ${n.site}`, () => router.push(`/ncr/${n.id}`)))}</> : empty;
  if (k === 'documents') return s.documents.length ? <>{s.documents.map(d => row(d.id, d.title, `${d.site} · ${d.status === 'expired' ? 'SÜRESİ DOLDU' : 'süresi yaklaşıyor'}${d.validUntil ? ` · ${new Date(d.validUntil).toLocaleDateString('tr-TR')}` : ''}`, () => router.push(`/documents/${d.id}`)))}</> : empty;
  return s.repeats.length ? <>{s.repeats.map(r => <RepeatRow key={r.id} r={r} reload={reload} />)}</> : empty;
}

/** A repeat candidate: why it is suggested, what was done before; link or mark unrelated with a reason. */
function RepeatRow({ r, reload }: { r: Repeat; reload: () => void }) {
  const { company, call } = useSession();
  const { showToast } = useUi();
  const [mode, setMode] = useState<'linked' | 'unrelated' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <View testID={`board-repeat-${r.later.id}`} style={{ borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 8, gap: 5 }}>
      <Tap onPress={() => router.push(`/ncr/${r.later.id}`)}><Text style={type(13, 600, { lh: 1.35 })}>{r.later.title} ›</Text></Tap>
      <Text style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>Önceki: <Text onPress={() => router.push(`/ncr/${r.earlier.id}`)} style={{ color: C.info }}>{r.earlier.title}</Text> · {fmtDateTime(r.earlier.detectedAt)}
        {r.daysSinceClosure != null ? ` · kapanıştan ${r.daysSinceClosure} gün sonra yeniden görüldü` : ' · önceki kayıt henüz kapanmadı'}</Text>
      <Text style={type(11.5, 500, { color: C.warn, lh: 1.45 })}>Neden önerildi: {r.reasons.join(', ')}</Text>
      {r.earlierActions.length ? <Text style={type(11, 400, { color: C.t3, lh: 1.45 })}>Önceki müdahaleler: {r.earlierActions.map(a => `${a.description}${a.verified ? ' (doğrulandı)' : ''}`).join(' · ')}</Text> : null}
      {r.decision ? <Text style={type(11.5, 600, { color: C.lime })}>İLİŞKİLENDİRİLDİ · {r.decision.by}: {r.decision.reason}</Text> : (
        mode ? (
          <View style={{ gap: 6 }}>
            <Field label="Gerekçe" testID={`board-relate-reason-${r.later.id}`} value={reason} onChangeText={setReason} multiline />
            {error ? <ErrorBox message={error} /> : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <PrimaryButton testID={`board-relate-save-${r.later.id}`} label={mode === 'linked' ? 'İlişkilendir' : 'İlgisiz işaretle'} glow={false} height={36} size={12} style={{ flex: 1 }} disabled={reason.trim().length < 10} why={shortWhy(reason, 10, 'Gerekçe')}
                onPress={async () => { setError(null); try { await call('POST', `/companies/${company!.id}/nonconformities/${r.later.id}/relations`, { relatedId: r.earlier.id, decision: mode, reason: reason.trim() });
                  showToast(mode === 'linked' ? 'İlişkilendirildi' : 'İlgisiz işaretlendi', 'Kayıtlar birleştirilmedi; geçmiş değişmedi.'); setMode(null); setReason(''); reload(); } catch (e) { setError(errorText(e)); } }} />
              <GhostButton label="Vazgeç" height={36} size={12} onPress={() => setMode(null)} />
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <GhostButton testID={`board-link-${r.later.id}`} label="Aynı sorun · ilişkilendir" height={34} size={11.5} onPress={() => setMode('linked')} />
            <GhostButton testID={`board-unrelated-${r.later.id}`} label="İlgisiz" height={34} size={11.5} onPress={() => setMode('unrelated')} />
          </View>
        )
      )}
    </View>
  );
}

function MineView({ b, reload, loading }: { b: Mine; reload: () => void; loading: boolean }) {
  const s = b.sections;
  return (
    <Screen title="Bana atananlar" titleEn="My work" onRefresh={reload} refreshing={loading}>
      <Text style={type(11.5, 400, { color: C.t3 })}>{b.note}</Text>
      {!s.actions.length && !s.tasks.length && !s.cases.length ? <Empty title="Sana atanmış açık iş yok" /> : null}
      {s.cases.length ? <Card style={{ gap: 6 }}><Eyebrow>SORUMLUSU OLDUĞUN KAYITLAR</Eyebrow>{s.cases.map(c => <Tap key={c.id} onPress={() => router.push(`/ncr/${c.id}`)}><Text style={type(13, 600)}>{c.title} ›</Text></Tap>)}</Card> : null}
      {s.actions.length ? <Card style={{ gap: 6 }}><Eyebrow>AÇIK AKSİYONLARIN</Eyebrow>{s.actions.map(a => <Tap key={a.id} testID={`mine-action-${a.id}`} onPress={() => router.push(`/ncr/${a.ncr_id}`)}>
        <Text style={type(13, 600)}>{a.description} ›</Text><Text style={type(11, 400, { color: a.overdue ? C.crit : C.t3 })}>{a.ncr_title}{a.due_at ? ` · termin ${fmtDateTime(a.due_at)}${a.overdue ? ' · GECİKTİ' : ''}` : ''}</Text></Tap>)}</Card> : null}
      {s.tasks.length ? <Card style={{ gap: 6 }}><Eyebrow>BUGÜNKÜ VE GECİKEN KONTROLLERİN</Eyebrow>{s.tasks.map(t => <Tap key={t.id} onPress={() => router.push(`/task/${t.id}`)}>
        <Text style={type(13, 600)}>{t.title} ›</Text><Text style={type(11, 400, { color: t.overdue ? C.crit : C.t3 })}>{fmtDateTime(t.due_at)}{t.overdue ? ' · GECİKTİ' : ''}</Text></Tap>)}</Card> : null}
    </Screen>
  );
}
