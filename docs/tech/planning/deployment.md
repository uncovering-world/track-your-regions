# Deployment Planning

> **Implementation Status:** This is a planning document. Deployment infrastructure is not yet set up.

---

## Modern Hosting Options (2025)

Before diving into DIY deployment, consider these managed platforms that handle infrastructure automatically:

### Recommended: Managed PaaS Platforms

| Platform | Best For | Pricing | PostGIS Support | Notes |
|----------|----------|---------|-----------------|-------|
| **[Railway](https://railway.app)** | Full-stack apps | Usage-based (~$5-20/mo) | ✅ Native | Excellent DX, GitHub integration, easy PostGIS |
| **[Render](https://render.com)** | Production apps | Free tier + $7/mo | ✅ Native | Good free tier, auto-deploy from Git |
| **[Fly.io](https://fly.io)** | Global edge deploy | Usage-based (~$5-15/mo) | ✅ Via Supabase/Neon | Great for geo apps, edge locations |
| **[Supabase](https://supabase.com)** | Database + Auth | Free tier + $25/mo | ✅ Native PostGIS | Managed Postgres, could replace our auth |
| **[Neon](https://neon.tech)** | Serverless Postgres | Free tier + usage | ✅ PostGIS extension | Serverless, scales to zero |

### Self-Hosted PaaS (On Your Own VPS)

| Platform | Description | Complexity |
|----------|-------------|------------|
| **[Coolify](https://coolify.io)** | Self-hosted Vercel/Netlify alternative | Medium |
| **[Dokku](https://dokku.com)** | Mini-Heroku on your server | Medium |
| **[CapRover](https://caprover.com)** | Easy Docker deployment | Low |

### Cloud Providers (More Control)

| Provider | Service | Notes |
|----------|---------|-------|
| **DigitalOcean** | Droplets + Managed DB | Good balance of simplicity/control |
| **Hetzner** | VPS | Best price in EU, great for GDPR |
| **AWS** | App Runner / ECS | Enterprise-grade, complex |
| **Google Cloud** | Cloud Run | Serverless containers, good free tier |

### Recommended Stack for This Project

**Option A: Easiest (Managed)**
- **Railway** for backend + PostGIS database
- **Vercel** or **Netlify** for frontend static hosting
- Total: ~$10-25/month

**Option B: Self-Hosted (More Control)**
- **Hetzner** or **DigitalOcean** VPS (~$6-12/mo)
- **Coolify** or **Dokku** for deployment
- Total: ~$6-15/month

**Option C: DIY (Maximum Control)**
- DigitalOcean/Hetzner droplet
- Docker Compose + Caddy (detailed below)
- Total: ~$6-12/month

---

## Option C: DIY DigitalOcean Deployment (Detailed)

## Goal
Add all necessary scripts and configs to deploy the app to a DigitalOcean droplet with:
- Docker Compose for all services
- Caddy for reverse proxy + automatic SSL
- Ability to upload local database dump to server

## Files to Create

### 1. `docker-compose.prod.yml`
Production Docker Compose with Caddy, backend, and PostGIS.

```yaml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
      - ./frontend/dist:/srv/frontend
    depends_on:
      - backend

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile.prod
    restart: unless-stopped
    env_file: .env
    environment:
      - NODE_ENV=production
    depends_on:
      - db

  db:
    image: postgis/postgis:16-3.4-alpine
    restart: unless-stopped
    env_file: .env
    environment:
      - POSTGRES_DB=${DB_NAME}
      - POSTGRES_USER=${DB_USER}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d

volumes:
  postgres_data:
  caddy_data:
  caddy_config:
```

### 2. `Caddyfile`
Caddy config with automatic SSL.

```caddyfile
{$DOMAIN:localhost} {
    root * /srv/frontend
    file_server
    try_files {path} /index.html

    handle /api/* {
        reverse_proxy backend:3000
    }

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }

    encode gzip
}
```

### 3. `backend/Dockerfile.prod`
Production Dockerfile for backend (multi-stage build).

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

Note: Keep existing `Dockerfile` for development. Production compose uses `Dockerfile.prod`.

### 4. `scripts/setup-server.sh`
One-time server setup script.

- Install Docker and Docker Compose
- Configure firewall (ufw)
- Create /app directory
- Set up automatic Docker cleanup (prune)

### 5. `scripts/deploy.sh`
Deploy updates to server.

- Build frontend locally with production VITE_API_URL
- Build backend TypeScript
- Sync files to server (rsync, excluding .env, node_modules, dumps)
- Rebuild and restart containers on server

### 6. `scripts/db-upload.sh`
Upload and restore a local database dump to the server.

```bash
# Usage: ./scripts/db-upload.sh path/to/dump.dump

# 1. Copy dump file to server
# 2. Stop backend (to avoid connections)
# 3. Run pg_restore inside db container
# 4. Restart backend
```

### 7. Update `.env.example`
Add production-specific variables:

```bash
# Domain (for Caddy)
DOMAIN=yourdomain.com

# Database
DB_HOST=db
DB_PORT=5432
DB_NAME=track_regions
DB_USER=postgres
DB_PASSWORD=change_me

# Backend
NODE_ENV=production
PORT=3000

# Frontend build-time
VITE_API_URL=https://yourdomain.com/api
```

### 8. Update `.gitignore`
Add:
```
.env.prod
*.dump
```

### 9. `docs/deployment.md`
Comprehensive deployment guide covering:
- Prerequisites
- First-time server setup
- DNS configuration
- Initial deployment
- Uploading database
- Regular deploys
- Troubleshooting

### 10. Update `package.json`
Add deployment scripts:

```json
{
  "scripts": {
    "deploy": "./scripts/deploy.sh",
    "deploy:setup": "./scripts/setup-server.sh",
    "deploy:db": "./scripts/db-upload.sh"
  }
}
```

---

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `docker-compose.prod.yml` | Create | Production compose with Caddy |
| `Caddyfile` | Create | Reverse proxy + auto SSL |
| `backend/Dockerfile.prod` | Create | Production backend image (multi-stage) |
| `scripts/setup-server.sh` | Create | One-time server setup |
| `scripts/deploy.sh` | Create | Deploy code to server |
| `scripts/db-upload.sh` | Create | Upload DB dump to server |
| `.env.example` | Update | Add DOMAIN and production vars |
| `.gitignore` | Update | Exclude .env.prod and dumps |
| `docs/deployment.md` | Create | Deployment documentation |
| `package.json` | Update | Add deploy:* scripts |

---

## Deployment Workflow

### First Time
```bash
# 1. Create DO droplet (2GB RAM, Ubuntu 22.04)
# 2. Point DNS: yourdomain.com → droplet IP
# 3. SSH and run setup
ssh root@droplet-ip
curl -sSL https://raw.githubusercontent.com/.../setup-server.sh | bash

# 4. Create .env on server
nano /app/.env  # paste production secrets

# 5. Deploy from local
npm run deploy

# 6. Upload your database
npm run deploy:db -- ./db-backup.dump
```

### Regular Updates
```bash
# Just run deploy - it builds, syncs, and restarts
npm run deploy
```

### Database Updates
```bash
# Upload a new dump
npm run deploy:db -- ./new-backup.dump
```

---

## Verification

1. **Local test of production build:**
   ```bash
   npm run build
   docker compose -f docker-compose.prod.yml up
   # Visit http://localhost (Caddy serves without SSL locally)
   ```

2. **Server deployment:**
   ```bash
   npm run deploy
   # Visit https://yourdomain.com
   # Check SSL certificate is valid
   ```

3. **Database upload:**
   ```bash
   npm run deploy:db -- ./my-backup.dump
   # Verify data is loaded on server
   ```

---

## Security Notes

- `.env` files are never synced to server (created manually once)
- Database port not exposed externally
- Caddy handles SSL automatically
- UFW firewall allows only 22, 80, 443
