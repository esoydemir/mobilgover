# Yedekleme ve geri yükleme

Yöntem bir sağlayıcıya bağlı değil. Yalnızca PostgreSQL'in kendi araçlarını (`pg_dump` / `pg_restore`) ve kanıt dizininin düz bir kopyasını kullanır. Bir yedek tek klasördür:

| Dosya | İçerik |
|---|---|
| `database.dump` | Veritabanının tamamı (PostgreSQL custom biçimi) |
| `evidence/` | Kanıt dosyaları; anahtarlar sunucudaki gibi |
| `manifest.json` | Her dosyanın SHA-256 özeti, migration listesi, tablo satır sayıları, araç ve sunucu sürümleri |

**Tutarlılık:** Önce veritabanı dökülür, sonra dosyalar kopyalanır. Kanıt dosyaları bir kez yazılır, satırı "kaydedildi" olmadan önce diske iner ve bir daha değişmez. Bu sırayla dökümdeki her "kaydedildi" satırının dosyası kopyada bulunur. Yedek anında dosyası olmayan kayıt varsa `missingAtBackup` alanına yazılır ve doğrulama bunu hata sayar.

## Komutlar (`server/` içinde, ortamın `.env` değerleriyle)

```bash
npm run backup -- /yedekler/2026-11-01      # DATABASE_OWNER_URL + EVIDENCE_DIR → yeni yedek (klasör boş olmalı)
npm run backup:verify -- /yedekler/2026-11-01   # yalnızca dosyaları manifestle karşılaştırır, veritabanına dokunmaz
npm run restore -- /yedekler/2026-11-01     # bu ortamın BOŞ veritabanına ve BOŞ kanıt dizinine
npm run check:integrity                     # çalışan ortamda: denetim zincirleri + kanıt dosyaları
```

Her komut tek tek kontrolleri ✓/✗ ile yazar ve sorun varsa sıfırdan farklı çıkış koduyla biter. Bu yüzden zamanlanmış görevlerde kullanılabilir.

## Geri yükleme kuralları

- **Yedek doğrulanmadan başlamaz.** Tek bir dosyanın özeti tutmazsa hiçbir şey yazılmaz.
- **Yalnızca boş hedefe yazar.** Veritabanında tablo ya da kanıt dizininde dosya varsa reddeder. Canlı veri asla üzerine yazılmaz.
- **Tek işlemde yükler** (`--single-transaction`): Yarıda kalan bir geri yükleme veritabanında iz bırakmaz.
- **Hedefte rol önceden olmalı.** Hedef PostgreSQL'de `goverhub_app` rolü bulunmalı; yetkiler (GRANT) dökümle birlikte gelir. Tabloların sahibi geri yüklemeyi yapan roldür (`--no-owner`).
- **Sonradan doğrulanır:**
  - Migration listesi ve her tablonun satır sayısı manifestle aynı mı
  - Her işletmenin ve platformun denetim zinciri sağlam mı
  - Her kayıtlı kanıtın dosyası var mı ve özeti tutuyor mu

## Tatbikat

**Otomatik tatbikat:** `server/test/acceptance/backup-restore.test.ts` (5 test). Gerçek PostgreSQL'de çalışır:

1. Gerçek veri oluşturur: fotoğraf kanıtı yüklenmiş bir görev.
2. Yedek alır ve ikinci, boş bir veritabanına geri yükler.
3. Geri yüklenen veritabanının üzerinde ikinci bir API çalıştırır.
4. Aynı oturumla aynı görevin aynı yanıtı verdiğini, zincirin sağlam olduğunu ve rol sınırının sürdüğünü doğrular.

Testler ayrıca şunları denetler:

- Değiştirilmiş kanıt dosyası veya bozulmuş döküm: geri yükleme reddedilir, hedef boş kalır.
- Dolu hedef reddedilir.
- Çalışan sistemde silinmiş bir kanıt dosyası bütünlük kontrolünde yakalanır.
- Komut satırı araçları ayrı süreç olarak çalıştırılır.

Bu testler için ayrı bir veritabanı gerekir: `TEST_RESTORE_DATABASE_OWNER_URL`, `TEST_RESTORE_DATABASE_URL` (bkz. `server/README.md`).

**Elle tatbikat (31.10.2026, demo ortamı):** Komut satırıyla yedek alındı ve boş veritabanına geri yüklendi. Sonuç: 5 migration, tablo satır sayıları aynı, 4 denetim zinciri / 60 olay sağlam. İlk denemede zincir kontrolü yanlış hata verdi: araç, veritabanı tip dönüştürücülerini yüklemiyordu. Düzeltildi ve ayrı süreç testi eklendi.

## Pilot öncesi kararlar (açık)

| Konu | Neden önemli | Karar veren |
|---|---|---|
| Yedek sıklığı ve en fazla ne kadar veri kaybı kabul edilir (RPO) | Günlük yedekte en kötü durumda bir günlük kayıt gider. Daha azı için sürekli WAL arşivi gerekir. | Sen |
| Geri dönüş süresi hedefi (RTO) | Tatbikat süresini ölçmek için hedef gerekir | Sen |
| Yedeklerin saklandığı yer ve şifrelenmesi | Yedek kişisel veri içerir. Türkiye'de, sunucudan ayrı bir yerde ve şifreli tutulmalı. | Barındırma kararıyla |
| Yedeklerin ne kadar tutulacağı | Saklama matrisiyle uyumlu olmalı | Hukuk görüşü |
| Tatbikat sıklığı | Önerim: pilot boyunca ayda bir, ayrı bir sunucuya geri yükleme ve `check:integrity` | Sen |
