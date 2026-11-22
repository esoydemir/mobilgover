# PR #22 son kabul — sıklığı yönetici seçer, alan yetkisi, aynı başlıklı yayınlar (23 Kasım)

Tüm yayınlar, kurallar, işletmeler SENTETİK / ÖRNEKTİR (`sentetik.test`). Hiçbir yere dağıtım yapılmadı (8091 dahil), gerçek kural yayımlanmadı. B-04/B-06/B-09 için tanım yok, işlenmedi. Çalışan sektör / şube / bildirim akışı değişmedi (gh10–gh14 testleri aynen geçer).

## Ne değişti
1. **Sıklığı yönetici seçer.** Taslakta "Belirlenmedi · Tek seferlik · Her gün · Her hafta · Her ay" seçenekleri görünür. Öneri taslağı sıklığı **belirsiz** bırakır (`unset`); belirsiz taslak **kaydedilir**, ama görev üreten kural onaylanamaz/yayımlanamaz (`FREQUENCY_UNSET`, hem onayda hem yayında). Yürürlük tarihi, uygulama günü, ilk görev vadesi ve tekrar ekranda ayrı satırlardır. Kaynak metin sıklık söylüyorsa cümle gösterilir ("yıllık" gibi desteklenmeyen sıklık ayrıca belirtilir); söylemiyorsa "söylemiyor; yönetici belirler" yazar. Sıklığın **dayanağı** etiketlenir: Kaynak metin · Yönetici seçimi · İşletme planı · ÖRNEK senaryo. Onay önizlemesi şube başına şunu yazar: "Bu kuralla *Emlak A — sözleşmeli portföy* şubesinde *30.11.2026 10:00, 07.12.2026 10:00* tarihlerinde görev açılacak." (görev üreticisinin kendi takviminden hesaplanır).
2. **İnceleme alanı ≠ sektör önerisi.** Sektör yalnız alan ÖNERİR (emlak → `consumer`, elektrik → `occupational_safety`, gıda → `food_safety`); gıda alanı kendiliğinden seçilmez. Alanı yönetici seçer. Kuralı kimin inceleyebileceği `reviewer_areas` atamasına bağlıdır. Alanda tanımlı inceleyici yoksa kayıt gerekçesiyle **kuyrukta bekler** ("consumer alanında tanımlı inceleyici yok…"), onay engellenir. Her hesap kendi yetkisini görür ("Bu alanda inceleme yetkin var / yok; yetkili: …"). Yayımlı kuralların geçmişi dokunulmadan kalır (yeni sürüm = yeni kayıt; gh11 testi).
3. **Aynı başlıklı yayınlar ayrı izlenir.** 14 günlük "kapsam dışı / okunamadı" listesi kaynak yayın kimliğiyle (`rg:…-91`) anahtarlanır; her satırın kendi bağlantısı, durumu ve gerekçesi (okunan metnin başı) vardır. Metni okunamayan yayın "METNİ OKUNAMADI · SINIFLANDIRILAMADI" olarak görünür. Önceki sınır (aynı başlık = tek satır) kalktı.

## Yöntem ve TEST SAATİ
İki senaryo **aynı koşullarda**, ayrı ve taze veritabanlarında (`gh_acc1`, `gh_acc2`), aynı sentetik kaynak ve aynı betikle koşturuldu; başlangıç sayıları ikisinde de aynı (görev 66 · bildirim 0 · yükümlülük 77). `server/scripts/synthetic-legislation-env.ts`, `SYNTH_SCHEDULER=1` ile **gerçek günlük zamanlayıcıyı** çalıştırır ("Şimdi tara" düğmesi kullanılmadı). Test ortamına özgü: `MFA_REQUIRED_FOR_PLATFORM=false`.
- **Test saati (yalnız zamanlayıcının "şimdi"si kaydırıldı; HTTP istekleri gerçek saatle):** 23.11.2026 23:30 (keşif taraması) → 25.11.2026 09:00 (yürürlük günü, kendiliğinden uygulama) → 25.11.2026 23:30 (yeniden tarama). Görev üretimi (`topup-window.ts 14`) 25.11.2026 09:00 test saatiyle iki kez, ardından API yeniden başlatıldı.
- Bu bir **zaman kaydırmasıdır**: 25.11–07.12 tarihli görev/bildirim gerçek tarihte gerçekleşmiş iş değildir.
- Yayın: "Sentetik Gayrimenkul Aracılık Hizmetlerinde Yetki Sözleşmesi Dosyası Yönetmeliği" (`rg:…-81`), yürürlük metinde 25.11.2026, **metinde sıklık ifadesi yok**. Kural koşulu: aracılık = evet VE müşteri adına sözleşme tutma = evet.
- Şubeler: Emlak A (koşulu sağlar), Emlak B (sözleşmesiz), Market, Elektrikçi + Emlak çalışanı.
- Alan ataması: kaynakta `consumer` için inceleyici yoktu → kayıt bekledi → operatör CLI'si (`admin:grant … alan:consumer`, denetim kaydıyla) ile Alan uzmanı hesabına atandı → inceleme yapıldı → ayrı hesapla (Ürün sahibi) onaylandı (yazar ≠ inceleyen ≠ onaylayan).

