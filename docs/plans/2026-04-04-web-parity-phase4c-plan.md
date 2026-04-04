# Web-Desktop Parity Phase 4c: Confluence Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Confluence wiki markup export (download) and direct publish to Confluence via REST API for release notes.

**Architecture:** hadron-core gets `markdown_to_confluence()` pure function. hadron-server gets `integrations/confluence.rs` (REST API publish with upsert), admin config routes, and export/publish routes. Frontend gets export/publish buttons in the editor and a ConfluenceConfigPanel for admins.

**Tech Stack:** Rust (hadron-core, Axum, reqwest), React 18, TypeScript

**Spec:** `docs/plans/2026-04-04-web-parity-phase4c-design.md`

---

## File Map

### hadron-core (modify)
- `hadron-web/crates/hadron-core/src/ai/release_notes.rs` — Add `markdown_to_confluence()` + tests

### hadron-server (create)
- `hadron-web/crates/hadron-server/src/integrations/confluence.rs` — Confluence REST API client (publish_page with upsert)

### hadron-server (modify)
- `hadron-web/crates/hadron-server/src/integrations/mod.rs` — Register confluence module
- `hadron-web/crates/hadron-server/src/routes/admin.rs` — Add Confluence config routes
- `hadron-web/crates/hadron-server/src/routes/release_notes.rs` — Add export + publish routes
- `hadron-web/crates/hadron-server/src/routes/mod.rs` — Register new routes

### Frontend (create)
- `hadron-web/frontend/src/components/admin/ConfluenceConfigPanel.tsx` — Admin config UI

### Frontend (modify)
- `hadron-web/frontend/src/services/api.ts` — Add types + methods
- `hadron-web/frontend/src/components/admin/AdminPanel.tsx` — Add "Confluence" tab
- `hadron-web/frontend/src/components/release-notes/ReleaseNoteEditor.tsx` — Add export/publish buttons

---

## Task 1: hadron-core — markdown_to_confluence + Tests

**Files:**
- Modify: `hadron-web/crates/hadron-core/src/ai/release_notes.rs`

- [ ] **Step 1: Add the conversion function**

Insert before the `#[cfg(test)]` block in `release_notes.rs`:

```rust
// ── Confluence Markup Conversion ─────────────────────────────────────────

/// Convert Markdown to Confluence wiki markup.
///
/// Ported from desktop's release_notes_service.rs.
pub fn markdown_to_confluence(markdown: &str) -> String {
    let mut output = String::with_capacity(markdown.len());
    let lines: Vec<&str> = markdown.lines().collect();

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        // Headings: ## → h2.
        if let Some(rest) = trimmed.strip_prefix("######") {
            output.push_str(&format!("h6. {}\n", rest.trim()));
        } else if let Some(rest) = trimmed.strip_prefix("#####") {
            output.push_str(&format!("h5. {}\n", rest.trim()));
        } else if let Some(rest) = trimmed.strip_prefix("####") {
            output.push_str(&format!("h4. {}\n", rest.trim()));
        } else if let Some(rest) = trimmed.strip_prefix("###") {
            output.push_str(&format!("h3. {}\n", rest.trim()));
        } else if let Some(rest) = trimmed.strip_prefix("##") {
            output.push_str(&format!("h2. {}\n", rest.trim()));
        } else if let Some(rest) = trimmed.strip_prefix('#') {
            output.push_str(&format!("h1. {}\n", rest.trim()));
        }
        // Table separator lines (|---|): skip
        else if trimmed.starts_with('|') && trimmed.contains("---") {
            continue;
        }
        // Table rows
        else if trimmed.starts_with('|') {
            let is_header = lines.get(i + 1)
                .map(|next| next.trim().starts_with('|') && next.contains("---"))
                .unwrap_or(false);

            if is_header {
                let converted = trimmed
                    .replace("**", "")
                    .replace("| ", "|| ")
                    .replace(" |", " ||");
                output.push_str(&converted);
            } else {
                output.push_str(trimmed);
            }
            output.push('\n');
        }
        // Bold: **text** → *text*
        else if trimmed.contains("**") {
            let converted = line.replace("**", "*");
            output.push_str(&converted);
            output.push('\n');
        }
        // Bullet points: - → *
        else if let Some(rest) = trimmed.strip_prefix("- ") {
            output.push_str(&format!("* {}\n", rest));
        }
        // Code blocks
        else if trimmed == "```" {
            output.push_str("{code}\n");
        } else if trimmed.starts_with("```") {
            let lang = trimmed.strip_prefix("```").unwrap_or("");
            output.push_str(&format!("{{code:language={}}}\n", lang));
        } else {
            output.push_str(line);
            output.push('\n');
        }
    }

    output
}
```

- [ ] **Step 2: Add tests**

Add to the existing `#[cfg(test)] mod tests` block:

