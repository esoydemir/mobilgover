#!/bin/sh
# ROL=vekil: yerel web + API vekili (localhost:8080). ROL=kapi: tünel için erişim kapısı.
set -eu
if [ "${ROL:-vekil}" = "kapi" ]; then
  /etc/goverhub/ayarla.sh
  exec caddy run --config /data/goverhub/Caddyfile --adapter caddyfile
fi
exec caddy run --config /etc/goverhub/Caddyfile.sablon --adapter caddyfile
