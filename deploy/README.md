# Kontrollü pilot kurulumu

**Hedef:** HTTPS üzerinden erişilen, gerçek e-postayla giriş yapılan ve yalnızca onaylı kurallarla çalışan bir pilot. Doğrulama: gerçek telefon testi ve sıfırdan geri dönüş tatbikatı.

Bu adımlar sağlayıcıdan bağımsızdır: Ubuntu 24.04 LTS, iki sunucu (bkz. `docs/KURULUM_IHTIYACLARI.md`). Komutları sunucu yöneticisi çalıştırır. Her adımdaki **Beklenen** satırı, çıktının nasıl görünmesi gerektiğini söyler; çıktıları bana iletirsen kontrol ederim.

| Dosya | Yeri |
|---|---|
| `Caddyfile` | Sunucu 1 `/etc/caddy/Caddyfile` |
| `systemd/goverhub-api.service` | Sunucu 1 `/etc/systemd/system/` |
| `cron/goverhub-app` | Sunucu 1 `/etc/cron.d/` |
| `cron/goverhub-watchdog` | **Sunucu 2** `/etc/cron.d/` |
| `pilot.env.example` → `/etc/goverhub/pilot.env` | Sunucu 1, `chmod 600` |
| `watchdog.env.example` → `/etc/goverhub/watchdog.env` | Sunucu 2 |

## 1. Sunucu 1 (uygulama)

```bash
sudo apt update && sudo apt install -y postgresql-16 caddy git nodejs npm   # Node.js 22+ gerekir; dağıtımın sürümü eskiyse NodeSource deposu
node --version                                   # Beklenen: v22 veya üstü
sudo adduser --system --group --home /srv/goverhub goverhub
sudo mkdir -p /srv/goverhub/{app,web,evidence,var} /etc/goverhub && sudo chown -R goverhub:goverhub /srv/goverhub
```

**Güvenlik duvarı:** Dışarıya yalnızca 80 ve 443 açık olsun. SSH yalnızca yönetici IP'lerinden kabul edilsin. API (3000) dışarıya hiç açılmaz; zaten yalnızca 127.0.0.1'de dinler ve pilot modunda başka adresi reddeder.

```bash
sudo ufw default deny incoming && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw allow from <yönetici-IP> to any port 22 proto tcp && sudo ufw enable
```

Kurulumdan sonra başka bir makineden `curl -m 5 http://<sunucu-IP>:3000/health` çalıştırıldığında **bağlantı kurulamamalı**.

**Kod** (Git paketinden; uzak depo yok):

```bash
sudo -u goverhub git clone /yol/goverhub.bundle /srv/goverhub/app
cd /srv/goverhub/app && sudo -u goverhub git checkout goverhub-mobile && git log --oneline -1
cd server && sudo -u goverhub npm ci             # tsx gerektiği için geliştirme bağımlılıkları da kurulur
```

**Veritabanı:**

```bash
sudo -u postgres psql -c "CREATE ROLE goverhub_owner LOGIN PASSWORD '<güçlü parola 1>'" \
                      -c "CREATE ROLE goverhub_app   LOGIN PASSWORD '<güçlü parola 2>'" \
                      -c "CREATE DATABASE goverhub OWNER goverhub_owner"
```

**Ortam dosyası:** `pilot.env.example`'ı `/etc/goverhub/pilot.env` olarak kopyala ve doldur. Sonra:

```bash
sudo chmod 600 /etc/goverhub/pilot.env && sudo chown goverhub /etc/goverhub/pilot.env
cd /srv/goverhub/app/server && sudo -u goverhub bash -c 'set -a; . /etc/goverhub/pilot.env; set +a; npm run migrate'
```

**Beklenen:** `applied 001_core.sql` … `applied 005_marketplace_validity_sharing.sql`.

**Web derlemesi** (internete açık herhangi bir makinede, `mobile/` içinde):

```bash
EXPO_PUBLIC_API_URL=https://pilot.ornek.com.tr/api npx expo export --platform web
```

Oluşan `dist/` klasörünün içeriği Sunucu 1'de `/srv/goverhub/web/` altına kopyalanır.

**API ve HTTPS:**

```bash
sudo cp deploy/systemd/goverhub-api.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now goverhub-api
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile     # alan adını düzelt
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
curl -s https://pilot.ornek.com.tr/api/env
```

**Beklenen:** `{"mode":"pilot","exampleRulesAllowed":false,"mailTransport":"smtp","mailProductionReady":false}`

