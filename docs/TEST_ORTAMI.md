# Telefon için HTTPS test ortamı (yalnızca demo verisi)

> **Durum: üretime hazır değildir.** Bu ortam yalnızca uygulamayı telefonda denemek içindir. İçindeki kurallar **örnektir**; hiçbirinin mevzuat onayı yoktur. P-01…P-05 kaynak araştırması doğrulanmamış taslak olarak kalır.

## 1. Ne kurulur

| | |
|---|---|
| Adres | `https://<test-alan-adı>` (web uygulaması `/`, API `/api`). Sertifikayı Caddy, Let's Encrypt'ten kendisi alır |
| Erişim | Davet bağlantısı `https://<test-alan-adı>/erisim/<anahtar>`. Açılınca tarayıcıya 30 gün geçerli bir çerez yazılır. Çerezi olmayan her istek 403 alır: web uygulaması, API ve demo posta kutusu. Arama motorları dizinlemez (`X-Robots-Tag`, `robots.txt`) |
| Veri | Yalnızca demo verisi: "Kahve Durağı (DEMO)", örnek kurallar, önümüzdeki 30 günün görevleri. Gerçek işletme verisi yüklenmez |
| Giriş | Yalnızca `@demo.goverhub.test` adresleri. E-posta gönderilmez; kod, giriş ekranındaki **"Demo kutusundan kodu getir"** düğmesiyle alınır. Başka bir adres girilirse sunucu reddeder; ekip davetinde de aynı kural geçerli |
| Ayrım | Sunucuda `DEMO_MODE=true`, `MAIL_TRANSPORT=dev_outbox`. Uygulama bu eşleşmeyi zorlar: pilot `dev_outbox` ile, demo ise SMTP ile **başlamaz**. Demo modu, gerçek (demo olmayan) işletme bulunan bir veritabanında da başlamaz |
| Ağ | API yalnızca `127.0.0.1:3000` adresinde dinler. Güvenlik duvarında yalnızca SSH, 80 ve 443 portları açık |
| Yedek | Yok. Bu ortamda yalnızca demo verisi var; sunucu silinip yeniden kurulabilir |

Dosyalar: `deploy/test/install.sh` (sunucuda çalışan kurulum; tekrar çalıştırılabilir), `deploy/test/Caddyfile.template`, `deploy/test/goverhub-test-api.service`, `.github/workflows/deploy-test.yml` (GitHub Actions ile yayın).

## 2. Senden gerekenler (bir kez)

**Satın alma gerektiren hiçbir şeyi ben açmam.** Sunucu ve alan adı senin kararın.

1. **Sunucu:** Ubuntu 24.04, en az 1 vCPU, 2 GB RAM, 20 GB disk. Pilot sunucusundan ayrı olmalı. Bana yalnızca **genel IP adresini** yaz.
2. **Alan adı:** Örneğin `test.<alan-adın>.com.tr`. Bunun için sunucunun IP adresine giden bir **A kaydı** oluştur. Bana alan adını yaz.
3. **SSH kullanıcısı:** `root` ya da parolasız `sudo` yetkisi olan bir kullanıcı. Bana yalnızca **kullanıcı adını** yaz.
4. **SMTP: şimdi gerekmiyor.** Test ortamı e-posta göndermez. SMTP bilgileri pilot aşamasında gerekecek. O zaman da parolayı bana değil, sunucudaki ortam dosyasına girersin.

### Gizli değerleri nereye gireceksin (sohbete yazma)

Hepsi **GitHub → mobilgover deposu → Settings → Secrets and variables → Actions** sayfasına girilir.

**Variables sekmesi** (gizli değildir):

| Ad | Değer |
|---|---|
| `TEST_HOST` | Sunucunun IP adresi |
| `TEST_SSH_USER` | SSH kullanıcı adı |
| `TEST_DOMAIN` | Test alan adı (ör. `test.ornek.com.tr`) |

