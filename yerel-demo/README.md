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
| `personel@demo.goverhub.test` | Personel (Elif): yalnızca kendisine atanan görevleri görür; demoda eldiven kontrolünün sorumlusu |
| `uzman@demo.goverhub.test` | Hizmet sağlayıcı (soğutma teknisyeni, onaylı) |
| `danisman@demo.goverhub.test` | Danışman (süreli erişim) |
| `moderator@demo.goverhub.test` | Mesleki ağ moderatörü (şikâyet kuyruğu) |
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
5. **Kapanış:** Uygunsuzluk ekranındaki akışı sırayla izle:
   1. İlk müdahale
   2. Sorumlu ve termin
   3. Neden değerlendirmesi
   4. Aksiyonlar
   5. Doğrulanmış kök neden
   6. Etkinlik kontrolü
   7. Doğrulama

   Her aksiyon için **"Yapıldı" bildir** bir beyandır: aksiyon kanıt istiyorsa önce fotoğraf/belge eklenir; beyanı sorumlu, beyan eden ve kanıt verenden başka bir yönetici **Sonucu doğrula** ile onaylar ya da reddeder. Doğrulanmamış beyan akışta sonuç sayılmaz.

   Yüksek riskli kayıtta kapanışı, bu turdaki düzeltme ya da düzeltici faaliyette payı olan (sorumlu, yapan, kanıt veren) hiç kimse doğrulayamaz.

**Elle uygunsuzluk ve destek önerisi:**
1. `personel@` ile **Daha fazla → Uygunsuzluklar → Sorun bildir** adımlarını izleyip bir kayıt aç.
2. Neden olarak birden fazla seçenek işaretle; **Önerilen destek** kartı açılır. Öneriler hiçbir şeyi kendiliğinden sipariş etmez.
3. `sahip@` ile ana sayfadaki zile bas. Bildirimden kayda git ve sorumlu ile termini belirle.
4. Doğrulamada **"Etkili değil · açık kalsın"** seçilirse kayıt açık kalır ve yeni tur başlar.
5. Kapanan kayıt gerekçe yazılarak yeniden açılabilir.

**Zorunlu yükümlülükte "uygulanmaz":**
1. `sahip@` ile Soğuk muhafaza yükümlülüğünde **Uygulanmaz de** seçeneğini kullan. Kuralın hangi koşulunun sizde farklı olduğunu seç (ör. "Soğuk depolama: Hayır") ve dayanağı yaz. Önerdiğin bilgilerle kural hâlâ uyuyorsa istek gönderilemez.
2. `danisman@` ile zildeki bildirimden aç. Onay, bilgileri doğrulanmış olarak profile işler; kararı kural motoru verir. Bilgiler kurala hâlâ uyuyorsa onay reddedilir ve yükümlülük sürer.

**Tek yöneticili işletme ve dış doğrulayıcı (4. teslim):**
1. Kendi tek yöneticili test işletmeni kurmak için yeni bir demo adresiyle gir (ör. `ben@demo.goverhub.test`) ve işletmeyi kur; yalnız sen yöneticisin.
2. **Düşük riskli** bir sorun bildir (önem: Düşük), kendine aksiyon ekle, **"Yapıldı" bildir**. **Öz doğrulama yap** → gerekçe (en az 20 karakter) + "payım var" işareti → kayıt "DOĞRULANDI · ÖZ DOĞRULAMA" olur. Kapanış da aynı şekilde etiketlenir.
3. **Kritik** bir sorun bildir ve aksiyonu "yapıldı" bildir: öz doğrulama sunulmaz. **Dış doğrulayıcı davet et** → e-posta (ör. `dogrulayici@demo.goverhub.test`), şube, süre, gerekirse "belge inceleme" → **Davet et**.
4. Çıkış yapıp `dogrulayici@demo.goverhub.test` ile gir: **Doğrulama bekleyenler** açılır; beyanı doğrula. Aksiyon ekleyemez, sorumlu atayamaz.
5. Sahip olarak etkinlik kontrolünü kaydet; kapanışı sen yapamazsın, doğrulayıcı kapatır ("dış doğrulayıcı" etiketi). **Daha → Dış doğrulayıcılar**'dan izni kaldırabilirsin.

