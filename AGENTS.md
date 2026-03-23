## Project Overview
- VPN service with Telegram Mini App
- Uses VLESS + Reality for VPN nodes
- Multi-server architecture

## Git Repository
- Always push to:
  https://github.com/hundlervpn/hundlervpn.git

### Web App
- Hosted on Timeweb
- Contains all environment variables
- Main frontend + API entry point

### Telegram Bot
- Runs on a separate VPS

### VPN Servers
- Each server runs separately
- Uses VLESS + Reality

## Database
- PostgreSQL

## Deployment

### Web App (Timeweb)
- Environment variables managed in Timeweb

### Bot
- Hosted on VPS (Ubuntu)

### VPN Nodes
- Manual or scripted deployment per server
- Each node isolated