## Tek tablo
| Adminin seçtiği sıklık | Önizlenen vadeler | Oluşan görev kimliği ve vade | Mevzuat bildirimini alan şube |
|---|---|---|---|
| **Tek seferlik** (27.11.2026 10:00; dayanak: ÖRNEK senaryo) | 27.11.2026 10:00 | `324195cc-1c72-4c24-b8ce-925d9f93f2fb` · 27.11.2026 10:00 | Emlak A (`fe5b003c-25ee-4dae-8cb6-b1d42f58bf58`, alıcı: şube sahibi). Diğer üç şube: 0 görev, 0 bildirim |
| **Haftalık** (Pazartesi 10:00; dayanak: ÖRNEK senaryo) | 30.11.2026 10:00 · 07.12.2026 10:00 | `0bcf9613-1c56-4fa6-b417-14072623cfb0` · 30.11.2026 10:00 ve `f0fef0cf-baaf-48ff-9220-8a42d845f7fa` · 07.12.2026 10:00 | Emlak A (`ca910407-3d08-4cf8-9d2a-ce884085ee68`). Diğer üç şube: 0 görev, 0 bildirim |

Kural sürümleri: `EX-ESTATE-FILE-ONCE` v1 ve `EX-ESTATE-FILE-WEEKLY` v1, durum `published`, ÖRNEK. Şablonda saklanan sıklık: `{"freq":"once","on":"2026-11-27","at":"10:00","basis":"example_scenario"}` ve `{"freq":"weekly","weekday":1,"at":"10:00","basis":"example_scenario"}`.

## Sıfır etki ve tekrar denetimleri (her iki senaryo)
| Adım | Tek seferlik | Haftalık |
|---|---|---|
| Kuyruğa giriş, taslak, alan incelemesi, onay (yürürlükten önce) | görev 66 · bildirim 0 · yükümlülük 77 (değişmedi) | aynı |
| Yürürlük günü (kendiliğinden) | Emlak A: 1 yeni görev + 1 bildirim | Emlak A: 2 yeni görev (2 farklı vade) + 1 bildirim |
| Yeniden tarama (25.11 23:30), görev üretimi 14 gün ×2, API yeniden başlatma | sayılar aynı (görev 67 · bildirim 1 · tarama 2) | sayılar aynı (görev 68 · bildirim 1 · tarama 2) |
| 45 günlük üst pencere | kural görevi hâlâ 1 | **Haftalık kuralın gelecek dönemleri (14.12, 21.12 …) eklenir**: bu çoğalma değil ufuk uzatmadır (dönem anahtarı tekil); üretim penceresi 14 gündür |

Ham dökümler: `docs/kanit-f1-sikilik/once-sayilar.txt`, `weekly-sayilar.txt`. Ekran görüntüleri: `once-*` / `weekly-*` (10 sıklık belirsiz taslak · 11 sıklık seçildi ve önizleme · 12 alan bekliyor · 20 kuyrukta bekliyor · 21 yetkili görünüm · 25 onay ekranı · 26 zamanlandı), `same-30` (14 gün listesi).

