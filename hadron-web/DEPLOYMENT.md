# Hadron Web — Local Docker Deployment Guide

## Prerequisites

| Requirement | Version | Check |
|---|---|---|
| Docker Engine | 20.10+ | `docker --version` |
| Docker Compose | v2+ | `docker compose version` |
| Free RAM | ~2 GB | App (512 MB) + DB (1 GB) + build overhead |
| Free disk | ~5 GB | Rust build cache + Docker images |
| Ports available | 8080, 5432 | `lsof -i :8080` / `lsof -i :5432` |

> **WSL2 users:** Docker Desktop for Windows with WSL2 backend works. Ensure the Docker daemon is running (`docker info`).

---

## Quick Start (5 minutes)

```bash
cd hadron-web

# 1. Build both images (first build takes ~5-10 min for Rust compilation)
docker compose build

# 2. Start services
docker compose up -d

# 3. Verify
docker compose logs -f hadron-web
```

Wait for these log lines:

```
Connected to PostgreSQL
Migrations applied
Dev admin user seeded (id: 00000000-0000-0000-0000-000000000001)
Hadron Web listening on 0.0.0.0:8080
```

Open **http://localhost:8080** in your browser. You land directly in the app — no login required.

---

## What Gets Deployed

```
 docker compose
 |
 +-- hadron-web (port 8080)
 |   +-- Rust backend (Axum)      serves /api/*
 |   +-- React frontend (static)  serves /* with SPA fallback
 |
 +-- db (port 5432)
     +-- PostgreSQL 16 + pgvector
     +-- Named volume: pgdata (persists across restarts)
```

The Rust server runs 12 database migrations on startup, creating all tables automatically. No manual SQL needed.

---

## Configuration

### Environment Variables

All configuration is done via the `.env` file in `hadron-web/`. Default contents:

```env
DB_PASSWORD=hadron_dev
AUTH_MODE=dev
RUST_LOG=info
```

#### Full Variable Reference

| Variable | Default | Description |
|---|---|---|
| `DB_PASSWORD` | `hadron_dev` | PostgreSQL password (used by both app and db) |
| `AUTH_MODE` | `dev` | `dev` = no login required, pre-seeded admin user. Remove or set to `azure_ad` to require Azure AD login |
| `RUST_LOG` | `info` | Log level: `error`, `warn`, `info`, `debug`, `trace` |
| `OPENAI_API_KEY` | *(empty)* | Optional. Pre-configure an OpenAI key for the backend. Most users configure this in the UI instead |
| `AZURE_AD_TENANT_ID` | *(empty)* | Required only when `AUTH_MODE` is not `dev` |
| `AZURE_AD_CLIENT_ID` | *(empty)* | Required only when `AUTH_MODE` is not `dev` |

### Dev Mode (default)

When `AUTH_MODE=dev`:
- **Backend:** All API requests are authenticated as a pre-seeded admin user (`Dev Admin` / `dev@hadron.local`). No JWT validation occurs.
- **Frontend:** The Azure AD login page is skipped entirely. You go straight to the main app.
- **Dev user ID:** `00000000-0000-0000-0000-000000000001` (admin role)

### Azure AD Mode (production)

To enable real authentication:

1. Create an Azure AD App Registration
2. Set the redirect URI to `http://localhost:8080`
3. Update `.env`:

```env
AUTH_MODE=azure_ad
AZURE_AD_TENANT_ID=your-tenant-id
AZURE_AD_CLIENT_ID=your-client-id
```

4. Update `frontend/src/auth/msalConfig.ts` with matching client ID and tenant
5. Rebuild: `docker compose build && docker compose up -d`

---

## Configuring AI (Required for Analysis)

Hadron needs an AI API key to analyze crash logs. Configure this **after** the app is running:

1. Open **http://localhost:8080**
2. Click **Settings** in the top navigation bar
3. Choose your **Provider**: OpenAI or Anthropic
4. Select a **Model**:
   - OpenAI: `gpt-4o` (recommended), `gpt-4o-mini` (cheaper), `o1`, `o1-mini`
   - Anthropic: `claude-sonnet-4-6` (recommended), `claude-haiku-4-5-20251001`, `claude-opus-4-6`
5. Paste your **API Key**
6. Click **Save Settings**

> **Security note:** API keys are stored in your browser's session storage only. They are sent per-request to the backend for AI calls but never persisted server-side.

You can also pre-set an OpenAI key via environment variable (add to `.env`):

```env
OPENAI_API_KEY=sk-...
```

This makes the key available to the backend for server-initiated operations, but you still need to enter it in the Settings UI for the frontend to use it.

---

## Testing the Deployment

### Health Checks

```bash
# Liveness (server is running)
curl http://localhost:8080/api/health/live
# Expected: {"status":"alive"}

# Readiness (server + database are healthy)
curl http://localhost:8080/api/health
# Expected: {"status":"healthy","version":"0.1.0"}
```

