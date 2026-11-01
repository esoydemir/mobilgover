import { useState } from 'react';
import { useUi } from '../state/app';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { ErrorBox, Field } from '../components/states';
import { GhostButton, PrimaryButton, Tap, s } from '../components/ui';
import { C, tint, type } from '../theme';

const TYPES = [
  { type: 'refrigerator', label: 'Soğutucu / buzdolabı' },
  { type: 'freezer', label: 'Dondurucu' },
  { type: 'thermometer', label: 'Termometre (ölçüm cihazı)' },
];

type Equipment = { id: string; type: string; name: string; calibrated_until: string | null; active: boolean };
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const todayKey = () => new Date().toISOString().slice(0, 10);

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
      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
      {list.data && list.data.length === 0 ? <Text style={type(12.5, 400, { color: C.t2 })}>Henüz ekipman yok. Sıcaklık kontrolleri eklediğin her soğutucu için ayrı oluşturulur.</Text> : null}
      {(list.data ?? []).map(e => <EquipmentRow key={e.id} e={e} onSaved={list.reload} />)}
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

/** One unit: rename, renew calibration, take out of use (with reason) or back into use. */
function EquipmentRow({ e, onSaved }: { e: Equipment; onSaved: () => void }) {
  const { call, company } = useSession();
  const { showToast } = useUi();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(e.name);
  const [cal, setCal] = useState(e.calibrated_until ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expired = e.type === 'thermometer' && e.calibrated_until !== null && e.calibrated_until < todayKey();

  const patch = async (body: Record<string, unknown>, msg: string, sub?: (r: any) => string) => {
    setBusy(true); setError(null);
    try {
      const r = await call<any>('PATCH', `/companies/${company!.id}/equipment/${e.id}`, body);
      showToast(msg, sub?.(r));
      setOpen(false); setReason('');
      onSaved();
    } catch (x) { setError(errorText(x)); } finally { setBusy(false); }
  };

  return (
    <View testID={`eq-row-${e.id}`} style={[s.row, { borderRadius: 18, padding: 14, gap: 10, flexDirection: 'column', alignItems: 'stretch', opacity: e.active ? 1 : 0.72 }]}>
      <Tap onPress={() => setOpen(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityLabel={`${e.name} düzenle`}>
        <View style={{ flex: 1 }}>
          <Text style={type(14, 600)}>{e.name}</Text>
          <Text style={[type(11.5, 400, { color: expired ? C.crit : C.t3 }), { marginTop: 2 }]}>
            {TYPES.find(t => t.type === e.type)?.label ?? e.type}
            {e.calibrated_until ? ` · kalibrasyon ${e.calibrated_until}${expired ? ' · SÜRESİ DOLMUŞ' : "'e kadar"}` : e.type === 'thermometer' ? ' · kalibrasyon tarihi yok' : ''}
            {e.active ? '' : ' · kullanım dışı'}
          </Text>
        </View>
        <Text style={type(12, 600, { color: C.t2 })}>{open ? 'Kapat' : 'Düzenle'}</Text>
      </Tap>
      {open && (
        <View style={{ gap: 10 }}>
          <Field label="Adı / yeri" testID={`eq-edit-name-${e.id}`} value={name} onChangeText={setName} />
          {e.type === 'thermometer' ? (
            <Field label="Kalibrasyon geçerlilik tarihi" testID={`eq-edit-cal-${e.id}`} value={cal} onChangeText={setCal} placeholder="2027-06-30"
              hint="Yeni tarih yalnızca bundan sonraki ölçümlere uygulanır; eski ölçümlerin kalibrasyon durumu değişmez." />
          ) : null}
          {error ? <ErrorBox message={error} /> : null}
          <PrimaryButton testID={`eq-edit-save-${e.id}`} label={busy ? 'Kaydediliyor…' : 'Kaydet'} height={44} size={13} glow={false}
            disabled={busy || name.trim().length < 2 || (cal !== '' && !isDate(cal)) || (name.trim() === e.name && (cal || null) === e.calibrated_until)}
            onPress={() => patch({ name: name.trim(), ...(e.type === 'thermometer' ? { calibratedUntil: cal || null } : {}) }, 'Ekipman güncellendi')} />
          {e.active ? (
            <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 10 }}>
              <Text style={type(12, 500, { color: C.t2, lh: 1.45 })}>Kullanımdan kaldırınca bu ekipmanın bugünden sonraki açık kontrolleri iptal edilir. Geçmiş kayıtlar değişmez.</Text>
              <Field label="Gerekçe" testID={`eq-retire-reason-${e.id}`} value={reason} onChangeText={setReason} placeholder="ör. Arızalı, servise gönderildi" />
              <GhostButton testID={`eq-retire-${e.id}`} label="Kullanımdan kaldır" height={40} size={12.5} color={C.crit} border={tint.crit(0.35)}
                disabled={busy || reason.trim().length < 5}
                onPress={() => patch({ active: false, reason: reason.trim() }, 'Kullanımdan kaldırıldı', r => `${r.cancelledTasks} açık kontrol iptal edildi.`)} />
            </View>
          ) : (
            <GhostButton testID={`eq-reactivate-${e.id}`} label="Yeniden kullanıma al" height={40} size={12.5} disabled={busy}
              onPress={() => patch({ active: true }, 'Yeniden kullanımda', r => `${r.createdTasks} kontrol yeniden oluşturuldu.`)} />
          )}
        </View>
      )}
    </View>
  );
}
