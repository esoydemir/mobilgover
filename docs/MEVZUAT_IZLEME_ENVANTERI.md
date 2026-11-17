# Mevzuat izleme envanteri — kafe/restoran gıda güvenliği

Erişim tarihi: **18.11.2026** · Kapsam: kafe/restoran (toplu tüketim yeri) gıda güvenliği. Belediye, yangın, İSG ve diğer sektörler kapsam dışı.

> Bu belge **kaynak doğrulamasını** (metin resmî kaynaktan okundu mu) **uzman uygulanabilirlik onayından** ayrı tutar. Hiçbir satır uzman onaylı değildir. Hiçbir satır için yayımlanabilir kural yoktur. Rehberlerdeki sıcaklık/sıklık değerleri yasal sınır olarak yazılmamıştır.

## Doğrulama yöntemi

- Metinler `www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe` (birleştirilmiş metin) ve `www.resmigazete.gov.tr/eskiler/...` (yayım künyesi) adreslerinden **bu çalışma ortamında okundu** (HTTP 200). Okunan metinler `docs/kanit-canli/` altındaki özet dosyasında sayılarıyla durur.
- Arama motoru sonuçları ve ikincil siteler yalnız **bulma yardımcısı** olarak kullanıldı; hiçbiri doğrulama sayılmadı.
- Ortamdan `mevzuat.gov.tr` ilk denemede User-Agent'sız istekte zaman aşımı verdi; tarayıcı benzeri User-Agent ile erişildi (bağlayıcı kendi User-Agent'ını gönderir ve 3 deneme yapar). Kayıt: erişim **kararsız olabilir**, tek hata "değişiklik yok" sayılmaz (bkz. kaynak sağlığı).
- Erişilemeyen resmî kaynak: `tarimorman.gov.tr/GKGM/Belgeler/.../mevzuat-listesi-21.06.2023.pdf` (HTTP 404; liste kaldırılmış/taşınmış). Bakanlık mevzuat sayfası (`/GKGM/Menu/38/Mevzuat`) 200 döndü ama içeriği ayrıştırılıp doğrulanmadı.

## Altı izlenen kaydın yeniden doğrulaması (18.11.2026, nihai teslim)

Her satır resmî Mevzuat sayfasından yeniden okundu; "ayrıştırılan madde" sayısı bağlayıcının (`parseConsolidated`) çıkardığı sayıdır. **Üç durum ayrıdır:** *kaynak doğrulandı* ≠ *uzman uygulanabilirlik incelemesi bekliyor* ≠ *kural yayına onaylandı* (hiçbirinde yok).

| Kayıt | Resmî bağlantı | Belge no (tür/no/tertip) | İzlenen madde | Kaynak türü | Ayrıştırılan madde | Son doğrulama | Kaynak doğrulandı | Uzman incelemesi | Kural yayına onaylandı |
|---|---|---|---|---|---|---|---|---|---|
| E-01 Kanun 5996 | [Mevzuat](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=1&MevzuatNo=5996&MevzuatTertip=5) | 1 / 5996 / 5 | 22, 24, 29, 30, 31, 32, 36 (yedisi de metinle eşleşti) | Bağlayıcı kanun | **60** (önceden 59) | 18.11.2026 | Evet | Bekliyor | Hayır |
| E-02 Gıda Hijyeni Yön. | [Mevzuat](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=7&MevzuatNo=15592&MevzuatTertip=5) | 7 / 15592 / 5 | Tüm belge (öncelik 5, 10, 14, 17, 18, 21, 22) | Bağlayıcı yönetmelik | 31 | 18.11.2026 | Evet | Bekliyor | Hayır |
| E-03 Kayıt ve Onay Yön. | [Mevzuat](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=7&MevzuatNo=15594&MevzuatTertip=5) | 7 / 15594 / 5 | Tüm belge (öncelik 5, 6, 12, Ek-1, Ek-2) | Bağlayıcı yönetmelik | 16 | 18.11.2026 | Evet | Bekliyor | Hayır |
| E-04 Hijyen Eğitimi Yön. | [Mevzuat](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=7&MevzuatNo=18552&MevzuatTertip=5) | 7 / 18552 / 5 | Tüm belge (md. 2, 5, 9) | Bağlayıcı yönetmelik; kapsam HOLD | 14 | 18.11.2026 | Evet | Bekliyor | Hayır |
| E-05 Tebliğ 2014/47 | [Mevzuat](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=9&MevzuatNo=20147&MevzuatTertip=5) | 9 / 20147 / 5 | Tüm belge | Bağlayıcı tebliğ; ürüne özgü HOLD | 19 | 18.11.2026 | Evet | Bekliyor | Hayır |
| E-06 Tebliğ 2014/48 | [Mevzuat](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=9&MevzuatNo=20148&MevzuatTertip=5) | 9 / 20148 / 5 | Md. 4 (belge tamamı da izlenir) | Bağlayıcı tebliğ; ürüne özgü HOLD | 9 | 18.11.2026 | Evet | Bekliyor | Hayır |

