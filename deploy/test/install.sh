#!/usr/bin/env bash
# GoverHub TEST ortamı kurulumu / güncellemesi. Ubuntu 24.04, root olarak çalışır.
# Tekrar çalıştırılabilir: ilk çalıştırmada kurar, sonrakilerde yalnızca yeni sürümü yükler.
#
#   sudo bash install.sh --domain test.ornek.com.tr --release goverhub-src.tar.gz --web goverhub-web.tar.gz \
#        --sha <commit> --ssh-port 22 < erisim-anahtari
#
# Davet anahtarı standart girdiden okunur (komut satırında ve süreç listesinde görünmesin).
# Veritabanı parolaları ve MFA şifreleme anahtarı BU SUNUCUDA üretilir ve yalnızca
# /etc/goverhub-test/test.env içinde (root:goverhub, 640) durur; hiçbir yere gönderilmez.
#
# Bu ortam YALNIZCA demo verisi içindir: DEMO_MODE=true, e-posta gönderilmez (dev_outbox),
# uygulama gerçek (demo olmayan) işletme bulunan bir veritabanında başlamayı reddeder.
set -euo pipefail
umask 027

DOMAIN="" RELEASE="" WEB="" SHA="" SSH_PORT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --release) RELEASE="$2"; shift 2 ;;
    --web) WEB="$2"; shift 2 ;;
    --sha) SHA="$2"; shift 2 ;;
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    *) echo "Bilinmeyen seçenek: $1" >&2; exit 2 ;;
  esac
done

fail() { echo "HATA: $*" >&2; exit 1; }
step() { echo; echo "── $*"; }

[[ $EUID -eq 0 ]] || fail "root olarak çalıştırılmalı (sudo)."
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || fail "Geçersiz alan adı: '$DOMAIN'"
[[ -f "$RELEASE" && -f "$WEB" ]] || fail "--release ve --web dosyaları gerekli."
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || fail "--sha tam commit kimliği olmalı."
. /etc/os-release
[[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] || fail "Yalnızca Ubuntu 24.04 desteklenir (bulunan: ${PRETTY_NAME:-?})."

IFS= read -r TOKEN || true
[[ "$TOKEN" =~ ^[A-Za-z0-9_-]{32,128}$ ]] || fail "Davet anahtarı 32–128 karakter olmalı ve yalnızca A-Z a-z 0-9 _ - içermeli (standart girdiden)."

ROOT=/srv/goverhub-test
ETC=/etc/goverhub-test
ENVF=$ETC/test.env
NODE_MAJOR=22

step "1/9 Sistem paketleri"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q postgresql caddy curl ca-certificates xz-utils ufw >/dev/null
systemctl enable --now postgresql >/dev/null

step "2/9 Node.js $NODE_MAJOR (nodejs.org, SHA-256 doğrulamalı)"
if ! /usr/local/bin/node -v 2>/dev/null | grep -q "^v$NODE_MAJOR\."; then
  tmp=$(mktemp -d)
  base="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  file=$(grep -oE "node-v$NODE_MAJOR\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz" "$tmp/SHASUMS256.txt" | head -1)
  [[ -n "$file" ]] || fail "Node.js paketi bulunamadı."
  curl -fsSL "$base/$file" -o "$tmp/$file"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -) || fail "Node.js sağlama toplamı tutmadı."
  tar -xJf "$tmp/$file" -C /usr/local --strip-components=1 --exclude CHANGELOG.md --exclude README.md --exclude LICENSE
  rm -rf "$tmp"
fi
echo "node $(/usr/local/bin/node -v), npm $(/usr/local/bin/npm -v)"

step "3/9 Kullanıcı ve dizinler"
id goverhub >/dev/null 2>&1 || useradd --system --home-dir "$ROOT" --shell /usr/sbin/nologin goverhub
install -d -o root -g goverhub -m 750 "$ROOT" "$ROOT/app" "$ROOT/app/releases"
install -d -o goverhub -g goverhub -m 750 "$ROOT/evidence" "$ROOT/var"
install -d -o root -g caddy -m 755 "$ROOT/web"
install -d -o root -g goverhub -m 750 "$ETC"

