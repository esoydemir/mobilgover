# Kaynak araştırması: ilk beş aday konu (P-01 … P-05)

Tarih: 01.11.2026 · Durum: **İNCELEMENE SUNULUYOR. Hiçbir kural yayımlanmadı ya da uygulamaya taslak olarak bile aktarılmadı.**

## Okumadan önce: doğrulama düzeyi

Resmî metin kaynakları (`mevzuat.gov.tr`, `resmigazete.gov.tr`) bu çalışma ortamının ağ ayarlarında kapalı. Bu yüzden konsolide metinleri doğrudan açamadım. Aşağıdaki alıntılar arama sonuçlarındaki kopyalardan geliyor: Resmî Gazete'nin TÜRMOB/FAOLEX arşiv kopyaları, il müdürlüğü ve meslek kuruluşu yayınları. Her hüküm için doğrulama durumu ayrıca yazılı.

- **Kaynak bulundu — doğrulanmadı:** Hükmün varlığı ve yayın künyesi birden çok kopyada tutarlı. Güncel konsolide metin ve sonraki değişiklikler kontrol edilmedi.
- **Bulunamadı:** Aradığım biçimde (ör. sayısal sınır) bir hüküm bulamadım. Bu, böyle bir hüküm olmadığı anlamına gelmez; uzman kontrolü gerekir.

Etiketler:

- **YASAL** — mevzuat metninde geçen yükümlülük.
- **İYİ UYGULAMA** — resmî kurum rehberinde ya da sektör uygulamasında geçen öneri; tek başına yasal zorunluluk değildir.

Mevzuatta açıkça bulunmayan hiçbir sıklık ya da limit YASAL olarak yazılmadı.

## Ortak dayanaklar

| Düzenleme | Künye | İlgili hüküm (özet / alıntı) | Durum |
|---|---|---|---|
| Veteriner Hizmetleri, Bitki Sağlığı, Gıda ve Yem Kanunu | 5996 sayılı, 11.06.2010 | Gıda Hijyeni Yönetmeliği bu Kanunun 22, 24, 27–32 ve 34. maddelerine dayanıyor. | Kaynak bulundu — doğrulanmadı |
| **Türk Gıda Kodeksi — Gıda Hijyeni Yönetmeliği** | RG 17.12.2011, sayı 28145; Mevzuat Bilgi Sistemi no 15592 | Gıda işletmecisi, kontrolü altındaki bütün aşamalarda hijyen gerekliliklerinden sorumludur. Madde 5: soğuk zinciri korumak ve kayıt altına almak. Madde 22: HACCP ilkelerine dayalı prosedürü uygulamaya koymak, uygulamak ve sürdürmek. | Kaynak bulundu — doğrulanmadı. **2011 sonrası değişiklikler kontrol edilemedi.** |
| Gıda İşletmelerinin Kayıt ve Onay İşlemlerine Dair Yönetmelik | RG 17.12.2011 (değişiklik: RG 10.01.2013, sayı 28524 ve sonrası) | Perakende ve toplu tüketim işletmeleri **kayıt** rejimine tabidir (onay değil). Toplu tüketim yeri: gıdanın işlendiği, üretildiği ve aynı mekânda tüketime sunulduğu yer. | Kaynak bulundu — doğrulanmadı |

Kafe/restoran pilot kapsamı için ortak uygulanabilirlik ön koşulu: **gıda hazırlıyor ve aynı yerde tüketime sunuyor** (toplu tüketim yeri, kayıtlı gıda işletmesi). Bu koşul, uygulamadaki `activity.food_preparation = evet` bilgisine karşılık gelir.

**Uzmana sorulacak:** Pilotta tek bir işletme bilgisi yerine **"Gıda işletmesi kayıt belgesi var mı / kayıt numarası"** sorusunu da eklemeli miyiz? (Uygulamanın soru kataloğunda yok.)

---

## P-01 · Soğutucu (buzdolabı) sıcaklık kontrolü

**YASAL**

