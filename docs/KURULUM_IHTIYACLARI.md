# Kontrollü pilot: kurulum ihtiyaç tablosu

**Henüz satın alma yapılmadı.** Bu tablo sağlayıcı seçimini kolaylaştırmak içindir. Kapasiteler ölçüme dayanıyor (bkz. `YEDEKLEME.md` §5): 20 işletme ve 1 yıl için veritabanı ~44 MB, kanıt dosyaları 2–11 GB. Bütün bileşenler Türkiye'de barındırılmalı (verdiğin karar).

## Önerilen yapı (en sade)

```
[ Telefonlar / tarayıcı ]
        │ HTTPS (443)
        ▼
Sunucu 1 — UYGULAMA                 Sunucu 2 — YEDEK + GÖZCÜ (ayrı makine, mümkünse ayrı veri merkezi)
  Caddy (HTTPS, sertifika)            yedek diski (şifreli nesneler)
  GoverHub API (Node.js)   ── yedek ──▶ (NFS/SSHFS bağlama ya da S3 uyumlu depolama)
  PostgreSQL 16                       gözcü: 5 dakikada bir yaş kontrolü → bildirim
  kanıt dosyaları (yerel disk)
        │ SMTP (587/465, TLS)
        ▼
  E-posta sağlayıcısı
```

## Sunucu gereksinimleri (sağlayıcıdan bağımsız)

Varsayım: 20 işletme, ~60 etkin kullanıcı, bugünkü örnek kural yoğunluğu (işletme başına günde ~1 fotoğraf). Parantez içindekiler, işletme başına günde 5 fotoğraf varsayımı için. Ölçülen değerler `YEDEKLEME.md` §3 ve §5'te.

| | Sunucu 1 — Uygulama | Sunucu 2 — Yedek + gözcü |
|---|---|---|
| **CPU** | 2 vCPU | 1 vCPU |
| **RAM** | 4 GB | 2 GB (haftalık tam doğrulama ve geri yükleme provası için) |
| **Disk** | 40 GB SSD (60 GB). Bileşenler: sistem ~10 GB, PostgreSQL + günlükler ~5 GB, kanıtlar 2,2 GB/yıl (10,7 GB/yıl), geçici yedek ve geri yükleme alanı. | 30 GB: sistem ~10 GB + yedek alanı |
| **İşletim sistemi** | Ubuntu 24.04 LTS (ya da eşdeğer uzun destekli Linux) | Ubuntu 24.04 LTS |
| **Yedek kapasitesi** | — (yedekler burada tutulmaz) | **10 GB ile başla (20 GB), %70'te uyarı.** Ölçülen: 124 yedek = 2,9 GB |
| **Dışarıya açık portlar** | 80, 443; 22 yalnızca yönetici IP'lerine | 22 yalnızca yönetici IP'lerine; yedek bağlantısı yalnızca Sunucu 1'e |
| **Aylık trafik: kullanıcılar ↔ Sunucu 1** | ~2,1 GB (2,8 GB): fotoğraf yüklemesi 0,18 GB (0,9), API ~0,7 GB, web uygulaması indirmesi ≤1,2 GB | — |
| **Aylık trafik: Sunucu 1 → Sunucu 2** | Yarım saatlik yedekler ~9,4 GB (21,5 GB). Yıl sonundaki boyutla hesaplandı; başta daha az. | Haftalık tam doğrulama, kanıtların tamamını okur: ~9 GB (43 GB). Hedef ağ üzerindeyse trafik sayılır. |
| **Aylık trafik: diğer** | SMTP ~6.000 e-posta (~60 MB); bildirimler önemsiz | Gözcü önemsiz; tatbikatta tam indirme ~3 GB |

**Trafik önerisi:** İki sunucu arasında ayda ~20 GB (günde 5 fotoğrafta ~65 GB). Sağlayıcı iki sunucu arasında ücretsiz özel ağ sunuyorsa yedek trafiği oradan geçmeli. Toplam paket en az 100 GB/ay olmalı.

**Geri dönüş tatbikatı için** Sunucu 1 boyutunda geçici bir sunucu, yalnızca tatbikat süresince gerekir.

## Neden iki sunucu

