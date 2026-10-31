# Pilot aşaması — durum, kanıt ve açık bağımlılıklar

Son güncelleme: 31.10.2026 (ikinci tur). Bu aşamada mobil uygulama gerçek API'ye bağlandı; uzman ağı ve hizmet pazarı eklendi. İkinci turda üyelik yaşam döngüsü, pazar yeri onay süreleri, çevrimdışı otomatik testler ve mobil tarayıcı öykünmesi eklendi. Bu proje bağımsızdır; adı benzeyen `esoydemir/goverhub` başka bir projedir (bkz. `DEVAMLILIK.md`).

## 1. Alınan kararlar ve uygulanışı

| Karar | Uygulama |
|---|---|
| Kural onayı: pilot içeriğini ürün sahibi onaylar; uzmanlık dışı hükümler alan uzmanı incelemesi ister | `rule_versions.required_review_areas` + `rule_area_reviews`. Alan uzmanı onayı olmadan "onaylı" duruma geçiş yok (`AREA_REVIEW_MISSING`). Taslak, incelemede, onaylı ve yayında ayrı durumlar; yönetim ekranında ayrı listelenir. |
| Pilot sektör: tek şubeli, yemek hazırlayan kafe/restoran | Kurulum akışı ve örnek kural kümesi bu kapsamda. |
| E-posta doğrulamalı giriş; yöneticilerde ek doğrulama | 6 haneli, 10 dakika geçerli kod. Kodun yalnızca özeti saklanır. 5 hatalı denemede kilitlenir; 15 dakikada en fazla 5 kod istenebilir. TOTP ek doğrulamada gizli anahtar AES-256-GCM ile şifrelenir. Platform işlemleri ek doğrulamasız oturumla yapılamaz (`MFA_REQUIRED`). |
| Türkiye'de barındırma; sağlayıcıdan bağımsız kurulum | Kurulum yalnızca Node.js + PostgreSQL + dosya dizini ister; bulut sağlayıcıya özgü bağımlılık yok. |
| Kayıt türüne göre saklama matrisi; onaysız sürelerle otomatik silme yok | 10 kayıt türü için `retention_policies` tablosu. Bir kişi süre önerir, başka biri onaylar ve hukuki dayanak zorunludur. Sistemde **hiçbir silme işi yok**. |
| Profil açmak ≠ hizmet verme yetkisi; kategori bazında onay; kimlik ≠ yetkinlik | Profil herkese açık. Hizmet verme yetkisi kategori bazında verilir ve doğrulanmış kimlik ile o kategorinin istediği süresi geçmemiş mesleki belgeleri gerektirir; dayanak olan doğrulamalar kayda geçer. Profil ekranında kimlik, mesleki belge ve kontrol edilmeyen alanlar ayrı ayrı yazar. |
| Ödeme ayrı aşamada | Her işte `payment_status = 'not_in_scope'`. Arayüz "ödeme uygulama dışında" der. Kart verisi hiçbir yerde yok. |

## 2. Çalışan pilot (uygulama üzerinden, gerçek API ile)

Kayıt: `e2e/pilot-walkthrough.js` ve `e2e/offline-sync.js`. Ortam: demo modu, gerçek PostgreSQL, gerçek API, mobil uygulamanın web derlemesi. Saat dilimi Europe/Istanbul. Videolar ve ekran görüntüleri ayrıca teslim edildi.

