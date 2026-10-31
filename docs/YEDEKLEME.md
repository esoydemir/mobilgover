# Yedekleme, geri yükleme ve hedefler

## 1. Hedefler ve ölçüm sonucu

Hedefler senden: en fazla 1 saat veri kaybı (RPO), 4 saatte geri dönüş (RTO), şifreli yedek, uygulama sunucusundan ayrı konum, başarısızlıkta bildirim.

| Hedef | Önceki yöntem (format 1) | Şimdiki yöntem (format 2) | Durum |
|---|---|---|---|
| **En fazla 1 saat veri kaybı** | Karşılamıyordu: zamanlama yoktu, yedek elle alınıyordu | Saatlik çalıştırmada en kötü durum 60 dk + çalışma süresi. Ölçülen çalışma süresi ~7 sn, yani en kötü durum 60 dk 7 sn. **30 dakikada bir çalıştırılırsa en kötü durum ~30 dk.** | **30 dk aralıkla karşılanır** (saatlik aralık sınırı birkaç saniye aşar) |
| **4 saatte geri dönüş** | Ölçülmemişti | Verinin geri yüklenmesi ölçüldü: **40 sn** (2,1 GB kanıt + 44 MB veritabanı, yerel disk). Ağ aktarımı eklenince: 2,2 GB, 100 Mbit/sn'de ~3 dk, 20 Mbit/sn'de ~15 dk. | **Veri kısmı rahatça karşılanıyor.** Yeni sunucunun kurulması (makine, PostgreSQL, uygulama, DNS) barındırma seçilmeden ölçülemez; tam tatbikat orada yapılmalı. |
| **Şifreli yedek** | Yoktu | AES-256-GCM, sunucuda şifreleniyor; hedefe yalnızca şifreli nesne gidiyor. Nesne adı da doğrulanıyor. | **Karşılanıyor** (test edildi) |
| **Sunucudan ayrı konum** | Aynı makinede klasördü | Hedef ayrı bir konum olarak tanımlanıyor; uygulama verisinin içinde bir hedef reddediliyor. | **Yöntem hazır.** Gerçek ayrı konum barındırma kararını bekliyor. Testler aynı makinede ayrı bir klasör kullandı. |
| **Başarısızlıkta bildirim** | Yoktu | Bildirim üreten durumlar: başarısız yedek, başarısız doğrulama, başarısız bütünlük kontrolü ve son başarılı yedeğin hedeften eski olması (gözcü). Bildirim JSON olarak bir adrese (webhook) gönderiliyor; parola ve anahtar gizleniyor. | **Karşılanıyor** (test edildi). Gerçek bildirim adresi ve alıcılar senden. Gözcü, sunucu tamamen çökerse de çalışabilmesi için ayrı bir makinede çalışmalı. |

### Ölçüm koşulları (31.10.2026)

- **Veri:** Uygulamanın kendi servisleriyle üretildi (`npm run ops:loadgen -- 20 365 300`). Denetim zincirleri ve kanıt kayıtları gerçek.
  - 20 işletme, 365 gün
  - 14.840 görev, 29.439 denetim olayı
  - 7.300 fotoğraf × 300 KB = 2,1 GB
  - Veritabanı 44 MB
- **Varsayım:** Pilotun bir yılı için üst sınır. Gerçek kural kümesi gün başına daha çok görev üretirse veritabanı büyür; o durumda ölçüm tekrarlanmalı.
- **Ortam:** Bu geliştirme ortamı, yerel disk. Hedef aynı diskte ayrı bir klasördü; bu yüzden ağ süresi ölçüme girmedi, yukarıda ayrıca hesaplandı.

| İşlem | Süre |
|---|---|
| İlk tam yedek: tüm kanıtlar şifrelenip hedefe gider, sonra doğrulanır | 31 sn |
| Saatlik iş: yedek, doğrulama, eski yedekleri silme ve bütünlük kontrolü; yeni kanıt yokken | 6,9 sn (yedeğin kendisi 1,2 sn) |
| Tam derin doğrulama: 7.300 kanıtın tamamı çözülüp karşılaştırılır | 18 sn |
| Canlı bütünlük kontrolü: 21 zincir, 7.300 dosya | 4,4 sn |
| Tam geri yükleme, boş hedefe; son kontroller dahil | 40 sn |

## 2. Nasıl çalışır

**Tutarlılık.** Veritabanı dökümü ve "kaydedilmiş kanıt" listesi aynı anlık görüntüden (`REPEATABLE READ` snapshot) alınır. Yedek alınırken görev kaydı ve fotoğraf yüklemesi sürse bile, yedekteki dosyalar tam olarak dökümdeki veritabanının "kaydedildi" dediği dosyalardır; ne eksik ne fazla.

- Anlık görüntüden sonra gelen kayıtlar bir sonraki yedeğe girer.
- O anda yüklemesi yarım olan fotoğraf, geri yüklenen sistemde "yükleme bekleniyor" olarak kalır. Telefon yeniden denediğinde tamamlanır.

**Şifreleme ve konum.**

- Her nesne ayrı ve rastgele bir IV ile şifrelenir.
- Nesnenin adı da doğrulanır: eski bir manifest yeni yedeğin adıyla konursa reddedilir.
- Kanıt dosyaları değişmediği için her biri bir kez yüklenir; sonraki yedekler yalnızca yeni dosyaları ekler.
- Kanıt nesnelerinin adı, saklama anahtarının özetidir; işletme ve kayıt kimliklerini göstermez.

