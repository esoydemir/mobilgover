# Canlı mevzuat takibi ve kontrollü devreye alma — teslim raporu

Tarih: 18.11.2026 · Dal: `feat/canli-mevzuat-izleme` (taban: `goverhub-mobile` @ `5f655d8`) · Depo: `esoydemir/mobilgover`

## 1. Üç cevap

1. **Canlı tarama çalıştı mı?** **Evet.** Resmî Gazete (resmigazete.gov.tr) ve Mevzuat Bilgi Sistemi (mevzuat.gov.tr) gerçek adreslerinden, izole boş bir veritabanında iki kez okundu (18.11.2026, `docs/kanit-canli/canli-gozlem.json`).
2. **Gerçek değişiklik gözlendi mi?** **Evet, bir yayın:** Resmî Gazete 33426, 10.11.2026, *Türk Gıda Kodeksi Peynir Tebliği (No: 2026/24)*. İnceleme kuyruğuna `bekliyor` olarak düştü, yürürlük tarihi **belirsiz** işaretlendi (metin "yayımı tarihinde" diyor ama 30/4/2027 geçiş tarihleri var). Yayımlanmadı, kural üretilmedi. Mevzuat tarafında taban okuması yapıldı; ikinci okumada değişiklik üretilmedi.
3. **Gerçek işletmeye uygulandı mı?** **Hayır.** Hiçbir gerçek mevzuat kuralı, görev, yükümlülük veya bildirim hiçbir işletmeye uygulanmadı. Uygulama davranışı yalnız **sentetik** kaynakla doğrulandı.

## 2. PR, CI, sürüm, ortam

