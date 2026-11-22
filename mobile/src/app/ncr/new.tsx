import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, Field } from '../../components/states';
import { Callout, Card, Eyebrow, FilterChip, PrimaryButton, Tap, missingWhy } from '../../components/ui';
import { HAZARDS, SEVERITIES } from '../../features/ncr/types';
import { useUi } from '../../state/app';
import { C, tint, type } from '../../theme';

type Equipment = { id: string; name: string; type: string; active: boolean };

/** Report a problem noticed outside a scheduled check. Risk is sized by the server. */
export default function NewNcrRoute() {
  const { company, siteId, call } = useSession();
  const { showToast } = useUi();
  const eq = useApi<Equipment[]>(company && siteId ? `/companies/${company.id}/sites/${siteId}/equipment` : null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hazard, setHazard] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string | null>(null);
  const [equipmentId, setEquipmentId] = useState<string | null>(null);
  const [containment, setContainment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await call<{ id: string; riskLevel: string; depth: string }>('POST', `/companies/${company!.id}/nonconformities`, {
        siteId, title: title.trim(), description: description.trim(), hazardType: hazard, severity, equipmentId, containment: containment.trim() || null });
      showToast('Uygunsuzluk açıldı', `Risk: ${({ low: 'düşük', medium: 'orta', high: 'yüksek', critical: 'kritik' } as Record<string, string>)[r.riskLevel]} · yöneticilere bildirildi.`);
      router.replace(`/ncr/${r.id}`);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <Screen title="Yeni uygunsuzluk" titleEn="Report a problem">
      <Text style={type(13, 400, { color: C.t2, lh: 1.5 })}>Planlı bir kontrol dışında fark ettiğin sorunu kaydet. Risk düzeyi ve gereken adımlar seçtiğin önem ve tekrar sayısına göre hesaplanır.</Text>
      <Field label="Kısa başlık" testID="ncr-new-title" value={title} onChangeText={setTitle} placeholder="ör. Soğutucu kapısı tam kapanmıyor" />
      <Field label="Ne gördün?" testID="ncr-new-desc" value={description} onChangeText={setDescription} multiline placeholder="Yer, zaman, gördüğün durum" />
      <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 10 }}>
        <Eyebrow>KONU</Eyebrow>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {HAZARDS.map(([k, l]) => <FilterChip key={k} label={l} px={12} active={hazard === k} onPress={() => setHazard(k)} />)}
        </View>
      </Card>
      <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
        <Eyebrow>ÖNEM</Eyebrow>
        {SEVERITIES.map(([k, l, d]) => (
          <Tap key={k} testID={`ncr-new-sev-${k}`} onPress={() => setSeverity(k)} accessibilityRole="radio" accessibilityState={{ selected: severity === k }}
            style={{ borderWidth: 1, borderColor: severity === k ? (k === 'critical' ? tint.crit(0.45) : tint.lime(0.4)) : C.bd, backgroundColor: severity === k ? (k === 'critical' ? tint.crit(0.07) : tint.lime(0.06)) : C.chip, borderRadius: 16, padding: 12 }}>
            <Text style={type(13.5, 600, { color: severity === k ? (k === 'critical' ? C.crit : C.lime) : C.t1 })}>{l}</Text>
            <Text style={type(11.5, 400, { color: C.t3 })}>{d}</Text>
          </Tap>
        ))}
      </Card>
      {eq.data && eq.data.filter(e => e.active).length ? (
        <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 10 }}>
          <Eyebrow>EKİPMAN (VARSA)</Eyebrow>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            <FilterChip label="Yok" px={12} active={equipmentId === null} onPress={() => setEquipmentId(null)} />
            {eq.data.filter(e => e.active).map(e => <FilterChip key={e.id} label={e.name} px={12} active={equipmentId === e.id} onPress={() => setEquipmentId(e.id)} />)}
          </View>
        </Card>
      ) : null}
      <Field label="İlk müdahale (yaptıysan)" testID="ncr-new-containment" value={containment} onChangeText={setContainment} multiline placeholder="ör. Ürünleri yan dolaba taşıdım" />
      {severity === 'critical' ? <Callout tone="warn" body="Kritik bir durumda önce güvenliği sağla ve yöneticine hemen haber ver. Ürünün kullanımı ya da imhası kararını yetkili kişi verir." /> : null}
      {error ? <ErrorBox message={error} /> : null}
      <PrimaryButton testID="ncr-new-save" label={busy ? 'Kaydediliyor…' : 'Uygunsuzluğu aç'} disabled={busy || title.trim().length < 5 || description.trim().length < 5 || !hazard || !severity} why={missingWhy([[title.trim().length < 5, 'başlık (en az 5 karakter)'], [description.trim().length < 5, 'açıklama (en az 5 karakter)'], [!hazard, 'tehlike türü'], [!severity, 'önem derecesi']])} onPress={save} />
    </Screen>
  );
}