**Saklama.** Son 48 saatin bütün yedekleri ve 30 gün boyunca günde bir yedek tutulur. Kanıt nesneleri silinmez.

## 3. Geri yükleme: veritabanı tek işlem, dosyalar değil

PostgreSQL işlemi dosya sistemini kapsamaz. Bu yüzden geri yükleme dört aşamada ilerler. Her aşama, kanıt klasörünün yanındaki bir günlük dosyasına (`<klasör>.restore-journal.json`) yazılır; kesilen her çalıştırma kaldığı yerden tamamlanabilir ya da temizlenebilir:

1. **Hazırlık (`staging`).**
   - Kanıtlar hedefin yanındaki ayrı bir klasöre çözülür. Her dosya önce geçici adla yazılır, özeti kontrol edilir, sonra adlandırılır; yani yarım dosya hiç oluşmaz.
   - Veritabanına dokunulmaz.
   - Yeniden çalıştırmada özeti tutan dosyalar yeniden kullanılır, tutmayanlar silinir.
2. **Veritabanı (`staged` → `db_committed`).** `pg_restore --single-transaction` ya tamamen işlenir ya da veritabanını boş bırakır.
3. **Dosyaların yerine konması (`files_in_place`).** Hazırlık klasörü tek bir `rename` ile kanıt klasörünün yerine geçer. Aynı dosya sisteminde bu işlem atomiktir.
4. **Son kontroller.** Migration listesi, tablo satır sayıları, denetim zincirleri, her kanıtın özeti ve kayda bağlı olmayan dosya kontrol edilir. Hepsi tamamsa günlük silinir.

Testlerle denenen kesintiler (`server/test/acceptance/backup-restore.test.ts`):

- **Hazırlık yarısında:** Veritabanı boş kalır. Yeniden çalıştırmada doğrulanmış dosyalar kullanılır, bozulmuş bir dosya silinip yeniden indirilir.
- **Veritabanı yazıldıktan sonra:** Bütünlük kontrolü yarım durumu "sorun var" diye gösterir. Yeniden çalıştırma dosyaları yerine koyar.
- **Veritabanı işlendi ama günlük güncellenmeden:** Veritabanı yedekle karşılaştırılır; eşleşiyorsa devam edilir.
- **Dosyalar yerine konduktan sonra:** Yeniden çalıştırmada yalnızca son kontroller yapılır.
- **`pg_restore` kendi işleminin ortasında hata verirse:** Hiç tablo kalmaz. Yeniden çalıştırma hazırlanmış dosyaları kullanarak tamamlanır.
- **Dolu hedef ve başka bir yedeğin yarım kalmış geri yüklemesi:** İkisi de reddedilir.

## 4. Komutlar (`server/` içinde)

```bash
npm run backup                 # tek seferlik şifreli yedek + doğrulama
npm run backup:list            # hedefteki yedekler
npm run backup:verify -- [id] [n]   # şifre çözerek doğrular (varsayılan: en yeni, tüm kanıtlar)
npm run restore -- [id]        # BOŞ veritabanı + BOŞ kanıt klasörüne; kesilirse aynı komutla devam
npm run check:integrity        # çalışan sistemde zincirler + kanıt dosyaları
npm run backup:scheduled       # zamanlanmış iş: yedek → doğrulama → eski yedekleri silme → bütünlük; hata → bildirim
npm run backup:watchdog        # son başarı hedeften eskiyse bildirim (ayrı makinede çalıştır)
```

Örnek zamanlama (cron):

```
*/30 * * * *  cd /srv/goverhub/server && npm run -s backup:scheduled
*/15 * * * *  cd /srv/goverhub/server && npm run -s backup:watchdog     # tercihen başka bir makinede
```

Ortam değişkenleri: `BACKUP_TARGET_DIR`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_STATUS_FILE`, `BACKUP_RPO_MINUTES`, `BACKUP_GRACE_MINUTES`, `BACKUP_DEEP_SAMPLE`, `ALERT_WEBHOOK_URL`. Ayrıntı: `server/.env.example`.

**Anahtar:** `BACKUP_ENCRYPTION_KEY` olmadan yedek okunamaz. Bir kopyası hem uygulama sunucusunun hem yedek hedefinin dışında saklanmalı (ör. parola kasası ve kapalı zarf).

## 5. Kararını bekleyenler

| Konu | Önerim |
|---|---|
| Yedek aralığı | 30 dakika (1 saat hedefini birkaç saniye payla değil, rahatça karşılar) |
| Ayrı konum | Türkiye'de, uygulama sunucusundan farklı bir makine ya da nesne depolama (sürüm tutma / değiştirilemezlik özelliği olan). Seçilince aynı arayüzle bağlanır. |
| Şifreleme anahtarının saklandığı yer | Parola kasası + çevrimdışı kopya; erişebilecek kişiler belirlenmeli |
| Bildirim adresi ve alıcılar | Bir webhook (ekip sohbet kanalı ya da nöbet aracı) + SMTP bağlanınca e-posta |
| Yedek saklama süreleri | 48 saat / 30 gün başlangıç; saklama matrisiyle uyumlu olmalı (hukuk görüşü) |
| Tam geri dönüş tatbikatı | Barındırma seçilince: sıfırdan sunucu kurulumu + geri yükleme, süre ölçülerek. Sonra ayda bir. |
