# Hadron MCP Server — Design

**Date:** 2026-04-15
**Status:** Design
**Scope:** Expose Hadron as an MCP (Model Context Protocol) server for both `hadron-web` and `hadron-desktop`, so external agents (Claude Desktop, Cursor, Copilot, Rovo) can query tickets, briefs, similar-ticket search, Sentry analyses, and release notes.

## Goals

- **One shared tool surface** across web and desktop — same schemas, same semantics, same tests.
- **Zero business-logic duplication** — MCP tools are thin wrappers over `hadron-core`.
- **Respect existing auth** — web uses JWT per-request; desktop runs single-user locally.
- **Read-mostly first** — ship query tools in v1; write tools (post comment, create brief) behind an explicit capability flag in v2.

## Non-goals

- Replacing internal REST/Tauri commands. MCP is an *additional* surface.
- Inbound MCPs (Rovo, GitHub, Slack). Native integrations already cover these.
- Turning the chat agent into an MCP client. It keeps calling `hadron-core` directly.

## Architecture

### New crate: `hadron-mcp`

Added to `hadron-web/Cargo.toml` workspace members. Consumed by `hadron-server` (web) and by `hadron-desktop/src-tauri` (desktop) via path dependency.

```
hadron-web/crates/hadron-mcp/
├── Cargo.toml
├── src/
│   ├── lib.rs             # re-exports
│   ├── context.rs         # McpContext trait (db, user_id, role)
│   ├── tools/
│   │   ├── mod.rs         # register_tools()
│   │   ├── search.rs      # hybrid_search, search_ticket_briefs, search_sentry
│   │   ├── tickets.rs     # get_ticket_brief, find_similar_tickets
│   │   ├── sentry.rs      # get_sentry_analysis
│   │   └── release_notes.rs # get_release_notes, list_fix_versions
│   ├── schemas.rs         # serde input/output types, JSON schema derive
│   └── errors.rs          # McpError → rmcp error mapping
```

Depends on: `hadron-core`, `rmcp` (official Rust MCP SDK), `serde`, `async-trait`, `schemars` (for tool schema generation).

### `McpContext` trait

Abstracts away the backing store so the same tool handlers work for Postgres (web) and SQLite (desktop):

```rust
#[async_trait]
pub trait McpContext: Send + Sync {
    fn user_id(&self) -> Option<Uuid>;   // None on desktop (single-user)
    fn role(&self) -> Role;              // Admin on desktop
    async fn retrieval(&self) -> Arc<dyn Retrieval>;     // from hadron-core
    async fn briefs(&self) -> Arc<dyn TicketBriefStore>;
    async fn sentry(&self) -> Arc<dyn SentryAnalysisStore>;
    async fn release_notes(&self) -> Arc<dyn ReleaseNotesStore>;
}
```

Web implements `McpContext` over `PgPool` + JWT claims. Desktop implements it over the SQLite pool + a constant "local" identity.

## Tool surface (v1)

All tools return structured JSON with citations (source, id, score).

| Tool | Inputs | Purpose |
|------|--------|---------|
| `hybrid_search` | `query`, `limit?`, `filters?` | RRF fusion across briefs + sentry + release notes |
| `search_ticket_briefs` | `query`, `severity?`, `category?`, `limit?` | Semantic search over ticket embeddings |
| `get_ticket_brief` | `jira_key` | Full brief + triage + posted-to-jira status |
| `find_similar_tickets` | `jira_key` \| `text`, `threshold?`, `limit?` | Duplicate detection via cosine similarity |
| `search_sentry_analyses` | `query`, `pattern?`, `limit?` | Past Sentry incident context |
| `get_sentry_analysis` | `analysis_id` | Full analysis + patterns + recommendations |
| `list_fix_versions` | `project_key` | JIRA fix versions available for release notes |
| `get_release_notes` | `fix_version` \| `note_id` | Published/approved release notes content |

Each tool is scoped by `ctx.user_id()` where applicable — on web, users only see their own subscriptions / briefs (matching current REST semantics). On desktop, no scoping.

## Transports

### Web: streamable HTTP at `POST /mcp`

- Mounted in `hadron-server::routes`, reuses JWT middleware.
- Bearer token → `Claims` → `WebMcpContext`.
- Uses `rmcp` streamable HTTP server transport.
- Rate-limited via existing tower layer.
- Discovery: `GET /.well-known/mcp` returns server manifest.

### Desktop: stdio via subcommand