1. İşletme sahibi e-postayla giriş yapar. Kod demo giden kutusundan okunur; gerçek e-posta gönderilmez.
2. İşletmeyi ve şubeyi oluşturur, profil sorularını yanıtlar, soğutucuyu ve kalibrasyon tarihi girilmiş termometreyi ekler, ilk haftanın 14 görevini oluşturur.
3. "Neden bana uygulanıyor?" ekranında eşleşen bilgiler, örnek kaynak hükmü ve karar geçmişi görünür.
4. Soğutucu kontrolünde 9 °C girer. Limit dışı uyarısı çıkar ama kayıt engellenmez. Fotoğraf yüklenir; özet cihazda hesaplanır ve sunucuda doğrulanır. Not eklenir ve görev "yapıldı · sonuç uygunsuz" olarak kapanır. Yüksek riskli, tam CAPA gerektiren bir uygunsuzluk açılır ve onaylı acil talimat gösterilir.
5. Uygunsuzluktan hizmet talebi açılır. Kategori "örnek" etiketlidir.
6. Ekip ekranından şube yöneticisi eklenir.
7. Demo uzman giriş yapar. Profilinde kimlik ve mesleki belge ayrı ayrı görünür. Teklif verir.
8. İşletme teklifleri aynı alanlarla karşılaştırır, birini kabul eder ve giriş kodunu alır.
9. Uzman kodla giriş yapar ve hizmet raporunu gönderir.
10. İşletme raporu okuyup teslim kabulü yapar.
11. Şube yöneticisi beş CAPA adımını yürütür. Kapatmaya çalışınca reddedilir: düzeltmeyi kendisi yaptı ve kayıt yüksek riskli.
12. Rapor ekranı "kritik risk açık" gösterir ve puan sınırlanır.
13. İşletme sahibi bağımsız doğrulamayla uygunsuzluğu kapatır.
14. Denetim dosyası oluşturulur: 37 olaylık zincir sağlam, kanıt dosyaları sağlam, gecikmiş kontrol eksik olarak listelenir, örnek kural uyarısı var.
15. Çevrimdışıyken kontrol listesi ve görev tamamlama cihazda tutulur ("cihazda · gönderilecek"). Bağlantı gelince sırayla gönderilir ve görev sunucuda "yapıldı · sonuç uygun" olur.
16. Giriş koruması: aynı adrese 15 dakikada 5'ten fazla kod istenince reddedilir. Bu, gösterim sırasında kendiliğinden yaşandı.

## 3. Testlerin sınıflandırması

| Tür | Dosyalar | Sayı | Ne doğrular | Neyi doğrulamaz |
|---|---|---|---|---|
| Saf mantık (birim) | `server/test/domain/*` | 31 | Üç değerli koşul mantığı, karar sırası, saat dilimi ve takvim, limit seçimi, kanıt yeterliliği, risk derinliği, bağımsız kapanış, gösterge formülü, karma zinciri, yetki matrisi | Veritabanı, ağ, arayüz |
| Gerçek entegrasyon (sunucu) | `slice`, `auth`, `members`, `marketplace`, `production-guards` | 55 | Gerçek PostgreSQL (RLS, tetikleyiciler, kısıtlar) ve gerçek HTTP API: giriş ve ek doğrulama, davet, rol sınırı, pasifleştirme, oturum iptali, işletmeler arası izolasyon, kanıt bütünlüğü, CAPA, denetim dosyası, pazar yeri onay süresi ve paylaşım, demo/pilot korumaları | **Kurallar ve kategoriler örnek veridir.** Testler motorun davranışını doğrular, mevzuatın doğruluğunu değil. |
| Gerçek entegrasyon (mobil kod + sunucu) | `server/test/acceptance/offline-sync.test.ts` | 8 | Mobil uygulamanın kendi kuyruk motoru ve HTTP istemcisi, rastgele portta gerçek HTTP üzerinden gerçek API'ye karşı çalışır: kapat-aç, gönderim ortasında kapanma, tekrar gönderim, yarım/kesik fotoğraf, kaybolan yanıt, oturum bitişi, başka kullanıcı, iki cihaz çakışması | React ekranları ve cihaz depolaması (bellek içi disk kullanılır) |
| Uçtan uca arayüz gösterimi | `e2e/*` | 2 akış × 3 profil | Gerçek web arayüzü + API + PostgreSQL; masaüstü 390 px, Pixel 7 ve iPhone 14 öykünmesi; yatay taşma kontrolü; `secure-context.js` https/http farkı | Otomatik doğrulama paketi değil; **gerçek telefon değil** (bkz. `TELEFON_TESTI.md`) |
| Mobil birim testi | — | 0 | — | Ekran bileşenleri için ayrı birim testi yok |

Son çalıştırma: 94/94 sunucu testi geçti (31 birim + 63 entegrasyon). Sunucu ve mobil tür kontrolü temiz. Mutasyon kontrolü yapıldı: pazar yeri süre korumaları ve çevrimdışı motorun dört koruması geçici olarak kaldırıldığında ilgili testler kırıldı, geri alınınca geçti.

