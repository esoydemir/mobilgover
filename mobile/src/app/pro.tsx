import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { ErrorBox, ExampleBadge, Field, Loading, SectionLabel } from '../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, Pill, PrimaryButton } from '../components/ui';
import { addDays, fmtDate, fmtDateTime } from '../features/dates';
import { Invitations } from '../features/Invitations';
import { goRoot } from '../state/app';
import { QUOTE_STATUS, RISK_LABEL, credentialLabel } from '../features/labels';
import { useUi } from '../state/app';
import { C, tint, type } from '../theme';

type ProfileView = {
  profile: { id: string; display_name: string; headline: string; city: string; district: string | null; bio: string };
  identity: { status: string; checkedAt?: string; method?: string };
  credentials: { id: string; credential_type: string; issuer: string; valid_until: string | null; status: string; expired: boolean; checked_at: string | null; check_method: string | null }[];
  businessRegistration: { id: string; status: string }[];
  authorizedCategories: { category_code: string; name: string; is_example: boolean; valid_until: string | null }[];
  otherCategoryRequests: { category_code: string; name: string; status: string; expired: boolean; valid_until: string | null }[];
  notChecked: string[];
  disclaimer: string;
  serviceHistory?: { items: { month: string; category_name: string; city: string; quality: number; timeliness: number; communication: number; comment: string | null }[];
    summary: { count: number; quality: number | null; timeliness: number | null; communication: number | null }; note: string };
};
type Category = { code: string; name: string; required_credentials: string[]; is_example: boolean };
type Inbox = {
  requests: { id: string; category_name: string; title: string; description: string; city: string; created_at: string; my_quote_status: string | null;
    shared_ncr: { title: string; riskLevel: string; hazardType: string } | null }[];
  jobs: { id: string; status: string; title: string; company_name: string; site_name: string; checked_in_at: string | null; business_note: string | null; cancel_reason: string | null }[];
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
  const { companies } = useSession();
  const cats = q.data?.authorizedCategories ?? [];
  return (
    <Screen title="Uzman profili" titleEn="Professional profile">
      {q.error ? <ErrorBox message={q.error} /> : !q.data ? <Loading /> : <ProfileCard v={q.data} />}
      {q.data && companies.length > 0 ? (
        cats.length > 0 ? <PrimaryButton testID="pro-ask-quote" label="Bu uzmandan teklif iste" onPress={() => router.push({ pathname: '/service/new', params: { providerId: q.data!.profile.id, providerName: q.data!.profile.display_name, categories: cats.map(c => c.category_code).join(',') } })} />
          : <Text style={type(12, 500, { color: C.warn, lh: 1.45 })}>Bu uzmanın şu an onaylı hizmet kategorisi yok; teklif istenemez.</Text>
      ) : null}
    </Screen>
  );
}

