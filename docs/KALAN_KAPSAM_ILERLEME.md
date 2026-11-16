# Kalan kapsam · ilerleme kaydı

Oturum kesilirse **son doğrulanan adımdan** devam edilir. Her grup ayrı commit; kanıt ve test sonucu aşağıda.
Referanslar: `TASARIM_V2_GELISTIRME_MADDELERI.md` (GM-xx), `TASARIM_V2_EKRAN_ESLEMESI.md`, PR #3 açıklaması.
**Erişilemeyen kaynaklar:** `GoverHub Mobile Standalone.dc(2).html` ve 14 Kasım Markdown dosyası diskte bulunamadı; görsel uyum bu nedenle **açık**, işlev kapsamı GM tablosundan alındı.

## Bugün ne yapıyor, ne yapmıyor (özellik başına)

Bu tablo, kodun **bugün** sunduğu davranışı söyler; hedef davranışı değil. "Yapmaz" sütunu bilerek yazılmıştır.

| Özellik | Bugün yapar | Bugün yapmaz | Açık madde |
|---|---|---|---|
| QR kodu | Ekipman/belge için kod üretir, PNG ve bağlantı gösterir, web'de yazdırır, gerekçeyle pasifleştirir. Kod/bağlantıyı **elle yapıştırınca** sunucu okutanın yetkisini denetler; yetkisiz, bilinmeyen ve pasif kod aynı 404'ü verir; okutma denetime yazılır | Kamerayla okumaz. Telefon kamerasından tarama yok | AM-1 |
| Belge metninden alan | Yapıştırılan/yazılan metinden belge türü, düzenleyen, no, tarihleri **kural tabanlı** önerir; her öneri kaynak satırı ve güven düzeyiyle gelir; kişi düzenler, onaylar ya da vazgeçer. Onay belge alanlarını yazar, belgeyi "incelendi" **saymaz**; incelenmiş sürümde tarihleri değiştirmez | Görselden/PDF'ten metin okumaz (OCR motoru yok). Önerileri kendiliğinden kaydetmez | AM-2 |
| Kaynaklı asistan | İşletmenin kendi yükümlülük, madde, belge ve açık görev kayıtlarında anahtar sözcük eşleştirir; bulduğunu **kaynağın kendi cümlesiyle** ve numaralı kaynakla verir; kaynak yoksa "yetersiz kaynak" der ve kaynak listesi boştur; örnek kuralı etiketler, doğrulanmış mevzuat saymaz; ceza tutarı sorusunu reddeder; başkasının kaydını görmez | Metin üretmez, özetlemez, yorumlamaz, hukuki görüş vermez; eş anlamlı/dolaylı soruyu anlamaz (sözcük eşleşmesi) | AM-3 |
| Toplu görev atama | Önce etkilenen şube, kişi ve görev sayısını gösterir; uygulama gösterilen sayıyı ister; atlanan şubeyi nedeniyle yazar; tek denetim olayı | Onaysız ya da bayat sayıyla uygulamaz (409) | — |
| Uzman pazarı | Seçili 2–5 uzmandan teklif, karşılaştırma, randevu önerme/onaylama/değiştirme, uzman takvimi (liste), talebe bağlı mesaj, doğrulanmış işe bağlı değerlendirme dağılımı, kalıcı Faydalı/Kaydet | Dil, müsaitlik, uzaktan filtresi ve yanıt süresi yok (modelde yok, uydurulmadı); takvimde ay görünümü yok | — |
| Platform yönetimi | Genel durum sayıları; platform rolü verme/kaldırma (gerekçe ≥10 karakter, kendi rolünü değiştiremez, son yönetici kaldırılamaz); platform + işletme zincirlerinde denetim kaydı (kim, ne zaman, gerekçe; gerekçe yoksa "kaydedilmemiş") | Kural onay/yayın gerekçesini **zorunlu** kılmaz (isteğe bağlı) | — |
| Ödeme | Hiçbir şey. İşte `payment_status = not_in_scope`; arayüz "ödeme uygulama dışında" der; kart verisi yok | Sağlayıcıya bağlanmaz, tahsilat/emanet yok | AM-5 |

## Ayrı açık maddeler

Her biri bağımsızdır; biri kapanınca diğeri kapanmış sayılmaz.

| No | Madde | Neden açık | Kapanış koşulu |
|---|---|---|---|
| AM-1 | **QR kamera okuma** | Kamera erişimi gerçek cihaz/tarayıcı izni ister; bu turda yalnız kod/bağlantı girişi doğrulandı | Telefonda uygulama içinden kamerayla okutup `/qr/resolve` sonucuna gitmek; izin reddi ve düşük ışık durumunun denenmesi |
| AM-2 | **Gerçek OCR** | Pilotta OCR motoru yok; sunucu yalnız verilen metinden öneri çıkarır | Motor/sağlayıcı kararı; taranmış PDF/fotoğraftan metin; Türkçe belgelerde doğruluk ölçümü; öneri → onay akışının aynı kalması |
| AM-3 | **Dil modeli** | Asistan geri getirme tabanlıdır; model yok | Model/sağlayıcı kararı; "kaynak yoksa söyleme" ve "ceza tutarı yok" kurallarının model yanıtlarında da testle korunması |
| AM-4 | **Fiziksel iPhone doğrulaması (GM-17)** | Fiziksel iPhone yok; WebKit/Chromium **öykünmesi** gerçek cihaz yerine geçmez | Safari'de fotoğraf/rapor yükleme (https), PDF indirme, yazdırma, çevrimdışı→eşitleme, dokunma hedefleri ve güvenli alan, kamera QR |
| AM-5 | **Ödeme sağlayıcısı** | Sahibin kararı **ertelendi**; sağlayıcı seçilmedi, hiçbir sağlayıcıya bağlanılmadı | Sağlayıcı seçimi; test hesabı/anahtarı; tahsilat mı emanet mi; `not_in_scope` kısıtının kalkması; sonra webhook imzası, idempotent olay defteri, sandbox senaryoları |
| AM-6 | Kural onay/yayın gerekçesi zorunlu değil | Mevcut istemciler gövdesiz çağırıyor | Gerekçeyi zorunlu yapmak ve eski çağrıları güncellemek |

