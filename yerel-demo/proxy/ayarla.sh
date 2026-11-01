#!/bin/sh
# Tünel erişim anahtarını üretir (yoksa ya da --yeni verilirse) ve Caddy yapılandırmasını yazar.
# Anahtar yalnızca bu birimde durur (/data/goverhub); hiçbir porta yayınlanmaz.
set -eu
D=/data/goverhub
mkdir -p "$D"; chmod 700 "$D"
if [ "${1:-}" = "--yeni" ] || [ ! -s "$D/erisim-anahtari" ]; then
  head -c 32 /dev/urandom | sha256sum | cut -c1-40 > "$D/erisim-anahtari"
  chmod 600 "$D/erisim-anahtari"
fi
ANAHTAR=$(cat "$D/erisim-anahtari")
CEREZ=$(printf 'goverhub-yerel-cerez:%s' "$ANAHTAR" | sha256sum | cut -c1-64)
sed -e "s#__ANAHTAR__#$ANAHTAR#g" -e "s#__CEREZ__#$CEREZ#g" /etc/goverhub/Kapi.sablon > "$D/Caddyfile.yeni"
mv "$D/Caddyfile.yeni" "$D/Caddyfile"
if [ "${1:-}" = "--yeni" ]; then
  # Çalışan kapıya yeni anahtarı yükle (kapı yeni açıldıysa yönetim arayüzünü birkaç saniye bekle).
  i=0
  until caddy reload --config "$D/Caddyfile" --adapter caddyfile >/dev/null 2>&1; do
    i=$((i+1)); [ "$i" -ge 15 ] && { echo "Kapı yapılandırması yüklenemedi." >&2; exit 1; }
    sleep 1
  done
fi