- *Gıda Hijyeni Yönetmeliği, Madde 5:* Gıda işletmecisi "Soğuk zinciri korumak ve kayıt altına almak" yükümlülüğü altındadır. Ayrıca "ortam sıcaklığında güvenilir bir şekilde muhafaza edilemeyen gıdalarda … soğuk zincirin korunması gereklidir." — *Kaynak bulundu — doğrulanmadı.*
- *Aynı Yönetmelik, Madde 18(5):* "Patojenik mikroorganizmaların üremesi veya toksin oluşumuna imkân verebilecek ham maddelerin, bileşenlerin, ara ve son ürünlerin sağlık riski oluşturabilecek sıcaklıklarda tutulmaması ve soğuk zincirin kırılmaması gerekir." — *Kaynak bulundu — doğrulanmadı.*
- *Aynı Yönetmelik, Madde 22:* HACCP ilkelerine dayalı prosedür. Kritik kontrol noktalarında izleme prosedürü kurulur. — *Kaynak bulundu — doğrulanmadı.*

**Bulunamadı:** Genel hijyen mevzuatında buzdolabı için **sayısal bir sıcaklık sınırı** ve **ölçüm sıklığı** bulamadım. Bulgulara göre sınır ve sıklık, işletmenin kendi tehlike analizinde (HACCP planı) ürün grubuna göre belirleniyor.

**İYİ UYGULAMA (yasal değil, ayrı gösterilir)**

- Uygulamadaki demo kuralında geçen 0–4 °C bir örnektir; kaynağı yoktur ve öyle kalmalı.
- Bu araştırmada soğutucu için sayısal değer veren resmî bir rehber bulmadım. Önerilecek bir varsayılan değer alan uzmanından ve işletmenin HACCP planından gelmeli.

**Önerilen uygulanabilirlik koşulu:** `activity.food_preparation = evet` VE `storage.cold = evet`. Ek ön koşul: toplu tüketim yeri.

**Önerilen kural biçimi:**

- Yasal kısım: "soğuk zinciri koru ve kayıt altına al".
- Görev: soğutucu sıcaklığını ölç ve kaydet; kanıt olarak ölçüm ve fotoğraf.
- Sıklık ve limit: alanlar "işletmenin HACCP planına göre" doldurulur. Uygulama bu değerleri işletmeden (ya da danışmanından) almalı; varsayılan değer iyi uygulama olarak ve etiketiyle gösterilmeli.

**Uzmana sorulacak:**

1. Pilot işletmeler için varsayılan bir limit verecek miyiz? Verirsek dayanağı ne olacak (HACCP planı ya da Bakanlık rehberi)?
2. Ölçüm sıklığı için yazılı bir Bakanlık rehberi var mı?

---

## P-02 · Dondurucu sıcaklık kontrolü

**YASAL**

- *Gıda Hijyeni Yönetmeliği, Madde 5:* Soğuk zincir; "özellikle dondurulmuş gıdalarda". — *Kaynak bulundu — doğrulanmadı.*
- *Türk Gıda Kodeksi Hızlı Dondurulmuş Gıdalar Tebliği (2014/47), RG 18.10.2014, sayı 29149:* Hızlı dondurulmuş gıdanın sıcaklığı ürünün her noktasında **−18 °C veya daha düşük** olmalı ve korunmalıdır. Kısa süreli artışta tolerans tanınır; bir kaynakta en fazla 3 °C, bu taslak metinden ve doğrulanmadı. — *Kaynak bulundu — doğrulanmadı.*
- *Sıcaklıkların izlenmesine ilişkin Tebliğ (2014/48):* Taşıma, depolama, dağıtım ve perakende dolaplarında sıcaklık izlenir; ortam sıcaklığı uygun cihazlarla "sık ve düzenli aralıklarla" kaydedilir. — *Kaynak bulundu — doğrulanmadı.*

**Kapsam belirsizliği:** Bu tebliğler "hızlı dondurulmuş gıda" ürünlerini ve tedarik zincirini (depolama, taşıma, perakende) düzenliyor. Bir restoranın kendi dondurucusunda sakladığı ürünlere −18 °C sınırının **yasal olarak** uzanıp uzanmadığını doğrulayamadım; ayrıca restoranın kendi dondurduğu ürünler bu tebliğin kapsamında olmayabilir.

**İYİ UYGULAMA:** Tebliğdeki −18 °C değeri, kapsam dışı kalsa bile iyi uygulama için doğal bir referans. Ölçüm sıklığı için kaynak bulmadım. Yasal dayanak uzman görüşüyle netleşmeli.

