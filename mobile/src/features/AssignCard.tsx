import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import type { Assignee, TaskDetail } from '../api/types';
import { useApi } from '../api/useApi';
import { ErrorBox, Loading } from '../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, PrimaryButton, Tap } from '../components/ui';
import { useUi } from '../state/app';
import { C, tint, type } from '../theme';
import { ROLE_LABEL } from './labels';

/**
 * Who does this check. Managers assign the task; "also later ones" makes the person
 * responsible for this recurring check, so new tasks of it are assigned automatically.
 * Staff only ever see tasks assigned to them.
 */
export function AssignCard({ t, siteId, onChanged }: { t: TaskDetail; siteId: string; onChanged: () => void }) {
  const { company, call, role } = useSession();
  const { showToast } = useUi();
  const [editing, setEditing] = useState(false);
  const people = useApi<Assignee[]>(editing && company ? `/companies/${company.id}/sites/${siteId}/assignees` : null);
  const [pick, setPick] = useState<string | null>(t.assignee?.id ?? null);
  const [series, setSeries] = useState(!!t.seriesResponsible);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await call<{ alsoAssigned: number }>('POST', `/companies/${company!.id}/tasks/${t.id}/assign`, { userId: pick, applyToFuture: series });
      const name = people.data?.find(p => p.id === pick)?.display_name;
      showToast(pick ? `${name ?? 'Kişi'} atandı` : 'Atama kaldırıldı',
        series ? (pick ? `Bu kontrolün sonraki görevleri de ona gider${r.alsoAssigned ? ` (${r.alsoAssigned} açık görev güncellendi)` : ''}.` : 'Bu kontrolün sorumlusu kaldırıldı.') : 'Yalnızca bu görev için.');
      setEditing(false);
      onChanged();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Eyebrow>SORUMLU</Eyebrow>
          <Text testID="task-assignee" style={[type(14, 600, { color: t.assignee ? C.t1 : C.warn }), { marginTop: 6 }]}>
            {t.assignee ? t.assignee.name : 'Atanmadı · personel bu görevi göremez'}
          </Text>
          <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 3 }]}>
            {t.seriesResponsible ? `Bu kontrolün sorumlusu: ${t.seriesResponsible.name} (yeni görevler ona atanır)` : 'Bu kontrol için kalıcı sorumlu yok'}
          </Text>
        </View>
        {t.canAssign && t.status === 'open' && !editing ? <GhostButton testID="assign-open" label={t.assignee ? 'Değiştir' : 'Ata'} height={36} size={12} onPress={() => setEditing(true)} /> : null}
      </View>

      {editing && (
        <View style={{ gap: 10 }}>
          {people.error ? <ErrorBox message={people.error} onRetry={people.reload} /> : null}
          {!people.data && !people.error ? <Loading label="Ekip yükleniyor…" /> : null}
          {people.data && people.data.length === 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>Bu şubede görev verilebilecek etkin kimse yok. Önce ekibe personel davet et.</Text>
              {role === 'owner' || role === 'hq_manager' ? <GhostButton label="Ekip ekranı" height={36} size={12} onPress={() => router.push('/team')} style={{ alignSelf: 'flex-start' }} /> : null}
            </View>
          ) : null}
          {people.data && people.data.length > 0 ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                {people.data.map(p => (
                  <FilterChip key={p.id} label={`${personLabel(p)} · ${ROLE_LABEL[p.role] ?? p.role}`} px={12} active={pick === p.id} onPress={() => setPick(p.id)} />
                ))}
                <FilterChip label="Kimse" px={12} active={pick === null} onPress={() => setPick(null)} />
              </View>
              <Tap testID="assign-series" onPress={() => setSeries(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityRole="checkbox" accessibilityState={{ checked: series }}>
                <View style={{ width: 24, height: 24, borderRadius: 8, borderWidth: 1.5, borderColor: series ? C.lime : C.ringIdle, backgroundColor: series ? C.lime : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={type(12, 800, { color: C.ink })}>{series ? '✓' : ''}</Text>
                </View>
                <Text style={[type(12.5, 500, { lh: 1.4 }), { flex: 1 }]}>Bu kontrolün sonraki görevleri de bu kişiye gitsin</Text>
              </Tap>
              {error ? <ErrorBox message={error} /> : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <PrimaryButton testID="assign-save" label={busy ? 'Kaydediliyor…' : 'Kaydet'} disabled={busy} height={44} size={13} glow={false} style={{ flex: 1 }} onPress={save} />
                <GhostButton label="Vazgeç" height={44} size={13} onPress={() => { setEditing(false); setError(null); }} border={tint.white(0.12)} />
              </View>
            </>
          ) : null}
        </View>
      )}
    </Card>
  );
}

/** B-02: görünen ad yoksa ya da e-postanın baş kısmından türetilmişse (eski hesap), e-postayı da göster ki kişiler ayırt edilsin. */
export function personLabel(p: { display_name: string; email?: string | null }) {
  const local = p.email?.split('@')[0];
  return p.email && (!p.display_name?.trim() || p.display_name === local) ? `${p.display_name || local} (${p.email})` : p.display_name;
}