function ProfileCard({ v }: { v: ProfileView }) {
  return (
    <>
      <Text style={type(22, 600, { family: 'outfit', ls: -0.03 })}>{v.profile.display_name}</Text>
      <Text style={type(13, 400, { color: C.t2 })}>{[v.profile.headline, v.profile.city, v.profile.district].filter(Boolean).join(' · ')}</Text>
      <Card>
        <Eyebrow>HAKKINDA · HİZMET BÖLGESİ</Eyebrow>
        <Text testID="pro-bio" style={[type(12.5, 400, { color: v.profile.bio ? C.t2 : C.t3, lh: 1.5 }), { marginTop: 8 }]}>{v.profile.bio || 'Uzman henüz tanıtım yazısı eklemedi.'}</Text>
        <Text testID="pro-region" style={[type(12.5, 600), { marginTop: 8 }]}>Bölge: {[v.profile.city, v.profile.district].filter(Boolean).join(' · ')}</Text>
      </Card>
      <Card>
        <Eyebrow>NE KONTROL EDİLDİ</Eyebrow>
        <Row label="Kimlik" status={v.identity.status} note={v.identity.method} />
        {v.credentials.map(c => <Row key={c.id} label={credentialLabel(c.credential_type)} status={c.expired ? 'expired' : c.status} note={`${c.issuer}${c.valid_until ? ` · ${c.valid_until}'e kadar` : ''}${c.check_method ? ` · ${c.check_method}` : ''}`} />)}
        {v.businessRegistration.map(b => <Row key={b.id} label="İşletme kaydı" status={b.status} />)}
        <Text style={[type(10.5, 600, { ls: 0.1, color: C.t3 }), { marginTop: 14 }]}>KONTROL EDİLMEYEN</Text>
        {v.notChecked.map(n => <Text key={n} style={[type(12, 400, { color: C.t2 }), { marginTop: 4 }]}>• {n}</Text>)}
      </Card>
      <Card>
        <Eyebrow>HİZMET VERME ONAYI (KATEGORİ BAZINDA)</Eyebrow>
        {v.authorizedCategories.length === 0 ? <Text style={[type(12.5, 400, { color: C.t2 }), { marginTop: 10 }]}>Henüz onaylı kategori yok; bu profil hizmet sunamaz.</Text> : null}
        {v.authorizedCategories.map(a => (
          <View key={a.category_code} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <Text style={[type(13, 600, { color: C.lime }), { flex: 1 }]}>✓ {a.name}{a.valid_until ? ` · ${fmtDate(a.valid_until)}'e kadar` : ''}</Text>
            {a.is_example ? <ExampleBadge label="ÖRNEK KATEGORİ" /> : null}
          </View>
        ))}
        {v.otherCategoryRequests.filter(a => a.expired).map(a => (
          <Text key={a.category_code} style={[type(12.5, 600, { color: C.crit }), { marginTop: 10 }]}>Süresi doldu: {a.name}. Yeni iş alınamaz; güncel belgeyle yeniden onay iste.</Text>
        ))}
      </Card>
      {v.serviceHistory ? (
        <Card>
          <Eyebrow>DOĞRULANMIŞ HİZMET GEÇMİŞİ</Eyebrow>
          {v.serviceHistory.summary.count === 0 ? <Text testID="pro-history-empty" style={[type(12.5, 400, { color: C.t2 }), { marginTop: 10 }]}>Profilde gösterilmesine izin verilmiş tamamlanmış iş yok.</Text> : (
            <Text testID="pro-history-summary" style={[type(13, 600), { marginTop: 10 }]}>{v.serviceHistory.summary.count} iş · kalite {v.serviceHistory.summary.quality} · zamanlama {v.serviceHistory.summary.timeliness} · iletişim {v.serviceHistory.summary.communication} (5 üzerinden)</Text>
          )}
          {v.serviceHistory.items.map((h, i) => (
            <View key={i} style={{ marginTop: 10, gap: 2 }}>
              <Text style={type(12.5, 600)}>{h.category_name} · {h.city} · {h.month.split('-').reverse().join('.')}</Text>
              <Text style={type(11.5, 400, { color: C.t3 })}>Kalite {h.quality} · zamanlama {h.timeliness} · iletişim {h.communication}</Text>
              {h.comment ? <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>"{h.comment}"</Text> : null}
            </View>
          ))}
          <Text style={[type(11, 400, { color: C.t3, lh: 1.45 }), { marginTop: 10 }]}>{v.serviceHistory.note}</Text>
        </Card>
      ) : null}
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
  const { call, companies } = useSession();
  const { showToast } = useUi();
  const [sending, setSending] = useState(false);
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
      {companies.length === 0 ? <Invitations onAccepted={() => goRoot('/')} /> : null}
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
            {credentialTypes.map(c => <FilterChip key={c} label={credentialLabel(c)} px={12} active={ver.credentialType === c} onPress={() => setVer(v => ({ ...v, credentialType: c }))} />)}
          </View>
        ) : null}
        <Field label="Veren kurum" testID="ver-issuer" value={ver.issuer} onChangeText={v => setVer(x => ({ ...x, issuer: v }))} />
        <Field label="Belge numarası / referans" testID="ver-ref" value={ver.documentRef} onChangeText={v => setVer(x => ({ ...x, documentRef: v }))} />
        {ver.kind !== 'identity' ? <Field label="Geçerlilik bitişi (YYYY-AA-GG)" value={ver.validUntil} onChangeText={v => setVer(x => ({ ...x, validUntil: v }))} placeholder="2028-12-31" /> : null}
        <GhostButton testID="ver-submit" label={sending ? 'Gönderiliyor…' : 'İncelemeye gönder'} disabled={sending || ver.issuer.trim().length < 2 || ver.documentRef.trim().length < 2 || (ver.kind === 'credential' && !ver.credentialType)}
          onPress={async () => {
            // One send per tap: the form empties on success so the same document is not submitted twice by accident.
            setSending(true);
            await act(async () => {
              await call('POST', '/pro/verifications', { kind: ver.kind, credentialType: ver.kind === 'credential' ? ver.credentialType : null, issuer: ver.issuer.trim(), documentRef: ver.documentRef.trim(), validUntil: ver.validUntil || null });
              setVer(v => ({ ...v, credentialType: '', issuer: '', documentRef: '', validUntil: '' }));
            }, 'Belge incelemeye gönderildi');
            setSending(false);
          }} />
        <Text style={type(11, 400, { color: C.t3, lh: 1.45 })}>Belgeni platformdaki bir inceleyici kontrol eder; kendi belgeni doğrulayamazsın.</Text>
      </Card>

      <SectionLabel>HİZMET KATEGORİLERİ</SectionLabel>
      {(cats.data ?? []).map(c => {
        const exp = me.data!.otherCategoryRequests.find(a => a.category_code === c.code && a.expired);
        const st = exp ? 'expired' : requested.get(c.code);
        return (
          <Card key={c.code} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[type(14, 600), { flex: 1 }]}>{c.name}</Text>
              {c.is_example ? <ExampleBadge label="ÖRNEK" /> : null}
            </View>
            <Text style={type(11.5, 400, { color: C.t3 })}>Gerekli: {c.required_credentials.map(credentialLabel).join(', ') || '—'} + doğrulanmış kimlik</Text>
            {st ? <Pill label={st === 'approved' ? 'ONAYLI' : st === 'pending' ? 'İNCELEMEDE' : st === 'expired' ? 'SÜRESİ DOLDU' : st === 'rejected' ? 'REDDEDİLDİ' : st === 'suspended' ? 'ASKIDA' : st.toUpperCase()} fg={st === 'approved' ? C.lime : st === 'pending' ? C.warn : C.crit} bg={tint.white(0.06)} style={{ alignSelf: 'flex-start' }} />
              : <GhostButton testID={`auth-${c.code}`} label="Bu kategori için başvur" height={38} size={12.5} onPress={() => act(() => call('POST', '/pro/authorizations', { categoryCode: c.code }), 'Başvuru gönderildi')} />}
          </Card>
        );
      })}

      {me.data ? <ProNotifications onChange={() => inbox.reload()} /> : null}
      <SectionLabel>AÇIK TALEPLER (ONAYLI KATEGORİLERİNDE)</SectionLabel>
      {inbox.data?.requests.length === 0 ? <Text style={type(12.5, 400, { color: C.t2 })}>Şu an açık talep yok. Talepler yalnızca onaylı olduğun kategorilerde görünür; işletme adı teklifin kabul edilince görünür.</Text> : null}
      {(inbox.data?.requests ?? []).map(r => <RequestCard key={r.id} r={r} onDone={() => inbox.reload()} />)}

      <SectionLabel>İŞLERİM</SectionLabel>
      {inbox.data && inbox.data.jobs.length === 0 ? <Text style={type(12.5, 400, { color: C.t2 })}>Henüz işin yok. Teklifin kabul edilince iş burada görünür.</Text> : null}
      {(inbox.data?.jobs ?? []).map(j => <JobCard key={j.id} j={j} onDone={() => inbox.reload()} />)}
      {companies.length === 0 ? <GhostButton testID="pro-to-setup" label="Kendi işletmemi de kurmak istiyorum" onPress={() => router.push('/setup')} /> : null}
    </Screen>
  );
}