**Eğitim → uygulama → etkinlik doğrulaması (5. teslim):**
1. `mudur@` ile bir sorun bildir (konu: Sıcaklık / soğuk zincir), sorumluyu `personel@` yap, ilk değerlendirmede **Bilgi eksikliği** seç.
2. Önerilerde **Kişiye eğitim ata** → "BU KONUYLA İLGİLİ" örnek eğitimi, kişiyi ve termini seç → **Eğitimi ata**. Kayıtta **EĞİTİM** kartı açılır.
3. Aynı kayda `personel@` sorumlu ve fotoğraf kanıtlı bir aksiyon ekle (sahada uygulama kanıtı olacak).
4. `personel@` ile zildeki "Sana bir eğitim atandı" bildirimini aç → **Okudum / izledim** → soruları cevapla → **Eğitimi tamamladım**. Sonra kayıttaki aksiyona fotoğraf ekleyip **"Yapıldı" bildir**.
5. `mudur@` ile "Eğitim tamamlandı" bildiriminden aç → aksiyonu uygulama kanıtı seç → gözlemini yaz → **Kaydet**. Uygunsuzluk açık kalır; kendi doğrulamasıyla kapanır.
6. İçerik: **Daha → Eğitimler → İçerikler → Yeni eğitim içeriği** (`mudur@` yazar ve incelemeye gönderir; `sahip@` yayımlar).

**Eğitim takipleri (5B):**
1. Tek yöneticili işletmede kendi yazıp yayımladığın içerikte "İşletme içi içerik · bağımsız inceleme yapılmadı" etiketi görünür; içerik ağa gitmez.
2. Bir sıcaklık kontrolünü aç: altta **İLGİLİ EĞİTİMLER**.
3. Atama ekranında **Termini değiştir** gerekçe ister; kişiye bildirilir. Yaklaşan (24 saat) ve geciken termin bildirimi saatlik taramayla bir kez gelir.
4. Tamamlanmış atamada sahada **Etkili değil** seç → **Yeniden eğitim ata** (önceki kayıt aynen kalır, yeni atama öncekine bağlanır) ya da **Kayda ek aksiyon ekle**.

**Mesleki ağ (5B):**
1. `sahip@` ile **Daha → Mesleki ağ → Profil oluştur**: ad, unvan, tanıtım, il/ilçe, uzmanlık ve kategori seç → **Profili oluştur**. Sonra fotoğraf ekle ve deneyim ekle. E-posta/telefon kutuları işaretlenmedikçe gizli kalır.
2. **Uzman ara**: uzmanlık "soğutma" + kategori "Soğutma teknik servisi" → Murat Yıldız. Ekranda sıralama ölçütleri ve "neden üstte" yazar. Metne "Zeynep" yaz: onaysız profil de çıkar; **Yalnız hizmet onayı olanlar** onu gizler.
3. Murat'ın profilinde **Takip et**. Bölümler ayrı: kişisel beyan / kontrol edilmiş belgeler / hizmet onayı / doğrulanmış hizmet geçmişi.
4. **Paylaş**: taslak kaydet → düzenle → yayımla. Bir gönderiye yorum yaz. Başkasının gönderisinde **Şikâyet et**.
5. Murat'ın profilinde **Hizmet talebi başlat**: yalnız onaylı kategorisi listelenir; talep yalnız ona gider. Formu açmak kayıt oluşturmaz.
6. Bir uygunsuzlukta **Vakayı mesleki ağda paylaş**: özet yaz → **Önizle ve kontrol et** (ad, telefon, fiyat yazarsan uyarır) → izin kutusu → taslak → yayımla.
7. `moderator@` ile **Daha → Ağ moderasyonu**: karar seç, gerekçe yaz → **Kararı kaydet**.

