import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { Screen } from '../../components/Screen';
import { ErrorBox, Field } from '../../components/states';
import { GhostButton, PrimaryButton } from '../../components/ui';
import { USER_CONTENT } from '../../features/network';
import { C, type } from '../../theme';

export default function ComposeRoute() {
  const { call } = useSession();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (publish: boolean) => {
    setBusy(true); setError(null);
    try { const r = await call<{ id: string }>('POST', '/network/posts', { body: body.trim(), publish }); router.replace(`/network/post/${r.id}`); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Screen title="Mesleki paylaşım" titleEn="New post">
      <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>Giriş yapmış ağ kullanıcıları görür. {USER_CONTENT} İşletmenin kayıtlarını, kişi ve müşteri bilgilerini yazma; bir vakayı paylaşmak için uygunsuzluk ekranındaki "Vakayı ağda paylaş"ı kullan.</Text>
      <Field label="Paylaşım" testID="net-post-body" value={body} onChangeText={setBody} multiline placeholder="ör. Kapı contasını yaz başında kontrol etmek sıcaklık sapmalarını azaltıyor." />
      {error ? <ErrorBox message={error} /> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <PrimaryButton testID="net-post-publish" label={busy ? 'Kaydediliyor…' : 'Yayımla'} glow={false} style={{ flex: 1 }} disabled={busy || body.trim().length < 3} onPress={() => save(true)} />
        <GhostButton testID="net-post-draft" label="Taslak kaydet" disabled={busy || body.trim().length < 3} onPress={() => save(false)} />
      </View>
    </Screen>
  );
}
