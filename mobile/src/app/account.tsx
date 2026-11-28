import { useState } from 'react';
import { Platform, Text } from 'react-native';
import { API_URL, errorText } from '../api/client';
import { useSession } from '../api/session';
import { Screen } from '../components/Screen';
import { ErrorBox, Field } from '../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, PrimaryButton } from '../components/ui';
import { fmtDateTime } from '../features/dates';
import { Invitations } from '../features/Invitations';
import { ROLE_LABEL } from '../features/labels';
import { useApi } from '../api/useApi';
import { View } from 'react-native';
import { useUi } from '../state/app';
import { C, tint, type } from '../theme';
import { setThemePref, useThemePref } from '../theme/appearance';

/** Account, environment and second factor. */
export default function AccountRoute() {
  const { me, env, call, refresh, logout, company, role } = useSession();
  const { showToast } = useUi();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const theme = useThemePref();
  const [error, setError] = useState<string | null>(null);
  const sessions = useApi<{ id: string; created_at: string; last_used_at: string | null; current: boolean }[]>('/auth/sessions');
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
        <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 6 }]}>Sunucu: {API_URL}{env ? ` · e-posta: ${env.mailTransport === 'dev_outbox' ? 'geliştirme kutusu (gerçek gönderim yok)' : env.mailTransport === 'smtp' ? (env.mailProductionReady ? 'SMTP' : 'SMTP · gerçek gönderim henüz doğrulanmadı') : env.mailTransport}` : ''}</Text>
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
      {Platform.OS === 'web' ? (
        <Card style={{ gap: 10 }}>
          <Eyebrow>GÖRÜNÜM</Eyebrow>
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
            {([['system', 'Cihaza göre'], ['light', 'Açık'], ['dark', 'Koyu']] as const).map(([k, l]) => <FilterChip key={k} testID={`theme-${k}`} label={l} active={theme === k} onPress={() => setThemePref(k)} />)}
          </View>
        </Card>
      ) : null}
      <Invitations />
      <Card style={{ gap: 8 }}>
        <Eyebrow>AÇIK OTURUMLAR</Eyebrow>
        {(sessions.data ?? []).map(x => (
          <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[type(12, 400, { color: x.current ? C.lime : C.t2 }), { flex: 1 }]}>
              {x.current ? 'Bu cihaz' : 'Başka cihaz'} · açıldı {fmtDateTime(x.created_at)}{x.last_used_at ? ` · son ${fmtDateTime(x.last_used_at)}` : ''}
            </Text>
            {!x.current ? <GhostButton label="Kapat" height={32} size={11} onPress={async () => { try { await call('POST', `/auth/sessions/${x.id}/revoke`); await sessions.reload(); showToast('Oturum kapatıldı'); } catch (e) { setError(errorText(e)); } }} /> : null}
          </View>
        ))}
        {(sessions.data?.length ?? 0) > 1 ? (
          <GhostButton testID="revoke-others" label="Diğer tüm cihazlardan çıkış yap" height={38} size={12}
            onPress={async () => { try { const r = await call<{ revoked: number }>('POST', '/auth/sessions/revoke-others'); await sessions.reload(); showToast(`${r.revoked} oturum kapatıldı`); } catch (e) { setError(errorText(e)); } }} />
        ) : null}
        <Text style={type(11, 400, { color: C.t3, lh: 1.45 })}>Telefonunu kaybedersen başka bir cihazdan giriş yapıp buradan kapat.</Text>
      </Card>
      <GhostButton testID="logout" label="Çıkış yap" color={C.crit} border={tint.crit(0.35)} onPress={logout} />
    </Screen>
  );
}