**Kayda özel dış doğrulayıcı (5. teslim):** kayıttaki **Dış doğrulayıcı davet et** düğmesi "Yalnız seçili kayıtlar" kapsamıyla açılır; doğrulayıcı yalnız o kaydı ve kanıtlarını görür.

**Belge kasası (3.–4. teslim):**
1. `mudur@` ile **Daha fazla → Belge kasası → Belge ekle**: tür "Kalibrasyon sertifikası", **Ekipman** → buzdolabı. **Belgeyi oluştur**.
2. **Yeni sürüm / dosya ekle**: bir PDF ya da fotoğraf seç, geçerlilik sonunu ör. 10 gün sonrası yaz (YYYY-AA-GG), **Yükle ve incelemeye gönder**. Durum: "İNCELEME BEKLİYOR · GEÇERLİ SAYILMAZ"; yükleyen inceleyemez.
3. `sahip@` ile zildeki "Yeni belge sürümü incelemeni bekliyor" bildiriminden aç → **Kurum içi incele** → not yaz → **İncelendi**. Durum "KURUM İÇİ İNCELENDİ" olur (resmî doğrulama değildir) ve "SÜRESİ YAKLAŞIYOR" uyarısı görünür.
4. Belgeyi kurumla doğruladıysan **Kurum doğrulamasını kaydet** → yöntem + referans (ör. barkod no) → "DÜZENLEYEN KURUMDAN DOĞRULANDI".
5. **Aç** / **İndir** ile dosyayı görebilirsin. İşletme geneli belgede **Şubelerle paylaşım** ile şube yöneticisine yalnız okuma izni ver.

**Hizmet değerlendirmesi (3. teslim):**
1. Yukarıdaki uzman hizmeti akışında teklif gelince ve rapor teslim edilince `sahip@` zile bildirim düşer.
2. Teslimi kabul ettikten sonra iş ekranında **Hizmeti değerlendir** formu açılır (kalite, zamanlama, iletişim; isteğe bağlı yorum). "Uzman profilinde gösterilmesine izin ver" işaretlenirse iş, işletme adı olmadan uzmanın profilinde **Doğrulanmış hizmet geçmişi** altında görünür. Teslim alınmamış iş değerlendirilemez; bir iş bir kez değerlendirilir.

**6. aşama — vakadan kalıcı çözüme, yönetici ekranı, doğru uzman, belge/eğitim/PDF, kural yazma.** Hepsi örnek veridir; adım adım deneme listesi ve hangi testin neyi doğruladığı: `docs/ASAMA6_DENEME_PAKETI.md`.