step "4/9 Ortam dosyası (ilk kurulumda bu sunucuda üretilir)"
if [[ ! -f "$ENVF" ]]; then
  gen() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40; }
  OWNER_PW=$(gen); APP_PW=$(gen)
  cat > "$ENVF" <<ENV
# GoverHub TEST ortamı — install.sh üretti. Yalnızca demo verisi. Paylaşma, depoya koyma.
DATABASE_URL=postgres://goverhub_app:$APP_PW@127.0.0.1:5432/goverhub_demo
DATABASE_OWNER_URL=postgres://goverhub_owner:$OWNER_PW@127.0.0.1:5432/goverhub_demo
EVIDENCE_DIR=$ROOT/evidence
PORT=3000
HOST=127.0.0.1
TRUST_PROXY=127.0.0.1
CORS_ORIGINS=
DEMO_MODE=true
# Yalnızca bu uzantılı demo adresleri giriş yapabilir / davet edilebilir.
DEMO_LOGIN_DOMAIN=demo.goverhub.test
MAIL_TRANSPORT=dev_outbox
MAIL_PRODUCTION_READY=false
MFA_ENCRYPTION_KEY=$(openssl rand -base64 32)
# Test ortamında platform rollerine ek doğrulama zorunlu değil (telefonda hızlı deneme için).
# Pilot ortamında zorunludur (deploy/pilot.env.example).
MFA_REQUIRED_FOR_PLATFORM=false
PUBLIC_BASE_URL=https://$DOMAIN
ENV
  chown root:goverhub "$ENVF"; chmod 640 "$ENVF"
  echo "Yeni ortam dosyası üretildi: $ENVF"
else
  sed -i "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=https://$DOMAIN#" "$ENVF"
  grep -q '^DEMO_LOGIN_DOMAIN=' "$ENVF" || echo 'DEMO_LOGIN_DOMAIN=demo.goverhub.test' >> "$ENVF"
  grep -q '^DEMO_MODE=true$' "$ENVF" || fail "$ENVF DEMO_MODE=true içermiyor; bu betik yalnızca test (demo) ortamı kurar."
  echo "Mevcut ortam dosyası korundu."
fi
envval() { grep -E "^$1=" "$ENVF" | head -1 | cut -d= -f2-; }
pw_of() { envval "$1" | sed -E 's#^postgres://[^:]+:([^@]+)@.*#\1#'; }
OWNER_PW=$(pw_of DATABASE_OWNER_URL); APP_PW=$(pw_of DATABASE_URL)