- PR: PR_LINK_BURAYA · CI: CI_LINK_BURAYA (son commit: COMMIT_BURAYA). Birleştirilmedi; incelemeye hazır.
- Başlangıç doğrulaması: `origin/goverhub-mobile` = `5f655d8` (PR #6 birleştirme commit'i), PR #6 GitHub'da MERGED. İzole 49/49 kabul kanıtı `docs/kanit-mevzuat/kabul-kanit.json`'da (bu iş 51'e çıkardı).
- Çalıştığı ortamlar: canlı gözlem = `gh-pilot-testdb` (izole test PostgreSQL, 55432); tarayıcı kabulü = izole `goverhub-mevzuat` ortamı, port 8098, sentetik kaynak 8199. **8091 ve 8080'e dokunulmadı.** 8091 doğrulaması (salt okunur): `LEGISLATION_SCAN_ENABLED=0`, taban adresleri boş, `legislation_sources`/`legislation_changes` boş; pilot verisi korunuyor. 8091 hâlâ önceki imajı çalıştırıyor (migrasyon 026 yok); açmak için yeniden kurulum gerekir (`docs/MEVZUAT_TAKIBI.md` → Canlı geçiş rehberi).

## 3. Bu işte yapılanlar

| Alan | Sonuç |
|---|---|
| İzleme envanteri | `docs/MEVZUAT_IZLEME_ENVANTERI.md`: 8 kayıt (6 izlenen, 1 rehber, 1 künyesi bulunamayan). Metinler resmî sayfalardan okundu; kaynak doğrulaması ile uzman incelemesi ayrı alanlarda. **Önceki araştırmadaki bir hata düzeltildi** (soğuk zincir Madde 18(5)-(6)'da, Madde 5'te değil). |
| Makine okunur liste | Mevcut `LEGISLATION_MEVZUAT_WATCH` biçimi korundu; yalnız isteğe bağlı `m=` madde filtresi eklendi (5996'nın çoğu madde hayvan/bitki sağlığı; filtre ilgisiz kuyruk gürültüsünü önler). Öntanımlı liste artık 6 doğrulanmış belge. |
| Kaynak sağlığı | Hata türleri ayrıldı: zaman aşımı, erişim engeli (403/429/robot sayfası), sayfa yok, sunucu hatası, bağlantı, boş yanıt, beklenmeyen biçim (PDF/JSON/HTML değil/liste biçimi değişmiş), bozuk/eksik metin (önceki okumanın %60'ından az madde), resmî olmayan bağlantı. Kart: son deneme, son başarılı okuma, okunan belge, taranan madde, kuyruk (açık/toplam), hata türü. Başarısız okuma tabanı ve son sağlıklı sayıları değiştirmez. |
| Güvenlik sınırı | Belge bağlantıları yalnız yapılandırılmış kaynak ana bilgisayarında izlenir; başka ana bilgisayara yönlendirme reddedilir. Belge içindeki bağlantılar hiç izlenmez. |
| Ayrıştırıcı | Görünmez/boşluk farkları (NBSP, sıfır genişlikli, yumuşak tire, CRLF) sahte değişiklik üretmez; rakam/büyük-küçük harf farkı hâlâ değişikliktir. Gerçek Mevzuat sayfası kaydedilip regresyon testi yazıldı. Başlık ayrıştırma düzeltildi. Geçiş/ileri tarihli hükmü olan yayın artık "bilinen yürürlük" sayılmaz (gerçek Peynir Tebliği ile bulundu). |
| Denetim | Onay kaydı artık **onay anındaki etki önizlemesini** taşır (`previewAtApproval`); yürürlük gününün gerçek sonucu ayrıca `legislation.applied` kaydında. |
| Zamanlayıcı | `startLegislationScheduler` gerçek zamanlayıcıyla, kontrollü saatle test edildi (kendiliğinden çalışır, günde bir kez, saatten önce çalışmaz). |

## 4. Geçen testler

- Birim: `legislation-sources.test.ts` + `legislation-source-health.test.ts` (kaydedilmiş gerçek sayfalarla): 15+ test.
- Kabul (gerçek PostgreSQL, sentetik kaynak): `legislation-watch.test.ts` (16, mevcut), `legislation-live-readiness.test.ts` (11): zamanlayıcı kendiliğinden, kaynak hata türleri (zaman aşımı/engel/boş/PDF/robot), bozuk metinde taban korunur, kurtarma + yeniden başlatma + üst üste çakışan taramalarda tek kayıt, geçmiş tarihli onayın anında uygulanması (yalnız eşleşen şube, tek bildirim, tekrar çalıştırmada kopya yok), denetimde onay önizlemesi ≠ gerçek sonuç.
- Tam sunucu paketi: 46 dosya geçti, 2 atlandı (canlı gözlem testi yalnız `LIVE_OBSERVE=1` ile koşar; yedek-geri yükleme yerelde hariç, CI'da çalışır) · 410 test geçti, 0 kaldı
- Tarayıcı kabulü (izole ortam 8098, ayrı oturumlar: yazar, alan uzmanı, onaylayıcı, platform yöneticisi, işletme sahibi, şube personeli): **51 geçti, 0 kaldı** (`docs/kanit-mevzuat-canli-gecis/kabul-kanit.json`). Ekran görüntüleri: kaynak sağlığı (`14`, `15`), eski/yeni metin (`03`, `16`), şube önizlemesi (`04`), onay sonrası durum (`07`, `13`), işletme bildirim ayrıntısı (`08`, `09`).
- Canlı gözlem (kanıt): `docs/kanit-canli/canli-gozlem.json` — erişim: iki kaynak 200; tarih aralığı 04.11–18.11.2026 (15 gün); Resmî Gazete: 149 kalem tarandı, 1 gıda belgesi okundu; Mevzuat: 6 belge, 148 madde (5996: 59, Gıda Hijyeni: 31, Kayıt-Onay: 16, Hijyen Eğitimi: 14, 2014/47: 19, 2014/48: 9), taban kaydedildi; ikinci okuma 0 kopya; 5996 filtre maddeleri (22, 24, 29, 30, 31, 32, 36) ayrıştırılan metinde var; her iki tarama yaklaşık 1–1,5 sn.

## 5. Test edilmeyenler / sınırlar (açık yazıyor)

- **Canlı kaynaktan bir yürürlük günü uygulaması** doğrulanamaz ve doğrulanmadı: hiçbir gerçek kural yayımlanmadı. Yürürlük günü, ileri tarihli, geçmiş tarihli, kaldırma davranışları yalnız sentetik kaynakla doğrulandı. Tarayıcıda zaman ilerletilemez; gün gelişi otomatik testte enjekte saatle.
- Tarayıcı kabulünde **kapsam dışı şube için ayrı bir kullanıcı oturumu** açılmadı; kapsam dışı şubenin bildirim/görev/yükümlülük almadığı veritabanı sorgularıyla ve API ile doğrulandı (51 kontrolün içinde).
- Gerçek bir geçerli Mevzuat **madde değişikliğinin** kuyruğa düşmesi canlıda gözlenmedi (yalnız Resmî Gazete yayını gözlendi); madde değişikliği sentetik ve kaydedilmiş gerçek sayfa üzerinde doğrulandı.
- Mevzuat birleştirilmiş metni sayfasında madde başlığı bir önceki maddenin sonuna yapışır (kaynak biçimi). Başlık değişirse o madde "değişti" görünebilir; tek değişiklik olarak, eski/yeni metinle incelemeye düşer.
- Kanun 5996'da 61 "MADDE" geçişi var, 59 madde ayrıştırıldı; filtre maddeleri doğrulandı, kalan iki fark (geçici/özel madde biçimleri olası) incelenmedi.
- Tarayıcı penceresinde 8091 üzerinde canlı tarama açılmadı (şart değildi).
- Gıda Hijyeni, Hijyen Eğitimi, 2014/47-48'de okunan metinde değişiklik işareti bulunmadı; bu "değişmedi" demek değildir, uzman Resmî Gazete'den teyit etmeli.

## 6. Uzman bekleyen maddeler (genel "uzman onayı gerekli" değil; soru, dayanak, ilgili taslak)

| # | Soru | Dayanak | İlgili kural taslağı |
|---|---|---|---|
| 1 | Sıcaklık izleme görevi yasal yükümlülük mü (Md. 18(5) + 22(2)(ç)), yoksa işletmenin kendi HACCP planından mı doğar? Küçük kafelere HACCP'ın hangi sadeleştirilmiş uygulaması (Md. 22(5)) geçerli? | Gıda Hijyeni Yönetmeliği Md. 18(5)-(6), 22 | P-01, P-03 |
| 2 | Kafe/restoran Hijyen Eğitimi Yönetmeliği'nin "perakende iş yeri" kapsamında mı? Belgenin geçerlilik süresi var mı (metinde yok)? | Hijyen Eğitimi Yön. Md. 2, 5 | P-04 |
| 3 | 2014/47 ve 2014/48 toplu tüketim yerinin kendi dondurucusuna uygulanır mı? Md. 4(ç) bir yıllık kayıt saklama ve 4(e) 10 m³ altı basit termometre istisnası kafede geçerli mi? −18 °C ürün tanımı mı, işletme limiti mi? | Tebliğ 2014/47 Md. 2, 4; 2014/48 Md. 4 | P-02 |
| 4 | Kafe kayıt (Ek-2) kapsamında mı, onay (Ek-1) kapsamında mı? Faaliyet değişikliğinde kayıt belgesi güncelleme süresi nedir? | Kayıt ve Onay Yön. Md. 5, 6, Ek-1/2 | — (kayıt numarası sorusu) |
| 5 | Dezenfektan ruhsatı için yürürlükteki yönetmelik hangisi (künye ve madde)? Künye doğrulanamadı. | — | P-05 |
| 6 | Temizlik/dezenfeksiyon için "yeterli sıklık" (Md. 14(1)(a)) hangi sayısal/plan temelli yorumla görev olur? | Gıda Hijyeni Yön. Md. 14 | P-05 |
| 7 | Kanun Md. 36 idari para cezası bentlerinden hangileri toplu tüketim yerine uygulanır? (tutar kurala taşınmaz) | Kanun 5996 Md. 36 | — |
| 8 | Kuyruktaki Peynir Tebliği (2026/24) kafe için geçerli mi (ürüne özgü)? 30/4/2027 geçiş tarihleri hangi işletmeler için ne anlama geliyor? Kapsam dışı ise reddedilir. | RG 33426, 10.11.2026, Md. 21–22 | — |
| 9 | Toplu Tüketim İyi Hijyen Rehberi'ndeki sıcak tutma/süre değerleri "iyi uygulama — Bakanlık rehberi" etiketiyle kullanılsın mı? Değerler bu çalışmada yeniden okunmadı. | Rehber (Isparta İl Müd. PDF) | P-03 |

Hiçbir satır uzman onaylı değildir; hiçbir kural taslağı oluşturulmadı.

## 7. Kanıt dosyaları

`docs/MEVZUAT_IZLEME_ENVANTERI.md` · `docs/kanit-canli/` (resmî metin özetleri, canlı gözlem JSON) · `docs/kanit-mevzuat-canli-gecis/` (21 ekran, kabul-kanit.json) · `docs/MEVZUAT_TAKIBI.md` (canlı geçiş rehberi) · `server/test/fixtures/legislation/` (kaydedilmiş gerçek sayfalar).
