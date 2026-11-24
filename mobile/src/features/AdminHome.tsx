import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useApi } from '../api/useApi';
import { ErrorBox, Loading } from '../components/states';
import { Card, FilterChip, GhostButton, Tap } from '../components/ui';
import { C, tint, type } from '../theme';
import { useDesktop } from './desktop';

/** Platform ana sayfası: kararını bekleyen işler. Sayaçlar ve satırlar GET /admin/work'ten gelir; her sayaç, saydığı kayıtları açan süzgeçli bağlantıdır. */
type Item = { id: string; kind: string; title: string; waitingMinutes: number; responsible: string; status: string; action: string; href: string };
type Counter = { key: string; label: string; count: number; href: string; kind?: 'decision' | 'follow_up' };
type Area = { area: 'legislation' | 'market' | 'moderation'; label: string; need: string; state: 'ok' | 'forbidden' | 'error'; message?: string; counters: Counter[]; items: Item[]; total: number };
type Work = { generatedAt: string; yourRoles: string[]; areas: Area[]; missing: { key: string; label: string; why: string }[] };

const AREAS = [['all', 'Tümü'], ['legislation', 'Mevzuat'], ['market', 'Pazar yeri'], ['moderation', 'Moderasyon']] as const;
type AreaKey = (typeof AREAS)[number][0];
/** Süzgeç, ana sayfadan bir listeye gidip dönünce korunur. */
const keep: { area: AreaKey; unowned: boolean } = { area: 'all', unowned: false };

export const waitLabel = (m: number) => (m < 60 ? `${m} dk` : m < 1440 ? `${Math.floor(m / 60)} sa` : `${Math.floor(m / 1440)} gün`);

