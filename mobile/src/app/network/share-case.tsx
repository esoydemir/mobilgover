import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { Screen } from '../../components/Screen';
import { ErrorBox, Field } from '../../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, PrimaryButton, Tap, shortWhy } from '../../components/ui';
import { CaseBox, USER_CONTENT } from '../../features/network';
import { C, tint, type } from '../../theme';

const FIELDS: [string, string][] = [['hazard', 'Konu (tehlike türü)'], ['risk', 'Risk seviyesi'], ['causes', 'Neden kategorileri'], ['actions', 'Aksiyon türleri ve sayısı'], ['outcome', 'Sonuç (açık / kapandı)']];
const FIELD_LABEL: Record<string, string> = { summary: 'Özet' };
type Preview = { snapshot: any; issues: { field: string; type: string }[]; excluded: string[]; canPermit: boolean; permissionNote: string };

/** A case leaves the business only with an authorised person's permission, after a preview and a personal/commercial data check. */
export default function ShareCaseRoute() {
  const { ncrId } = useLocalSearchParams<{ ncrId: string }>();
  const { company, call } = useSession();
  const [fields, setFields] = useState<string[]>(['hazard', 'risk', 'causes', 'actions', 'outcome']);
  const [summary, setSummary] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [permit, setPermit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/companies/${company?.id}/nonconformities/${ncrId}`;
  const reset = () => { setPreview(null); setPermit(false); };
  const doPreview = async () => {
    setError(null);
    try { setPreview(await call<Preview>('POST', `${base}/share-preview`, { fields, summary })); } catch (e) { setError(errorText(e)); }
  };
  const share = async () => {
    setBusy(true); setError(null);
    try { const r = await call<{ postId: string }>('POST', `${base}/share`, { fields, summary, permit }); router.replace(`/network/post/${r.postId}`); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Screen title="Vakayı paylaş" titleEn="Share a case">
      <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>İşletme kayıtları kendiliğinden paylaşılmaz. Yalnız seçtiğin alanlar, anonim olarak ve önce taslak olarak paylaşılır; yayımlamak ayrı bir adımdır. {USER_CONTENT}</Text>
      <Text style={type(12.5, 600)}>Paylaşılacak alanlar</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {FIELDS.map(([k, l]) => <FilterChip key={k} testID={`case-field-${k}`} label={l} px={11} active={fields.includes(k)}
          onPress={() => { reset(); setFields(fields.includes(k) ? fields.filter(x => x !== k) : [...fields, k]); }} />)}
      </View>
      <Field label="Ne öğrendiniz? (kendi cümlelerinle, en az bir cümle)" testID="case-summary" value={summary} onChangeText={v => { reset(); setSummary(v); }} multiline
        hint="İşletme, şube, kişi adı, telefon, e-posta, adres ya da fiyat yazma; kontrol bunları yakalar." />
      <GhostButton testID="case-preview" label="Önizle ve kontrol et" disabled={summary.trim().length < 5} why={shortWhy(summary, 5, 'Özet')} onPress={doPreview} />
      {preview ? (
        <Card style={{ gap: 10 }}>
          <Eyebrow>ÖNİZLEME · AĞDA TAM OLARAK BU GÖRÜNÜR</Eyebrow>
          <CaseBox s={preview.snapshot} />
          <Text style={type(13, 400, { lh: 1.5 })}>{preview.snapshot.summary}</Text>
          {preview.issues.length ? (
            <View testID="case-issues" style={{ borderWidth: 1, borderColor: tint.crit(0.35), borderRadius: 12, padding: 10, gap: 3 }}>
              <Text style={type(12, 700, { color: C.crit })}>Paylaşılamaz: kişisel ya da ticari bilgi bulundu</Text>
              {preview.issues.map((i, n) => <Text key={n} style={type(12, 500, { color: C.crit })}>• {FIELD_LABEL[i.field] ?? i.field}: {i.type}</Text>)}
            </View>
          ) : <Text testID="case-clean" style={type(12, 600, { color: C.lime })}>Kişisel ya da ticari bilgi bulunmadı.</Text>}
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Hiç paylaşılmayanlar: {preview.excluded.join(', ')}.</Text>
          <Text style={type(11.5, 500, { color: C.warn, lh: 1.45 })}>{preview.permissionNote}</Text>
          {preview.canPermit ? (
            <Tap testID="case-permit" onPress={() => setPermit(x => !x)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: permit ? C.lime : C.t3, backgroundColor: permit ? C.lime : 'transparent' }} />
              <Text style={[type(12.5, 500, { lh: 1.4 }), { flex: 1 }]}>İşletme adına yukarıdaki önizlemenin mesleki ağda paylaşılmasına izin veriyorum.</Text>
            </Tap>
          ) : <Text style={type(12, 600, { color: C.crit })}>Paylaşım iznini yalnız işletme sahibi ya da merkez yöneticisi verebilir.</Text>}
          <PrimaryButton testID="case-share" label={busy ? 'Kaydediliyor…' : 'Taslak olarak paylaş'} glow={false} disabled={busy || !permit || preview.issues.length > 0 || summary.trim().length < 20} onPress={share} />
        </Card>
      ) : null}
      {error ? <ErrorBox message={error} /> : null}
    </Screen>
  );
}