## 4. Zorunlu senaryoların güncel durumu

| # | Senaryo | Durum |
|---|---|---|
| 8 | Çevrimdışı kayıt kaybolmadan eşitleniyor | ✅ 8 otomatik entegrasyon testi (mobil motor + gerçek API) + arayüz gösterimi. Gerçek telefonda denenmedi. |
| 9 | Çakışma ve yarım dosya yükleme doğru gösteriliyor | ✅ Sunucu testleri; arayüzde "sunucu kabul etmedi / çakışma" durumları eşitleme ekranında. Yarım yükleme arayüzde "yükleme tamamlanmadı" ya da "reddedildi" olarak görünür. |
| 12 | Kaynağı olmayan asistan cevabı kesin hüküm üretmiyor | ❌ Asistan bu aşamada yok. Tasarımdaki asistan düğmesi yanıltıcı olmasın diye kaldırıldı. |

Diğer senaryolar için `KABUL.md` geçerli.

## 5. Kaldırılan veya değişen tasarım ögeleri (gerekçeli)

- **Sahte veri gösteren ekranlar kaldırıldı:** belge kasası, OCR tarama, eğitim, yol haritası, içerik akışı, sahte teklif ve ziyaret ekranları. Gerçek kayıt gibi görünüp kullanıcıyı yanıltırlardı. Tasarım kaynağında ve git geçmişinde duruyorlar.
- **Ana sayfadaki "ceza riski ₺29k" kartı → "açık uygunsuzluk" kartı.** Ceza tutarları modellenmedi ve uydurulmamalı.
- **Uyum halkaları beş örnek süreç yerine gerçek bileşenleri gösteriyor:** zamanında, uygun sonuç, kanıt kapsamı.
- **Asistan düğmesi kaldırıldı:** kaynaklı asistan henüz yok.
- **Ortadaki "Tara" düğmesi → "Sıradaki kontrol":** OCR yok; en yakın açık görevi açar.

## 6. Açık bağımlılıklar

| Bağımlılık | Etkisi | Kimden |
|---|---|---|
| **E-posta sağlayıcısı (Türkiye barındırmalı)** | **Gerçek pilot kullanıcısı giriş kodunu alamaz.** Şu an yalnızca geliştirme giden kutusu var; pilotta bu uç kapalı. | Sağlayıcı seçimi → ardından gönderim adaptörü yazılır |
| Gerçek mevzuat içeriği | Pilot ortamı örnek kural yayınlamaz; gerçek kural olmadan pilotta yükümlülük ve görev oluşmaz | Sen + alan uzmanları (kaynak hükmü, yorum, limitler) |
| Barındırma, nesne depolama, yedek/geri yükleme tatbikatı | Gerçek veri taşınamaz | Barındırma kararı |
| Telefon tarayıcısında gerçek test | Öykünme geçti; fotoğraf için https şart | Telefonun erişebileceği https adresi (tünel veya pilot sunucusu) — `TELEFON_TESTI.md` |
| iOS/Android derlemesi (EAS) ve mağaza | Uygulama yalnızca web derlemesiyle denendi | Apple/Google hesapları — `MOBIL_DAGITIM.md` |
| Saklama süreleri | Matris boş; hiçbir şey silinmiyor | Hukuk görüşü |
| Web'de çevrimdışı yeniden yükleme | Web sürümü çevrimdışıyken yenilenemez (service worker yok); telefon uygulamasını etkilemez | Web pilotu istenirse eklenir |
| Expo derleme araçlarındaki npm uyarıları | Uygulamanın çalışma kodunda değil, derleme araçlarında (zod, glob, minimatch); önerilen "düzeltme" Expo'yu eski sürüme düşürmek | Expo güncellemesi beklenir |
| Hız sınırı bellek içi | Birden fazla sunucuda paylaşılmaz | Ölçeklenince ortak sayaç |
| OCR, kaynaklı asistan, ödeme, mevzuat izleme | Henüz yok | Sonraki aşamalar |