export function AdminHome() {
  const desktop = useDesktop();
  const params = useLocalSearchParams<{ area?: string; unowned?: string }>();
  const [area, setAreaS] = useState<AreaKey>(AREAS.some(a => a[0] === params.area) ? (params.area as AreaKey) : keep.area);
  const [unowned, setUnownedS] = useState(params.unowned ? params.unowned === '1' : keep.unowned);
  const setArea = (a: AreaKey) => { keep.area = a; setAreaS(a); router.setParams({ area: a }); };
  const setUnowned = (v: boolean) => { keep.unowned = v; setUnownedS(v); router.setParams({ unowned: v ? '1' : '0' }); };
  const q = useApi<Work>('/admin/work');
  useFocusEffect(useCallback(() => { void q.reload(); }, [q.reload])); // eslint-disable-line react-hooks/exhaustive-deps
  const w = q.data;

  const rows = (w?.areas ?? []).filter(a => area === 'all' || a.area === area).flatMap(a => a.items.map(i => ({ ...i, areaLabel: a.label })))
    .filter(i => !unowned || /^Sahipsiz|atanmadı/.test(i.responsible)).sort((a, b) => b.waitingMinutes - a.waitingMinutes);
  const total = (w?.areas ?? []).reduce((n, a) => n + (a.state === 'ok' ? a.total : 0), 0);
  const failed = (w?.areas ?? []).filter(a => a.state === 'error').map(a => a.label);

  return (
    <View testID="admin-home" style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <Text accessibilityRole="header" style={type(20, 700)}>Bugün bekleyen işler</Text>
        <Text testID="home-total" style={type(13, 600, { color: failed.length ? C.warn : total ? C.warn : C.lime })}>
          {w ? (failed.length ? `${total ? `En az ${total} iş kararını bekliyor` : 'Toplam bilinmiyor'} · ${failed.join(', ')} yüklenemedi` : total ? `${total} iş kararını bekliyor` : 'Bekleyen iş yok') : ''}
        </Text>
      </View>
      {q.error && !w ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!w && !q.error ? <Loading /> : null}
      {w ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {w.areas.map(a => <AreaCard key={a.area} a={a} onRetry={q.reload} desktop={desktop} />)}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
            {AREAS.map(([k, l]) => <FilterChip key={k} testID={`home-area-${k}`} label={l} px={12} active={area === k} onPress={() => setArea(k)} />)}
            <FilterChip testID="home-unowned" label="Yalnız sahipsiz / atanmamış" px={12} active={unowned} onPress={() => setUnowned(!unowned)} />
          </View>

          <Card testID="home-table" style={{ padding: 0, gap: 0, overflow: 'hidden' } as never} radius={16}>
            {desktop ? (
              <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.bd }}>
                {COLS.map(([l, wd]) => <Text key={l} style={[type(10, 700, { ls: 0.06, color: C.t3 }), wd ? { width: wd } : { flex: 1 }]}>{l.toUpperCase()}</Text>)}
              </View>
            ) : null}
            {rows.length === 0 ? (
              <Text testID="home-empty" style={{ padding: 16, ...type(12.5, 400, { color: C.t2, lh: 1.5 }) }}>
                {w.areas.every(a => a.state !== 'ok') ? 'Hiçbir alanda yetkin yok; bekleyen iş listelenemez.' : 'Bu süzgeçle bekleyen iş yok. Yetkin olmayan alanlar ve yüklenemeyen alanlar yukarıda ayrıca belirtilir.'}
              </Text>
            ) : null}
            {rows.map(r => (
              <View key={r.kind + r.id} testID={`home-row-${r.id}`} style={{ flexDirection: desktop ? 'row' : 'column', gap: desktop ? 10 : 4, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.bd, alignItems: desktop ? 'center' : 'flex-start' }}>
                <View style={desktop ? { flex: 1, gap: 2 } : { gap: 2 }}>
                  <Text style={type(10, 700, { ls: 0.06, color: C.info })}>{r.areaLabel.toUpperCase()}</Text>
                  <Text numberOfLines={2} style={type(13, 600, { lh: 1.3 })}>{r.title}</Text>
                </View>
                <Text testID={`home-wait-${r.id}`} style={[type(12, 600, { color: r.waitingMinutes >= 1440 ? C.warn : C.t1 }), desktop ? { width: 64 } : null]}>{desktop ? '' : 'Bekleme: '}{waitLabel(r.waitingMinutes)}</Text>
                <Text style={[type(12, 500, { color: /^Sahipsiz|atanmadı/.test(r.responsible) ? C.warn : C.t1 }), desktop ? { width: 170 } : null]}>{desktop ? '' : 'Sorumlu: '}{r.responsible}</Text>
                <Text style={[type(12, 500, { color: C.t2 }), desktop ? { width: 170 } : null]}>{r.status}</Text>
                <GhostButton testID={`home-act-${r.id}`} label={r.action} height={34} size={12} style={desktop ? { width: 190 } : undefined} onPress={() => router.push(r.href as never)} />
              </View>
            ))}
          </Card>
          <Text testID="home-missing" style={type(11, 400, { color: C.t3, lh: 1.5 })}>
            Hesaplanamayan sayaçlar (eksik): {w.missing.map(m => `${m.label} — ${m.why}`).join(' · ')}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const COLS: [string, number | null][] = [['İş', null], ['Bekleme', 64], ['Sorumlu', 170], ['Durum', 170], ['İşlem', 190]];

/** Üç durum ayrı: yetki yok / yüklenemedi / yetkili ama bekleyen yok. */
function AreaCard({ a, onRetry, desktop }: { a: Area; onRetry: () => void; desktop: boolean }) {
  const border = a.state === 'ok' ? C.bd : a.state === 'error' ? tint.crit(0.4) : C.bd;
  return (
    <Card testID={`home-area-card-${a.area}`} style={{ gap: 8, flexGrow: 1, flexBasis: desktop ? 300 : 260, minWidth: 240 }} radius={16} border={border}>
      <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>{a.label.toUpperCase()}</Text>
      {a.state === 'forbidden' ? (
        <View testID={`home-forbidden-${a.area}`} style={{ gap: 3 }}>
          <Text style={type(13, 600, { color: C.t2 })}>Bu alan için yetkin yok</Text>
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Gerekli rol: {a.need}.</Text>
        </View>
      ) : a.state === 'error' ? (
        <View testID={`home-error-${a.area}`} style={{ gap: 6 }}>
          <Text style={type(13, 600, { color: C.crit })}>Yüklenemedi</Text>
          <Text style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>{a.message}. Bu "bekleyen iş yok" demek değildir.</Text>
          <GhostButton label="Yeniden dene" height={34} size={12} onPress={onRetry} />
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          {a.total === 0 ? <Text testID={`home-zero-${a.area}`} style={type(13, 600, { color: C.lime })}>Karar bekleyen iş yok</Text> : null}
          {a.counters.filter(c => a.total > 0 ? c.kind !== 'follow_up' || c.count > 0 : c.kind === 'follow_up' && c.count > 0).map(c => (
            <Tap key={c.key} testID={`home-counter-${c.key}`} onPress={() => router.push(c.href as never)} accessibilityRole="link" accessibilityLabel={`${c.label}: ${c.count}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 }}>
              <Text testID={`home-count-${c.key}`} style={[type(22, 700, { color: c.count ? C.warn : C.t3 }), { width: 44 }]}>{c.count}</Text>
              <Text style={type(12.5, 500, { color: C.info })}>{c.label} ›</Text>
            </Tap>
          ))}
        </View>
      )}
    </Card>
  );
}
