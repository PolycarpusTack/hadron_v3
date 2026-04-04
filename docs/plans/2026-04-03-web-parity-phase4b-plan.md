# Web-Desktop Parity Phase 4b: Release Notes Review & Compliance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add review workflow (status transitions with role gating), interactive checklist (admin-configurable), and AI compliance checking to the web release notes feature.

**Architecture:** Extend hadron-core `release_notes.rs` with compliance types/prompt/parser. hadron-server gets migration 017, status transition route with role+checklist gating, checklist CRUD, admin checklist config, and compliance route. Frontend gets ReleaseNotesReview (checklist + status), ReleaseNotesCompliance (violation display), ChecklistConfigPanel (admin), and editor integration.

**Tech Stack:** Rust (hadron-core, Axum), React 18, TypeScript, PostgreSQL

**Spec:** `docs/plans/2026-04-03-web-parity-phase4b-design.md`

---

## File Map

### hadron-core (modify)
- `hadron-web/crates/hadron-core/src/ai/release_notes.rs` — Add compliance types, prompt, parser, default checklist constant, tests

### hadron-server (create)
- `hadron-web/migrations/017_release_notes_review.sql` — Add checklist_state, reviewed_by, reviewed_at, published_at columns

### hadron-server (modify)
- `hadron-web/crates/hadron-server/src/db/mod.rs` — Add ReleaseNote struct fields, status/checklist DB functions
- `hadron-web/crates/hadron-server/src/routes/release_notes.rs` — Add status transition, checklist CRUD, compliance route
- `hadron-web/crates/hadron-server/src/routes/admin.rs` — Add checklist config routes
- `hadron-web/crates/hadron-server/src/routes/mod.rs` — Register new routes

### Frontend (create)
- `hadron-web/frontend/src/components/release-notes/ReleaseNotesReview.tsx` — Checklist + status workflow
- `hadron-web/frontend/src/components/release-notes/ReleaseNotesCompliance.tsx` — Violation display
- `hadron-web/frontend/src/components/admin/ChecklistConfigPanel.tsx` — Admin checklist editor

### Frontend (modify)
- `hadron-web/frontend/src/services/api.ts` — Add types + methods
- `hadron-web/frontend/src/components/release-notes/ReleaseNoteEditor.tsx` — Integrate review + compliance
- `hadron-web/frontend/src/components/admin/AdminPanel.tsx` — Add "Checklist" tab

---

## Task 1: Migration 017

**Files:**
- Create: `hadron-web/migrations/017_release_notes_review.sql`

- [ ] **Step 1: Create migration**

```sql
-- 017: Add review workflow columns to release_notes

ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS checklist_state JSONB;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id);
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
```

- [ ] **Step 2: Commit**

```bash
git add hadron-web/migrations/017_release_notes_review.sql
git commit -m "feat: add migration 017 for release notes review workflow"
```

---

## Task 2: hadron-core — Compliance Types, Prompt, Parser & Default Checklist

**Files:**
- Modify: `hadron-web/crates/hadron-core/src/ai/release_notes.rs`

- [ ] **Step 1: Add compliance types**

Insert before the `compute_insights` function in `release_notes.rs`:

```rust
// ── Compliance Types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceReport {
    #[serde(default)]
    pub terminology_violations: Vec<TerminologyViolation>,
    #[serde(default)]
    pub structure_violations: Vec<StructureViolation>,
    #[serde(default)]
    pub screenshot_suggestions: Vec<ScreenshotSuggestion>,
    #[serde(default)]
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TerminologyViolation {
    #[serde(default)]
    pub term: String,
    #[serde(default)]
    pub correct_term: String,
    #[serde(default)]
    pub context: String,
    #[serde(default)]
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StructureViolation {
    #[serde(default)]
    pub rule: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotSuggestion {
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub reason: String,
}
```

- [ ] **Step 2: Add default checklist constant**

