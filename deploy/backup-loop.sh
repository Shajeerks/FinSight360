#!/bin/sh
# Daily PostgreSQL backup at ~02:30 server time, keeping KEEP_DAYS days.
# Files land in ./backups on the server: finsight360-YYYY-MM-DD.dump
set -e
backup() {
  f="/backups/finsight360-$(date +%F).dump"
  pg_dump -h db -U finsight -d finsight360 -Fc -f "$f.tmp" && mv "$f.tmp" "$f"
  echo "backup written: $f"
  find /backups -name 'finsight360-*.dump' -mtime +"${KEEP_DAYS:-14}" -delete
}
[ -n "$(ls /backups/finsight360-*.dump 2>/dev/null)" ] || backup
while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%F) 02:30" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  backup || echo "backup failed"
done
