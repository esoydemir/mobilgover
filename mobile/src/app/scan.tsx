import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { Screen } from '../components/Screen';
import { ErrorBox, Field } from '../components/states';
import { Card, Eyebrow, PrimaryButton } from '../components/ui';
import { resolveInput } from '../features/Group4';
import { C, type } from '../theme';

/** Enter a printed code or its link. Camera reading needs a device and is listed as open; the check below is the same either way. */
export default function ScanRoute() {
  const { call, selectCompany, company } = useSession();
  const [raw, setRaw] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const token = resolveInput(raw);
  const go = async () => {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      const r = await call<{ companyId: string; route: string }>('GET', `/qr/resolve?token=${encodeURIComponent(token)}`);
      if (company?.id !== r.companyId) selectCompany(r.companyId);
      router.replace(r.route as Href);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Screen title="QR kodu okut" titleEn="Scan">
      <Card style={{ gap: 8 }}>
        <Eyebrow>KOD YA DA BAĞLANTI</Eyebrow>
        <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>Etiketteki bağlantıyı ya da kodu yapıştır. Kayıt yalnız kendi yetkin kapsıyorsa açılır; aksi hâlde "böyle bir kod yok" görürsün.</Text>
        <Field label="Kod ya da bağlantı" testID="scan-input" value={raw} onChangeText={setRaw} />
        <PrimaryButton testID="scan-go" label={busy ? 'Aranıyor…' : 'Kaydı aç'} disabled={busy || !token} onPress={go} />
        {error ? <ErrorBox message={error} /> : null}
        <Text style={type(11, 400, { color: C.t3, lh: 1.4 })}>Telefon kamerasıyla okutma cihaz gerektirir; bu sürümde doğrulanmadı.</Text>
      </Card>
    </Screen>
  );
}