1. **Yedek, kaybettiğimiz şeyle aynı yerde olamaz.** Uygulama sunucusu kaybolursa (disk arızası, yanlışlıkla silme, fidye yazılımı, ele geçirilme) yedekler de onunla giderse "en fazla 1 saat veri kaybı" hedefi anlamsız olur. Yedekler ayrı bir makinede, şifreli durur.
2. **Gözcü, çöken sunucuyu dışarıdan görmeli.** Uygulama sunucusu tamamen durursa kendi kendine "yedek alınamıyor" diyemez. Gözcü Sunucu 2'den yedeklerin yaşını izler ve 40/50/60 dakika eşiklerinde bildirim gönderir.
3. **Anahtar ayrımı.** Sunucu 2 yalnızca şifreli veri tutar ve anahtarı hiç görmez. Yedek diski ele geçirilse bile veri okunamaz.

## Aynı sağlayıcıdaki iki sunucunun ortak arıza riskleri

İki sunucu aynı sağlayıcıdaysa bazı arızalar ikisini birden etkiler:

| Ortak risk | Örnek | Önlem |
|---|---|---|
| Aynı veri merkezi | Yangın, sel, elektrik ya da ağ kesintisi | İki sunucu **farklı veri merkezlerinde** (farklı şehir tercih edilir) |
| Aynı hesap | Ödeme sorunu yüzünden askıya alma; hesabın ele geçirilip iki sunucunun da silinmesi | Hesapta güçlü parola + ek doğrulama; mümkünse yedek için **ayrı hesap ya da ayrı yetki**; faturalandırma uyarıları |
| Aynı yönetim paneli / API | Panel kesintisi; tek bir hatalı işlemle iki sunucunun silinmesi | Silme koruması (destekleniyorsa); yetkileri ayrılmış kullanıcılar |
| Sağlayıcı genelinde sorun | Sağlayıcının bütün bölgelerde kesintisi, iflası ya da hizmeti durdurması | Pilot için kabul edilebilir risk. Sonraki aşamada yedeğin bir kopyası **ikinci bir sağlayıcıda** tutulur. |
| Uygulama sunucusundan yedeklere erişim | Fidye yazılımı Sunucu 1'i ele geçirip bağlı yedek diskini silebilir; çünkü eski yedekleri temizleme işi Sunucu 1'den çalışıyor | Sunucu 2'de, Sunucu 1'in erişemeyeceği **günlük disk anlık görüntüleri** (snapshot), ya da sürüm tutan / değiştirilemez nesne depolama |

**Pilot için öneri:** Aynı sağlayıcı kabul edilebilir. Şu üç koşulla:
- İki sunucu farklı veri merkezlerinde olacak.
- Sunucu 2'de, Sunucu 1'in erişemeyeceği günlük anlık görüntüler alınacak.
- Hesapta ek doğrulama açık olacak.

İkinci sağlayıcıdaki yedek kopyası sonraki aşamaya bırakılabilir.

## İhtiyaç tablosu

