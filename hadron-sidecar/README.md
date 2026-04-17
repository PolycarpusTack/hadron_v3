# Hadron Sidecar

Desktop app built on the sidecar pattern: thin Tauri shell + local HTTP server
as a child process. Eliminates the in-process COM boundary that ESET hooks
destabilize in `hadron-desktop`.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  hadron.exe  (Tauri shell, ~5 MB)                       │
│  ├─ WebView2 window → http://127.0.0.1:{port}/          │
│  ├─ Global hotkey (Ctrl+Shift+H)                        │
│  ├─ Clipboard watcher                                   │
│  ├─ Widget FAB                                          │
│  └─ Spawns ↓                                            │
│                                                          │
│  hadron-server.exe  (Axum, ~30 MB)                      │
│  ├─ Binds 127.0.0.1:{random-ephemeral-port}             │
│  ├─ Serves React frontend (embedded dist/)              │
│  ├─ REST API (analysis, chat, JIRA, Sentry, etc.)       │
│  ├─ SSE streaming (chat, progress)                      │
│  └─ SQLite backend (hadron-core with sqlite feature)    │
└─────────────────────────────────────────────────────────┘
```

## Why This Works

- Tauri shell only handles **window lifecycle + OS integration** (no business
  logic invokes)
- All app logic lives in `hadron-server.exe`, a sibling process
- Frontend ↔ backend is plain HTTP/SSE over TCP — nothing for ESET's
  COM/IPC hooks to interpose on
- Both binaries ship in the same installer, signed with the same cert

## Reuse Strategy

| Component | Source | Effort |
|-----------|--------|--------|
| Axum server | Copy from `hadron-web/` | Adapt to SQLite + single-user |
| React frontend | Copy from `hadron-web/frontend/` | Strip auth, adjust storage |
| `hadron-core` | Reuse as-is | — |
| Keeper integration | Port from `hadron-desktop/` | Expose as HTTP route |
| Widget FAB | Port from `hadron-desktop/` | Tauri shell only |
| Clipboard watcher | Port from `hadron-desktop/` | Tauri shell, POSTs to sidecar |
| Pattern engine | Port from `hadron-desktop/` | Move into `hadron-core` |
| Local file access | Port from `hadron-desktop/` | HTTP upload endpoint |

## Build Layout

```
hadron-sidecar/
├── hadron-shell/          # Tauri app (thin, minimal commands)
│   ├── src/               # React frontend (minimal — just bootstrap)
│   └── src-tauri/         # Tauri Rust (window + sidecar launcher)
├── hadron-sidecar-server/ # Axum server (the workhorse)
│   ├── src/
│   └── Cargo.toml
├── hadron-ui/             # React UI (shared with frontend)
│   └── src/
└── hadron-core/           # Shared business logic
    └── src/               # Either symlink or workspace path dep
```

## Installation Footprint

```
C:\Program Files\Hadron\
├── hadron.exe              (shell, ~5 MB)
├── hadron-server.exe       (sidecar, ~30 MB)
├── WebView2Loader.dll
└── resources/
```

## Key Decisions to Make

1. **Database:** SQLite embedded (matches desktop) vs. PostgreSQL (matches web)?
   - SQLite wins for desktop — no install deps, single-user is native fit
   - Means `hadron-core` needs a SQLite backend (currently PG-only in web)

2. **Auth:** bypass for localhost or require local login?
   - Recommend: no auth on sidecar, but sidecar only binds 127.0.0.1 and uses
     a per-session token in a header to prevent CSRF from other local apps

3. **Sidecar port:** fixed or ephemeral?
   - Recommend: ephemeral (bind `:0`, read assigned port from stdout)
   - Tauri shell reads the port from sidecar stdout on startup, injects into
     window URL

4. **Sidecar lifecycle:** crash recovery?
   - If sidecar dies, shell should detect (health check), show error, offer
     restart
   - On shell exit, shell kills sidecar explicitly (Windows doesn't auto-kill
     children)

5. **Vector search:** pgvector isn't available in SQLite. Options:
   - Use `sqlite-vec` extension (bundled with rusqlite)
   - Fall back to in-memory cosine for small datasets
   - Make RAG optional on desktop

## Next Steps

See `PLAN.md` (to be written) for the phased implementation plan.
