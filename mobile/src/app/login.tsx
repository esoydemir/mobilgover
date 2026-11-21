import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, errorText } from '../api/client';
import { useSession } from '../api/session';
import { GradientFill } from '../components/Gradient';
import { EnvBadge } from '../components/Screen';
import { ErrorBox, Field } from '../components/states';
import { GhostButton, PrimaryButton } from '../components/ui';
import { C, tint, type } from '../theme';

/** E-mail sign-in with a one-time code; administrators add an authenticator code. */
export default function LoginRoute() {
  const insets = useSafeAreaInsets();
  const { env, startLogin, verifyLogin, verifyMfa } = useSession();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [step, setStep] = useState<'email' | 'code' | 'mfa'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 48, paddingHorizontal: 22, paddingBottom: 40, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 52, height: 52, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
            <GradientFill angle={150} stops={[[0, C.lime], [1, '#9BD718']]} />
            <Text style={type(24, 800, { family: 'outfit', color: C.ink })}>G</Text>
          </View>
          <View style={{ gap: 4 }}>
            <Text style={type(22, 600, { family: 'outfit', ls: -0.03 })}>GoverHub</Text>
            <EnvBadge />
          </View>
        </View>
        <Text style={[type(27, 600, { family: 'outfit', ls: -0.035, lh: 1.12 }), { marginTop: 14 }]}>
          {step === 'email' ? 'E-posta ile giriş' : step === 'code' ? 'Kodu gir' : 'Kimlik doğrulayıcı kodu'}
        </Text>
        <Text style={type(14, 400, { lh: 1.5, color: C.t2 })}>
          {step === 'email' ? 'Parola yok. E-postana 6 haneli, 10 dakika geçerli bir kod göndeririz.'
            : step === 'code' ? `${email} adresine gönderilen 6 haneli kodu yaz.`
            : 'Hesabında ek doğrulama açık. Kimlik doğrulayıcı uygulamandaki 6 haneli kodu yaz.'}
        </Text>

        {step === 'email' && (
          <>
            <Field label="E-posta" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address"
              placeholder={env?.demoLoginDomain ? `sahip@${env.demoLoginDomain}` : 'ornek@isletme.com.tr'} testID="login-email" />
            {env?.mode === 'demo' && env.demoLoginDomain && (
              <Text style={type(12, 400, { lh: 1.5, color: C.warn })}>
                Test ortamı: yalnızca @{env.demoLoginDomain} demo adresleri. Gerçek e-posta adresi girmeyin.
              </Text>
            )}
            <PrimaryButton label={busy ? 'Gönderiliyor…' : 'Kod gönder'} disabled={busy || !email.includes('@')}
              onPress={() => run(async () => { await startLogin(email); setStep('code'); })} />
          </>
        )}
        {step === 'code' && (
          <>
            <Field label="Kod" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} placeholder="000000" testID="login-code" autoComplete="one-time-code" />
            <PrimaryButton label={busy ? 'Kontrol ediliyor…' : 'Giriş yap'} disabled={busy || code.length !== 6}
              onPress={() => run(async () => {
                const r = await verifyLogin(email, code);
                if (r.mfaTicket) { setTicket(r.mfaTicket); setCode(''); setStep('mfa'); }
              })} />
            {env?.mode === 'demo' && env.mailTransport === 'dev_outbox' && (
              <View style={{ borderWidth: 1, borderColor: tint.warn(0.3), backgroundColor: tint.warn(0.06), borderRadius: 16, padding: 14, gap: 10 }}>
                <Text style={type(12, 400, { lh: 1.5, color: C.t2 })}>Demo ortamında e-posta gönderilmez; kod sunucunun geliştirme kutusunda tutulur. Bu düğme pilot ortamında yoktur.</Text>
                <GhostButton label="Demo kutusundan kodu getir" height={40} size={12.5} color={C.warn} border={tint.warn(0.4)}
                  onPress={() => run(async () => {
                    const m = await api<{ body: string }>('GET', `/dev/outbox/latest?email=${encodeURIComponent(email)}`);
                    setCode(/(\d{6})/.exec(m.body)?.[1] ?? '');
                  })} />
              </View>
            )}
            <GhostButton label="E-postayı değiştir" onPress={() => { setStep('email'); setCode(''); }} />
          </>
        )}
        {step === 'mfa' && (
          <>
            <Field label="Doğrulama kodu" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} placeholder="000000" testID="login-mfa" />
            <PrimaryButton label={busy ? 'Kontrol ediliyor…' : 'Doğrula'} disabled={busy || code.length !== 6}
              onPress={() => run(() => verifyMfa(ticket!, code))} />
          </>
        )}
        {error ? <ErrorBox message={error} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
