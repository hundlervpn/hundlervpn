#!/bin/bash
# Установщик Hundler VPN Agent
# Использование: curl -sSL https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/vpn-agent/install.sh | bash -s YOUR_API_KEY

set -e

API_KEY="${1:-}"
API_URL="${2:-https://hundler.ru/api/vpn/sync}"

if [ -z "$API_KEY" ]; then
    echo "Usage: $0 <API_KEY> [API_URL]"
    echo "Example: $0 sk_abc123xyz"
    exit 1
fi

echo "=== Hundler VPN Agent Installer ==="
echo "API Key: ${API_KEY:0:8}..."
echo "API URL: $API_URL"
echo ""

# Создаём директории
mkdir -p /opt/hundler-agent
mkdir -p /var/lib/hundler-agent

# Скачиваем агент
echo "Downloading agent..."
curl -sSL https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/vpn-agent/hundler-agent.sh -o /opt/hundler-agent/hundler-agent.sh
chmod +x /opt/hundler-agent/hundler-agent.sh

# Создаём systemd сервис
echo "Creating systemd service..."
cat > /etc/systemd/system/hundler-agent.service << EOF
[Unit]
Description=Hundler VPN Agent
After=network.target xray.service

[Service]
Type=simple
ExecStart=/opt/hundler-agent/hundler-agent.sh
Restart=always
RestartSec=10
Environment="HUNDLER_API_URL=$API_URL"
Environment="HUNDLER_API_KEY=$API_KEY"
Environment="XRAY_ACCESS_LOG=/var/log/xray/access.log"
Environment="SYNC_INTERVAL=60"

[Install]
WantedBy=multi-user.target
EOF

# Перезагружаем systemd
systemctl daemon-reload

# Включаем и запускаем сервис
systemctl enable hundler-agent
systemctl start hundler-agent

echo ""
echo "=== Installation complete! ==="
echo "Check status: systemctl status hundler-agent"
echo "View logs: journalctl -u hundler-agent -f"