```rust
// ── Default Checklist ────────────────────────────────────────────────────

pub const DEFAULT_CHECKLIST_ITEMS: &[&str] = &[
    "Title is concise and searchable",
    "Correctly labelled as feature or bug fix",
    "Base fix version correctly entered",
    "Base ticket linked (both sides for Cloud)",
    "Keywords entered (including UPGRADE if needed)",
    "Administration checkbox set if applicable",
    "WHATS'ON module entered",
    "In the appropriate epic",
    "Features adapted into sentences in epic",
    "Purpose of feature/fix is clear",
    "Screenshots use deployed images (not DEV)",
    "Correct WHATS'ON terminology used",
];
```

- [ ] **Step 3: Add compliance prompt, message builder, and parser**

```rust
// ── Compliance Prompt ────────────────────────────────────────────────────

pub const COMPLIANCE_SYSTEM_PROMPT: &str = r#"You are a release notes style guide auditor. Given a release notes draft and a style guide, check compliance and return ONLY valid JSON:

{
  "terminologyViolations": [
    { "term": "wrong term found", "correctTerm": "what it should be", "context": "surrounding text", "suggestion": "how to fix" }
  ],
  "structureViolations": [
    { "rule": "which rule was violated", "description": "what is wrong", "location": "where in the text", "suggestion": "how to fix" }
  ],
  "screenshotSuggestions": [
    { "location": "where to insert", "description": "what to screenshot", "reason": "why it helps" }
  ],
  "score": 85
}

Scoring:
- Start at 100
- Each terminology violation: -3 points (wrong UI terms, abbreviations, "customers" vs "users", passive voice, quotes around UI text instead of bold)
- Each structure violation: -5 points (features missing Introduction/Detail/Conclusion, fixes not starting "Previously...", missing ticket references [KEY-123], titles with colons or quotes, fixes not ending "This issue has been fixed.")
- Screenshot suggestions do NOT affect score
- Minimum score is 0

Be thorough but fair. Only flag genuine violations, not stylistic preferences."#;

pub fn build_compliance_messages(
    markdown: &str,
    style_guide: &str,
) -> (String, Vec<super::types::AiMessage>) {
    let system = format!(
        "{}\n\n=== STYLE GUIDE ===\n{}",
        COMPLIANCE_SYSTEM_PROMPT, style_guide
    );
    let user_content = format!(
        "Audit the following release notes draft for style guide compliance:\n\n{}",
        truncate_chars(markdown, 50000)
    );
    let messages = vec![super::types::AiMessage {
        role: "user".to_string(),
        content: user_content,
    }];
    (system, messages)
}

pub fn parse_compliance_response(raw: &str) -> HadronResult<ComplianceReport> {
    let json_str = super::parsers::strip_markdown_fences(raw);
    serde_json::from_str(json_str).map_err(|e| {
        let preview = &json_str[..json_str.len().min(300)];
        HadronError::Parse(format!(
            "Failed to parse compliance response: {e}. Preview: {preview}"
        ))
    })
}
```

- [ ] **Step 4: Add tests**

Add to the existing `#[cfg(test)] mod tests` block:

