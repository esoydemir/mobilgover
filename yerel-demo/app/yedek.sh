#!/bin/sh
# Yedekleme araçlarının kapsayıcı içi girişi (yedek-*.cmd dosyaları bunu çağırır).
#   goverhub-yedek al | listele | dogrula [id] | anahtar | anahtar-goster | butunluk | geri-yukle [id]
# Şifreleme anahtarı ilk kullanımda üretilir ve AYAR biriminde durur; yedeklerin bulunduğu birimde DEĞİL.
set -eu
KEYF="${BACKUP_ENCRYPTION_KEY_FILE:-/var/lib/goverhub/ayar/yedek.key}"
if [ ! -s "$KEYF" ]; then
  node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" > "$KEYF"
  chmod 600 "$KEYF"
  echo "Yeni yedek anahtarı üretildi. Yedekler bu anahtar olmadan açılamaz: yedek-anahtari-goster.cmd ile alıp güvenli bir yerde saklayın (yedeklerin yanında DEĞİL)."
fi
cd /app/server
cmd="${1:-al}"; [ $# -gt 0 ] && shift
case "$cmd" in
  al)            exec npm run backup --silent ;;
  listele)       exec npm run backup:list --silent ;;
  dogrula)       exec npm run backup:verify --silent -- "$@" ;;
  anahtar)       exec npm run backup:key-check --silent -- "$@" ;;
  anahtar-goster) cat "$KEYF"; echo ;;
  butunluk)      exec npm run check:integrity --silent ;;
  geri-yukle)    exec npm run restore --silent -- "$@" ;;
  *) echo "Bilinmeyen komut: $cmd (al | listele | dogrula | anahtar | anahtar-goster | butunluk | geri-yukle)"; exit 2 ;;
esac
