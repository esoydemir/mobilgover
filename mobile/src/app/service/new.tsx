import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, ExampleBadge, Field, Loading } from '../../components/states';
import { Card, Eyebrow, PrimaryButton, Tap } from '../../components/ui';
import { C, tint, type } from '../../theme';

type Category = { code: string; name: string; description: string; is_example: boolean };
type Provider = { id: string; display_name: string; headline: string; city: string; verified_credentials: number };

/** The user describes the problem in their own words; the category is a routing choice, not a diagnosis. */
export default function NewServiceRoute() {
  const params = useLocalSearchParams<{ ncrId?: string; title?: string; category?: string; providerId?: string; providerName?: string; categories?: string }>();
  const only = params.categories ? params.categories.split(',') : null;
  const { company, siteId, call } = useSession();
  const cats = useApi<Category[]>('/service-categories');
  const [cat, setCat] = useState<string | null>(params.category ?? (only?.length === 1 ? only[0]! : null));
  const [title, setTitle] = useState(params.title ?? '');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('İstanbul');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareNcr, setShareNcr] = useState(false);
  const providers = useApi<Provider[]>(company && cat ? `/companies/${company.id}/providers?category=${cat}` : null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await call<{ id: string }>('POST', `/companies/${company!.id}/service-requests`, { siteId, categoryCode: cat, title: title.trim(), description: description.trim(), city: city.trim(), ncrId: params.ncrId ?? null, shareNcrSummary: !!params.ncrId && shareNcr, invitedProfileId: params.providerId ?? null });
      router.replace(`/service/${r.id}`);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <Screen title="Hizmet talebi" titleEn="New service request">
      {params.providerId ? <Text testID="svc-invited" style={type(12.5, 600, { color: C.lime, lh: 1.45 })}>Talep yalnız {params.providerName ? `${params.providerName} adlı uzmana` : 'bu uzmana'} gidecek. Formu açmak sipariş ya da ücretli işlem oluşturmaz; teklif kabul etmedikçe iş başlamaz. Kategori onayı sunucuda yeniden kontrol edilir.</Text> : null}
      {params.ncrId ? <Text style={type(12.5, 600, { color: C.warn })}>Bu talep açık bir uygunsuzluğa bağlanacak. "Talebi aç"a basmadıkça talep oluşmaz; teklif kabul etmedikçe iş başlamaz. Uygunsuzluk, hizmet tamamlanınca kendiliğinden kapanmaz.</Text> : null}
      <Field label="Sorunu kendi cümlelerinle anlat" testID="svc-desc" value={description} onChangeText={setDescription} multiline placeholder="ör. Mutfak arkadaki buzdolabı 12 °C gösteriyor, kapı contası açık kalıyor." />
      <Field label="Kısa başlık" testID="svc-title" value={title} onChangeText={setTitle} />
      <Text style={type(12.5, 600)}>Hangi hizmet?</Text>
      <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Seçtiğin kategori bir teşhis değildir; yalnızca talebin hangi uzmanlara gideceğini belirler. Emin değilsen en yakın olanı seç, uzman kapsamı teklifinde netleştirir.</Text>
      {!cats.data ? <Loading /> : cats.data.filter(c => !only || only.includes(c.code)).map(c => (
        <Tap key={c.code} testID={`svc-cat-${c.code}`} onPress={() => setCat(c.code)} style={{ borderWidth: 1, borderColor: cat === c.code ? tint.lime(0.4) : C.bd, backgroundColor: cat === c.code ? tint.lime(0.06) : C.card, borderRadius: 18, padding: 14, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[type(14, 600), { flex: 1 }]}>{c.name}</Text>
            {c.is_example ? <ExampleBadge label="ÖRNEK KATEGORİ" /> : null}
          </View>
          <Text style={type(12, 400, { color: C.t2 })}>{c.description}</Text>
        </Tap>
      ))}
      {cat && providers.data && !params.providerId ? <Text style={type(12, 500, { color: providers.data.length ? C.t2 : C.warn })}>{providers.data.length ? `Bu kategoride onaylı ${providers.data.length} uzman var.` : 'Bu kategoride henüz onaylı uzman yok; talep yine de açılır.'}</Text> : null}
      <Field label="Şehir" value={city} onChangeText={setCity} />
      <Card style={{ gap: 8 }}>
        <Eyebrow>UZMANLARLA NE PAYLAŞILIR?</Eyebrow>
        <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>{params.providerId ? 'Davet ettiğin uzman' : 'Onaylı uzmanlar'} yalnızca başlığı, açıklamanı, şehri ve kategoriyi görür. İşletme ve şube adı ancak bir teklifi kabul edince o uzmana açılır. Görevlerin, kanıtların, ekibin ve diğer kayıtların hiçbir uzmana açılmaz.</Text>
        {params.ncrId ? (
          <Tap testID="svc-share-ncr" onPress={() => setShareNcr(x => !x)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: shareNcr ? C.lime : C.t3, backgroundColor: shareNcr ? C.lime : 'transparent' }} />
            <Text style={[type(12.5, 500), { flex: 1 }]}>Uygunsuzluğun başlığını, risk seviyesini ve türünü de paylaş (açıklama, notlar ve fotoğraflar paylaşılmaz)</Text>
          </Tap>
        ) : null}
      </Card>
      {error ? <ErrorBox message={error} /> : null}
      <PrimaryButton testID="svc-submit" label={busy ? 'Gönderiliyor…' : 'Talebi aç'} disabled={busy || !cat || title.trim().length < 3 || description.trim().length < 5} onPress={submit} />
    </Screen>
  );
}
