import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { ErrorBox, ExampleBadge, Field, Loading, SectionLabel } from '../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, Pill, PrimaryButton } from '../components/ui';
import { addDays, fmtDateTime } from '../features/dates';
import { useUi } from '../state/app';
import { C, tint, type } from '../theme';

type ProfileView = {
  profile: { id: string; display_name: string; headline: string; city: string; district: string | null; bio: string };
  identity: { status: string; checkedAt?: string; method?: string };
  credentials: { id: string; credential_type: string; issuer: string; valid_until: string | null; status: string; expired: boolean; checked_at: string | null; check_method: string | null }[];
  businessRegistration: { id: string; status: string }[];
  authorizedCategories: { category_code: string; name: string; is_example: boolean }[];
  otherCategoryRequests: { category_code: string; name: string; status: string }[];
  notChecked: string[];
  disclaimer: string;
};
type Category = { code: string; name: string; required_credentials: string[]; is_example: boolean };
type Inbox = {
  requests: { id: string; category_name: string; title: string; description: string; city: string; created_at: string; my_quote_status: string | null }[];
  jobs: { id: string; status: string; title: string; company_name: string; site_name: string; checked_in_at: string | null; business_note: string | null }[];
};

const V_STATUS: Record<string, [string, string]> = { verified: ['DOĞRULANDI', C.lime], pending: ['İNCELEMEDE', C.warn], rejected: ['REDDEDİLDİ', C.crit], not_verified: ['DOĞRULANMADI', C.t3] };

/** Professional area: profile, separate checks, per-category authorization, requests and jobs. */
export default function ProRoute() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  if (view) return <PublicProfile id={view} />;
  return <MyProfessionalArea />;
}

function PublicProfile({ id }: { id: string }) {
  const q = useApi<ProfileView>(`/professionals/${id}`);
  return (
    <Screen title="Uzman profili" titleEn="Professional profile">
      {q.error ? <ErrorBox message={q.error} /> : !q.data ? <Loading /> : <ProfileCard v={q.data} />}
    </Screen>
  );
}

