#!/bin/bash
# RoadAssist Bharat on one EC2 instance (Amazon Linux 2023).
#
# Paste this whole file into "Advanced details -> User data" when launching the
# instance (deploy/aws/README.md, step 3). It installs Docker, writes the
# compose file below and starts it. It contains NO secrets: the database URLs
# and the rest of the environment go into /opt/roadassist/.env, which you write
# yourself afterwards (README step 5). Until that file exists the app container
# waits and Caddy answers 502.
set -euo pipefail

dnf install -y docker
systemctl enable --now docker
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

mkdir -p /opt/roadassist
cd /opt/roadassist

# Cloudflare sits in front (SSL/TLS mode "Full"), so the origin only needs a
# certificate Cloudflare will accept: Caddy's internal CA is enough, and no
# port-80 ACME challenge has to get through the proxy.
cat > Caddyfile <<'CADDY'
# The site must be named: with a bare :443 Caddy has no name to issue the
# internal certificate for, and every TLS handshake fails.
app.roadassistbharat.online {
  tls internal
  encode zstd gzip
  reverse_proxy app:8080
}
:80 {
  redir https://{host}{uri} permanent
}
CADDY

# The same image Render builds, published by .github/workflows/publish-image.yml.
cat > compose.yml <<'COMPOSE'
services:
  app:
    image: ghcr.io/saatwik-1157/roadassist-bharat:latest
    command: ["./docker-start.sh"]
    env_file: .env
    restart: unless-stopped
    volumes:
      - uploads:/repo/app/var/uploads
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    depends_on: [app]
    restart: unless-stopped
volumes:
  uploads:
  caddy_data:
COMPOSE

# Started by README step 5, once .env is written:
#   cd /opt/roadassist && sudo docker compose up -d
