# Kapsam durumu — modül bazında (inceleme: 08.11.2026 · 1.–5A teslim işlendi)

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
| Elle "uygulanmaz" kararı (gerekçeli, rol sınırlı) ve geri alma | ✅ (1.–3. teslim) | İyi uygulama önerisinde hemen uygulanır. **Zorunlu yükümlülükte** istek, kuralın hangi koşulunun (işletme bilgisinin) sağlanmadığını, doğru değeri ve dayanağı belirtmek zorunda; önerilen bilgilerle kural hâlâ uyuyorsa istek açılmaz. İnceleyen (başka bir sahip/merkez yöneticisi ya da inceleme yetkili uzman) onaylarsa bilgiler doğrulanmış olarak profile işlenir ve **kararı kural motoru verir**; bilgiler kurala hâlâ uyuyorsa onay reddedilir ve yükümlülük sürer (3. teslim). Saati geçmiş kontroller "kaçırıldı" olarak kalır, silinmez |
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
| Risk ve işlem türüne göre doğrulama | ✅ (4. teslim) | **Yüksek/kritik:** işte payı olan hiç kimse (aksiyon sorumlusu, işi yapan, beyan eden, kanıt veren, kayda hizmet veren uzman) doğrulayamaz. **Orta:** düzeltme, takip ve kapanışta gerekçeli öz doğrulama; düzeltici faaliyet bağımsız. **Düşük:** gerekçeli (≥20 karakter) ve açıkça işaretlenmiş öz doğrulama. Öz doğrulama kayıtta, ekranda ve geçmişte "ÖZ DOĞRULAMA" olarak etiketlenir |
| Rol ayrımı: aksiyon sorumlusu, işi yapan, beyan eden, kanıt yükleyen, doğrulayan | ✅ (4. teslim) | Ayrı alanlar ve ekranda ayrı satır. Önceki raporlardaki "owner" = **aksiyon sorumlusu**; işletme sahibi rolü tek başına kimseyi doğrulamadan men etmez |
| Dış doğrulayıcı (tek yöneticili işletme) | ✅ (4. teslim) | Daha → Dış doğrulayıcılar. Sahip/merkez yöneticisi e-postayla davet eder: yalnız uygunsuzlukları okuma + beyan/kapanış doğrulama (isteğe bağlı belge incelemesi), tek şube ya da tümü, 7/30/90 gün, geri alınabilir. Aksiyon ekleyemez, atayamaz, görev/ekip verisini göremez; kendi katkısını ya da verdiği hizmeti doğrulayamaz. Girişte "Doğrulama bekleyenler" listesi açılır. **5. teslim:** "Yalnız seçili kayıtlar" kapsamı (en fazla 20): yalnız o kayıtları ve onların kanıtlarını görür, belge kasasına erişemez; süre dolumu ve izin kaldırma her istekte sunucuda kontrol edilir |
| Hizmet teslim kabulü uygunsuzluğu kapatmaz | ✅ | Testle sabitlendi |
| Eski (v1) kayıtlar | ✅ (4. teslim) | Doğrulama şartından önce "tamamlandı" denmiş aksiyonlar **açık** kayıtta "ESKİ KAYIT · DOĞRULANMADI" görünür ve doğrulanmadan etkinlik kontrolü/kapanış yapılamaz. Kapanmış kayıtların geçmişi değiştirilmedi. Yerel demoda: 1 açık kayıtta 1 eski aksiyon doğrulama bekliyor; 1 kapalı kayıt (2 eski aksiyon) olduğu gibi duruyor |
| Pasifleştirilen sorumlunun açık işleri → yöneticinin yeniden atama listesi | ✅ (2. teslim) | Uygunsuzluk, aksiyon ve görevler |
| "Yapıldı" beyanı → kanıt → doğrulama (aksiyonun doğrulama durumu) | ✅ (3. teslim) | Aksiyon açılırken istenecek kanıt seçilir (yok / fotoğraf / belge). "Yapıldı" bir beyandır: gerekli kanıt yüklenmeden verilemez; başka bir yönetici (sorumlu, beyan eden ve kanıt veren dışında) doğrulayana kadar akışta sonuç sayılmaz. Reddedilen beyan aksiyonu yeniden açar. Güncellemeden önce yeni akışta "tamamlandı" denmiş aksiyonlar "doğrulama bekliyor"a geçti; ilk akıştan (v1) kalanlar olduğu gibi sayılır |

