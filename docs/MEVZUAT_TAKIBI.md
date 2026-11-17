# Günlük mevzuat takibi ve admin onaylı uygulama

Bu belge, Resmî Gazete ve Mevzuat Bilgi Sistemi'ni her gün tarayıp değişiklikleri **admin onayından geçirerek** kurallara dönüştüren akışı anlatır. İlk kapsam: kafe/restoran gıda güvenliği. Tarama **hiçbir kuralı ya da işletmeyi kendiliğinden değiştirmez**; yalnız öneri üretir.

> Örnek kurallar ve sentetik kaynaktan gelen kayıtlar **ÖRNEKTİR**: gerçek ya da uzman onaylı mevzuat olarak yayımlanmaz. Ceza tutarı uydurulmaz.

## Akış

1. **Tarama** (`server/src/services/legislation.ts`, bağlayıcılar `legislation-sources.ts`): her gün Europe/Istanbul saatiyle `LEGISLATION_SCAN_HOUR` (öntanımlı 06:00) sonrasında bir kez; başarısızsa yarım saat arayla en çok 6 deneme. Yönetim ekranındaki **Şimdi tara** düğmesi (platform yöneticisi / kural inceleyici) elle tarar. Aynı anda iki tarama çalışmaz (veritabanı kilidi).
2. **Kuyruk** (`legislation_changes`): yeni yayın, madde değişikliği, yürürlükten kaldırma. Kaynak bağlantısı, belge ve madde kimliği, eski/yeni metin, yayın tarihi ve yürürlük tarihi ayrı alanlardır. Aynı yayın `(kaynak, dış anahtar)` ile tekrar yazılmaz.
3. **Yürürlük tarihi**: yalnız "yayımı tarihinde" ya da tek açık tarih **bilinen** sayılır. Kademeli, çok tarihli ya da bulunamayan tarih **belirsiz** kalır; yönetici gerekçeyle çözene kadar taslak hazırlanamaz, onaylanamaz, uygulanamaz.
4. **İnceleme**: eski/yeni metin yan yana; değişiklik türü, resmî kaynak, önerilen kural değişikliği ve etkilenecek işletme/şube önizlemesi tek kayıtta. Otomatik metin karşılaştırması (eklenen/çıkan sözcük, değişen sayı) yalnız **öneridir**. Kural yazarı öneriyi düzenler; yazar taslağı hazırlar (mevcut kural sürümü akışı), alan uzmanı inceler, **yazar olmayan** kural inceleyici **zorunlu gerekçeyle** onaylar veya gerekçeyle reddeder.
5. **Uygulama**: onaydan sonra yürürlük gününde (geçmiş tarihliyse onayda) kural sürümü yayımlanır; yalnız kapsamdaki şubeler mevcut kural motoruyla yeniden değerlendirilir, görev ve bildirim **bir kez** üretilir (`legislation:<kayıt>:<şube>` tekilleştirme anahtarı). Kapsam dışı şubeye satır yazılmaz.
6. **Yürürlükten kaldırma**: yeni bir kural sürümü `effective_to = kaldırma günü − 1` ile yayımlanır; motor süresi dolan kuralı `not_applicable` sayar, **açık** görevler iptal/kaçırıldı olur, tamamlanmış görev/ölçüm/kanıt kendi kural sürümüne bağlı kalır.
7. **İşletme ekranı**: bildirimden açılan tek ekran: ne değişti · neden benim şubemde (eşleşen bilgiler) · ne yapmalıyım ve son tarih · kaynak ve geçerli kural sürümü (`/change/:id`).

## Kaynaklar

| Kaynak | Adres | Bağlayıcı |
| --- | --- | --- |
| Resmî Gazete | `https://www.resmigazete.gov.tr/fihrist?tarih=YYYY-AA-GG` + belge sayfaları | Günlük fihrist okunur; başlığı gıda güvenliğiyle ilgili olanların madde ve yürürlük hükmü ayrıştırılır (üniversite/merkez yönetmelikleri dışarıda). |
| Mevzuat Bilgi Sistemi | `https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?...` | İzleme listesindeki mevzuatın birleştirilmiş metni okunur. İlk okuma **taban**dır (değişiklik üretmez); sonraki okumalarda madde bazında fark çıkarılır. |

Kaynak adresi resmî sunucu adı değilse (deneme/sentetik) o kaynaktan gelen **her kayıt ÖRNEK** sayılır; gerçek kural olarak yayımlanamaz ve yalnız demo ortamında onaylanabilir.

## Ayarlar (ortam değişkenleri)

`LEGISLATION_SCAN_ENABLED` (`1` ile günlük tarama; öntanımlı `0`), `LEGISLATION_SCAN_HOUR`, `LEGISLATION_RG_BASE`, `LEGISLATION_MEVZUAT_BASE`, `LEGISLATION_MEVZUAT_WATCH` (`tür:no:tertip:ad,…`), `LEGISLATION_LOOKBACK_DAYS` (öntanımlı 3). Pilot demo kurulumunda otomatik tarama kapalıdır.

## Hata ve dayanıklılık

Kaynak ulaşılamazsa hata kaynak bazında kaydedilir (yönetim ekranında görünür), istek 3 kez denenir, **son başarılı veri korunur**, kaynak geri gelince bir sonraki taramada kendiliğinden toparlanır. Kaynaktan tek madde kaybolursa değil, yalnız metin okunabildiğinde "kaldırıldı" sayılır.

## Bilinen sınırlar (açık işler)

- Mevzuat Bilgi Sistemi'nin arama ucu betikle sürülemedi; izleme listesi **elle** verilir (öntanımlı: 5996 sayılı Kanun). Yönetmelik numaraları uzman tarafından listeye eklenmelidir.
- Yürürlük tarihi ayrıştırıcısı yalnız açık kalıpları "bilinen" sayar; gerisini yöneticiye bırakır (bilerek temkinli).
- Gerçek mevzuatın kural olarak yayımlanması uzman onayına bağlıdır; bu iş kural içeriği üretmez.