```rust
    #[test]
    fn test_markdown_to_confluence_headings() {
        let md = "# Title\n## Section\n### Sub\n#### Deep\n";
        let wiki = markdown_to_confluence(md);
        assert!(wiki.contains("h1. Title"));
        assert!(wiki.contains("h2. Section"));
        assert!(wiki.contains("h3. Sub"));
        assert!(wiki.contains("h4. Deep"));
    }

    #[test]
    fn test_markdown_to_confluence_tables() {
        let md = "| **Key** | **Description** |\n| --- | --- |\n| PROJ-1 | Fix bug |\n";
        let wiki = markdown_to_confluence(md);
        // Header row should use ||
        assert!(wiki.contains("||"));
        // Separator line should be skipped
        assert!(!wiki.contains("---"));
        // Body row preserved
        assert!(wiki.contains("PROJ-1"));
    }

    #[test]
    fn test_markdown_to_confluence_bold_bullets() {
        let md = "This is **bold** text\n- First item\n- Second item\n";
        let wiki = markdown_to_confluence(md);
        assert!(wiki.contains("*bold*"));
        assert!(!wiki.contains("**"));
        assert!(wiki.contains("* First item"));
        assert!(wiki.contains("* Second item"));
    }

    #[test]
    fn test_markdown_to_confluence_code_blocks() {
        let md = "```rust\nfn main() {}\n```\n";
        let wiki = markdown_to_confluence(md);
        assert!(wiki.contains("{code:language=rust}"));
        assert!(wiki.contains("{code}"));
        assert!(wiki.contains("fn main()"));
    }
```

- [ ] **Step 3: Verify and commit**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- release_notes`

Expected: 21 tests pass (17 from 4a+4b + 4 new).

```bash
git add hadron-web/crates/hadron-core/src/ai/release_notes.rs
git commit -m "feat(core): add markdown_to_confluence conversion function"
```

---

## Task 2: hadron-server — Confluence Integration + Admin Config + Routes

**Files:**
- Create: `hadron-web/crates/hadron-server/src/integrations/confluence.rs`
- Modify: `hadron-web/crates/hadron-server/src/integrations/mod.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/admin.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/release_notes.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Create integrations/confluence.rs**

