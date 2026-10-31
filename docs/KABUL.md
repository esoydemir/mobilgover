# İlk uçtan uca dilim — kabul kriterleri ve test durumu

**Dilim:** İşletme profili → onaylı kural → uygulanabilirlik açıklaması → görev → kanıt → uygunsuzluk → aksiyon → doğrulama → denetim çıktısı.
**Kapsam:** Tek şubeli kafe; **örnek** kurallar (soğuk muhafaza sıcaklığı, LPG kontrolü, eldiven kontrolü, yoruma açık İSG eşiği). Hiçbiri gerçek mevzuat iddiası taşımaz.

Testler: `server/test/domain/*` (saf mantık) ve `server/test/acceptance/*.test.ts` (gerçek PostgreSQL + HTTP).
Son çalıştırma: 31.10.2026, **57/57 geçti**.

## Zorunlu senaryolar

| # | Senaryo | Durum | Nerede |
|---|---|---|---|
| 1 | Eksik profil bilgisi yanlışlıkla "uygulanmıyor" üretmiyor | ✅ Test edildi | `conditions.test.ts` "missing information is unknown…", `slice` "asks instead of guessing" |
| 2 | Aynı olay tekrar işlendiğinde mükerrer görev oluşmuyor | ✅ Test edildi | `slice` "generates tasks once…", yeni kural sürümünde `created: 0`, tamamlama tekrarı aynı cevabı döndürüyor |
| 3 | Profil değişimi geçmiş kayıtları değiştirmiyor | ✅ Test edildi | `slice` "a profile change cancels open work but leaves completed records…" |
| 4 | Yeni kural sürümü eski kanıtın bağlamını bozmuyor | ✅ Test edildi | `slice` "a new rule version keeps old evidence in its original context…" |
| 5 | Limit dışı ölçüm doğru uygunsuzluk akışını başlatıyor | ✅ Test edildi | `slice` "completes as done, nonconforming…", CAPA bölümü |
| 6 | Eksik zorunlu kanıtla işlem tamamlanamıyor | ✅ Test edildi | `slice` "cannot be completed while mandatory evidence is missing or still uploading" |
| 7 | Başka işletmenin verisine doğrudan API isteğiyle erişilemiyor | ✅ Test edildi (API + RLS) | `slice` "one company cannot reach another company's data…" |
| 8 | Çevrimdışı kayıt bağlantı gelince kaybolmadan eşitleniyor | ⚠️ Kısmen | Sunucu tarafı (işlem anahtarı, tekrar oynatma, eski sürüm bayrağı) test edildi. **Mobil cihaz kuyruğu henüz yok.** |
| 9 | Çakışma ve yarım dosya yükleme doğru gösteriliyor | ⚠️ Kısmen | Sunucu: `409 TASK_ALREADY_DONE` ve `rejected` yükleme test edildi. **Mobil arayüz gösterimi yok.** |
| 10 | Kanıt değişikliği tespit edilebiliyor | ✅ Test edildi | `slice` "detects a changed evidence file", "the database refuses to rewrite history…", `core.test.ts` zincir testleri |
| 11 | Kritik açık risk yüksek skorun içinde gizlenmiyor | ✅ Test edildi | `core.test.ts` "an open critical risk cannot hide…", `slice` göstergeler |
| 12 | Kaynağı olmayan asistan cevabı kesin hüküm üretmiyor | ❌ Yapılmadı | Asistan bu dilimde yok; tasarım `MIMARI.md` §11 |
| 13 | Demo sıfırlama gerçek veriyi etkilemiyor | ✅ Test edildi | `slice` "demo reset removes demo companies and leaves real data untouched" |

## Dilimin ek kabul kriterleri

| Kriter | Durum |
|---|---|
| Onaylanmamış OCR bilgisi yükümlülük değiştirmiyor; OCR "doğrulanmış" olarak kaydedilemiyor | ✅ |
| Yoruma açık hüküm sessizce karar vermiyor (`needs_review`); eksik bilgi önce soruluyor | ✅ |
| "Neden?" cevabı: eşleşen olgular, kaynak hüküm, kural sürümü, örnek/iyi uygulama etiketi | ✅ |
| Elle "uygulanmıyor" gerekçe istiyor, kim verdiği kaydediliyor, personel veremiyor | ✅ |
| Kuralı yazan kendi kuralını onaylayamıyor; örnek kural gerçek ortamda yayınlanamıyor; kaynaksız gerçek yükümlülük reddediliyor; gerçek ortamda demo sıfırlama kapalı | ✅ |
| Limit ekipman türüne bağlı; tanımsızsa tahmin yok; birim uyuşmazlığı reddediliyor | ✅ |
| Gelecek tarihli ölçüm reddediliyor; cihaz ve sunucu zamanı ayrı | ✅ |
| Personel yalnızca kendine atanan görevi görüyor; göstergeleri göremiyor | ✅ |
| Şube yöneticisi şirket geneline erişemiyor; uzman yalnızca izin kapsamını görüyor; platform yöneticisinin örtük erişimi yok | ✅ |
| Uygunsuzluk adım sırası; yüksek riskte bağımsız kapanış | ✅ |
| Denetim dosyası eksikleri, açık uygunsuzlukları, kural sürümlerini, bütünlük sonucunu ve örnek içerik uyarısını içeriyor | ✅ |
| Saat dilimi (yaz saati dahil), kapalı günler, aylık dönem anahtarı | ✅ (saf testler) |

## Test edilmeyenler (dürüst liste)
- Mobil uygulama ile sunucu entegrasyonu (yok).
- Yük, eşzamanlılık ve performans testleri.
- Hız sınırının çok sunuculu davranışı.
- Yedekten geri yükleme tatbikatı (yöntem `MIMARI.md` §9'da tanımlı, çalıştırılmadı).
- Gerçek mevzuat içeriği (depoda yok).
