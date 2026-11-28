import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api, errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, Field, Loading } from '../../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, PrimaryButton, Tap } from '../../components/ui';
import { pickFile } from '../../features/files';
import { Avatar } from '../../features/network';
import { useUi } from '../../state/app';
import { C, tint, type } from '../../theme';

type Me = { hasProfile: boolean; specialties: string[]; note: string };
type Category = { code: string; name: string };
type Exp = { id: string; role_title: string; organization: string; start_year: number; end_year: number | null; description: string };
type Profile = { hasPhoto: boolean; declared: { displayName: string; title: string; bio: string; city: string; district: string | null; specialties: string[];
  categories: { code: string }[]; experience: Exp[] }; contact: { phone: string | null; showEmail: boolean; showPhone: boolean; email: string | null } };

function Check({ on, label, onPress, testID }: { on: boolean; label: string; onPress: () => void; testID: string }) {
  return (
    <Tap testID={testID} onPress={onPress} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
      <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: on ? C.lime : C.t3, backgroundColor: on ? C.accent : 'transparent' }} />
      <Text style={[type(12.5, 500, { lh: 1.4 }), { flex: 1 }]}>{label}</Text>
    </Tap>
  );
}

/** The person's own statement. It is not a service approval; contact details stay hidden unless switched on. */
export default function ProfileEditRoute() {
  const { call, token, userId, me: session } = useSession();
  const { showToast } = useUi();
  const me = useApi<Me>('/network/me');
  const cats = useApi<Category[]>('/service-categories');
  const prof = useApi<Profile>(me.data?.hasProfile && userId ? `/network/profiles/${userId}` : null);
  const [f, setF] = useState({ displayName: session?.displayName ?? '', title: '', bio: '', city: '', district: '', phone: '', showEmail: false, showPhone: false });
  const [specs, setSpecs] = useState<string[]>([]);
  const [catSel, setCatSel] = useState<string[]>([]);
  const [exp, setExp] = useState({ roleTitle: '', organization: '', startYear: '', endYear: '', description: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoV, setPhotoV] = useState(0);
  const loaded = !!prof.data;
  useEffect(() => {
    const d = prof.data?.declared;
    if (!d) return;
    setF({ displayName: d.displayName, title: d.title, bio: d.bio, city: d.city, district: d.district ?? '', phone: prof.data!.contact.phone ?? '',
      showEmail: prof.data!.contact.showEmail, showPhone: prof.data!.contact.showPhone });
    setSpecs(d.specialties); setCatSel(d.categories.map(c => c.code));
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const has = !!me.data?.hasProfile;
  const toggle = (list: string[], set: (x: string[]) => void, v: string) => set(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await call('POST', '/network/profile', { displayName: f.displayName, title: f.title, bio: f.bio, city: f.city, district: f.district || null, specialties: specs, categories: catSel,
        phone: f.phone || null, showEmail: f.showEmail, showPhone: f.showPhone });
      showToast('Profil kaydedildi');
      if (!has) { await me.reload(); } else { await prof.reload(); }
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const photo = async () => {
    setError(null);
    try {
      const file = await pickFile('photo', 2 * 1024 * 1024);
      if (!file) return;
      await api('PUT', '/network/profile/photo', { token, bytes: { data: file.bytes, mime: file.mime } });
      await prof.reload(); setPhotoV(v => v + 1); showToast('Fotoğraf yüklendi');
    } catch (e) { setError(errorText(e)); }
  };
  const addExp = async () => {
    setError(null);
    try {
      await call('POST', '/network/experience', { roleTitle: exp.roleTitle, organization: exp.organization, startYear: Number(exp.startYear), endYear: exp.endYear ? Number(exp.endYear) : null, description: exp.description });
      setExp({ roleTitle: '', organization: '', startYear: '', endYear: '', description: '' }); await prof.reload();
    } catch (e) { setError(errorText(e)); }
  };

  if (!me.data || (has && !prof.data)) return <Screen title="Ağ profili" titleEn="Network profile">{me.error || prof.error ? <ErrorBox message={(me.error || prof.error)!} /> : <Loading />}</Screen>;
  return (
    <Screen title={has ? 'Profili düzenle' : 'Profil oluştur'} titleEn="Network profile">
      <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>{me.data.note} Burada yazdıkların kişisel beyandır. Kontrol edilmiş belgeler ve platformda doğrulanmış hizmet geçmişi profilinde ayrı gösterilir.</Text>
      {has ? (
        <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Avatar key={photoV} userId={userId!} has={!!prof.data?.hasPhoto} name={f.displayName || '?'} size={56} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={type(12, 400, { color: C.t3, lh: 1.4 })}>JPEG ya da PNG, en fazla 2 MB. Yalnız giriş yapmış ağ kullanıcıları görür.</Text>
            <GhostButton testID="net-photo" label={prof.data?.hasPhoto ? 'Fotoğrafı değiştir' : 'Fotoğraf ekle'} height={36} size={12} onPress={photo} />
          </View>
        </Card>
      ) : null}
      <Field label="Ad soyad" testID="net-name" value={f.displayName} onChangeText={v => setF({ ...f, displayName: v })} />
      <Field label="Unvan" testID="net-title" value={f.title} onChangeText={v => setF({ ...f, title: v })} placeholder="ör. Soğutma teknisyeni" />
      <Field label="Kısa tanıtım" testID="net-bio" value={f.bio} onChangeText={v => setF({ ...f, bio: v })} multiline />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Field label="İl" testID="net-city" value={f.city} onChangeText={v => setF({ ...f, city: v })} /></View>
        <View style={{ flex: 1 }}><Field label="İlçe (isteğe bağlı)" testID="net-district" value={f.district} onChangeText={v => setF({ ...f, district: v })} /></View>
      </View>
      <Text style={type(12.5, 600)}>Uzmanlık alanları</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {me.data.specialties.map(s => <FilterChip key={s} testID={`net-spec-${s}`} label={s} px={11} active={specs.includes(s)} onPress={() => toggle(specs, setSpecs, s)} />)}
      </View>
      <Text style={type(12.5, 600)}>Hizmet kategorileri</Text>
      <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Beyan ettiğin kategoriler aramada görünür. Teklif verebilmek için kategori bazlı onay ayrıca gerekir (Uzman alanı).</Text>
      {!cats.data ? <Loading /> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {cats.data.map(c => <FilterChip key={c.code} testID={`net-cat-${c.code}`} label={c.name} px={11} active={catSel.includes(c.code)} onPress={() => toggle(catSel, setCatSel, c.code)} />)}
        </View>
      )}
      <Card style={{ gap: 10 }}>
        <Eyebrow>İLETİŞİM · VARSAYILAN OLARAK GİZLİ</Eyebrow>
        <Field label="Telefon (isteğe bağlı)" testID="net-phone" value={f.phone} onChangeText={v => setF({ ...f, phone: v })} keyboardType="phone-pad" />
        <Check testID="net-show-email" on={f.showEmail} label="E-postamı ağ kullanıcılarına göster" onPress={() => setF({ ...f, showEmail: !f.showEmail })} />
        <Check testID="net-show-phone" on={f.showPhone} label="Telefonumu ağ kullanıcılarına göster" onPress={() => setF({ ...f, showPhone: !f.showPhone })} />
        <Text style={type(11, 400, { color: C.t3, lh: 1.4 })}>Belge dosyaların ağda hiçbir zaman gösterilmez; yalnız hangi belgenin nasıl kontrol edildiği görünür.</Text>
      </Card>
      {error ? <ErrorBox message={error} /> : null}
      <PrimaryButton testID="net-save" label={busy ? 'Kaydediliyor…' : has ? 'Kaydet' : 'Profili oluştur'} disabled={busy} onPress={save} />

      {has ? (
        <Card style={{ gap: 10 }}>
          <Eyebrow>DENEYİM · KİŞİSEL BEYAN</Eyebrow>
          {(prof.data?.declared.experience ?? []).map(x => (
            <View key={x.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={type(13, 600)}>{x.role_title}{x.organization ? ` · ${x.organization}` : ''}</Text>
                <Text style={type(11.5, 400, { color: C.t3 })}>{x.start_year}–{x.end_year ?? 'devam'}{x.description ? ` · ${x.description}` : ''}</Text>
              </View>
              <Tap testID={`net-exp-del-${x.id}`} onPress={async () => { try { await call('POST', `/network/experience/${x.id}/delete`, {}); await prof.reload(); } catch (e) { setError(errorText(e)); } }}>
                <Text style={type(12, 600, { color: C.crit })}>Sil</Text>
              </Tap>
            </View>
          ))}
          <Field label="Görev / unvan" testID="net-exp-role" value={exp.roleTitle} onChangeText={v => setExp({ ...exp, roleTitle: v })} />
          <Field label="Kurum (isteğe bağlı)" testID="net-exp-org" value={exp.organization} onChangeText={v => setExp({ ...exp, organization: v })} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Field label="Başlangıç yılı" testID="net-exp-start" value={exp.startYear} onChangeText={v => setExp({ ...exp, startYear: v.replace(/\D/g, '') })} keyboardType="number-pad" /></View>
            <View style={{ flex: 1 }}><Field label="Bitiş (boşsa devam)" testID="net-exp-end" value={exp.endYear} onChangeText={v => setExp({ ...exp, endYear: v.replace(/\D/g, '') })} keyboardType="number-pad" /></View>
          </View>
          <Field label="Kısa açıklama (isteğe bağlı)" testID="net-exp-desc" value={exp.description} onChangeText={v => setExp({ ...exp, description: v })} />
          <GhostButton testID="net-exp-add" label="Deneyim ekle" height={40} size={12.5} disabled={exp.roleTitle.trim().length < 2 || exp.startYear.length !== 4} onPress={addExp} />
        </Card>
      ) : null}
      {has ? <GhostButton testID="net-view-profile" label="Profilimi gör" onPress={() => router.replace(`/network/p/${userId}`)} /> : null}
      <View style={{ height: 1, backgroundColor: tint.white(0.04) }} />
    </Screen>
  );
}
