# Kapsam durumu — modül bazında (inceleme: 01.11.2026 · 1. ve 2. teslim işlendi)

**Kaynaklar:**
- Tasarım prototipi ve sohbeti: `project/`, `chats/chat1.md`
- Belgeler: `KABUL.md`, `DURUM.md`, `PILOT.md`, `MIMARI.md`
- Kod: API rotaları (`server/src/http/app.ts`), mobil ekranlar (`mobile/src/app`)

Belgelerde tanımlanmayan ayrıntılar gereksinim sayılmadı. Tasarım prototipinde ekranı olup kuralı yazılmamış özellikler "kapsam belirsiz" olarak işaretlendi.

**Durum işaretleri:**

| İşaret | Anlamı |
|---|---|
| ✅ Uçtan uca | Sunucuda kaydediliyor; yenilemede korunuyor (veritabanı); rol sınırı sunucuda ve RLS'de uygulanıyor; otomatik test ve arayüz akışıyla doğrulandı |
| ◐ Kısmen | Çalışan bir parçası var; listelenen kısmı eksik |
| ◇ Arayüz / örnek | Yalnızca görünüm ya da örnek veri |
| ✗ Yok | Hiç yapılmamış |
| ⏳ Haricî / karar | Dış hizmet ya da senin kararını bekliyor |

**Doğrulama dayanağı:**
- **Sunucu testleri:** gerçek PostgreSQL ile; CI'da 152 test.
- **Uçtan uca arayüz akışı:** `e2e/pilot-walkthrough.js`, 26 adım, yerel Docker demosunda.
- **Rol sınırları:** `server/test/acceptance/{slice,members,marketplace}.test.ts`.

## 1. İşletme ve şube profili, ekipmanlar

| Özellik | Durum | Not |
|---|---|---|
| İşletme + ilk şube oluşturma | ✅ | Kurulum adım 1 |
| Profil soruları (bilgi kaynağı, "bilmiyorum" = bilgi eksik, geçmiş) | ✅ | Kurulum adım 2, Daha → İşletme profili |
| Ekipman ekleme (soğutucu, dondurucu, termometre + kalibrasyon tarihi) | ✅ | |
| Ekipman düzenleme, kalibrasyon yenileme, kullanımdan kaldırma | ✅ (1.–2. teslim) | Kaldırmadan önce önizleme: saati gelmemiş kontroller iptal, saati geçmiş olanlar gecikmiş olarak kalır, bugünkü kontrolün durumu yazılır. Yeniden etkinleştirmede iptal edilenler geri açılır; aynı gün için ikinci görev oluşmaz |
| İkinci şube açma, şube seçme (çok şubeli / genel merkez) | ✗ | API yalnızca ilk şubeyi açıyor; uygulama her zaman ilk şubeyi kullanıyor |
| Açılış günleri, kapalı günler | ◐ | Veri modeli ve görev takvimi destekliyor; düzenleme ekranı ve API yok |
| OCR ile belgeden bilgi okuma | ⏳ | OCR hizmeti yok; prototipte vardı, kaldırıldı |

## 2. Çalışanlar, davetler, roller, oturumlar

| Özellik | Durum | Not |
|---|---|---|
| Davet (rol + şube), daveti kabul | ✅ | Daha → Ekip |
| Pasifleştirme ve geri alma, gerekçe zorunlu | ✅ | |
| Rol sınırları (sahip, genel merkez yöneticisi, şube yöneticisi, personel) | ✅ | Sunucu + RLS |
| Rol değiştirme | ✗ | Yalnızca pasifleştirip yeniden davet |
| Personele görev atama, kontrol sorumlusu | ✅ (1. teslim) | Görev ekranı → Sorumlu → Ata / Değiştir; "sonraki görevleri de" seçilirse yeni görevler otomatik atanır. Pasifleştirilen kişiye yeni görev atanmaz |
| Oturumlar: liste, tekini kapat, diğerlerini kapat, çıkış | ✅ | Daha → Hesap ve güvenlik |
| Ek doğrulama (TOTP), platform rollerinde zorunlu | ✅ | Yerel demoda zorunluluk kapalı |
| Gerçek e-postayla giriş | ⏳ | SMTP sağlayıcısı (`PILOT.md` §6) |

