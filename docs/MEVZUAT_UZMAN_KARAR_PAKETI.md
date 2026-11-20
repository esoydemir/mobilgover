# Dokuz uzman sorusu — karar paketi

Tarih: 18.11.2026 · Kapsam: kafe/restoran gıda güvenliği · Depo: `esoydemir/mobilgover`

**Bu paket kararı vermez.** Her soru için dayanak, madde/fıkra, kapsam koşulu, belirsizlik, önerilen görev, kanıt ve termin hazırdır; karar yetkili insanındır (alan uzmanı = `rule_author`/`rule_reviewer`, onay = `platform_admin`). Bekleyen kararlar **kaynakların okunmasını ve adayların kuyruğa alınmasını engellemez**.

**Üç ayrı durum** (hiçbir satırda ikincisi ve üçüncüsü yok): *kaynak doğrulandı* · *uzman uygulanabilirlik incelemesi bekliyor* · *kural yayına onaylandı*.

**Görev kaynağı üç sınıftan biridir, karıştırılmaz:** **BAĞ** = bağlayıcı hüküm (kanun/yönetmelik/tebliğ) · **REH** = resmî rehber (bağlayıcı değil, "iyi uygulama") · **HACCP** = işletmenin kendi HACCP planı.

**Karar yeri (gerçek kayıtlar, 8091):** giriş `http://127.0.0.1:8091/login` (demo yönetici/onaylayıcı/yazar/alan uzmanı hesapları). Taslaklar **yayımlanmamıştır** (durum `draft`, gerçek kaynaklı, `is_example=false`); hiçbiri işletmeye görev üretmez. Yetki: taslağı yazar düzenler, alan incelemesini alan uzmanı, onayı onaylayıcı verir; gerekçesiz onay reddedilir.

| Soru | Karar kaydı (gerçek bağlantı) | Ekran / işlem |
|---|---|---|
| 1 Sıcaklık izleme: yasal mı, HACCP mı | MV-P01 · http://127.0.0.1:8091/rule/1a8dfc2a-0f60-4c5a-b67f-3b653914cf02 ve MV-P03 · http://127.0.0.1:8091/rule/18d6f9bc-71f4-4e4d-a92d-1dbb95589809 | Kural taslağı → düzenle (sınıf) / alan incelemesi / onay-ret |
| 2 Hijyen Eğitimi kapsamı | MV-P04 · http://127.0.0.1:8091/rule/c36f4728-6b82-4317-825d-29f47bffe4fa | aynı |
| 3 2014/47-48 dondurucu | MV-P02 · http://127.0.0.1:8091/rule/4740c702-8a7b-427d-a32f-339e8b4c4cb5 | aynı |
| 4 Kayıt mı onay mı, süre | MV-P06 · http://127.0.0.1:8091/rule/f025e495-6923-4d0f-8ed3-17e06562e328 | aynı (yanıt taslağın belirsizlik notuna ve envantere işlenir) |
| 5 Dezenfektan künyesi | MV-P05 · http://127.0.0.1:8091/rule/bfab895b-eb15-422e-840c-3f15c12354e4 (belirsizlik notu: künye doğrulanamadı) | Künye gelirse izleme listesine eklenir; ayrı uygulama kaydı yok |
| 6 Temizlik sıklığı | MV-P05 · http://127.0.0.1:8091/rule/bfab895b-eb15-422e-840c-3f15c12354e4 | Kural taslağı → düzenle / onay-ret |
| 7 Md. 36 ceza bentleri | **Uygulamada karar kaydı yok** (görev üretilmez); yanıt `docs/MEVZUAT_IZLEME_ENVANTERI.md` E-01 notuna işlenir | — |
| 8 Peynir Tebliği (2026/24) | http://127.0.0.1:8091/legislation/cb66d445-0e07-4a76-b0a9-4fc510899baf | Mevzuat takibi → kayıt → *Yürürlük tarihini sen belirle (gerekçeli)* / *Reddet (gerekçeli)* |
| 9 Rehber değerleri | MV-P03 · http://127.0.0.1:8091/rule/18d6f9bc-71f4-4e4d-a92d-1dbb95589809 | Kural taslağı → onay-ret (rehber etiketi) |

