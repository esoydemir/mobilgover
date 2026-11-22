#!/bin/bash
# usage: t8-horizon.sh <db> <iso-time> [days]
cd /c/dev/goverhub-pilot/src/server
DEMO_MODE=true DATABASE_URL=postgres://goverhub_app:apppw@127.0.0.1:55499/$1 DATABASE_OWNER_URL=postgres://goverhub_owner:ownerpw@127.0.0.1:55499/$1 npx tsx scripts/synthetic-horizon-run.ts "$2" "${3:-14}" 2>&1 | tail -3
docker exec gh-test-db psql -U goverhub_owner -d $1 -Atc "SELECT 'GOREVLER: '||coalesce(string_agg(to_char(t.due_at AT TIME ZONE 'Europe/Istanbul','YYYY-MM-DD'), ', ' ORDER BY t.due_at),'-') FROM tasks t JOIN rules r ON r.id=t.rule_id WHERE r.code='EX-ESTATE-DOSYA-AYLIK'"
