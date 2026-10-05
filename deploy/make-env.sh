#!/bin/sh
# Creates the server's .env with strong random secrets.
# Usage:  sh deploy/make-env.sh finance.example.com
set -e
DOMAIN="$1"
if [ -z "$DOMAIN" ]; then echo "Usage: sh deploy/make-env.sh your.domain"; exit 1; fi
if [ -f .env ]; then echo ".env already exists — not overwriting it."; exit 1; fi
rand() { openssl rand -base64 32 | tr -d '\n'; }
umask 077
cat > .env <<ENV
# FinSight360 production settings. Keep this file private; never commit it.
DOMAIN="$DOMAIN"
APP_URL="https://$DOMAIN"
AUTH_URL="https://$DOMAIN"
AUTH_SECRET="$(rand)"
TOKEN_ENCRYPTION_KEY="$(rand)"
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
SESSION_MAX_AGE_HOURS="168"

# Sign-ups: create your account, then set this to "false" and run the update command.
ALLOW_REGISTRATION="true"
REQUIRE_EMAIL_VERIFICATION="false"

# Email (password reset + notifications). Gmail: smtp.gmail.com, 587, an App Password.
EMAIL_TRANSPORT="console"
EMAIL_FROM="FinSight360 <you@example.com>"
SMTP_HOST=""
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASSWORD=""
SMTP_SECURE="false"

# Optional integrations (redirect URIs must use https://$DOMAIN/...)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GMAIL_CLIENT_ID=""
GMAIL_CLIENT_SECRET=""
MICROSOFT_CLIENT_ID=""
MICROSOFT_CLIENT_SECRET=""
MICROSOFT_TENANT_ID="common"
EMAIL_SYNC_INTERVAL_MINUTES="60"
BACKUP_KEEP_DAYS="14"
ENV
echo "Created .env for https://$DOMAIN (secrets generated, file readable only by you)."