## 6. Belgeler, geçerlilik süreleri, hatırlatmalar

| Özellik | Durum | Not |
|---|---|---|
| Belge kasası: belge türü, işletme / şube / ekipman bağlantısı, sürümler | ✅ (3. teslim) | Daha → Belge kasası. Türler örnek listedir (ruhsat, kayıt belgesi, kalibrasyon, bakım raporu, eğitim, sağlık raporu, sigorta, sözleşme, diğer) |
| Belge durumları ayrı | ✅ (4. teslim) | İncelenmedi · kurum içi incelendi · düzenleyen kurumdan doğrulandı · reddedildi · süresi doldu (+ "süresi yaklaşıyor" uyarısı). Yükleme ve kurum içi inceleme resmî doğrulama olarak gösterilmez. "Kurumdan doğrulandı" için yöntem (barkod sorgusu, kurum sistemi, yazılı teyit) ve referans kaydedilir; uygulama kurumu kendisi sorgulamaz. **5. teslim:** etiket "KURUMDAN DOĞRULANDI · KİŞİ KAYDI"; listede ve ayrıntıda "Uygulama sorgulamadı · <kişi> kaydetti · yöntem · ref. · tarih" satırı her zaman görünür |
| İşletme geneli belgeyi şubelere açma | ✅ (4. teslim) | Belge başına şube seçimi; şube yöneticisi yalnız okur ve dosyayı açar, değiştiremez/inceleyemez; paylaşım kaldırılabilir, geçmişte kalır |
| Geçerlilik ve süre hatırlatmaları | ✅ (3. teslim) | Bitişe 30 gün kala (örnek süre) ve bitince yöneticilere uygulama içi bildirim; her sürüm için bir kez |
| Telefonda belge seçme, yükleme, açma, indirme | ◐ (4. teslim) | Telefonda sistem dosya seçici (PDF, JPEG, PNG), tür ve boyut sınırı önceden yazılır, hata açık gösterilir, yarım kalan yükleme aynı dosyayla yeniden denenir; açma/kaydetme sistem paylaşım ekranıyla. **Web'de tarayıcı testiyle doğrulandı; gerçek telefonda (Expo Go / derleme) henüz denenmedi** |
| Göreve belge kanıtı | ◐ | Kanıt türü olarak var; belge kasasına bağlanmıyor |

## 7. Eğitim, içerik, değerlendirme

