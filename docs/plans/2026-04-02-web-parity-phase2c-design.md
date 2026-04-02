# Web-Desktop Parity — Phase 2c: Background Poller

**Date:** 2026-04-02
**Status:** Approved
**Parent:** `docs/plans/2026-03-25-web-desktop-parity-design.md`
**Depends on:** Phase 2a (triage + briefs), Phase 2b (embeddings)

Server-side JIRA background poller with admin configuration and user project subscriptions.

---

## Backend

### Database: `migrations/015_jira_poller.sql`

```sql
-- Admin-managed poller configuration (single logical row)
CREATE TABLE jira_poller_config (
    id              SERIAL PRIMARY KEY,
    enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    jql_filter      TEXT NOT NULL DEFAULT '',
    interval_mins   INT NOT NULL DEFAULT 30,
    last_polled_at  TIMESTAMPTZ,
    jira_base_url   TEXT NOT NULL DEFAULT '',
    jira_email      TEXT NOT NULL DEFAULT '',
    jira_api_token  TEXT NOT NULL DEFAULT '',
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed single config row
INSERT INTO jira_poller_config (id) VALUES (1);

-- User project subscriptions
CREATE TABLE user_project_subscriptions (
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    project_key     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, project_key)
);
```

API token encrypted via existing `crypto::encrypt_value()` before storage.

### Server Poller Module: `jira_poller.rs`

New module in hadron-server (not hadron-core — it needs reqwest, DB pool, and tokio).

**State:**
```rust
pub struct PollerState {
    handle: Mutex<Option<JoinHandle<()>>>,
    cancel: Arc<AtomicBool>,
}
```

Managed as Axum state extension (added to `AppState` or as separate `.layer(Extension(...))`).

**Lifecycle:**
- `start_poller(pool, state)` — reads config from DB, validates (enabled + non-empty JQL + non-empty credentials), spawns tokio task, stores handle
- `stop_poller(state)` — sets cancel flag, aborts handle
- `get_poller_status(pool, state) -> PollerStatus` — returns running, last_polled_at, interval_mins
- Auto-start in `main.rs` after migrations if config has `enabled = true`

**Poll cycle:**
1. Initial 30s sleep (don't poll immediately on boot)
2. Loop:
   - Check cancel flag
   - Read config from DB (allows live config changes)
   - Decrypt API token via `crypto::decrypt_value()`
   - Build JiraConfig from poller config
   - Search JIRA with configured JQL (up to 50 tickets)
   - Query `ticket_briefs` for existing keys — skip already-triaged
   - For each new ticket: fetch detail, run triage AI, persist to ticket_briefs
   - Update `last_polled_at` in poller_config
   - Error handling: track consecutive failures, exponential backoff (base interval * 2^failures, cap 2 hours)
   - On success: reset failures, sleep interval_mins
3. On cancel: break loop, log shutdown

**AI config resolution:** Poller uses server-side AI config (`get_server_ai_config`) — same pattern as other routes. No per-request key needed.

### DB Functions

In `db/mod.rs` or a new `db/poller.rs`:
- `get_poller_config(pool) -> PollerConfigRow`
- `update_poller_config(pool, config, user_id)`
- `update_poller_last_polled(pool)`
- `get_user_subscriptions(pool, user_id) -> Vec<String>`
- `set_user_subscriptions(pool, user_id, project_keys: &[String])`

### Routes

**Admin-only (poller management):**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/jira-poller` | Admin | Get config + running status |
| PUT | `/api/admin/jira-poller` | Admin | Update config (JQL, interval, creds, enabled) |
| POST | `/api/admin/jira-poller/start` | Admin | Start poller |
| POST | `/api/admin/jira-poller/stop` | Admin | Stop poller |

**User subscriptions:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/jira/subscriptions` | Any | Get user's project subscriptions |
| PUT | `/api/jira/subscriptions` | Any | Set user's subscriptions |

**Config response** (never returns raw API token):
```json
{
  "enabled": true,
  "jqlFilter": "project = PROJ AND created >= -7d",
  "intervalMins": 30,
  "jiraBaseUrl": "https://jira.example.com",
  "jiraEmail": "bot@example.com",
  "hasApiToken": true,
  "lastPolledAt": "2026-04-02T10:00:00Z",
  "running": true
}
```

---

## Frontend

### Admin Panel: JIRA Poller Section

New tab `"jira-poller"` in AdminPanel (or section within existing admin UI):
- JIRA credentials: base URL, email, API token (password input, masked if configured)
- JQL filter input
- Interval input (minutes, min 5)
- Enable/disable toggle
- "Save & Start" button / "Stop" button
- Status display: running badge (green/gray dot), last polled timestamp, interval
- Status auto-refreshes every 15s via polling `GET /api/admin/jira-poller`

### User Subscriptions (in JiraProjectFeed)

Inline section at top of JiraProjectFeed:
- "Your Projects" — list of subscribed project keys as removable pills
- "Add" input + button to subscribe to a new project key
- Saved via `PUT /api/jira/subscriptions`
- Feed filters to only show issues from subscribed projects (if any subscriptions; show all if none)

### Types

```typescript
interface PollerConfigStatus {
  enabled: boolean;
  jqlFilter: string;
  intervalMins: number;
  jiraBaseUrl: string;
  jiraEmail: string;
  hasApiToken: boolean;
  lastPolledAt: string | null;
  running: boolean;
}
```

### API Methods

```typescript
getPollerConfig(): Promise<PollerConfigStatus>            // Admin
updatePollerConfig(config): Promise<void>                  // Admin
startPoller(): Promise<void>                               // Admin
stopPoller(): Promise<void>                                // Admin
getUserSubscriptions(): Promise<string[]>                  // Any
setUserSubscriptions(projectKeys: string[]): Promise<void> // Any
```

---

## File Summary

### New files

| File | Purpose |
|------|---------|
| `migrations/015_jira_poller.sql` | Poller config + user subscriptions tables |
| `crates/hadron-server/src/jira_poller.rs` | Background poller task (poll cycle, lifecycle) |
| `crates/hadron-server/src/routes/jira_poller.rs` | Admin poller + user subscription routes |
| `frontend/src/components/admin/JiraPollerPanel.tsx` | Admin poller configuration UI |

### Modified files

| File | Change |
|------|--------|
| `crates/hadron-server/src/main.rs` | Add `mod jira_poller`, PollerState to AppState, auto-start |
| `crates/hadron-server/src/db/mod.rs` | Add poller config + subscription CRUD |
| `crates/hadron-server/src/routes/mod.rs` | Register poller + subscription routes |
| `frontend/src/services/api.ts` | Add poller types + 6 API methods |
| `frontend/src/components/admin/AdminPanel.tsx` | Add JIRA Poller tab |
| `frontend/src/components/jira/JiraProjectFeed.tsx` | Add subscription management + filtering |
