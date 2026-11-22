import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, ExampleBadge, Field, Loading } from '../../components/states';
import { Card, Eyebrow, PrimaryButton, Tap, missingWhy } from '../../components/ui';
import { C, tint, type } from '../../theme';

type Category = { code: string; name: string; description: string; is_example: boolean };
type Provider = { id: string; display_name: string; headline: string; city: string; district?: string | null; verified_credentials: number; reviewed_jobs?: number; rating?: number | null };

/** The user describes the problem in their own words; the category is a routing choice, not a diagnosis. */
export default function NewServiceRoute() {
  const params = useLocalSearchParams<{ ncrId?: string; taskId?: string; title?: string; category?: string; providerId?: string; providerName?: string; categories?: string }>();
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
  const [pickMany, setPickMany] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [fq, setFq] = useState('');
  const [fcity, setFcity] = useState('');
  // Plain words → a suggested category (shown with the words it rests on; the user decides).
  const [sugg, setSugg] = useState<{ code: string; name: string; why: string }[]>([]);
  useEffect(() => {
    if (description.trim().length < 5 || params.providerId) { setSugg([]); return; }
    const t = setTimeout(() => { call<{ suggestions: { code: string; name: string; why: string }[] }>('GET', `/service-categories/suggest?text=${encodeURIComponent(description)}`)
      .then(r => setSugg(r.suggestions)).catch(() => setSugg([])); }, 400);
    return () => clearTimeout(t);
  }, [description, params.providerId, call]);
  // What a specialist will see, built by the server from exactly these fields.
  type Preview = { audience: string; shown: { label: string; value: string }[]; afterAward: string[]; never: string[] };
  const [preview, setPreview] = useState<{ key: string; data: Preview } | null>(null);
  const pkey = JSON.stringify([cat, title.trim(), description.trim(), city.trim(), shareNcr, chosen]);
  useEffect(() => {
    if (!company || !cat || title.trim().length < 3 || description.trim().length < 5 || city.trim().length < 2) { setPreview(null); return; }
    const t = setTimeout(() => {
      call<Preview>('POST', `/companies/${company.id}/service-requests/preview`, { siteId, categoryCode: cat, title: title.trim(), description: description.trim(), city: city.trim(),
        ncrId: params.ncrId ?? null, taskId: params.taskId ?? null, shareNcrSummary: !!params.ncrId && shareNcr, invitedProfileId: params.providerId ?? null, invitedProfileIds: chosen }).then(d => setPreview({ key: pkey, data: d })).catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(t);
  }, [pkey, company, siteId, call]); // eslint-disable-line react-hooks/exhaustive-deps
  const previewReady = preview?.key === pkey;
  const providers = useApi<Provider[]>(company && cat ? `/companies/${company.id}/providers?category=${cat}${fq.trim() ? `&q=${encodeURIComponent(fq.trim())}` : ''}${fcity.trim() ? `&city=${encodeURIComponent(fcity.trim())}` : ''}` : null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await call<{ id: string }>('POST', `/companies/${company!.id}/service-requests`, { siteId, categoryCode: cat, title: title.trim(), description: description.trim(), city: city.trim(), invitedProfileIds: chosen, ncrId: params.ncrId ?? null, taskId: params.taskId ?? null, shareNcrSummary: !!params.ncrId && shareNcr, invitedProfileId: params.providerId ?? null });
      router.replace(`/service/${r.id}`);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <Screen title="Hizmet talebi" titleEn="New service request">
      {params.providerId ? <Text testID="svc-invited" style={type(12.5, 600, { color: C.lime, lh: 1.45 })}>Talep yalnız {params.providerName ? `${params.providerName} adlı uzmana` : 'bu uzmana'} gidecek. Formu açmak sipariş ya da ücretli işlem oluşturmaz; teklif kabul etmedikçe iş başlamaz. Kategori onayı sunucuda yeniden kontrol edilir.</Text> : null}
      {params.ncrId ? <Text style={type(12.5, 600, { color: C.warn })}>Bu talep açık bir uygunsuzluğa bağlanacak. "Talebi aç"a basmadıkça talep oluşmaz; teklif kabul etmedikçe iş başlamaz. Uygunsuzluk, hizmet tamamlanınca kendiliğinden kapanmaz.</Text> : null}
      <Field label="Sorunu kendi cümlelerinle anlat" testID="svc-desc" value={description} onChangeText={setDescription} multiline placeholder="ör. Mutfak arkadaki buzdolabı 12 °C gösteriyor, kapı contası açık kalıyor." />
      <Field label="Kısa başlık" testID="svc-title" value={title} onChangeText={setTitle} />
      {sugg.length && !cat ? (
        <View testID="svc-suggest" style={{ borderWidth: 1, borderColor: tint.info(0.35), borderRadius: 16, padding: 12, gap: 6 }}>
          <Text style={type(11, 700, { ls: 0.08, color: C.info })}>ÖNERİLEN HİZMET TÜRÜ</Text>
          {sugg.map(sg => (
            <Tap key={sg.code} testID={`svc-suggest-${sg.code}`} onPress={() => setCat(sg.code)}>
              <Text style={type(13.5, 600)}>{sg.name} · seç ›</Text>
              <Text style={type(11.5, 400, { color: C.t3, lh: 1.4 })}>{sg.why}</Text>
            </Tap>
          ))}
        </View>
      ) : null}
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
      {cat && !params.providerId ? (
        <Card style={{ gap: 8 }}>
          <Eyebrow>KİMDEN TEKLİF İSTENSİN?</Eyebrow>
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
            <Tap testID="svc-to-open" onPress={() => { setPickMany(false); setChosen([]); }} style={{ paddingHorizontal: 13, height: 36, borderRadius: 999, justifyContent: 'center', borderWidth: 1, borderColor: !pickMany ? tint.lime(0.5) : C.bd }}>
              <Text style={type(12, 600, { color: !pickMany ? C.lime : C.t2 })}>Açık pazara yayınla</Text>
            </Tap>
            <Tap testID="svc-to-selected" onPress={() => setPickMany(true)} style={{ paddingHorizontal: 13, height: 36, borderRadius: 999, justifyContent: 'center', borderWidth: 1, borderColor: pickMany ? tint.lime(0.5) : C.bd }}>
              <Text style={type(12, 600, { color: pickMany ? C.lime : C.t2 })}>Seçtiğim uzmanlara gönder</Text>
            </Tap>
          </View>
          {pickMany ? (
            <>
              <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>2 ile 5 uzman seç; yalnız onlar talebi görür ve teklifler aynı sırayla karşılaştırılır. Dil ve müsaitlik bilgisi uzman profillerinde henüz tutulmuyor.</Text>
              <Field label="Ara (ad, başlık, tanıtım)" testID="svc-pf-q" value={fq} onChangeText={setFq} />
              <Field label="Şehir ile daralt" testID="svc-pf-city" value={fcity} onChangeText={setFcity} />
              {(providers.data ?? []).map(p => {
                const on = chosen.includes(p.id);
                return (
                  <Tap key={p.id} testID={`svc-pick-${p.id}`} onPress={() => setChosen(c => on ? c.filter(x => x !== p.id) : c.length < 5 ? [...c, p.id] : c)}
                    style={{ borderWidth: 1, borderColor: on ? tint.lime(0.5) : C.bd, borderRadius: 16, padding: 11, gap: 2 }}>
                    <Text style={type(13, 600, { color: on ? C.lime : C.t1 })}>{on ? '✓ ' : ''}{p.display_name}</Text>
                    <Text style={type(11.5, 400, { color: C.t2 })}>{p.headline} · {[p.city, p.district].filter(Boolean).join(' / ')} · {p.verified_credentials} doğrulanmış belge{p.reviewed_jobs ? ` · ${p.reviewed_jobs} değerlendirilmiş iş (${p.rating})` : ''}</Text>
                  </Tap>
                );
              })}
              <Text testID="svc-chosen-count" style={type(12, 600, { color: chosen.length === 1 ? C.warn : C.t2 })}>{chosen.length === 1 ? 'Bir uzman seçtin; tek uzman için profilinden "Teklif iste" kullan ya da en az 2 seç.' : `${chosen.length} uzman seçildi`}</Text>
            </>
          ) : null}
        </Card>
      ) : null}
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
      {previewReady ? (
        <View testID="svc-preview"><Card style={{ gap: 6 }}>
          <Eyebrow>ÖNİZLEME · UZMAN TAM OLARAK BUNU GÖRECEK</Eyebrow>
          <Text style={type(12, 600, { color: C.t2 })}>Kime: {preview!.data.audience}</Text>
          {preview!.data.shown.map(x => <Text key={x.label} style={type(12, 400, { color: C.t1, lh: 1.45 })}><Text style={{ color: C.t3 }}>{x.label}: </Text>{x.value}</Text>)}
          <Text style={type(11.5, 500, { color: C.t2, lh: 1.45 })}>Yalnız teklifi kabul edilen uzmana: {preview!.data.afterAward.join(', ')}.</Text>
          <Text style={type(11.5, 500, { color: C.lime, lh: 1.45 })}>Kapalı (paylaşılmaz): {preview!.data.never.join(', ')}.</Text>
        </Card></View>
      ) : cat && title.trim().length >= 3 && description.trim().length >= 5 ? <Text style={type(11.5, 400, { color: C.t3 })}>Önizleme hazırlanıyor… Bağlantı yoksa talep gönderilemez.</Text> : null}
      {error ? <ErrorBox message={error} /> : null}
      <PrimaryButton testID="svc-submit" label={busy ? 'Gönderiliyor…' : 'Önizlemeyi gördüm · talebi aç'} disabled={busy || !cat || title.trim().length < 3 || description.trim().length < 5 || !previewReady || (pickMany && chosen.length < 2)} why={missingWhy([[!cat, 'kategori'], [title.trim().length < 3, 'başlık (en az 3 karakter)'], [description.trim().length < 5, 'açıklama (en az 5 karakter)'], [!!cat && !previewReady, 'önizleme (yüklenmesini bekle)'], [pickMany && chosen.length < 2, 'en az 2 uzman seçimi']])} onPress={submit} />
    </Screen>
  );
}
