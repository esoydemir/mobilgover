import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, Field } from '../../components/states';
import { FilterChip, PrimaryButton, missingWhy } from '../../components/ui';
import { DOC_TYPE } from '../../features/documents';
import { C, type } from '../../theme';

type Equipment = { id: string; name: string; type: string };

/** A new document record: what it is and what it belongs to. The file and its dates come as a version. */
export default function NewDocumentRoute() {
  const { company, siteId, role, call } = useSession();
  const eq = useApi<Equipment[]>(company && siteId ? `/companies/${company.id}/sites/${siteId}/equipment` : null);
  const [docType, setDocType] = useState<string>('calibration_certificate');
  const [scope, setScope] = useState<'site' | 'company' | 'equipment'>('site');
  const [equipmentId, setEquipmentId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [issuer, setIssuer] = useState('');
  const [documentNo, setDocumentNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const companyWide = role === 'owner' || role === 'hq_manager';
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await call<{ id: string }>('POST', `/companies/${company!.id}/documents`, {
        docType, title: title.trim(), siteId: scope === 'company' ? null : siteId, equipmentId: scope === 'equipment' ? equipmentId : null,
        issuer: issuer.trim() || null, documentNo: documentNo.trim() || null });
      router.replace(`/documents/${r.id}`);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Screen title="Belge ekle" titleEn="New document">
      <Text style={type(12.5, 600)}>Belge türü</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {Object.entries(DOC_TYPE).map(([k, l]) => <FilterChip key={k} testID={`doc-type-${k}`} label={l} px={12} active={docType === k} onPress={() => setDocType(k)} />)}
      </View>
      <Text style={type(12.5, 600)}>Neye ait?</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        <FilterChip testID="doc-scope-site" label="Bu şube" px={12} active={scope === 'site'} onPress={() => setScope('site')} />
        <FilterChip testID="doc-scope-equipment" label="Ekipman" px={12} active={scope === 'equipment'} onPress={() => setScope('equipment')} />
        {companyWide ? <FilterChip testID="doc-scope-company" label="İşletme geneli" px={12} active={scope === 'company'} onPress={() => setScope('company')} /> : null}
      </View>
      {scope === 'equipment' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {(eq.data ?? []).map(e => <FilterChip key={e.id} testID={`doc-eq-${e.id}`} label={e.name} px={12} active={equipmentId === e.id} onPress={() => setEquipmentId(e.id)} />)}
          {eq.data?.length === 0 ? <Text style={type(12, 400, { color: C.t3 })}>Bu şubede kayıtlı ekipman yok.</Text> : null}
        </View>
      ) : null}
      <Field label="Belge adı" testID="doc-title" value={title} onChangeText={setTitle} placeholder="ör. Soğutucu termometre kalibrasyonu" />
      <Field label="Düzenleyen (isteğe bağlı)" testID="doc-issuer" value={issuer} onChangeText={setIssuer} />
      <Field label="Belge no (isteğe bağlı)" value={documentNo} onChangeText={setDocumentNo} />
      <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Kaydettikten sonra dosyayı ve geçerlilik tarihlerini sürüm olarak eklersin; başka bir yetkili inceleyene kadar belge geçerli sayılmaz.</Text>
      {error ? <ErrorBox message={error} /> : null}
      <PrimaryButton testID="doc-create" label={busy ? 'Kaydediliyor…' : 'Belgeyi oluştur'} disabled={busy || title.trim().length < 3 || (scope === 'equipment' && !equipmentId)} why={missingWhy([[title.trim().length < 3, 'başlık (en az 3 karakter)'], [scope === 'equipment' && !equipmentId, 'ekipman seçimi']])} onPress={submit} />
    </Screen>
  );
}