```rust
//! Confluence REST API integration for publishing release notes.

use hadron_core::error::{HadronError, HadronResult};
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfluencePageResult {
    pub id: String,
    pub url: String,
    pub created: bool,
}

/// Publish (create or update) a Confluence page with wiki markup content.
///
/// Uses upsert logic: searches for an existing page by title in the space.
/// If found, updates it (incrementing version). If not, creates under parent_page_id.
pub async fn publish_page(
    base_url: &str,
    email: &str,
    api_token: &str,
    space_key: &str,
    parent_page_id: &str,
    title: &str,
    confluence_markup: &str,
) -> HadronResult<ConfluencePageResult> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| HadronError::external_service(format!("HTTP client error: {e}")))?;

    let wiki_base = format!("{}/wiki", base_url.trim_end_matches('/'));

    // Step 1: Search for existing page
    let search_url = format!(
        "{}/rest/api/content?spaceKey={}&title={}&type=page",
        wiki_base,
        urlencoding::encode(space_key),
        urlencoding::encode(title),
    );

    let search_resp = client
        .get(&search_url)
        .basic_auth(email, Some(api_token))
        .send()
        .await
        .map_err(|e| HadronError::external_service(format!("Confluence search failed: {e}")))?;

    if !search_resp.status().is_success() {
        let status = search_resp.status();
        let body = search_resp.text().await.unwrap_or_default();
        return Err(HadronError::external_service(format!(
            "Confluence returned {status}: {body}"
        )));
    }

    let search_data: serde_json::Value = search_resp.json().await
        .map_err(|e| HadronError::external_service(format!("Failed to parse Confluence search: {e}")))?;

    let existing = search_data["results"]
        .as_array()
        .and_then(|arr| arr.first());

    if let Some(page) = existing {
        // Step 2a: Update existing page
        let page_id = page["id"].as_str().unwrap_or("").to_string();
        let current_version = page["version"]["number"].as_i64().unwrap_or(1);

        let update_url = format!("{}/rest/api/content/{}", wiki_base, page_id);
        let update_body = serde_json::json!({
            "id": page_id,
            "type": "page",
            "title": title,
            "space": { "key": space_key },
            "body": {
                "wiki": {
                    "value": confluence_markup,
                    "representation": "wiki"
                }
            },
            "version": {
                "number": current_version + 1
            }
        });

        let update_resp = client
            .put(&update_url)
            .basic_auth(email, Some(api_token))
            .json(&update_body)
            .send()
            .await
            .map_err(|e| HadronError::external_service(format!("Confluence update failed: {e}")))?;

        if !update_resp.status().is_success() {
            let status = update_resp.status();
            let body = update_resp.text().await.unwrap_or_default();
            return Err(HadronError::external_service(format!(
                "Confluence update returned {status}: {body}"
            )));
        }

        Ok(ConfluencePageResult {
            url: format!("{}/spaces/{}/pages/{}", wiki_base, space_key, page_id),
            id: page_id,
            created: false,
        })
    } else {
        // Step 2b: Create new page
        let create_url = format!("{}/rest/api/content", wiki_base);
        let mut create_body = serde_json::json!({
            "type": "page",
            "title": title,
            "space": { "key": space_key },
            "body": {
                "wiki": {
                    "value": confluence_markup,
                    "representation": "wiki"
                }
            }
        });

        if !parent_page_id.is_empty() {
            create_body["ancestors"] = serde_json::json!([{ "id": parent_page_id }]);
        }

        let create_resp = client
            .post(&create_url)
            .basic_auth(email, Some(api_token))
            .json(&create_body)
            .send()
            .await
            .map_err(|e| HadronError::external_service(format!("Confluence create failed: {e}")))?;

        if !create_resp.status().is_success() {
            let status = create_resp.status();
            let body = create_resp.text().await.unwrap_or_default();
            return Err(HadronError::external_service(format!(
                "Confluence create returned {status}: {body}"
            )));
        }

        let created: serde_json::Value = create_resp.json().await
            .map_err(|e| HadronError::external_service(format!("Failed to parse create response: {e}")))?;

        let page_id = created["id"].as_str().unwrap_or("").to_string();

        Ok(ConfluencePageResult {
            url: format!("{}/spaces/{}/pages/{}", wiki_base, space_key, page_id),
            id: page_id,
            created: true,
        })
    }
}
```

- [ ] **Step 2: Register confluence module**

In `hadron-web/crates/hadron-server/src/integrations/mod.rs`, add:

```rust
pub mod confluence;
```

- [ ] **Step 3: Add admin Confluence config routes to admin.rs**

```rust
// ── Confluence Config ────────────────────────────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfluenceConfigStatus {
    pub space_key: String,
    pub parent_page_id: String,
    pub configured: bool,
}

pub async fn get_confluence_config(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let space_key = db::get_global_setting(&state.db, "confluence_space_key")
        .await?
        .unwrap_or_default();
    let parent_page_id = db::get_global_setting(&state.db, "confluence_parent_page_id")
        .await?
        .unwrap_or_default();
    let configured = !space_key.is_empty();

    Ok(Json(ConfluenceConfigStatus {
        space_key,
        parent_page_id,
        configured,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConfluenceConfigRequest {
    pub space_key: Option<String>,
    pub parent_page_id: Option<String>,
}

pub async fn update_confluence_config(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<UpdateConfluenceConfigRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    if let Some(ref key) = req.space_key {
        db::set_global_setting(&state.db, "confluence_space_key", key, user.user.id).await?;
    }
    if let Some(ref id) = req.parent_page_id {
        db::set_global_setting(&state.db, "confluence_parent_page_id", id, user.user.id).await?;
    }

    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 4: Add export + publish routes to release_notes.rs**

```rust
// ── Confluence Export & Publish ───────────────────────────────────────────

