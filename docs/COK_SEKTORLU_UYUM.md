# Çok sektörlü uyum — ilk akış (21 Kasım 2026)

Kapsam: işletmenin kayıt ekranından başlayıp çalışanın görevi kanıtla tamamlamasına kadar çalışan tek akış.
Tüm kurallar **ÖRNEK**tir; hukuki dayanak doğrulanmış değildir.

## Akış

1. Sahip kayıt ekranında işletmeyi açar (`POST /companies`).
2. **Faaliyet** adımı (yeni): NACE kodu veya faaliyet adıyla arar, seçer, "Doğru, işletmemin faaliyeti bu" ile onaylar (`GET /nace`, `POST /companies/:id/activity`).
   - Katalog: `server/src/domain/nace.ts`, sürüm `nace-rev2-tr/starter-1`, kaynak TÜİK NACE Rev.2. **Başlangıç alt kümesidir (10 sınıf)**, tam sınıflama değildir; ekranda da böyle yazar.
   - Onaylanan koddan yalnızca `activity.food_preparation` türetilir; kaynak referansı ve notu kayda yazılır ("Onaylanan faaliyet kodlarından türetildi: 56.10").
   - Katalogda olmayan kod tahmin edilmez: kod saklanır, `activity.nace_needs_review` denetim kaydı düşer, hiçbir şey türetilmez; bağlı yükümlülükler "bilgi eksik" kalır, asla "uygulanmaz" olmaz.
3. Şube soruları: A şubesi `storage.cold = Evet`, B şubesi `Hayır` (mevcut profil soruları).
4. Mevcut kural motoru EX-COLD-CHAIN'i A için "uygulanır", B için "uygulanmaz" yapar; görev A'da soğutucu başına doğar.
5. Yönetici "Bunu neden yapmam gerekiyor?" ekranında kuralı, eşleşen cevapları (Türkçe etiketle) ve cevabın kaynağını (NACE 56.10) görür.
6. Yönetici görevi çalışana atar; çalışan kendi hesabında yalnızca onu görür, ölçüm + fotoğraf ekler, tamamlar.
7. Kapanmış kayıt yeniden açıldığında çalışan, kanıt ve dayanak kural görünür.
8. Sonradan eklenen şube onaylı faaliyeti devralır; soğuk depo cevaplanana kadar görev doğmaz ("bilgi eksik").

## Ölçüm tanımı

"1 görev" = EX-COLD-CHAIN için, bir şubedeki **bir soğutucu**, **bir günlük periyot**. Kural günlük olduğu için 14 günlük ufukta aynı soğutucuya 15 kayıt vardır; ölçüt "bugünkü periyot"tur.

## Testler

`server/test/acceptance/multi-sector-flow.test.ts` — hepsi public API'den gider, hiçbir görev/fact elle eklenmez:

- A: bugünkü periyotta 1 görev; B: 0 görev, 0 bildirim, karar `not_applicable`.
- Aynı profil (faaliyet + soğuk depo) iki kez daha kaydedilince A'da görev sayısı değişmez.
- Emlak ofisi (68.31): `food_preparation=false`, soğutucu olsa bile 0 soğuk ürün görevi, hiçbir yükümlülük `applies` değil.
- Bilinmeyen kod (99.99): kod saklanır, inceleme istenir, yükümlülük `not_applicable` olmaz.
- Kanıtsız tamamlama reddedilir; kanıtlı tamamlama sonrası kayıt çalışanı, kanıtı, ölçümü ve kural sürümünü gösterir.

## İkinci dilim (22 Kasım)

- **Soru grupları (GH-01):** Katalogdaki her sınıf bir soru grubu açar (`food`, `installation`); `GET /companies/:id/profile-questions` genel sorulara o grupların sorularını ekler. Emlak ofisi yalnız il/ilçe/çalışan sorusunu görür; elektrik dükkânı montaj sorusunu görür, soğuk depo sorusunu görmez. Tanınmayan kod hiçbir şeyi gizlemez (tüm sorular açık).
- **Elektrik dükkânı senaryosu:** yeni ÖRNEK kural `EX-ELEC-INSTALL` (iyi uygulama, `activity.onsite_installation`), `ensureSectorRules` ile yayımlanır. Satışla başlayınca görev yok; montaj sonradan "Evet" olunca yalnız montaj görevi başlar, eski karar kayıtları silinmez, tekrar kayıt mükerrer üretmez. Kural ölçüm değil kontrol listesi + fotoğraf ister: motor, limit tanımlamayan ölçümü reddediyor ve limit uydurmadım.
- **İki şubeli zincir:** B'ye sonradan soğuk depo eklenince yalnız B'de görev başlar, A aynı kalır, karar geçmişinde "uygulanmaz → uygulanır" görünür.
- **Eski müşteri:** `GET /companies/:id/activity` faaliyet yoksa `missing: true` döner; profil ekranı kartı bunu görevlere dokunmadan ister.
- **B-16:** Ekran alt başlıkları (İngilizce) kaldırıldı; "eksik bilgi" satırlarında teknik anahtar yerine Türkçe etiket (`mobile/src/features/factLabels.ts`).
- **B-02:** Atama listesinde ad yoksa veya e-postadan türetilmişse e-posta da gösterilir.
- Test: `multi-sector-flow.test.ts` 19/19.

## Bilinen sınırlar (gizlenmiyor)

- Elektrik için "destek kategorisi" (GoverUp önerisi) bağlanmadı; GH-06 ayrı iş.
- B-12 (320 px) ve B-16'nın EK-267 sayfa taraması tarayıcıda doğrulanmadı.

- NACE kataloğu 12 sınıflık başlangıç alt kümesi; tam TÜİK listesi ve her sınıfın hangi yükümlülüğe bağlandığı ürün/hukuk kararıdır.
- Katalog dışı kod için "inceleme" şu an denetim kaydı + "bilgi eksik" ile sınırlı; bir inceleme kuyruğu ekranı yok.
- İki ÖRNEK sektör kuralı ölçüldü (EX-COLD-CHAIN, EX-ELEC-INSTALL); diğer sektör kuralları yazılmadı.
- Fotoğraf yükleme ekran kanıtında tarayıcı dosya seçicisi sürülemediği için API ile yapıldı; ölçüm, atama ve tamamlama ekrandan yapıldı.
- Kayıt ekranında ikinci şube eklemek için ayrı bir ekran akışı denenmedi; B şubesi API ile eklendi (`POST /companies/:id/sites`).
- `npm run migrate` Windows'ta sessizce hiçbir şey yapmıyor (`import.meta.url === file://${argv[1]}` karşılaştırması `file:///C:/…` ile eşleşmez); testler `migrate()` fonksiyonunu doğrudan çağırdığı için etkilenmez.

## Ekran kanıtı

`docs/kanit-f1-cok-sektor/` — 01…08 (kayıt → faaliyet → şube soruları → A neden → atama → çalışan görünümü → tamamlama → B neden).
