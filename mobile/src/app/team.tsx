import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { ErrorBox, Field } from '../components/states';
import { Card, Eyebrow, FilterChip, PrimaryButton, s } from '../components/ui';
import { useUi } from '../state/app';
import { C, type } from '../theme';

type Member = { id: string; display_name: string; email: string; role: string; site_id: string | null; signed_in: boolean };
const ROLE: Record<string, string> = { owner: 'İşletme sahibi', hq_manager: 'Merkez yöneticisi', site_manager: 'Şube yöneticisi', staff: 'Personel' };

/** People in the business. New members sign in with their own e-mail; no passwords are set here. */
export default function TeamRoute() {
  const { company, siteId, call } = useSession();
  const { showToast } = useUi();
  const q = useApi<Member[]>(company ? `/companies/${company.id}/members` : null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'site_manager' | 'staff'>('site_manager');
  const [error, setError] = useState<string | null>(null);
  return (
    <Screen title="Ekip" titleEn="Team">
      {(q.data ?? []).map(m => (
        <View key={m.id + m.role} style={[s.row, { borderRadius: 18, padding: 14 }]}>
          <View style={{ flex: 1 }}>
            <Text style={type(14, 600)}>{m.email ?? m.display_name}</Text>
            <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 2 }]}>{ROLE[m.role]}{m.signed_in ? '' : ' · henüz giriş yapmadı'}</Text>
          </View>
        </View>
      ))}
      {q.error ? <ErrorBox message={q.error} /> : null}
      <Card style={{ gap: 10 }}>
        <Eyebrow>KİŞİ EKLE</Eyebrow>
        <Field label="E-posta" testID="team-email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <View style={{ flexDirection: 'row', gap: 7 }}>
          <FilterChip label="Şube yöneticisi" active={role === 'site_manager'} onPress={() => setRole('site_manager')} />
          <FilterChip label="Personel" active={role === 'staff'} onPress={() => setRole('staff')} />
        </View>
        <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Personel yalnızca kendisine atanan görevleri görür. Şube yöneticisi uygunsuzlukları yürütebilir ve kapanışı doğrulayabilir.</Text>
        {error ? <ErrorBox message={error} /> : null}
        <PrimaryButton testID="team-add" label="Ekle" height={44} size={13} disabled={!email.includes('@')}
          onPress={async () => {
            setError(null);
            try { await call('POST', `/companies/${company!.id}/members`, { email: email.trim(), role, siteId }); setEmail(''); showToast('Kişi eklendi', 'Kendi e-postasıyla giriş yapabilir.'); await q.reload(); }
            catch (e) { setError(errorText(e)); }
          }} />
      </Card>
    </Screen>
  );
}
