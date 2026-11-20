# Canlı mevzuat takibi — nihai teslim raporu

Tarih: 18.11.2026 · Depo: `esoydemir/mobilgover` (taban dal `goverhub-mobile`) · Kanıt: `docs/kanit-nihai-teslim/`

## 1. Doğrudan cevaplar

1. **8091'de otomatik tarama açık mı?** **Evet**, `LEGISLATION_SCAN_ENABLED=1`, her gün 06:00 Europe/Istanbul. **Gerçek planlı (`trigger=schedule`) koşular:** 18.11.2026 06:01:29→06:01:31 (ok); **19.11.2026: koşu YOK** (Docker Desktop kapalıydı); 20.11.2026 18:09:04→18:09:06 (ok, geç telafi: Docker açıldığında uygulama ilk tikte çalıştırdı). Hata kaydı yok; elle koşular sayılmadı. Ayrıntı: "20.11.2026 doğrulaması". **Sonraki planlı tarama: 21.11.2026 06:00.** Ekran: http://127.0.0.1:8091/legislation (giriş: http://127.0.0.1:8091/login).
2. **Hangi resmî kaynaklar okunuyor, tabanda kaç belge var?** Mevzuat Bilgi Sistemi (mevzuat.gov.tr) **6 belge / 149 madde** (Kanun 5996: 60, Gıda Hijyeni: 31, Kayıt-Onay: 16, Hijyen Eğitimi: 14, 2014/47: 19, 2014/48: 9) ve Resmî Gazete (resmigazete.gov.tr) günlük içindekiler (son 14 gün, 149 kalem; 1 gıda belgesi okundu).
3. **Hangi gerçek yayın incelemeye girdi?** Resmî Gazete 33426 (10.11.2026) **Türk Gıda Kodeksi Peynir Tebliği (No: 2026/24)**, kayıt `cb66d445-0e07-4a76-b0a9-4fc510899baf`, durum **inceleme bekliyor**, yürürlük **belirsiz** (genel hüküm "yayımı tarihinde", geçiş hükümleri 30.04.2027). Resmî bağlantı: https://www.resmigazete.gov.tr/eskiler/2026/11/20261110-7.htm. Kuyrukta başka kayıt yok.
4. **İşletmeye onaysız hiçbir şey ulaşmadığı nasıl kanıtlandı?** 8091'de üç tarama (taban + 2 tekrar) öncesi/sonrası sayaç farkı: yalnızca `legislation_changes` (+1), `legislation_scan_runs` (+3) ve `audit_events` (+4: `legislation.detected` 1, `legislation.scanned` 3) değişti; **görev, yükümlülük, kural sürümü, kural, şablon, bildirim sayıları değişmedi**; mevzuat bağlantılı görev/bildirim/kural sürümü = 0 (`docs/kanit-nihai-teslim/8091-sayac-*.txt`). Normal günlük görev üretimi `tasks.generated` olay türüyle ve bağlı kayıt kimliğiyle ayrılır (mevzuat kaynaklı değişiklik yalnız `legislation.*` olaylarıdır). Onay/yürürlük/kapsam dışı şube davranışı gerçek PostgreSQL ile sentetik kabulde (bölüm 4).
5. **5996'daki iki ayrıştırma farkı:** (a) `MADDE 10/Ç` gerçek bir hükümdü, `Ç` harfi madde numarası desenine girmediği için atlanıyordu → **düzeltildi** + regresyon testi; (b) ikinci `GEÇİCİ MADDE 2` geçişi hüküm değil, değişiklik geçmişi tablosundaki atıf → hüküm sayılmıyor, belgelendi. Sonuç: 61 "MADDE" geçişi = 60 hüküm + 1 tablo atfı. İzlenen yedi madde (22, 24, 29, 30, 31, 32, 36) metinle eşleşti.
6. **Bekleyen uzman kararları ve gerçek kayıtları:** dokuzu da bekliyor (hiçbiri verilmedi). Karar kayıtları: Peynir Tebliği http://127.0.0.1:8091/legislation/cb66d445-0e07-4a76-b0a9-4fc510899baf; yayımlanmamış, kaynaklı taslaklar MV-P01 http://127.0.0.1:8091/rule/1a8dfc2a-0f60-4c5a-b67f-3b653914cf02 · MV-P02 http://127.0.0.1:8091/rule/4740c702-8a7b-427d-a32f-339e8b4c4cb5 · MV-P03 http://127.0.0.1:8091/rule/18d6f9bc-71f4-4e4d-a92d-1dbb95589809 · MV-P04 http://127.0.0.1:8091/rule/c36f4728-6b82-4317-825d-29f47bffe4fa · MV-P05 http://127.0.0.1:8091/rule/bfab895b-eb15-422e-840c-3f15c12354e4 · MV-P06 http://127.0.0.1:8091/rule/f025e495-6923-4d0f-8ed3-17e06562e328. Soru→kayıt eşlemesi `docs/MEVZUAT_UZMAN_KARAR_PAKETI.md` başında (7. soru bilgi amaçlı, uygulamada kayıt yok).
7. **Son commit, CI, yedek, kanıt:** bölüm 2.