```rust
    #[test]
    fn test_build_compliance_prompt() {
        let (system, messages) = build_compliance_messages("## Release Notes\nSome content", "Test guide");
        assert!(system.contains("style guide auditor"));
        assert!(system.contains("Test guide"));
        assert_eq!(messages.len(), 1);
        assert!(messages[0].content.contains("Release Notes"));
    }

    #[test]
    fn test_parse_compliance_response() {
        let json = r#"{
            "terminologyViolations": [
                { "term": "customers", "correctTerm": "users", "context": "for our customers", "suggestion": "Replace with 'users'" }
            ],
            "structureViolations": [
                { "rule": "Fix format", "description": "Missing 'Previously'", "location": "Line 5", "suggestion": "Start with 'Previously, ...'" }
            ],
            "screenshotSuggestions": [
                { "location": "After section 2", "description": "New dialog screenshot", "reason": "UI change introduced" }
            ],
            "score": 82.0
        }"#;
        let report = parse_compliance_response(json).unwrap();
        assert_eq!(report.terminology_violations.len(), 1);
        assert_eq!(report.terminology_violations[0].term, "customers");
        assert_eq!(report.structure_violations.len(), 1);
        assert_eq!(report.screenshot_suggestions.len(), 1);
        assert!((report.score - 82.0).abs() < 0.1);
    }

    #[test]
    fn test_parse_compliance_defaults() {
        let json = r#"{"score": 100}"#;
        let report = parse_compliance_response(json).unwrap();
        assert!(report.terminology_violations.is_empty());
        assert!(report.structure_violations.is_empty());
        assert!(report.screenshot_suggestions.is_empty());
        assert!((report.score - 100.0).abs() < 0.1);
    }

    #[test]
    fn test_default_checklist_items() {
        assert_eq!(DEFAULT_CHECKLIST_ITEMS.len(), 12);
        for item in DEFAULT_CHECKLIST_ITEMS {
            assert!(!item.is_empty());
        }
    }
```

- [ ] **Step 5: Verify compilation and tests**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- release_notes`

Expected: All tests pass (13 from Phase 4a + 4 new = 17 total).

- [ ] **Step 6: Commit**

```bash
git add hadron-web/crates/hadron-core/src/ai/release_notes.rs
git commit -m "feat(core): add compliance types, prompt, parser, and default checklist"
```

---

## Task 3: hadron-server — DB Helpers for Status & Checklist

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/db/mod.rs`

- [ ] **Step 1: Add new fields to the ReleaseNote struct**

Find the existing `ReleaseNote` struct (around line 1010) and add these fields:

```rust
pub struct ReleaseNote {
    pub id: i64,
    pub user_id: Uuid,
    pub title: String,
    pub version: Option<String>,
    pub content: String,
    pub format: String,
    pub is_published: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub ai_insights: Option<serde_json::Value>,
    // Phase 4b fields
    pub status: Option<String>,
    pub checklist_state: Option<serde_json::Value>,
    pub reviewed_by: Option<Uuid>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub published_at: Option<DateTime<Utc>>,
    pub markdown_content: Option<String>,
}
```

Update all SQL SELECT queries for release notes to include the new columns. Also update any `ReleaseNoteRow` or `From` impl if present.

- [ ] **Step 2: Add status update function**

```rust
pub async fn update_release_note_status(
    pool: &PgPool,
    id: i64,
    user_id: Uuid,
    status: &str,
    reviewed_by: Option<Uuid>,
    reviewed_at: Option<DateTime<Utc>>,
    published_at: Option<DateTime<Utc>>,
) -> HadronResult<()> {
    let result = sqlx::query(
        "UPDATE release_notes SET status = $1, reviewed_by = $2, reviewed_at = $3, published_at = $4, updated_at = now()
         WHERE id = $5 AND deleted_at IS NULL",
    )
    .bind(status)
    .bind(reviewed_by)
    .bind(reviewed_at)
    .bind(published_at)
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(HadronError::not_found("Release note not found"));
    }
    Ok(())
}
```

- [ ] **Step 3: Add checklist update function**

```rust
pub async fn update_release_note_checklist(
    pool: &PgPool,
    id: i64,
    user_id: Uuid,
    checklist: &serde_json::Value,
) -> HadronResult<()> {
    let result = sqlx::query(
        "UPDATE release_notes SET checklist_state = $1, updated_at = now()
         WHERE id = $2 AND deleted_at IS NULL",
    )
    .bind(checklist)
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(HadronError::not_found("Release note not found"));
    }
    Ok(())
}
```

- [ ] **Step 4: Add owner lookup function**

