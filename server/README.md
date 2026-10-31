# GoverHub API

TypeScript + Fastify + PostgreSQL 16. Mimari: `../docs/MIMARI.md`. Durum ve test kapsamı: `../docs/DURUM.md`, `../docs/KABUL.md`.

## Gereksinimler
- Node.js 22+
- PostgreSQL 15+ (16 ile test edildi)

## Veritabanı kurulumu (bir kez)

İki rol kullanılır. Tablo sahibi yalnızca migration yapar; uygulama rolü tablolara sahip olmadığı için satır düzeyi güvenlik ona her zaman uygulanır. Rol adı `goverhub_app` migration'da sabittir.

```sql
CREATE ROLE goverhub_owner LOGIN PASSWORD '…';
CREATE ROLE goverhub_app   LOGIN PASSWORD '…';
CREATE DATABASE goverhub OWNER goverhub_owner;
```

## Ortam değişkenleri

`.env.example` dosyasını `.env` olarak kopyalayıp doldur. `.env` git'e girmez; gizli değerler kaynak koda yazılmaz.

| Değişken | Anlamı |
|---|---|
| `DATABASE_URL` | Uygulama rolüyle bağlantı |
| `DATABASE_OWNER_URL` | Sahip rolüyle bağlantı (yalnızca migration) |
| `EVIDENCE_DIR` | Kanıt dosyaları dizini |
| `PORT` | HTTP portu (varsayılan 3000) |
| `DEMO_MODE` | `true` yalnızca demo ortamında: örnek kuralların yayınına ve demo sıfırlamaya izin verir |

## Çalıştırma

```bash
npm install
set -a; . ./.env; set +a
npm run migrate        # bekleyen SQL migration'larını uygular
npm run seed:demo      # yalnızca DEMO_MODE=true: örnek kurallar + demo işletme, oturum jetonlarını yazdırır
npm run dev            # API: http://localhost:$PORT
```

Örnek istek:

```bash
curl -H "Authorization: Bearer <owner jetonu>" http://localhost:3000/companies/<companyId>/obligations
```

## Testler

Kabul testleri gerçek bir PostgreSQL'e bağlanır ve **her test dosyasında `public` şemasını silip yeniden kurar**. Yalnızca bu iş için ayrılmış bir veritabanı kullan.

```bash
createdb -O goverhub_owner goverhub_test
export TEST_DATABASE_URL=postgres://goverhub_app:…@localhost:5432/goverhub_test
export TEST_DATABASE_OWNER_URL=postgres://goverhub_owner:…@localhost:5432/goverhub_test
npm test
npm run typecheck
```

## Örnek içerik uyarısı
`src/seed/demo.ts` içindeki tüm kaynaklar, kurallar, limitler (ör. 0–4 °C) ve acil talimatlar **örnektir**, gerçek mevzuatı temsil etmez. Gerçek kurallar ancak resmî kaynak doğrulanıp bir inceleyici tarafından onaylandıktan sonra eklenmelidir. Sunucu, demo dışı ortamda örnek kural yayınını reddeder.