1. **Kritik kayıtta ilk adım (6A):** `personel@` ile **Daha → Uygunsuzluklar → Sorun bildir**, önem **Kritik**, ekipman buzdolabı. Kayıtta üstte **ÖNCE BUNLAR** kutusu çıkar; destek önerileri ilk işlem yapılana kadar bekler. `mudur@` ile **Sorumlu ve termin ata** → öneriler açılır. Birden fazla neden seçersen birden fazla öneri gelir; **Bu öneri uymuyor · gerekçeyle değiştir** ile değiştirebilirsin.
2. **İlgili kayıtlar ve etkinlik (6A):** kayıt ekranındaki **İLGİLİ KAYITLAR**dan ekipman geçmişine, belgeye, hizmet talebine gidip geri dön. Etkinlik kontrolünde yeni ölçüm yaz (ör. 9 °C): limit dışıysa etkili sayılmaz, yeni tur açılır ve önceki tur görünür kalır.
3. **Yönetici ekranı (6B):** `sahip@` ya da `mudur@` ile **Daha → Bugün · yönetici ekranı**. Her sayıya bas: arkasındaki kayıtlar açılır. Şube/tarih/konu/ekipman/sorumlu filtreleri; **Tekrarlayan sorunlar**da neden önerildiği yazar → **Aynı sorun · ilişkilendir** ya da **İlgisiz**. `personel@` aynı menüde yalnız **Bana atananlar**ı görür. İkinci şube: **Daha → Ekip → Şube ekle**.
4. **Doğru uzman (6C):** **Daha → Mesleki ağ → Uzman ara** → "dolabım soğutmuyor" yaz → "Soğutma teknik servisi" önerisi. Sonuç yoksa hangi filtrenin kaldırılabileceği yazar. Kayıttan hizmet iste: gönderilmeden önce **uzmanın göreceği önizleme** (özel fotoğraf, personel, belgeler kapalı). Teklifler aynı sırayla karşılaştırılır (kapsam, hariç, fiyat, süre, teslim edilecek çıktı). Teslimde **Teslim kabul et** ya da **Gerekçeyle revizyon iste**.
5. **Vaka paylaşımı geri çekme (6C):** gönderi yayımlandıktan sonra metni değiştirirsen ağdan kalkar ve yeniden izin ister. **Uygunsuzluk → İşletmenin vaka paylaşımları → Ağdan geri çek**. **Mesleki ağ → Şikâyetlerim**: şikâyet durumu ve itiraz.
6. **Belge ve eğitim (6D):** **Belge kasası** üstündeki filtreler (süresi yaklaşan, dolmuş, inceleme bekleyen, reddedilen); belgede **NE İÇİN KULLANILIYOR**. **Eğitimler → içerik → KİŞİLER**: atandı / tamamladı / geçti / sahada doğrulandı ayrı.
7. **PDF denetim dosyası (6D):** ana sayfadaki uyum göstergesine bas → **PDF DENETİM DOSYASI** → şube ve tarih aralığı → **PDF indir**. Şube yöneticisi yalnız kendi şubesini alır.
8. **Kural yazma (6E):** `yazar@` ile **Daha → Yönetim → Yeni kural taslağı yaz** → kaydet → **örnek profillerde önizleme** → incelemeye gönder. `alan-uzmani@` ve `onay@` onaylar, `yonetici@` yayımlar. Geçmiş görevler eski kural sürümünde kalır.
9. **Kurum görünümü (6E):** **Daha → Kurum görünümü (sentetik demo)**. Gerçek veri değildir; küçük gruplar gizlenir, az veride yorum yapılmaz.

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

## 6. Temiz kurulum mu, güncelleme mi?

| Durum | Ne yapılır | Kayıtlara ne olur |
|---|---|---|
| **Temiz kurulum** (bu bilgisayarda hiç GoverHub yok, ya da ayrı bir deneme ortamı istiyorsun) | Projeyi **yeni bir klasöre** çıkar, `baslat.cmd`. Ayrı ortam için §6.3 | Boş başlar: veritabanı değişiklikleri (migration) sırayla uygulanır, demo girişleri ve ilk işletme yüklenir |
| **Veri koruyan güncelleme** (çalışan demo var, yeni sürüm gelecek) | Önce `yedek-al.cmd`, sonra `durdur.cmd`, yeni klasöre çıkar, `baslat.cmd` (§6.1) | İşletme, şube, görev, belge sürümleri, randevu geçmişi ve denetim kayıtları aynen kalır |
| **Geri yükleme** | §6.2 | Yedekteki hâle döner; **yalnızca boş bir ortama** yüklenir |

**Güncellemeden önce her seferinde `yedek-al.cmd` çalıştır** ve `yedek-anahtari-goster.cmd` ile aldığın anahtarı yedeklerin bulunduğu yerden **ayrı** bir yerde sakla. Anahtarsız yedek açılamaz.

### 6.1 Yeni sürüme güncelleme (kayıtlar silinmez)

1. `yedek-al.cmd` çalıştır, sonra `yedek-dogrula.cmd` ile yedeğin açıldığını gör. Sonra `durdur.cmd` dosyasına çift tıkla.
2. GitHub'dan yeni ZIP'i indir (§2) ve **yeni bir klasöre** çıkar (ör. `C:\GoverHub-yeni`). Eski klasörü silmen gerekmez.
3. Yeni klasördeki `yerel-demo\baslat.cmd` dosyasına çift tıkla.

