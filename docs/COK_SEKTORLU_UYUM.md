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

## Üçüncü dilim · GH-03 mevzuat masası ve B-13 (22 Kasım)

Zaten vardı (yeniden yazılmadı; `docs/MEVZUAT_TAKIBI.md`): günlük zamanlanmış Resmî Gazete/Mevzuat alımı, ilk okuma = taban, aynı yayın tek kayıt, kaçırılan gün tamamlama, kaynak hatası ≠ "değişiklik yok", belirsiz yürürlüğün gerekçeyle çözülmesi, eski/yeni metin yan yana, etki önizlemesi, onaylı değişikliğin yürürlük gününde yalnız kapsamdaki şubelere uygulanması, yürürlükten kaldırma.

Eksik olan ve bu dilimde eklenen:
- **Üç ayrı karar (B-13), hem durum geçişinde hem ekranda** — migrasyon `030`, `rules.ts`:
  - **İade** (`POST /admin/rule-versions/:id/return`): incelemedeki veya onaylı (yayımlanmamış) sürüm taslağa döner; önceki alan onayları sayılmaz, yeniden onay gerekir (`AREA_REVIEW_MISSING`). Yazar kendi kuralını iade edemez.
  - **Ret** (`…/reject`): gerekçeli, terminal; reddedilen sürüm yayımlanamaz, yeniden gönderilemez, iade edilemez.
  - **Geri çekme** (`…/withdraw`): yayımlanmış sürüm `withdrawn` olur. Etkilenen her şubeye gerekçeli yeni `needs_review` kararı eklenir (eskiler silinmez); ileri tarihli açık işler gerekçeyle iptal edilir; vadesi gelmiş açık işler `RULE_WITHDRAWN` ile incelemeye işaretlenir; tamamlanmış işler kaydını ve kural sürümünü korur, görev ayrıntısı kural durumunu ve gerekçeyi gösterir; yöneticilere şube/sürüm başına bir düzeltme bildirimi gider; yeni iş üretilmez.
  - Üçünde de gerekçe zorunlu ve en az 10 karakter; yönetim ekranında düğmeler gerekçe yazılana kadar pasif, "Reddedilen" ve "Geri çekilen" sekmeleri var.
- **Masa süzgeçleri:** kuyruk kaynağa, sektöre, duruma, metne (belge/madde/başlık), tarih durumuna, yürürlük aralığına ve kararı veren/taslağı hazırlayan kişiye göre süzülür (sunucuda); ekranda kaynak, arama ve "tarihi belirsiz" süzgeci var.
- Testler: `rule-lifecycle-decisions.test.ts` (7), `legislation-watch.test.ts` (+1 süzgeç testi, 17/17).

Hâlâ açık (GH-03): Resmî Gazete mükerrer sayı/ek ayrımı ayrı alan olarak tutulmuyor (yalnız `doc_ref` içinde sayı var); metin özeti/hash yalnız birleştirilmiş mevzuat belgelerinde (`legislation_documents`) saklanıyor; "geri çekmede işletmeye düzeltme bildirimi" yalnız yöneticilere gidiyor; masaüstü ekranı ayrı bir düzen değil, mevcut yönetim ekranı süzgeçle genişletildi ve tarayıcıda görülmedi; zamanlayıcı iş günlüğü kanıtı bu oturumda yeniden üretilmedi (mevcut test `legislationTick` ile sınıyor).

## Dördüncü dilim · GH-04 görev ve bildirim (22 Kasım)

Zaten vardı: yalnız atanmışı gören çalışan, şube kapsamlı yönetici, tekil/toplu atama + önizleme (sayı onayı), seri sorumlusu, yeniden atama listesi (pasif üyenin açık işleri), geciken iş bildirimi, aynı olay için tekrar bildirim üretmeyen `dedupe_key`.

