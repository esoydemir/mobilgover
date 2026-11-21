import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { Screen } from '../../components/Screen';
import { ErrorBox, Loading } from '../../components/states';

/** Link target printed in the QR code. Signed-out visitors are sent through the normal sign-in first. */
export default function QrLinkRoute() {
  const { token: t } = useLocalSearchParams<{ token: string }>();
  const { call, token, selectCompany, company } = useSession();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token || !t) return;
    call<{ companyId: string; route: string }>('GET', `/qr/resolve?token=${encodeURIComponent(t)}`)
      .then(r => { if (company?.id !== r.companyId) selectCompany(r.companyId); router.replace(r.route as Href); })
      .catch(e => {
        const m = errorText(e);
        // Bozuk bicimli kod ile pasif/bilinmeyen kod ayni anlasilir dille anlatilir; kayit ayrintisi verilmez.
        setError(/geçersiz/i.test(m) ? 'Bu kod okunamadı ya da bozuk. Kodu yeniden okutun; sorun sürerse kodu üreten kişiden yeni kod isteyin.' : m);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, t]);
  return (
    <Screen title="QR kodu" titleEn="Scan">
      {error ? <ErrorBox message={error} /> : <Loading />}
      {!token ? <Text>Önce giriş yap, sonra kodu yeniden okut.</Text> : null}
    </Screen>
  );
}