### End-to-End Walkthrough

1. **Open the app:** http://localhost:8080 — should show the Analyze view
2. **Check profile:** Top-right shows "Dev Admin" with role "admin"
3. **Configure AI:** Go to Settings, enter an API key, save
4. **Run an analysis:** Go to Analyze, upload a crash log or paste crash text, click Analyze
5. **View history:** Go to History — your analysis should appear
6. **Try chat:** Go to Ask Hadron, type a question about crash analysis
7. **Explore other views:** Search, Signatures, Analytics, Releases, Admin

---

## Common Operations

### View Logs

```bash
# All services
docker compose logs -f

# App only
docker compose logs -f hadron-web

# Database only
docker compose logs -f db

# Last 100 lines
docker compose logs --tail=100 hadron-web
```

### Enable Debug Logging

Edit `.env`:

```env
RUST_LOG=debug
```

Then restart:

```bash
docker compose restart hadron-web
```

For even more detail (includes SQL queries):

```env
RUST_LOG=hadron_server=debug,sqlx=debug
```

### Rebuild After Code Changes

```bash
# Rebuild and restart (uses Docker cache for unchanged layers)
docker compose up -d --build

# Full clean rebuild (if caching causes issues)
docker compose build --no-cache
docker compose up -d
```

### Stop Services

```bash
# Stop (preserves data volume)
docker compose down

# Stop and delete database data
docker compose down -v
```

### Reset Database

```bash
# Remove the data volume — all data is lost
docker compose down -v

# Restart — migrations recreate all tables, dev user is re-seeded
docker compose up -d
```

### Connect to the Database Directly

```bash
# Via docker exec
docker compose exec db psql -U hadron -d hadron

# Or from host (if you have psql installed)
psql postgres://hadron:hadron_dev@localhost:5432/hadron
```

Useful queries:

```sql
-- Check users
SELECT id, email, display_name, role FROM users;

-- Check analyses count
SELECT COUNT(*) FROM analyses WHERE deleted_at IS NULL;

-- Check migration status
SELECT * FROM _sqlx_migrations ORDER BY version;
```

---

## Architecture Overview

### Backend (Rust / Axum)

```
crates/hadron-server/src/
  main.rs          App startup, config, static file serving
  routes/          API route handlers (REST)
  auth/            Azure AD JWT validation + dev mode bypass
  db/              Database queries (sqlx, runtime queries)
  ai/              AI service (OpenAI + Anthropic, streaming)
  integrations/    OpenSearch + Jira integrations
  middleware/      Health checks, audit logging
  sse/             Server-Sent Events for chat streaming
```

### Frontend (React / TypeScript)

```
frontend/src/
  main.tsx              Entry point (MSAL bootstrap or dev mode)
  App.tsx               Layout, navigation, view routing
  auth/                 MSAL configuration
  services/api.ts       REST API client (all backend calls)
  components/
    analysis/           Upload + analyze crash logs
    history/            Analysis history with pagination
    chat/               AI chat with SSE streaming
    search/             Advanced search + OpenSearch integration
    signatures/         Crash signature deduplication
    analytics/          Dashboard with charts
    settings/           API key + integration config
    admin/              User management, audit log, patterns
    team/               Team analysis feed (lead+ role)
    release-notes/      Release note management
    sentry/             Sentry integration panel
```

### Database Schema (12 migrations)

| Migration | Tables Created |
|---|---|
| 001 | `teams`, `users` (RBAC: analyst / lead / admin) |
| 002 | `analyses`, `crash_signatures`, `analysis_signatures`, `tags`, `analysis_tags`, `analysis_notes` |
| 003 | `chat_sessions`, `chat_messages` |
| 004 | `user_settings`, `global_settings` |
| 005 | `opensearch_configs`, `saved_searches` |
| 006 | `jira_configs` |
| 007 | `release_notes` |
| 008 | `embeddings` (pgvector for RAG) |
| 009 | Full-text search indexes |
| 010 | `audit_log` |
| 011 | `analysis_feedback` |
| 012 | `gold_analyses` |