Eksik olan ve eklenen (migrasyon `031`, `services/task-assignment.ts`):
- **Atama bildirimi yoktu.** Artık atanan kişi tek bildirim alır; gövde sabit sırayla **Ne değişti? / Hangi şubemi etkiliyor? / Ne zamana kadar ne yapmalıyım?** (+ gerekli kanıt) cevaplar, `meta` içinde kayıt bağlantısı (`link`) taşır. **Duyuru anı (`announcedAt`) ile görevin başlangıç günü (`startsAt`) ayrı alandır.** Görevi kaybeden kişi de bilgilendirilir. Toplu atamada şube başına tek özet bildirim.
- **Aynı sürüm tekrar gönderilmez:** durum değişmediyse (aynı kişiye aynı atama) ne geçmiş satırı ne bildirim üretilir.
- **Atama geçmişi:** `task_assignment_log` (önceki, yeni, değiştiren, tekil/seri/toplu, gerekçe); `GET tasks/:id` → `assignmentHistory`; görev ekranında "Sorumlu geçmişi". Denetim kaydına `previousAssigneeId` eklendi.
- **Listeler:** `GET /companies/:id/tasks?bucket=today|upcoming|overdue|unassigned` (sunucuda, İstanbul günü). Bugün/yaklaşan/geciken ayrık; atanmamış açık işler tarihten bağımsız ayrı liste. Uygulamada "Atanmamış" süzgeci eklendi.
- **Toplu önizleme:** şube başına en erken/en geç son tarih ve gerekli kanıt türleri (kişi ve şube adı zaten vardı).
- **Teslim ve yeniden deneme:** `notifications.delivered_at / delivery_attempts / next_attempt_at`; `deliverPending(db, channel)` başarısız gönderimi artan bekleme ile yeniden dener (en çok 5), başarıdan sonra bir daha göndermez, vazgeçince hata kayıtta kalır. Gelen kutusu teslimden bağımsızdır.
- **Okundu ≠ tamamlandı:** okumak görevi tamamlamaz, tamamlamak okunmamış bildirimi okundu yapmaz (testle).
- Test: `task-notifications.test.ts` 12/12 (kabul: yönetici atar → çalışan bildirimden gider, kanıtla tamamlar → yönetici sonucu görür; başka şubeye bildirim gitmez; çevrimdışı tekrar gönderimde tek tamamlama; atama değişince önceki/yeni kişi).

Hâlâ açık (GH-04):
- **Gerçek bir dış kanal (push / e-posta / SMS) yok.** `deliverPending` bir kanal arayüzü ve yeniden deneme mantığıdır, testte sahte kanalla sınandı; hiçbir yere bağlı değil ve zamanlayıcıdan çağrılmıyor. Kanal seçimi ürün/altyapı kararıdır.
- Teslim "en az bir kez": gönderim ile kayıt arasında süreç çökerse aynı bildirim bir kez daha gidebilir.
- Seri sorumlusu (`applyToFuture`) ve yeni üretilen görevlerin varsayılan atanması bildirim/geçmiş satırı üretmez; yalnız ilk atama olayı bildirilir.
- "Bugün/yaklaşan/geciken" mobilde hâlâ istemci tarafı gruplanıyor (aynı tanım, `features/work.ts`); sunucu süzgeci API'de var ama ekran onu kullanmıyor. Ekranlar tarayıcıda görülmedi.
- Çevrimdışı eşitleme için mevcut `offline-sync.test.ts` (5 senaryo) ve yeni idempotency testi var; gerçek cihazda sınanmadı.
- `backup-restore.test.ts` bu makinede `pg_dump` olmadığı için çalıştırılamadı (15 başarısız, hepsi `spawn pg_dump ENOENT` ve ilgili ortam hatası); yeni tablo yedek/geri yükleme kapsamında doğrulanmadı.

## Beşinci dilim · GH-02 açıklanabilir yükümlülük (22 Kasım)

Zaten vardı: `explain()` (kural, eşleşen yanıtlar, yanıtın kaynağı, karar geçmişi, dayanak hükümleri), kural sürümüne bağlı görev (eski dayanak görevde kalır), üç değerli karar (eksik yanıt asla "uygulanmaz" olmaz), zorunlu yükümlülükte gerekçeli "uygulanmaz" isteği ve ikinci kişi incelemesi, aynı dönem için tek görev.

