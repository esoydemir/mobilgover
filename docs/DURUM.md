# GoverHub — durum tespiti

Son güncelleme: 31.10.2026. Bu belge, depoda **gerçekten bulunan ve çalıştırılarak doğrulanan** durumu anlatır.

## 1. Kaynaklar

| Kaynak | İçerik | Not |
|---|---|---|
| `project/GoverHub Mobile.dc.html` | Claude Design prototipi (tek dosya, React tabanlı çalışma zamanı) | Birincil tasarım kaynağı |
| `chats/chat1.md` | Tasarım sohbeti | Kullanıcının istekleri ve vardığı kararlar burada |
| Teknik şartname | **Yok** | Sohbette "200 maddelik yapı protokolü"nden söz ediliyor ama dosya pakette değil. Varsayılmadı. |

## 2. Bileşenler ve doğrulanmış durumu

| Bileşen | Teknoloji | Durum | Nasıl doğrulandı |
|---|---|---|---|
| `mobile/` | Expo 58, React Native, Expo Router, TypeScript | Tüm prototip ekranları (22) ve 4 rol, **örnek veriyle** | `tsc` temiz; web derlemesi tarayıcıda gezildi, akışlar Playwright ile tıklandı |
| `server/` | Node 22, Fastify 5, PostgreSQL 16, Zod, Vitest | İlk uçtan uca dilim çalışıyor | 57 otomatik test (gerçek PostgreSQL); sunucu migration + demo verisiyle ayağa kaldırılıp HTTP ile denendi |
| Mobil ↔ sunucu bağlantısı | — | **Yok** | Mobil uygulama henüz API'yi çağırmıyor; başlıkta "DEMO · ÖRNEK VERİ" etiketi var |

## 3. Çalışan, taklit edilen, eksik

### Çalışan (sunucu, testlerle gösterilmiş)
- İşletme profili: bilgi kaynağı, doğrulama durumu, geçerlilik aralığı ve tam geçmiş (yalnızca ekleme).
- Kural motoru: sınırlı JSON ifade modeli, üç değerli mantık (doğru/yanlış/bilinmiyor), açıklanabilir karar izi.
- Kural yaşam döngüsü: taslak → incelemede → onaylı → yayında → yürürlükten kalkmış. Yazan kişi onaylayamaz. Yayından sonra içerik veritabanında kilitli.
- Yayın öncesi etki simülasyonu (`GET /admin/rule-versions/:id/impact`).
- Yükümlülük kararları: uygulanır / uygulanmaz / bilgi eksik / uzman incelemesi; elle "uygulanmaz" kararı gerekçe ister.
- Görev üretimi: saat dilimi, açık günler, kapalı günler; tekrar çalıştırmada ve yeni kural sürümünde mükerrer görev yok.
- Kanıt: göreve göre değişen gereksinimler (ölçüm, fotoğraf, belge, kontrol listesi, not, onay, cihaz kaydı), iki aşamalı dosya yükleme ve özet (sha256) doğrulaması.
- Ölçüm: ekipman türüne bağlı limit (genel limit yok), cihaz zamanı ile sunucu zamanı ayrı, kalibrasyon durumu.
- "Yapıldı" ile "uygun" ayrı: limit dışı sonuç kaydedilir, görev "yapıldı, uygunsuz" kapanır, uygunsuzluk açılır.
- Uygunsuzluk/CAPA: riske ve yapısal tekrara göre derinlik, adım sırası, yüksek riskte bağımsız kapanış doğrulaması.
- Denetim izi: şirket başına karma zinciri; veritabanı güncelleme/silmeyi engelliyor.
- Göstergeler (formül `indicators-v1`): bileşenleriyle birlikte; kritik açık risk puanı sınırlar; eksik veri "uyumlu" sayılmaz.
- Denetim dosyası (JSON): kapsam, dönem, kural sürümleri, eksikler, açık uygunsuzluklar, dosya ve zincir bütünlüğü, örnek içerik uyarısı.
- Yetki: rol + şirket + şube + atama kapsamı; sunucuda her işlemde ve ayrıca PostgreSQL satır düzeyi güvenliğiyle (RLS).
- Çevrimdışı istemci desteği (sunucu tarafı): `Idempotency-Key` ile tekrar gönderimde aynı cevap, farklı istekte aynı anahtar reddi, çakışmada 409.
- Demo ayrımı: demo sıfırlama yalnızca `is_demo` işletmeleri siler; gerçek veri testle korunuyor.