## 2. PR, CI, sürüm, yedek

| İş | PR | Birleştirme commit'i | CI (3/3 yeşil) |
|---|---|---|---|
| Canlı takip altyapısı | [#7](https://github.com/esoydemir/mobilgover/pull/7) | `95ae081` | [çalışma](https://github.com/esoydemir/mobilgover/actions/runs/44188769646) |
| 5996 `10/Ç`, yürürlük ayrıntısı, kesinti telafisi, kapsam dışı şube testi | [#8](https://github.com/esoydemir/mobilgover/pull/8) | `bb20000` | [çalışma](https://github.com/esoydemir/mobilgover/actions/runs/44193506066) (son commit `b65745e`) |
| "Sıradaki planlı tarama" düzeltmesi | [#9](https://github.com/esoydemir/mobilgover/pull/9) | `7ec0d9d` | [çalışma](https://github.com/esoydemir/mobilgover/actions/runs/44194413794) |
| Kapsam maddesi seçimi, nihai rapor ve kanıtlar | [#10](https://github.com/esoydemir/mobilgover/pull/10) | `bc055c3` | [çalışma](https://github.com/esoydemir/mobilgover/actions/runs/44197156133) |
| Nihai işletim doğrulaması (yalnız doküman + kanıt; kod değişmedi) | #11 | — | PR sayfasında |
| Yürürlük tarihi kapısı + kaçırılan gün uyarısı | [#12](https://github.com/esoydemir/mobilgover/pull/12) | `61c8d2f` | [çalışma](https://github.com/esoydemir/mobilgover/actions/runs/44762013787) (son commit `baba60b`) |

- **8091 çalışan sürüm (20.11.2026):** `61c8d2f` (= GitHub `goverhub-mobile` ucu; PR #12 birleşmesi, migrasyon 027 uygulandı, sağlık 200). Önceki: `bc055c3` (18.11.2026 doğrulaması; PR #11 yalnız dokümandı). Güncelleme öncesi doğrulanmış yedek: `veri/8091-yedek-gate-oncesi-20261120-182127.dump` (SHA-256 `89a74a4e846b65d4c88841fbe09a6236149df82bd1bf0342c8365d9de4945855`, ayrı veritabanına geri yüklendi, tüm tablo sayıları eşit). Güncelleme sonrası sayaç farkı yok (kayıtlar korundu: `8091-sayac-gate-oncesi/sonrasi.txt`). 8080'e dokunulmadı.
- **Yedek:** `C:\dev\goverhub-pilot\veri\8091-yedek-nihai-oncesi-20261118-014622.dump` (SHA-256 `423bf42b65612b3f5fc6fccddf1a5701f984bfb9a9b4e4bb1fb13eff67d0cd86`), ayrı veritabanına geri yüklenip **79 tablonun tamamının satır sayısı eşit** doğrulandı (`veri/sayac-8091-nihai-once.txt` = `…-yedekten.txt`). Önceki yedek: `8091-yedek-pr7-oncesi-*.dump`.
- **8091 yapılandırması** (yerel, depo dışı): `C:\dev\goverhub-pilot\ortam\pilotfix-override.yaml` → `LEGISLATION_SCAN_ENABLED: "1"`, `LEGISLATION_SCAN_HOUR: "6"`, `LEGISLATION_LOOKBACK_DAYS: "14"` (kayıt anahtarı tekrarı engeller). Kaynak adresleri boş = resmî adresler. Güvenli duruma dönmek: `"0"` yapıp uygulama kapsayıcısını yeniden oluştur.

## 3. Canlı 8091 sonuçları (gerçek resmî kaynak) — sentetik kabulden ayrı

| Adım | Sonuç |
|---|---|
| Başlangıç | 8091 migrasyon 026, tarama kapalı, kaynak/kayıt boş; yedek + geri yükleme doğrulandı |
| İzole canlı koşu (aynı sürüm, boş veritabanı) | `canli-gozlem-nihai.json`: iki kaynak 200; 1. tarama 6 belge/149 madde taban + 1 Resmî Gazete kaydı; 2. tarama 0 kopya |
| 8091 1. tarama (elle, 02:01) | Mevzuat taban: 6 belge, 149 madde, 0 kayıt. Resmî Gazete (3 günlük pencere): 35 kalem, 0 belge |
| Pencere 14 güne alındı, 2. tarama | Peynir Tebliği kuyruğa **1 kayıt**; 3. tarama **0 kopya** |
| Yönetici ekranı | Son başarılı tarama, sıradaki planlı tarama (06:00), "ilk okuma yalnız taban" notu, kaynak kartları (okunan belge 6 / 1, taranan kalem 149, kuyruk 0 / 1 açık, hata yok), bekleyen 1, tarihi belirsiz 1 |
| Kayıt ayrıntısı | Genel hüküm (md. 22), geçiş hükümleri (geçici md. 1: 4 fıkra, 30.04.2027), kapsam ayrı alanlarda; resmî bağlantı; "tek geçiş tarihi tüm işletmelere uygulanmaz" uyarısı |
| Onaysız yazım yok | bölüm 1, madde 4 |
| Durdur / yeniden aç | Kapatıldı → tarama geçmişi 3, kayıt 1, kaynak 2, mevzuat denetim olayı 4; yeniden açıldı → aynı sayılar (silinmedi) (`8091-durdur-yeniden-ac.txt`) |
| Planlı koşu (gerçek 8091) | **Çalıştı:** `schedule`, 18.11.2026 06:01:29→06:01:31 (+03:00), `ok`, hata yok, yeni kayıt 0, kopya 0 (`8091-tarama-kosulari.txt`). Sonraki: 19.11.2026 06:00 |
| Gerçek değişiklik | Yalnız bu yeni yayın gözlendi; **mevcut bir Mevzuat maddesinde gerçek değişiklik gözlenmedi** (bu tabana ilk okuma) |

### Zamanlayıcının kendiliğinden çalıştığının ayrı kanıtı
- Otomatik test (`legislation-live-readiness.test.ts`, 12 test, gerçek zamanlayıcı): kendiliğinden çalışır, günde bir kez, saatten önce çalışmaz, kaynak hata türleri, kurtarma, yeniden başlatma, makine kapalıyken kaçırılan aralık.
- Gerçek süreç, izole ortam 8098 (sürüm 8091 ile aynı, sentetik kaynak): saat bugüne ayarlanıp uygulama yeniden başlatıldı; **elle tetikleme olmadan** ~30 sn sonra `trigger=schedule` koşusu `ok`; ikinci yeniden başlatmada ikinci koşu/kopya yok (`zamanlayici-8098.txt`).

### Makine/Docker kapalıyken davranış
- Kapsayıcılar `restart: unless-stopped`; makine açılınca otomatik kalkar. Zamanlayıcı 10 dakikada bir bakar; saat ≥ 06:00 ve o gün başarılı planlı koşu yoksa çalışır (kaçırılan saat, makine açıldığında telafi edilir).
- Resmî Gazete taraması son sağlıklı okumadan bu yana geçen günleri kapsayacak şekilde geriye uzar (en çok 30 gün) ve ekrana "Kaçırılan aralık telafi edildi / UYARI" notu düşer; 30 günden uzun kesintide uyarı ekrandadır, atlanan gün sessizce geçmez.
- Aynı gün elle + planlı çakışma tek kayıt üretir (testle doğrulandı).

### 18.11.2026 akşam işletim doğrulaması (planlı koşu sonrası)
- Ekran http://127.0.0.1:8091/legislation gerçek kayıtlarla eşleşti: son başarılı tarama 18/11 06:01 (`schedule`), sıradaki 19/11 06:00, Mevzuat 6 belge/149 madde/kuyruk 0, Resmî Gazete 1 belge/149 kalem/kuyruk 1 açık, hata yok, bekleyen 1, tarihi belirsiz 1; kayıt ayrıntısı ve resmî bağlantı açıldı (`8091-legislation-ekrani.png`, `8091-kayit-ayrinti.png`).
- Onay olmadan yazım yok: elle ilk taramadan planlı koşuya kadar yükümlülük, kural, kural sürümü (mevzuat bağlantılı) ve mevzuat bildirimi değişmedi; mevzuat bağlantılı bildirim 0. Aralıkta +91 bildirim **normal görev işçisinin** `tasks_overdue` bildirimleridir (kayıt 18.11 00:20Z, `site_tasks` varlığı; mevzuat kaynaklı değil); mevzuat denetim olayları yalnız `legislation.detected` (1) ve `legislation.scanned` (4). Kural taslakları eklendikten sonra yalnız `rules`/`rule_versions`/`task_templates` (+6, durum `draft`) ve `rule.drafted` olayları arttı; görev/bildirim üretilmedi (`8091-sayac-taslak-sonrasi.txt`).

### 20.11.2026 doğrulaması: planlı koşular, kapalı makine, yürürlük tarihi kapısı
- **19 ve 20 Kasım koşuları (veritabanı, `8091-planli-kosular-20kasim.txt`):** 19.11 için `schedule` kaydı yok. **Neden:** Docker Desktop 19–20.11 boyunca çalışmıyordu (kapsayıcılar çalışmadığından 06:00'da zamanlayıcı da yoktu; makine açıktı, Docker kapalıydı). Hata değil, kesinti: yazılacak başarısız koşu satırı oluşmaz. 20.11'de Docker elle açıldı; uygulama kalkınca ilk tikte (hour ≥ 06:00, o gün planlı başarılı koşu yok) `schedule` koşusu çalıştı: 18:09:04→18:09:06, `ok`, Resmî Gazete 144 kalem/1 belge, Mevzuat 6 belge/149 madde, yeni kayıt 0, kopya 0. Resmî Gazete penceresi 14 gün olduğundan 19.11'de yayımlanan olası belge de bu okumada kapsandı (aradaki gün bilgi kaybı yok). Yeniden başlatmada ikinci koşu/kopya oluşmadı.
- **Gideren/yapılan:** kaçırılan gün artık yönetici ekranında uyarı olarak görünür ("Planlı tarama çalışmayan gün(ler): 19.11.2026") ve `overview.schedule.missedDays` olarak döner (birim testli). Docker Desktop'ın oturum açılışında kendiliğinden başlaması makine/Docker ayarıdır; değiştirilmedi. Açık kalan koşul: Docker kapalıysa planlı koşu olmaz; ilk açılışta telafi edilir.
- **Altı taslağın yer tutucu tarihi:** MV-P01…MV-P06'nın hepsi `2026-12-01` (yer tutucu, `draft`, `effectivePlaceholder=true`). Bu tarih artık kendiliğinden kabul edilmez.
- **Yürürlük tarihi kapısı (PR #12):** örnek olmayan kural için yetkili inceleyici/yönetici `POST /admin/rule-versions/:id/confirm-effective` ile gerçek tarihi ve dayanağını (≥15 karakter: belge/madde/bağlantı) yazmadan **incelemeye gönderme, onay ve yayın** `EFFECTIVE_NOT_CONFIRMED` (409) ile reddedilir. Tarih ve dayanak istekten gelir, varsayılan yok; yazar belirleyemez (403); boş dayanak/eksik veya biçimsiz tarih 422; inceleme başlayınca tarih veritabanı korumasıyla kilitlidir; taslakta tarih değişirse onay geri çekilir. Denetim: `rule.effective_confirmed` (kim, ne zaman, tarih, dayanak, önceki yer tutucu). Kural ekranında yer tutucu uyarısı ve belirleme formu var. Mevzuat akışı (kendi gerekçeli tarih çözümü) bu kapıyı kullanmaz.
- **Test (yayımlamadan):** otomatik `rule-effective-gate.test.ts` (4 test: yer tutucu → submit reddi; zorla incelemeye alınsa da onay reddi; yazar/eksik/kısa dayanak reddi; tarih+dayanak sonrası onay ve denetim izi; kilit; tarih düzenleyince geri çekme). Canlı 8091'de altı taslağa karşı (`8091-yururluk-kapisi.json`): altısı `draft` + yer tutucu; MV-P01 için incelemeye gönderme 409 `EFFECTIVE_NOT_CONFIRMED`, yazar onayı 403, boş dayanak 422, tarihsiz 422; sonrasında taslak değişmedi, hiçbir kural onaylanmadı/yayımlanmadı, görev/bildirim/kural sürümü sayıları aynı. **Altı taslağın gerçek tarihleri belirlenmedi** — bu yetkili kişinin kararı (aşağıda).
- **Yetkili kişi için işlem:** http://127.0.0.1:8091/rule/<taslak kimliği> (kimlikler üstte) → "Yürürlük tarihini ve dayanağını sen belirle" → tarih + dayanak → kaydet; ardından yazar incelemeye gönderir, alan uzmanı inceler, onaylayıcı gerekçeyle onaylar.

## 4. Sentetik kabul (gerçek PostgreSQL, sentetik kaynak) — canlı sonuçlardan ayrı

- **Sunucu paketi:** gerçek PostgreSQL ile tamam (bölüm 6'daki sayılar); CI 3/3 yeşil.
- **Tarayıcı kabulü** (izole 8098, ayrı oturumlar: yazar, alan uzmanı, onaylayıcı, platform yöneticisi, işletme sahibi, şube personeli): **51 geçti, 0 kaldı** (`kabul-kanit.json`).
- Kontroller: zamanlayıcı yayını kuyruğa alır, taban/tekrar kopya üretmez · yetkisiz kullanıcı, boş gerekçe ve çözülmemiş tarih yayını engeller; reddedilen kayıt işletmeye ulaşmaz · gelecek tarihli onay erken uygulanmaz; saat ilerletilince yalnız eşleşen şube **tek** görev ve **tek** bildirim alır; **kapsam dışı şubenin ayrı oturumu** bildirim/görünüm almaz (yeni test) · kaldırma: açık görevler onaylı karara göre, tamamlanan görev/kanıt eski sürümde kalır · elle+planlı çakışma, kaynak kapanma/dönüş, yeniden başlatma kopya üretmez; başarısız okuma son sağlıklı metni bozmaz · işletme bildirimi doğru şube/kural/görev/termin/resmî dayanağı açar.
- Sınır: tarayıcıda saat ilerletilemez; yürürlük günü ilerletmesi enjekte saatli otomatik testtedir.

## 5. Bu çalışmada eklenenler

- 5996 `10/Ç` ayrıştırma düzeltmesi (+ test); kapsam maddesi ("Kapsam" başlığı bir önceki maddenin sonuna yapışır → sonraki madde) doğru seçiliyor.
- Resmî Gazete kayıtlarında **yürürlük ayrıntısı** ayrı alanlar: genel hüküm / geçiş tarihleri / kapsam. Uygulanabilirlik hükmü verilmez.
- Kesinti telafisi (geriye dönük pencere) + uyarı notları.
- Yönetici ekranı: sıradaki planlı tarama, "ilk okuma = taban" notu, yürürlük ayrıntısı blokları.
- Envanter (altı kayıt doğrulama tablosu) ve dokuz soruluk karar paketi.

## 6. Test sayıları

Sunucu (gerçek PostgreSQL, yedek-geri yükleme yerelde hariç, CI'da koşar): 424 test geçti, 4 atlandı (PR #12 öncesi 419); mobil + sunucu `tsc` temiz; tarayıcı kabulü 51/51 (18.11).

## 7. Açık bırakılanlar (gizli boşluk yok)

- Gerçek planlı koşu tamamlandı (bölüm 3). Henüz gerçekleşmeyen: 19.11.2026 06:00 koşusu.
- Dokuz uzman kararı bekliyor; kararlar kaynak okumayı/kuyruğa almayı engellemez.
- Gıda Hijyeni, Hijyen Eğitimi, 2014/47-48'de okunan metinde değişiklik işareti yoktur; bu "değişmedi" kanıtı değildir.
- Rehber PDF'i (E-07) izlenmez; dezenfektan yönetmeliği künyesi (E-08) doğrulanamadığı için kaynak bağlanmadı.
- 8080'deki demo ve üretim ortamına dokunulmadı; gerçek işletmeye kural yayımlanmadı.

## 8. Kanıt dosyaları

`docs/kanit-nihai-teslim/` (8091 özet/tarama/sayaç/durdur-aç, canlı gözlem, zamanlayıcı, tarayıcı kabul JSON + ekran görüntüleri) · `docs/MEVZUAT_IZLEME_ENVANTERI.md` · `docs/MEVZUAT_UZMAN_KARAR_PAKETI.md` · `docs/MEVZUAT_TAKIBI.md` (canlı geçiş rehberi) · `docs/kanit-canli/`, `docs/kanit-mevzuat-canli-gecis/` (önceki aşama).
