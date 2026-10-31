# Kontrollü pilot için senden gerekenler (tek liste)

Teknik olarak hazırlanabilen her şey hazır ve test edildi:

- Yedekleme, gözcü ve bildirim
- SMTP adaptörü
- HTTPS kurulum dosyaları
- Rol yönetimi komutları
- Hazırlık kontrolü (`pilot:check`)
- Tatbikat ve telefon testi kılavuzları

Aşağıdakiler yalnızca sende.

## A. Hemen gerekenler (kurulumu engelliyor)

| # | Gereken | Neden | Biçim |
|---|---|---|---|
| 1 | **Barındırma sağlayıcısı** (Türkiye): Sunucu 1 + Sunucu 2 | Pilot ortamı | Sağlayıcı adı + iki sunucunun IP'leri (kapasite: `KURULUM_IHTIYACLARI.md`) |
| 2 | **Yedek konumu seçeneği**: A (ikinci sunucunun diski) ya da B (S3 uyumlu nesne depolama) | Ayrı, şifreli yedek | A ise hazır. B ise sağlayıcı adını ver, adaptörü yazayım |
| 3 | **Alan adı** ve DNS yönetim erişimi | HTTPS sertifikası, e-posta (SPF/DKIM/DMARC) | Ör. `pilot.<alan-adı>.com.tr` |
| 4 | **SMTP sağlayıcısı** (Türkiye) ve bilgileri | Gerçek e-postayla giriş | Sunucu adı, port, kullanıcı, parola, gönderen adres. Parolayı bana değil, doğrudan sunucudaki ortam dosyasına girin |
| 5 | **Kurulumu kim yapacak** | Bu ortam dış sunuculara SSH ile bağlanamıyor | (a) Sen ya da yöneticin `deploy/README.md`'yi uygular, çıktıları iletir; ya da (b) bu ortama erişim açılır (ayrı güvenlik kararı) |
| 6 | **Bildirim adresi** (webhook) ve bildirimleri izleyecek kişi | Yedekleme ve bütünlük uyarıları | Webhook URL'si + kişi |
| 7 | **Şifreleme anahtarının saklanacağı yer** ve anahtara erişebilecek en az iki kişi | Anahtar yedeklerden ayrı tutulmalı; tatbikatta kurtarılacak | Kasa adı / yöntem + kişiler |

## B. İçerik ve onaylar (pilotta kural çalışması için)

| # | Gereken | Durum |
|---|---|---|
| 8 | **P-01…P-05 kaynak araştırmasının incelenmesi** | `kurallar/KAYNAK_ARASTIRMASI_P01-P05.md` hazır. Hangi konular pilota girecek? Yasal ve iyi uygulama ayrımını onaylıyor musun? |
| 9 | **Alan uzmanı** (gıda güvenliği; ayrıca İSG ve yangın konuları için) ve e-postaları | Kaynakların resmî metinle doğrulanması ve uzman incelemesi. Bu olmadan kurallar onaylanamaz |
| 10 | **Platform rollerine kişiler** | Kural yazarı, kural onaylayıcı (sen), platform yöneticisi; e-posta adresleri |
| 11 | **Resmî kaynak sitelerine erişim**: `mevzuat.gov.tr` ve `resmigazete.gov.tr` bu ortamda kapalı | Açılırsa güncel konsolide metinleri kendim kontrol edip "doğrulanmadı" işaretlerini kapatabilirim. Ortamın ağ ayarlarından izin verilmesi gerekir |
| 12 | **Pilot işletmeler** (kaç tane, kimler) ve ilk kullanıcıların e-postaları | Davetler ve kapasite teyidi |

## C. Hukuki metinler (gerçek kullanıcıdan önce)

| # | Gereken | Neden |
|---|---|---|
| 13 | **KVKK aydınlatma metni** (ve gerekiyorsa açık rıza metni) | Gerçek kişilerin verisi işlenecek. Metin hukuk görüşüyle hazırlanmalı; ben yazmam. Hazır olunca uygulamaya bağlanır |
| 14 | **Saklama süreleri** (10 kayıt türü) | Onaylanmadıkça hiçbir kayıt silinmiyor. Yedeklerde 30 gün ek kalma süresi bu metinde belirtilmeli |

## D. Doğrulama günleri

| # | Gereken |
|---|---|
| 15 | **Gerçek telefon testi** için bir iPhone ve bir Android, ve testi yapacak kişi (30–45 dk) |
| 16 | **Geri dönüş tatbikatı** için boş bir sunucu, yarım gün ve anahtarı kasadan getirecek yetkili kişi |