**Önerilen uygulanabilirlik koşulu:** `activity.food_preparation = evet` VE kayıtlı ekipmanda dondurucu var (`equipment.types` içinde `freezer`). Uygulamada dondurucu ekipman türü tanımlanmalı; şu an yok.

**Uzmana sorulacak:**

1. 2014/47 ve 2014/48'in toplu tüketim yerindeki depolamaya uygulanıp uygulanmadığı.
2. Uygulanıyorsa "sık ve düzenli aralık" için bir yorum ya da rehber var mı?

---

## P-03 · Sıcak servis / sıcak tutma sıcaklığı

**YASAL**

- *Gıda Hijyeni Yönetmeliği, Madde 18(5):* Gıdaların sağlık riski oluşturabilecek sıcaklıklarda tutulmaması. — *Kaynak bulundu — doğrulanmadı.*
- *Madde 22:* HACCP; sıcak tutma tipik bir kritik kontrol noktası. — *Kaynak bulundu — doğrulanmadı.*

**Bulunamadı:** Sıcak tutma için **bağlayıcı sayısal bir sınır** bulamadım. Kaynaklar arasında da farklı değerler var: 60 °C, 63 °C, 65 °C ve 70 °C.

**İYİ UYGULAMA**

- *Tarım ve Orman Bakanlığı (Isparta İl Müdürlüğü yayını) ve TESK, "Toplu Tüketim Yerleri İçin İyi Hijyen Uygulamaları Rehberi":* "Sıcak tutulacak gıdaların sıcaklığı 65°C seviyesinin altına düşmemelidir"; gıdalar bu sıcaklıkta 3 saatten uzun tutulmamalı.
- Bu bir **rehber**dir. Resmî kurumca yayımlanmış olsa da yönetmelik maddesi değildir. Kuralda "iyi uygulama — Bakanlık rehberi" olarak etiketlenmeli.

**Önerilen uygulanabilirlik koşulu:** `activity.food_preparation = evet` VE **sıcak servis yapıyor**. Bu bilgi soru kataloğunda yok; eklenmesi gerekir (bkz. bu belgenin sonundaki liste).

**Uzmana sorulacak:**

1. 65 °C / 3 saat değerini pilotta "iyi uygulama, Bakanlık rehberi" etiketiyle kullanmak uygun mu?
2. Bu değer HACCP planına mı bırakılmalı?

---

## P-04 · Personel el hijyeni ve koruyucu kıyafet

**YASAL**

- *Gıda Hijyeni Yönetmeliği, Madde 17 (Personel hijyeni):* "Gıdanın muameleye tabi tutulduğu alanlarda çalışan bütün personelin, kişisel temizliğini sürdürmeye azami itina göstermesi, temiz ve gerekli durumlarda uygun koruyucu kıyafet giymesi gerekir." — *Kaynak bulundu — doğrulanmadı.*
- *Aynı Yönetmelik, tesis gereklilikleri:* "Uygun bir şekilde yerleştirilmiş ve el temizliği için tasarlanmış, yeterli sayıda lavabo bulunur. El temizleme lavabolarında, sıcak ve soğuk akan su, el temizleme ve hijyenik kurulama maddeleri bulunur." — *Kaynak bulundu — doğrulanmadı.*
- *Hijyen Eğitimi Yönetmeliği (Sağlık Bakanlığı), RG 05.07.2013, sayı 28698:* Kapsamdaki işyerlerinde (gıda üretim ve perakende işyerleri dahil) Genel Müdürlükçe verilen hijyen eğitimi belgesi olmayan kişiler çalıştırılamaz. Sorumluluk işverendedir. — *Kaynak bulundu — doğrulanmadı.* Bu, P-13 "çalışan hijyen eğitimi" konusuyla birleşebilir.

**Bulunamadı:** Vardiya başı kontrolün **sıklığı** için yasal bir hüküm bulamadım. Mevzuat bir sonuç istiyor (kişisel temizlik, uygun kıyafet), kontrol sıklığı belirlemiyor.

**İYİ UYGULAMA:** Vardiya başında kısa kontrol listesi (el yıkama imkânı, bone/önlük, takı yok, hastalık belirtisi yok). Kaynak: Bakanlık ve TESK hijyen rehberleri, Sağlık Bakanlığı toplu beslenme el kitabı. Sıklık önerisi: her vardiya (iyi uygulama).