pub async fn export_confluence(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let note = db::get_release_note(&state.db, id, user.user.id)
        .await
        .map_err(|e| AppError(e))?;
    let content = note.markdown_content.as_deref().unwrap_or(&note.content);
    let wiki = hadron_core::ai::markdown_to_confluence(content);

    Ok((
        [(axum::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        wiki,
    ))
}

pub async fn publish_confluence(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let note = db::get_release_note(&state.db, id, user.user.id)
        .await
        .map_err(|e| AppError(e))?;

    // Load Confluence config
    let space_key = db::get_global_setting(&state.db, "confluence_space_key")
        .await?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError(hadron_core::error::HadronError::validation(
            "Confluence is not configured. Set space key in admin panel.",
        )))?;
    let parent_page_id = db::get_global_setting(&state.db, "confluence_parent_page_id")
        .await?
        .unwrap_or_default();

    // Load JIRA credentials (shared Atlassian auth)
    let jira_config = db::get_jira_config_from_poller(&state.db)
        .await
        .map_err(|e| AppError(e))?;

    let content = note.markdown_content.as_deref().unwrap_or(&note.content);
    let wiki = hadron_core::ai::markdown_to_confluence(content);

    let result = crate::integrations::confluence::publish_page(
        &jira_config.base_url,
        &jira_config.email,
        &jira_config.api_token,
        &space_key,
        &parent_page_id,
        &note.title,
        &wiki,
    )
    .await
    .map_err(|e| AppError(e))?;

    Ok(Json(result))
}
```

- [ ] **Step 5: Register routes in mod.rs**

```rust
// Confluence config
.route("/admin/confluence", get(admin::get_confluence_config))
.route("/admin/confluence", put(admin::update_confluence_config))

// Release notes Confluence export/publish
.route("/release-notes/{id}/export/confluence", post(release_notes::export_confluence))
.route("/release-notes/{id}/publish/confluence", post(release_notes::publish_confluence))
```

- [ ] **Step 6: Check if urlencoding crate is available**

The `publish_page` function uses `urlencoding::encode()`. Check if it's in Cargo.toml. If not, use `percent_encoding` or simple string replacement for the URL parameters. Alternatively, pass parameters as query params via reqwest's `.query()` method instead of manual URL construction.

- [ ] **Step 7: Verify compilation**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check`

- [ ] **Step 8: Commit**

```bash
git add hadron-web/crates/hadron-server/src/integrations/confluence.rs hadron-web/crates/hadron-server/src/integrations/mod.rs hadron-web/crates/hadron-server/src/routes/admin.rs hadron-web/crates/hadron-server/src/routes/release_notes.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(server): add Confluence integration, admin config, export and publish routes"
```

---

## Task 3: Frontend — API Types, Methods, Admin Panel & Editor Buttons

**Files:**
- Modify: `hadron-web/frontend/src/services/api.ts`
- Create: `hadron-web/frontend/src/components/admin/ConfluenceConfigPanel.tsx`
- Modify: `hadron-web/frontend/src/components/admin/AdminPanel.tsx`
- Modify: `hadron-web/frontend/src/components/release-notes/ReleaseNoteEditor.tsx`

- [ ] **Step 1: Add types and methods to api.ts**

Types:
```typescript
export interface ConfluencePageResult {
  id: string;
  url: string;
  created: boolean;
}

export interface ConfluenceConfig {
  spaceKey: string;
  parentPageId: string;
  configured: boolean;
}
```

Methods on ApiClient:
```typescript
  async exportConfluence(id: number): Promise<string> {
    const resp = await fetch(`${this.baseUrl}/release-notes/${id}/export/confluence`, {
      method: 'POST',
      headers: await this.headers(),
    });
    if (!resp.ok) throw new Error(await resp.text());
    return resp.text();
  }

  async publishToConfluence(id: number): Promise<ConfluencePageResult> {
    return this.request<ConfluencePageResult>(`/release-notes/${id}/publish/confluence`, {
      method: 'POST',
      headers: await this.headers(),
    });
  }

  async getConfluenceConfig(): Promise<ConfluenceConfig> {
    return this.request<ConfluenceConfig>('/admin/confluence');
  }

  async updateConfluenceConfig(config: { spaceKey?: string; parentPageId?: string }): Promise<void> {
    await this.request('/admin/confluence', {
      method: 'PUT',
      headers: { ...await this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
  }
```

Note: `exportConfluence` returns raw text (not JSON), so use `resp.text()` directly instead of `this.request()`.

- [ ] **Step 2: Create ConfluenceConfigPanel.tsx (~80-100 lines)**

Simple admin panel:
- State: `spaceKey`, `parentPageId`, `configured`, `loading`, `message`
- On mount: load from `api.getConfluenceConfig()`
- Inputs: Space Key, Parent Page ID
- Save button → `api.updateConfluenceConfig({ spaceKey, parentPageId })`
- Status badge (Configured / Not configured)
- Use amber color scheme

- [ ] **Step 3: Wire into AdminPanel.tsx**

Add `"confluence"` to AdminTab, add tab button "Confluence", render `<ConfluenceConfigPanel />`.

- [ ] **Step 4: Add export/publish buttons to ReleaseNoteEditor.tsx**

Read the current file. Add in the action buttons area:

```tsx
{noteId && (
  <>
    <button
      onClick={handleExportConfluence}
      className="px-3 py-1.5 text-sm border border-amber-600 text-amber-700 rounded hover:bg-amber-50"
    >
      Export Confluence
    </button>
    {confluenceConfigured && (
      <button
        onClick={handlePublishConfluence}
        disabled={publishingConfluence}
        className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
      >
        {publishingConfluence ? 'Publishing...' : 'Publish to Confluence'}
      </button>
    )}
  </>
)}
```

Add state:
```typescript
const [confluenceConfigured, setConfluenceConfigured] = useState(false);
const [publishingConfluence, setPublishingConfluence] = useState(false);
const [confluenceResult, setConfluenceResult] = useState<{ url: string; created: boolean } | null>(null);
```

On mount: check `api.getConfluenceConfig()` → `setConfluenceConfigured(config.configured)`.

Handlers:
```typescript
async function handleExportConfluence() {
  if (!noteId) return;
  try {
    const text = await api.exportConfluence(noteId);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'release-notes'}-confluence.txt`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { /* show error */ }
}

