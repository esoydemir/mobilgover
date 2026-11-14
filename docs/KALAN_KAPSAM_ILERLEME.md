# Kalan kapsam · ilerleme kaydı

Oturum kesilirse **son doğrulanan adımdan** devam edilir. Her grup ayrı commit; kanıt ve test sonucu aşağıda.
Referanslar: `TASARIM_V2_GELISTIRME_MADDELERI.md` (GM-xx), `TASARIM_V2_EKRAN_ESLEMESI.md`, PR #3 açıklaması.
**Erişilemeyen kaynaklar:** `GoverHub Mobile Standalone.dc(2).html` ve 14 Kasım Markdown dosyası diskte bulunamadı; görsel uyum bu nedenle **açık**, işlev kapsamı GM tablosundan alındı.

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
**Açık kalan (Grup 4):** kamerayla QR okuma cihaz gerektirir, doğrulanmadı (kod/bağlantı girişi var). Pilotta OCR motoru yok: metin yapıştırılır ya da cihaz metninden gelir; sunucu yalnız öneri çıkarır. Asistan geri getirme tabanlıdır, dil modeli yok.