## Yetkili ve yetki dışı hesabın gördüğü (aynı kayıt, aynı an)
- Onaylayıcı hesap, alan atanmadan önce: "consumer · kuyrukta bekliyor — tanımlı inceleyici yok… Bu hesap: yetkin yok; alanda yetkili inceleyici de tanımlı değil — bir platform yöneticisi alan ataması yapmalı." Onay düğmesi pasif; liste satırında "Kuyrukta bekliyor: …".
- Atamadan sonra, Alan uzmanı: "Tanımlı inceleyici: Alan uzmanı (demo) · **Bu alanda inceleme yetkin var**" ve Yönetim ekranında "consumer alanında onayla" düğmesi.
- Platform yöneticisi (alan yetkisi yok): "Tanımlı inceleyici: Alan uzmanı (demo) · **Bu alanda inceleme yetkin yok; yetkili: Alan uzmanı (demo)**".
- Sunucu tarafı: yetkisiz hesabın alan incelemesi 403; inceleyici yokken onay `AREA_REVIEW_MISSING` (gh15).

## Aynı başlıklı yayınlar (madde 3)
Başlık: "Tebliğde Değişiklik Yapılmasına Dair Tebliğ", üç ayrı yayın; test saati 26.11.2026 23:30 (keşif) ve 27.11.2026 23:30 (tekrar):
| Kaynak yayın kimliği | Durum | Gerekçe (özet) | Bağlantı |
|---|---|---|---|
| `rg:…-91` | KAPSAM DIŞI | metin: "Orman yangını gözetleme kulelerinin süresi…" | `…/eskiler/20261122-91.htm` |
| `rg:…-92` | KAPSAM DIŞI | metin: "Balıkçı barınaklarında ağ onarım süresi…" | `…/eskiler/20261122-92.htm` |
| `rg:…-93` | METNİ OKUNAMADI · SINIFLANDIRILAMADI | boş yanıt (0 bayt); sonraki taramada yeniden denenir | `…/eskiler/20261122-93.htm` |

Tekrar taramada satırlar aynı kaldı (4 satır: 3 aynı başlıklı + 1 eski "Orman Yangınları" yayını), işletme etkisi değişmedi (görev 110 · bildirim 1 · yükümlülük 79 · aday 5 — görev sayısı önceki adımdaki 45 günlük üst pencereden gelir). **Not:** satırdaki "N taramada" sayacı *tarama çalıştırması* sayar; metni okunamayan yayın günün taramasını "kısmi" bıraktığından zamanlayıcı aynı günü (en çok 6 kez) yeniden dener, test saati ileri olduğundan bu denemeler 30 dakika beklemeden art arda yapıldı. Satır sayısı bundan etkilenmez.

## Testler
`server/test/acceptance/gh15-frequency-areas.test.ts` (4: öneri taslağı belirsiz + alan önerisi gıda değil + kaynak sıklık cümlesi · belirsiz taslak kaydedilir ama onaylanamaz, etki 0 · tek seferlik tam 1 görev + 1 bildirim, diğer şube 0, tarama/üretim/yeniden uygulama sayıyı artırmaz · inceleyici yok → bekler, yetkisiz 403, haftalık metin), `gh16-same-title-publications.test.ts` (3: üç yayın üç satır, ayrı bağlantı/gerekçe, tekrar taramada sayı sabit, okunamayan → okunabilir), gh13'e `kafe` sözcük sınırı. Tam sunucu paketi: 575 geçti, 33 atlandı; yalnız `backup-restore` ortam değişkeni (TEST_RESTORE_*) olmadığından çalışmadı (bu işle ilgisiz, önceki gibi).

## Açık kalanlar (saklanmadı)
- Haftalık sıklığın ilk görev vadesi, yürürlük gününden sonraki ilk Pazartesi'dir; "ilk görev vadesi" tek seferlik için adminin girdiği tarihtir, tekrarlı için hesaplanır (önizleme satırı bunu yazar). Aylık sıklık için ayrı bir kabul koşulmadı (birim testi yok; şema ve görev üretici destekler).
- Ekran görüntüleri ilk ekranı gösterir (sayfa içi kaydırma görüntülenmedi); tam metin dökümü komut çıktısındadır ve `*-sayilar.txt` dosyalarındadır.
- Test ortamında platform hesapları için ek doğrulama (MFA) kapatıldı; üretimde açık kalır.
- Alan ataması için arayüz yok, operatör CLI'sidir (`admin:grant … alan:<kod>`); yönetim ekranı "atama yapılmalı" der ama atamayı buradan yapmaz. Bu bilinçli bir sınırdır.