**Secrets sekmesi** (girildikten sonra kimse göremez; ben de göremem):

| Ad | Ne | Nasıl üretilir (kendi bilgisayarında) |
|---|---|---|
| `TEST_SSH_PRIVATE_KEY` | Yalnızca bu iş için açılmış SSH anahtarının **özel** kısmı | `ssh-keygen -t ed25519 -f goverhub-test -N "" -C goverhub-test-deploy` komutunu çalıştır. `goverhub-test` dosyasının içeriğini buraya yapıştır. `goverhub-test.pub` dosyasının içeriğini sunucuda `~/.ssh/authorized_keys` dosyasına ekle |
| `TEST_ACCESS_TOKEN` | Davet bağlantısının anahtarı | `openssl rand -hex 24`. Çıkan değeri buraya yapıştır ve bir parola kasasında da sakla. Davet bağlantısı: `https://<test-alan-adı>/erisim/<bu değer>` |
| `TEST_SSH_KNOWN_HOSTS` (önerilir) | Sunucunun SSH kimliği; araya başka birinin girmesini önler | Sunucuya bir kez bağlandıktan sonra `ssh-keyscan -t ed25519 <IP>` komutunun çıktısını buraya yapıştır |

Veritabanı parolaları ve MFA anahtarı **sunucuda** üretilir. Sunucudan hiç çıkmazlar (`/etc/goverhub-test/test.env`).

## 3. Yayınlama

1. **Actions → "Test ortamına yayınla" → Run workflow** (dal: `goverhub-mobile`).
2. İş akışı sırasıyla şunları yapar:
   - Ayarların tanımlı olduğunu denetler.
   - O commit'in CI'dan GitHub'da geçtiğini doğrular; geçmemişse yayını durdurur.
   - DNS kaydının sunucuyu gösterdiğini denetler.
   - Web uygulamasını derler.
   - SSH ile yükler ve `install.sh` betiğini çalıştırır.
3. Son adımda dışarıdan şunlar doğrulanır:
   - HTTP isteği HTTPS'e yönleniyor.
   - Davetsiz istekler 403 alıyor (ana sayfa, API ve demo posta kutusu).
   - Yanlış davet bağlantısı 403 alıyor.
   - Doğru davet bağlantısı çerezi yazıp uygulamaya yönlendiriyor.
   - API "demo" modunda çalışıyor.
   - `noindex` başlığı var.
   - 3000 portu dışarıdan kapalı.
4. Bunlardan biri tutmazsa iş akışı **kırmızı** biter ve hangi denetimin tutmadığını yazar.

Aynı iş akışı güncellemeler için de kullanılır. Demo verisi ilk kurulumda bir kez yüklenir; sonraki yayınlarda korunur.

## 4. Telefonda test listesi (15–20 dk)

Davet bağlantısını telefonda aç: iPhone'da Safari, Android'de Chrome. Her satıra geçti/kaldı yaz; cihaz modelini ve tarayıcıyı da not et.

| # | Adım | Beklenen |
|---|---|---|
| 1 | Davet bağlantısını aç | Giriş ekranı açılır; üstte "DEMO · ÖRNEK VERİ" etiketi görünür |
| 2 | Davet bağlantısı olmadan adresi gizli sekmede aç | "Bu adres yalnızca davetli test kullanıcılarına açıktır" yazar |
| 3 | `sahip@demo.goverhub.test` → Kod gönder → **Demo kutusundan kodu getir** → Giriş yap | Ana ekranda "Kahve Durağı (DEMO)" ve bugünün görevleri görünür |
| 4 | Kendi gerçek e-posta adresinle dene | Reddedilir; gerçek adres kaydedilmez |
| 5 | Soğutucu sıcaklık görevine 9 °C gir | Limit dışı uyarısı çıkar; kayıt engellenmez |
| 6 | Göreve kamerayla fotoğraf ekle | Kamera seçeneği gelir. Sunucu dosyanın özetini doğrulayınca "gönderildi" görünür |
| 7 | Görevi tamamla | Sonuç uygunsuzsa bir uygunsuzluk kaydı açılır |
| 8 | Uçak modunu aç; bir görev doldur ve tamamla. Sonra uçak modunu kapat | Önce "Cihazda · gönderilecek" görünür; bağlantı gelince kayıt kendiliğinden ya da "Şimdi eşitle" ile gider |
| 9 | Ekip → `personel2@demo.goverhub.test` adresini davet et | Davet oluşur; gerçek bir adres girilirse reddedilir |
| 10 | Çıkış yap; `personel@demo.goverhub.test` ile gir | Yalnızca personel yetkileri görünür |
| 11 | Rapor ekranı; telefonu yan çevir | Metin okunur, sayfa yana kaymaz |
| 12 | Ana ekrana ekle (Safari: Paylaş → Ana Ekrana Ekle) | Uygulama tam ekran açılır |

