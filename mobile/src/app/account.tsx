import { useState } from 'react';
import { Text } from 'react-native';
import { API_URL, errorText } from '../api/client';
import { useSession } from '../api/session';
import { Screen } from '../components/Screen';
import { ErrorBox, Field } from '../components/states';
import { Card, Eyebrow, GhostButton, PrimaryButton } from '../components/ui';
import { ROLE_LABEL } from '../features/labels';
import { useUi } from '../state/app';
import { C, tint, type } from '../theme';

/** Account, environment and second factor. */
export default function AccountRoute() {
  const { me, env, call, refresh, logout, company, role } = useSession();
  const { showToast } = useUi();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const admin = role === 'owner' || role === 'hq_manager' || (me?.platformRoles.length ?? 0) > 0;
  return (
    <Screen title="Hesap ve güvenlik" titleEn="Account">
      <Card>
        <Eyebrow>HESAP</Eyebrow>
        <Text style={[type(14, 600), { marginTop: 8 }]}>{me?.email}</Text>
        <Text style={[type(12, 400, { color: C.t2 }), { marginTop: 4 }]}>{company?.name ?? 'İşletme yok'}{role ? ` · ${ROLE_LABEL[role] ?? role}` : ''}{me?.platformRoles.length ? ` · platform: ${me.platformRoles.join(', ')}` : ''}</Text>
      </Card>
      <Card border={env?.mode === 'demo' ? tint.warn(0.35) : tint.info(0.35)}>
        <Eyebrow>ORTAM</Eyebrow>
        <Text testID="env-mode" style={[type(14, 700, { color: env?.mode === 'demo' ? C.warn : C.info }), { marginTop: 8 }]}>{env?.mode === 'demo' ? 'DEMO · örnek veri' : env?.mode === 'pilot' ? 'PİLOT · gerçek kayıtlar' : 'Bilinmiyor (çevrimdışı başlatıldı)'}</Text>
        <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 6 }]}>Sunucu: {API_URL}{env ? ` · e-posta: ${env.mailTransport === 'dev_outbox' ? 'geliştirme kutusu (gerçek gönderim yok)' : env.mailTransport}` : ''}</Text>
      </Card>
      <Card>
        <Eyebrow>EK DOĞRULAMA (KİMLİK DOĞRULAYICI UYGULAMA)</Eyebrow>
        <Text style={[type(12.5, 400, { color: C.t2, lh: 1.5 }), { marginTop: 8 }]}>
          {me?.mfaEnabled ? 'Açık. Her girişte e-posta kodundan sonra uygulama kodu istenir.' : admin ? 'Yönetici hesapların için önerilir; kural ve platform işlemlerinde zorunludur.' : 'İsteğe bağlı.'}
        </Text>
        {!me?.mfaEnabled && !setup ? (
          <GhostButton label="Kurulumu başlat" style={{ marginTop: 12 }} onPress={async () => { setError(null); try { setSetup(await call('POST', '/auth/mfa/totp/setup')); } catch (e) { setError(errorText(e)); } }} />
        ) : null}
        {setup ? (
          <>
            <Text style={[type(12, 400, { color: C.t2, lh: 1.5 }), { marginTop: 10 }]}>Uygulamana bu anahtarı ekle (veya bağlantıyı aç), sonra gösterdiği 6 haneli kodu yaz:</Text>
            <Text selectable style={[type(14, 600, { family: 'mono' }), { marginTop: 8 }]}>{setup.secret}</Text>
            <Field label="Uygulamadaki kod" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
            <PrimaryButton label="Doğrula ve aç" disabled={code.length !== 6} height={44} size={13} style={{ marginTop: 10 }}
              onPress={async () => { setError(null); try { await call('POST', '/auth/mfa/totp/confirm', { code }); setSetup(null); await refresh(); showToast('Ek doğrulama açıldı'); } catch (e) { setError(errorText(e)); } }} />
          </>
        ) : null}
        {error ? <ErrorBox message={error} /> : null}
      </Card>
      <GhostButton testID="logout" label="Çıkış yap" color={C.crit} border={tint.crit(0.35)} onPress={logout} />
    </Screen>
  );
}