| Özellik | Durum | Not |
|---|---|---|
| Sürümlü eğitim içeriği: taslak → incelemede → yayımlandı → arşivlendi | ✅ (5. teslim) | Daha → Eğitimler → İçerikler. Yayımlanan sürüm değişmez; değişiklik yeni sürümle yapılır, önceki sürüm arşive geçer (silinmez) |
| İçerik yazma ve yayımlama ayrı yetkiler | ✅ (5. teslim) | Şube yöneticisi yazar ve incelemeye gönderir; yayımlamayı sahip/merkez yöneticisi yapar. Başka yayımlayıcı varsa yazan kişi kendi içeriğini yayımlayamaz (tek yöneticide yapabilir) |
| Eğitimi görev, yükümlülük ve uygunsuzlukla ilişkilendirme | ✅ (5. teslim) | Konu (tehlike türü), kontrol (görev şablonu) ve yükümlülük (kural) bağlantısı; uygunsuzluk ve yükümlülük ekranında ilgili eğitimler; atama uygunsuzluğa bağlanabilir. Görev ekranında henüz gösterilmiyor |
| Kişiye eğitim atama; okuma/izleme; kısa değerlendirme | ✅ (5. teslim) | Okundu, tamamlandı, sınavı geçti ve sahada etkinliği doğrulandı ayrı kayıtlar. Cevap anahtarı öğrenene gönderilmez; yanlış sorular gösterilir |
| Sahada etkinlik doğrulaması | ✅ (5. teslim) | Eğitimi alan dışında bir yönetici; isteğe bağlı olarak öğrenenin bağlı kayıtta yaptığı aksiyonu uygulama kanıtı seçer. Eğitim tamamlanması ve etkinlik doğrulaması uygunsuzluğu kapatmaz |
| Örnek içerik etiketi; katılım kaydı ≠ sertifika | ✅ (5. teslim) | 2 ÖRNEK eğitim (soğutucu kapısı, eldiven) açıkça etiketli; ekranlarda "GoverHub katılım kaydıdır; resmî sertifika değildir" |
| Video oynatma, dosya ekli içerik | ◐ | Video yalnız bağlantı olarak gösterilir; içerik metindir |
| Onaylı uzman içeriği / platform içerik ekibi | ✗ | Kapsam kararı bekliyor; örnek içerikler platform kaynaklı, mevzuat ya da onaylı görüş değildir |

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
| Doğrulanmış hizmet geçmişi (teslim kabul edilmiş işler) | ✅ (3. teslim) | Yalnız raporu teslim edilip işletmece kabul edilmiş, değerlendirilmiş ve işletmenin profilde gösterilmesine izin verdiği işler; kategori, şehir, ay ve puanlar görünür, işletme adı görünmez |
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
| Hizmet değerlendirmesi (kalite, zamanlama, iletişim; yorum) | ✅ (3. teslim) | Yalnız teslim kabul edilmiş işe, iş başına bir kez. Profilde gösterim varsayılan olarak kapalı |
| Ödeme | ⏳ | Kapsam dışı (`payment_status = not_in_scope`) |

## 11. Bildirimler, arama, filtreler, raporlar

| Özellik | Durum | Not |
|---|---|---|
| Uygulama içi bildirim merkezi | ✅ (2.–4. teslim) | İşletme: uygunsuzluk akışı, doğrulama istekleri (payı olanlara gitmez; tek yöneticide dış doğrulayıcıya), "uygulanmaz" incelemesi, teklif, rapor teslimi, belge, **geciken kontrol** (sorumluya görev başına bir kez; yöneticilere şube başına günde bir özet). Uzman: **yeni talep, doğrulayıcı daveti, teklif kabulü/seçilmemesi, teslim sonucu** (Uzman alanı → Bildirimler; işletme adı teklif kabulünden önce yazmaz). Hepsi tekrar üretilmez |
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
7. ◐ Bildirim merkezi: uygunsuzluk, teklif, teslim ve belge bildirimleri tamam (2.–3. teslim); görev gecikmesi, uzman tarafı ve kural değişikliği bildirimleri kaldı.
8. ✅ Belge kasası: belge kaydı, sürüm, inceleme, geçerlilik, süre hatırlatması (3. teslim).
9. ✅ Hizmet değerlendirmesi ve uzman profilinde doğrulanmış hizmet geçmişi (3. teslim).

**P3 — Genişleme:**
10. Uzman arama.
11. Yapılandırılmış deneyim.
12. Bağlantı/takip ve paylaşım (kapsam kararı gerekiyor).
13. Çok şubeli işletme.
14. Kural yazma ekranı.
15. Saklama ekranı.
16. PDF denetim dosyası.
17. ✅ Eğitim → uygulama → etkinlik doğrulaması (5. teslim); onaylı içerik kaynağı kararı bekliyor.
18. Dinamik form motoru.

## Senin kararını bekleyenler (şimdilik engellemiyor)

- **Mesleki ağın kapsamı:**
  - Gönderiler kimin tarafından okunabilir: herkes mi, yalnızca giriş yapanlar mı?
  - İşletme hesapları uzmanları takip edebilir mi?
  - İçerik denetimini kim yapar?
- **Eğitim içeriği:** Kim üretecek ve onaylayacak? Katılım belgesi verilecek mi?
- **Ödeme ve gerçek bildirim kanalları:** SMS, push, e-posta.
