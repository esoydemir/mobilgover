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