async function handlePublishConfluence() {
  if (!noteId) return;
  setPublishingConfluence(true);
  try {
    const result = await api.publishToConfluence(noteId);
    setConfluenceResult(result);
  } catch (e) { /* show error */ }
  setPublishingConfluence(false);
}
```

Show success message with link when `confluenceResult`:
```tsx
{confluenceResult && (
  <div className="text-sm text-green-700 bg-green-50 p-2 rounded">
    {confluenceResult.created ? 'Page created' : 'Page updated'}:{' '}
    <a href={confluenceResult.url} target="_blank" rel="noopener" className="underline">
      View in Confluence
    </a>
  </div>
)}
```

- [ ] **Step 5: Commit**

```bash
git add hadron-web/frontend/src/services/api.ts hadron-web/frontend/src/components/admin/ConfluenceConfigPanel.tsx hadron-web/frontend/src/components/admin/AdminPanel.tsx hadron-web/frontend/src/components/release-notes/ReleaseNoteEditor.tsx
git commit -m "feat(frontend): add Confluence export/publish buttons and admin config"
```

---

## Task 4: Integration Verification

- [ ] **Step 1: Backend tests**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- release_notes`

Expected: 21 tests pass.

- [ ] **Step 2: Backend compilation**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check`

- [ ] **Step 3: Frontend build**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web/frontend && npx tsc --noEmit && npx vite build`

- [ ] **Step 4: Fix any issues and commit**

```bash
git add -A
git commit -m "feat(web): complete Confluence Export (Phase 4c)"
```

---

## Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | hadron-core | `markdown_to_confluence()` + 4 tests |
| 2 | hadron-server | Confluence integration, admin config, export/publish routes |
| 3 | Frontend | API types/methods, ConfluenceConfigPanel, editor buttons |
| 4 | Verification | Tests, compilation, build |
