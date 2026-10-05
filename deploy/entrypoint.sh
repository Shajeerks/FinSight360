#!/bin/sh
# Container start: apply database migrations, load reference data (categories,
# settings — never demo data in production), then start the app.
set -e
cd /app
echo "▶ Applying database migrations…"
node_modules/.bin/prisma migrate deploy
echo "▶ Loading reference data…"
node_modules/.bin/tsx prisma/seed.ts
echo "▶ Starting FinSight360 on port ${PORT:-3010}"
exec node_modules/.bin/next start --port "${PORT:-3010}" --hostname 0.0.0.0