```rust
pub async fn get_release_note_owner(pool: &PgPool, id: i64) -> HadronResult<Uuid> {
    let row: (Uuid,) = sqlx::query_as(
        "SELECT user_id FROM release_notes WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;
    Ok(row.0)
}
```

- [ ] **Step 5: Verify compilation**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check`

- [ ] **Step 6: Commit**

```bash
git add hadron-web/crates/hadron-server/src/db/mod.rs
git commit -m "feat(server): add release notes status, checklist, and owner DB helpers"
```

---

## Task 4: hadron-server — Status Transition & Checklist Routes

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/routes/release_notes.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Add status transition handler**

Append to `release_notes.rs`:

```rust
// ── Review Workflow ──────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusRequest {
    pub status: String,
}

pub async fn update_release_note_status(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateStatusRequest>,
) -> Result<impl IntoResponse, AppError> {
    let note = db::get_release_note(&state.db, id, user.user.id)
        .await
        .map_err(|e| AppError(e))?;
    let current_status = note.status.as_deref().unwrap_or("draft");
    let new_status = req.status.as_str();
    let owner_id = db::get_release_note_owner(&state.db, id)
        .await
        .map_err(|e| AppError(e))?;
    let is_owner = user.user.id == owner_id;

    // Validate transition + role
    match (current_status, new_status) {
        ("draft", "in_review") => {
            if !is_owner {
                return Err(AppError(hadron_core::error::HadronError::forbidden(
                    "Only the owner can submit for review.",
                )));
            }
            // Check checklist completeness
            check_checklist_complete(&note)?;
        }
        ("in_review", "approved") => {
            crate::middleware::require_role(&user, hadron_core::models::Role::Lead)
                .map_err(|_| AppError(hadron_core::error::HadronError::forbidden(
                    "Only lead or admin can approve.",
                )))?;
            check_checklist_complete(&note)?;
        }
        ("approved", "published") => {
            crate::middleware::require_role(&user, hadron_core::models::Role::Admin)
                .map_err(|_| AppError(hadron_core::error::HadronError::forbidden(
                    "Only admin can publish.",
                )))?;
            check_checklist_complete(&note)?;
        }
        ("in_review", "draft") => {
            if !is_owner {
                return Err(AppError(hadron_core::error::HadronError::forbidden(
                    "Only the owner can withdraw from review.",
                )));
            }
        }
        (_, "archived") => {
            if !is_owner {
                crate::middleware::require_role(&user, hadron_core::models::Role::Admin)
                    .map_err(|_| AppError(hadron_core::error::HadronError::forbidden(
                        "Only the owner or admin can archive.",
                    )))?;
            }
        }
        _ => {
            return Err(AppError(hadron_core::error::HadronError::validation(
                format!("Invalid transition: {} → {}", current_status, new_status),
            )));
        }
    }

    let now = chrono::Utc::now();
    let reviewed_by = if new_status == "approved" { Some(user.user.id) } else { None };
    let reviewed_at = if new_status == "approved" { Some(now) } else { None };
    let published_at = if new_status == "published" { Some(now) } else { None };

    db::update_release_note_status(
        &state.db, id, user.user.id, new_status,
        reviewed_by, reviewed_at, published_at,
    )
    .await
    .map_err(|e| AppError(e))?;

    Ok(StatusCode::NO_CONTENT)
}