## Grup 1 — Görevler ve belge kasası
| Madde | Senaryo | Kabul ölçütü | Durum |
|---|---|---|---|
| Ham alan adları (`temperature`, rol kodları) Türkçe | Eksik kanıt mesajı, ölçüm kartı, kural özeti | Kullanıcıya görünen metinde iç alan adı yok | tamam — `evidence-labels.test.ts` |
| Servis raporu kanıt seçimi / revizyon / kapalı görev sürümü | GM-30 devamı akışları | önceki commit `ad3d24d` ile 8091'de doğrulandı | tamam (önceki tur) |
| Belge yükleme, önizleme, indirme, geçerlilik | `documents-reviews.test.ts` (yükleme, dosya yalnız yetkiliye açılır, tarih hatırlatma) | mevcut testler geçiyor; **GM-03 "Eksik" filtresi eklendi** | tamam — `group1-tasks-vault.test.ts` |
| Windows `LocalStore` yol sorunu | Windows'ta yükleme testi | Yeniden üretildi: `root + '/'` karşılaştırması, Windows ters eğik çizgiyle her `put/get` reddediliyordu. `path.relative` ile düzeltildi; aynı hata `ops/target.ts`'te de vardı | tamam — `test/unit/local-store.test.ts`; tüm takım Windows'ta da koşuyor |
| Dinamik form: şablon sürümü kayda bağlı | Not/kontrol listesi/onay kanıtı | Kayıt gövdesinde `form {templateId, templateCode, ruleCode, ruleVersion}`; eski (`form`'suz) kayıt açılır | tamam — `group1-tasks-vault.test.ts` |

**Grup 1 kanıtı:** yerelde (Windows) tam sunucu takımı 280 test; 8091'de Task B eksik metni "Ölçüm: sıcaklık (°C)", `?filter=no_file` yalnız dosyasız belgeyi döndürdü. Ekran görüntüsü bu grupta alınmadı (metin ve filtre değişikliği API ile doğrulandı); Chromium/WebKit taraması en sonda.
**Açık kalan (Grup 1):** belge önizlemesi tarayıcıda yeni sekmede açılır, uygulama içi gömülü önizleme yok; fiziksel iPhone Safari PDF indirme beklemede (GM-17).

## Grup 2 — Çok şubeli kullanım ve rol ekranları
| Madde | Senaryo | Kabul ölçütü | Durum |
|---|---|---|---|
| Toplu görev atamada önizleme | Sahip/merkez 14 günlük açık görevleri bir kişiye atar | Etkilenecek şube, görev sayısı, görev alınacak kişiler ve atlanacak şubeler onaydan önce görünür; uygulama gösterilen sayıyı ister (`BULK_PREVIEW_STALE`); tek audit olayı | tamam — `bulk-assign.test.ts` (3), mobil `/tasks-bulk` |
| Şube yöneticisi yalnız kendi şubesini görür | Şube yöneticisi önizleme açar | Diğer şube adı bile dönmez; başka şube hedeflenirse 422; personel 403 | tamam |
| Kart sayıları = filtreli liste = detay | Merkez karşılaştırma satırı ↔ şubeye filtreli pano ↔ vaka detayı | Sayılar eşit, her kart vaka detayı olarak açılır, şube yöneticisi kümesi sahibin şube filtresiyle aynı | tamam — `role-matrix.test.ts` |
| Rol/menü erişimi (sunucu) | Sahip, merkez, şube yöneticisi, personel, uzman, dış doğrulayıcı, platform yöneticisi | 9 uç nokta × 7 rol matrisi sabitlendi; personel/uzman/doğrulayıcı 200 alsa da veri boş (kendi işi) | tamam — `role-matrix.test.ts` |
| Menülerin rol başına görünürlüğü (ekran) | `more.tsx` kuralları | Sunucu matrisiyle uyumlu; tarayıcıda rol rol ekran taraması **sona bırakıldı** | kısmi |

## Grup 3 — Uzman pazarı ve profesyonel akış
| Madde | Senaryo | Kabul ölçütü | Durum |
|---|---|---|---|
| Arama/filtre (GM-18) | Sağlayıcıları metin, şehir/ilçe, doğrulanmış belge, değerlendirilmiş iş ile süz | `%` joker çalışmaz; dil/müsaitlik/uzaktan **modelde yok → filtre sunulmadı** | kısmi (mevcut alanlar) |
| Birden çok sağlayıcıdan teklif (GM-21) | 2–5 uzman seç, teklifleri karşılaştır | Seçilmeyen uzman gelen kutusunda görmez, teklif veremez (404), yazışma 404; mod "selected", karşılaştırma tablosu | tamam — `market-depth.test.ts` |
| Randevu (GM-34) | Teklif kabulünden sonra iki taraf zaman önerir | Öneren kendi önerisini onaylayamaz; değişiklik eski zamanı `superseded` olarak saklar; ret/iptal gerekçeli; check-in sonrası 409; audit | tamam |
| Uzman takvimi (GM-28 kısmi) | `/pro/calendar` | Yalnız kendi işleri; yanıt bekleyen işaretli | tamam (liste; ay görünümü yok) |
| Talebe bağlı mesajlaşma (GM-20) | İşletme ↔ sağlayıcı ileti dizisi | Dizi talep+sağlayıcıya özel; ödeme öncesi işletme adı gizli; personel 404; bildirim | tamam |
| Değerlendirme (GM-22) | Kabul edilmiş işe bağlı | Kabulden önce 422; dağılım yalnız profilde gösterilmesine izin verilmiş işler; **yanıt süresi ölçülmüyor → boş, uydurulmadı** | kısmi |
| Faydalı bul / Kaydet (GM-32) | Akış kartı | Kalıcı, kişiye özel kayıt, geri alınır, idempotent; taslak/gizli yazıya 404; "Kaydedilenler" sekmesi | tamam |
| Talep→teklif→randevu→rapor→görev uçtan uca | `market-depth` + `report-evidence-link` | Zincir testlerle ayrı ayrı; tek akışta ekran taraması 8091'de | bkz. grup kanıtı |

## Grup 4 — QR, OCR ve yapay zekâ
| Madde | Senaryo | Kabul ölçütü | Durum |
|---|---|---|---|
| QR kaydı | Ekipman/belge için kod üret, PNG göster, pasifleştir | Kayıt başına tek etkin kod; pasifleştirme gerekçeli; yazdırma (web) | tamam — `qr-extraction-assistant.test.ts`, mobil `QrCard` |
| QR okutma + sunucu yetki kontrolü | Kod okutulur → kayıt ekranı | Kodu okutanın kendi yetkisi kapsamıyorsa, kod bilinmiyorsa ya da pasifse aynı 404; başarılı okutma audit'lenir | tamam; mobil `/scan` ve `/q/[token]` |
| OCR çıktısını inceleme | Belge metninden alan öner → kişi düzenler/onaylar | Öneri snippet ve güvenle gelir; onay belgeye yazar ama belgeyi **incelendi saymaz**; vazgeçince hiçbir şey yazılmaz | tamam — `ExtractionCard` |
| Kaynaklı asistan | İşletme sorusu | Yalnız çağıranın okuyabildiği belge/görev/yükümlülük kaynaklarından alıntı; kaynak yoksa "yetersiz kaynak" ve kaynak listesi boş; örnek kural etiketli, doğrulanmış mevzuat sayılmaz; ceza tutarı sorusu reddedilir | tamam — 14 test |

**Grup 4 kanıtı:** tam sunucu takımı 37 dosya, 312 test geçti (backup-restore hariç); sunucu ve mobil `tsc` temiz.
**Açık kalan (Grup 4) → ayrı maddeler AM-1, AM-2, AM-3 (yukarıda):** kamerayla QR okuma cihaz gerektirir, doğrulanmadı (kod/bağlantı girişi var). Pilotta OCR motoru yok: metin yapıştırılır ya da cihaz metninden gelir; sunucu yalnız öneri çıkarır. Asistan geri getirme tabanlıdır, dil modeli yok.

## Grup 5 — Platform yönetimi ve ödeme
| Madde | Senaryo | Kabul ölçütü | Durum |
|---|---|---|---|
| Süper yönetici ekranı (mevcut rol yapısı üzerinde) | `/admin`: genel durum, platform rolleri, denetim kaydı | Genel durum herhangi bir platform rolüne; rol yönetimi ve denetim okuma yalnız `platform_admin`; şirket kullanıcısı 403; MFA kapısı aynı | tamam — `platform-admin.test.ts` (6) |
| Platform rolü ver/kaldır | Kullanıcı ara, rol seç, gerekçe yaz | Gerekçe ≥10 karakter (422); kendi rolünü değiştiremez (403); son platform yöneticisi kaldırılamaz (409); aynı değişiklik tekrar edilirse etkisiz; platform zincirine `platform.role_granted/revoked` | tamam |
| Kim, ne zaman, ne yaptı, neden | Denetim kaydı: platform zinciri + tüm işletme zincirleri, olay önekiyle süzülür | Aktör adı, zaman, işletme, **gerekçe**; gerekçe yoksa "Gerekçe kaydedilmemiş" yazar, uydurulmaz | tamam |
| Kural kararlarında gerekçe | Alan incelemesi, onay, yayın | Gerekçe denetim kaydına yazılır. **Onay/yayında gerekçe isteğe bağlı**: mevcut istemciler gövdesiz çağırıyor; ekran not alanını gönderiyor | kısmi (açık madde) |
| Ödeme | — | Sağlayıcı seçilmedi; ürün kararı "ödeme uygulama dışında, kart verisi tutulmaz" (`payment_status = not_in_scope`) | **açık — sağlayıcı kararı bekliyor** |

**Grup 5 kanıtı:** `platform-admin.test.ts` 6/6; sunucu ve mobil `tsc` temiz; migrasyon 022 yalnızca `platform_roles` için `DELETE` yetkisi veriyor.
**Ödeme — gerçek bağlantı koşulları (yapılmadı, uydurulmadı):**
1. Sağlayıcı seçimi (sahibin kararı); test ortamı ancak sağlayıcı hesabı ve test anahtarıyla doğrulanabilir. Sağlayıcı seçilmeden "test ortamında doğrulandı" denemez; bu turda hiçbir sağlayıcıya bağlanılmadı.
2. Tüzel kişi/ticari hesap, canlı anahtar ve harcama yetkisi sahibe aittir.
3. Karar verilmesi gereken: ödeme yalnız tahsilat mı, emanet/hakediş mi; komisyon; fatura; iade/uyuşmazlık. `not_in_scope` kısıtı ve "GoverHub ödeme almaz" metni kalkmadan arayüze ödeme eklenmez.
4. Sağlayıcı seçilince yapılacaklar: webhook imza doğrulaması ve idempotent olay defteri, sandbox'ta başarılı/başarısız/iade senaryoları, kart verisinin yalnızca sağlayıcı sayfasında girilmesi.

**Not (tam takım):** Grup 5 sonrası tam takım ilk koşuda tek bir sıralama dalgalanması gösterdi (`market-depth`: aynı milisaniyede yazılan iki randevu satırı); sıralamaya `decided_at` ikinci anahtar olarak eklendi. Sonraki tam koşu 38/38 dosya geçti.

## Grup 4–5 tarayıcı ve ortam doğrulaması (8091, 2026-11-14/15)
| Ne | Nasıl | Sonuç |
|---|---|---|
| API sahnesi (12 kontrol) | `tools/g45check.cjs` 8091'e karşı | QR üret/PNG/bağlantı; yetkili sahip okutunca ekipman rotası; başka işletmenin sahibi ve bilinmeyen kod 404; asistan kaynaklı yanıt / konu dışı "yetersiz" / ceza tutarı reddi; metinden alan önerisi snippet'li; vazgeçince belgeye yazılmaz; platform genel durum + denetim; işletme sahibi denetimde 403 — **12/12 tamam** |
| WebKit (iPhone 14 öykünmesi, 390 px) | QR kartı ekipman ekranında, asistan, kod girişi, belge metninden alan oku | QR görüntüsü ve bağlantı görünüyor; asistan 4 kaynakla yanıt veriyor ve "doğrulanmış mevzuat dayanağı değil" notunu yazıyor; geçersiz kod "QR kodu bulunamadı."; öneri kartı düşük güveni ve kaynak satırı gösteriyor; yatay taşma yok |
| Çevrimdışı kesinti (WebKit) | Asistan sorusu bağlantı kesikken, sonra bağlantı geri | "Bağlantı yok." yazıyor, uygulama çökmüyor; bağlantı gelince aynı soru yanıtlanıyor |
| Chromium (Pixel 7 öykünmesi) | `/admin` platform yöneticisi: genel durum, rol ver (gerekçesiz engel, gerekçeli verildi), denetim kaydı | Gerekçe 10 karakterden kısaysa "Önce en az 10 karakterlik gerekçeyi yaz."; rol verilince denetimde "Platform rolü verildi · Gerekçe: Moderasyon vardiyası için görevlendirildi" |
| Bulgu ve düzeltme | İncelenmiş sürümde tarih alanlarını onaylamak 409 veriyordu (sunucu doğru reddediyor, ekran yönlendirmiyordu) | Kart, incelenmiş sürümde tarihleri göstermez ve nedenini yazar; yalnız belge bilgileri kaydedilir. Aynı akış yeniden denendi: tür ve belge no yazıldı, tarihler ve inceleme durumu değişmedi |

| 320 px (iPhone SE öykünmesi, WebKit) | `/more`, `/assistant`, `/scan`, `/admin` | `scrollWidth = innerWidth = 320`: yatay taşma yok |
| Rol rol menü (WebKit, `/more`) | sahip, müdür, personel, uzman, yönetici ile oturum açıldı; menü kimlikleri okundu | Sahip 22 giriş (profil, ekip, dış doğrulayıcı dahil); müdür bunlar olmadan; personel yalnız pano, bildirim, eğitim, uygunsuzluk, QR, asistan, eşitleme, ağ; uzman `/pro`'ya iner; platform yöneticisi şirket menüleri yerine `admin`. **Not:** "Kurum görünümü (demo)" demo kipinde personele de görünüyor (sentetik veri; sunucu kapısı ayrı) |

Kanıt dosyaları: `kanit-g45/wk/ekran`, `kanit-g45/cr/ekran` (ekran görüntüleri), `tools/g45check.cjs`.
**Doğrulanamayanlar (açık):** fiziksel iPhone Safari (kamera QR, PDF indirme, yazdırma); kamerayla QR okuma; gerçek OCR motoru; gerçek cihazda 320 px dışındaki genişlikler.

**CI bulgusu ve düzeltme:** GitHub CI, İstanbul gece yarısından sonra (UTC 21:00–24:00) `new-site-tasks.test.ts › repeating the operation never opens the same task twice` testinde düştü (`expected 1 to be 0`). Sebep ürün değil, test: şubenin takvimi İstanbul'dur, test ise UTC gününü kullanıyordu; bu saat aralığında "bugün" bir gün kayıyordu. Yerelde aynı saatte yeniden üretildi, test günü `Europe/Istanbul` ile hesaplayacak şekilde düzeltildi; tam takım 38/38 (318 test) geçti. Tam takımda bir koşuda tek bir dosya (`board`) yük altında kısa süre kurulumda düştü, tek başına ve sonraki tam koşuda geçti: zamanlama dalgalanması olarak izleniyor.

## Aralıklı test hataları — sınıflandırma ve kanıt (2026-11-15)
| Belirti | Sınıf | Kanıt | İşlem |
|---|---|---|---|
| `market-depth`: randevu geçmişi `['proposed','superseded']` geldi, `['superseded','proposed']` beklenirdi | **Ürün zayıflığı (sıralama saat değerine bağlıydı)**, yani gerçek ama nadir | Satırın `created_at` değeri ileri alınınca eski `ORDER BY created_at` **aynı hata iletisini** üretiyor (yeni testle yeniden üretildi); `seq` ile sıralayınca geçiyor | Migrasyon 023: `service_appointments.seq` ve `service_messages.seq` (identity); sıralama `seq`; test saat kaymasını zorluyor ve `seq` dışarı sızmıyor. Önceki `decided_at` ikinci anahtarı yetersizdi |
| `board`, `group1-tasks-vault`, `network`, `new-site-tasks`, `platform-admin`: yalnız `beforeAll` "Hook timed out in 10000ms", hiçbir doğrulama hatası yok | **Ortam (Docker/Windows veritabanı G/Ç'si)** | `freshEnv` (şemayı sil + tüm migrasyonlar) 10 ölçümde ortalama ~5,6 sn: 10 sn sınırının payı ince. Veritabanı günlüğünde aynı pencerede `checkpoint … sync=141 s, sync files=39954`. Aynı kodla 4 tam koşunun 3'ü 38/38, başarısızında 4 dosya art arda (zaman kümesi) ve hepsi kurulumda. GitHub CI (Linux) bu hatayı hiç vermedi | `hookTimeout` 60 sn (test yapılandırması); ürün kodu değişmedi |
| `new-site-tasks › repeating the operation…` (CI ve yerel, UTC 21:00–24:00) | **Test zamanlaması** | Yerelde gece yarısından sonra yeniden üretildi; test UTC gününü, şube İstanbul gününü kullanıyordu | Test günü `Europe/Istanbul` ile hesaplıyor (`8d7814f`) |

Düzeltmeler sonrası tam takım (Windows, backup-restore hariç): art arda 2 koşu 38/38, 318/318.

# Kapanış turu (dal `feat/kapanis-am-maddeleri`, taban `goverhub-mobile` @ `101de53`)
Tasarım referansı `GoverHub Mobile Standalone.dc(2).html` bu oturumdan erişilemiyor (yalnız `...Standalone.dc.html` var); görsel karşılaştırma **yapılamadı**, işlevsel doğrulama yapıldı. Alt ajan kullanılmadı.

## Aşama 1 — AM-6 kural onay/yayın gerekçesi zorunlu
- **Değişiklik:** `approve`/`publish` gerekçe ister (`needReason`: boş, yalnız boşluk, eksik → 422 "Kuralı onaylamak/yayımlamak için gerekçe yazmalısın."); doğrulama durum değişmeden önce. Denetim olayına kural kodu ve sürümü eklendi. Ekran: gerekçe alanı zorunlu, eksikse işlemin adı Türkçe yazılır; denetim kaydı kural kodu+sürümünü gösterir. Eski gerekçesiz kayıtlar "Gerekçe kaydedilmemiş" görünür.
- **Kabul:** `platform-admin.test.ts` "AM-6": taslak → inceleme → gerekçeli onay → gerekçeli yayın; 5 eksik/boş biçim onayda, 2 yayında reddedilir ve durum değişmez; yazar gerekçeyle bile onaylayamaz (403); her adım ayrı kayıt; eski kayıt okunur.
- **Test ortamı / sonuç:** Windows + PostgreSQL 16 (Docker); `platform-admin`, `rule-writing`, `production-guards`, `slice`, `ops` 49/49 (6'sı yeni). Mobil ve sunucu `tsc` temiz. Mevcut çağıranlar (seed, e2e, testler) gerekçe gönderecek şekilde güncellendi.

## Aşama 2 — AM-1 Kamerayla QR okutma
- **Değişiklik:** QR ekranına "Kamerayla okut" (tarayıcı kamerası: `getUserMedia` + kare çözme, `jsqr`). Kod/bağlantı girişi aynen duruyor; aynı sunucu çözümleme (`/qr/resolve`) kullanılır, erişim kuralları sunucuda. Kamera izni yok / kamera yok / güvenli olmayan bağlantı / desteklenmiyor → açıklama + kod girişine yönlendirme. Ekran kapanınca yayın durur; aynı kod ardışık karelerde tek kez yönlendirir; pasif/geçersiz kod → "Bu kod geçersiz, pasifleştirilmiş ya da bu kayda erişimin yok."
- **Kabul (sunucu, otomatik):** `qr-camera.test.ts` 6/6 — sunucunun bastığı QR görüntüsü çözülür, doğru ekipman kaydı açılır; pasif/bilinmeyen/yetkisiz (personel) 404; tekrar penceresi; hata eşlemeleri.
- **Kabul (TEST DÜZENEĞİNDE kamera akışı):** `tools/qr-kamera.cjs`, Chromium sahte kamera (QR görüntülü) + 8091: geçerli kod ekipmanı açtı, tek çözümleme isteği, navigasyon sonrası canlı iz 0; pasif kod hata gösterdi, yönlendirme yok; kamera yokken (NotSupportedError) açıklama + yapıştırılan bağlantıyla kayıt açıldı; izin reddi **benzetimi** (headless gerçek izin istemi göstermez; `getUserMedia` NotAllowedError'a zorlandı) izin mesajı + kod girişi gösterdi. Kanıt: `docs/kanit-kapanis/am1/*.png`.
- **AÇIK — gerçek telefon kamerası:** Fiziksel cihazda doğrulama bekliyor (iPhone Safari/Android Chrome, https gerekir). Yerel `expo-camera` eklenmedi; yalnız web/tarayıcı kamerası.

## Aşama 3 — AM-2 Dosyadan metin okuma (yerel OCR)
- **Değişiklik:** Sürümün yüklü dosyasından alan önerisi: `POST …/documents/:id/versions/:versionId/extract-file`. Metin katmanlı PDF doğrudan okunur (`pdfjs-dist`); taranmış PDF sayfaları çizilip (`@napi-rs/canvas`), fotoğraf (JPEG/PNG) yerel Tesseract (`tesseract.js` + paketlenmiş Türkçe dil verisi) ile okunur — ücretli servis/hesap/dışarı aktarım yok, Docker imajı `npm ci` ile kurar. Sınırlar: 10 MB, 5 sayfa, 90 sn. Okuma sürüme ve dosyanın sha256'sına bağlı (`document_extractions`: yöntem, kaynak metin, okuma güveni, düşük güvenli sözcükler; migrasyon 024). Düşük güvenli sözcük içeren satırdan çıkan alan "düşük güven" işaretlenir; kaynak satır ve tüm okunan metin ekranda görünür, kullanıcı düzeltip onaylar. Onay sürümü "incelendi" yapmaz; incelenmiş sürümde tarih değişimi yine 409. Okunamayan/bozuk/desteklenmeyen dosya → açık hata (422/415/413) + "Yeniden dene" + elle giriş (kayıt oluşmaz). Aynı dosyanın yeniden okunması bekleyen okumayı döndürür (`reused`), ikinci okuma/belge oluşmaz. Okuma işlemin dışında (işlem açıkken değil) çalışır; OCR işçisi tek ve sıralıdır. `/ocr/status` artık motoru bildirir.
- **Kabul (otomatik):** `file-extraction.test.ts` 11/11 — sentetik metinli PDF (doğrudan), taranmış PDF (OCR), eğik/gürültülü Türkçe fotoğraf (OCR; "İŞYERİ AÇMA VE ÇALIŞMA RUHSATI" doğru okundu), farklı değerli ikinci belge (alanlar şablondan değil dosyadan), tekrar okuma tek kayıt, onay/inceleme kuralları, yetkisiz 404, boş görüntü ve bozuk PDF hata + elle yol, dosyasız sürüm 409.
- **Kabul (8091, Linux konteyneri, tarayıcı):** `docs/kanit-kapanis/am2/am2check.cjs` — üç örnekte alanlar dosyadan geldi (belge no RHS-2031-0457, bitiş 2036-03-04; OCR güveni %95); düzeltilen belge no kaydedildi ve sürüm `unreviewed` kaldı; boş görüntü ve bozuk PDF için hata + yeniden dene + elle giriş; elle metinle öneri alındı. Ekran görüntüleri ve sentetik örnek dosyalar `docs/kanit-kapanis/am2/`.
- **Sınır / açık:** OCR yalnızca sentetik, temiz-orta kalitede örneklerle denendi; gerçek belgelerde, kötü ışıkta çekilmiş fotoğraflarda doğruluk daha düşük olabilir (bu yüzden öneri + düşük güven işareti + kullanıcı onayı). Gerçek telefondan çekilmiş fotoğraf yükleme: fiziksel cihazda doğrulama bekliyor. Büyük PDF'lerde yalnız ilk 5 sayfa okunur.

## Aşama 4 — AM-3 Kaynağa bağlı dil modeli yanıtı
- **Ortam kontrolü (önce):** Bu makinede yerel **Ollama** çalışıyor (`127.0.0.1:11434`; modeller `qwen2.5-coder:7b`, `qwen2.5vl:7b`, `nomic-embed-text`); ücretsiz, hesap/anahtar gerekmiyor, Docker kapsayıcısından `host.docker.internal:11434` ile erişilebiliyor. `qwen2.5vl:7b` bellek yetmediği için (5,8 GiB gerekli, 4,5 GiB boş) çalışmadı; `qwen2.5-coder:7b` kullanıldı. Üretimde kullanılacak model/sağlayıcı seçilmedi: bağlantı **ortam değişkenleriyle ayarlanabilir** (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_TIMEOUT_MS`; OpenAI uyumlu uç nokta) ve boşsa asistan eskisi gibi yalnız kaynaklardan yanıt verir.
- **Değişiklik:** `services/llm.ts` (bağlantı, istem, çıktı denetimi), `assistant.ts` yeniden yapıldı: kaynaklar önce sunucuda işletme/şube/role göre süzülür (`canReadDoc`, `obligation.read`, kişinin kendi görevleri); model işlem dışında yalnız bu kaynakları görür. Kaynaklara belge sürümü/bölümü ve kural kodu/sürümü eklendi (`locator`), belgenin kendi metni (dosyadan okunan/yazılan) bölümlere ayrılıp atıf yapılabilir hale geldi; her kaynak açılabilir (`route`). Model JSON döndürür (`answered|insufficient|conflict` + atıflar); sunucu denetler: var olan kaynağa atıf zorunlu, çelişki için ≥2 kaynak, **para/ceza tutarı yok, kaynaklarda bulunmayan sayı yok** — aksi halde yanıt kullanılmaz ve kaynaklar olduğu gibi listelenir. Ceza sorusu ve kaynak yokken model **hiç çağrılmaz**. Model ulaşılamaz/yavaş/bozuk → kaynaklar gösterilir ve söylenir. Örnek kural doğrulanmış mevzuat gibi sunulmaz; OCR kaynaklı metin uyarısı eklenir. Denetim kaydına yalnız sonuç/mod/model durumu yazılır (soru metni yazılmaz). Ekran: yanıt türü (kaynaklı / çelişiyor / yetersiz / kapsam dışı), "yanıtı dil modeli yazdı" ya da "model bağlı değil/kullanılamadı", kaynak başına sürüm-bölüm ve "yanıtta kullanıldı".
- **Kabul — otomatik model-bağlantı testi (sahte OpenAI uyumlu yerel sunucu):** `assistant-model.test.ts` 18 test: yapılandırma, kaynaklı soru (istem içeriği, Bearer anahtar, yanıtta anahtar yok), yetersiz kaynakta/ceza sorusunda 0 model çağrısı, personelin göremediği belge ve başka işletmenin belgesi isteme **girmiyor**, çelişki bildirimi (iki kaynak açılabilir), modelin "yetersiz" demesi, tek kaynaklı sahte çelişki reddi, ulaşılamaz/500/zaman aşımı → kaynaklar gösterilir, JSON olmayan/tutarlı/olmayan sayı/olmayan kaynak/atıfsız çıktı reddi, saf denetim işlevi.
- **Kabul — GERÇEK model yanıtı (yerel Ollama `qwen2.5-coder:7b`), ayrı kayıt:** `assistant-real-model.test.ts` (yalnız `LLM_BASE_URL`+`LLM_MODEL` varsa çalışır; CI atlar) ve 8091 üzerinde `docs/kanit-kapanis/am3/am3check.cjs`: kaynaklı soruda model Türkçe yanıt yazdı ve doğru belgeye atıf yaptı (~3 sn); kaynakların karşılamadığı soruda "kaynaklar yeterince karşılamıyor"; iki çelişen belgede (-18 °C / -12 °C) çelişkiyi iki kaynakla bildirdi, birini seçmedi; ceza sorusu reddedildi. Kanıt: `docs/kanit-kapanis/am3/gercek-model.json`, `sonuc-8091.json`, `asistan-celisen-kaynaklar.png`.
- **Kaynak arama sonucu (modelden ayrı):** Kaynak seçimi hâlâ sözcük eşleşmesiyle (gömme/embedding yok); eşik: sorudaki ≥2 konu sözcüğü. Model yalnız seçilmiş ≤6 kaynağı ifade eder. Mevcut `qr-extraction-assistant.test.ts` 14/14 değişmeden geçti (model bağlı değilken davranış aynı).
- **Sınır / açık:** 7B yerel model küçük; çelişki/yetersizlik yakalamayı örnekli istemle ve sunucu denetimiyle sağlıyoruz, ama her soruda doğru olacağı garanti değil (yanlış "yetersiz" ya da kaçan çelişki mümkün). Üretim sağlayıcısı ve modeli seçilmedi (maliyet/hesap kararı). Anlamsal arama (embedding) yok; eşanlamlı sorular kaynağı bulamayabilir.

## Aşama 5 — AM-4 Mobil doğrulama ve pilot regresyonu (8091)
- **8091 güncellemesi:** Docker imajı son kodla yeniden kuruldu (`up -d --build --no-deps app proxy`); veritabanı birimi ve mevcut demo kayıtları korundu, migrasyonlar (024 dâhil) kendiliğinden uygulandı. Asistan modeli bu makinedeki Ollama'ya (`host.docker.internal:11434`, `qwen2.5-coder:7b`) bağlı; ulaşılamazsa kaynaklar gösterilir.
- **Tam regresyon (API, sentetik hesaplar, kendi test işletmesi):** `docs/kanit-kapanis/am4/regresyon.cjs` → işletme → yeni şube → görev → hizmet talebi (göreve bağlı) → uzman teklifi → kabul → randevu (öneri / karşı öneri / kabul; eski öneri `superseded`, geçmiş sıralı) → yerinde giriş → rapor (PDF) belge olarak kasaya → başka yetkili belgeyi inceledi → teslim kabulü → raporun görev kanıtı olarak bağlanması + fotoğraf + not → görev kapandı; personel raporu göremedi. **20/20 adım tamam** (`regresyon-rgdak5.json`).
- **Eski kayıtlar (değiştirilmeden okundu):** 67 eski demo görevi listelendi ve biri ayrıntısıyla açıldı; eski belgelerin sürümleri açıldı ve sürüm sayıları tuttu; eski işin randevu geçmişi açıldı. Not: AM-1/AM-2/AM-3 kanıt çalışmaları demo işletmesine `Kamera testi belgesi`, `AM2 …`, `Temizlik planı …`, `Gıda deposu talimatı A/B …` adlı **sentetik test belgeleri** ekledi (silinmedi; ürün verisi değil).
- **Mobil tarayıcı öykünmesi (gerçek telefon DEĞİL):** `mobil-dogrulama.cjs` — Chromium Pixel 7 (412 px), WebKit iPhone 14 (390 px), WebKit iPhone SE (320 px): 13 ekran × 3 cihaz yatay taşma/çökme/boş ekran yok, JS sayfa hatası yok; geçersiz QR → açık hata; olmayan belge → "Belge bulunamadı" + Tekrar dene; sunucuya ulaşılamayınca ekran çökmüyor; çevrimdışıyken yapılan görev işlemleri (2 işlem) cihazda bekledi, ağ dönünce **kendiliğinden eşitlendi**, kuyruk boşaldı, görev sunucuda tamamlandı (3 cihazda). AM-2 akışı (dosyadan okuma, öneri inceleme/onay, okunamayan dosya) WebKit iPhone 14'te de geçti. Ekran görüntüleri `docs/kanit-kapanis/am4/`.
- **Bu turda bulunup giderilen:** sunucuya ulaşılamadığında ekran sonsuz "Yükleniyor…" gösteriyordu, neden söylenmiyordu → `Loading` 8 sn sonra "Bağlantı yok ya da zayıf olabilir; bağlantı gelince kendiliğinden yeniden denenecek" der (3 cihazda doğrulandı).
- **AÇIK bulgular / bekleyenler (gizlenmedi):**
  1. **Fiziksel cihazda doğrulama bekliyor** (iPhone Safari): kamerayla QR okutma; kameradan/dosya seçiciden fotoğraf yükleyip önerilen alanları inceleme; mevcut kanıt fotoğrafını açma ve PDF indirme; çevrimdışı → eşitleme; dokunma hedefleri; güvenli alan. Elde fiziksel iPhone yok; yukarıdaki sonuçlar öykünmedir.
  2. **Dokunma hedefleri:** öykünmede çok sayıda kontrol 32–36 px yüksekliğinde (geri düğmesi 36×36, sekme/filtre çipleri 33–34 px, durum pili 32 px); 44 px önerisinin altında. Düzeltilmedi (tasarım kararı + gerçek parmakla doğrulama gerekir); ayrıntı `mobil-dogrulama.json › kucukDokunmaHedefi`.
  3. **Güvenli alan:** arayüz `safe-area-inset` kullanıyor, ama web sayfasında `viewport-fit=cover` tanımlı değil; çentikli iPhone'da `env(safe-area-inset-*)` değerleri bu yüzden 0 kalabilir (alt çubuk/ana göstergeyle yerleşim yalnız gerçek cihazda görülebilir). Değiştirilmedi: cihazda doğrulanamayan bir değişiklik yapılmadı.

## Aşama 6 — AM-4 devamı: dokunma hedefleri, güvenli alan ve dosya akışları (PR #4'e ek)
- **Dokunma hedefleri (düzeltildi):** `Tap` bileşenine `minHeight/minWidth: 44` eklendi (react-native-web `hitSlop`'u uygulamadığı için gerçek boyut). Öykünmede 13 ekranda görünen tüm kontroller ölçüldü: Pixel 7 172, iPhone 14 161, iPhone SE 150 kontrol — 44 px altı **0**, yatay taşma 0 (önce 32–36 px'lik çok sayıda kontrol vardı). Görsel bedel: filtre çipleri ve geri düğmesi 44 px oldu, dar ekranda çip satırları bir satır daha sarabilir.
- **Güvenli alan (düzeltildi, ölçümü cihazda bekliyor):** web kabuğu `mobile/public/index.html` ile özelleştirildi ve `viewport-fit=cover` eklendi; alt gezinme çubuğu zaten `max(26, safe-area-inset-bottom)` kullanıyordu, ama bu meta olmadan iPhone Safari değeri hep 0 veriyordu. 8091'de meta doğrulandı; alt çubuk boşluğu üç cihazda ≥26 px, sekmeler ≥44 px. **Gerçek çentik/ana çubuk değeri yalnız fiziksel iPhone'da ölçülür** (öykünme `env()` değeri vermez).
- **Dosya akışları (8091, sentetik veri, `tools/akislar.cjs`, WebKit iPhone 14 + Chromium Pixel 7):** belgeye ekrandan PDF ve fotoğraf yükleme (sunucuda "stored"), "Aç", "İndir" (indirilen dosya yüklenenle bayt bayt aynı), vakada eylem kanıtı fotoğrafını ekrandan ekleme ve ekranda açma (görsel çözüldü, 1240×1000), denetim dosyası PDF'i indirme (`%PDF-` başlığı). 20/20 denetim. Not: başsız tarayıcıda PDF görüntüleyici yok; PDF "Aç" indirme olarak teslim edildi (içerik sağlam). Satır içi PDF görüntüleme fiziksel Safari'de doğrulanmalı.
- **Önceki akışlar yeniden çalıştırıldı (Tap değişikliğinden sonra):** kamerayla QR 7/7 (`qr-kamera.cjs`), dosyadan metin okuma (`am2check.cjs`, tümü TAMAM), mobil doğrulama + çevrimdışından dönüş 27/27 (`mobil-dogrulama.cjs`: 2 bekleyen işlem → ağ dönünce kuyruk 0, görev sunucuda tamamlandı; her üç cihazda).
- **Kanıt:** `docs/kanit-kapanis/am4b/` (JSON sonuçlar, ekran görüntüleri, indirilen denetim PDF'leri, betik kopyaları).
- **AÇIK (gizlenmedi):** fiziksel iPhone Safari'de kamera QR, kameradan yükleme, satır içi PDF görüntüleme, güvenli alan ölçümü ve çevrimdışı eşitleme — **"Fiziksel cihazda doğrulama bekliyor"**; bu madde başka işi durdurmadı. Tasarım referansı `…Standalone.dc(2).html` hâlâ erişilemiyor, görsel karşılaştırma yapılamadı.

## Pilot kapanışı — açık maddeler (16.11.2026)
Ayrıntılı kayıt: `docs/PILOT_KAPANIS.md`. Kanıtlar: `docs/kanit-kapanis/pilot/`. Test ortamı aksi belirtilmedikçe 8091 (Docker, sentetik veri). "Commit" sütunu kapanışın yapıldığı değişikliği gösterir; açık maddede kapanışı bekleyen iş yazılıdır.

| # | Madde | Durum | Kabul ölçütü | Test ortamı / kanıt | Commit | Dış bağımlılık |
|---|---|---|---|---|---|---|
| 1 | Ana işletme senaryosu (işletme → kural → görev → servis → teklif → randevu → rapor → inceleme → kanıt → bağımsız doğrulama → kapanış → denetim dosyası) | **Kapandı** | Her rol ile 29 API adımı + 51 ekran denetimi geçer; revizyon eski seçimi geçersiz kılar; kapanan görev sürümünü korur | 8091; `senaryo-*.json`, `pk-ui.json` | `04ad39d` (denetim dosyasına kapanış izi), `75388b4` | — |
| 2 | Kaynaklı asistan, gerçek model | **Kapandı (sentetik veriyle)** | Kaynaklı yanıt, yetersiz kaynak, çelişen kaynak, ceza tutarı reddi; model kapalıyken kaynak listesi | `ortam-*.json`, `am3check` | `75388b4` | Yerel Ollama |
| 3 | 7B modelin yanlış "çelişki" bildirebilmesi | **Açık (bilinen sınır)** | Daha büyük model ya da gömme tabanlı kaynak seçimiyle aynı içerikli belgelerde yanlış çelişki çıkmaz | `PILOT_KAPANIS.md` Aşama 3 notu | — | Daha güçlü yerel model |
| 4 | Kural gerekçesi akışı | **Kapandı** | Gerekçesiz onay/yayın 422; ayrı denetim kayıtları; eski sürüm görevleri açık | `kural-gerekce-*.json`; `platform-admin.test.ts` | PR #4 (`b967168`) | — |
| 5 | Kamerayla QR, belgeden okuma | **Kapandı (öykünme / sentetik)** | QR 7/7; PDF, tarama, fotoğraf, okunamayan örnek | `qr-kamera`, `am2check` | PR #4 | — |
| 6 | **Fiziksel iPhone** (kamera QR, kameradan yükleme, satır içi PDF, gerçek bağlantı kesintisi, çentik güvenli alanı) | **Doğrulama bekliyor** | Aynı akışlar gerçek iPhone Safari'de geçer | Erişim yok | — | Fiziksel cihaz |
| 7 | **Son tasarım karşılaştırması** (`GoverHub Mobile Standalone.dc(2).html`) | **Açık** | Dosya bu makinede yok; sağlandığında ekran ekran karşılaştırılır | Depodaki `project/…Standalone.dc.html` ve İndirilenler'deki üç zip'in içindeki sürümler görüldü, `(2)` yok | — | Dosyanın sağlanması |
| 8 | Chromium + WebKit normal ve 320 px, 44 px hedefler, çevrimdışı kuyruk | **Kapandı (öykünme)** | 13 ekran taşmasız; 0 küçük hedef; kuyruk bir kez boşalır | `mobil-dogrulama.cjs` 27/27, `pk-ui.json` 51/51 | PR #4 | — |
| 9 | Temiz kurulum (ayrı klasör, ayrı birimler) | **Kapandı** | 24 migrasyon, demo giriş, ilk işletme | 8095; `kurulum/goverhub-temiz-kurulum.json` | `b7d9c38` | Docker Desktop |
| 10 | Veri koruyan güncelleme | **Kapandı** | Kayıt sayıları ve 68 dosya özeti aynı | 8091; `sayac-oncesi/sonrasi.txt` | kapanış PR'ı | — |
| 11 | Geri yükleme tatbikatı | **Kapandı** | Boş ortamda "SONUÇ: TAMAM"; sayılar aynı; 46/46 dosya özeti aynı | 8096; `geri-yukleme-dogrulama.json` | `adaf984` | — |
| 12 | Yedeğin **ayrı konuma/makineye** aktarımı ve gözcü | **Açık** | Yedek ayrı konuma yazılır, orada doğrulanır; gözcü yaşı izler | `docs/YEDEKLEME.md` | — | Barındırma kararı |
| 13 | Eksik modül bildirimi (`/api/system/modules`) | **Kapandı** | OCR/PDF/model için eksik olan ve kullanıcı etkisi yazılır | `modules.test.ts` 4/4 | kapanış PR'ı | — |
| 14 | **Ödeme sağlayıcısı (AM-5)** | **Ertelendi (karar)** | Sağlayıcı seçimi ayrı karar; yok sayılmadı | — | — | Sağlayıcı kararı |
| 15 | **Gerçek mevzuat doğrulaması** | **Açık (ayrı karar)** | Kurallar uzman hukuk incelemesinden geçip örnek etiketi kalkar | Kurallar "örnek" etiketli | — | Hukuk/alan uzmanı |
| 16 | **Gerçek işletme verisi ile yayın** | **Açık (ayrı karar)** | Aydınlatma, saklama matrisi, barındırma ve yedek konumu kararları | — | — | İşletme + hukuk |
| 17 | **Ücretli sürüm** | **Açık (ayrı karar)** | Ödeme (14) ve fiyatlandırma kararı | — | — | Ticari karar |
| 18 | Kaynak arama (sözcük eşleşmesi, gömme yok) | **Açık** | Gömme tabanlı arama ve değerlendirme kümesi | — | — | Gömme modeli |

**Örnek içerik beyanı:** demo işletmeler, kullanıcılar, belgeler, ölçümler ve `EX-` kuralları sentetiktir; hiçbiri doğrulanmış mevzuat ya da gerçek veri değildir. Ceza tutarı üretilmez.
