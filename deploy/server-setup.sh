#!/bin/sh
# One-time setup of a fresh Ubuntu 24.04 server for FinSight360.
# Run as root:  sh deploy/server-setup.sh
set -e
echo "▶ Updating the system…"
apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -y upgrade
apt-get install -y ca-certificates curl git ufw unattended-upgrades fail2ban
echo "▶ Automatic security updates…"
dpkg-reconfigure -f noninteractive unattended-upgrades
echo "▶ Firewall: only SSH, HTTP and HTTPS…"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
echo "▶ Docker…"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
systemctl enable --now docker
echo "▶ Swap (the build needs memory on small servers)…"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo "✔ Server ready."
