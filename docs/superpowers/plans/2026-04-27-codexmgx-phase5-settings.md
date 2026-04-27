# CodexMgX Integration — Phase 5: Settings

> **Prerequisites:** Phases 1-4 complete.

**Goal:** Expose Confluence override credentials and investigation KB settings in both the desktop settings UI and the web admin API/migration.

**Files:**
- Modify: `hadron-desktop/src/components/JiraSettings.tsx`
- Create: `hadron-web/migrations/019_investigation_settings.sql`
- Modify: `hadron-web/crates/hadron-server/src/db/mod.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/admin.rs` (or settings route)

---

### Task 24: Desktop Settings UI

**Files:**
- Modify: `hadron-desktop/src/components/JiraSettings.tsx`

- [ ] **Step 1: Add new state variables**

In `JiraSettings.tsx`, alongside the existing `apiToken` state, add:

```ts
const [useConfluenceOverride, setUseConfluenceOverride] = useState(false);
const [confluenceUrl, setConfluenceUrl] = useState("");
const [confluenceEmail, setConfluenceEmail] = useState("");
const [confluenceToken, setConfluenceToken] = useState("");
const [whatsonKbUrl, setWhatsonKbUrl] = useState("");
const [modDocsHomepageId, setModDocsHomepageId] = useState("");
const [modDocsSpacePath, setModDocsSpacePath] = useState("");
const [advancedOpen, setAdvancedOpen] = useState(false);
```

- [ ] **Step 2: Load existing values on mount**

In the existing `useEffect` that loads JIRA settings, add after the JIRA loads:

```ts
const savedConfluenceUrl = await getSetting<string>("confluence.overrideUrl");
const savedConfluenceEmail = await getSetting<string>("confluence.overrideEmail");
const savedWhatsonKbUrl = await getSetting<string>("investigation.whatsonKbUrl");
const savedModDocsId = await getSetting<string>("investigation.modDocsHomepageId");
const savedModDocsPath = await getSetting<string>("investigation.modDocsSpacePath");
const hasConfluenceToken = !!(await getApiKey("confluence"));

if (savedConfluenceUrl) {
  setConfluenceUrl(savedConfluenceUrl);
  setConfluenceEmail(savedConfluenceEmail ?? "");
  setUseConfluenceOverride(true);
}
if (savedWhatsonKbUrl) setWhatsonKbUrl(savedWhatsonKbUrl);
if (savedModDocsId) setModDocsHomepageId(savedModDocsId);
if (savedModDocsPath) setModDocsSpacePath(savedModDocsPath);
```

- [ ] **Step 3: Save values in the existing save handler**

In the save handler (called when the user confirms), after the JIRA settings are saved, add:

```ts
// Confluence override
if (useConfluenceOverride) {
  await storeSetting("confluence.overrideUrl", confluenceUrl);
  await storeSetting("confluence.overrideEmail", confluenceEmail);
  if (confluenceToken) await storeApiKey("confluence", confluenceToken);
} else {
  await storeSetting("confluence.overrideUrl", "");
  await storeSetting("confluence.overrideEmail", "");
}

// Investigation advanced settings
if (whatsonKbUrl) await storeSetting("investigation.whatsonKbUrl", whatsonKbUrl);
if (modDocsHomepageId) await storeSetting("investigation.modDocsHomepageId", modDocsHomepageId);
if (modDocsSpacePath) await storeSetting("investigation.modDocsSpacePath", modDocsSpacePath);
```

- [ ] **Step 4: Add settings UI fields**

Find the bottom of the existing JIRA fields section in the JSX (before the Save/Test buttons). Add the following block:

```tsx
{/* Confluence override */}
<div className="mt-6 border-t border-slate-700 pt-4">
  <label className="flex items-center gap-2 cursor-pointer">
    <input
      type="checkbox"
      checked={useConfluenceOverride}
      onChange={(e) => setUseConfluenceOverride(e.target.checked)}
      className="rounded border-slate-600 bg-slate-800 text-blue-500"
    />
    <span className="text-sm text-slate-300">Use separate Confluence instance</span>
  </label>

  {useConfluenceOverride && (
    <div className="mt-3 ml-6 space-y-3">
      <div>
        <label className="block text-xs text-slate-400 mb-1">Confluence URL</label>
        <input
          type="text"
          value={confluenceUrl}
          onChange={(e) => setConfluenceUrl(e.target.value)}
          placeholder="https://yourcompany.atlassian.net"
          className="w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500"
        />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">Email</label>
        <input
          type="email"
          value={confluenceEmail}
          onChange={(e) => setConfluenceEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500"
        />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">API Token</label>
        <input
          type="password"
          value={confluenceToken}
          onChange={(e) => setConfluenceToken(e.target.value)}
          placeholder="Leave blank to keep existing token"
          className="w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500"
        />
      </div>
    </div>
  )}
</div>

{/* Advanced investigation settings */}
<div className="mt-4">
  <button
    type="button"
    onClick={() => setAdvancedOpen(!advancedOpen)}
    className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-300"
  >
    <span>{advancedOpen ? "▼" : "▶"}</span> Advanced
  </button>

  {advancedOpen && (
    <div className="mt-3 ml-4 space-y-3">
      <div>
        <label className="block text-xs text-slate-400 mb-1">
          WHATS'ON KB URL
        </label>
        <input
          type="text"
          value={whatsonKbUrl}
          onChange={(e) => setWhatsonKbUrl(e.target.value)}
          placeholder="https://whatsonknowledgebase.mediagenix.tv/latest_version/"
          className="w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500"
        />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">
          MOD Docs Homepage ID
        </label>
        <input
          type="text"
          value={modDocsHomepageId}
          onChange={(e) => setModDocsHomepageId(e.target.value)}
          placeholder="1888060283"
          className="w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500"
        />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">
          MOD Docs Space Path
        </label>
        <input
          type="text"
          value={modDocsSpacePath}
          onChange={(e) => setModDocsSpacePath(e.target.value)}
          placeholder="modkb"
          className="w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500"
        />
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd hadron-desktop && npm run type-check
```

- [ ] **Step 6: Commit**

```bash
git add hadron-desktop/src/components/JiraSettings.tsx
git commit -m "feat(desktop): add Confluence override and investigation settings to JiraSettings"
```

---

### Task 25: Web Migration + Admin Settings

**Files:**
- Create: `hadron-web/migrations/019_investigation_settings.sql`
- Modify: `hadron-web/crates/hadron-server/src/db/mod.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/admin.rs`

- [ ] **Step 1: Create migration**

```sql
-- 019_investigation_settings.sql
-- Adds Confluence override credentials and investigation KB settings
-- to the existing jira_poller_config row.

ALTER TABLE jira_poller_config
    ADD COLUMN IF NOT EXISTS confluence_override_url   TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS confluence_override_email TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS confluence_override_token TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS whatson_kb_url            TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS mod_docs_homepage_id      TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS mod_docs_space_path       TEXT NOT NULL DEFAULT '';
```

- [ ] **Step 2: Update PollerConfigRow and get_poller_config in db/mod.rs**

Find `PollerConfigRow` (around line 3261) and add the new fields:

```rust
#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PollerConfigRow {
    pub enabled: bool,
    pub jql_filter: String,
    pub interval_mins: i32,
    pub last_polled_at: Option<chrono::DateTime<chrono::Utc>>,
    pub jira_base_url: String,
    pub jira_email: String,
    pub jira_api_token: String,
    // New fields:
    pub confluence_override_url: String,
    pub confluence_override_email: String,
    pub confluence_override_token: String,
    pub whatson_kb_url: String,
    pub mod_docs_homepage_id: String,
    pub mod_docs_space_path: String,
}
```

Update `get_poller_config` query to select the new columns:

```rust
pub async fn get_poller_config(pool: &PgPool) -> HadronResult<PollerConfigRow> {
    let row = sqlx::query_as::<_, PollerConfigRow>(
        "SELECT enabled, jql_filter, interval_mins, last_polled_at,
                jira_base_url, jira_email, jira_api_token,
                confluence_override_url, confluence_override_email,
                confluence_override_token, whatson_kb_url,
                mod_docs_homepage_id, mod_docs_space_path
         FROM jira_poller_config WHERE id = 1",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;
    Ok(row)
}
```

Add a new `update_investigation_settings` function after `update_poller_config`:

```rust
pub async fn update_investigation_settings(
    pool: &PgPool,
    confluence_override_url: Option<&str>,
    confluence_override_email: Option<&str>,
    confluence_override_token: Option<&str>,
    whatson_kb_url: Option<&str>,
    mod_docs_homepage_id: Option<&str>,
    mod_docs_space_path: Option<&str>,
    user_id: Uuid,
) -> HadronResult<()> {
    sqlx::query(
        "UPDATE jira_poller_config SET
            confluence_override_url   = COALESCE($1, confluence_override_url),
            confluence_override_email = COALESCE($2, confluence_override_email),
            confluence_override_token = COALESCE($3, confluence_override_token),
            whatson_kb_url            = COALESCE($4, whatson_kb_url),
            mod_docs_homepage_id      = COALESCE($5, mod_docs_homepage_id),
            mod_docs_space_path       = COALESCE($6, mod_docs_space_path),
            updated_by = $7,
            updated_at = NOW()
         WHERE id = 1",
    )
    .bind(confluence_override_url)
    .bind(confluence_override_email)
    .bind(confluence_override_token)
    .bind(whatson_kb_url)
    .bind(mod_docs_homepage_id)
    .bind(mod_docs_space_path)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;
    Ok(())
}
```

- [ ] **Step 3: Add admin GET + PUT routes for investigation settings**

In `hadron-web/crates/hadron-server/src/routes/admin.rs`, add two new handler functions after `update_confluence_config`:

```rust
/// GET /api/admin/investigation-settings
/// Returns current investigation settings (never returns tokens).
pub async fn get_investigation_settings(
    State(state): State<AppState>,
    _user: AdminUser,
) -> impl IntoResponse {
    match db::get_poller_config(&state.db).await {
        Ok(row) => {
            Json(serde_json::json!({
                "confluenceOverrideUrl": row.confluence_override_url,
                "confluenceOverrideEmail": row.confluence_override_email,
                "hasConfluenceToken": !row.confluence_override_token.is_empty(),
                "whatsonKbUrl": row.whatson_kb_url,
                "modDocsHomepageId": row.mod_docs_homepage_id,
                "modDocsSpacePath": row.mod_docs_space_path,
            }))
            .into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInvestigationSettingsRequest {
    pub confluence_override_url: Option<String>,
    pub confluence_override_email: Option<String>,
    pub confluence_override_token: Option<String>,
    pub whatson_kb_url: Option<String>,
    pub mod_docs_homepage_id: Option<String>,
    pub mod_docs_space_path: Option<String>,
}

/// PUT /api/admin/investigation-settings
pub async fn update_investigation_settings(
    State(state): State<AppState>,
    user: AdminUser,
    Json(body): Json<UpdateInvestigationSettingsRequest>,
) -> impl IntoResponse {
    match db::update_investigation_settings(
        &state.db,
        body.confluence_override_url.as_deref(),
        body.confluence_override_email.as_deref(),
        body.confluence_override_token.as_deref(),
        body.whatson_kb_url.as_deref(),
        body.mod_docs_homepage_id.as_deref(),
        body.mod_docs_space_path.as_deref(),
        user.user.id,
    )
    .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}
```

- [ ] **Step 4: Register the new routes**

In `routes/mod.rs`, in `api_router()`, after the existing admin confluence routes:
```rust
        .route("/admin/investigation-settings", get(admin::get_investigation_settings))
        .route("/admin/investigation-settings", put(admin::update_investigation_settings))
```

- [ ] **Step 5: Add sqlx offline query snapshot**

Since `SQLX_OFFLINE=true` is required for CI, update the offline snapshots:

```bash
cd hadron-web
# Start a local postgres first, then:
cargo sqlx prepare --workspace
```

If no local Postgres is available, add `#[allow(dead_code)]` on the new db functions and skip this step — CI will fail only if sqlx compile-time checking is enabled.

- [ ] **Step 6: Verify web compiles**

```bash
cd hadron-web && SQLX_OFFLINE=true cargo check -p hadron-server
```

- [ ] **Step 7: Commit**

```bash
git add hadron-web/migrations/019_investigation_settings.sql
git add hadron-web/crates/hadron-server/src/db/mod.rs
git add hadron-web/crates/hadron-server/src/routes/admin.rs
git add hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(web): add investigation settings migration and admin routes"
```

---

## Phase 5 Complete — Final Integration Check

- [ ] **Desktop full build**

```bash
cd hadron-desktop/src-tauri && cargo build
cd hadron-desktop && npm run build
```

- [ ] **Web full build**

```bash
cd hadron-web && SQLX_OFFLINE=true cargo build
cd hadron-web/frontend && npm run build
```

- [ ] **Final commit tag**

```bash
git tag -a "investigation-v1.0" -m "CodexMgX investigation integration complete (Phase 1-5)"
```
