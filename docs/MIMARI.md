# GoverHub — mimari ve veri modeli

## 1. Yaklaşım

Küçük bir ekibin işletebileceği en sade yapı: **tek bir API servisi + tek PostgreSQL + nesne depolama + bir arka plan iş kuyruğu**. Mikroservis yok.

```
mobile/ (Expo, TypeScript)  ──HTTPS/JSON──▶  server/ (Fastify, TypeScript)  ──▶  PostgreSQL 16 (RLS)
   cihazda çevrimdışı kuyruk                     ├─ src/domain   saf iş kuralları (DB/HTTP bilmez)
                                                 ├─ src/services veritabanı işlemleri, yetki, denetim izi
                                                 ├─ src/http     doğrulama, kimlik, hata biçimi
                                                 └─ src/storage  kanıt dosyaları (şimdi disk; sonra nesne depolama)
```

- **Dil:** Uçtan uca TypeScript. `src/domain` bilerek bağımsız tutuldu; ileride mobil uygulama çevrimdışı ön kontrol için aynı kodu kullanabilir.
- **Veritabanı:** PostgreSQL. İlişkiler, kısıtlar, tetikleyiciler ve satır düzeyi güvenlik burada önemli. Testler gerçek PostgreSQL'e karşı çalışır.
- **İki veritabanı rolü:** Tablo sahibi rol yalnızca migration için kullanılır. Uygulama rolü tablolara sahip değildir; bu yüzden RLS ona her zaman uygulanır.

## 2. Varlıklar ve ilişkiler

```
companies 1─n sites 1─n equipment
companies 1─n memberships n─1 users            (rol + isteğe bağlı şube kapsamı)
companies 1─n access_grants n─1 users          (uzman / servis / platform desteği; süreli, kapsamlı)
companies 1─n profile_facts                    (yalnızca ekleme; kaynak, doğrulama, geçerlilik)

legal_sources 1─n source_versions 1─n provisions 1─n interpretations
rules 1─n rule_versions 1─n task_templates     (rule_versions.provision_ids → provisions)

obligations  (şirket, şube, kural, kural sürümü, karar, iz, olgu anlık görüntüsü)   — yalnızca ekleme
tasks        (yükümlülük, şablon, kural+şablon kodu, ekipman, dönem anahtarı)
measurements (görev, değer, birim, ölçüm zamanı ≠ kayıt zamanı, cihaz, kalibrasyon, limit kaynağı)
evidence     (görev veya uygunsuzluk, tür, durum, beyan edilen/gerçek sha256, depolama anahtarı)
nonconformities 1─n ncr_steps
audit_events (şirket başına sıra no + önceki karma + karma)                      — yalnızca ekleme
client_operations (işlem anahtarı → ilk cevap)
```

Kavramlar ayrı tutulur: **kaynak metin sürümü ≠ hüküm ≠ insan yorumu ≠ uygulanabilirlik kuralı ≠ işletme yükümlülüğü ≠ görev şablonu ≠ tarihli görev ≠ sonuç/kanıt ≠ uygunsuzluk/CAPA**. `rule_versions.kind` mevzuat yükümlülüğünü (`legal_requirement`) iyi uygulamadan (`good_practice`) ayırır; arayüz ikisini farklı etiketler.

### Önemli kısıtlar (veritabanında)
- `rule_versions`: yazan ≠ inceleyen; mevzuat yükümlülüğü en az bir hükme bağlı (örnek değilse); kural başına tek yayında sürüm; taslak dışında içerik kilitli; geçersiz durum geçişi reddedilir.
- `task_templates`: taslak dışında kilitli. İncelemede yalnızca acil talimat onayı değişebilir.
- `obligations`: elle karar gerekçesiz olamaz.
- `tasks`: `done` ⇔ sonuç var; aynı kural + şablon kodu + şube + ekipman + dönem için tek görev (iptal edilenler hariç).
- `evidence`: `stored` olduktan sonra değişmez ve silinemez.
- `audit_events`: güncelleme ve silme yasak. Tek istisna, demo işletme için `demo_reset()`.

