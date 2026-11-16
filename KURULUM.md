# GoverHub — kurulum

> **Windows'ta yalnızca denemek için en kolay yol:** `yerel-demo/README.md` (Docker Desktop + çift tıklama).
>
> Geliştirme ve demo kurulumu aşağıda. **Kontrollü pilot kurulumu için: `deploy/README.md`** ve ihtiyaç tablosu `docs/KURULUM_IHTIYACLARI.md`.

## 0. Teslim edilen paketten geri yükleme

`goverhub.bundle` dosyası tüm commit geçmişini içerir.

```bash
git clone goverhub.bundle goverhub
cd goverhub
git checkout goverhub-mobile      # çalışma dalı
git log --oneline | head          # geçmişi kontrol et
```

GitHub'a taşımak için: `git remote add origin <depo-adresi> && git push -u origin --all`.

`goverhub-source.zip` aynı kodun geçmişsiz anlık görüntüsüdür.

Gizli anahtar, parola veya `.env` dosyası pakete **dahil değildir**. Her ortamda `.env.example` dosyalarından yeni bir `.env` oluştur.

## 1. Gereksinimler
- Node.js 22+ ve npm
- PostgreSQL 15+ (16 ile test edildi)
- Mobil için: Expo (`npx expo`); telefonda denemek için Expo geliştirme derlemesi veya tarayıcı

## 2. Sunucu (`server/`)

```bash
cd server
npm install
cp .env.example .env               # değerleri doldur
```

Veritabanı (bir kez):

```sql
CREATE ROLE goverhub_owner LOGIN PASSWORD '<güçlü parola>';
CREATE ROLE goverhub_app   LOGIN PASSWORD '<güçlü parola>';
CREATE DATABASE goverhub OWNER goverhub_owner;
```

```bash
set -a; . ./.env; set +a
npm run migrate                    # şemayı kurar / günceller
npm run seed:demo                  # YALNIZCA demo ortamında (DEMO_MODE=true)
npm run dev
```

**Demo ve pilot ayrı kurulur.** İkisi için ayrı veritabanı ve ayrı `.env` kullan:
- Demo: `DEMO_MODE=true`. Örnek kurallar ve demo sıfırlama açıktır.
- Pilot: `DEMO_MODE=false`. Örnek kurallar yayınlanamaz, demo sıfırlama kapalıdır.

Ayrıntılar ve tüm ortam değişkenleri: `server/README.md`. Web derlemesini kullanacaksan `CORS_ORIGINS` değişkenine o adresi yaz.

**E-posta:** `MAIL_TRANSPORT=dev_outbox` yalnızca demo içindir; kodlar gönderilmez, giriş ekranı kodu bu kutudan alır. Uygulama bu eşleşmeyi zorlar: pilot (`DEMO_MODE=false`) `dev_outbox` ile, demo ise `smtp` ile başlamaz; demo modu gerçek (demo olmayan) işletme bulunan bir veritabanında da başlamaz. Pilot için `MAIL_TRANSPORT=smtp` ve sağlayıcının SMTP bilgileri girilir. İlk gerçek gönderim doğrulanana kadar `MAIL_PRODUCTION_READY=false` kalır.

## 3. Mobil (`mobile/`)

```bash
cd mobile
npm install
cp .env.example .env               # EXPO_PUBLIC_API_URL=sunucu adresi (demo ve pilot için ayrı derleme)
npx expo start --web               # tarayıcıda
npx expo start                     # telefonda (geliştirme derlemesi)
```

Telefon tarayıcısında denerken uygulamayı **https** adresinden aç. Tarayıcılar fotoğraf özetini (SHA-256) yalnızca güvenli sayfalarda hesaplar; düz `http://192.168…` adresinde fotoğraf eklenemez. Ayrıntılar: `docs/TELEFON_TESTI.md`. Native derleme ve mağaza: `docs/MOBIL_DAGITIM.md`.

## 4. Testler

```bash
cd server
createdb -O goverhub_owner goverhub_test     # yalnızca testlere ayrılmış veritabanı
export TEST_DATABASE_URL=postgres://goverhub_app:<parola>@localhost:5432/goverhub_test
export TEST_DATABASE_OWNER_URL=postgres://goverhub_owner:<parola>@localhost:5432/goverhub_test
createdb -O goverhub_owner goverhub_restore_test   # geri yükleme tatbikatı testi için
export TEST_RESTORE_DATABASE_OWNER_URL=postgres://goverhub_owner:<parola>@localhost:5432/goverhub_restore_test
export TEST_RESTORE_DATABASE_URL=postgres://goverhub_app:<parola>@localhost:5432/goverhub_restore_test
npm test && npm run typecheck
cd ../mobile && npx tsc --noEmit
```

Uyarı: Testler her çalışmada test veritabanlarının `public` şemasını siler.

## 5. Yedekleme

`server/` içinde `npm run backup:scheduled` (30 dakikada bir) ve `npm run backup:watchdog` (15 dakikada bir, tercihen başka makinede). Geri yükleme: `npm run restore`. Hedefler, ölçüm ve kurallar: `docs/YEDEKLEME.md`.

### Windows + Docker yerel demo için yedek ve geri yükleme

Demo kurulumunda bu komutlar kapsayıcı içinde `yerel-demo/*.cmd` dosyalarıyla çalışır; güncelleme öncesi yedek, geri yükleme tatbikatı, temiz kurulum / veri koruyan güncelleme farkı ve bağımlılıklar (yerel dil modeli, Türkçe OCR, PDF üretimi, PostgreSQL 16 istemcisi) `yerel-demo/README.md` §6'dadır. Eksik bileşenleri (giriş yapmış kullanıcıya) `GET /api/system/modules` söyler.