**Önerilen uygulanabilirlik koşulu:** `activity.food_preparation = evet`. Hijyen eğitimi belgesi kuralı için: çalışan sayısı > 0 (`staff.count`).

**Uzmana sorulacak:**

1. Hijyen eğitimi belgesinin kuralda ayrı bir "belge geçerli mi" yükümlülüğü olması.
2. Belgenin geçerlilik süresi var mı?

---

## P-05 · Temizlik ve dezenfeksiyon planı

**YASAL**

- *Gıda Hijyeni Yönetmeliği:* Genel hijyen sorumluluğu (Madde 5) ve HACCP (Madde 22). Temizlik ve dezenfeksiyon, iyi hijyen uygulamalarının parçası. — *Kaynak bulundu — doğrulanmadı.* **Temizlik ve dezenfeksiyonu düzenleyen madde ya da ek numarasını doğrulayamadım.**
- *Biyosidal Ürünler Yönetmeliği (Sağlık Bakanlığı):* Dezenfektanlar ruhsatlı biyosidal ürün olmalı. Bu bağlantı bir valilik genelgesinde kuruluyor. — *Kaynak bulundu — doğrulanmadı; yönetmeliğin künyesi bulunamadı.*

**İYİ UYGULAMA:** Yazılı bir temizlik-dezenfeksiyon planı tutulmalı: ne, nasıl, hangi kimyasalla, ne zaman, kim tarafından. Sıra: ön temizlik → deterjanla yıkama → durulama → dezenfeksiyon → son durulama → kurutma. Kaynak: il valiliği genelgesi (kantinler için) ve akademik ders notları. Sıklık işletmenin planına bağlı.

**Önerilen uygulanabilirlik koşulu:** `activity.food_preparation = evet`.

**Önerilen kural biçimi:**

- Görev: plandaki alanları işaretle.
- Kanıt: kontrol listesi ve isteğe bağlı fotoğraf.
- Sıklık: plana göre (günlük/haftalık alanlar ayrı).

**Uzmana sorulacak:**

1. Temizlik ve dezenfeksiyon için Gıda Hijyeni Yönetmeliği'nin hangi ek ya da bölümünün dayanak gösterileceği.
2. Ruhsatlı dezenfektan kullanımının kurala "kanıt: kullanılan ürünün ruhsat numarası" olarak eklenmesi.

---

## Sonuç ve önerim

| Konu | Yasal dayanak bulundu mu | Sayısal limit / sıklık mevzuatta | Önerim |
|---|---|---|---|
| P-01 Soğutucu | Evet: soğuk zincir + kayıt (Md. 5), HACCP (Md. 22) | Bulunamadı | Yasal: "koru ve kaydet". Limit ve sıklık HACCP planından; varsayılan iyi uygulama olarak etiketli |
| P-02 Dondurucu | Kısmen: −18 °C hızlı dondurulmuş ürünler için | −18 °C var; toplu tüketim deposuna uzanımı belirsiz | Uzman görüşü gelene kadar −18 °C "iyi uygulama / kapsamı belirsiz" |
| P-03 Sıcak servis | Genel hüküm (Md. 18/5, Md. 22) | Bulunamadı; rehberde 65 °C / 3 saat | İyi uygulama — Bakanlık rehberi etiketiyle |
| P-04 El hijyeni ve kıyafet | Evet: Md. 17, lavabo gereklilikleri; Hijyen Eğitimi Yönetmeliği | Sıklık yok | Yasal sonuç + iyi uygulama olarak vardiya başı kontrol |
| P-05 Temizlik ve dezenfeksiyon | Genel hüküm; madde numarası doğrulanmadı | Yok | İşletmenin planına bağlı görev |

**Tabloya işlenme:** Bu bulgular `GoverHub_Kural_Taslak_Tablosu.xlsx` P-01 … P-05 satırlarına "Kaynak bulundu — doğrulanmadı" durumuyla işlendi. Yasal ve iyi uygulama değerleri ayrı sütunlarda duruyor.

**Yayın:**