Kayıtlar klasörde değil, Docker'ın `goverhub-demo` adlı birimlerinde durur. Yeni sürüm aynı birimleri kullanır:
- Açılışta veritabanı değişiklikleri yalnızca **eklenerek** uygulanır (`server/migrations`).
- Demo verisi yeniden yüklenmez.
- Eksik görevler tamamlanır.

Güncellemeden sonra kayıtların yerinde olduğunu `durum.cmd` ve uygulamadaki listelerden görebilirsin. Hiçbir güncelleme `SIFIRLA-tum-demo-verisi.cmd` dosyasını çalıştırmaz.

6. aşama notu: güncellemede 012–016 numaralı veritabanı değişiklikleri eklenir. Eski kayıtlar olduğu gibi açılır; bu, 5B sürümüyle yazılmış veriyle ayrı birimlerde denendi (`e2e/yukseltme-6.cjs`: uygunsuzluk, fotoğraf, belge dosyası, ağ gönderisi, kayıt sayıları ve denetim geçmişi aynı kaldı).

3. teslim notu: güncellemeden önce yeni uygunsuzluk akışında "tamamlandı" denmiş aksiyonlar artık **"yapıldı" beyanı · doğrulama bekliyor** olarak görünür; bir yönetici doğrulayana kadar sonuç sayılmaz. Kayıt silinmez.

### 6.2 Yedekten geri yükleme (önce ayrı bir deneme ortamında)

Yedek komutları: `yedek-al.cmd` (şifreli: kayıtlar + dosyalar), `yedek-listele.cmd`, `yedek-dogrula.cmd` (en yeni yedeği baştan sona çözüp sınar), `yedek-anahtari-goster.cmd`, `butunluk.cmd` (denetim zinciri ve dosya özetleri).

Geri yükleme **yalnızca boş bir ortama** yapılır; dolu bir veritabanının ya da kanıt klasörünün üstüne yazmayı araç reddeder. Bu yüzden geri yüklemeyi çalışan demoya değil, ayrı bir ortama yap. Aşağıdaki adımlar `yerel-demo` klasöründe PowerShell'de; çalışan demonun proje adı `goverhub-demo`, deneme ortamınki `goverhub-geri` olsun (8096 portu, 172.30.72.0/24 ağı):

```powershell
$env:AYRI_PORT = "8096"; $env:AYRI_ALTAG = "172.30.72"
$DC = @("compose","-p","goverhub-geri","-f","compose.yaml","-f","ayri-ortam.yaml")
docker @DC build app proxy                     # imajlar (ilk seferde birkaç dakika)
docker @DC up -d --no-deps db                  # boş veritabanı (uygulama henüz açılmaz)
# yedekleri ve anahtarları çalışan demodan kopyala (anahtar yedeklerle AYNI birimde olmamalı; kopyalama yalnız deneme içindir)
docker run --rm -v goverhub-demo_yedek:/k:ro -v goverhub-geri_yedek:/h alpine sh -c "cp -a /k/. /h/ && chown -R 1000:1000 /h"
docker run --rm -v goverhub-demo_ayar:/k:ro -v goverhub-geri_ayar:/h alpine sh -c "cp /k/yedek.key /h/ && cp /k/mfa.key /h/ && chown 1000:1000 /h/* && chmod 600 /h/*.key"
docker @DC run --rm --no-deps --entrypoint goverhub-yedek app geri-yukle   # son yedeği yükler ve sınar
docker @DC up -d --no-deps app proxy                                       # http://localhost:8096
```

Başarı ölçütü: komut **"SONUÇ: TAMAM"** yazar (şifre çözme, migration listesi, tablo satır sayıları, denetim zincirleri, **kayıtlı her kanıt dosyasının varlığı ve özeti**). **Dosyalar eksikse ya da özetleri tutmuyorsa tatbikat başarılı sayılmaz**; araç bu durumda hata verir. Sonra 8096'da bir görevi, bir belge sürümünü ve bir kanıt fotoğrafını açıp çalışan demoyla karşılaştır.

Yarıda kesilen geri yükleme: aracın işlem günlüğü kapsayıcının içinde durur; kesilirse ortamı silip (`docker @DC down -v`) baştan boş kur ve yeniden yükle. `-p goverhub-geri` yerine çalışan demonun proje adını yazarsan onu silersin; komutu çalıştırmadan önce proje adını kontrol et.