step "5/9 PostgreSQL rolleri ve veritabanı (goverhub_demo)"
psql_su() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -qtA "$@"; }
for pair in "goverhub_owner:$OWNER_PW" "goverhub_app:$APP_PW"; do
  role=${pair%%:*}; pw=${pair#*:}
  if [[ -z "$(psql_su -c "SELECT 1 FROM pg_roles WHERE rolname='$role'")" ]]; then
    psql_su -c "CREATE ROLE $role LOGIN PASSWORD '$pw'"
  else
    psql_su -c "ALTER ROLE $role LOGIN PASSWORD '$pw'"
  fi
done
if [[ -z "$(psql_su -c "SELECT 1 FROM pg_database WHERE datname='goverhub_demo'")" ]]; then
  psql_su -c "CREATE DATABASE goverhub_demo OWNER goverhub_owner"
fi
psql_su -d goverhub_demo -c "REVOKE ALL ON DATABASE goverhub_demo FROM PUBLIC; GRANT CONNECT ON DATABASE goverhub_demo TO goverhub_app"

step "6/9 Uygulama sürümü $SHA"
REL="$ROOT/app/releases/$SHA"
rm -rf "$REL.tmp"; install -d -o root -g goverhub -m 750 "$REL.tmp"
tar -xzf "$RELEASE" -C "$REL.tmp" --no-same-owner
[[ -f "$REL.tmp/server/package-lock.json" ]] || fail "Sürüm paketi beklenen yapıda değil."
(cd "$REL.tmp/server" && /usr/local/bin/npm ci --no-audit --no-fund --loglevel=error)
chown -R root:goverhub "$REL.tmp"; chmod -R g+rX,o-rwx "$REL.tmp"
rm -rf "$REL"; mv "$REL.tmp" "$REL"

step "7/9 Şema ve demo verisi"
runenv() {
  # shellcheck disable=SC1090
  (set -a; . "$ENVF"; set +a; cd "$REL/server" && runuser -p -u goverhub -- /usr/local/bin/node node_modules/tsx/dist/cli.mjs "$@"); }
runenv src/db/migrate.ts
runenv src/seed/run.ts

step "8/9 Servis ve web uygulaması"
ln -sfn "$REL" "$ROOT/app/current"
install -m 644 "$REL/deploy/test/goverhub-test-api.service" /etc/systemd/system/goverhub-test-api.service
systemctl daemon-reload
systemctl enable goverhub-test-api >/dev/null
systemctl restart goverhub-test-api
ok=""
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[[ -n "$ok" ]] || { journalctl -u goverhub-test-api -n 40 --no-pager; fail "API 30 sn içinde yanıt vermedi."; }
echo "API çalışıyor: $(curl -fsS http://127.0.0.1:3000/env)"

WEBNEW="$ROOT/web.new"; rm -rf "$WEBNEW"; install -d -o root -g caddy -m 755 "$WEBNEW"
tar -xzf "$WEB" -C "$WEBNEW" --no-same-owner
[[ -f "$WEBNEW/index.html" ]] || fail "Web paketi index.html içermiyor."
chmod -R a+rX "$WEBNEW"
rm -rf "$ROOT/web.old"; mv "$ROOT/web" "$ROOT/web.old"; mv "$WEBNEW" "$ROOT/web"; rm -rf "$ROOT/web.old"

step "9/9 HTTPS vekil (Caddy) ve güvenlik duvarı"
COOKIE=$(printf 'goverhub-test-cookie:%s' "$TOKEN" | sha256sum | cut -c1-64)
SITE=/etc/caddy/goverhub-test.caddy
sed -e "s#__ALAN_ADI__#$DOMAIN#g" -e "s#__ERISIM_YOLU__#/erisim/$TOKEN#g" -e "s#__CEREZ__#$COOKIE#g" \
  "$REL/deploy/test/Caddyfile.template" > "$SITE.new"
chown root:caddy "$SITE.new"; chmod 640 "$SITE.new"; mv "$SITE.new" "$SITE"
MAIN=/etc/caddy/Caddyfile
if ! grep -qx 'import /etc/caddy/goverhub-test.caddy' "$MAIN" 2>/dev/null; then
  # Yalnızca Ubuntu'nun varsayılan dosyası değiştirilir; başka bir yapılandırmanın üzerine yazılmaz.
  if [[ ! -s "$MAIN" ]] || grep -q '/usr/share/caddy' "$MAIN"; then
    [[ -s "$MAIN" ]] && cp "$MAIN" "$MAIN.ubuntu-varsayilan"
    printf '%s\n' '# GoverHub test ortamı (install.sh)' 'import /etc/caddy/goverhub-test.caddy' > "$MAIN"
  else
    fail "$MAIN özelleştirilmiş görünüyor; üzerine yazılmadı. İçine şu satırı ekleyip tekrar çalıştırın: import /etc/caddy/goverhub-test.caddy"
  fi
fi
caddy validate --config "$MAIN" --adapter caddyfile >/dev/null 2>&1 || { caddy validate --config "$MAIN" --adapter caddyfile; fail "Caddy yapılandırması geçersiz."; }
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy

# SSH bağlantısının kesilmemesi için SSH portu açıkça verilir (sudo, SSH_CONNECTION'ı taşımaz).
[[ -n "$SSH_PORT" ]] || SSH_PORT=$(echo "${SSH_CONNECTION:-}" | awk '{print $4}')
[[ "$SSH_PORT" =~ ^[0-9]+$ ]] || fail "SSH portu belirlenemedi; --ssh-port ile verin (güvenlik duvarı açılmadı)."
ufw allow "$SSH_PORT/tcp" >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
echo "Güvenlik duvarı: yalnızca $SSH_PORT (SSH), 80 ve 443 açık. API (3000) dışarıya kapalı."

# Eski sürümler: son 3 sürüm tutulur.
ls -1dt "$ROOT"/app/releases/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf

echo
echo "Kurulum tamam: https://$DOMAIN (sürüm $SHA). Ortam: TEST · yalnızca demo verisi."