E-07 (rehber, bağlayıcı değil, izlenmez) ve E-08 (künye doğrulanamadı, **tutuldu**) taranmaz; doğrulanamayan kaynak kuyruğa bağlanmadı.

### Kanun 5996: iki ayrıştırma farkı (61 "MADDE" geçişi, 60 madde)

1. **`MADDE 10/Ç` gerçek bir hükümdü ve atlanıyordu** (ıslah amaçlı yetiştirici birlikleri). Numara Türkçe harf (`Ç`) taşıyordu; ilk ayrıştırıcı yalnız `A-Z` kabul ettiğinden hüküm bir önceki maddenin içine gömülüyordu. **Düzeltildi** (`legislation-sources.ts`, madde numarası deseni `\d+(?:\/[A-Za-z0-9ÇĞİÖŞÜçğıöşü]+)?`); regresyon testi `server/test/legislation-madde-numbers.test.ts`. İzlenen yedi maddeden hiçbiri bundan etkilenmedi.
2. **İkinci `GEÇİCİ MADDE 2` geçişi hüküm değil, değişiklik geçmişi tablosundaki bir atıftır** ("10, 10/A, …, GEÇİCİ MADDE 2" — 6589 sayılı Kanunun hangi maddeleri değiştirdiğini sayar). Satır başında değildir ve tire taşımaz; hüküm sayılmamalıdır, sayılmıyor. Aynı testle sabitlendi.

Diğer beş belgede metindeki madde geçişi sayısı ile ayrıştırılan sayı birebir eşit (fark yok). Kanunun RG künyesi (13.06.2010, 27610) Mevzuat sayfa başlığından alındı.

## Düzeltme (önceki araştırmaya göre)

`docs/kurallar/KAYNAK_ARASTIRMASI_P01-P05.md` "Madde 5: soğuk zinciri korumak ve kayıt altına almak" diyordu. Resmî metinde **Madde 5 genel sorumluluk** maddesidir; soğuk zincir hükmü **Madde 18(5) ve (6)**'dadır ve **"kayıt altına alma"** ifadesi bu maddelerde yoktur. Kayıt yükümlülüğü HACCP kapsamında Madde 22(2)(f)'de geçer. Önceki belgedeki ifade kural taslağında kullanılmamalıdır.

## Kayıtlar

Alan anlamları: **Kaynak doğrulandı** = resmî metin okundu ve künye eşleşti. **Uzman uygulanabilirlik incelemesi** = bekliyor (hepsi). **Yayımlanabilir kural** = yok (hepsi).

### E-01 · 5996 sayılı Veteriner Hizmetleri, Bitki Sağlığı, Gıda ve Yem Kanunu — **İZLE (seçili maddeler)**

