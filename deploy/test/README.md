# Test ortamı (yalnızca demo verisi)

Telefonla denemek için ayrı, erişimi davet bağlantısıyla sınırlı bir HTTPS ortamıdır. Pilot ya da üretim ortamı değildir.

- Kılavuz, gerekenler ve telefon test listesi: `docs/TEST_ORTAMI.md`
- Yayın: GitHub Actions → "Test ortamına yayınla" (`.github/workflows/deploy-test.yml`)
- `install.sh`: Ubuntu 24.04 üzerinde root olarak çalışır ve tekrar çalıştırılabilir. Davet anahtarını standart girdiden okur. Veritabanı parolalarını sunucuda üretir.
- `Caddyfile.template`: HTTPS, davet çerezi kapısı, `noindex`. Caddy 2.6.2 ile doğrulandı (Ubuntu 24.04 paketi).
- `goverhub-test-api.service`: API yalnızca `127.0.0.1:3000` adresinde dinler.

Pilot kurulumu bundan ayrıdır: `deploy/README.md`.
