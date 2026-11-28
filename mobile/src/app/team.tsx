import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { ErrorBox, Field } from '../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, PrimaryButton, s } from '../components/ui';
import { ROLE_LABEL as ROLE } from '../features/labels';
import { useUi } from '../state/app';
import { C, tint, type } from '../theme';

type Member = { membership_id: string; id: string; display_name: string; email: string; role: string; site_id: string | null; signed_in: boolean;
  status: 'invited' | 'active' | 'suspended'; invite_expired: boolean; invite_expires_at: string | null; suspend_reason: string | null };

const STATUS = (m: Member) => m.status === 'active' ? '' : m.status === 'suspended' ? ` · pasif (${m.suspend_reason})` : m.invite_expired ? ' · davetin süresi doldu' : ' · davet bekliyor';

/** People in the business. New members sign in with their own e-mail; no passwords are set here. */
export default function TeamRoute() {
  const { company, siteId, sites, call, me, refresh } = useSession();
  const [inviteSite, setInviteSite] = useState<string | null>(null);
  const [newSite, setNewSite] = useState('');
  const { showToast } = useUi();
  const q = useApi<Member[]>(company ? `/companies/${company.id}/members` : null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'site_manager' | 'staff'>('site_manager');
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const act = async (m: Member, action: 'suspend' | 'reactivate' | 'cancel_invite') => {
    setError(null);
    try { await call('POST', `/companies/${company!.id}/members/${m.membership_id}/${action}`, { reason: reason.trim() }, `${action}-${m.membership_id}-${Date.now()}`); setReason(''); await q.reload(); showToast(action === 'suspend' ? 'Pasifleştirildi; erişimi hemen kapandı' : action === 'reactivate' ? 'Yeniden etkin' : 'Davet iptal edildi'); }
    catch (e) { setError(errorText(e)); }
  };
  return (
    <Screen title="Ekip" titleEn="Team">
      {(q.data ?? []).some(m => m.status === 'active' && m.role !== 'owner' && m.id !== me?.userId) ? <Field label="Pasifleştirme gerekçesi (en az 5 karakter; yazınca düğmeler açılır)" value={reason} onChangeText={setReason} placeholder="ör. İşten ayrıldı" /> : null}
      {(q.data ?? []).map(m => (
        <View key={m.membership_id} style={[s.row, { borderRadius: 18, padding: 14, flexWrap: 'wrap', gap: 8 }]}>
          <View style={{ flex: 1, minWidth: 160 }}>
            <Text style={type(14, 600, { color: m.status === 'active' ? C.t1 : C.t3 })}>{m.display_name || m.email}</Text>
            {m.email && m.email !== m.display_name ? <Text style={type(12, 400, { color: C.t2 })}>{m.email}</Text> : null}
            <Text style={[type(11.5, 400, { color: m.status === 'suspended' ? C.crit : C.t3 }), { marginTop: 2 }]}>{ROLE[m.role]}{(company?.sites.length ?? 0) > 1 ? ` · ${m.site_id ? company!.sites.find(s => s.id === m.site_id)?.name ?? 'Şube' : 'Tüm şubeler'}` : ''}{STATUS(m)}</Text>
          </View>
          {m.role !== 'owner' && m.id !== me?.userId ? (
            m.status === 'active' ? <GhostButton label="Pasifleştir" height={32} size={11} disabled={reason.trim().length < 5} color={C.crit} border={tint.crit(0.35)} onPress={() => act(m, 'suspend')} />
            : m.status === 'suspended' ? <GhostButton label="Yeniden etkinleştir" height={32} size={11} onPress={() => act(m, 'reactivate')} />
            : <GhostButton label="Daveti iptal et" height={32} size={11} onPress={() => act(m, 'cancel_invite')} />
          ) : null}
        </View>
      ))}
      {q.error ? <ErrorBox message={q.error} /> : null}
      {error ? <ErrorBox message={error} /> : null}
      <Card style={{ gap: 10 }}>
        <Eyebrow>KİŞİ DAVET ET</Eyebrow>
        <Field label="E-posta" testID="team-email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <View style={{ flexDirection: 'row', gap: 7 }}>
          <FilterChip label="Şube yöneticisi" active={role === 'site_manager'} onPress={() => setRole('site_manager')} />
          <FilterChip label="Personel" active={role === 'staff'} onPress={() => setRole('staff')} />
        </View>
        {sites.length > 1 ? (
          <View style={{ gap: 6 }}>
            <Text style={type(12, 600, { color: C.t2 })}>Şube</Text>
            <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
              {sites.map(st => <FilterChip key={st.id} testID={`team-site-${st.id}`} label={st.name} active={(inviteSite ?? siteId) === st.id} onPress={() => setInviteSite(st.id)} />)}
            </View>
          </View>
        ) : null}
        <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Personel yalnızca kendisine atanan görevleri görür. Şube yöneticisi uygunsuzlukları yürütebilir ve kapanışı doğrulayabilir.</Text>
        <PrimaryButton testID="team-add" label="Davet et" height={44} size={13} disabled={!email.includes('@')}
          onPress={async () => {
            setError(null);
            try { await call('POST', `/companies/${company!.id}/members`, { email: email.trim(), role, siteId: inviteSite ?? siteId }); setEmail(''); showToast('Davet gönderildi', 'Kendi e-postasıyla giriş yapıp kabul edince erişimi açılır (7 gün geçerli).'); await q.reload(); }
            catch (e) { setError(errorText(e)); }
          }} />
      </Card>
      <Card style={{ gap: 10 }}>
        <Eyebrow>ŞUBELER ({company?.sites.length ?? 0})</Eyebrow>
        {(company?.sites ?? []).map(st => <Text key={st.id} style={type(13, 500)}>{st.name}</Text>)}
        <Field label="Yeni şube adı" testID="site-name" value={newSite} onChangeText={setNewSite} placeholder="ör. Beşiktaş Çarşı" />
        <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Yeni şubenin profili, ekipmanı ve ekibi ayrıca tanımlanır. Şube yöneticisi yalnız kendi şubesini görür; işletme sahibi ve merkez yöneticisi bütün şubeleri.</Text>
        <GhostButton testID="site-add" label="Şube ekle" height={42} size={12.5} disabled={newSite.trim().length < 2}
          onPress={async () => {
            setError(null);
            try { await call('POST', `/companies/${company!.id}/sites`, { name: newSite.trim() }); setNewSite(''); await refresh(); showToast('Şube eklendi'); }
            catch (e) { setError(errorText(e)); }
          }} />
      </Card>
    </Screen>
  );
}