Eklenen (`domain/explain-text.ts`, `services/obligations.ts`, `services/tasks.ts`):
- **Kullanıcı diliyle gerekçe:** `reasonText` — "Bu şubede soğukta saklanan ürün olduğunu belirttiniz." Motorun izinden (trace) üretilir, karar vermez. Eksik/onaysız yanıtta ne eksik olduğu ve "uygunluk verilmez" söylenir. Listede, açıklamada ve görev ayrıntısında (`why`) aynı metin.
- **Kuralın tanımı (`definition`):** etiket (örnek / iyi uygulama ayrı), geçerlilik koşulları cümle olarak, uygulanmama koşulu ve düzeltme yolu, yürürlük başlangıç/bitiş, kontroller (sıklık, kanıt türleri).
- **İnceleme durumu:** bekleyen "uygulanmaz" isteği varken `reviewStatus` "İnceleme sürüyor: yükümlülük geçerli, görevler devam ediyor" der; listede `reviewPending`.
- **Kaynak sürümü değişince:** görevde `basis` — görevin açıldığı kural sürümü, sonradan yayımlanan sürüm ve notu; tamamlanan işin dayanağı ve gerekçesi değişmez.
- Mobil: yükümlülük ekranında "Neden bu karar", "Kuralın tanımı", inceleme şeridi; görev ekranında gerekçe, "Yanıtı ve kaynağı aç", sürüm notu.
- Test: `explainable-obligation.test.ts` 8/8 (kural v2 yayımlanır, tamamlanan işin v1 dayanağı yerinde; OCR onaysız değer çelişince karar "bilgi eksik").

Hâlâ açık (GH-02):
- **Sorumlu rol** kural modelinde yok (`responsibleRole: null`); görevi yönetici atar. Rol alanı eklemek kural şeması + inceleme akışı kararıdır.
- **Coğrafya ve sektör** ayrı alan değil; yalnız koşul cümlelerinde (il, faaliyet) görünür. `scope` boş.
- "Kaynak sürümü" burada **kural sürümü**; yasal kaynağın (Resmî Gazete) yeni sürümüyle eski hükmün karşılaştırması GH-03 masasında, göreve bağlanmadı. Test kuralları hükme bağlı olmadığı için yeni sürüm `cites: []`.
- İşletmenin "uygulanır"a itirazı yalnız zorunlu yükümlülükte "uygulanmaz" isteği olarak var; "bilgi eksik" için ayrı bir düzeltme isteği ekranı yok (yanıtı doğrudan düzeltir).
- Çelişki tanımı: doğrulanmamış OCR değeri onaylı yanıtın yerini alınca karar "bilgi eksik" olur. İki doğrulanmış kaynağın birbiriyle çelişmesi (şube/şirket) için ayrı kural yok; şube yanıtı şirketinkini geçer.
- Ekranlar tarayıcıda görülmedi.

## Altıncı dilim · GH-05 evrak kasası (22 Kasım)

Zaten vardı: belge + sürüm + dosya, yükleyenden farklı kişi incelemesi ("yükleme geçerlilik değildir"), kurum içi inceleme ≠ düzenleyen doğrulaması, şirket belgesinin şubelere kopyasız paylaşımı (`document_shares`), kullanım bağlantıları (`document_links`: görev/ekipman/yükümlülük), bitişte tek uyarı, yenileme bekleyen sürüm geçerli saymaz, OCR önerisi + teyit, QR ve dosya erişiminin belge okuma hakkına bağlı olması.

Eklenen (migrasyon `032`, `services/documents.ts`):
- **Yeni türler:** `pest_report` (pest hizmet raporu), `signature_circular` (imza sirküleri); serbest tür `other`.
- **Saklanma amacı ≠ yükümlülüğü karşılama:** belgede `keepPurpose`; hangi yükümlülüğü karşıladığı ayrı (`satisfiesObligations`, kullanım bağlantılarından). Biri diğerini değiştirmez.
- **Üç tarih durumu:** sürümde `end_kind` = `dated` (bitişi var) / `none` (bitiş tarihi yok) / `unknown` (tarih henüz bilinmiyor). Ad veya türden süre türetilmez (testle: adında "1 yıl geçerli" yazan poliçe `unknown` kalır). Veritabanı tetikleyicisi bitiş tarihi varsa `dated` yapar; eski satırlar buna göre dolduruldu.
- **Bilgi tamamlama listesi:** `GET documents?filter=info_needed`; inceleyen tarihi yazınca veya "bitişi yok" deyince çıkar.
- **Gözden geçirme tarihi** (`review_on`) bitişten ayrı, isteğe bağlı.
- **Hatırlatma aralığı ve muhatap:** belge başına `remindDays` (1–365, varsayılan 30) ve `remindUserId`; yalnız etkin ve kapsamı kapsayan üye seçilebilir; muhatap seçiliyse uyarı yalnız ona gider, yoksa belgeyi tutanlara. Eşikte ve bitişte birer uyarı (sürüm+tarih anahtarı), tekrar taramada yenisi çıkmaz.
- **Yenileme kabulünde eski uyarı:** yeni sürüm doğrulanınca gelen kutusundaki eski uyarı "belge yenilendi" diye eski işaretlenir, yenisi için uyarı çıkmaz (testle).
- **Bitişsiz belge:** süre aşımı uyarısı üretmez (10 yıl ilerisi taramada); `POST documents/:id/archive` (gerekçeli) listeden ve hatırlatmalardan çıkarır, sürümler ve dosyalar silinmez.
- **Reddedilen son sürüm:** `latestRejection` (gerekçe görünür) ve `stillValid` (önceki doğrulanmış sürüm, kalan gün) ile `satisfiesObligations` ayrı gösterilir.
- **Yetki kalkınca:** paylaşım geri alınınca veya üyelik pasifleşince liste, ayrıntı, dosya ve QR aynı anda kapanır (testle, dördü birlikte).
- Mobil: yeni tür etiketleri, "Bilgi tamamlama" süzgeci, "Süresiz / Tarih bilinmiyor" rozetleri, ret gerekçesi, kalan geçerlilik, saklanma amacı.
- Test: `document-vault-dates.test.ts` 9/9; mevcut belge ve QR testleri değişmeden geçti.