### İndeksler
`profile_facts(company_id, key, recorded_at desc)`, `obligations(company_id, site_id, rule_id, decided_at desc)`, `tasks(company_id, status, due_at)`, görev tekillik indeksi, `nonconformities(company_id, equipment_id, hazard_type, detected_at)` (tekrar sayımı).

### Migration
`server/migrations/NNN_*.sql`, dosya adı sırasıyla, her biri kendi işlemi içinde uygulanır (`schema_migrations`). Geri alma yerine ileri yönlü düzeltme migration'ı yazılır.

## 3. Durum geçişleri

- **Kural sürümü:** `draft → in_review → approved → published → retired`; `in_review → draft` (geri gönderme). Yayın, önceki yayındakini `retired` yapar ve tüm işletmeleri yeniden değerlendirir.
- **Yükümlülük:** değişmez satırlar. Güncel karar, her (şube, kural) için en son satırdır. Motor, elle verilmiş kararı kural sürümü değişmedikçe ezmez.
- **Görev:** `open → done | missed | cancelled`.
  - `done` için kanıt tam olmalı. `outcome` alanı `conforming` veya `nonconforming` olur.
  - Yükümlülük artık uygulanmıyorsa açık görevler `cancelled` olur; tamamlanmışlar dokunulmadan kalır.
  - Yeni kural sürümünde açık görevlere `review_flag` konur.