### Yalnızca görsel olarak taklit edilen (mobil)
OCR tarama, asistan, pazar yeri, teklifler, servis ziyareti ve QR, bildirimler, çevrimdışı eşitleme, eğitim, resmî süreç yol haritası, uzman içerik akışı. Mobildeki tüm sayılar ve "kaydedildi" mesajları örnektir.

### Eksik altyapı
- Mobil uygulamanın API'ye bağlanması ve cihazda çevrimdışı kuyruk.
- Gerçek kimlik doğrulama (giriş akışı). Şu an yalnızca sunucuda karması saklanan oturum jetonları var.
- OCR servisi, kaynaklı yapay zekâ asistanı, mevzuat kaynak izleme, bildirim gönderimi.
- Pazar yeri, teklif ve ödeme entegrasyonu.
- PDF denetim çıktısı (şu an JSON), nesne depolama, yedekleme/geri yükleme otomasyonu, izleme.
- **Doğrulanmış gerçek mevzuat içeriği.** Depodaki tüm kurallar, kaynaklar ve limitler (ör. 0–4 °C) **ÖRNEK** olarak işaretli. Gerçek ortamda örnek kural yayınlanamaz (sunucu reddeder).

## 4. Tasarım kararları ve benim varsayımlarım

**Tasarımdan gelen kararlar (korundu):** koyu/limon görsel dil; yüzen kapsül alt bar; günlük sayaç; tek kritik kart; "Neden?" açıklaması; kanıtsız görev kapanmaz; limit aşımı uygunsuzluk açar; uygunsuzluktan uzmana köprü; doğrulanmış ve doğrulanmamış içeriğin ayrı gösterilmesi; 4 rol.

**Gerekçesiyle değiştirdiklerim:**
- Prototipte 12 °C girilince görev "tamamlandı" sayılıp uygunsuzluk sayfası açılıyordu. Sunucuda bu durum açıkça **"yapıldı, uygunsuz"** olarak kaydediliyor ve uygunsuzluk ayrıca izleniyor. Kullanıcı uygun değer girmeye zorlanmıyor.
- Prototipteki skor "ekipman 30, belgeler 25…" gibi sabit ağırlıklar kullanıyordu. Bu, mevzuat gerçeği gibi sunulamaz. Yerine sürümlü bir formül geldi: zamanında, uygun, kanıt kapsamı. Kritik açık risk varsa puan en fazla 49 olur ve durum "kritik risk" görünür.
- Prototipte "Bu ünite ayda 4. kez" metindi. Sunucuda tekrar, aynı ekipman + aynı tehlike türü + son 30 gün ile **yapısal** olarak sayılıyor.
- Prototipte karma zinciri "denetimde geçerli" gibi anlatılıyordu. Ne kanıtlayıp ne kanıtlamadığı `MIMARI.md`'de açıkça yazılı.

**Benim varsayımlarım (geri alınabilir):**
- İlk sektör: tek şubeli kafe/restoran.
- Saat dilimi varsayılanı `Europe/Istanbul`.
- Örnek risk politikası: kritik önem → yüksek risk; tekrar riski artırır; yüksek/kritik risk → tam CAPA ve bağımsız doğrulama.
- Örnek yanıt süreleri: 4 / 24 / 72 / 168 saat.
- Gösterge ağırlıkları 0,4 / 0,4 / 0,2.
- Platform personeli işletme verisine yalnızca süreli ve kayıtlı erişim izniyle (`access_grants`) ulaşır.

## 5. Cevap gerektiren sorular

1. **Mevzuat sahipliği:** Gerçek kuralları kim yazacak ve onaylayacak (iç ekip mi, anlaşmalı uzman mı)? İlk doğrulanacak yükümlülük listesi var mı?
2. **İlk pilot sektör ve yükümlülükler:** Kafe/restoran ile mi başlıyoruz? Soğuk zincir, LPG, hijyen eğitimi, portör muayenesi dışında öncelikli başlık var mı?
3. **Kimlik doğrulama:** Telefon + SMS doğrulama mı, e-posta mı, kurumsal giriş (SSO) mı?
4. **Barındırma ve veri yerleşimi:** Verinin Türkiye'de tutulması şartı var mı? Bulut sağlayıcı tercihi?
5. **Saklama süreleri:** Kanıt ve denetim kayıtlarının saklama süresine hukuk danışmanı karar vermeli (bkz. `MIMARI.md` §9).