| Alan | Değer |
|---|---|
| Künye | Kanun 5996 · Mevzuat: tür 1, tertip 5, no 5996 · [bağlantı](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=1&MevzuatNo=5996&MevzuatTertip=5) |
| İlk yayım / erişim | Kabul 11.06.2010; RG 13.06.2010 sayı 27610 / 18.11.2026 |
| Son değişiklik (okunan metinde) | **11.06.2026, 7584 sayılı Kanun** (md. 26 ve 27); etkilenen maddeler **5** (hayvan hastalık tazminatı) ve **36(f)** (hayvan sevk belgesi cezası) — ikisi de kafe/restoran dışı |
| İzlenecek madde | **22** (sorumluluklar), **24** (izlenebilirlik), **29** (hijyen esasları), **30** (kayıt ve onay), **31** (resmî kontroller), **32** (uygun olmayan ürün), **36** (idari para cezaları) ayrıca izlenir ama tutar kurala taşınmaz. Metinde 61 "MADDE" geçişi vardır; 60'ı hüküm, biri değişiklik geçmişi tablosundaki atıftır (bkz. yukarı); çoğu hayvan/bitki sağlığına ilişkindir. |
| Kapsamı belirleyen | Gıda işletmecisi olmak; (30. madde) kayıt/onay rejimi |
| Bağlayıcılık | Bağlayıcı hüküm (kanun) |
| Kaynak doğrulandı | **Evet** (metin okundu, künye eşleşti) |
| Uzman uygulanabilirlik incelemesi | Bekliyor |
| Yayımlanabilir kural | Yok |
| Gerekçe | **İZLE.** Üst dayanak; değişiklik yönetmelikleri etkiler. Madde filtresi gürültüyü önler (hayvan hastalığı maddeleri kafe için ilgisiz). |
| Uzmana soru | Md. 36 idari para cezası bendlerinden hangileri toplu tüketim yerine uygulanır? (Tutar kurala taşınmayacak; yalnız hangi ihlalin ceza doğurduğu bilgisi için.) |

### E-02 · Gıda Hijyeni Yönetmeliği — **İZLE (tüm belge)**