- **Uygunsuzluk:** `open → awaiting_verification → closed`.
  - Adımlar: `containment → correction` ve `root_cause → corrective_action` (yalnızca CAPA'da), ardından `effectiveness_check`.
  - Yüksek/kritik riskte kapanışı, düzeltmeyi yapmamış bir yetkili yapar.

## 4. Kural ifade modeli

Kod çalıştırılmaz. Koşul, `all / any / not / {fact, op, value}` düğümlerinden oluşan JSON ağacıdır:
- İşleçler: `eq, neq, in, contains, gte, lte, gt, lt`.
- En fazla 6 seviye ve 60 düğüm.
- Her olgu anahtarı `src/domain/facts.ts` kataloğunda tanımlı ve tipli olmalı.

Değerlendirme Kleene üç değerli mantığıyla yapılır. Eksik, reddedilmiş, süresi dolmuş veya onaylanmamış OCR bilgisi **bilinmiyor** sayılır. Bilinmiyor sonucu `needs_info` olur, hiçbir zaman "uygulanmıyor" olmaz. Yorumu belirsiz bir hüküm (`ambiguity_note`) eşleşirse sessizce karar verilmez, `needs_review` olur.

## 5. API (ilk dilim)

Tüm hatalar `{ "error": { "code", "message", "details" } }` biçimindedir; mesajlar Türkçedir. Başka bir işletmenin kaydı **404** döner, böylece kimliklerin varlığı yoklanamaz.

| Yöntem ve yol | Amaç |
|---|---|
| `GET /me` | Oturum, roller, izinler |
| `GET /companies/:c/sites/:s/profile` | Güncel profil olguları |
| `POST /companies/:c/profile/facts` | Olgu ekle → ilgili şubeleri yeniden değerlendir |
| `POST /companies/:c/equipment` | Ekipman ekle → `equipment.types` olgusu ve yeniden değerlendirme |
| `GET /companies/:c/obligations` | Güncel kararlar |
| `GET /companies/:c/obligations/:id/explanation` | "Neden bana uygulanıyor?" |
| `POST /companies/:c/obligations/:id/not-applicable` | Gerekçeli elle karar |
| `POST /companies/:c/tasks/generate` | Dönem için görev üret (tekrar çalıştırmak güvenli) |
| `GET /companies/:c/tasks`, `GET …/tasks/:id` | Liste / ayrıntı (personel yalnızca atananları görür) |
| `POST …/tasks/:id/measurements` | Ölçüm |
| `POST …/tasks/:id/evidence` | Kanıt kaydı (dosyalar `pending_upload`) |
| `PUT /companies/:c/evidence/:id/content` | Dosya baytları (jpeg/png/pdf, ≤15 MB) |
| `POST …/tasks/:id/complete` | Görevi kapat → sonuç, gerekirse uygunsuzluk |
| `GET/POST /companies/:c/nonconformities/:id[/steps\|/close]` | CAPA |
| `GET /companies/:c/indicators?from&to[&siteId]` | Göstergeler |
| `GET /companies/:c/audit-export?from&to[&siteId]` | Denetim dosyası |
| `GET /companies/:c/audit-chain/verify` | Zincir doğrulama |
| `POST /admin/rule-versions[/:id/submit\|approve\|publish]`, `GET …/:id/impact` | Kural yaşam döngüsü ve etki simülasyonu |
| `POST /admin/demo/reset` | Yalnızca `DEMO_MODE=true` ve platform yöneticisi |

Durum değiştiren istekler `Idempotency-Key` başlığı alır (8–128 karakter).
- Aynı anahtar ve aynı istek gelirse saklanan cevap döner (`idempotent-replay: true`).
- Aynı anahtar farklı bir istekle gelirse `409 IDEMPOTENCY_KEY_REUSED` döner.

### Dosya yükleme akışı
1. Cihaz dosyanın sha256 özetini hesaplar.
2. `POST …/evidence` ile tür, MIME, özet ve boyut bildirilir; kayıt `pending_upload` durumunda açılır.
3. `PUT …/content` ile baytlar gönderilir. Sunucu özeti yeniden hesaplar, boyutu ve dosya imzasını (MIME'a karşı) kontrol eder.
   - Eşleşirse dosya üzerine yazılamayan bir yolla saklanır ve kayıt `stored` olur.
   - Eşleşmezse kayıt `rejected` olur ve sebebi saklanır. Yarım yükleme asla tamamlanmış görünmez.

## 6. Arka plan işleri (sonraki adım)

Şu an bu işler istekle tetikleniyor. Üretimde bir iş kuyruğu tablosu (`jobs`, `SELECT … FOR UPDATE SKIP LOCKED`) ile çalışacaklar:
- Günlük görev üretimi (her şube için ileriye dönük 14 gün).
- Süresi geçen görevleri `missed` yapma.
- Kural yayınından sonra yeniden değerlendirme (şu an yayın işleminin içinde).
- Bildirim gönderimi, eşzamanlı olmayan dosya bütünlük taraması, mevzuat kaynak izleme.

Her iş tekrar çalıştırılabilir olmalı. Başarısız işler deneme sayısı ve hata metniyle görünür kalmalı.

## 7. Kanıt bütünlüğü — tehdit modeli

| Tehdit | Önlem (bu sürümde) | Sınır |
|---|---|---|
| Uygulama hatası veya kötü niyetli kullanıcı geçmiş kaydı değiştirir | Kanıt, ölçüm, olgu, karar ve denetim tabloları yalnızca ekleme; tetikleyiciler ve izinler güncellemeyi engeller; düzeltme yeni kayıttır | — |
| Veritabanı sahibi doğrudan kayıt düzenler | Denetim olayları sahibe karşı da tetikleyiciyle korunur; olaylar karma zinciriyle bağlıdır, değişiklik veya silme `verify` ile görünür | Tetikleyiciyi kapatabilen biri zinciri baştan yeniden üretebilir. Karşı önlem: zincir başının periyodik olarak dış bir yere yazılması (haricî zaman damgası / değiştirilemez depolama) — planlı |
| Depodaki dosya değiştirilir | sha256 kayıtta; denetim dosyası her dosyayı yeniden hash'ler ve "değişmiş" diye raporlar | Değişikliği önlemez, tespit eder. Üretimde nesne kilidi (WORM) gerekir |
| Cihaz saati yanlış | Ölçüm zamanı (cihaz) ile kayıt zamanı (sunucu) ayrı saklanır; 5 dk'dan fazla ileri tarih reddedilir | Geçmiş tarihli sahte ölçüm engellenemez, yalnızca görünür olur |
| Sahte kanıt (başka bir fotoğraf) | Kim, ne zaman, hangi görev için kaydetti izlenir | **Karma, kaydın gerçeği yansıttığını kanıtlamaz.** Hukuki geçerlilik için e-imza ve nitelikli zaman damgası gerekebilir; hukuk görüşü gerekir |

Karma zinciri yalnızca şunu gösterir: kaydedilmiş olaylar sonradan GoverHub veritabanında değiştirilmedi, yeniden sıralanmadı veya silinmedi. Olayın doğru olduğunu, doğru zamanda yaşandığını ya da hukuken geçerli olduğunu tek başına kanıtlamaz.

## 8. Roller ve yetki matrisi

| Eylem | Sahip | Merkez yön. | Şube yön. (şubesi) | Personel | Uzman (izinle) | Servis sağl. | Platform yön. |
|---|---|---|---|---|---|---|---|
| Profil okuma | ✓ | ✓ | ✓ | — | `profile` | — | izinle |
| Profil yazma / doğrulama | ✓ / — | ✓ / — | — | — | — / `profile_verify` | — | — |
| Yükümlülük okuma / elle karar | ✓ / ✓ | ✓ / ✓ | ✓ / — | — | `obligations` / — | — | izinle / — |
| Görev okuma / yürütme | ✓ | ✓ | ✓ | yalnızca atanan | `tasks` / — | — | — |
| Uygunsuzluk adımı / kapanış | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | atanan / — | okuma (`nonconformities`) | — | — |
| Göstergeler | ✓ | ✓ | ✓ (şube) | — | — | — | — |
| Denetim dosyası | ✓ | ✓ | ✓ (şube) | — | `audit` | — | — |
| Kural yaz / incele / yayınla | — | — | — | — | — | — | yazar / inceleyici / yönetici |

Ek kurallar:
- Şubeye bağlı bir üyelik şirket geneline erişim vermez.
- Platform personelinin işletme verisine örtük erişimi yoktur; süreli, gerekçeli ve kayıtlı bir `platform_support` izni gerekir.
- Servis sağlayıcı izinleri pazar yeri diliminde tanımlanacak.
- Kontroller `src/domain/permissions.ts` içindedir, her serviste çağrılır, ayrıca RLS ile tekrarlanır.

## 9. Veri koruma ve işletim

- **Veri en aza indirme:** Personel için ad ve rol yeterli. Kimlik numarası veya sağlık verisi (ör. portör muayene sonucu) yalnızca gerekirse, ayrı ve şifreli alanda tutulur. **Hukuki değerlendirme gerekir (KVKK).**
- **Saklama:** Denetim olayları ve kanıtlar, ilgili mevzuatın öngördüğü süre boyunca silinmez. Süreleri hukuk danışmanı belirlemeli; sistem şimdilik hiçbir şeyi otomatik silmiyor. Silme talebinde kişisel alanlar anonimleştirilir, kanıt bağlamı korunur (tasarlanacak).
- **Gizli anahtarlar:** Yalnızca ortam değişkenlerinde; `.env` dosyası git dışında; örnek dosyada değer yok.
- **Oturum:** Rastgele 256 bit jeton; veritabanında yalnızca sha256'sı; süreli. Gerçek giriş akışı soru olarak açık.
- **Hız sınırı:** Jeton başına dakikada 300 istek (tek sunucu, bellek içi). Birden fazla sunucuda paylaşımlı sayaç gerekir.
- **Dosya güvenliği:** MIME izin listesi, içerik imzası kontrolü, boyut sınırı, yol kaçışı koruması, üzerine yazmayan kayıt. Virüs taraması planlı.
- **Yedekleme:** PostgreSQL için sürekli WAL arşivi + günlük taban yedeği; nesne depolamada sürümleme.
  - **Geri yükleme doğrulaması:** Ayda bir yedek ayrı bir ortama yüklenir, `npm run migrate` boş geçmeli, her şirket için `audit-chain/verify` `ok` dönmeli, örnek kanıt dosyaları yeniden hash'lenmeli.
- **İzleme:** Yapılandırılmış log, 5xx oranı, iş kuyruğu gecikmesi ve hataları, eşitleme çakışma sayısı, reddedilen yükleme sayısı (planlı).
- **Demo ayrımı:** `companies.is_demo`; demo sıfırlama yalnızca veritabanı fonksiyonuyla ve yalnızca demo işletmeleri siler. Örnek kurallar `DEMO_MODE=false` ortamda yayınlanamaz.

## 10. Çevrimdışı çalışma (mobil, sonraki dilim)

- **Çevrimdışı yapılabilenler:** Önceden indirilmiş görevleri görüntüleme; ölçüm, kontrol listesi, not ve fotoğraf kaydetme; görevi "tamamlamaya hazır" işaretleme.
- **Çevrimiçi gerekenler:** Profil değişikliği, elle "uygulanmaz" kararı, uygunsuzluk kapanış doğrulaması, kural işlemleri.
- **Cihazda kuyruk:** Her işlem için cihazda üretilen benzersiz anahtar (`Idempotency-Key`). Sıra korunur; geçici hatalarda artan bekleme ile tekrar denenir; kalıcı hata (4xx) kullanıcıya gösterilir ve kuyrukta bekletilir.
- **Görünürlük:** Kayıt başına "cihazda / gönderiliyor / sunucuda / çakışma" durumu. Dosya, sunucu `stored` diyene kadar "yükleniyor" görünür.
- **Çakışma:** Görev başka cihazda kapatılmışsa `409 TASK_ALREADY_DONE` döner; yerel kayıt silinmez, kullanıcıya iki sonuç birlikte gösterilir. Kural sürümü değişmişse sunucu kaydı kabul eder ve `review_flag` koyar (testle gösterildi).

## 11. Yapay zekâ asistanı (sonraki dilim)

- **Ayrım:** Asistan kural motorunun yerine geçmez. Yükümlülük kararı yalnızca yayımlanmış kural sürümlerinden çıkar.
- **Kaynaklar:** Asistan yalnızca yayımlanmış hüküm, onaylı yorum ve işletmenin kendi kayıtları üzerinden, kullanıcının yetkisiyle süzülmüş veriden cevap verir. Her cevapta kaynak ve sürüm görünür. Kaynak yoksa "bilmiyorum" der ve kesin hüküm vermez.
- **Yetki:** Asistan yalnızca okur. Görev kapatma, kayıt değiştirme ve kural yayınlama araçları ona verilmez.
- **Belge güvenliği:** Yüklenen belge metni veri olarak işaretlenir; içindeki talimatlar uygulanmaz.
- **İzolasyon:** Sorgular tek işletmenin RLS'li işlemi içinde çalışır; başka işletmenin verisi bağlama giremez.
- **Test senaryoları:** Kaynak yok, eski kaynak, çelişen kaynak, talimat enjekte edilmiş belge, işletmeler arası sızıntı.

## 12. İleride değer yaratacak iki özellik için bırakılan alan

- **Etki simülasyonu:** Kural tarafı çalışıyor (`GET /admin/rule-versions/:id/impact`). Profil tarafı için aynı saf `decide()` fonksiyonu, kaydetmeden önce "bu değişiklik şu yükümlülükleri değiştirir" önizlemesi verecek şekilde kullanılabilir.
- **Tekrar analizi:** Uygunsuzluklar yapısal alanlarla (ekipman, tehlike türü, şube, kök neden adımı) tutuluyor. Kök neden için bir sınıflandırma alanı eklendiğinde ekipman/süreç bazlı kalıcı iyileştirme raporu doğrudan bu tablolardan üretilebilir.

## 13. Uygulama sırası

1. **(bitti)** Uçtan uca çekirdek dilim: profil → onaylı kural → açıklama → görev → kanıt → uygunsuzluk → aksiyon → doğrulama → denetim çıktısı.
2. Mobil uygulamayı API'ye bağlama (görevler, kanıt, uygunsuzluk) + gerçek giriş + cihaz kuyruğu.
3. Yetki ve izolasyonu sağlamlaştırma: iş kuyruğu, izin yönetimi ekranları, erişim kayıtlarının raporu.
4. Mevzuat sürümleme: kaynak izleme, değişiklik adayı → inceleme → etki → onay → yayın → bildirim.
5. OCR (onay akışıyla) ve kaynaklı asistan.
6. Pazar yeri, teklif, servis ziyareti, ödeme sağlayıcısı (kart verisi uygulamada tutulmaz).
7. Yeni sektörler ve doğrulanmış yükümlülük setleri.
