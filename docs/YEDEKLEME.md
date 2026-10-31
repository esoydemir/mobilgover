# Yedekleme, geri yükleme ve hedefler

## 1. Kararlar ve durumları

| Karar / hedef | Uygulama | Durum |
|---|---|---|
| **Yedek aralığı 30 dakika** | `backup:scheduled` 30 dakikada bir çalışır. Önceki çalışma sürüyorsa yeni çalıştırma atlanır (kilit). | Hazır |
| **En fazla 1 saat veri kaybı** | En kötü durum: 30 dk aralık + çalışma süresi (ölçülen ~7–9 sn) ≈ 30 dk. | **Karşılanıyor** (ölçüldü, §5) |
| **Ayrı konumdaki son kullanılabilir yedeğin yaşının izlenmesi** | Bir yedek ancak ayrı konuma aktarılıp orada doğrulandıktan sonra "kullanılabilir" sayılır. Zamanlanmış iş o zaman hedefe bir işaret dosyası yazar (`status/latest-verified.json`). Gözcü (`backup:watchdog`) yaşı bu işaretten okur. İşaretin gösterdiği yedek hedefte yoksa yaş "bilinmiyor" sayılır ve bildirim gönderilir. | Hazır (test edildi) |
| **Hedef tehlikeye girmeden önceden bildirim** | Eşikler §2'de. | Hazır (test edildi) |
| **Anahtar yedeklerle birlikte tutulmaz** | Anahtar dosyası yedek konumunda ya da kanıt klasöründe ise komutlar çalışmayı reddeder. Hedefteki hiçbir nesnede anahtar bulunmadığı test edildi. | Hazır (test edildi) |
| **Anahtar kurtarma tatbikata dahil** | `backup:key-check`, saklandığı yerden alınan anahtarı geri yüklemeden önce yedekle karşılaştırır. Tatbikat adımları §4'te. | Hazır; gerçek tatbikat barındırmayı bekliyor |
| **4 saatte geri dönüş** | Verinin geri yüklenmesi 40 sn (bir yıllık pilot verisi, yerel). | Veri kısmı karşılanıyor; sunucu kurulumu dahil tam süre tatbikatta ölçülecek |
| **Şifreleme** | AES-256-GCM, sunucuda; nesne adı doğrulanıyor | Hazır |
| **Bildirim** | Webhook (JSON); parolalar gizleniyor | Hazır; gerçek adres senden |

## 2. Yaş izleme ve eşikler

Yaş, ayrı konumdaki son kullanılabilir yedeğin **anlık görüntü zamanından** ölçülür. Bu, sunucu şu anda kaybolsa ne kadar verinin gideceğini gösterir. Normal işleyişte yaş 0–31 dakika arasında dolaşır.

| Düzey | Yaş | Anlamı | Bildirim |
|---|---|---|---|
| Normal | < 40 dk | 30 dakikalık aralık işliyor | — |
| **Uyarı** | ≥ 40 dk | Bir yedek gecikti ya da düştü | "Yedek gecikiyor" |
| **Kritik** | ≥ 50 dk | Sonraki yedek de gelmezse hedef aşılır | "Bir saatlik veri kaybı hedefi tehlikede"; düzey sürdükçe saatte bir tekrarlanır |
| **Hedef aşıldı** | ≥ 60 dk | En fazla 1 saat veri kaybı hedefi şu an karşılanmıyor | "Hedef aşıldı"; saatte bir tekrarlanır |
| Düzelme | < 40 dk'ya dönünce | — | Tek bir "yeniden güncel" bildirimi |

Ayrıca her başarısız yedekleme, başarısız doğrulama ve başarısız bütünlük kontrolü anında bildirim üretir.

Eşikler ortam değişkeniyle ayarlanabilir: `BACKUP_AGE_WARN_MINUTES`, `BACKUP_AGE_CRITICAL_MINUTES`, `BACKUP_RPO_MINUTES`.

**Gözcü uygulama sunucusunda çalışmamalı.** Sunucu tamamen çökerse kendi kendine bildirim gönderemez. Gözcünün yedek konumunu yalnızca okuma erişimi yeter; veritabanı ya da anahtar gerekmez.