| Alan | Değer |
|---|---|
| Künye | Türk Gıda Kodeksi — Gıda Hijyeni Yönetmeliği · Mevzuat: tür 7, tertip 5, no 15592 · [bağlantı](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=7&MevzuatNo=15592&MevzuatTertip=5) |
| İlk yayım / erişim | RG 17.12.2011 sayı 28145 ([RG](https://www.resmigazete.gov.tr/eskiler/2011/12/20111217-5.htm)) / 18.11.2026 |
| Son değişiklik | Okunan birleştirilmiş metinde **değişiklik/mülga işareti bulunmadı** (0 adet). "Değişiklik yok" sonucu kesin değildir: metin işaretlenmemiş olabilir; uzman Resmî Gazete'den doğrulamalı. |
| İzlenecek madde | **Tüm belge** (31 madde); öncelikli: **5, 10, 14, 17, 18, 21, 22** |
| Kapsamı belirleyen | Gıda işletmecisi (genel). Özel hükümler faaliyete bağlı: temizlik/ekipman (14), personel (17), depolama/soğuk (18), eğitim (21), HACCP (22). |
| Bağlayıcılık | Bağlayıcı hüküm |
| Kaynak doğrulandı | **Evet** |
| Uzman uygulanabilirlik incelemesi | Bekliyor |
| Yayımlanabilir kural | Yok |
| Gerekçe | **İZLE.** Pilotun çekirdek dayanağı. |

Okunan hükümler (resmî metinden, bağlayıcı):
- **Md. 14(1)(a):** gıda ile temas eden malzeme/ekipman etkili temizlenir, gerekirse dezenfekte edilir; "bulaşma riskini önlemek için **yeterli sıklıkta**". Sayısal sıklık yoktur.
- **Md. 17:** personel kişisel temizlik, temiz ve uygun koruyucu kıyafet; hastalık/yara belirtisi olanın gıda ile teması engellenir; çalışan işletmeciye bildirir.
- **Md. 18(5):** patojen üremesine imkân verecek sıcaklıklarda tutulmaz, soğuk zincir kırılmaz; hazırlama/servis için **sınırlı süre** dış ortam sıcaklığı sağlık riski yoksa izinli. **Sayısal sıcaklık yok.** **Md. 18(6)**: düşük sıcaklıkta servis/saklama durumunda ısıl işlem sonrası "sağlık için risk oluşturmayacak sıcaklığa **derhal** soğutulur". **Md. 18(7)**: dondurulmuş gıdanın çözündürülmesi.
- **Md. 21:** personelin hijyen konularında kontrol/bilgilendirme/eğitimi; HACCP sorumlusunun yeterli eğitimi.
- **Md. 22(1)-(2):** HACCP ilkelerine dayalı prosedür; kritik limitler ve izleme **işletmenin kendi analizinde** belirlenir; (f) kanıtlama için belge ve kayıtlar.
- **Madde 5** yalnız genel sorumluluktur (bkz. Düzeltme).

Uzmana soru: HACCP'ın küçük kafelere uygulanma biçimi (Md. 22(5)) hangi işletmeleri kapsar? Sıcaklık izleme görevi yasal yükümlülük mü (Md. 18(5) + 22(2)(ç)), yoksa işletmenin kendi HACCP planından mı doğar?

### E-03 · Gıda İşletmelerinin Kayıt ve Onay İşlemlerine Dair Yönetmelik — **İZLE (tüm belge, 16 madde + ekler)**

| Alan | Değer |
|---|---|
| Künye | Mevzuat: tür 7, tertip 5, no **15594** · [bağlantı](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=7&MevzuatNo=15594&MevzuatTertip=5) |
| İlk yayım / erişim | RG 17.12.2011 sayı 28145 / 18.11.2026 |
| Son doğrulanan değişiklik | Okunan metinde değişiklik işaretleri: 10.01.2013, 07.01.2014, 30.12.2014, 26.07.2016, 24.11.2016, 21.12.2017, **08.07.2019 (RG 30825 mükerrer)** — son işaret 08.07.2019 |
| İzlenecek madde | **Tüm belge**; öncelikli **5, 6, 12, Ek-1, Ek-2** |
| Kapsamı belirleyen | Kayıt rejimi (Ek-1'de sayılan onaya tabi işletmeler dışındakiler, md. 5). "Toplu tüketim işletmecileri Ek-2'deki bilgi/belgelerle başvurur" (md. 6). Kayıt belgesi unvan, kişi, adres ve faaliyet konusu için geçerli; değişirse geçerliliğini kaybeder (md. 6). |
| Bağlayıcılık | Bağlayıcı hüküm |
| Kaynak doğrulandı | **Evet** |
| Uzman uygulanabilirlik incelemesi | Bekliyor |
| Yayımlanabilir kural | Yok |
| Gerekçe | **İZLE.** Kayıt belgesi yükümlülüğü ve değişiklikte yenileme. |

Düzeltme: önceki araştırma RG tarihini "10.01.2013" değişiklik olarak anmıştı; ilk yayım 17.12.2011. Uzmana soru: Kafe, Ek-1 kapsamına (onay) girer mi, yoksa kayıt mı? Faaliyet değişikliğinde (ör. yeni ürün grubu) kayıt belgesi güncellemesi hangi süre içinde yapılır? (Süre metinden çıkarılmadı.)

### E-04 · Hijyen Eğitimi Yönetmeliği — **İZLE (tüm belge, 14 madde) — uygulanabilirlik HOLD**

| Alan | Değer |
|---|---|
| Künye | Mevzuat: tür 7, tertip 5, no **18552** · [bağlantı](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=7&MevzuatNo=18552&MevzuatTertip=5) |
| İlk yayım / erişim | RG 05.07.2013 sayı 28698 ([RG](https://www.resmigazete.gov.tr/eskiler/2013/07/20130705-3.htm)) / 18.11.2026 |
| Son değişiklik | Okunan metinde değişiklik işareti **bulunmadı** (kesin değil; bkz. E-02 notu) |
| İzlenecek madde | **Md. 2** (kapsam), **5** (belge sahibi çalıştırma), **9** (çalışmaya engel hastalıklar); belgenin tamamı da izlenir |
| Kapsamı belirleyen | "Gıda üretim ve perakende iş yerleri" (md. 2); işletmeci ve işletenin sorumluluğu (md. 5). Çalışan sayısı > 0. |
| Bağlayıcılık | Bağlayıcı hüküm |
| Kaynak doğrulandı | **Evet** |
| Uzman uygulanabilirlik incelemesi | Bekliyor |
| Yayımlanabilir kural | Yok |
| Gerekçe | İzle. **Uygulanabilirlik HOLD:** "gıda üretim ve perakende iş yeri" tanımının toplu tüketim yerini kapsadığı varsayılmamalı. |

Uzmana soru: Kafe/restoran bu yönetmeliğin "perakende iş yeri" kapsamında mı? Belge geçerlilik süresi var mı? Metinde sayısal süre aranmadı ve yazılmadı. Md. 4'ün tanımına (Genel Müdürlük belgesi) göre kuralda "belge geçerli mi" ayrı yükümlülük olarak mı yazılmalı?

### E-05 · Türk Gıda Kodeksi Hızlı Dondurulmuş Gıdalar Tebliği (2014/47) — **ÜRÜNE ÖZGÜ · HOLD**

| Alan | Değer |
|---|---|
| Künye | Mevzuat: **tür 9 (Tebliğ)**, tertip 5, no **20147** · [bağlantı](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=9&MevzuatNo=20147&MevzuatTertip=5) |
| İlk yayım / erişim | RG 18.10.2014 sayı 29149 ([RG](https://www.resmigazete.gov.tr/eskiler/2014/10/20141018-5.htm)) / 18.11.2026 |
| Son değişiklik | Değişiklik işareti **bulunmadı** |
| İzlenecek madde | Tüm belge (kısa) |
| Kapsamı belirleyen | **Ürün:** "hızlı dondurulmuş gıdalar"; dondurma ve yenilebilir buzlar kapsam dışı (md. 2). Tanım (md. 4): ürünün tüm noktaları −18 °C veya altında. |
| Bağlayıcılık | Bağlayıcı hüküm — ancak **ürün tanımına** bağlı |
| Kaynak doğrulandı | **Evet** |
| Uzman uygulanabilirlik incelemesi | Bekliyor |
| Yayımlanabilir kural | Yok |
| Gerekçe | **HOLD (ürüne özgü).** Restoranın kendi dondurucusundaki ürünlere uygulanıp uygulanmadığı belirsiz. −18 °C bir **ürün tanımı**dır; işletme dondurucusu için yasal limit olarak kuralda **kullanılmaz**. |

Uzmana soru: Hazır hızlı dondurulmuş ürün satın alıp saklayan toplu tüketim yeri bu tebliğin "depolama" hükümlerine tabi mi? Tebliğ −18 °C'yi işletme dondurucusu için bir limit olarak koyuyor mu, yoksa yalnız ürünün tanımı mı?

### E-06 · Hızlı Dondurulmuş Gıdaların Depolanması, Muhafazası ve Taşınması Sırasında Sıcaklığın İzlenmesi Hakkında Tebliğ (2014/48) — **ÜRÜNE ÖZGÜ · HOLD**

| Alan | Değer |
|---|---|
| Künye | Mevzuat: tür 9, tertip 5, no **20148** · [bağlantı](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=9&MevzuatNo=20148&MevzuatTertip=5) |
| İlk yayım / erişim | RG 18.10.2014 sayı 29149 ([RG](https://www.resmigazete.gov.tr/eskiler/2014/10/20141018-6.htm)) / 18.11.2026 |
| Son değişiklik | Değişiklik işareti **bulunmadı** |
| İzlenecek madde | **Md. 4** (genel hükümler: sıcaklık kaydı, cihaz standardı, kayıt saklama süresi, perakende istisnaları) |
| Kapsamı belirleyen | **Ürün + süreç:** hızlı dondurulmuş gıdanın depolanması/muhafazası/taşınması. Md. 4(e): perakende satış yerlerinde **10 m³'ten küçük** soğuk hava depoları için kolay görülür termometre yeterli olabilir. Geçici madde: uyum 01.10.2017'ye kadardı. |
| Bağlayıcılık | Bağlayıcı hüküm — ürün tanımına bağlı |
| Kaynak doğrulandı | **Evet** |
| Uzman uygulanabilirlik incelemesi | Bekliyor |
| Yayımlanabilir kural | Yok |
| Gerekçe | **HOLD (ürüne özgü).** Md. 4(b) "sık ve düzenli aralıklarla" der; **sayısal sıklık yoktur**. Md. 4(ç) kayıtların **en az bir yıl** saklanmasını söyler; bu, kural taslağına ancak uzman uygulanabilirliği onaylarsa girer. |

Uzmana soru: Md. 4(ç)'deki bir yıllık kayıt saklama süresi restoranın dondurucu kayıtlarına uygulanır mı? "Sık ve düzenli" için uzman yorumu var mı? Cihaz standartları (TS EN 12830, 13485, 13486) kafe ölçüm cihazı için aranır mı?

### E-07 · Toplu Tüketim Yerleri İçin İyi Hijyen Uygulamaları Rehberi — **REHBER · İZLENMEZ**

| Alan | Değer |
|---|---|
| Künye | Tarım ve Orman Bakanlığı (Isparta İl Müdürlüğü yayını) · [PDF](https://isparta.tarimorman.gov.tr/BelgelerArsiv/G%C4%B1da%20ve%20Yem/Hijyen%20Uygulama%20Rehberleri/toplutuketimhijyen.pdf) |
| Erişim | 18.11.2026, HTTP 200, PDF, 1,2 MB |
| Bağlayıcılık | **Resmî rehber — bağlayıcı hüküm değil**; işletmenin kendi prosedürü de değil |
| Kaynak doğrulandı | **Kısmen:** belge erişildi; içindeki sayısal değerler (ör. sıcak tutma) bu çalışmada **yeniden okunmadı**. |
| Uzman uygulanabilirlik incelemesi | Bekliyor |
| Yayımlanabilir kural | Yok |
| Gerekçe | **İZLEME DIŞI.** PDF, mevcut bağlayıcılarla (HTML) taranamaz; rehberdeki sıcaklık/süre değerleri yasal limit olarak kurala **yazılmaz** ("iyi uygulama — Bakanlık rehberi" etiketiyle ancak uzman onayıyla). |

### E-08 · Biyosidal Ürünler Yönetmeliği (dezenfektan ruhsatı) — **BULUNAMADI · HOLD**

| Alan | Değer |
|---|---|
| Künye | **Doğrulanamadı.** Önceki araştırmada künye bulunamamıştı; bu çalışmada da resmî metne ulaşılmadı. |
| Kaynak doğrulandı | **Hayır** |
| Gerekçe | Temizlik/dezenfeksiyon planı kural taslağı (P-05) bu yönetmeliğe dayandırılmadan önce uzman künyeyi bulup doğrulamalıdır. İzleme listesine eklenmedi. |

Uzmana soru: Dezenfektan ruhsatı için yürürlükteki yönetmelik hangisi (künye ve madde)?

## Faaliyet / ürün / işletme özelliklerine göre kapsam özeti

| Konu | Genel işletmeci hükmü | Ürün/faaliyete özgü hüküm |
|---|---|---|
| Soğuk zincir (soğutucu) | E-02 md. 18(5)-(6) (sayısal sınır yok) | — |
| Dondurulmuş gıda | E-02 md. 18(7) | E-05, E-06 (hızlı dondurulmuş ürün) — HOLD |
| Personel hijyeni | E-02 md. 17, 21 | E-04 (belge) — kapsam HOLD |
| Temizlik/dezenfeksiyon | E-02 md. 14(1)(a) ("yeterli sıklıkta") | E-08 — künye yok |
| Kayıt | E-03 | — |
| HACCP | E-02 md. 22 | — |

## Makine okunur izleme listesi

Mevcut `LEGISLATION_MEVZUAT_WATCH` biçimi (`tür:no:tertip:ad`) bu envanteri taşır; **yeni yapı gerekmedi** (madde bazlı fark zaten bağlayıcıda var). Tek ekleme: Kanun için gürültüyü azaltan **isteğe bağlı madde filtresi** (5. alan `m=22;24;29;30;31;32;36`), teknik gerekçe: 5996'nın çoğu maddesi hayvan/bitki sağlığıdır, filtre olmadan yeni kuyruk kayıtları kafe için ilgisiz olur.

```
1:5996:5:Kanun-5996:m=22;24;29;30;31;32;36,
7:15592:5:Gida-Hijyeni-Yonetmeligi,
7:15594:5:Kayit-ve-Onay-Yonetmeligi,
7:18552:5:Hijyen-Egitimi-Yonetmeligi,
9:20147:5:Hizli-Dondurulmus-Gidalar-Tebligi-2014-47,
9:20148:5:Dondurulmus-Gida-Sicaklik-Izleme-Tebligi-2014-48
```

Bu liste **kaynak doğrulanmış** belgelerin izlenmesidir; izlenen belgelerin herhangi bir hükmünün kural olarak yayımlanması uzman onayına bağlıdır. Kuyrukta çıkan kayıtlar gerçek kaynaktan geldiği için "örnek" değildir ama **yayım için uzman onayı** gerekir.
