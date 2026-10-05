#!/bin/sh
# Restores a pg_dump (-Fc) file into the server database. REPLACES current data.
# Usage:  sh deploy/restore.sh backups/finsight360-2026-10-05.dump
set -e
FILE="$1"
if [ ! -f "$FILE" ]; then echo "Usage: sh deploy/restore.sh <file.dump>"; exit 1; fi
C="docker compose -f docker-compose.prod.yml"
echo "Stopping the app…"
$C stop app
$C exec -T db pg_restore -U finsight -d finsight360 --clean --if-exists --no-owner --no-privileges < "$FILE"
echo "Starting the app (it applies any newer migrations)…"
$C start app
echo "Restore finished."
