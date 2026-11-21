import { router } from 'expo-router';
import { personLabel } from '../features/AssignCard';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import type { Assignee } from '../api/types';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { ErrorBox, Loading } from '../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, PrimaryButton } from '../components/ui';
import { ROLE_LABEL } from '../features/labels';
import { useUi } from '../state/app';
import { C, type } from '../theme';

type Preview = {
  assignee: { id: string; name: string }; total: number;
  sites: { siteId: string; siteName: string; eligible: boolean; reason: string | null; taskCount: number; unassigned: number; replacing: { name: string; count: number }[] }[];
  skippedSites: { siteId: string; siteName: string; reason: string | null }[];
  peopleLosingTasks: { name: string; count: number }[];
};
const HORIZONS = [[7, '7 gün'], [14, '14 gün'], [30, '30 gün']] as const;

/**
 * Bulk task assignment. Nothing changes until the preview (which sites, which people lose tasks, which sites are skipped)
 * has been shown and confirmed; the confirmation carries the shown count, so a changed situation asks to look again.
 */
export default function BulkAssign() {
  const { company, siteId, sites, role, call } = useSession();
  const { showToast } = useUi();
  const people = useApi<Assignee[]>(company && siteId ? `/companies/${company.id}/sites/${siteId}/assignees` : null);
  const [pick, setPick] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[] | null>(null); // null = every site I can reach
  const [days, setDays] = useState<number>(14);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [pre, setPre] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (role === 'staff' || !company) {
    return <Screen title="Toplu görev atama" titleEn="Bulk assignment"><Text testID="bulk-denied" style={type(13, 500, { color: C.t2, lh: 1.5 })}>Bu işlem için görev atama yetkisi gerekir.</Text></Screen>;
  }
  const scope = () => ({ userId: pick!, siteIds: chosen ?? undefined, from: new Date(Date.now() - 3600_000).toISOString(), to: new Date(Date.now() + days * 864e5).toISOString(), onlyUnassigned });
  const reset = () => { setPre(null); setError(null); };
  const effective = chosen ?? sites.map(s => s.id);
  const toggle = (id: string) => { reset(); setChosen(effective.includes(id) ? effective.filter(x => x !== id) : [...effective, id]); };

  const show = async () => {
    setBusy(true); setError(null);
    try { setPre(await call<Preview>('POST', `/companies/${company.id}/tasks/bulk-assign/preview`, scope())); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!pre) return;
    setBusy(true); setError(null);
    try {
      const r = await call<{ assigned: number }>('POST', `/companies/${company.id}/tasks/bulk-assign`, { ...scope(), expectedTotal: pre.total });
      showToast(`${r.assigned} görev ${pre.assignee.name} kişisine atandı`, 'ok');
      router.back();
    } catch (e) { setError(errorText(e)); setPre(null); } finally { setBusy(false); }
  };

  return (
    <Screen title="Toplu görev atama" titleEn="Bulk assignment" gap={12}>
      <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>Önce kime, hangi şubelere ve ne kadar süreye atanacağını seç. Değişiklik, etkilenecek şube ve kişiler gösterilip onayladıktan sonra yapılır.</Text>
      <Card radius={22} style={{ padding: 15, gap: 10 }}>
        <Eyebrow>KİME</Eyebrow>
        {people.error ? <ErrorBox message={people.error} onRetry={people.reload} /> : null}
        {!people.data && !people.error ? <Loading label="Ekip yükleniyor…" /> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {(people.data ?? []).map(p => <FilterChip key={p.id} testID={`bulk-person-${p.id}`} label={`${personLabel(p)} · ${ROLE_LABEL[p.role] ?? p.role}`} px={12} active={pick === p.id} onPress={() => { setPick(p.id); reset(); }} />)}
        </View>
        {sites.length > 1 ? (
          <>
            <Eyebrow>ŞUBELER</Eyebrow>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
              {sites.map(s => <FilterChip key={s.id} testID={`bulk-site-${s.id}`} label={s.name} px={12} active={effective.includes(s.id)} onPress={() => toggle(s.id)} />)}
            </View>
          </>
        ) : null}
        <Eyebrow>SÜRE</Eyebrow>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {HORIZONS.map(([d, l]) => <FilterChip key={d} testID={`bulk-days-${d}`} label={`Önümüzdeki ${l}`} px={12} active={days === d} onPress={() => { setDays(d); reset(); }} />)}
          <FilterChip testID="bulk-only-unassigned" label="Yalnız atanmamışlar" px={12} active={onlyUnassigned} onPress={() => { setOnlyUnassigned(v => !v); reset(); }} />
        </View>
        <PrimaryButton testID="bulk-preview" label="Etkilenecekleri göster" disabled={!pick || effective.length === 0 || busy} onPress={show} />
      </Card>
      {error ? <ErrorBox message={error} /> : null}
      {pre ? (
        <Card radius={22} style={{ padding: 15, gap: 9 }}>
          <Eyebrow>ONAYDAN ÖNCE</Eyebrow>
          <Text testID="bulk-total" style={type(15, 700, { lh: 1.35 })}>{pre.total} görev {pre.assignee.name} kişisine atanacak</Text>
          {pre.sites.map(s => (
            <View key={s.siteId} testID={`bulk-preview-site-${s.siteId}`} style={{ gap: 2 }}>
              <Text style={type(13, 600)}>{s.siteName}: {s.eligible ? `${s.taskCount} görev` : 'atlanacak'}</Text>
              {s.eligible && s.unassigned ? <Text style={type(11.5, 400, { color: C.t2 })}>{s.unassigned} görev şu an atanmamış</Text> : null}
              {s.replacing.map(r => <Text key={r.name} style={type(11.5, 400, { color: C.warn })}>{r.name} kişisinden {r.count} görev alınacak</Text>)}
              {!s.eligible && s.reason ? <Text testID={`bulk-skip-${s.siteId}`} style={type(11.5, 500, { color: C.warn, lh: 1.4 })}>{s.reason}</Text> : null}
            </View>
          ))}
          {pre.total > 0
            ? <PrimaryButton testID="bulk-apply" label={`Onayla ve ${pre.total} görevi ata`} disabled={busy} onPress={apply} />
            : <Text style={type(12.5, 500, { color: C.t2 })}>Bu seçimle atanacak açık görev yok.</Text>}
          <GhostButton label="Vazgeç" height={38} size={12} onPress={reset} />
        </Card>
      ) : null}
    </Screen>
  );
}
