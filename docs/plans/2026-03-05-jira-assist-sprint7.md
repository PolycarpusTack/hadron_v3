# Sprint 7: Background Poller

**Status**: Planning
**Depends on**: Sprints 1-6 (complete)
**Files touched**: 3 Rust (new/modified), 2 TypeScript, 2 components

---

## Overview

Activate the `jira_poller.rs` stub as a Tokio interval task that auto-triages new JIRA tickets on a schedule. Config stored in Tauri plugin-store. Notifications via OS + frontend event.

---

## Task 1: Poller config helpers

Read/write poller settings from the Tauri store JSON file on disk.

### Steps

1. **`src-tauri/src/jira_poller.rs`** — replace the stub with a config module:
   ```rust
   pub struct JiraPollerConfig {
       pub enabled: bool,
       pub jql_filter: String,
       pub interval_mins: u64,       // min 5, default 30
       pub last_polled_at: Option<String>, // ISO timestamp
   }
   ```

2. Add `read_poller_config(app_handle) -> JiraPollerConfig` that reads from the Tauri store file (`settings.json` or equivalent) using `tauri_plugin_store`. Keys: `jira_assist_enabled`, `jira_assist_jql`, `jira_assist_interval_mins`, `jira_assist_last_polled_at`.

3. Add `write_last_polled_at(app_handle, timestamp: &str)` to update just the timestamp after each poll.

### Verify
- `cargo check` passes.

---

## Task 2: Poll loop implementation

The core async loop that fetches, filters, and triages tickets.

### Steps

1. **`src-tauri/src/jira_poller.rs`** — add `run_poll_cycle`:
   ```rust
   pub async fn run_poll_cycle(
       app: AppHandle,
       db: Arc<Database>,
       config: &JiraPollerConfig,
   ) -> Result<Vec<String>, String> {
       // 1. Build JQL with optional "AND updated >= last_polled_at"
       // 2. Call search_jira_issues (reuse jira_service)
       // 3. Filter out keys already in ticket_briefs (db.get_ticket_briefs_batch)
       // 4. Triage each sequentially via run_jira_triage
       // 5. Return Vec of newly triaged jira_keys
   }
   ```

2. Read JIRA creds (baseUrl, email, apiToken) from store — same keys as JiraSettings.

3. Read AI creds (apiKey, model, provider) from store — same keys as main settings.

4. For each new ticket: build `JiraTriageRequest`, call `run_jira_triage`, upsert result to `ticket_briefs` (same pattern as `triage_jira_ticket` command).

### Verify
- `cargo check` passes.

---

## Task 3: Poller lifecycle (start/stop/status)

Manage the poller as a spawned Tokio task with cancellation.

### Steps

1. **`src-tauri/src/jira_poller.rs`** — add `PollerState` managed state:
   ```rust
   pub struct PollerState {
       handle: Mutex<Option<JoinHandle<()>>>,
       cancel: CancellationToken,  // tokio_util
       triaged_total: AtomicU64,
   }
   ```
   (Use `tokio_util::sync::CancellationToken` or a simple `Arc<AtomicBool>` for cancellation — check if `tokio_util` is already a dependency, otherwise use `AtomicBool`.)

2. Add `start_poller(app_handle, db, poller_state)`:
   - Read config; if not enabled or no JQL, return early
   - Cancel any existing task
   - Spawn new task with interval loop:
     ```rust
     loop {
         tokio::select! {
             _ = cancel_token.cancelled() => break,
             _ = tokio::time::sleep(interval) => {
                 match run_poll_cycle(...).await {
                     Ok(keys) if !keys.is_empty() => {
                         // Emit event + notification
                         // Increment triaged_total
                         // Update last_polled_at
                     }
                     Err(e) => {
                         // Log, increment consecutive_failures
                         // Back off if >= 3 failures (2x interval, cap 2h)
                     }
                 }
             }
         }
     }
     ```

3. Add `stop_poller(poller_state)` — cancel token + abort handle.