**Taslaklardaki 01.12.2026 tarihi yer tutucudur.** Yetkili kişi (onaylayıcı/yönetici) kural ekranında gerçek tarihi ve dayanağını yazmadan taslak incelemeye gönderilemez, onaylanamaz, yayımlanamaz (`EFFECTIVE_NOT_CONFIRMED`); tarih inceleme başlayınca kilitlenir.

Gerçek taslak kimlikleri `rule_versions.id`'dir; taslaklar `docs/kanit-nihai-teslim/8091-taslaklar.json` içinde kayıtlıdır.

Termin: türetilemeyen yerde **"belirlenmedi"**; tarih uydurulmaz.

---

## 1 · Sıcaklık izleme görevi yasal yükümlülük mü, işletmenin HACCP'ından mı?

**Karar özeti:** "Soğutucu sıcaklığı izleme" görevi bağlayıcı bir sayı mı, yoksa işletmenin kendi HACCP kritik limitine dayalı görev mi sayılsın?

| Alan | İçerik |
|---|---|
| Resmî dayanak | [Gıda Hijyeni Yön.](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=7&MevzuatNo=15592&MevzuatTertip=5) Md. 18(5)–(6); Md. 22(1)–(2), 22(2)(f), 22(5) |
| Faaliyet | Soğuk zincirde ürün saklayan/servis eden kafe-restoran |
| Kapsam koşulu | Gıda işletmecisi; soğuk/sıcak tutma yapıyor |
| Okunan metin | Md. 18(5): patojen üremesine imkân verecek sıcaklıkta tutulmaz, soğuk zincir kırılmaz. **Sayısal sıcaklık yok.** Md. 22: kritik limitler işletmenin kendi analizinde belirlenir |
| Belirsizlik | Kanun sayı vermiyor; 22(5)'in hangi işletmeyi sadeleştirdiği net değil |
| Önerilen görev (MV-P01, MV-P03) | "Soğutucu sıcaklığını kendi limitinize göre ölçüp kaydedin" — **limit yazılmaz**. Sınıf: **HACCP** (BAĞ yalnız "soğuk zinciri kırma" ilkesi) |
| Kanıt | `docs/kanit-canli/metin`; envanter E-02 |
| Termin | belirlenmedi |
| Seçenekler | Onay: "işletme limiti" biçiminde hazırlanır · Düzelt: yalnız HACCP sınıfı · Reddet: kural yazılmaz |

## 2 · Hijyen Eğitimi Yönetmeliği kafe/restoranı kapsar mı?

**Karar özeti:** "Gıda üretim ve perakende iş yerleri" toplu tüketim yerini kapsıyor mu; belge geçerlilik süresi var mı?

| Alan | İçerik |
|---|---|
| Resmî dayanak | [Hijyen Eğitimi Yön.](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=7&MevzuatNo=18552&MevzuatTertip=5) Md. 2, 5, 9 |
| Faaliyet | Çalışanı olan kafe/restoran |
| Kapsam koşulu | Çalışan sayısı > 0 **ve** md. 2'nin toplu tüketim yerini kapsaması (HOLD) |
| Belirsizlik | Perakende tanımı kafeyi kapsıyor varsayılmadı; geçerlilik süresi metinde aranıp **bulunmadı**, yazılmadı |
| Önerilen görev (MV-P04) | "Çalışanların hijyen eğitimi belgesini yükleyin" — yalnız kapsam onaylanırsa. Sınıf: BAĞ |
| Kanıt | Envanter E-04 |
| Termin | belirlenmedi |
| Seçenekler | Onay (kapsıyor) · Reddet (kapsamıyor) · Düzelt (koşul/süre ekle) |

## 3 · 2014/47 ve 2014/48 toplu tüketim yerinin dondurucusuna uygulanır mı?

**Karar özeti:** Hızlı dondurulmuş gıda tebliğleri restoranın dondurucusuna uygulanır mı; −18 °C ürün tanımı mı, işletme limiti mi?