## 2. Sunucu 2 (yedek + gözcü) ve yedek bağlantısı

- Sunucu 2'de yedek diski `/srv/goverhub-yedek` olarak hazırlanır.
- Sunucu 1, bu diski NFS ya da SSHFS ile `/mnt/goverhub-yedek` olarak bağlar. Bağlama yalnızca Sunucu 1'in IP'sine açılır.
- Gözcü Sunucu 2'de, aynı diske yerel yoldan **salt okunur** bakar.

**Şifreleme anahtarı:**

1. Bir kez üretilir: `openssl rand -base64 32`.
2. Asıl kopya parola kasasına ve kapalı zarfa konur; en az iki yetkili kişi bilir.
3. Sunucu 1'de `/etc/goverhub/backup.key` (`chmod 400`, sahibi `goverhub`) dosyasına yazılır.
4. **Yedek diskine ya da kanıt klasörüne asla konmaz.** Komutlar bunu reddeder.

```bash
sudo cp deploy/cron/goverhub-app /etc/cron.d/                    # Sunucu 1
sudo cp deploy/cron/goverhub-watchdog /etc/cron.d/               # Sunucu 2 (+ watchdog.env)
cd /srv/goverhub/app/server && sudo -u goverhub bash -c 'set -a; . /etc/goverhub/pilot.env; set +a; npm run backup:scheduled'
```

**Beklenen:** `yedek tamam: …`. Bildirim adresine hiçbir şey gitmez. Sunucu 2'de `npm run backup:watchdog` → `düzey: ok`.

## 3. E-posta: ilk gerçek gönderimi birlikte doğrulama

1. `https://pilot.ornek.com.tr` adresini aç ve kendi e-postanla giriş kodu iste.
2. Kontrol et:
   - Kod birkaç dakika içinde gelen kutusuna (spam değil) düşmeli.
   - Gönderen doğru olmalı.
   - E-postanın başlıklarında SPF/DKIM `pass` görünmeli.
3. Kodla giriş yap.
4. Ancak bunlardan sonra `MAIL_PRODUCTION_READY=true` yap ve API'yi yeniden başlat (`sudo systemctl restart goverhub-api`).

## 4. Yönetici rolleri ve onaylı kurallar

```bash
cd /srv/goverhub/app/server && sudo -u goverhub bash -c 'set -a; . /etc/goverhub/pilot.env; set +a;
  npm run -s admin:grant -- yazar@…   rule_author    "Pilot kural yazarı";
  npm run -s admin:grant -- onay@…    rule_reviewer  "Ürün sahibi, kural onayı";
  npm run -s admin:grant -- uzman@…   rule_reviewer  "Alan uzmanı";
  npm run -s admin:grant -- uzman@…   alan:food_safety "Gıda güvenliği uzmanı";
  npm run -s admin:grant -- yonetici@… platform_admin "Platform yöneticisi";
  npm run -s admin:list'
```

- Her kişi kendi e-postasıyla giriş yapar ve **Hesap → Ek doğrulama**'yı kurar. `admin:list` çıktısında "ek doğrulama: kurulu" görünmeli.
- **Kurallar:** Yalnızca senin onayladığın kural tablosu satırları uygulamada taslak olarak girilir. Akış: alan uzmanı incelemesi → senin onayın → yayın. Örnek kurallar pilotta zaten yayımlanamaz.

## 5. Pilota hazırlık kontrolü

```bash
cd /srv/goverhub/app/server && sudo -u goverhub bash -c 'set -a; . /etc/goverhub/pilot.env; set +a; npm run -s pilot:check'
```

**Beklenen:** Bütün satırlar `✓`; yalnızca "Saklama süreleri onaylı" `!` olabilir (hukuk görüşü). Herhangi bir `✗` varsa pilot başlamaz.

## 6. Doğrulama

1. **Gerçek telefon testi:** `docs/TELEFON_TESTI.md` §3'teki kontrol listesi, pilot adresiyle (`https://…`). En az bir iPhone (Safari) ve bir Android (Chrome).
2. **Sıfırdan geri dönüş tatbikatı:** `docs/YEDEKLEME.md` §4. Boş bir üçüncü sunucuda (ya da Sunucu 1'in kopyasında), anahtarın kasadan kurtarılması dahil, süre tutularak yapılır. Hedef 4 saat.

Her iki doğrulamanın sonucu yazılı rapor olarak kaydedilir; pilot ondan sonra başlar.