4. Add `get_poller_status(poller_state, app_handle)` → `PollerStatus`:
   ```rust
   pub struct PollerStatus {
       pub running: bool,
       pub last_polled_at: Option<String>,
       pub tickets_triaged_total: u64,
       pub interval_mins: u64,
   }
   ```

5. **Notifications**: On successful poll with triaged_count > 0:
   - `app.emit("jira-assist-poll-complete", { triaged_count, keys })`
   - `tauri_plugin_notification` → "Hadron triaged N new tickets"

6. **Error backoff**: Track `consecutive_failures: u32`. If >= 3, double the sleep interval (cap at 2h). Reset to 0 on success.

### Verify
- `cargo check` passes.

---

## Task 4: Tauri commands + registration

Wire poller into the command system.

### Steps

1. **`src-tauri/src/commands/jira_assist.rs`** — add 3 commands:
   ```rust
   #[tauri::command]
   pub async fn start_poller(app: AppHandle, db: DbState<'_>, poller: State<'_, PollerState>) -> Result<(), String>

   #[tauri::command]
   pub async fn stop_poller(poller: State<'_, PollerState>) -> Result<(), String>

   #[tauri::command]
   pub async fn get_poller_status(poller: State<'_, PollerState>, app: AppHandle) -> Result<PollerStatus, String>
   ```

2. **`src-tauri/src/main.rs`**:
   - Add `PollerState` to `.manage()`
   - Register 3 commands in `invoke_handler`
   - In `setup()`, call `start_poller` if config says enabled (fire-and-forget)

3. **`src/services/jira-assist.ts`** — add TypeScript functions:
   ```typescript
   export async function startPoller(): Promise<void>
   export async function stopPoller(): Promise<void>
   export async function getPollerStatus(): Promise<PollerStatus>
   ```

### Verify
- `cargo check` passes.

---

## Task 5: Settings UI activation

Activate the greyed-out JIRA Assist controls in JiraSettings.tsx.

### Steps

1. **`src/components/JiraSettings.tsx`** — replace the greyed-out section:
   - Enable/disable toggle (saves `jira_assist_enabled` to store)
   - JQL filter input (saves `jira_assist_jql`)
   - Interval input with min=5 (saves `jira_assist_interval_mins`)
   - "Save & Start" button → calls `startPoller()`
   - "Stop" button → calls `stopPoller()`
   - Status line: "Running · Last polled: 5m ago · 47 tickets triaged" (from `getPollerStatus()`)

2. Remove "Phase 2" / "coming soon" labels.

3. On save: write config to Tauri store, then call `startPoller()` (which restarts if already running).

### Verify
- Settings UI shows active controls when JIRA is configured.
- Toggle + save triggers poller start.

---

## Task 6: Frontend event listener

Make the Project Feed react to poll completions.

### Steps

1. **`src/components/jira/JiraProjectFeed.tsx`** — add `useEffect` to listen for `jira-assist-poll-complete`:
   ```typescript
   useEffect(() => {
     const unlisten = listen<{ triaged_count: number; keys: string[] }>(
       "jira-assist-poll-complete",
       (event) => {
         // Refresh briefsMap for the newly triaged keys
         loadBriefs(issues.filter(i => event.payload.keys.includes(i.key)));
       }
     );
     return () => { unlisten.then(fn => fn()); };
   }, [issues]);
   ```

### Verify
- When poller triages tickets, feed badges update without manual refresh.

---

## Task 7: Verify + commit

### Steps
1. `cargo check` in `src-tauri/` — must pass.
2. `npx tsc --noEmit` in `hadron-desktop/` — must pass (or only pre-existing errors).
3. Commit: `feat(jira-assist): Sprint 7 — background poller with auto-triage + notifications`.

---

## Batch Plan

| Batch | Tasks | Gate |
|-------|-------|------|
| 1 | Tasks 1-2 | Cargo check — config + poll cycle compile |
| 2 | Tasks 3-4 | Cargo check — lifecycle + commands registered |
| 3 | Tasks 5-6 | tsc check — settings UI + event listener |
| 4 | Task 7 | Final verify + commit |