## 3. Saklama düzeni ve depolama ihtiyacı

### Yöntem: tam veritabanı dökümü + ortak (paylaşılan) kanıt dosyaları

Yöntem ne "her seferinde tam kopya" ne de zincirleme "artımlı" yedek. Her yedek üç parçadan oluşur:

| Parça | Her yedekte mi? | Neden |
|---|---|---|
| Veritabanı dökümü (şifreli) | **Evet, tam döküm** | Küçük (yıl sonunda 4,4 MB). Tek dosyadan geri yüklenir; önceki yedeklere bağımlı değildir. |
| Manifest (şifreli) | **Evet** | O yedeğin içerdiği her kanıt dosyasının adı ve özeti. Kanıt sayısıyla büyür (dosya başına ~280 bayt). |
| Kanıt dosyaları (şifreli) | **Hayır, ortak** | Fotoğraflar değişmez. Her dosya hedefe **bir kez** yüklenir; onu içeren bütün yedekler aynı nesneyi kullanır. |

Her yedek kendi başına geri yüklenebilir: kendi dökümü, kendi manifesti ve manifestin gösterdiği ortak kanıt nesneleri yeter.

Ortak saklamanın karşılığı şu: bir kanıt nesnesi bozulursa onu içeren bütün yedekler etkilenir. Önlemler:
- Her yarım saatte 20 nesne rastgele çözülüp özeti kontrol ediliyor.
- Haftada bir en yeni yedeğin bütün kanıtları çözülerek doğrulanıyor (cron'a eklendi).
- Hedef seçilirken sürüm tutma ya da değiştirilemezlik özelliği tercih edilmeli.

### Saklama (pilot)

- Son 48 saat: her yarım saatlik yedek (96).
- Son 30 gün: her günün son yedeği (ilk iki gün yukarıdakilerle örtüşür; ek 28).
- Toplam ~124 veritabanı yedeği. Kanıt nesneleri yalnızca **hiçbir tutulan yedek kullanmıyorsa** silinir.

**Temizliğin eski yedeği bozmaması (test edildi):**
- Bir fotoğraf yalnızca eski bir yedekte bulunsa da, o yedek tutulduğu sürece silinmiyor. Kayıt silindikten ve temizlik çalıştıktan sonra bile o eski yedek baştan sona geri yüklenebiliyor.
- Eski yedek süresini doldurup silinince nesne de gidiyor; yeni yedek tam geri yükleniyor.
- Ek güvenceler:
  - Henüz hiçbir manifeste yazılmamış (yüklenmesi süren) nesneler 6 saat boyunca silinmiyor.
  - Elle alınan yedek, zamanlanmış işle aynı kilidi kullanıyor.
  - Hedefte hiç yedek görünmüyorsa temizlik hiçbir şey silmiyor.
- Kural bozulursa (referans kontrolü kaldırıldığında) test başarısız oluyor.

**İş kayıtlarının saklama politikasından ayrıdır.** Yedekler arşiv değildir. Saklama politikasıyla silinen bir kayıt en fazla 30 gün daha eski yedeklerde kalır, sonra yedeklerden de çıkar. Bu süre aydınlatma metnine ve saklama matrisine yazılmalı.

### Ölçüm: 124 gerçek yedeğin toplam boyutu (01.11.2026)

Uygulamanın kendi servisleriyle üretilen veri: 20 işletme, 365 gün, 7.300 fotoğraf × 300 KB = 2.139 MB, veritabanı 43 MB. Bu veriyle art arda **124 gerçek yedek** alındı ve hedef klasör ölçüldü:

| Hedefteki içerik | Ölçülen |
|---|---|
| Kanıt nesneleri (7.300, her biri bir kez; şifreleme ek yükü nesne başına 41 bayt) | **2.139 MB** |
| 124 veritabanı dökümü (ortalama 4,42 MB) | 548 MB |
| 124 manifest (ortalama 1,97 MB) | 244 MB |
| **Toplam** | **2.932 MB** |
| *Karşılaştırma: her yedek tam kopya olsaydı (124 × 2,2 GB)* | *~270 GB* |

Süreler: ilk yedek 31,7 sn (bütün kanıtlar ilk kez yükleniyor), sonraki her yedek ortalama 1,0 sn. En eski yedek bütün kanıtları çözülerek doğrulandı.

Bu ölçüm bir **üst sınır**dır: 124 yedeğin hepsi yıl sonundaki veri boyutuyla alındı. Gerçekte 30 günlük penceredeki eski yedekler biraz daha küçüktür.

### Kapasite hesabı ve düzeltilmiş öneri

**Formül:** `Kapasite ≈ E + N × (D + M)`

- `E`: tutulan kayıtlardaki fotoğrafların toplamı
- `N`: tutulan yedek sayısı (124)
- `D`: döküm boyutu
- `M`: manifest boyutu (kanıt sayısı × ~280 bayt)

**Önceki 20 GB önerisi nereden geliyordu:** İşletme başına günde 5 fotoğraf varsayımının **hesabıydı** (ölçüm değildi): 12,5 GB ÷ 0,7 (%70 doluluk uyarısı) ≈ 18 → 20 GB. Bugünkü örnek kurallar işletme başına günde ~1 fotoğraf üretiyor. Ölçüm bu senaryoda 2,9 GB çıktı.

| Senaryo (20 işletme) | 1. yıl sonu | 2. yıl sonu (kayıtlar silinmezse) | Durum |
|---|---|---|---|
| Günde 1 fotoğraf / işletme | **2,9 GB (ölçüldü)** | ~5,9 GB (hesap) | Bugünkü örnek kurallar |
| Günde 5 fotoğraf / işletme | ~12,5 GB (hesap) | ~25 GB (hesap) | Gerçek kural kümesi daha fazla fotoğraf isterse |

**Düzeltilmiş öneri:**
- Yedek konumu için **10 GB ile başla, %70'te (7 GB) uyarı.** Bugünkü kural yoğunluğunda bu iki yılı aşar.
- Onaylı kural kümesi belli olunca günlük fotoğraf sayısıyla formül yeniden hesaplanır. Günde 5 fotoğraf çıkarsa 1. yıl için 20 GB'a yükseltilir.
- Disk sonradan büyütülebilir; bunu sağlayıcı seçerken sormak yeterli.

**İyileştirme payı (yapılmadı, yeni özellik sayılır):** Manifestler sıkıştırılmıyor. Sıkıştırılırsa 244 MB'lık pay belirgin biçimde azalır ve sunucular arası trafik düşer. Pilot için gerekli değil.

## 4. Geri dönüş tatbikatı (anahtar kurtarma dahil)

Barındırma seçildikten sonra, boş bir sunucuda, süre tutularak yapılır. Pilot boyunca ayda bir tekrarlanır.

1. **Başlangıç:** Saati kaydet. Senaryo: uygulama sunucusu ve diski tamamen kayıp.
2. **Anahtarın kurtarılması:** Anahtarı saklandığı yerden (parola kasası / kapalı zarf) yetkili kişi alır. Kim aldı, ne zaman, kaç dakika sürdü kaydedilir.
3. **Yeni sunucu:** İşletim sistemi, Node.js, PostgreSQL ve uygulama `KURULUM.md`'ye göre kurulur. Uygulama rolü oluşturulur.
4. **Anahtar kontrolü:** `BACKUP_ENCRYPTION_KEY_FILE` sunucuda, kanıt klasörü ve yedek konumu dışında, geçici bir yere konur. `npm run backup:key-check` çalıştırılır: parmak izi ve manifest çözümü TAMAM olmalı. Yanlış anahtar burada yakalanır; hiçbir şey yazılmadan durulur.
5. **Geri yükleme:** `npm run restore` çalıştırılır. Kesilirse aynı komut kaldığı yerden devam eder.
6. **Doğrulama:**
   - `npm run check:integrity` TAMAM olmalı.
   - Uygulama HTTPS üzerinden açılır, bir kullanıcı gerçek e-postayla giriş yapar, bir görev görüntülenir.
   - Telefonda bir kayıt girilir.
7. **Bitiş:** Saati kaydet. Toplam süre 4 saatin altında mı? Anahtar dosyası sunucudan silinir; anahtar kasaya geri konur.
8. **Kayıt:** Tatbikat raporu yazılır: süreler, sorunlar, bir sonraki tatbikat tarihi.

## 5. Ölçümler

Ölçüm verisi uygulamanın kendi servisleriyle üretildi (`npm run ops:loadgen`). 20 işletme, 365 gün, 7.300 fotoğraf × 300 KB = 2,1 GB, veritabanı 44 MB. Ortam bu geliştirme ortamıydı ve hedef aynı diskte ayrı bir klasördü; bu yüzden ağ süresi ölçüme girmedi.

| İşlem | Süre |
|---|---|
| İlk tam yedek (tüm kanıtlar şifrelenip hedefe) | 31 sn |
| Yarım saatlik iş, yeni kanıt yokken (yedek, doğrulama, budama, bütünlük) | ~7 sn (yedeğin kendisi 1,2 sn) |
| Tam derin doğrulama (7.300 kanıtın tamamı çözülerek) | 18 sn |
| Canlı bütünlük kontrolü | 4,4 sn |
| Tam geri yükleme, boş hedefe | 40 sn |
| Ağ üzerinden indirme (hesap, ölçüm değil), 2,2 GB | 100 Mbit/sn'de ~3 dk; 20 Mbit/sn'de ~15 dk |

## 6. Nasıl çalışır

- **Tutarlılık:**
  - Veritabanı dökümü ve "kaydedilmiş kanıt" listesi aynı anlık görüntüden alınır. Yedek alınırken iş sürse bile, yedekteki dosyalar tam olarak dökümdeki veritabanının kaydettiği dosyalardır.
  - O anda yüklemesi yarım olan bir fotoğraf, geri yüklenen sistemde "yükleme bekleniyor" olarak kalır; telefon yeniden denediğinde tamamlanır.
- **Konum ve şifreleme:**
  - Her nesne sunucuda şifrelenir ve kendi rastgele IV'siyle yazılır; nesne adı da doğrulanır.
  - Kanıt nesneleri bir kez yüklenir. Adları saklama anahtarının özetidir; işletme ve kayıt kimliklerini göstermez.
- **Geri yüklemenin aşamaları:** Veritabanı tek işlemde yüklenir, dosyalar değil. Bu yüzden geri yükleme dört aşamada ilerler ve her aşama bir günlük dosyasına yazılır; kesilen her aşama yeniden çalıştırmada tamamlanır ya da temizlenir:
  1. Kanıtlar hedefin yanında ayrı bir klasöre çözülür ve özetleri kontrol edilir.
  2. Veritabanı tek işlemde yüklenir.
  3. Hazırlık klasörü tek bir atomik `rename` ile yerine konur.
  4. Son kontroller yapılır.

  Ayrıntılar ve testler: `server/test/acceptance/backup-restore.test.ts`.

## 7. Komutlar ve zamanlama

```bash
npm run backup:scheduled      # her 30 dk
npm run backup:watchdog       # her 5 dk, başka makinede (yalnızca yedek konumuna okuma erişimi)
npm run backup:list | backup:verify -- [id] [n] | backup:key-check -- [id] | restore -- [id] | check:integrity
```

```
*/30 * * * *  cd /srv/goverhub/server && npm run -s backup:scheduled
*/5  * * * *  cd /srv/goverhub-gozcu/server && npm run -s backup:watchdog
```

Ortam değişkenlerinin tamamı `server/.env.example`'da. Anahtar için **`BACKUP_ENCRYPTION_KEY_FILE`** önerilir: sunucuda yalnızca gerektiği sürece bulunan, kanıt klasörü ve yedek konumu dışındaki bir dosya. `BACKUP_ENCRYPTION_KEY` değişkeni de çalışır.
