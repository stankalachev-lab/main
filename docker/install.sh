#!/bin/bash
set -e

echo "=== CRM Analytics — Server Setup ==="

# ── 1. System update ──────────────────────────────────────────────────────
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Docker ─────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

# ── 3. Git ────────────────────────────────────────────────────────────────
apt-get install -y -qq git

# ── 4. Clone repo ─────────────────────────────────────────────────────────
if [ ! -d /opt/crm-analytics ]; then
  git clone -b claude/intelligent-bardeen-a14gdu \
    https://github.com/stankalachev-lab/main.git \
    /opt/crm-analytics
else
  git -C /opt/crm-analytics pull
fi

# ── 5. Create .env ────────────────────────────────────────────────────────
cd /opt/crm-analytics/docker

if [ ! -f .env ]; then
  cp .env.template .env
  # Auto-generate secrets
  PG_PASS=$(openssl rand -hex 16)
  JWT_SECRET=$(openssl rand -hex 32)
  sed -i "s/change_me_strong_password/$PG_PASS/" .env
  sed -i "s/change_me_jwt_secret/$JWT_SECRET/" .env
  echo ""
  echo ">>> .env created with auto-generated secrets."
fi

# ── 6. Open firewall ports ────────────────────────────────────────────────
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
echo "y" | ufw enable || true

# ── 7. Start stack ────────────────────────────────────────────────────────
docker compose -f docker-compose.yml up -d --build

echo ""
echo "=== Done! ==="
echo "API running at: http://187.77.122.166"
echo ""
echo "Next step — create admin user:"
echo "  docker compose -f /opt/crm-analytics/docker/docker-compose.yml exec api node dist/cli.js create-user"