## 3. Yükümlülükler, kural onayı, değişiklik yönetimi

| Özellik | Durum | Not |
|---|---|---|
| Yükümlülük listesi + "Neden bana uygulanıyor?" | ✅ | Daha → Yükümlülükler |
| Bilgi eksik → soru; uzman incelemesi gerekir durumu | ✅ | |
| Elle "uygulanmaz" kararı (gerekçeli, rol sınırlı) ve geri alma | ✅ (1.–2. teslim) | İyi uygulama önerisinde hemen uygulanır. **Zorunlu yükümlülükte incelemeye gider**: başka bir sahip/merkez yöneticisi ya da inceleme yetkili uzman onaylar veya reddeder; o zamana kadar kontroller sürer. Saati geçmiş kontroller "kaçırıldı" olarak kalır, silinmez |
| Kural sürümü onayı, alan uzmanı onayı, yayın | ✅ | Daha → Yönetim (platform rolleri) |
| Yeni kural / yeni sürüm yazma ekranı | ✗ | Yalnızca API ile. Ekrandan yazılamıyor |
| Yayın öncesi etki simülasyonu | ◐ | API var; ekranda gösterilmiyor |
| Kural değişince işletmeye bildirim | ✗ | Yükümlülük yeniden hesaplanıyor ama kullanıcıya bir şey söylenmiyor |
| Gerçek mevzuat içeriği | ⏳ | Tüm kurallar örnek. P-01…P-05 doğrulanmamış taslak |

## 4. Günlük görevler, formlar, ölçümler, kanıtlar

| Özellik | Durum | Not |
|---|---|---|
| Görev üretimi (takvim, saat dilimi, mükerrersiz) | ✅ (1. teslim) | Sunucu açılışta ve saatte bir, bütün şubeler için önümüzdeki 14 günü tamamlar (`TASK_HORIZON_DAYS`); var olan göreve dokunmaz |
| Görev listesi (bugün, gecikmiş, yaklaşan, tamamlanan), sıradaki kontrol | ✅ | |
| Ölçüm: ekipmana bağlı limit, limit dışı uyarı, kalibrasyon durumu | ✅ | |
| Fotoğraf kanıtı (cihazda özet, sunucuda doğrulama) | ✅ | HTTPS ya da localhost şart |
| Kontrol listesi, not, onay | ✅ | |
| "Yapıldı" ≠ "uygun"; uygunsuz sonuç kaydı | ✅ | |
| Dinamik form motoru (koşullu soru, puanlama, form sürümü) | ✗ | Prototipte vardı; yalnızca sabit kontrol listesi var |
| Görev atama | ✅ (1. teslim) | Bkz. §2 |
| Kaçırılan görevin "kaçırıldı" olarak işaretlenmesi | ◐ | Son tarihe göre "gecikmiş" hesaplanıyor; durum hiçbir zaman `missed` olmuyor |

## 5. Uygunsuzluk, kök neden, düzeltici faaliyet, etkinlik doğrulaması

| Özellik | Durum | Not |
|---|---|---|
| Limit dışı sonuçtan otomatik uygunsuzluk; risk ve tekrar hesabı | ✅ | |
| Elle uygunsuzluk açma (her rol, kendi şubesinde); konu, önem, ekipman, ilk müdahale | ✅ (2. teslim) | Uygunsuzluklar → "Sorun bildir" |
| Sorumlu ve termin; sonradan termin değişikliğinde gerekçe; değişiklik geçmişi; gecikme işareti | ✅ (2. teslim) | |
| Neden değerlendirmesi: bilgi / ekipman / kaynak / süreç, çoklu seçim; ilk değerlendirme ile doğrulanmış kök neden ayrı | ✅ (2. teslim) | Doğrulanmış kök nedeni yalnız yönetici kaydeder |
| Nedene göre destek önerisi (açıklama, hizmet talebi formu, ekipman, ekip, takip aksiyonu) | ✅ (2. teslim) | Öneri yalnızca yol gösterir; talep, sipariş ya da kapanış kendiliğinden olmaz. Eğitim modülü yok ("henüz yok" olarak gösterilir) |
| Tekrarlanabilir aksiyonlar (düzeltme, düzeltici faaliyet, takip) sorumlu ve terminle | ✅ (2. teslim) | |
| Etkinlik kontrolü → doğrulama; etkili değilse kayıt açık kalır ve yeni tur başlar; gerekçeli yeniden açma | ✅ (2. teslim) | |
| Yüksek riskte bağımsız doğrulama (bu turun düzeltmesini yapan doğrulayamaz) | ✅ | |
| Hizmet teslim kabulü uygunsuzluğu kapatmaz | ✅ | Testle sabitlendi |
| Pasifleştirilen sorumlunun açık işleri → yöneticinin yeniden atama listesi | ✅ (2. teslim) | Uygunsuzluk, aksiyon ve görevler |
| "Yapıldığı beyan edilen işlem → kanıt" neden türü | ✗ | Bu teslimin kapsamında istenmedi |