function ProfileCard({ v }: { v: ProfileView }) {
  return (
    <>
      <Text style={type(22, 600, { family: 'outfit', ls: -0.03 })}>{v.profile.display_name}</Text>
      <Text style={type(13, 400, { color: C.t2 })}>{[v.profile.headline, v.profile.city, v.profile.district].filter(Boolean).join(' · ')}</Text>
      <Card>
        <Eyebrow>NE KONTROL EDİLDİ</Eyebrow>
        <Row label="Kimlik" status={v.identity.status} note={v.identity.method} />
        {v.credentials.map(c => <Row key={c.id} label={`Mesleki belge: ${c.credential_type}`} status={c.expired ? 'expired' : c.status} note={`${c.issuer}${c.valid_until ? ` · ${c.valid_until}'e kadar` : ''}${c.check_method ? ` · ${c.check_method}` : ''}`} />)}
        {v.businessRegistration.map(b => <Row key={b.id} label="İşletme kaydı" status={b.status} />)}
        <Text style={[type(10.5, 600, { ls: 0.1, color: C.t3 }), { marginTop: 14 }]}>KONTROL EDİLMEYEN</Text>
        {v.notChecked.map(n => <Text key={n} style={[type(12, 400, { color: C.t2 }), { marginTop: 4 }]}>• {n}</Text>)}
      </Card>
      <Card>
        <Eyebrow>HİZMET VERME ONAYI (KATEGORİ BAZINDA)</Eyebrow>
        {v.authorizedCategories.length === 0 ? <Text style={[type(12.5, 400, { color: C.t2 }), { marginTop: 10 }]}>Henüz onaylı kategori yok; bu profil hizmet sunamaz.</Text> : null}
        {v.authorizedCategories.map(a => (
          <View key={a.category_code} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <Text style={[type(13, 600, { color: C.lime }), { flex: 1 }]}>✓ {a.name}</Text>
            {a.is_example ? <ExampleBadge label="ÖRNEK KATEGORİ" /> : null}
          </View>
        ))}
      </Card>
      <View style={{ borderWidth: 1, borderColor: tint.info(0.3), backgroundColor: tint.info(0.06), borderRadius: 16, padding: 13 }}>
        <Text style={type(12.5, 600, { color: C.info, lh: 1.45 })}>{v.disclaimer}</Text>
      </View>
    </>
  );
}

function Row({ label, status, note }: { label: string; status: string; note?: string }) {
  const [text, color] = status === 'expired' ? ['SÜRESİ DOLMUŞ', C.crit] : V_STATUS[status] ?? [status, C.t2];
  return (
    <View style={{ marginTop: 10, gap: 2 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Text style={[type(13, 600), { flex: 1 }]}>{label}</Text>
        <Text style={type(10, 700, { ls: 0.08, color })}>{text}</Text>
      </View>
      {note ? <Text style={type(11, 400, { color: C.t3 })}>{note}</Text> : null}
    </View>
  );
}

function MyProfessionalArea() {
  const { call } = useSession();
  const { showToast } = useUi();
  const me = useApi<ProfileView | null>('/pro/profile');
  const cats = useApi<Category[]>('/service-categories');
  const inbox = useApi<Inbox>(me.data ? '/pro/inbox' : null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ displayName: '', headline: '', city: 'İstanbul' });
  const [ver, setVer] = useState({ kind: 'identity' as 'identity' | 'credential' | 'business_registration', credentialType: '', issuer: '', documentRef: '', validUntil: '' });

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    try { await fn(); showToast(msg); await me.reload(); await inbox.reload(); } catch (e) { setError(errorText(e)); }
  };
  if (me.loading && me.data === null && !me.error) return <Screen title="Uzman alanı" titleEn="Professional"><Loading /></Screen>;

  if (!me.data) {
    return (
      <Screen title="Uzman alanı" titleEn="Professional">
        <Text style={type(14, 400, { color: C.t2, lh: 1.5 })}>Mesleki profil açmak serbesttir ama tek başına hizmet verme yetkisi vermez. Hizmet sunmak için kimliğin ve ilgili mesleki belgen doğrulanmalı, kategori bazında onay alınmalı.</Text>
        <Field label="Görünen ad" testID="pro-name" value={form.displayName} onChangeText={v => setForm(f => ({ ...f, displayName: v }))} />
        <Field label="Kısa tanım" value={form.headline} onChangeText={v => setForm(f => ({ ...f, headline: v }))} placeholder="ör. Soğutma teknisyeni" />
        <Field label="Şehir" value={form.city} onChangeText={v => setForm(f => ({ ...f, city: v }))} />
        {error ? <ErrorBox message={error} /> : null}
        <PrimaryButton testID="pro-create" label="Profili aç" disabled={form.displayName.trim().length < 2}
          onPress={() => act(() => call('POST', '/pro/profile', { kind: 'individual', displayName: form.displayName.trim(), headline: form.headline, city: form.city, bio: '' }), 'Profil açıldı')} />
      </Screen>
    );
  }

  const credentialTypes = [...new Set((cats.data ?? []).flatMap(c => c.required_credentials))];
  const requested = new Map([...me.data.authorizedCategories.map(a => [a.category_code, 'approved'] as const), ...me.data.otherCategoryRequests.map(a => [a.category_code, a.status] as const)]);

  return (
    <Screen title="Uzman alanı" titleEn="Professional" onRefresh={() => { void me.reload(); void inbox.reload(); }} refreshing={me.loading}>
      <ProfileCard v={me.data} />
      {error ? <ErrorBox message={error} /> : null}

      <SectionLabel>DOĞRULAMA İÇİN BELGE GÖNDER</SectionLabel>
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {([['identity', 'Kimlik'], ['credential', 'Mesleki belge'], ['business_registration', 'İşletme kaydı']] as const).map(([k, l]) => (
            <FilterChip key={k} label={l} px={12} active={ver.kind === k} onPress={() => setVer(v => ({ ...v, kind: k }))} />
          ))}
        </View>
        {ver.kind === 'credential' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {credentialTypes.map(c => <FilterChip key={c} label={c} px={12} active={ver.credentialType === c} onPress={() => setVer(v => ({ ...v, credentialType: c }))} />)}
          </View>
        ) : null}
        <Field label="Veren kurum" testID="ver-issuer" value={ver.issuer} onChangeText={v => setVer(x => ({ ...x, issuer: v }))} />
        <Field label="Belge numarası / referans" testID="ver-ref" value={ver.documentRef} onChangeText={v => setVer(x => ({ ...x, documentRef: v }))} />
        {ver.kind !== 'identity' ? <Field label="Geçerlilik bitişi (YYYY-AA-GG)" value={ver.validUntil} onChangeText={v => setVer(x => ({ ...x, validUntil: v }))} placeholder="2028-12-31" /> : null}
        <GhostButton testID="ver-submit" label="İncelemeye gönder" disabled={ver.issuer.trim().length < 2 || ver.documentRef.trim().length < 2 || (ver.kind === 'credential' && !ver.credentialType)}
          onPress={() => act(() => call('POST', '/pro/verifications', { kind: ver.kind, credentialType: ver.kind === 'credential' ? ver.credentialType : null, issuer: ver.issuer.trim(), documentRef: ver.documentRef.trim(), validUntil: ver.validUntil || null }), 'Belge incelemeye gönderildi')} />
        <Text style={type(11, 400, { color: C.t3, lh: 1.45 })}>Belgeni platformdaki bir inceleyici kontrol eder; kendi belgeni doğrulayamazsın.</Text>
      </Card>

      <SectionLabel>HİZMET KATEGORİLERİ</SectionLabel>
      {(cats.data ?? []).map(c => {
        const st = requested.get(c.code);
        return (
          <Card key={c.code} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[type(14, 600), { flex: 1 }]}>{c.name}</Text>
              {c.is_example ? <ExampleBadge label="ÖRNEK" /> : null}
            </View>
            <Text style={type(11.5, 400, { color: C.t3 })}>Gerekli belge: {c.required_credentials.join(', ') || '—'} + doğrulanmış kimlik</Text>
            {st ? <Pill label={st === 'approved' ? 'ONAYLI' : st === 'pending' ? 'İNCELEMEDE' : st.toUpperCase()} fg={st === 'approved' ? C.lime : st === 'pending' ? C.warn : C.crit} bg={tint.white(0.06)} style={{ alignSelf: 'flex-start' }} />
              : <GhostButton testID={`auth-${c.code}`} label="Bu kategori için başvur" height={38} size={12.5} onPress={() => act(() => call('POST', '/pro/authorizations', { categoryCode: c.code }), 'Başvuru gönderildi')} />}
          </Card>
        );
      })}

      <SectionLabel>AÇIK TALEPLER (ONAYLI KATEGORİLERİNDE)</SectionLabel>
      {inbox.data?.requests.length === 0 ? <Text style={type(12.5, 400, { color: C.t2 })}>Şu an açık talep yok. Talepler yalnızca onaylı olduğun kategorilerde görünür; işletme adı teklifin kabul edilince görünür.</Text> : null}
      {(inbox.data?.requests ?? []).map(r => <RequestCard key={r.id} r={r} onDone={() => inbox.reload()} />)}

      <SectionLabel>İŞLERİM</SectionLabel>
      {(inbox.data?.jobs ?? []).map(j => <JobCard key={j.id} j={j} onDone={() => inbox.reload()} />)}
    </Screen>
  );
}

function RequestCard({ r, onDone }: { r: Inbox['requests'][number]; onDone: () => void }) {
  const { call } = useSession();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ scope: '', exclusions: '', priceNet: '', vatRate: '20', materials: '', durationText: '', warrantyText: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF(x => ({ ...x, [k]: v }));
  return (
    <Card style={{ gap: 8 }}>
      <Text style={type(11, 600, { ls: 0.08, color: C.t3 })}>{r.category_name.toUpperCase()} · {r.city} · {fmtDateTime(r.created_at)}</Text>
      <Text style={type(14.5, 600)}>{r.title}</Text>
      <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>{r.description}</Text>
      {r.my_quote_status ? <Text style={type(12, 600, { color: C.lime })}>Teklifin: {r.my_quote_status}</Text> : !open ? (
        <GhostButton testID="quote-open" label="Teklif ver" height={40} size={12.5} onPress={() => setOpen(true)} />
      ) : (
        <View style={{ gap: 10 }}>
          <Field label="Kapsam" testID="q-scope" value={f.scope} onChangeText={set('scope')} multiline />
          <Field label="Dahil olmayanlar" testID="q-excl" value={f.exclusions} onChangeText={set('exclusions')} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Field label="Net fiyat (₺)" testID="q-price" value={f.priceNet} onChangeText={set('priceNet')} keyboardType="decimal-pad" /></View>
            <View style={{ width: 100 }}><Field label="KDV %" value={f.vatRate} onChangeText={set('vatRate')} keyboardType="decimal-pad" /></View>
          </View>
          <Field label="Malzeme" testID="q-mat" value={f.materials} onChangeText={set('materials')} />
          <Field label="Süre" testID="q-dur" value={f.durationText} onChangeText={set('durationText')} />
          <Field label="Garanti" testID="q-war" value={f.warrantyText} onChangeText={set('warrantyText')} />
          {error ? <ErrorBox message={error} /> : null}
          <PrimaryButton testID="quote-submit" label="Teklifi gönder (3 gün geçerli)" height={46} size={13}
            onPress={async () => {
              setError(null);
              try {
                await call('POST', `/pro/requests/${r.id}/quotes`, { ...f, priceNet: Number(f.priceNet.replace(',', '.')), vatRate: Number(f.vatRate), validUntil: addDays(new Date(), 3).toISOString() });
                onDone();
              } catch (e) { setError(errorText(e)); }
            }} />
        </View>
      )}
    </Card>
  );
}

function JobCard({ j, onDone }: { j: Inbox['jobs'][number]; onDone: () => void }) {
  const { call } = useSession();
  const [code, setCode] = useState('');
  const [report, setReport] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); onDone(); } catch (e) { setError(errorText(e)); } };
  return (
    <Card border={j.status === 'accepted' ? tint.lime(0.3) : C.bd} style={{ gap: 8 }}>
      <Text style={type(14.5, 600)}>{j.title}</Text>
      <Text style={type(12, 400, { color: C.t2 })}>{j.company_name} · {j.site_name}</Text>
      <Text testID="pro-job-status" style={type(12, 600, { color: j.status === 'accepted' ? C.lime : C.warn })}>{({ scheduled: 'Planlandı', checked_in: 'Giriş yapıldı', report_submitted: 'Rapor gönderildi, teslim kabulü bekleniyor', accepted: 'İşletme teslim kabul etti', disputed: 'İşletme itiraz etti' } as Record<string, string>)[j.status] ?? j.status}</Text>
      {j.status === 'scheduled' ? (
        <>
          <Field label="İşletmenin gösterdiği giriş kodu" testID="pro-code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={8} />
          <GhostButton testID="pro-checkin" label="Giriş yap" disabled={code.length !== 8} onPress={() => run(() => call('POST', `/pro/jobs/${j.id}/check-in`, { code }))} />
          <Text style={type(11, 400, { color: C.t3 })}>Giriş yalnızca yerinde bulunduğunu kaydeder; işin yapıldığını kanıtlamaz.</Text>
        </>
      ) : null}
      {j.status === 'checked_in' ? (
        <>
          <Field label="Hizmet raporu" testID="pro-report" value={report} onChangeText={setReport} multiline placeholder="Ne yapıldı, hangi ölçümler alındı, hangi parçalar kullanıldı?" />
          <GhostButton testID="pro-report-submit" label="Raporu gönder" disabled={report.trim().length < 20} onPress={() => run(() => call('POST', `/pro/jobs/${j.id}/report`, { report: report.trim() }))} />
        </>
      ) : null}
      {j.business_note ? <Text style={type(12, 400, { color: C.t2 })}>İşletmenin notu: {j.business_note}</Text> : null}
      {error ? <ErrorBox message={error} /> : null}
    </Card>
  );
}