function RequestCard({ r, onDone }: { r: Inbox['requests'][number]; onDone: () => void }) {
  const { call } = useSession();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ scope: '', exclusions: '', priceNet: '', vatRate: '20', materials: '', durationText: '', warrantyText: '', deliverable: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF(x => ({ ...x, [k]: v }));
  return (
    <View testID={`pro-req-${r.id}`}><Card style={{ gap: 8 }}>
      <Text style={type(11, 600, { ls: 0.08, color: C.t3 })}>{r.category_name.toUpperCase()} · {r.city} · {fmtDateTime(r.created_at)}</Text>
      <Text style={type(14.5, 600)}>{r.title}</Text>
      <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>{r.description}</Text>
      {r.shared_ncr ? <Text style={type(12, 500, { color: C.warn, lh: 1.45 })}>İşletmenin paylaştığı uygunsuzluk: {r.shared_ncr.title} · risk {RISK_LABEL[r.shared_ncr.riskLevel] ?? r.shared_ncr.riskLevel}</Text> : null}
      {r.my_quote_status ? <Text style={type(12, 600, { color: C.lime })}>Teklifin: {QUOTE_STATUS[r.my_quote_status] ?? r.my_quote_status}</Text> : !open ? (
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
          <Field label="Teslim edilecek çıktı" testID="q-deliv" value={f.deliverable} onChangeText={set('deliverable')} placeholder="ör. Servis raporu, öncesi/sonrası sıcaklık ölçümü" />
          {error ? <ErrorBox message={error} /> : null}
          <PrimaryButton testID="quote-submit" label="Teklifi gönder (3 gün geçerli)" height={46} size={13} disabled={f.deliverable.trim().length < 3}
            onPress={async () => {
              setError(null);
              try {
                await call('POST', `/pro/requests/${r.id}/quotes`, { ...f, priceNet: Number(f.priceNet.replace(',', '.')), vatRate: Number(f.vatRate), validUntil: addDays(new Date(), 3).toISOString() });
                onDone();
              } catch (e) { setError(errorText(e)); }
            }} />
        </View>
      )}
    </Card></View>
  );
}

