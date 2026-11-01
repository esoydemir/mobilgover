# Kontrollü pilot için senden gerekenler (aşamalara ayrılmış)

Hiçbir maddede parola, gizli anahtar ya da erişim bilgisi istenmiyor. Bunlar doğrudan sunucudaki ortam dosyasına ya da parola kasasına girilir; bana gönderilmez.

## Şimdi: telefon için test ortamı

Pilottan önce ayrı bir HTTPS test ortamı kurulur. Bu ortamda yalnızca demo verisi bulunur ve e-posta gönderilmez. Gerekenler kısa bir listedir ve hiçbiri parola değildir: `TEST_ORTAMI.md` §2.

## Pilot için ilk adım

**Barındırma sağlayıcısında iki Ubuntu 24.04 sunucu aç:**
- Sunucu 1 (uygulama): 2 vCPU, 4 GB RAM, 40 GB SSD.
- Sunucu 2 (yedek ve gözcü): 1 vCPU, 2 GB RAM, 30 GB SSD.
- İkisi **farklı veri merkezlerinde** olsun.

Bana yalnızca şunları yaz:
- sağlayıcının adı,
- iki sunucunun genel IP adresleri,
- pilot için kullanacağın alan adı (ör. `pilot.<alan-adı>.com.tr`).

Gereksinimlerin tamamı: `KURULUM_IHTIYACLARI.md`.

## Aşama 1 — İlk teknik kurulum için zorunlu

Bu aşamanın sonunda sunucular kurulur, HTTPS çalışır, yedekleme ve gözcü başlar, `pilot:check` çalıştırılabilir. Henüz gerçek kullanıcı ya da işletme verisi yoktur.

| # | Gereken | Not |
|---|---|---|
| 1 | Barındırma sağlayıcısı (Türkiye) ve iki sunucu, farklı veri merkezlerinde | Yukarıdaki ilk adım |
| 2 | Yedek konumu: **A** (Sunucu 2'nin diski; bugün çalışır) ya da B (S3 uyumlu depolama; adaptör gerekir) | Önerim A + Sunucu 2'de günlük disk anlık görüntüsü |
| 3 | Alan adı ve DNS yönetimi (A kaydı) | HTTPS sertifikası için |
| 5 | Kurulumu kim yapacak: sen ya da yöneticin `deploy/README.md` ile, çıktıları bana iletirsiniz | Bu çalışma ortamı sunuculara SSH ile bağlanamıyor |
| 6 | Bildirim adresi (webhook) ve bildirimleri izleyecek kişi | Yedekleme ilk gün başlar; uyarılar bir yere düşmeli |
| 7 | Şifreleme anahtarının saklanacağı kasa ve anahtara erişebilecek en az iki kişi | Anahtarı kurulumu yapan kişi üretir ve doğrudan kasaya koyar |

## Aşama 2 — Gerçek işletme verisiyle pilot başlamadan

| # | Gereken | Not |
|---|---|---|
| 4 | SMTP sağlayıcısı (Türkiye), gönderen adres, alan adına SPF/DKIM/DMARC kayıtları | İlk gerçek gönderimi birlikte doğrulayıp "üretime hazır" işaretleriz |
| 8 | P-01…P-05 kaynak araştırmasının incelenmesi: hangi konular pilota girecek | Araştırma **doğrulanmamış taslak**. Madde numaraları ve yükümlülükler resmî güncel metinle kontrol edilmeden onaylanmış sayılmaz |
| 9a | **Gıda güvenliği** alan uzmanı | P-01…P-05'i resmî metinle doğrular ve uygulamada inceler; bu olmadan kural onaylanamaz |
| 10 | Platform rollerine kişiler: kural yazarı, kural onaylayıcı (sen), platform yöneticisi | Her biri kendi e-postasıyla girip ek doğrulama kurar |
| 12a | İlk pilot işletme(ler) ve ilk kullanıcıların e-postaları | Önerim 1–3 işletmeyle başlamak |
| 13 | KVKK aydınlatma metni | Hukuk görüşüyle; gerçek kişilerin verisi girilmeden önce |
| 14 | Saklama süreleri (10 kayıt türü) ve yedeklerde ek 30 günlük kalma süresinin aydınlatma metnine yazılması | Onaylanmadıkça hiçbir kayıt silinmez |
| 15 | Gerçek telefon testi: bir iPhone, bir Android ve testi yapacak kişi (30–45 dk) | `TELEFON_TESTI.md` §3 |
| 16 | Sıfırdan geri dönüş tatbikatı: geçici bir sunucu, yarım gün, anahtarı kasadan getirecek kişi | `YEDEKLEME.md` §4; hedef 4 saat |

## Aşama 3 — Sonraki aşamaya bırakılabilir

| # | Gereken | Neden bekleyebilir |
|---|---|---|
| 9b | İSG ve yangın güvenliği alan uzmanları | P-06…P-14 konuları pilotun ilk kural kümesinde değilse |
| 11 | `mevzuat.gov.tr` ve `resmigazete.gov.tr` için bu ortama ağ izni | Doğrulamayı alan uzmanı resmî metinden yapabilir. İzin verilirse kontrolleri ben de yaparım |
| 12b | Pilotun 20 işletmeye genişlemesi | İlk işletmelerle süreç oturduktan sonra |
| — | Yedeğin ikinci bir sağlayıcıda kopyası | Sağlayıcı genelindeki riskler için; pilotta kabul edilebilir |
| — | Seçenek B (nesne depolama) | A yeterli; nesne depolamaya geçilirse adaptör yazılır |
| — | iOS/Android mağaza dağıtımı | Pilot telefon tarayıcısından yapılır (`MOBIL_DAGITIM.md`) |
