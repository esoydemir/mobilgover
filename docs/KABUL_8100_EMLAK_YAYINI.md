# PR #22 son kabul — 8100, izole sentetik kaynak (23 Kasım)

Tüm yayınlar, kurallar, işletmeler SENTETİK / ÖRNEKTİR (`sentetik.test`). Hiçbir yere dağıtım yapılmadı (8091 dahil), gerçek kural yayımlanmadı. B-04/B-06/B-09 için tanım yok, işlenmedi. Önceki CI günlüğü (1fc1e98): 594 test geçti, 4 atlandı, `backup-restore` 29/29.

## Yöntem (test ortamına özgü, kayıtlı)
`server/scripts/synthetic-legislation-env.ts`, `SYNTH_SCHEDULER=1` ile **gerçek günlük zamanlayıcıyı** (`startLegislationScheduler`, 10 sn'de bir kontrol) çalıştırır; "Şimdi tara" düğmesine basılmadı.
- **Tarama saati:** `SYNTH_SCAN_HOUR=23`. Gerçek saat gece 00:xx olduğundan zamanlayıcı hiçbir şey taramadı (yayın dosyası yazıldıktan 12 sn sonra kuyruk 0 kaldı).
- **Test saati:** `SYNTH_CLOCK_FILE` içinde `{"offsetMs": n}`; yalnız ZAMANLAYICININ "şimdi"si gerçek saat + n. HTTP istekleri (giriş, onay) gerçek saatle çalışır. 1. adım: saat 23.11 23:30'a alındı → zamanlayıcı taramayı kendisi yaptı. 2. adım (yürürlük): saat 25.11 23:30'a alındı → zamanlayıcı "yürürlüğü gelen" değişikliği uyguladı ve o günün planlı taramasını yaptı.
- **Yayın:** `SYNTH_PUBLISH_FILE` içine yazılan yayın, kaynağa gerçek günün Resmî Gazete'si olarak eklenir (çalışan süreç, 2 sn'de bir okur).
- Bu bir **zaman kaydırmasıdır**: 25.11 tarihli görev ve bildirim gerçek tarihte gerçekleşmiş iş değildir; test saati kaydırılmıştır. Ek olarak `topup-window.ts` (görev üretimini tekrar çalıştırma) test saatiyle (3. argüman) ve üretim penceresiyle (14 gün) çalıştırıldı.

## Madde 1–3 — emlak yayınının baştan sona izlenmesi

Yayın: "Sentetik Gayrimenkul Aracılık Hizmetlerinde Yetki Sözleşmesi Saklama Yönetmeliği" (doğal başlık; gıda sözcüğü yok), yürürlük metinde 25/11/2026.

| Halka | Kimlik |
|---|---|
| Kaynak yayın | `rg:20261122-21` · `https://sentetik.test/rg/eskiler/20261122-21.htm` · yayın 23.11.2026 · yürürlük 25.11.2026 |
| Aday (kuyruk kaydı) | `7b55bd8b-5703-49bb-9555-ce1310fdd169` (aynı başlıkta tek kayıt; planlı tarama + yürürlük günü taraması + elle tarama sonrası da 1) |
| Onay | Ürün sahibi / kural onaylayıcı (demo); gerekçe: "Resmî kaynak (sentetik) okundu; yürürlük 25.11.2026; kapsam: yetki sözleşmesi yapan emlak şubeleri…"; yazar ve alan uzmanı ayrı hesap |
| Kural sürümü | `EX-ESTATE-CONTRACT-KEEP` v1, `9a2fef18-22dc-40fd-9ea8-ee0cbbcc0c9b`, durum `published` |
| Şube | Emlak A — sözleşmeli portföy `db668c5b-9d39-41d7-8b32-44e284c59493` (koşul: aracılık = evet, müşteri adına sözleşme tutma = evet) |
| Görev | `faa3e45d-ceb6-4c46-8d8c-743a7788fd25` (vade 30.11 10:00) ve `270675be-8331-4a54-8bf7-d52a416bf55d` (vade 07.12 10:00) — haftalık kural, iki FARKLI dönem; aynı döneme ikinci kayıt yok |
| Bildirim | `d4946617-d9f4-4bee-b885-296889941ff4` (alıcı: şube sahibi; 1 adet) |
| Denetim zinciri | detected › proposal_saved › drafted › approved › applied › applied_to_company |

**Önce / sonra (şube başına görev · bildirim · yükümlülük).** Emlak A: 1·0·14 → 3·1·15 (kural görevleri 2). Emlak B (sözleşmesiz): 0·0·15 → 0·0·15. Market: 0·0·13 → 0·0·13. Elektrikçi: 0·0·13 → 0·0·13. Onay ekranında etki önizlemesi: 25.11.2026 günü 1 şube etkilenir, 1 şubeye bildirim, 5 şube kapsam dışı. Kuyruğa girişte, taslak hazırlandığında, alan incelemesinden ve onaydan sonra yürürlükten önce toplam görev/bildirim/yükümlülük değişmedi.