function JobCard({ j, onDone }: { j: Inbox['jobs'][number]; onDone: () => void }) {
  const { call } = useSession();
  const [code, setCode] = useState('');
  const [report, setReport] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); onDone(); } catch (e) { setError(errorText(e)); } };
  return (
    <View testID={`pro-job-${j.id}`}><Card border={j.status === 'accepted' ? tint.lime(0.3) : C.bd} style={{ gap: 8 }}>
      <Text style={type(14.5, 600)}>{j.title}</Text>
      <Text style={type(12, 400, { color: C.t2 })}>{j.company_name} · {j.site_name}</Text>
      <Text testID="pro-job-status" style={type(12, 600, { color: j.status === 'accepted' ? C.lime : C.warn })}>{({ scheduled: 'Planlandı', checked_in: 'Giriş yapıldı', report_submitted: 'Rapor gönderildi, teslim kabulü bekleniyor', accepted: 'İşletme teslim kabul etti', disputed: 'İşletme itiraz etti', revision_requested: 'İşletme revizyon istedi: yeni rapor gönder', cancelled: 'İşletme işi iptal etti' } as Record<string, string>)[j.status] ?? j.status}</Text>
      {j.status === 'scheduled' ? (
        <>
          <Field label="İşletmenin gösterdiği giriş kodu" testID="pro-code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={8} />
          <GhostButton testID="pro-checkin" label="Giriş yap" disabled={code.length !== 8} onPress={() => run(() => call('POST', `/pro/jobs/${j.id}/check-in`, { code }))} />
          <Text style={type(11, 400, { color: C.t3 })}>Giriş yalnızca yerinde bulunduğunu kaydeder; işin yapıldığını kanıtlamaz.</Text>
        </>
      ) : null}
      {j.status === 'checked_in' || j.status === 'revision_requested' ? (
        <>
          <Field label={j.status === 'revision_requested' ? 'Revize hizmet raporu (önceki sürüm saklanır)' : 'Hizmet raporu'} testID="pro-report" value={report} onChangeText={setReport} multiline placeholder="Ne yapıldı, hangi ölçümler alındı, hangi parçalar kullanıldı?" />
          <GhostButton testID="pro-report-submit" label="Raporu gönder" disabled={report.trim().length < 20} onPress={() => run(() => call('POST', `/pro/jobs/${j.id}/report`, { report: report.trim() }))} />
        </>
      ) : null}
      {j.business_note ? <Text style={type(12, 400, { color: C.t2 })}>İşletmenin notu: {j.business_note}</Text> : null}
      {j.cancel_reason ? <Text style={type(12, 500, { color: C.crit })}>İptal gerekçesi: {j.cancel_reason}</Text> : null}
      {error ? <ErrorBox message={error} /> : null}
    </Card></View>
  );
}

type ProNote = { id: string; kind: string; title: string; body: string; created_at: string; read_at: string | null };
const PRO_TONE: Record<string, string> = { provider_new_request: C.info, quote_accepted: C.lime, quote_not_selected: C.t3, job_accepted: C.lime, job_disputed: C.crit, job_revision_requested: C.warn, job_cancelled: C.crit };

/** Provider-side notifications: new requests in approved categories, quote accepted / not selected, delivery result. */
function ProNotifications({ onChange }: { onChange: () => void }) {
  const { call } = useSession();
  const q = useApi<{ items: ProNote[]; unread: number }>('/pro/notifications');
  if (!q.data) return null;
  const readAll = async () => { await call('POST', '/pro/notifications/read', { ids: 'all' }); await q.reload(); onChange(); };
  return (
    <Card style={{ gap: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Eyebrow>BİLDİRİMLER{q.data.unread ? ` · ${q.data.unread} OKUNMAMIŞ` : ''}</Eyebrow>
        <View style={{ flex: 1 }} />
        {q.data.unread ? <GhostButton testID="pro-notes-read" label="Okundu say" height={30} size={11} onPress={readAll} /> : null}
      </View>
      {q.data.items.length === 0 ? <Text style={type(12, 400, { color: C.t2 })}>Henüz bildirim yok. Yeni talep, teklif kabulü ve teslim sonucu burada görünür.</Text> : null}
      {q.data.items.slice(0, 8).map(n => (
        <View key={n.id} testID={`pro-note-${n.kind}`} style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ width: 8, height: 8, borderRadius: 999, marginTop: 6, backgroundColor: n.read_at ? 'transparent' : (PRO_TONE[n.kind] ?? C.t2) }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type(13, n.read_at ? 500 : 700, { color: n.read_at ? C.t2 : C.t1 })}>{n.title}</Text>
            <Text style={type(11.5, 400, { color: C.t3, lh: 1.4 })}>{n.body} · {fmtDateTime(n.created_at)}</Text>
          </View>
        </View>
      ))}
    </Card>
  );
}
