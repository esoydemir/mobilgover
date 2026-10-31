import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { ErrorBox, Field } from '../components/states';
import { GhostButton, Tap, s } from '../components/ui';
import { C, tint, type } from '../theme';

const TYPES = [
  { type: 'refrigerator', label: 'Soğutucu / buzdolabı' },
  { type: 'freezer', label: 'Dondurucu' },
  { type: 'thermometer', label: 'Termometre (ölçüm cihazı)' },
];

type Equipment = { id: string; type: string; name: string; calibrated_until: string | null };

/** Equipment register. Checks such as cold-chain temperature are created per unit. */
export function EquipmentEditor() {
  const { call, company, siteId } = useSession();
  const list = useApi<Equipment[]>(company && siteId ? `/companies/${company.id}/sites/${siteId}/equipment` : null);
  const [kind, setKind] = useState('refrigerator');
  const [name, setName] = useState('');
  const [calibratedUntil, setCalibratedUntil] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true); setError(null);
    try {
      if (calibratedUntil && !/^\d{4}-\d{2}-\d{2}$/.test(calibratedUntil)) throw new Error('Tarih YYYY-AA-GG biçiminde olmalı.');
      await call('POST', `/companies/${company!.id}/equipment`, { siteId, type: kind, name: name.trim(), calibratedUntil: calibratedUntil || null });
      setName(''); setCalibratedUntil('');
      await list.reload();
    } catch (e) { setError(e instanceof Error && !(e as any).status ? e.message : errorText(e)); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 10 }}>
      {(list.data ?? []).map(e => (
        <View key={e.id} style={[s.row, { borderRadius: 18, padding: 14, gap: 10 }]}>
          <View style={{ flex: 1 }}>
            <Text style={type(14, 600)}>{e.name}</Text>
            <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 2 }]}>
              {TYPES.find(t => t.type === e.type)?.label ?? e.type}{e.calibrated_until ? ` · kalibrasyon ${e.calibrated_until}'e kadar` : ''}
            </Text>
          </View>
        </View>
      ))}
      <View style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 20, padding: 15, gap: 10, backgroundColor: C.card }}>
        <Text style={type(13.5, 600)}>Ekipman ekle</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {TYPES.map(t => (
            <Tap key={t.type} testID={`eq-type-${t.type}`} onPress={() => setKind(t.type)} style={{ height: 34, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center', borderWidth: 1,
              borderColor: kind === t.type ? tint.lime(0.4) : C.bd, backgroundColor: kind === t.type ? tint.lime(0.1) : C.chip }}>
              <Text style={type(12, 600, { color: kind === t.type ? C.lime : C.t2 })}>{t.label}</Text>
            </Tap>
          ))}
        </View>
        <Field label="Adı / yeri" testID="eq-name" value={name} onChangeText={setName} placeholder="ör. Buzdolabı · Mutfak arka" />
        {kind === 'thermometer' && <Field label="Kalibrasyon geçerlilik tarihi" testID="eq-cal" value={calibratedUntil} onChangeText={setCalibratedUntil} placeholder="2027-06-30" hint="Ölçümlerde kalibrasyon durumu bu tarihe göre kaydedilir." />}
        {error ? <ErrorBox message={error} /> : null}
        <GhostButton testID="eq-add" label={busy ? 'Ekleniyor…' : 'Ekle'} disabled={busy || name.trim().length < 2} onPress={add} />
      </View>
    </View>
  );
}
