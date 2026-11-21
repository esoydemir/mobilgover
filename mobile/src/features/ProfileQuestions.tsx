import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { ErrorBox, Field, Loading } from '../components/states';
import { PrimaryButton, Tap } from '../components/ui';
import { C, tint, type } from '../theme';

type CatalogItem = { key: string; type: 'boolean' | 'number' | 'string' | 'string[]'; label: string; critical: boolean; level: 'company' | 'site' };
type FactRecord = { value: unknown; source: string; verification: string; recordedAt: string };

/** Keys the system fills itself; never asked. */
const SYSTEM_KEYS = ['equipment.types', 'activity.nace_codes']; // faaliyet kodu kayıt adımında (ActivityPicker) sorulur

/**
 * Business profile questions. "Bilmiyorum" is a real answer: nothing is
 * stored, and obligations that depend on it stay "needs information".
 */
export function ProfileQuestions({ onSaved, submitLabel = 'Kaydet' }: { onSaved?: (changed: number) => void; submitLabel?: string }) {
  const { call, company, siteId } = useSession();
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [current, setCurrent] = useState<Record<string, FactRecord>>({});
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!company || !siteId) return;
    (async () => {
      try {
        const [cat, cur] = await Promise.all([
          call<CatalogItem[]>('GET', '/fact-catalog'),
          call<Record<string, FactRecord>>('GET', `/companies/${company.id}/sites/${siteId}/profile`),
        ]);
        setCatalog(cat.filter(c => !SYSTEM_KEYS.includes(c.key)));
        setCurrent(cur);
      } catch (e) { setError(errorText(e)); }
    })();
  }, [company, siteId, call]);

  const changed = useMemo(() => Object.entries(answers).filter(([k, v]) => v !== undefined && JSON.stringify(v) !== JSON.stringify(current[k]?.value)), [answers, current]);

  if (error) return <ErrorBox message={error} />;
  if (!catalog) return <Loading />;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      for (const [key, value] of changed) {
        const def = catalog.find(c => c.key === key)!;
        await call('POST', `/companies/${company!.id}/profile/facts`, {
          siteId: def.level === 'site' ? siteId : null, key, value, source: 'user_declared', verification: 'user_confirmed',
        });
      }
      onSaved?.(changed.length);
      setAnswers({});
      setCurrent(await call('GET', `/companies/${company!.id}/sites/${siteId}/profile`));
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 12 }}>
      {catalog.map(item => {
        const stored = current[item.key];
        const val = item.key in answers ? answers[item.key] : stored?.verification === 'rejected' ? undefined : stored?.value;
        const set = (v: unknown) => setAnswers(a => ({ ...a, [item.key]: v }));
        return (
          <View key={item.key} style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 20, backgroundColor: C.card, padding: 15, gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={[type(14, 600, { ls: -0.01 }), { flex: 1 }]}>{item.label}</Text>
              {item.critical ? <Text style={type(9.5, 700, { ls: 0.08, color: C.warn })}>YÜKÜMLÜLÜK BELİRLER</Text> : null}
            </View>
            {stored ? <Text style={type(11, 400, { color: C.t3 })}>Kayıtlı: {fmt(stored.value)} · {sourceLabel(stored)}</Text> : <Text style={type(11, 400, { color: C.t3 })}>Henüz yanıtlanmadı</Text>}
            {item.type === 'boolean' ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([['Evet', true], ['Hayır', false], ['Bilmiyorum', undefined]] as const).map(([label, v]) => {
                  const on = val === v && (v !== undefined || item.key in answers);
                  return (
                    <Tap key={label} testID={`fact-${item.key}-${label}`} onPress={() => set(v)} accessibilityState={{ selected: on }}
                      style={{ flex: 1, height: 42, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
                        borderColor: on ? tint.lime(0.45) : C.bds, backgroundColor: on ? tint.lime(0.1) : C.chip }}>
                      <Text style={type(12.5, 600, { color: on ? C.lime : C.t2 })}>{label}</Text>
                    </Tap>
                  );
                })}
              </View>
            ) : (
              <Field label="" testID={`fact-${item.key}`} value={val === undefined || val === null ? '' : Array.isArray(val) ? val.join(', ') : String(val)}
                keyboardType={item.type === 'number' ? 'number-pad' : 'default'} placeholder={item.type === 'string[]' ? 'Virgülle ayır' : ''}
                onChangeText={t => set(t.trim() === '' ? undefined : item.type === 'number' ? Number(t.replace(/\D/g, '')) : item.type === 'string[]' ? t.split(',').map(x => x.trim()).filter(Boolean) : t)} />
            )}
          </View>
        );
      })}
      {error ? <ErrorBox message={error} /> : null}
      <PrimaryButton testID="profile-save" label={busy ? 'Kaydediliyor…' : changed.length ? `${submitLabel} (${changed.length})` : submitLabel} disabled={busy} onPress={save} />
      <Text style={[type(11.5, 400, { lh: 1.5, color: C.t3 }), { textAlign: 'center' }]}>Her yanıt geçmişiyle saklanır. Yanıtlar değişince yükümlülükler yeniden hesaplanır; geçmiş kayıtlar değişmez.</Text>
    </View>
  );
}

const fmt = (v: unknown) => (v === true ? 'Evet' : v === false ? 'Hayır' : Array.isArray(v) ? v.join(', ') : String(v));
const sourceLabel = (f: FactRecord) =>
  f.source === 'ocr' && f.verification === 'unverified' ? 'belgeden okundu, onay bekliyor'
  : f.source === 'expert' ? 'uzman doğruladı'
  : f.source === 'system' ? 'sistem' : 'senin beyanın';