- New binary entrypoint: `hadron-desktop mcp` (added to `src-tauri/src/bin/mcp.rs` or as a subcommand on the main binary).
- Reads config from the same Tauri store as the app.
- Uses `rmcp` stdio transport.
- Clients configure it in e.g. `claude_desktop_config.json`:
  ```json
  {
    "mcpServers": {
      "hadron": { "command": "C:/Program Files/Hadron/hadron-desktop.exe", "args": ["mcp"] }
    }
  }
  ```

Glue per surface: ~30–50 lines each. All tool logic lives in `hadron-mcp`.

## Auth & authorization

- **Web:** MCP requests carry the same JWT as REST. `McpContext::user_id()` and `role()` come from claims. Admin-only tools (none in v1) gate via `role()`.
- **Desktop:** local-only, no auth. Stdio transport is implicitly trusted (same machine, same user).
- **Write tools (v2):** gated by a `HADRON_MCP_WRITE=true` env var *and* user role ≥ lead. Not shipped in v1.

## Implementation phases

### Phase 1 — Crate scaffolding (1 day)
- Create `hadron-mcp` crate, add to workspace.
- Define `McpContext` trait, `schemas.rs` input/output types.
- Add `rmcp` dependency, skeleton `register_tools()` returning empty set.
- Build passes in both web and desktop workspaces.

### Phase 2 — Read tools over `hadron-core` (2–3 days)
- Implement 8 v1 tools against `McpContext`.
- Unit tests per tool using a mock context.
- Integration tests: in-process MCP client → tool → mock context.

### Phase 3 — Web surface (1 day)
- `WebMcpContext` backed by `PgPool` + `Claims`.
- `POST /mcp` route in `hadron-server` with streamable HTTP transport.
- JWT middleware already applies.
- E2E test: cargo test hits `/mcp` with a test JWT, calls `get_ticket_brief`.

### Phase 4 — Desktop surface (1 day)
- `DesktopMcpContext` backed by SQLite pool.
- `hadron-desktop mcp` subcommand using stdio transport.
- Manual test: configure Claude Desktop, call `hybrid_search` from Claude.

### Phase 5 — Docs & discovery (½ day)
- `docs/mcp/README.md` — tool catalog, example prompts, config snippets for Claude Desktop / Cursor / Copilot.
- Admin panel card (web): "MCP endpoint" with copy-paste URL + current user's token reminder.
- `/.well-known/mcp` manifest on web.

### Phase 6 (v2, deferred) — Write tools
- `post_brief_to_jira`, `submit_feedback`, `publish_release_notes`.
- Gated by env flag + role check.
- Audit log entry per write call (reuse existing `audit_log` table).

## Testing strategy

- **Unit:** each tool has a test against an in-memory `McpContext` impl (`MockContext`).
- **Contract:** snapshot test the JSON schema of every tool — breaks on accidental schema drift.
- **Integration (web):** `hadron-server` test spins up Axum, hits `/mcp` with a test JWT, asserts response shape.
- **Integration (desktop):** spawn `hadron-desktop mcp` as a subprocess in a test, send framed JSON-RPC, assert response.
- **Manual:** Claude Desktop + Cursor configs committed under `docs/mcp/examples/`.

## Migration & rollout

- No DB migrations required — reads existing tables.
- Web: feature-flag `/mcp` route behind `HADRON_MCP_ENABLED=true` (default true in dev, false in prod until validated).
- Desktop: subcommand shipped in next release; surfaced in Settings → "Enable MCP server" checkbox that prints the config snippet users paste into their MCP client.

## Risks & tradeoffs

- **rmcp crate maturity** — if it's not stable enough, fall back to `axum-mcp` (community) or hand-rolled JSON-RPC over stdio/HTTP. Schema layer stays portable.
- **Tool proliferation** — resist adding a tool per REST endpoint. v1 stays at 8; new tools require a user-story justification.
- **User scoping edge cases** — briefs are currently global on web; confirm per-user visibility matches REST before v1 ships.
- **Desktop binary size** — `rmcp` is small, but verify release build stays under current size budget.

## Open questions

1. Do we want per-tool rate limits on web, or rely on the global tower layer?
2. Should `hybrid_search` accept an explicit `source: ["briefs","sentry","release_notes"]` filter, or always fuse all three?
3. Desktop: subcommand on the main binary, or separate `hadron-mcp.exe` sidecar? (Separate is cleaner for signing; main binary is simpler to ship.)

## Success criteria

- External agent (Claude Desktop) can answer "what similar tickets have we seen to PROJ-1234?" by calling `find_similar_tickets` against either web or desktop, with identical JSON responses.
- Zero duplicated business logic between surfaces — `grep` finds each tool handler exactly once.
- All v1 tools have unit + contract tests; web and desktop each have one E2E smoke test.