**Tekrar.** Yürürlük günü planlı tarama: kuyruğa yeni 0, aday sayısı değişmedi. Görev üretimi iki kez daha çalıştırıldı (14 gün): 0 yeni görev; bildirim 1 kaldı.

**Çalışan.** Şube sahibi bildirimden "Mevzuat değişikliği" ekranına girer (ne değişti, neden benim şubemde uygulanıyor, şube bilgilerim, ne yapmalısın). Görevi çalışana atar; çalışan "Yeni görev: Yetki sözleşmesi dosyalarını gözden geçir" bildirimine dokunur ve doğru göreve (`/task/faa3e45d…`) girer: "Neden gerekli", "Faaliyetiniz emlak / aracılık olarak kayıtlı. Müşteri adına sözleşme ve yetki belgesi dosyası tuttuğunuzu belirttiniz.", kaynak yayın, yapılacak iş.
**Önemli:** mevzuat bildirimi yalnız sahip / merkez yönetici / şube yöneticisine gider; çalışan, atama bildirimiyle haberdar olur. Bu tasarım gereği böyledir.

**Bulunan ve açık kalan.** (a) Taslak formunda tekrar sıklığı alanı yok; iskelet "haftalık" üretir, bu yüzden 14 günlük pencerede 2 farklı dönemin görevi oluştu (tek görev değil). (b) Taslağın inceleme alanı iskelette `food_safety` gelir; emlak/elektrik için alan tanımı yok (`good_practice` mevcut ama uzman o alana atanmamış). (c) NACE'si onaylı olmayan eski demo kafe, yeni kuralda "bilgi eksik" görünüyordu (türetilmiş `activity.brokerage` bilgisi yok); kafenin faaliyeti ekrandan onaylanınca (56.30) önizleme 3 → 1 şubeye indi. Gerçek işletmelerde faaliyet kayıtta onaylanır.

## Madde 4 — "Tebliğde Değişiklik Yapılmasına Dair Tebliğ"

Başlık yalnız bu; metinde "gayrimenkul aracılık hizmeti" geçiyor.
- **Bugünkü (düzeltmeden önce) sınıf:** BELİRSİZ — ama YANLIŞ NEDENLE. "Değişiklik **Yapı**lmasına" içindeki "Yapı", genel sözcük ("yapı") sayıldı; ekranda "Başlıkta yalnız genel bir ifade var ("Yapı")" yazıyordu. Metin hiç okunmuyordu. Kanıt: `docs/kanit-f1-mevzuat/30-once-masa.png`, `31-once-tebligi-ayrinti.png`.
- **Adminin bulma yolu (önce):** kuyruktaki "belirsiz" kaydı. Sözcük eşleşmesi tesadüfen çalışmasaydı kayıt "kapsam dışı" olacaktı; kapsam dışı kayıtlar YALNIZ son taramanın aşama kartında ve teknik günlükte görünüyordu, bir sonraki tarama kartı değiştirince kayboluyordu → görünür bir inceleme eksiği.
- **Düzeltme:** (1) genel sözcükler yalnız sözcük başında eşleşir; (2) başlığı "değişiklik/kaldırmaya dair" olan ve başlıkta iş kolu geçmeyen yayın için METİN okunur: iş kolu sözcüğü varsa BELİRSİZ + metindeki sözcük ve iş kolu kayıtlı ("METİNDE: EMLAK"), yoksa kapsam dışı; (3) kapsam dışı sayılanlar yönetici ekranında "Kapsam dışı sayılan yayınlar · son 14 gün" kartında kalıcı listelenir (ilk/son gün, kaç taramada).
- **Sonra:** `rg:20261123-23` (metinde gayrimenkul) → `3d746ac9-49e3-45e3-a6cd-b62d032d06b2`, belirsiz, neden: "metinde "Gayrimenkul" (Emlak ofisi) geçiyor". `rg:20261123-24` (metinde orman) → kuyruğa girmedi; kapsam dışı kartında, nedeniyle listelenir. Eski yanlış nedenli kayıt `5b60c165…` yöneticice gerekçeyle reddedildi. Kanıt: `60-tebligi-yeni-sinif-masa.png`, `61-tebligi-yeni-ayrinti.png`.
- **Kalan sınır:** kapsam dışı listesi başlığa göre tekilleştirilir (aynı başlıklı iki farklı yayın tek satır olur); metin eşleşmesi yalnız üç iş koluna bakar.

## Ekran kanıtı
`docs/kanit-f1-mevzuat/` 40–44 (kaynak/yürürlük, öneri ve etki önizlemesi, alan incelemesi, onay, zamanlandı), 50–53 (sahip bildirimi, değişiklik ekranı, çalışan bildirimi, çalışan görevi), 30–31 ve 60–61 (genel başlıklı tebliğ).
