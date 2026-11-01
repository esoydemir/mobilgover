#!/bin/sh
# API başlangıcı: şema güncellemesi, demo verisi (yalnızca ilk kez), eksik görevler, sonra API.
# Hiçbir adım mevcut kaydı silmez.
set -eu
KEYF=/var/lib/goverhub/ayar/mfa.key
if [ ! -s "$KEYF" ]; then
  node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" > "$KEYF"
  chmod 600 "$KEYF"
fi
MFA_ENCRYPTION_KEY="$(cat "$KEYF")"; export MFA_ENCRYPTION_KEY
TSX=node_modules/tsx/dist/cli.mjs
node "$TSX" src/db/migrate.ts
node "$TSX" src/seed/run.ts
exec node "$TSX" src/main.ts