## 6. Belgeler, geçerlilik süreleri, hatırlatmalar

| Özellik | Durum | Not |
|---|---|---|
| Belge kasası, geçerlilik tarihleri | ✗ | Prototipte vardı, sahte veri gösterdiği için kaldırıldı |
| Göreve belge kanıtı | ◐ | Kanıt türü olarak var; ayrı bir belge kaydı yok |
| Süre dolumu hatırlatması | ✗ | Bildirim altyapısı yok (§11) |

## 7. Eğitim, içerik, değerlendirme

| Özellik | Durum | Not |
|---|---|---|
| Eğitim içerikleri, katılım, değerlendirme | ✗ | Prototipte vardı, kaldırıldı |
| "GoverHub katılım belgesi" ile "yetkili kurum sertifikası" ayrımı | ⏳ | Tasarım kararı var; içerik ve sağlayıcı yok |
| Onaylı içerik / uzman yorumu akışı | ✗ | Kapsam belirsiz |

## 8. Uzman profilleri ve kategori bazlı hizmet onayı

| Özellik | Durum | Not |
|---|---|---|
| Profil oluşturma ve düzenleme (ad, başlık, şehir, açıklama) | ✅ | Daha → Uzman alanı |
| Kimlik ve mesleki belge doğrulama başvurusu, inceleme kararı | ✅ | İnceleme: Yönetim → pazar yeri |
| Kategori bazlı hizmet yetkisi (süreli; belge süresi geçince düşer) | ✅ | |
| Profil ekranında doğrulama durumlarının ayrı gösterimi | ✅ | |
| Deneyim ve uzmanlık geçmişi (yapılandırılmış) | ✗ | Yalnızca serbest başlık ve açıklama |
| Belge dosyası yükleme | ✗ | Yalnızca belge numarası ve kurum |

## 9. Mesleki ağ

| Özellik | Durum | Not |
|---|---|---|
| Herkese açık uzman profili görüntüleme | ✅ | |
| Uzman arama (ad, şehir, kategori) | ◐ | Yalnızca hizmet talebi açarken, kategoriye göre onaylı uzman sayısı |
| Bağlantı / takip | ✗ | |
| Paylaşım / gönderi | ✗ | |
| Doğrulanmış hizmet geçmişi (teslim kabul edilmiş işler) | ✗ | Veri var (`service_jobs`), profilde gösterilmiyor |
| Gizlilik: işletmenin uygunsuzluk ve belgeleri ağa açılmaz | ✅ | Sunucu paylaşımı yalnızca talep kapsamında ve süreli |

Bağlantı, takip ve paylaşım için kapsam kararı gerekiyor (§ sonu).

## 10. Hizmet talebi, teklif, yürütme, değerlendirme

| Özellik | Durum | Not |
|---|---|---|
| Talep açma (kategori, uygunsuzluğa bağlı) | ✅ | |
| Yalnızca onaylı uzmanın teklif vermesi, süre dolumu | ✅ | |
| Teklif karşılaştırma, kabul | ✅ | |
| İş giriş kodu, uzman raporu, teslim kabulü veya itiraz | ✅ | |
| İşe giriş kodu yerine QR | ◐ | 8 haneli kod var; QR yok |
| Hizmet değerlendirmesi (puan, yorum) | ✗ | |
| Ödeme | ⏳ | Kapsam dışı (`payment_status = not_in_scope`) |

## 11. Bildirimler, arama, filtreler, raporlar