| Alan | İçerik |
|---|---|
| Resmî dayanak | [2014/47](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=9&MevzuatNo=20147&MevzuatTertip=5) Md. 2, 4 · [2014/48](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=9&MevzuatNo=20148&MevzuatTertip=5) Md. 4(b), 4(ç), 4(e) |
| Faaliyet | Hazır hızlı dondurulmuş ürün saklayan toplu tüketim yeri |
| Kapsam koşulu | Ürünün "hızlı dondurulmuş gıda" tanımına girmesi; dondurma/buz kapsam dışı |
| Belirsizlik | −18 °C bir **ürün tanımıdır**, işletme limiti olarak kullanılmaz. 4(ç) bir yıllık kayıt saklama ve 4(e) 10 m³ altı termometre istisnasının kafede geçerliliği belirsiz; "sık ve düzenli" için sayı yok |
| Önerilen görev (MV-P02) | Yalnız uzman onaylarsa "dondurucu sıcaklık kaydı" (BAĞ, ürüne özgü) |
| Kanıt | Envanter E-05, E-06 |
| Termin | belirlenmedi |
| Seçenekler | Onay · Reddet (MV-P02 yalnız HACCP kalır) · Düzelt |

## 4 · Kafe kayıt mı onay mı; faaliyet değişikliğinde süre

**Karar özeti:** Kafe/restoran *kayıt* (Ek-2) mi *onay* (Ek-1) rejiminde; faaliyet değişikliğinde güncelleme süresi nedir?

| Alan | İçerik |
|---|---|
| Resmî dayanak | [Kayıt ve Onay Yön.](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=7&MevzuatNo=15594&MevzuatTertip=5) Md. 5, 6, Ek-1, Ek-2 |
| Faaliyet | Kafe/restoran işletme kaydı |
| Kapsam koşulu | Md. 6: toplu tüketim işletmecileri Ek-2 ile başvurur; unvan/kişi/adres/faaliyet konusu değişirse belge geçerliliğini kaybeder |
| Belirsizlik | Yenileme **süresi metinden çıkarılmadı**, yazılmadı |
| Önerilen görev | Taslak MV-P06 (yayımlanmamış); yalnız uzman onaylarsa yayına hazırlanır |
| Kanıt | Envanter E-03 |
| Termin | belirlenmedi |
| Seçenekler | Yanıt envantere işlenir; kural açılacaksa kural yazarı açar |

## 5 · Dezenfektan ruhsatı: yürürlükteki yönetmelik hangisi?

**Karar özeti:** Biyosidal/dezenfektan için bağlayıcı yönetmeliğin künyesi nedir?

| Alan | İçerik |
|---|---|
| Resmî dayanak | **Yok — künye doğrulanamadı** (E-08); *kaynak doğrulandı = Hayır* |
| Belirsizlik | Doğrulanmamış yönetmeliğe dayanak yazılmaz; kaynak kuyruğa **bağlanmadı** |
| Önerilen görev (MV-P05) | Künye doğrulanana kadar HOLD |
| Termin | belirlenmedi |
| Seçenekler | Uzman künyeyi verir → izleme listesine eklenir ve doğrulanır · Verilmezse MV-P05 yalnız Md. 14'e dayanır |

## 6 · Temizlik/dezenfeksiyon "yeterli sıklık" nasıl göreve dönüşür?

**Karar özeti:** Md. 14(1)(a) "yeterli sıklıkta" ifadesi sayı olmadan hangi plan temelli görev olur?

| Alan | İçerik |
|---|---|
| Resmî dayanak | Gıda Hijyeni Yön. Md. 14(1)(a) |
| Faaliyet | Gıda ile temas eden ekipman/yüzey temizliği |
| Belirsizlik | Sayı yok; sıklık işletmenin risk analizine bırakılmış |
| Önerilen görev (MV-P05) | "Temizlik planınızı tanımlayın ve uygulandığını kaydedin" — sıklığı **işletme** belirler. Sınıf: HACCP (ilke: BAĞ) |
| Kanıt | Envanter E-02 |
| Termin | belirlenmedi |
| Seçenekler | Onay · Düzelt (ifade/sınıf) · Reddet |

## 7 · Kanun md. 36 idari para cezası: hangi bent toplu tüketim yerine uygulanır?

**Karar özeti:** Yalnız bilgi: hangi ihlal ceza doğurur. **Tutar kurala taşınmaz.**

| Alan | İçerik |
|---|---|
| Resmî dayanak | [Kanun 5996](https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=1&MevzuatNo=5996&MevzuatTertip=5) Md. 36 |
| Belirsizlik | Hangi bendin kafeye uyduğu uzman yorumu ister; 36(f) (hayvan sevk belgesi) kafe dışı |
| Önerilen görev | Yok |
| Termin | belirlenmedi |
| Seçenekler | Yanıt "ilgili ihlal listesi" notu olarak envantere işlenir |

