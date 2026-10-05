# Putting FinSight360 live (your own server)

This guide runs FinSight360 on a small cloud server with HTTPS, a private database and daily backups. Everything runs in Docker with one command. Allow about 45 minutes the first time.

```
Internet ──HTTPS──▶ Caddy (automatic certificate) ──▶ FinSight360 app ──▶ PostgreSQL (private)
                                                                 └──▶ daily backups (./backups)
```

The database is never reachable from the internet. The only open ports are 22 (SSH), 80 and 443.

---

## What you need

| | |
|---|---|
| **A server** | Ubuntu 24.04, **2 GB RAM**, 1–2 vCPU, 25 GB+ disk. Any provider works: DigitalOcean (Bangalore region), AWS Lightsail (Mumbai), Hetzner (Singapore), Linode/Akamai (Mumbai). Check the current price on the provider's site; the smallest 2 GB plan is enough. Pick a region close to you. |
| **A web address** | Either your own domain (for example `money.yourname.in`, bought from any registrar) or a free one: `<server-ip-with-dashes>.sslip.io` (for example `203-0-113-10.sslip.io`). The free one needs no setup. |
| **An SSH key** | Most providers let you add one when you create the server. On your Mac: `ssh-keygen -t ed25519`, then paste the contents of `~/.ssh/id_ed25519.pub` into the provider. |

---

## Step 1 — Create the server

1. In your provider's dashboard, create an **Ubuntu 24.04** server with **2 GB RAM** and add your SSH key.
2. Note its **public IP address**, for example `203.0.113.10`.
3. **If you use your own domain:** at your domain registrar, add an **A record** for `money.yourname.in` pointing to that IP. Wait a few minutes.
   **If you use sslip.io:** nothing to do. `203-0-113-10.sslip.io` already points to `203.0.113.10`.

## Step 2 — Prepare the server (once)

On your Mac, connect:

```
ssh root@203.0.113.10
```

On the server:

```
git clone https://github.com/Shajeerks/FinSight360.git /opt/finsight360
```

If the repository is **private**, GitHub asks for a username and password. Use `Shajeerks` and a personal access token with read access, not your GitHub password.

```
cd /opt/finsight360
```
```
sh deploy/server-setup.sh
```

This installs Docker, turns on the firewall (SSH, HTTP and HTTPS only), turns on automatic security updates, and adds swap memory.

## Step 3 — Create the server's settings

Use your own address in place of `money.yourname.in`:

```
sh deploy/make-env.sh money.yourname.in
```

This creates `/opt/finsight360/.env` with strong random secrets. Only root can read it. It never goes to GitHub.

To change settings later (email, sign-ups):

```
nano .env
```

## Step 4 — Start FinSight360

```
docker compose -f docker-compose.prod.yml up -d --build
```

The first build takes 5–10 minutes. The app then:

- applies the database migrations,
- loads categories and settings (no demo data),
- starts behind HTTPS.

Check it:

```
docker compose -f docker-compose.prod.yml ps
```
```
docker compose -f docker-compose.prod.yml logs -f app
```

Press `Ctrl+C` to stop watching the logs; the app keeps running.

Open **https://money.yourname.in**. The certificate is issued automatically on the first visit, which can take up to a minute.

## Step 5 — Create your account and lock sign-ups

1. Open `https://money.yourname.in/register` and create **your** account.
2. Turn off sign-ups so nobody else can register. Edit `.env`:
   ```
   nano .env
   ```
   Change `ALLOW_REGISTRATION="true"` to `ALLOW_REGISTRATION="false"`, save (`Ctrl+O`, `Enter`, `Ctrl+X`), then apply:
   ```
   docker compose -f docker-compose.prod.yml up -d
   ```

## Step 6 — Install it on your iPhone

Open the address in **Safari** → **Share** → **Add to Home Screen**. FinSight360 opens full-screen with its own icon. In the app, go to **Notifications** → **Allow on this device** for browser alerts.

---

## Optional: move the data you already entered on your Mac

On your **Mac** (with the local database running):