fn check_checklist_complete(note: &db::ReleaseNote) -> Result<(), AppError> {
    if let Some(ref checklist) = note.checklist_state {
        if let Some(items) = checklist.as_array() {
            let all_checked = items.iter().all(|item| {
                item.get("checked").and_then(|v| v.as_bool()).unwrap_or(false)
            });
            if !all_checked {
                return Err(AppError(hadron_core::error::HadronError::validation(
                    "All checklist items must be checked before this transition.",
                )));
            }
            return Ok(());
        }
    }
    // No checklist state = not complete
    Err(AppError(hadron_core::error::HadronError::validation(
        "Checklist must be completed before this transition.",
    )))
}
```

- [ ] **Step 2: Add checklist CRUD handlers**

```rust
pub async fn get_checklist(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let note = db::get_release_note(&state.db, id, user.user.id)
        .await
        .map_err(|e| AppError(e))?;

    let items: Vec<serde_json::Value> = if let Some(ref state_json) = note.checklist_state {
        serde_json::from_value(state_json.clone()).unwrap_or_default()
    } else {
        // Initialize from configured checklist
        let config_items = get_checklist_items(&state.db).await;
        config_items.iter().map(|item| {
            serde_json::json!({ "item": item, "checked": false })
        }).collect()
    };

    let complete = items.iter().all(|item| {
        item.get("checked").and_then(|v| v.as_bool()).unwrap_or(false)
    });

    Ok(Json(serde_json::json!({
        "items": items,
        "complete": complete,
    })))
}

async fn get_checklist_items(pool: &sqlx::PgPool) -> Vec<String> {
    if let Ok(Some(custom)) = db::get_global_setting(pool, "release_notes_checklist").await {
        if !custom.is_empty() {
            if let Ok(items) = serde_json::from_str::<Vec<String>>(&custom) {
                return items;
            }
        }
    }
    hadron_core::ai::DEFAULT_CHECKLIST_ITEMS.iter().map(|s| s.to_string()).collect()
}

