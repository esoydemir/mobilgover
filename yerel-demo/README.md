# GoverHub yerel demo (Windows)

Uygulamayı **kendi bilgisayarında**, sunucu, alan adı ya da e-posta hizmeti olmadan denemek içindir. Yalnızca demo verisi kullanılır. Üretim için değildir; kurallar örnektir ve hiçbirinin mevzuat onayı yoktur.

## 1. Gereken tek program: Docker Desktop

**Kurulu mu?** Başlat menüsünde "Docker Desktop" uygulamasını ara. `baslat.cmd` dosyası da açılışta bunu kontrol eder; Docker yoksa ya da çalışmıyorsa ne yapacağını yazar.

**Kurulum (bir kez):**
1. PowerShell'i aç ve `winget install -e --id Docker.DockerDesktop` komutunu çalıştır. İstersen https://www.docker.com/products/docker-desktop/ adresinden indirip kurabilirsin.
2. Bilgisayarı yeniden başlat. Docker Desktop'ı bir kez aç ve kullanım koşullarını kabul et. Hesap açman gerekmez; "Continue without signing in" ile devam edebilirsin.
3. Önerilir: Docker Desktop → Settings → General → **"Start Docker Desktop when you sign in"** açık olsun. Böylece bilgisayar açıldığında demo kendiliğinden geri gelir.

**Gerekenler:**
- Windows 10 (22H2) ya da Windows 11, 64 bit
- BIOS'ta sanallaştırmanın açık olması (çoğu bilgisayarda açıktır)
- En az 8 GB RAM önerilir
- Yaklaşık 6 GB boş disk (imajlar ve ilk derleme)