Deneme bitince: `docker @DC down -v` yalnızca `goverhub-geri` ortamını siler.

### 6.3 Ayrı, boş ortam (temiz kurulum denemesi)

Çalışan demoya dokunmadan sıfırdan kurulum denemek için yukarıdaki `ayri-ortam.yaml` ile aynı yöntem: `docker @DC up -d --build` (yukarıdaki §6.2'nin ilk iki komutundaki `$env:` ve `$DC` tanımlarıyla). Farklı proje adı ayrı birimler demektir; çalışan demonun kayıtlarına dokunulmaz. Port ve ağ aralığı her ortamda farklı olmalı.

### 6.4 Bağımlılıklar ve eksik olursa ne olur?

| Bileşen | Ne için | Nereden gelir | Eksikse kullanıcı ne görür |
|---|---|---|---|
| Yerel dil modeli (ör. Ollama + `qwen2.5-coder:7b`) | Kaynaklı asistanın cümle kurması | **Ayrıca kurulur**; `LLM_BASE_URL`, `LLM_MODEL` (`compose.yaml` ortam değişkenleri) | Asistan çökmez; yalnız kaynakları listeler ve "Dil modeline ulaşılamadı" der |
| Türkçe OCR (Tesseract) | Taranmış belge ve fotoğraftan alan önerisi | İmaja gömülü (`tesseract.js` + Türkçe veri) | Okunamayan dosyada "yeniden dene / elle gir"; metin katmanlı PDF yine okunur |
| PDF üretimi (`pdfkit` + DejaVu yazı tipi) | PDF denetim dosyası | İmaja gömülü | PDF indirilemez; ekran özetleri çalışır |
| PostgreSQL 16 istemcisi (`pg_dump`, `pg_restore`, `psql`) | Yedek ve geri yükleme | `app` imajına gömülü | Yedek komutu hata verir; kayıtlar etkilenmez |

Hangi parçanın eksik olduğunu sunucu söyler: `http://localhost:8080/api/system/modules` (OCR, PDF, model; her biri için eksik olan, kullanıcının neyi kaybettiği ve nasıl düzeltileceği). Model sağlıklı mı sorusu, modelin **yanıt kalitesinden** ayrıdır: bu uç yalnız modele ulaşılıp ulaşılamadığını söyler.

**Otomatik tarayıcı testleri (isteğe bağlı, geliştirici için):** `e2e/yerel-demo-akis.cjs`, `e2e/yerel-demo-yeni.cjs`, `e2e/yerel-demo-tek-yonetici.cjs`, `e2e/yerel-demo-egitim.cjs`, `e2e/yerel-demo-ag.cjs`, `e2e/yerel-demo-6-sogutucu.cjs` ve `e2e/yerel-demo-6-diger.cjs` her çalıştırmada kendi demo işletmesini ve `<rol>.<çalıştırma>@demo.goverhub.test` adreslerini oluşturur; mevcut demo işletmesine yazmaz. Bu test işletmeleri de demo olarak işaretlidir; sıfırlama onları da siler.

## 7. Nasıl çalışıyor

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

## 8. Sorun giderme

| Durum | Çözüm |
|---|---|
| "Docker Desktop kurulu görünmüyor" | §1 |
| "Windows containers kipinde" | Görev çubuğundaki Docker simgesine sağ tıkla → **Switch to Linux containers** |
| 8080 portu başka bir program tarafından kullanılıyor | O programı kapat. Port değiştirmek istersen `compose.yaml` içindeki `127.0.0.1:8080:8080` satırının ilk 8080'ini değiştir |
| İlk açılış uzun sürüyor | İlk derleme 5–15 dk sürer; pencereyi kapatma |
| Bir şey ters gitti | `durum.cmd` çıktısını ve `baslat.cmd` penceresindeki son satırları paylaş. Parola, anahtar ya da davet bağlantısı paylaşma |