| Bileşen | Asgari kapasite (pilot, 1. yıl) | Gerekli erişimler / ayarlar | Senin sağlaman gerekenler |
|---|---|---|---|
| **Uygulama sunucusu** (Sunucu 1) | Yukarıdaki tablo. Ölçülen yük çok düşük; RAM, PostgreSQL ile birlikte çalışması için. | Dışarıya açık yalnızca 80 ve 443 (sertifika ve HTTPS). 22 (SSH) yalnızca yönetici IP'lerine, anahtarla. API (3000) yalnızca 127.0.0.1'de; dışarıya kapalı (bkz. `AG_VE_SINIRLAR.md`). Sunucudan dışarıya: SMTP portu, yedek konumu, bildirim adresi. Sabit genel IP. | Sağlayıcı ve veri merkezi (Türkiye). Kurulumu yapacak kişinin SSH erişimi. Kurulumu kimin yapacağı (bkz. son bölüm). |
| **PostgreSQL** | Sürüm 15 ya da 16 (16 ile test edildi). Pilotta Sunucu 1 üzerinde; yönetilen (managed) hizmet de olur. Veri ~50 MB/yıl, 2 GB pay yeterli. | Uygulama için iki rol: tablo sahibi (`goverhub_owner`) ve uygulama (`goverhub_app`). Yönetilen hizmette bu iki rol oluşturulabilmeli; `pg_dump` / `pg_restore` 16 ile uyumlu olmalı. Veritabanına dışarıdan erişim kapalı. | — (parolalar kurulumda üretilir, kimseyle paylaşılmaz) |
| **Kanıt depolama** | Günde 1 fotoğraf/işletmede 1. yıl ~2,1 GB; 5 fotoğrafta ~10,7 GB. Sunucu 1 diskinde ayrı bir klasör ya da ek disk. | Uygulama kullanıcısına yazma izni. Dosyalar bir kez yazılır ve değişmez. Disk %70 dolulukta uyarı. | — |
| **Ayrı, şifreli yedek konumu** | 10 GB ile başla, %70 dolulukta uyarı; günde 5 fotoğraf çıkarsa 20 GB (ölçüm ve hesap: `YEDEKLEME.md` §3). Uygulama sunucusundan **farklı bir makinede**, tercihen farklı veri merkezinde. | Seçenek A (bugün çalışır): Sunucu 2'de bir disk; Sunucu 1'e NFS ya da SSHFS ile bağlanır. Gözcü Sunucu 2'de çalışır. Seçenek B: S3 uyumlu nesne depolama, sürüm tutma ve değiştirilemezlik özelliğiyle. **Bunun için bir hedef adaptörü yazmam gerekir** (sağlayıcı seçilince, küçük bir iş). Her iki seçenekte de şifreleme sunucuda yapılır; sağlayıcı yalnızca şifreli veri görür. | Seçenek A ya da B. Şifreleme anahtarının saklanacağı yer ve anahtara erişebilecek kişiler (en az iki). |
| **Gözcü** | Sunucu 2'de (Seçenek A) ya da başka küçük bir makinede. Çok küçük kaynak yeter. | Yedek konumuna yalnızca okuma erişimi. Bildirim adresine erişim. Veritabanı ya da anahtar gerekmez. | — |
| **SMTP** | Hacim: 20 işletme × ~3 kişi × günde 1–2 giriş ≈ günde 200'e kadar giriş kodu, ayda ~6.000 e-posta + bildirimler. | 587 (STARTTLS) ya da 465 (TLS). Kimlik doğrulamalı gönderim. Gönderen adresin alan adında SPF, DKIM ve DMARC kayıtları. Giriş kodu e-postalarının hızlı teslimi; toplu pazarlama hizmeti değil, işlem e-postası. | Sağlayıcı (Türkiye barındırmalı). SMTP sunucu adı, port, kullanıcı, parola. Gönderen adres (ör. `giris@<alan-adı>`). DNS kayıtlarını ekleyebilecek erişim. İlk gerçek gönderimi birlikte doğrulayacağız; ondan sonra "üretime hazır" işaretlenir. |
| **HTTPS** | Tek alan adı yeter: web uygulaması `/` altında, API `/api` altında; aynı adres olunca tarayıcı izinleri (CORS) gerekmez. Sertifika Let's Encrypt ile otomatik (Caddy). | Alan adının A kaydı Sunucu 1'in IP'sini göstermeli. 80 ve 443 dışarıya açık. | Alan adı (ör. `pilot.<alan-adı>.com.tr`) ve DNS yönetim erişimi. |
| **Bildirim adresi** | — | Sunucu 1 ve Sunucu 2 bu adrese HTTPS ile POST gönderebilmeli. | Bir webhook adresi (ekip sohbet kanalı ya da nöbet aracı) ve bildirimleri kimin izleyeceği. |
| **Yönetici hesapları** | — | Platform rolleri: kural yazarı, kural inceleyicisi, alan uzmanı (alanlarıyla), platform yöneticisi, pazar yeri inceleyicisi. Hepsi ek doğrulama (TOTP) kurar. | Her rol için kişi ve e-posta adresi. Alan uzmanının uzmanlık alanları. |

## Kurulumu kim yapacak

Bu çalışma ortamı dış sunuculara SSH ile bağlanamıyor (yalnızca HTTPS ile dışarı çıkabiliyor). İki yol var:

1. **Sen ya da sunucu yöneticin** `deploy/README.md`'deki adımları uygular. Komutlar hazır; her adımın sonunda neyin görüleceği yazılı. Çıktıları bana iletirsin, ben kontrol ederim.
2. **Bu ortama erişim açılır** (ağ ayarlarında sunucu adresine izin + SSH anahtarı). Bu bir güvenlik kararıdır ve senin onayını gerektirir.

## Bilinçli olarak dışarıda bırakılanlar

- **Yük dengeleyici, birden fazla uygulama sunucusu:** Pilotta gerek yok. Hız sınırı bellek içi tutulduğu için tek sunucu varsayılıyor.
- **Nesne depolamaya kanıt yazma:** Kanıtlar yerel diskte tutuluyor. Nesne depolama istenirse adaptör gerekir.
- **iOS/Android mağaza derlemesi:** Pilot telefon tarayıcısından (HTTPS) yapılır. Mağaza gereksinimleri `MOBIL_DAGITIM.md`'de.
