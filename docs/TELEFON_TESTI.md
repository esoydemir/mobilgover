# Mobil web — telefon doğrulaması

## 1. Durum

**Gerçek telefonda henüz denenmedi.** Ben fiziksel bir telefonu kullanamıyorum. Bu çalışma ortamı da yalnızca dışarıya bağlanabiliyor; telefondan gelen bağlantıyı kabul edemiyor. Bu yüzden telefonun açabileceği bir adresi buradan veremiyorum. Gerçek telefon testi için telefonun ulaşabileceği bir **https** adresine ihtiyaç var (bkz. §3). Geliştirici hesabı gerekmez.

## 2. Yapılan: mobil tarayıcı öykünmesi (gerçek telefon değil)

Tam pilot akışı ve çevrimdışı akış, Playwright cihaz profilleriyle çalıştırıldı. Arkada gerçek API ve gerçek PostgreSQL vardı. Profiller dokunmatik girişi, mobil tarayıcı kimliğini (user agent), cihaz ekran ölçüsünü ve piksel yoğunluğunu taklit ediyor.

| Profil | Ekran | Pilot akışı (26 adım) | Çevrimdışı akış | Yatay taşma | Sayfa hatası |
|---|---|---|---|---|---|
| Pixel 7 (Android, Chrome tarayıcı kimliği) | 412×839, 2.625x | geçti | geçti | yok | yok |
| iPhone 14 (iOS tarayıcı kimliği) | 390×664, 3x | geçti | geçti | yok | yok |

Çalıştırma: `DEVICE="iPhone 14" node e2e/pilot-walkthrough.js <klasör> <örnek.jpg>`.

**Sınırları:**

- iPhone profili Chromium motoruyla çalıştı. Safari'nin motoru (WebKit) bu ortamda kurulu değil; Safari'ye özgü davranışlar denenmedi.
- Kamera, gerçek klavye, ekran döndürme ve uygulamanın arka plana alınması denenmedi.
- Uçak modu ve zayıf şebeke yalnızca tarayıcının "çevrimdışı" anahtarıyla taklit edildi.

**Öykünmenin bulduğu sorun:** Tarayıcılar fotoğrafın SHA-256 özetini hesaplayan arayüzü (`crypto.subtle`) yalnızca güvenli sayfalarda açıyor: `https` ya da `localhost`. Telefondan `http://192.168.x.x` gibi bir yerel ağ adresiyle açılınca fotoğraf eklenemiyor.

- Uygulama artık bu durumda fotoğraf kartında açık bir uyarı gösteriyor.
- `e2e/secure-context.js` aynı görev sayfasını iki adresten açıyor ve uyarıyı doğruluyor. `localhost` adresinde fotoğraf kartı var, uyarı yok. Yerel ağ `http` adresinde güvenli bağlam yok ve uyarı görünüyor.
- Sonuç: **telefon testi https ile yapılmalı.**

## 3. Gerçek telefon testi nasıl yapılır

Bir https adresi gerekiyor. Üç yol var; en hızlısından en kalıcısına:

1. **Kendi bilgisayarında geçici tünel.** `KURULUM.md` ile sunucuyu ve web derlemesini çalıştır. Ardından iki adresi https tüneliyle dışarı aç: web ve API (ör. Cloudflare Tunnel veya ngrok; ikisinin de ücretsiz katmanı var).
   - Web derlemesini `EXPO_PUBLIC_API_URL=https://<api-tünel-adresi>` ile al.
   - `CORS_ORIGINS` değerine web tünelinin adresini yaz.
   - Yalnızca demo veritabanıyla yap: demo modunda giriş kodları uygulama içinden okunabilir.
2. **Pilot sunucusu.** Türkiye barındırma kararı verildiğinde demo ortamı https ile oraya kurulur. Telefon testi orada yapılır. Bu yol kontrollü pilotun zaten bir parçası.
3. **Aynı Wi-Fi + yerel ağ adresi.** Fotoğraf dışındaki her şey denenebilir; fotoğraf ekleme bilinçli olarak engelli kalır (uyarıyla).

### Kontrol listesi

Her satır için cihaz modeli, işletim sistemi sürümü ve tarayıcıyla birlikte geçti/kaldı notu düş.

| # | Adım | Beklenen |
|---|---|---|
| 1 | Adresi Safari'de (iPhone) ve Chrome'da (Android) aç | Giriş ekranı; üstte "DEMO · ÖRNEK VERİ" etiketi |
| 2 | E-postayla giriş yap | Kod alanına sayı klavyesi gelir; giriş tamamlanır |
| 3 | İşletme kurulumu: işletme, profil, ekipman, görevler | Klavye alanları örtmez, sayfa yana kaymaz |
| 4 | Soğutucu kontrolü: 9 °C gir | Limit dışı uyarısı çıkar, kayıt engellenmez |
| 5 | Fotoğraf ekle → **kamera** seçeneği | Telefon kamera seçeneği sunar; fotoğraf eklenir, "gönderildi" ancak sunucu özeti doğrulayınca görünür |
| 6 | Görevi tamamla | "Yapıldı · sonuç uygunsuz"; uygunsuzluk açılır |
| 7 | Uçak modunu aç; bir kontrol listesi doldur ve görevi tamamla | "Cihazda · gönderilecek" görünür |
| 8 | Uygulamayı (sekmeyi) kapatma; uçak modunu kapat | Kayıtlar kendiliğinden ya da "Şimdi eşitle" ile gider; görev sunucuda "yapıldı" olur |
| 9 | Uygunsuzluk adımları ve kapanış | Kendi yaptığı düzeltmeyi kapatmaya çalışan kişi reddedilir |
| 10 | Rapor ve denetim dosyası | Ekran okunur, tablolar taşmaz |
| 11 | Ekranı yan çevir | Düzen bozulmaz |
| 12 | Ana ekrana ekle (Safari: Paylaş → Ana Ekrana Ekle) | Uygulama tam ekran açılır |

Bilinen web sınırı: Web sürümü çevrimdışıyken sayfa yenilenirse yeniden açılmaz, çünkü service worker yok. Telefon uygulamasında (native) bu sınır yok. Web pilotu kalıcı olacaksa service worker eklenmeli.