pub async fn update_checklist(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(items): Json<Vec<serde_json::Value>>,
) -> Result<impl IntoResponse, AppError> {
    let checklist_json = serde_json::to_value(&items)
        .map_err(|e| AppError(hadron_core::error::HadronError::validation(e.to_string())))?;
    db::update_release_note_checklist(&state.db, id, user.user.id, &checklist_json)
        .await
        .map_err(|e| AppError(e))?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 3: Register routes in mod.rs**

Add to the release notes section:

```rust
// Release notes review workflow
.route("/release-notes/{id}/status", put(release_notes::update_release_note_status))
.route("/release-notes/{id}/checklist", get(release_notes::get_checklist))
.route("/release-notes/{id}/checklist", put(release_notes::update_checklist))
```

- [ ] **Step 4: Add necessary imports to release_notes.rs**

Add at top of the file if not present:

```rust
use axum::http::StatusCode;
use crate::middleware;
```

- [ ] **Step 5: Verify compilation**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check`

- [ ] **Step 6: Commit**

```bash
git add hadron-web/crates/hadron-server/src/routes/release_notes.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(server): add status transition and checklist routes with role gating"
```

---

## Task 5: hadron-server — Admin Checklist Config & Compliance Route

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/routes/admin.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/release_notes.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Add admin checklist config routes to admin.rs**

```rust
// ── Checklist Config ─────────────────────────────────────────────────────

pub async fn get_checklist_config(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let custom = db::get_global_setting(&state.db, "release_notes_checklist")
        .await?
        .filter(|s| !s.is_empty());
    let is_custom = custom.is_some();
    let items: Vec<String> = if let Some(ref json_str) = custom {
        serde_json::from_str(json_str).unwrap_or_else(|_| {
            hadron_core::ai::DEFAULT_CHECKLIST_ITEMS.iter().map(|s| s.to_string()).collect()
        })
    } else {
        hadron_core::ai::DEFAULT_CHECKLIST_ITEMS.iter().map(|s| s.to_string()).collect()
    };
    Ok(Json(serde_json::json!({
        "items": items,
        "isCustom": is_custom,
    })))
}

#[derive(Deserialize)]
pub struct UpdateChecklistConfigRequest {
    pub items: Vec<String>,
}

pub async fn update_checklist_config(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<UpdateChecklistConfigRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;
    let json = serde_json::to_string(&req.items)
        .map_err(|e| AppError(hadron_core::error::HadronError::validation(e.to_string())))?;
    db::set_global_setting(&state.db, "release_notes_checklist", &json, user.user.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_checklist_config(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;
    db::set_global_setting(&state.db, "release_notes_checklist", "", user.user.id).await?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: Add compliance route to release_notes.rs**

```rust
pub async fn run_compliance_check(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let note = db::get_release_note(&state.db, id, user.user.id)
        .await
        .map_err(|e| AppError(e))?;

    let content = note.markdown_content.as_deref()
        .unwrap_or(&note.content);

    // Resolve style guide
    let style_guide = db::get_global_setting(&state.db, "release_notes_style_guide")
        .await
        .ok()
        .flatten()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| hadron_core::ai::DEFAULT_STYLE_GUIDE.to_string());

    // Resolve AI config
    let ai_config = crate::routes::analyses::resolve_ai_config(
        &state.db, None, None, None,
    ).await?;

    // Build messages and call AI
    let (system, messages) = hadron_core::ai::build_compliance_messages(content, &style_guide);
    let raw = crate::ai::complete(&ai_config, messages, Some(&system)).await?;
    let report = hadron_core::ai::parse_compliance_response(&raw)?;

    Ok(Json(report))
}
```

- [ ] **Step 3: Register routes in mod.rs**

```rust
// Admin checklist config
.route("/admin/checklist-config", get(admin::get_checklist_config))
.route("/admin/checklist-config", put(admin::update_checklist_config))
.route("/admin/checklist-config", delete(admin::delete_checklist_config))

// Release notes compliance
.route("/release-notes/{id}/compliance", post(release_notes::run_compliance_check))
```

- [ ] **Step 4: Verify compilation**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check`

- [ ] **Step 5: Commit**

```bash
git add hadron-web/crates/hadron-server/src/routes/admin.rs hadron-web/crates/hadron-server/src/routes/release_notes.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(server): add admin checklist config and compliance check routes"
```

---

## Task 6: Frontend — API Types & Methods

**Files:**
- Modify: `hadron-web/frontend/src/services/api.ts`

- [ ] **Step 1: Add types**

```typescript
// ── Release Notes Review & Compliance Types ───────────────────────────

export interface ComplianceReport {
  terminologyViolations: TerminologyViolation[];
  structureViolations: StructureViolation[];
  screenshotSuggestions: ScreenshotSuggestion[];
  score: number;
}

export interface TerminologyViolation {
  term: string;
  correctTerm: string;
  context: string;
  suggestion: string;
}

export interface StructureViolation {
  rule: string;
  description: string;
  location: string;
  suggestion: string;
}

export interface ScreenshotSuggestion {
  location: string;
  description: string;
  reason: string;
}

export interface ChecklistItem {
  item: string;
  checked: boolean;
}

export interface ChecklistResponse {
  items: ChecklistItem[];
  complete: boolean;
}

export interface ChecklistConfigResponse {
  items: string[];
  isCustom: boolean;
}
```

- [ ] **Step 2: Add API methods**

```typescript
  // ── Release Notes Review & Compliance ───────────────────────────
  async updateReleaseNoteStatus(id: number, status: string): Promise<void> {
    await this.request(`/release-notes/${id}/status`, {
      method: 'PUT',
      headers: { ...await this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
  }

  async getReleaseNoteChecklist(id: number): Promise<ChecklistResponse> {
    return this.request<ChecklistResponse>(`/release-notes/${id}/checklist`);
  }

  async updateReleaseNoteChecklist(id: number, items: ChecklistItem[]): Promise<void> {
    await this.request(`/release-notes/${id}/checklist`, {
      method: 'PUT',
      headers: { ...await this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
    });
  }

  async runComplianceCheck(id: number): Promise<ComplianceReport> {
    return this.request<ComplianceReport>(`/release-notes/${id}/compliance`, {
      method: 'POST',
      headers: await this.headers(),
    });
  }

  async getChecklistConfig(): Promise<ChecklistConfigResponse> {
    return this.request<ChecklistConfigResponse>('/admin/checklist-config');
  }

  async updateChecklistConfig(items: string[]): Promise<void> {
    await this.request('/admin/checklist-config', {
      method: 'PUT',
      headers: { ...await this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
  }

  async deleteChecklistConfig(): Promise<void> {
    await this.request('/admin/checklist-config', { method: 'DELETE', headers: await this.headers() });
  }
```

- [ ] **Step 3: Add review fields to ReleaseNote interface**

Update the existing `ReleaseNote` interface to include:

```typescript
  status: string | null;
  checklistState: ChecklistItem[] | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  markdownContent: string | null;
```

- [ ] **Step 4: Commit**

```bash
git add hadron-web/frontend/src/services/api.ts
git commit -m "feat(frontend): add review and compliance types and API methods"
```

---

## Task 7: Frontend — ChecklistConfigPanel & AdminPanel

**Files:**
- Create: `hadron-web/frontend/src/components/admin/ChecklistConfigPanel.tsx`
- Modify: `hadron-web/frontend/src/components/admin/AdminPanel.tsx`

- [ ] **Step 1: Create ChecklistConfigPanel.tsx (~100-120 lines)**

Admin panel for managing checklist items:
- State: `items` (string[]), `isCustom` (boolean), `newItem` (string), `loading`, `message`
- On mount: load from `api.getChecklistConfig()`
- Each item: text display + delete button (X)
- "Add Item" input at bottom + Add button
- "Save" button → `api.updateChecklistConfig(items)`
- "Reset to Default" button → `api.deleteChecklistConfig()`, reload
- Item count badge
- Use amber color scheme (consistent with release notes)

- [ ] **Step 2: Wire into AdminPanel.tsx**

Add `"checklist"` to AdminTab type, add tab button "Checklist", render `<ChecklistConfigPanel />`.

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/admin/ChecklistConfigPanel.tsx hadron-web/frontend/src/components/admin/AdminPanel.tsx
git commit -m "feat(frontend): add admin checklist configuration panel"
```

---

## Task 8: Frontend — ReleaseNotesReview Component

**Files:**
- Create: `hadron-web/frontend/src/components/release-notes/ReleaseNotesReview.tsx`

- [ ] **Step 1: Create ReleaseNotesReview.tsx (~150-180 lines)**

Props:
```typescript
interface ReleaseNotesReviewProps {
  noteId: number;
  status: string | null;
  noteOwnerId: string;
  currentUserId: string;
  currentUserRole: string;
  onStatusChange: () => void;
}
```

**UI:**
- **Status badge:** colored pill (gray=draft, blue=in_review, amber=approved, green=published, gray=archived)
- **Checklist section:**
  - Load on mount via `api.getReleaseNoteChecklist(noteId)`
  - Completion bar (percentage, colored: red <50%, amber <100%, green 100%)
  - Each item: checkbox + text. Toggle calls `api.updateReleaseNoteChecklist()` with updated items.
- **Status action buttons** (conditionally rendered):
  - Draft + owner: "Submit for Review" button (disabled if checklist incomplete)
  - In Review + lead/admin: "Approve" button (disabled if checklist incomplete)
  - In Review + owner: "Return to Draft" button
  - Approved + admin: "Publish" button
  - Any + owner/admin: "Archive" button
- All status buttons call `api.updateReleaseNoteStatus(id, newStatus)` then `onStatusChange()`
- Error display for failed transitions
- Reviewer info: if approved/published, show "Reviewed by {name} on {date}"

- [ ] **Step 2: Commit**

```bash
git add hadron-web/frontend/src/components/release-notes/ReleaseNotesReview.tsx
git commit -m "feat(frontend): add ReleaseNotesReview with checklist and status workflow"
```

---

## Task 9: Frontend — ReleaseNotesCompliance Component

**Files:**
- Create: `hadron-web/frontend/src/components/release-notes/ReleaseNotesCompliance.tsx`

- [ ] **Step 1: Create ReleaseNotesCompliance.tsx (~120-150 lines)**

Props:
```typescript
interface ReleaseNotesComplianceProps {
  noteId: number;
}
```

**UI:**
- "Run Compliance Check" button (amber) → calls `api.runComplianceCheck(noteId)`
- Loading state with spinner while AI processes
- **Results (when available):**
  - **Score:** large number with color (green ≥80, amber ≥50, red <50)
  - **Terminology violations:** amber-bordered cards. Each: "Found: {term}" → "Should be: {correctTerm}", context snippet in gray, suggestion in italic.
  - **Structure violations:** red-bordered cards. Each: rule name in bold, description, location, suggestion.
  - **Screenshot suggestions:** blue-bordered cards (informational). Each: location, description, reason.
  - If no violations: green "All clear!" message with checkmark
- Violation counts in section headers: "Terminology (3)" / "Structure (1)" / "Screenshots (2)"

- [ ] **Step 2: Commit**

```bash
git add hadron-web/frontend/src/components/release-notes/ReleaseNotesCompliance.tsx
git commit -m "feat(frontend): add ReleaseNotesCompliance with violation display"
```

---

## Task 10: Frontend — Editor Integration

**Files:**
- Modify: `hadron-web/frontend/src/components/release-notes/ReleaseNoteEditor.tsx`

- [ ] **Step 1: Integrate review and compliance into the editor**

Read the current `ReleaseNoteEditor.tsx` first (modified in Phase 4a Task 10).

Add:
1. Import `ReleaseNotesReview` and `ReleaseNotesCompliance`
2. State: `showCompliance` (boolean, default false)
3. After the content area and before insights, add the review section:
   ```tsx
   {note?.status && (
     <ReleaseNotesReview
       noteId={noteId}
       status={note.status}
       noteOwnerId={note.userId}
       currentUserId={currentUser.id}
       currentUserRole={currentUser.role}
       onStatusChange={handleReload}
     />
   )}
   ```
4. Add "Compliance Check" button in the toolbar area → toggles `showCompliance`
5. When `showCompliance`: render `<ReleaseNotesCompliance noteId={noteId} />`
6. Disable textarea when status is "approved" or "published" (add `readOnly` prop)
7. Hide Save/Publish buttons when status is "approved" or "published"

Note: The editor needs access to the current user info. Get it from the MSAL context or pass it as props. Check how other components access user info — look at how `AuthenticatedUser` is available in the frontend (likely via MSAL `useAccount` or a context).

- [ ] **Step 2: Commit**

```bash
git add hadron-web/frontend/src/components/release-notes/ReleaseNoteEditor.tsx
git commit -m "feat(frontend): integrate review workflow and compliance check into editor"
```

---

## Task 11: Integration Verification & Cleanup

- [ ] **Step 1: Verify backend compilation**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check`

- [ ] **Step 2: Run hadron-core tests**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- release_notes`

Expected: 17 tests pass (13 from 4a + 4 from 4b).

- [ ] **Step 3: Verify frontend build**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web/frontend && npx tsc --noEmit && npx vite build`

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(web): complete Release Notes Review & Compliance (Phase 4b)"
```

---

## Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | Infrastructure | Migration 017 |
| 2 | hadron-core | Compliance types, prompt, parser, default checklist, tests |
| 3 | hadron-server | DB helpers (status update, checklist, owner lookup) |
| 4 | hadron-server | Status transition + checklist routes with role gating |
| 5 | hadron-server | Admin checklist config + compliance route |
| 6 | Frontend | API types and methods |
| 7 | Frontend | ChecklistConfigPanel + AdminPanel wiring |
| 8 | Frontend | ReleaseNotesReview (checklist + status buttons) |
| 9 | Frontend | ReleaseNotesCompliance (violation display) |
| 10 | Frontend | Editor integration |
| 11 | Verification | Build checks, test runs, cleanup |
