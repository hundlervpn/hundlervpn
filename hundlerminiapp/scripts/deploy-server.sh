#!/bin/bash
set -e

DOMAIN="hundlervpn.xyz"
EMAIL="admin@hundlervpn.xyz"
APP_DIR="/opt/hundlervpn"

echo "=== HundlerVPN Server Deploy ==="

# 1. Update system & install Docker
echo "[1/6] Installing Docker..."
apt-get update -y
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 2. Clone repo
echo "[2/6] Cloning repository..."
if [ -d "$APP_DIR" ]; then
  echo "Directory exists, pulling latest..."
  cd "$APP_DIR"
  git pull origin main
else
  git clone https://github.com/hundlervpn/hundlervpn.git "$APP_DIR"
  cd "$APP_DIR"
fi

# 3. Create .env file
echo "[3/6] Setting up .env..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "!!! IMPORTANT: Edit /opt/hundlervpn/.env with your production values !!!"
  echo "Run: nano /opt/hundlervpn/.env"
  echo "Then re-run this script."
  echo ""
fi

# 4. Create required directories
echo "[4/6] Creating directories..."
mkdir -p certbot/www certbot/conf

# 5. Get SSL certificate (first time)
echo "[5/6] Obtaining SSL certificate..."
if [ ! -d "certbot/conf/live/$DOMAIN" ]; then
  # Use no-ssl config first
  cp nginx/conf.d/default.conf nginx/conf.d/default.conf.bak
  cp nginx/conf.d/default.conf.nossl nginx/conf.d/default.conf

  # Start nginx + app
  docker compose up -d app nginx

  # Wait for nginx to be ready
  sleep 5

  # Get certificate
  docker compose run --rm certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN" \
    -d "www.$DOMAIN"

  # Stop containers
  docker compose down

  # Restore SSL config
  cp nginx/conf.d/default.conf.bak nginx/conf.d/default.conf
  rm nginx/conf.d/default.conf.bak

  echo "SSL certificate obtained!"
else
  echo "SSL certificate already exists."
fi

# 6. Start everything
echo "[6/6] Starting all services..."
docker compose up -d --build

echo ""
echo "=== Deploy complete! ==="
echo "Site: https://$DOMAIN"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f        # View logs"
echo "  docker compose restart app    # Restart app"
echo "  docker compose down           # Stop all"
echo "  docker compose up -d --build  # Rebuild & start"
