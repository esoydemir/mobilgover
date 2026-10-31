# Pilot gösterimi (uçtan uca arayüz)

Gerçek web arayüzü + gerçek API + gerçek PostgreSQL üzerinde, kullanıcı gibi tıklayarak ilerleyen kayıtlı gösterim (Playwright). Kurallar ve hizmet kategorileri **örnektir**; e-posta kodları demo ortamının geliştirme kutusundan okunur.

1. Demo ortamını hazırla: boş veritabanı, `npm run migrate`, platform verisi (`seedPlatform` + `seedDemoProvider(..., 'murat@demo.goverhub.test')`), `DEMO_MODE=true`, `CORS_ORIGINS=http://localhost:8099`.
2. API'yi 3077'de çalıştır; mobil web derlemesini `EXPO_PUBLIC_API_URL=http://localhost:3077 npx expo export --platform web` ile al ve `dist/` klasörünü 8099'da SPA olarak sun.
3. `node pilot-walkthrough.js <çıktı-klasörü> <örnek.jpg>` ardından `node offline-sync.js <çıktı-klasörü>`.

Not: Web sürümü çevrimdışıyken sayfanın yeniden yüklenmesini desteklemez (service worker yok); çevrimdışı gösterimde uygulama açık kalır. Telefonda bu sınırlama yoktur.

## Mobil tarayıcı öykünmesi

`DEVICE="Pixel 7"` veya `DEVICE="iPhone 14"` ile iki betik aynı akışı Playwright cihaz profilinde çalıştırır (dokunmatik, mobil tarayıcı kimliği, cihaz ekranı). Her çalıştırmadan önce veritabanını sıfırla; aksi halde ikinci çalıştırma ilkinin tamamladığı görevi açar. `pilot-walkthrough.js` her ekran görüntüsünde yatay taşmayı ölçer. Bu öykünmedir, gerçek telefon değildir.

`ORIGINS=http://localhost:8099,http://<lan-ip>:8098 node secure-context.js <klasör>`: aynı görev sayfasını güvenli ve güvensiz adresten açar. Tarayıcı fotoğraf özetini yalnızca https/localhost'ta hesaplar; güvensiz adreste uygulama uyarı göstermelidir.