## 8 · Peynir Tebliği (2026/24) — kuyruktaki gerçek kayıt

**Karar özeti:** RG 33426 (10.11.2026) Peynir Tebliği kafe/restoran için geçerli mi; 30/4/2027 geçiş tarihleri hangi işletme için ne anlama geliyor? **Kayıt incelemede kalır; hiçbir işletmeye görev üretmez.**

| Alan | İçerik (kayıt ayrıntısında ayrı alanlar) |
|---|---|
| Resmî dayanak | [Resmî Gazete 10.11.2026](https://www.resmigazete.gov.tr/eskiler/2026/11/20261110-7.htm), sayı 33426 |
| **Genel yürürlük hükmü** | Md. 22(1): "Bu Tebliğ yayımı tarihinde yürürlüğe girer." Md. 21: 8/5/2015 tarihli 29261 sayılı RG'deki Peynir Tebliği (2015/6) yürürlükten kaldırılmıştır |
| **Ürün hükmü** | Md. 2: 4. maddede tanımlanan tüm peynirleri kapsar. Geçici md. 1(3)–(4): **dilimlenebilir eritme peynir** için ayrı rejim (30/4/2027 sonrası uygunsuz olanlar piyasada bulunamaz); diğer peynirler raf ömrü sonuna kadar piyasada bulunabilir |
| **Faaliyet hükmü** | Tebliğ üreten/piyasaya arz eden işletmeciye yöneliktir; yalnız peyniri **servis eden** toplu tüketim yerinin yükümlülüğü metinde ayrıca belirtilmemiştir |
| **Geçiş hükmü** | Geçici md. 1(1)–(2): yayımdan önce faaliyette olanlar 30/4/2027'ye kadar uyar; o tarihe kadar eski tebliğ (2015/6) uygulanır |
| Kapsam koşulu | İşletme peynir üretiyor/arz ediyor mu, yalnız servis mi — uzman ayırır |
| Belirsizlik | **Tek geçiş tarihi tüm işletmelere uygulanmaz.** Sistem bu yüzden yürürlüğü **BELİRSİZ** işaretledi |
| Önerilen görev | **Yok.** Kapsam dışıysa reddedilir; kapsamdaysa uzman tarihi gerekçeyle belirler |
| Kanıt | `docs/kanit-canli/canli-gozlem.json`; ham sayfa `server/test/fixtures/legislation/rg-20261110-7-peynir-tebligi.htm`; test `legislation-effective-detail.test.ts` |
| Termin | belirlenmedi (genel: 10.11.2026; geçiş: 30/4/2027 — işletme türüne bağlı) |
| Karar yeri | **Mevzuat takibi → Peynir Tebliği satırı**: "Yürürlük ayrıntısı" bloğunu oku → *Yürürlük tarihini sen belirle (gerekçeli)* veya *Reddet (gerekçeli)*; sonra alan incelemesi ve onay |

## 9 · Toplu Tüketim İyi Hijyen Rehberi değerleri kullanılsın mı?

**Karar özeti:** Rehberdeki sıcak tutma/süre değerleri "iyi uygulama — Bakanlık rehberi" etiketiyle kullanılsın mı? **Yasal limit olarak yazılmaz.**

| Alan | İçerik |
|---|---|
| Resmî dayanak | [Rehber PDF](https://isparta.tarimorman.gov.tr/BelgelerArsiv/G%C4%B1da%20ve%20Yem/Hijyen%20Uygulama%20Rehberleri/toplutuketimhijyen.pdf) — **REH**, bağlayıcı değil |
| Belirsizlik | Sayısal değerler bu çalışmada **yeniden okunmadı**; PDF bağlayıcıyla taranamaz |
| Önerilen görev (MV-P03) | Rehber değeri yalnız "öneri" etiketiyle; işletme kendi limitini girer |
| Kanıt | Envanter E-07 |
| Termin | belirlenmedi |
| Seçenekler | Onay (öneri etiketli) · Reddet · Önce değerlerin okunması istenir |

---

Dokuz karar açıkken kaynaklar okunur, adaylar kuyruğa alınır, kayıtlar `bekliyor` kalır. Yayın, yürürlük günü ve işletme görev/bildirim üretimi yalnız **gerekçeli yetkili onaydan** sonra olur.
