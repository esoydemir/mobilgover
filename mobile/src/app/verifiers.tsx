import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Field, Loading } from '../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, Pill, PrimaryButton, Tap } from '../components/ui';
import { fmtDateTime } from '../features/dates';
import { useUi } from '../state/app';
import { C, tint, type } from '../theme';

type Grant = { id: string; ncrs: { id: string; title: string }[] | null; email: string; display_name: string; site_id: string | null; site_name: string | null; scopes: string[]; reason: string;
  expires_at: string; revoked_at: string | null; created_at: string; granted_by_name: string; active: boolean };

/**
 * Outside verifiers: for a business with one manager (or anyone wanting an independent check).
 * Limited: read cases and verify claimed results and closures; optionally review documents.
 * One site or all, 7/30/90 days, revocable. They cannot verify work or a service they took part in.
 */
export default function VerifiersRoute() {
  const { ncrId } = useLocalSearchParams<{ ncrId?: string }>();
  const { company, call } = useSession();
  const { showToast } = useUi();
  const [records, setRecords] = useState<string[] | null>(ncrId ? [ncrId] : null);
  const open = useApi<{ id: string; title: string; site_id: string; risk_level: string }[]>(company && records ? `/companies/${company.id}/nonconformities?status=open` : null);
  const q = useApi<Grant[]>(company ? `/companies/${company.id}/verifiers` : null);
  const [email, setEmail] = useState('');
  const [siteId, setSiteId] = useState<string | null>(company?.sites[0]?.id ?? null);
  const [days, setDays] = useState(30);
  const [note, setNote] = useState('');
  const [documents, setDocuments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invite = async () => {
    setBusy(true); setError(null);
    try {
      await call('POST', `/companies/${company!.id}/verifiers`, { email: email.trim(), siteId, days, note: note.trim(), documents: records ? false : documents, ncrIds: records });
      showToast('Davet gönderildi', 'Doğrulayıcı uygulamada bildirim görür; giriş yaptığında doğrulama listesini açar.');
      setEmail(''); setNote(''); setDocuments(false);
      await q.reload();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const revoke = async (g: Grant) => {
    setError(null);
    try { await call('POST', `/companies/${company!.id}/verifiers/${g.id}/revoke`, {}); showToast('İzin kaldırıldı'); await q.reload(); } catch (e) { setError(errorText(e)); }
  };
  return (
    <Screen title="Dış doğrulayıcılar" titleEn="Outside verifiers" gap={11} onRefresh={q.reload} refreshing={q.loading}>
      <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>Tek yöneticili işletmede yüksek riskli işleri, işte payı olmayan biri doğrulamalı. Güvendiğin bir uzmanı sınırlı ve süreli olarak davet edebilirsin.</Text>
      <Card style={{ gap: 10 }}>
        <Eyebrow>DAVET ET</Eyebrow>
        <Field label="E-posta" testID="verifier-email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="uzman@ornek.com" />
        <Text style={type(12, 600, { color: C.t2 })}>Kapsam</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {(company?.sites ?? []).map(s => <FilterChip key={s.id} testID={`verifier-site-${s.id}`} label={`Yalnız ${s.name}`} px={12} active={siteId === s.id} onPress={() => setSiteId(s.id)} />)}
          <FilterChip testID="verifier-site-all" label="Tüm şubeler" px={12} active={siteId === null} onPress={() => setSiteId(null)} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          <FilterChip testID="verifier-scope-all" label="Tüm uygunsuzluklar" px={12} active={!records} onPress={() => setRecords(null)} />
          <FilterChip testID="verifier-scope-records" label="Yalnız seçili kayıtlar" px={12} active={!!records} onPress={() => setRecords(r => r ?? [])} />
        </View>
        {records ? (
          <View style={{ gap: 6 }}>
            <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Doğrulayıcı yalnız seçtiğin kayıtları ve onları doğrulamak için gereken kanıtları görür; belge kasasına erişemez.</Text>
            {(open.data ?? []).filter(n => !siteId || n.site_id === siteId).map(n => (
              <FilterChip key={n.id} testID={`verifier-record-${n.id}`} label={n.title} px={12} active={records.includes(n.id)}
                onPress={() => setRecords(r => (r!.includes(n.id) ? r!.filter(x => x !== n.id) : [...r!, n.id]))} />
            ))}
          </View>
        ) : null}
        <Text style={type(12, 600, { color: C.t2 })}>Süre</Text>
        <View style={{ flexDirection: 'row', gap: 7 }}>
          {[7, 30, 90].map(d => <FilterChip key={d} testID={`verifier-days-${d}`} label={`${d} gün`} px={12} active={days === d} onPress={() => setDays(d)} />)}
        </View>
        {records ? null : <Tap testID="verifier-documents" onPress={() => setDocuments(x => !x)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: documents ? C.lime : C.t3, backgroundColor: documents ? C.lime : 'transparent' }} />
          <Text style={[type(12.5, 500), { flex: 1 }]}>Belge kasasında kurum içi inceleme de yapabilsin</Text>
        </Tap>}
        <Field label="Neden davet ediyorsun?" testID="verifier-note" value={note} onChangeText={setNote} multiline placeholder="ör. Tek yöneticiliyiz; yüksek riskli kayıtların bağımsız doğrulaması için." />
        <Text style={type(11, 400, { color: C.t3, lh: 1.45 })}>Doğrulayıcı yalnızca uygunsuzlukları görür ve "yapıldı" beyanlarını ve kapanışları doğrular{documents ? '; belgeleri inceler' : ''}. Aksiyon ekleyemez, atama yapamaz, görev ve ekip verisini göremez. Kendi katkısı olan aksiyonu ya da kendi verdiği hizmeti doğrulayamaz.</Text>
        {error ? <ErrorBox message={error} /> : null}
        <PrimaryButton testID="verifier-invite" label={busy ? 'Gönderiliyor…' : 'Davet et'} disabled={busy || !email.includes('@') || note.trim().length < 5 || (!!records && records.length === 0)} onPress={invite} />
      </Card>
      <Eyebrow>İZİNLER</Eyebrow>
      {!q.data && q.loading ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty title="Henüz dış doğrulayıcı yok" /> : null}
      {(q.data ?? []).map(g => (
        <View key={g.id} testID={`verifier-${g.email}`} style={{ borderWidth: 1, borderColor: g.active ? tint.lime(0.3) : C.bd, borderRadius: 18, padding: 13, gap: 5 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Text style={[type(13.5, 600), { flex: 1 }]}>{g.email}</Text>
            <Pill label={g.active ? 'ETKİN' : g.revoked_at ? 'KALDIRILDI' : 'SÜRESİ DOLDU'} fg={g.active ? C.lime : C.t3} bg={C.chip} />
          </View>
          {g.ncrs?.length ? <Text testID={`verifier-records-${g.email}`} style={type(11.5, 500, { color: C.t2, lh: 1.45 })}>Yalnız: {g.ncrs.map(n => n.title).join(' · ')}</Text> : null}
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>{g.site_name ?? 'Tüm şubeler'} · {g.scopes.includes('documents_review') ? 'doğrulama + belge inceleme' : 'doğrulama'} · bitiş {fmtDateTime(g.expires_at)} · {g.granted_by_name}</Text>
          <Text style={type(12, 400, { color: C.t2 })}>{g.reason}</Text>
          {g.active ? <GhostButton testID={`verifier-revoke-${g.email}`} label="İzni kaldır" height={34} size={11.5} color={C.crit} border={tint.crit(0.3)} style={{ alignSelf: 'flex-start' }} onPress={() => revoke(g)} /> : null}
        </View>
      ))}
    </Screen>
  );
}