Hâlâ açık (GH-05):
- **Yenileme görevi** görev sistemine bağlı bir iş olarak açılmıyor; yenileme bugün uyarı + süzgeçle ("yakında bitecek / doldu") yürüyor. Görev motoru kural sürümüne bağlı olduğu için belge kaynaklı görev şema kararıdır.
- **Özel evrak:** ayrı bir "yalnız şu kişiler" listesi yok; erişim rol/şube kapsamı ve şirket belgesi paylaşımıyla sınırlı. Kişi bazlı izin listesi eklemedik.
- Belgeye ait ayarlar (amaç, sorumlu, hatırlatma, gözden geçirme) API'de (`POST documents/:id/settings`) ve oluşturmada var; mobilde bunları **düzenleyen ekran yok**, yalnız gösteriliyor.
- Sorumlu kişi kaydediliyor ama ona ayrıca bildirim gitmiyor (yalnız muhatap).
- Ekranlar tarayıcıda görülmedi.

## Yedinci dilim — GH-06 GoverUp: ihtiyaçtan hizmet

- **Öneri motoru** (`GET /companies/:id/service-suggestions?siteId=`): yalnız okur; talep açmaz, işletme verisi paylaşmaz, ücrete göre sıralamaz. Her öneri okunur bir gerekçe taşır ve dayanağı türüyle gösterilir: profil (soğukta saklama + soğutucu → soğutma servisi; LPG → gaz tesisatı kontrolü), kayıt (açık soğuk zincir / gaz uygunsuzluğu → "açık kayıt var", aciliyet yükselir), belge (kayıtlı soğutucuya ait incelenmiş ve geçerli bakım raporu yok), konum (il / ilçe). Yetki: `service.request` (personel soramaz, 403).
- **Eşleşme:** onaylı ve süresi dolmamış yetkisi olan uzmanlar; her satırda onayın bitiş tarihi ve kalan gün. Onay süresi dolan uzman eşleştirilmez, **kaç uzmanın bu nedenle dışarıda kaldığı** söylenir (`leftOutExpiredApproval`).
- **Eşleşen yoksa:** `noMatch` + `openRequest` — yalnız konum ve kategoriyle açık talep önerisi; işletme adının teklif kabulüne kadar paylaşılmadığı yazılı. Talep mevcut `POST service-requests` ile açılıyor (testle, 201).
- **Şikâyet (iki taraf)** — yeni tablo `service_complaints` (033): işletme `POST companies/:id/jobs/:jobId/complaints`, uzman `POST pro/jobs/:jobId/complaints`; iş başına taraf başına bir açık şikâyet (ikincisi 409); karşı taraf bildirim alır ve `…/respond` ile yanıtlar (açan kendi şikâyetine yanıt veremez, 403); karar yalnız pazar yeri değerlendiricisinde (`POST admin/marketplace/complaints/:id/resolve`, gerekçeli, ikinci karar 409). Şikâyet **iş durumunu, rapor belgesinin incelemesini ve uygunsuzluğu değiştirmez** (testle: iş `scheduled`, `accepted_at` boş, uygunsuzluk durumu aynı). Açma, yanıt ve karar denetim zincirine yazılır (3 olay). Başka uzman veya yetkisiz personel 404.
- **Randevu / revizyon (iki taraf):** mevcut market-depth ve followthrough testleriyle kapsanıyor (öneren onaylayamaz, karşı taraf onaylar; iptal gerekçeli; revizyon sürümlü). Bu dilimde değişmedi.
- **Operasyon listeleri** (`GET admin/marketplace/operations`, yalnız pazar yeri değerlendiricisi): açık talepler, geciken randevular, revizyon bekleyen raporlar, biten/bitmek üzere (30 gün) onaylar, açık şikâyetler. Her satır **bekleyen kişi/taraf, bekleme günü, sıradaki adım ve kayda bağlantı** taşır (testle, tüm satırlarda dolu).
- Mobil: hizmet talepleri ekranında "İhtiyacına göre öneriler"; iş ayrıntısında (işletme) ve uzman işinde "Şikâyet" kartı; yönetim ekranında "Çalışma listeleri" ve şikâyeti karara bağlama.
- Test: `gh06-goverup.test.ts` 9/9. Tam sunucu paketi: 503 geçti, 33 atlandı, 1 paket ortam nedeniyle çalışmadı (`backup-restore`: geri yükleme veritabanı değişkenleri ve `pg_dump` yok).
- Elle yapılan tek veritabanı değişikliği (zaman kaydırma, test içinde yazılı): bir uzmanın onay bitişi dünün tarihine, bir randevunun başlangıcı geçmişe çekildi. Talep, teklif, kabul, bildirim, şikâyet ve rapor akışı genel API ile yürüdü.

