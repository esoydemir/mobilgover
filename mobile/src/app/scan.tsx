import { router, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Text } from 'react-native';
import { ApiError, errorText } from '../api/client';
import { useSession } from '../api/session';
import { Screen } from '../components/Screen';
import { ErrorBox, Field } from '../components/states';
import { Card, Eyebrow, GhostButton, PrimaryButton } from '../components/ui';
import { CAMERA_PROBLEM_TEXT, CameraScanner } from '../features/CameraScanner';
import { tokenFromText, type CameraProblem } from '../features/qr-scan';
import { C, type } from '../theme';

export const BAD_CODE = 'Okunan kod GoverHub kodu gibi görünmüyor ya da bozuk. Kodu yeniden okut; olmazsa etiketteki bağlantıyı aşağıya yapıştır.';
const NOT_FOUND = 'Bu kod geçersiz, pasifleştirilmiş ya da bu kayda erişimin yok.';

/** Camera reading (browser) or a pasted code/link. Both end in the same server check, so access rules are identical. */
export default function ScanRoute() {
  const { call, selectCompany, company } = useSession();
  const [raw, setRaw] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState(false); const [problem, setProblem] = useState<CameraProblem | null>(null);
  const navigated = useRef(false);
  const token = tokenFromText(raw);

  const open = useCallback(async (t: string) => {
    if (navigated.current) return;
    setBusy(true); setError(null);
    try {
      const r = await call<{ companyId: string; route: string }>('GET', `/qr/resolve?token=${encodeURIComponent(t)}`);
      navigated.current = true; setCamera(false);
      if (company?.id !== r.companyId) selectCompany(r.companyId);
      router.replace(r.route as Href);
    } catch (e) { setError(e instanceof ApiError && e.status === 404 ? NOT_FOUND : errorText(e)); } finally { setBusy(false); }
  }, [call, company?.id, selectCompany]);

  const onCameraToken = useCallback((t: string) => { void open(t); }, [open]);
  const onUnreadable = useCallback(() => setError(BAD_CODE), []);
  const onProblem = useCallback((p: CameraProblem) => { setProblem(p); setCamera(false); }, []);

  return (
    <Screen title="QR kodu okut" titleEn="Scan">
      <Card style={{ gap: 8 }}>
        <Eyebrow>KAMERA</Eyebrow>
        {camera ? (
          <>
            <CameraScanner onToken={onCameraToken} onProblem={onProblem} onUnreadable={onUnreadable} />
            <Text style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>Kodu kameraya göster; okununca kayıt açılır.</Text>
            <GhostButton testID="scan-camera-stop" label="Kamerayı kapat" height={38} size={12} onPress={() => setCamera(false)} />
          </>
        ) : (
          <PrimaryButton testID="scan-camera-start" label="Kamerayla okut" disabled={busy} onPress={() => { setProblem(null); setError(null); navigated.current = false; setCamera(true); }} />
        )}
        {problem ? <Text testID="scan-camera-problem" style={type(12, 500, { color: C.warn, lh: 1.45 })}>{CAMERA_PROBLEM_TEXT[problem]}</Text> : null}
      </Card>
      <Card style={{ gap: 8 }}>
        <Eyebrow>KOD YA DA BAĞLANTI</Eyebrow>
        <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>Etiketteki bağlantıyı ya da kodu yapıştır. Kayıt yalnız kendi yetkin kapsıyorsa açılır.</Text>
        <Field label="Kod ya da bağlantı" testID="scan-input" value={raw} onChangeText={setRaw} />
        <PrimaryButton testID="scan-go" label={busy ? 'Aranıyor…' : 'Kaydı aç'} disabled={busy || !token} onPress={() => { navigated.current = false; if (token) void open(token); }} />
        {raw.trim() && !token ? <Text testID="scan-bad" style={type(12, 500, { color: C.warn, lh: 1.45 })}>{BAD_CODE}</Text> : null}
        {error ? <ErrorBox message={error} /> : null}
        {error ? <GhostButton testID="scan-retry" label="Yeniden okut" height={38} size={12} onPress={() => { navigated.current = false; setError(null); setProblem(null); setCamera(true); }} /> : null}
      </Card>
    </Screen>
  );
}