Docker Desktop kişisel kullanımda ve küçük işletmelerde (250'den az çalışan ve 10 milyon dolardan az yıllık gelir) ücretsizdir. Daha büyük kurumlarda ücretli abonelik gerekir.

## 2. Projeyi bilgisayara al

GitHub'da **esoydemir/mobilgover** deposunu aç. **Code → Download ZIP** ile indir; dal `goverhub-mobile` olmalı. Sonra ZIP'i bir klasöre çıkar, örneğin `C:\GoverHub`.

> Windows indirilen dosyalar için "Windows bilgisayarınızı korudu" uyarısı gösterebilir. Bunu önlemek için çıkarmadan önce ZIP'e sağ tıkla → **Özellikler** → **Engellemeyi kaldır** → Tamam. Uyarı yine de çıkarsa "Ek bilgi" → "Yine de çalıştır" seçebilirsin.

## 3. Kullanım: `yerel-demo` klasöründeki dosyalara çift tıkla

| Dosya | Ne yapar | Kayıtlar |
|---|---|---|
| `baslat.cmd` | Demoyu başlatır ve tarayıcıda **http://localhost:8080** adresini açar. İlk seferde imajları hazırlar (internet gerekir, 5–15 dk); sonraki açılışlar kısa sürer | Korunur |
| `durdur.cmd` | Demoyu durdurur | Korunur |
| `durum.cmd` | Neyin çalıştığını gösterir | — |
| `tunel-ac.cmd` | Telefon testi için geçici HTTPS adresi ve davet bağlantısı üretir (§5) | Korunur |
| `tunel-kapat.cmd` | Tüneli kapatır; bilgisayardaki demo çalışmaya devam eder | Korunur |
| `SIFIRLA-tum-demo-verisi.cmd` | **Bütün demo kayıtlarını ve fotoğrafları siler.** Büyük harflerle `SIFIRLA` yazmadıkça hiçbir şey silmez | **Silinir** |

**Bilgisayarı yeniden başlatınca:** Kayıtlar Docker birimlerinde durur ve silinmez.
- Docker Desktop oturum açılışında başlıyorsa, demo kendiliğinden geri gelir. Bunun bir istisnası var: `durdur.cmd` ile durdurduysan kendiliğinden gelmez.
- Docker Desktop kendiliğinden başlamıyorsa `baslat.cmd` yeter.

Normal başlatma hiçbir kaydı silmez. Yalnızca eksikse demo verisini yükler ve önümüzdeki 30 günün eksik görevlerini ekler.

## 4. Giriş

1. **http://localhost:8080** adresini aç.
2. E-posta olarak `sahip@demo.goverhub.test` yaz ve **Kod gönder**e bas.
3. **Demo kutusundan kodu getir**e, sonra **Giriş yap**a bas.

E-posta gönderilmez. Yalnızca `@demo.goverhub.test` uzantılı adresler kabul edilir; gerçek bir adres girersen sunucu reddeder.

| Hesap | Rol |
|---|---|
| `sahip@demo.goverhub.test` | İşletme sahibi: "Kahve Durağı (DEMO)" |
| `mudur@demo.goverhub.test` | Şube yöneticisi |
| `personel@demo.goverhub.test` | Personel |
| `uzman@demo.goverhub.test` | Hizmet sağlayıcı (soğutma teknisyeni, onaylı) |
| `danisman@demo.goverhub.test` | Danışman (süreli erişim) |
| `yazar@`, `onay@`, `yonetici@`, `pazar@`, `alan-uzmani@` | Platform rolleri (kural yazma ve onay, pazar yeri inceleme) |

**Denenebilecek akış:**
1. **Görev:** Bugünün görevlerinden soğutucu kontrolünü aç ve 9 °C gir. Limit dışı uyarısı çıkar.
2. **Fotoğraf:** Aynı göreve fotoğraf ekle. Sunucu dosyanın özetini doğrulayınca "saklandı" görünür.
3. **Uygunsuzluk:** Görevi tamamla. Sonuç uygunsuz olduğu için uygunsuzluk kaydı açılır.
4. **Uzman hizmeti:**
   1. Uygunsuzluk ekranında "Bu sorun için uzman hizmeti iste"ye bas.
   2. Çıkış yap: **Daha fazla → Hesap ve güvenlik → Çıkış**. Sonra `uzman@` hesabıyla gir. İşletme kurulum ekranı açılırsa **Hizmet sağlayıcıyım (uzman profili)** düğmesine bas ve talebe teklif ver.
   3. `sahip@` hesabıyla girip teklifi kabul et. Bu adımda bir iş giriş kodu oluşur.
   4. `uzman@` hesabıyla bu kodu girip rapor yaz.
   5. `sahip@` hesabıyla teslimi kabul et.
5. **Kapanış:** Uygunsuzluğun düzeltici adımlarını gir. Kapanışı, düzeltmeyi yapan kişiden farklı biri yapmalı (görevler ayrılığı).

Kendi işletmeni de kurabilirsin: yeni bir demo adresiyle gir, örneğin `ben@demo.goverhub.test`. Kurulum ekranı açılır; burada açılan işletmeler de demo olarak işaretlenir.

## 5. Telefon testi: geçici HTTPS tüneli

Telefon bilgisayardaki `localhost` adresine ulaşamaz. Fotoğraf eklemek için de HTTPS gerekir. `tunel-ac.cmd` bunun için Cloudflare'in ücretsiz, hesapsız geçici tünelini açar.

**Nasıl kullanılır:**
1. `tunel-ac.cmd` dosyasına çift tıkla. Pencerede `https://<rastgele>.trycloudflare.com/erisim/<anahtar>` biçiminde bir **davet bağlantısı** yazar ve bağlantıyı panoya kopyalar.
2. Bağlantıyı telefona kendine mesaj göndererek aktar ve telefonda aç. Telefona 24 saatlik bir erişim çerezi yazılır.
3. Girişi §4'teki gibi yap.
4. İş bitince `tunel-kapat.cmd` dosyasına çift tıkla.

**Bilinmesi gerekenler:**
- Tünel **yalnızca bu bilgisayar açıkken ve Docker Desktop çalışırken** çalışır. Bilgisayar uyursa ya da kapanırsa telefondan erişim kesilir.
- Adres ve davet anahtarı her `tunel-ac.cmd` çalıştırmasında değişir; eski bağlantılar çalışmaz olur.
- Davet bağlantısı olmadan adres yalnızca "davet gerekli" (403) sayfası gösterir. Bu kural uygulama, API ve demo posta kutusu için de geçerli.
- Tünel ağ düzeyinde ayrıdır: ulaşabildiği tek yer erişim kapısıdır. PostgreSQL, API ve yönetim arayüzleri tünelden ya da yerel ağdan erişilemez. Bilgisayarda dışarıya açılan tek port `127.0.0.1:8080`'dir, o da yalnızca bu bilgisayardan erişilebilir.
- Bu ücretsiz tünel deneme amaçlıdır; çalışma süresi garanti edilmez. Şirket ağları ve bazı güvenlik yazılımları tüneli engelleyebilir.

Telefonda denenecekler: `docs/TEST_ORTAMI.md` §4. Oradaki adres yerine tünel bağlantısını kullan.

## 6. Nasıl çalışıyor

```
Tarayıcı ──▶ 127.0.0.1:8080 ──▶ proxy (web + /api) ──▶ app (API) ──▶ db (PostgreSQL 16)
Telefon ──▶ trycloudflare ──▶ tunnel ──▶ kapi (davet çerezi) ──▶ proxy ──▶ …
```

**Kapsayıcılar:**
- `db`: Yalnızca iç ağda; internete kapalı ağda çalışır.
- `app`: Açılışta şemayı günceller, demo verisini yalnızca ilk kez yükler, sonra API'yi başlatır.
- `proxy`: Web uygulamasını ve API'yi tek adresten sunar.
- `kapi` ve `tunnel`: Yalnızca tünel açıkken çalışır.

**Kalıcı birimler:**
- `veritabani`: Kayıtlar
- `kanit`: Fotoğraflar
- `ayar`: Ek doğrulama (MFA) şifreleme anahtarı, ilk açılışta üretilir
- `kapi`: Davet anahtarı

`compose.yaml` içindeki veritabanı parolaları bu yerel demoya özeldir. Veritabanı hiçbir porta açılmaz.

## 7. Sorun giderme

| Durum | Çözüm |
|---|---|
| "Docker Desktop kurulu görünmüyor" | §1 |
| "Windows containers kipinde" | Görev çubuğundaki Docker simgesine sağ tıkla → **Switch to Linux containers** |
| 8080 portu başka bir program tarafından kullanılıyor | O programı kapat. Port değiştirmek istersen `compose.yaml` içindeki `127.0.0.1:8080:8080` satırının ilk 8080'ini değiştir |
| İlk açılış uzun sürüyor | İlk derleme 5–15 dk sürer; pencereyi kapatma |
| Bir şey ters gitti | `durum.cmd` çıktısını ve `baslat.cmd` penceresindeki son satırları paylaş. Parola, anahtar ya da davet bağlantısı paylaşma |