Hâlâ açık (GH-06):
- **Öneri sinyalleri dar:** yalnız iki kategori (soğutma, gaz) haritalı. Elektrik vb. "destek kategorisi" için hangi profil/kayıt sinyalinin hangi kategoriyi önerdiği ürün kararı; eklenmedi.
- **Onay yenileme süreci** yok: biten onay için uzman yeniden başvurur, sistemde ayrı "yenileme isteği" akışı veya otomatik hatırlatma yok; liste yalnız gösterir.
- **Şikâyet** için kanıt eki, süre sınırı (yanıt gecikirse otomatik yükseltme) ve karar sonucunda uzman onayını askıya alma bağlantısı yok; karar metin olarak kalır, onay işlemi ayrı karardır.
- Operasyon listelerinden kayda tek dokunuşla geçiş yok (kayıt türü + kimlik veriliyor, ekran bağlantısı yok).
- Mobil ekranlar tarayıcıda/cihazda görülmedi; yalnız `tsc` derlemesi geçti.

## Sekizinci dilim — GH-07: cihazın düzelmesi ve ürünün akıbeti

- **Ürün değerlendirmesi** (yeni tablo `ncr_product_assessments`, 034): etkilenen ürün/parti, miktar **ya da açık "miktar bilinmiyor" işareti** (ikisi birlikte veya ikisi de boş olamaz, veritabanı kısıtı + 422), alınan ilk önlem, değerlendiren kişi (şubede etkin üye), karar, gerekçe, kanıt bağlantıları (kaydın kendi kanıtları), karar veren ve zaman. API: `POST nonconformities/:id/product-assessments`, `…/:aid/decision`. Karar: bekletme, imha, yeniden işleme, tedarikçiye iade, kullanıma uygun, ürün etkisi yok. Karar tek seferliktir (ikincisi 409), gerekçe zorunludur; değerlendirilen kişiye bildirim gider.
- **Cihaz düzeldi, ürün kararı açık kalabilir:** çalışan test: onarım, neden, etkinlik kontrolü tamam, vaka `awaiting_verification`; bağımsız doğrulayıcı kapatmayı deneyince `PRODUCT_DECISION_OPEN` (422), durum değişmez. Karar kaydedilince aynı doğrulayıcı kapatır.
- **Yetkili değerlendirme:** "ürün etkisi yok" kararını yalnız kapanışı doğrulamaya yetkili kişi verebilir ve gerekçesi en az 20 karakterdir; diğer kararları atanan değerlendirici veya kaydı yöneten yetkili verir (personel 403).
- **Ürün etkisi olmayan sektörlerde alan yok:** faaliyetinde yemek/içecek hazırlama bulunmayan şubede ayrıntıda `product: null`, kapanış eksiklerinde ürün maddesi yok, değerlendirme başlatma `PRODUCT_NOT_APPLICABLE` (422).
- **Denetim dosyası:** kapanan vakada "Cihaz / düzeltme kararı ve adımları" ile "Ürün kararı" ayrı bloklar (JSON `sequence` ve `product`, PDF'te ayrı başlıklar); ürün olayları cihaz sırasına karışmaz. Açık vakada karar açıksa "KARAR AÇIK" yazar; bilinmeyen miktar "MİKTAR BİLİNMİYOR" görünür. Denetim zincirine açılış ve karar olayları yazılır.
- Mobil: uygunsuzluk ayrıntısında "Ürün kararı" kartı (başlatma, miktar bilinmiyor işareti, karar ve gerekçe, kapatmayı engelleme notu); ürün etkisi olmayan şubede görünmez.
- Test: `gh07-product-decision.test.ts` 8/8. Tam sunucu paketi: 511 geçti, 33 atlandı, 1 paket ortam nedeniyle çalışmadı (`backup-restore`).

Hâlâ açık (GH-07) — **ürün kararı gerektiren karar noktası:**
- **Kapanış zorunluluğu şu an "değerlendirme başlatıldıysa" devreye giriyor.** Gıda şubesinde soğuk zincir vakası ürün değerlendirmesi başlatılmadan da kapanabiliyor; ekran ve ayrıntı "ürün etkilenmiş olabilir" uyarısı (`product.suggested`) veriyor ama engellemiyor. Her soğuk zincir vakasında zorunlu yapmak mevcut altı testin ve eski davranışın değişmesi demek (kapanış için ya değerlendirme ya "ürün etkisi yok" kararı gerekir). Bu ürün kararıdır; onay verilirse tek koşul değişir.
- Ürün etkisi tespiti yalnız "faaliyet: yemek/içecek hazırlama" + soğuk zincir tehlikesiyle haritalı; diğer sektörlerde ürün etkisi tanımı yazılmadı.
- Karar sonradan değiştirilemez; yanlış karar için düzeltme/sürüm akışı yok (yeniden açma vakayı açar, kararı değil).
- Kanıt bağlama yalnız mevcut kayıt kanıt kimlikleriyle; ürün fotoğrafı yüklemeyi mobil kartta sunmuyoruz.
- Değerlendiren mobilde başlatan kişi olarak atanıyor; başka kişi seçimi API'de var, ekranda yok.
- Ekranlar tarayıcıda görülmedi; yalnız `tsc` geçti.

## Bilinen sınırlar (gizlenmiyor)

- Elektrik için "destek kategorisi" (GoverUp önerisi) bağlanmadı; GH-06 yalnız soğutma ve gaz kategorilerini haritaladı.
- B-12 (320 px) ve B-16'nın EK-267 sayfa taraması tarayıcıda doğrulanmadı.

- NACE kataloğu 12 sınıflık başlangıç alt kümesi; tam TÜİK listesi ve her sınıfın hangi yükümlülüğe bağlandığı ürün/hukuk kararıdır.
- Katalog dışı kod için "inceleme" şu an denetim kaydı + "bilgi eksik" ile sınırlı; bir inceleme kuyruğu ekranı yok.
- İki ÖRNEK sektör kuralı ölçüldü (EX-COLD-CHAIN, EX-ELEC-INSTALL); diğer sektör kuralları yazılmadı.
- Fotoğraf yükleme ekran kanıtında tarayıcı dosya seçicisi sürülemediği için API ile yapıldı; ölçüm, atama ve tamamlama ekrandan yapıldı.
- Kayıt ekranında ikinci şube eklemek için ayrı bir ekran akışı denenmedi; B şubesi API ile eklendi (`POST /companies/:id/sites`).
- `npm run migrate` Windows'ta sessizce hiçbir şey yapmıyor (`import.meta.url === file://${argv[1]}` karşılaştırması `file:///C:/…` ile eşleşmez); testler `migrate()` fonksiyonunu doğrudan çağırdığı için etkilenmez.

## Ekran kanıtı

`docs/kanit-f1-cok-sektor/` — 01…08 (kayıt → faaliyet → şube soruları → A neden → atama → çalışan görünümü → tamamlama → B neden).