Diğer demo adresleri: `mudur@`, `danisman@`, `uzman@` (hizmet sağlayıcı), `yazar@`, `onay@`, `yonetici@`, `pazar@`. Hepsi `@demo.goverhub.test` uzantılıdır.

## 5. Çalışan ve henüz çalışmayan

**Çalışıyor** (otomatik testlerde, tarayıcıda gerçek API ve PostgreSQL ile):
- E-posta kodu ile giriş (demo kutusu)
- İşletme, şube ve profil kurulumu; ekipman ekleme; görev üretimi
- Kontrol listesi, ölçüm ve limit dışı uyarısı; fotoğraf kanıtı (SHA-256 doğrulamalı)
- Uygunsuzluk akışı ve kapanışta görevler ayrılığı
- Çevrimdışı kuyruk ve eşitleme
- Ekip daveti, rol ve askıya alma; oturum iptali
- Uzman ağı ve hizmet talebi/teklif akışı
- Kural yazma → onay → yayın (yalnızca örnek kurallar)
- Rapor ve denetim dosyası ekranları

**Henüz çalışmıyor veya bu ortamda yok:**
- **Gerçek e-posta gönderimi.** SMTP bağlanmadı. Bu yüzden test ortamında yalnızca demo adresleriyle giriş yapılabilir.
- **Doğrulanmış mevzuat kuralları.** Kurallar örnektir. P-01…P-05 doğrulanmamış taslaktır; alan uzmanı doğrulaması yapılmadı.
- **Gerçek telefonda denenmemiş durumlar.** Uygulama henüz gerçek bir telefonda denenmedi; bu liste bunun için. Safari'nin motoru (WebKit) bu ortamda hiç denenmedi.
- **Çevrimdışıyken sayfayı yenileme.** Web sürümünde service worker yok; çevrimdışıyken sayfa yenilenirse uygulama yeniden açılmaz. Çevrimdışı kayıtları bunun dışında yapılabilir.
- **Mağaza uygulaması.** iOS/Android mağaza sürümü yok (`MOBIL_DAGITIM.md`).
- **Platform rollerinde ek doğrulama (MFA).** Test ortamında zorunlu değil; pilot ortamında zorunlu.
- **Yedekleme ve gözcü.** Test ortamında kapalı; pilot ortamı için hazırlar (`YEDEKLEME.md`).

## 6. Kapatma veya sıfırlama

- **Davet bağlantısını değiştirmek:** `TEST_ACCESS_TOKEN` gizli değerini değiştir ve iş akışını yeniden çalıştır. Eski bağlantı ve eski çerezler çalışmaz olur.
- **Demo verisini sıfırlamak:** Sunucuda `sudo systemctl stop goverhub-test-api && sudo -u postgres dropdb goverhub_demo` komutunu çalıştır, ardından iş akışını yeniden çalıştır.
- **Tamamen kaldırmak:** Sunucuyu sağlayıcı panelinden sil ve DNS kaydını kaldır.
