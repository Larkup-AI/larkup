# Deploying the Knowledge Server on Docker / VPS

This runbook deploys a Larkup Knowledge Server to any VPS or dedicated server using Docker Compose. Docker/VPS is the **primary MVP deploy target** for TASK 01.

## Prerequisites

- VPS with Ubuntu 22.04 or 24.04 (Hetzner, DigitalOcean, Linode, etc.)
- Docker and Docker Compose installed
- SSH access to the server

## 1. Install Docker on the VPS

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and log back in to apply group membership
```

## 2. Download the Knowledge Server bundle

From the Larkup dashboard → **Knowledge Server** → **Deploy to cloud** → **Download bundle**.

Or via SSH deploy from the dashboard (fills in all env vars automatically).

## 3. Upload the bundle and configure

```bash
# Upload bundle to VPS
scp my-knowledge-server.zip user@your-vps-ip:~/
ssh user@your-vps-ip

# On the VPS
unzip my-knowledge-server.zip
cd my-knowledge-server
cp .env.example .env
nano .env  # Fill in required values
```

### Required env vars

```bash
EMBEDDING_API_KEY=sk-...          # OpenAI or other embedding provider
CHAT_API_KEY=sk-...               # Chat provider API key

# Scoped API keys (ADR-004)
# Format: scope:key,scope:key,...
# Scopes: retrieval, ingest, admin
SERVER_API_KEYS=retrieval:rk_your_key,ingest:ik_your_key,admin:ak_your_key

# LanceDB persistent storage (local mode is fine for VPS — volume mount provides persistence)
LANCEDB_MODE=local
```

## 4. Deploy with Docker Compose

```bash
docker compose up -d --build
```

This starts the Knowledge Server with:
- **Persistent volume** (`larkup_data`) for LanceDB data
- **Health check** every 30 seconds
- **Restart policy** `unless-stopped`

## 5. Verify the deployment

```bash
# Health check
curl http://localhost:8080/health
# Expected: {"ok":true,"type":"knowledge-server"}

# Readiness check (checks vector store connection)
curl http://localhost:8080/readiness
# Expected: {"ready":true,"vectorStore":"connected","documents":N}
```

## 6. Point a domain at it (optional)

```bash
# Install Caddy as a reverse proxy with automatic HTTPS
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install caddy

# /etc/caddy/Caddyfile
cat > /etc/caddy/Caddyfile <<'EOF'
your-domain.com {
    reverse_proxy localhost:8080
}
EOF

systemctl reload caddy
```

## 7. Redeploy (pull new version)

```bash
docker compose pull
docker compose up -d --build
```

## 8. Rollback

```bash
# List images
docker images | grep knowledge-server

# Roll back by tagging and restarting
docker compose down
docker tag my-knowledge-server-larkup:previous my-knowledge-server-larkup:latest
docker compose up -d
```

## 9. View logs

```bash
docker compose logs -f
```

## Data persistence

Local LanceDB data is stored in a Docker named volume (`larkup_data`). It **persists across container restarts and upgrades** — you do not need to re-index after a redeploy.

To back up:
```bash
docker run --rm -v larkup_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/larkup-backup-$(date +%Y%m%d).tar.gz /data
```