### API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Readiness check (DB connectivity) |
| GET | `/api/health/live` | Liveness check |
| GET | `/api/me` | Current user profile |
| POST | `/api/analyses/upload` | Upload + analyze a file |
| POST | `/api/analyses/analyze` | Analyze pasted content |
| GET | `/api/analyses` | List analyses (paginated) |
| GET | `/api/analyses/:id` | Get analysis detail |
| DELETE | `/api/analyses/:id` | Soft-delete analysis |
| POST | `/api/analyses/:id/favorite` | Toggle favorite |
| POST | `/api/analyses/search` | Full-text search |
| POST | `/api/analyses/advanced-search` | Multi-filter search |
| POST | `/api/analyses/:id/embed` | Generate embedding |
| GET | `/api/analyses/:id/similar` | Find similar analyses (RAG) |
| GET | `/api/analyses/:id/tags` | Get tags for analysis |
| PUT | `/api/analyses/:id/tags` | Set tags for analysis |
| GET | `/api/analyses/:id/notes` | Get notes |
| POST | `/api/analyses/:id/notes` | Add note |
| POST | `/api/analyses/:id/feedback` | Submit feedback |
| GET | `/api/analyses/:id/feedback` | Get feedback |
| POST | `/api/analyses/:id/gold` | Promote to gold standard |
| POST | `/api/analyses/:id/export` | Export analysis |
| POST | `/api/analyses/:id/restore` | Restore archived |
| POST | `/api/analyses/bulk` | Bulk operations |
| GET | `/api/analyses/archived` | List archived |
| POST | `/api/chat` | Chat with SSE streaming |
| GET | `/api/chat/sessions` | List chat sessions |
| POST | `/api/chat/sessions` | Create chat session |
| GET | `/api/chat/sessions/:id/messages` | Get messages |
| GET | `/api/settings` | Get user settings |
| PUT | `/api/settings` | Update user settings |
| GET | `/api/tags` | List all tags |
| POST | `/api/tags` | Create tag |
| GET | `/api/signatures` | List crash signatures |
| GET | `/api/signatures/:hash` | Get signature detail |
| GET | `/api/analytics` | User analytics |
| GET | `/api/analytics/team` | Team analytics |
| GET | `/api/analytics/global` | Global analytics |
| GET | `/api/release-notes` | List release notes |
| POST | `/api/release-notes` | Create release note |
| POST | `/api/search/opensearch` | Proxy OpenSearch query |
| POST | `/api/jira/tickets` | Create Jira ticket |
| POST | `/api/jira/search` | Search Jira |
| GET | `/api/team/analyses` | Team analysis feed |
| GET | `/api/admin/users` | List users (admin) |
| PUT | `/api/admin/users/:id/role` | Update role (admin) |
| GET | `/api/admin/audit-log` | View audit log (admin) |
| GET | `/api/admin/patterns` | List pattern rules (admin) |
| GET | `/api/gold` | List gold analyses |

---

## Troubleshooting

### Build fails: "error: could not compile"

The Rust build requires ~2 GB of RAM. If you're on a memory-constrained system:

```bash
# Check available memory
free -h

# Reduce parallel compilation jobs
CARGO_BUILD_JOBS=1 docker compose build
```

### Container exits immediately

```bash
# Check exit code and logs
docker compose ps -a
docker compose logs hadron-web
```

Common causes:
- **"DATABASE_URL must be set"** — The `.env` file is missing or not in the `hadron-web/` directory
- **"AZURE_AD_TENANT_ID must be set"** — `AUTH_MODE` is not set to `dev`. Check your `.env`
- **Database connection refused** — The `db` service isn't healthy yet. The `depends_on: condition: service_healthy` should handle this, but check: `docker compose logs db`

### Port 8080 already in use

```bash
# Find what's using it
lsof -i :8080

# Or change the port in docker-compose.yml
ports:
  - "3000:8080"  # Use port 3000 instead
```

### Database connection errors after restart

```bash
# Check if the db service is healthy
docker compose ps

# If db shows "unhealthy", restart it
docker compose restart db

# Wait for healthy, then restart app
docker compose restart hadron-web
```

### Frontend shows blank page

Check the browser console (F12) for errors. Common causes:
- The frontend was built without `VITE_AUTH_MODE=dev` — rebuild: `docker compose build --no-cache`
- MSAL is trying to initialize without Azure AD config — verify `AUTH_MODE=dev` in `.env`

### Analysis fails with "No API key"

1. Go to **Settings** in the app
2. Enter a valid OpenAI or Anthropic API key
3. Click **Save Settings**
4. Go back to **Analyze** and retry

---

## Resource Limits

Configured in `docker-compose.yml`:

| Service | Memory | CPUs |
|---|---|---|
| hadron-web | 512 MB | 2.0 |
| db | 1 GB | 1.0 |

Adjust in `docker-compose.yml` under `deploy.resources.limits` if needed.

---

## Data Persistence

- **Database data** is stored in the `pgdata` Docker volume. It survives `docker compose down` but is deleted by `docker compose down -v`.
- **API keys** are stored in browser session storage (cleared when the tab closes).
- **User settings** (model preferences, integration configs) are stored in the database.
- **Uploaded files** are processed in-memory and not stored on disk.

---

## Switching to Production Auth

When you're ready to enable Azure AD:

1. Remove `AUTH_MODE=dev` from `.env` (or set `AUTH_MODE=azure_ad`)
2. Set `AZURE_AD_TENANT_ID` and `AZURE_AD_CLIENT_ID`
3. Rebuild with Azure AD frontend: `docker compose build`
4. Users will now see a "Sign in with Azure AD" login page
5. First login auto-creates a user with `analyst` role
6. Promote users to `lead` or `admin` via the Admin panel