- Bu beş konudan hiçbiri yayımlanmadı ve yayımlanmayacak; uygulamaya taslak olarak da aktarılmadı.
- Önce resmî konsolide metinden doğrulama, sonra alan uzmanı onayı ve senin onayın gerekiyor.

**Uygulamada gereken yeni işletme bilgileri** (soru kataloğuna eklenmeli; yeni özellik değil, kural koşulları için veri):

- Sıcak servis yapıyor mu
- Dondurucu var mı (ekipman türü)
- Gıda işletmesi kayıt numarası

## Kaynaklar (erişilen kopyalar)

- Gıda Hijyeni Yönetmeliği, RG 28145, 17.12.2011 — [TÜRMOB arşiv kopyası](https://www.turmob.org.tr/arsiv/mbs/resmigazete/28145-28145-1.docx) · [Lexpera orijinal metin](https://www.lexpera.com.tr/resmi-gazete/metin/gida-hijyeni-yonetmeligi-28145) · [Mevzuat Bilgi Sistemi kaydı (bu ortamdan erişilemedi)](https://mevzuat.gov.tr/mevzuat?MevzuatNo=15592&MevzuatTur=7&MevzuatTertip=5)
- Hijyen Eğitimi Yönetmeliği, RG 28698, 05.07.2013 — [TÜRMOB arşiv kopyası](https://www.turmob.org.tr/arsiv/mbs/resmigazete/28698-28698-1.docx) · [Alomaliye](https://www.alomaliye.com/2013/07/05/hijyen-egitimi-yonetmeligi/)
- Hızlı Dondurulmuş Gıdalar Tebliği (2014/47) ve sıcaklık izleme tebliği (2014/48) — [FAOLEX/LEAP özeti 2014/47](https://leap.unep.org/en/countries/tr/national-legislation/turkish-food-codex-notification-no-201447-quick-frozen-foodstuffs) · [FAOLEX/LEAP 2014/48](https://leap.unep.org/en/countries/tr/national-legislation/turkish-food-codex-notification-no-201448-means-transport) · [Lexpera resmî kontrol tebliği](https://www.lexpera.com.tr/mevzuat/tebligler/turk-gida-kodeksi-insan-tuketimine-sunulan-hizli-dondurulmus-gidalarda-sicakligin-resmi-kontrolu)
- Toplu Tüketim Yerleri İçin İyi Hijyen Uygulamaları Rehberi — [Tarım ve Orman Bakanlığı, Isparta İl Müdürlüğü](https://isparta.tarimorman.gov.tr/BelgelerArsiv/G%C4%B1da%20ve%20Yem/Hijyen%20Uygulama%20Rehberleri/toplutuketimhijyen.pdf) · [TESK](https://www.tesk.org.tr/resimler/toplutuketimhijyen.pdf)
- Gıda satış yerleri hijyen esasları — [Düzce İl Müdürlüğü](https://duzce.tarimorman.gov.tr/Belgeler/GIDA/satis_yerleri_iyi_hijyen_rehberi.pdf) · Toplu beslenme hijyen el kitabı — [Sağlık Bakanlığı HSGM](https://hsgm.saglik.gov.tr/depo/birimler/saglikli-beslenme-ve-hareketli-hayat-db/Dokumanlar/Beslenme/Toplu-Beslenme-Sistemlerinde-Calisanlar-Icin-Hijyen-El-Kitabi.pdf)
- Kayıt ve Onay Yönetmeliği — [Alomaliye](https://alomaliye.com/2011/12/17/gida-isletmelerinin-kayit-ve-onay-islemlerine-dair-yonetmelik/) · [2013 değişikliği, FAOLEX](https://faolex.fao.org/docs/pdf/tur122159.pdf)
- Temizlik/dezenfeksiyon ve ruhsatlı biyosidal (valilik genelgesi haberi) — [Mynet](https://www.mynet.com/vali-duzgun-kantinlerde-ozel-hijyen-kurallari-genelgesi-yayinladi-180101045260)
- Bakanlık mevzuat listesi (künye kontrolü için) — [Tarım ve Orman Bakanlığı, 21.06.2023](https://www.tarimorman.gov.tr/GKGM/Belgeler/DB_Gida_Isletmeleri/Kodeks-Calismalari/mevzuat-listesi-21.06.2023.pdf)
