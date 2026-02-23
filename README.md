# Hadron

**AI-Powered Smalltalk Crash Analyzer**

Hadron uses AI to analyze VisualWorks Smalltalk crash logs, providing intelligent root cause detection, suggested fixes, and searchable analysis history.

Two editions are available:

| Edition | Description | Location |
|---------|-------------|----------|
| **Hadron Desktop** | Single-user Tauri desktop app (Windows/macOS/Linux) | `hadron-desktop/` |
| **Hadron Web** | Multi-user web app with RBAC, Docker deployment | `hadron-web/` |

---

## Features

- **Multi-Provider AI** — OpenAI, Anthropic Claude, Ollama (offline, desktop only)
- **Intelligent Analysis** — Root cause detection, fix suggestions, severity classification
- **Crash Signatures** — Automatic deduplication of recurring errors
- **Full-Text Search** — SQLite FTS5 (desktop) / PostgreSQL FTS (web)
- **RAG** — Embedding-based similar crash retrieval (pgvector)
- **Analytics Dashboard** — Severity trends, component distribution, daily counts
- **Integrations** — OpenSearch, Jira, Sentry (web)
- **RBAC** — Analyst / Lead / Admin roles with team feeds (web)
- **Audit Logging** — Full action trail for compliance (web)

## Hadron Desktop

Single-user Tauri app with SQLite backend and Python AI engine.

```bash
cd hadron-desktop
npm install
cd python && pip install -r requirements-api.txt && cd ..
npm run tauri dev
```

**Prerequisites:** Node.js 18+, Rust (stable), Python 3.10+

See [`hadron-desktop/README.md`](hadron-desktop/README.md) for full documentation.

## Hadron Web

Multi-user web app with PostgreSQL + pgvector, Docker deployment.

```bash
cd hadron-web
docker compose build
docker compose up -d
# Open http://localhost:8080
```

**Prerequisites:** Docker 20.10+, Docker Compose v2+

See [`hadron-web/DEPLOYMENT.md`](hadron-web/DEPLOYMENT.md) for the full deployment guide.

## Tech Stack

| Layer | Desktop | Web |
|-------|---------|-----|
| Frontend | React 18 + TypeScript + Tailwind | React 18 + TypeScript + Tailwind |
| Backend | Rust (Tauri 2) | Rust (Axum 0.8) |
| Database | SQLite + FTS5 | PostgreSQL 16 + pgvector |
| AI Engine | Python 3.10+ | Rust (reqwest to OpenAI/Anthropic) |
| Auth | N/A (single-user) | Azure AD OIDC / Dev mode |
| Deployment | Native installer | Docker Compose |

## Version

**Current:** v4.1.0

## License

Proprietary — MediaGeniX / Hadron Project