```
"$(brew --prefix postgresql@16)/bin/pg_dump" -h localhost -p 5433 -U finsight -Fc finsight360 -f ~/finsight360-mac.dump
```
```
scp ~/finsight360-mac.dump root@203.0.113.10:/opt/finsight360/backups/
```

On the **server**:

```
cd /opt/finsight360
```
```
sh deploy/restore.sh backups/finsight360-mac.dump
```

This **replaces** the server's data with your Mac's, including your account and password. Do it before you enter anything on the server, then do Step 5's sign-up lock. Uploaded statement files stay on the Mac; the transactions themselves come across.

## Optional: email (password reset + notification emails)

Gmail example: create an **App Password** (Google Account → Security → 2-Step Verification → App passwords). Then, in `.env`:

```
EMAIL_TRANSPORT="smtp"
EMAIL_FROM="FinSight360 <yourname@gmail.com>"
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="yourname@gmail.com"
SMTP_PASSWORD="the 16-letter app password"
```

Apply with `docker compose -f docker-compose.prod.yml up -d`. Notification emails stay **off** until you switch them on in the app.

## Optional: Google sign-in / Gmail / Outlook import

In Google Cloud Console or Azure, add redirect URIs with your HTTPS address:

- `https://money.yourname.in/api/auth/callback/google`
- `https://money.yourname.in/api/email/callback/gmail`
- `https://money.yourname.in/api/email/callback/outlook`

Then fill the matching `*_CLIENT_ID` / `*_CLIENT_SECRET` values in `.env` and apply.

---

## Everyday operations

All commands run on the server, inside `/opt/finsight360`.

| Task | Command |
|---|---|
| **Update to the latest code** (after you push to GitHub) | `git pull` then `docker compose -f docker-compose.prod.yml up -d --build` |
| See status | `docker compose -f docker-compose.prod.yml ps` |
| See app logs | `docker compose -f docker-compose.prod.yml logs --tail 100 app` |
| Restart | `docker compose -f docker-compose.prod.yml restart app` |
| Stop everything | `docker compose -f docker-compose.prod.yml down` (your data is kept) |
| List backups | `ls -lh backups` |
| Back up right now | `docker compose -f docker-compose.prod.yml exec backup sh -c 'pg_dump -h db -U finsight -d finsight360 -Fc -f /backups/manual-$(date +%F-%H%M).dump'` |
| Restore a backup | `sh deploy/restore.sh backups/<file>.dump` |

Updates apply new database migrations automatically when the app restarts.

### Backups: keep a copy off the server

The server keeps 14 days of daily backups in `/opt/finsight360/backups`. If the server itself is lost, those go with it, so copy them to your Mac now and then:

```
scp "root@203.0.113.10:/opt/finsight360/backups/*.dump" ~/FinSight360-backups/
```

Many providers also offer automatic server snapshots for a small extra fee. Worth turning on.

---

## Security checklist

- [ ] Sign-ups turned off after creating your account (`ALLOW_REGISTRATION="false"`).
- [ ] A strong, unique password on your FinSight360 account.
- [ ] `.env` never copied anywhere public; it holds the keys that protect your data.
- [ ] Server snapshots or regular off-server backup copies.
- [ ] Log in with SSH keys only. Optional hardening: set `PasswordAuthentication no` in `/etc/ssh/sshd_config`, then `systemctl restart ssh`.

## Troubleshooting

| Problem | Fix |
|---|---|
| Browser shows a certificate error | Make sure the domain's A record points to the server and ports 80/443 are open; then `docker compose -f docker-compose.prod.yml logs caddy`. |
| "Refusing to start in production" in app logs | `AUTH_SECRET` is missing or weak. Recreate `.env` with `deploy/make-env.sh` (rename the old one first). |
| Build stops with "killed" | Not enough memory. Make sure swap exists (`swapon --show`) or use a 2 GB+ server. |
| Page shows "You're offline" | The server is down or unreachable. Check `docker compose -f docker-compose.prod.yml ps`. |