| Özellik | Durum | Not |
|---|---|---|
| Uygulama içi bildirim merkezi | ◐ (2. teslim) | Uygunsuzluk akışı için var: atama, aksiyon ataması, yaklaşan termin, gecikme, doğrulama isteği, başarısız doğrulama, yeniden açma, yeniden atama, "uygulanmaz" incelemesi. Yinelenmez; rol ve şube sınırlı. Görev gecikmesi, teklif ve teslim bildirimleri henüz yok |
| Anlık bildirim (push) ve e-posta bildirimi | ⏳ | Mağaza derlemesi ve SMTP |
| Görev filtreleri | ✅ | |
| Uygunsuzluk filtreleri | ✅ | Açık / kapalı |
| Genel arama | ✗ | |
| Uyum göstergesi (sürümlü formül, kritik risk sınırı) | ✅ | |
| Denetim dosyası (JSON) | ✅ | |
| Denetim dosyası (PDF) | ✗ | |

## 12. Çevrimdışı kullanım ve eşitleme

| Özellik | Durum | Not |
|---|---|---|
| Ölçüm, kanıt ve tamamlama kuyruğu; sırayla gönderim; çakışma ve ret gösterimi | ✅ | 8 entegrasyon testi |
| Çevrimdışıyken web sayfasını yenileme | ✗ | Service worker yok |
| Gerçek telefonda deneme | ⏳ | Tünel hazır; senin testin |

## 13. Platform yönetimi ve inceleme

| Özellik | Durum | Not |
|---|---|---|
| Kural onayı ve yayın ekranı | ✅ | |
| Pazar yeri doğrulama ve yetki inceleme ekranı | ✅ | |
| Kural yazma ekranı | ✗ | Bkz. §3 |
| Saklama süreleri öner ve onayla | ◐ | API var; ekran yok |
| Süreli erişim izinleri (destek / uzman) | ◐ | Veri modeli ve yetki var; verme ekranı yok |
| Kaynaklı asistan | ✗ | Kaynaksız cevap üretmemesi şartıyla tasarlandı (`MIMARI.md` §11) |

## Öncelik sırası

**P1 — Temel akışı bozan: tamamlandı (1. teslim)**
1. Görev ufku: sunucu bütün şubeler için 14 günü sürekli tamamlıyor.
2. Görev atama ve kontrol sorumlusu: personel kendi görevlerini görüyor.
3. "Uygulanmaz" kararı ekranı ve kararı geri alma.
4. Ekipman düzenleme: kalibrasyon yenileme, kullanımdan kaldırma, yeniden kullanıma alma.

**P2 — Günlük kullanımı tamamlayan:**
5. ✅ Uygunsuzluk uçtan uca akışı ve nedene göre destek önerisi (2. teslim).
6. ✅ Uygunsuzluk sorumlusu, termini, elle uygunsuzluk açma (2. teslim).
7. ◐ Bildirim merkezi: uygunsuzluk akışı tamam (2. teslim); görev gecikmesi, teklif, teslim ve kural değişikliği bildirimleri kaldı.
8. Belge kasası: belge kaydı, geçerlilik tarihi, süre dolumu uyarısı.
9. Hizmet değerlendirmesi ve uzman profilinde doğrulanmış hizmet geçmişi.

**P3 — Genişleme:**
10. Uzman arama.
11. Yapılandırılmış deneyim.
12. Bağlantı/takip ve paylaşım (kapsam kararı gerekiyor).
13. Çok şubeli işletme.
14. Kural yazma ekranı.
15. Saklama ekranı.
16. PDF denetim dosyası.
17. Eğitim modülü (içerik kaynağı kararı gerekiyor).
18. Dinamik form motoru.

## Senin kararını bekleyenler (şimdilik engellemiyor)

- **Mesleki ağın kapsamı:**
  - Gönderiler kimin tarafından okunabilir: herkes mi, yalnızca giriş yapanlar mı?
  - İşletme hesapları uzmanları takip edebilir mi?
  - İçerik denetimini kim yapar?
- **Eğitim içeriği:** Kim üretecek ve onaylayacak? Katılım belgesi verilecek mi?
- **Ödeme ve gerçek bildirim kanalları:** SMS, push, e-posta.
