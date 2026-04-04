# Web-Desktop Parity Phase 4a: Release Notes AI Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the desktop's Release Notes AI generation pipeline to the web — JIRA extraction, batch AI enrichment, markdown generation with embedded style guide, insights computation, and SSE progress streaming.

**Architecture:** hadron-core gets `ai/release_notes.rs` (types, enrichment prompt/parser, generation prompt, insights). hadron-server gets migration 016, fix-versions route, admin style guide routes, and a multi-phase SSE pipeline route. Frontend gets `useProgressStream` hook, ReleaseNotesGenerator, enhanced editor with insights, and style guide viewer.

**Tech Stack:** Rust (hadron-core, Axum), React 18, TypeScript, SSE streaming, PostgreSQL

**Spec:** `docs/plans/2026-04-03-web-parity-phase4a-design.md`

---

## File Map

### hadron-core (create)
- `hadron-web/crates/hadron-core/src/ai/release_notes.rs` — Types, enrichment prompt/parser, generation prompt, insights computation, tests
- `hadron-web/crates/hadron-core/style_guides/whatson_release_notes.md` — Embedded default style guide (copied from desktop)

### hadron-core (modify)
- `hadron-web/crates/hadron-core/src/ai/mod.rs` — Add `pub mod release_notes` + re-export

### hadron-server (create)
- `hadron-web/migrations/016_release_notes_ai.sql` — Add AI generation columns to release_notes table
- `hadron-web/crates/hadron-server/src/routes/release_notes_gen.rs` — Pipeline routes (generate/stream, preview-tickets)

### hadron-server (modify)
- `hadron-web/crates/hadron-server/src/integrations/jira.rs` — Add `list_fix_versions()`
- `hadron-web/crates/hadron-server/src/routes/admin.rs` — Add style guide get/put/delete handlers
- `hadron-web/crates/hadron-server/src/routes/mod.rs` — Register new routes
- `hadron-web/crates/hadron-server/src/db/mod.rs` — Add `get_jira_config_from_poller()`, `insert_ai_release_note()`, `get_ai_release_note()`

### Frontend (create)
- `hadron-web/frontend/src/hooks/useProgressStream.ts` — SSE hook for multi-phase progress events
- `hadron-web/frontend/src/components/release-notes/ReleaseNotesGenerator.tsx` — Config form + progress
- `hadron-web/frontend/src/components/release-notes/ReleaseNotesInsights.tsx` — Quality gauge + module breakdown
- `hadron-web/frontend/src/components/release-notes/ReleaseNotesStyleGuide.tsx` — Style guide viewer
- `hadron-web/frontend/src/components/release-notes/releaseNotesHelpers.ts` — Formatting utilities
- `hadron-web/frontend/src/components/admin/StyleGuidePanel.tsx` — Admin style guide editor

### Frontend (modify)
- `hadron-web/frontend/src/services/api.ts` — Add types + API methods
- `hadron-web/frontend/src/components/release-notes/ReleaseNotesView.tsx` — Refactor to 4 tabs
- `hadron-web/frontend/src/components/release-notes/ReleaseNoteEditor.tsx` — Add preview/diff/insights
- `hadron-web/frontend/src/components/admin/AdminPanel.tsx` — Add "Style Guide" tab

---

## Task 1: Copy Style Guide & Migration 016

**Files:**
- Create: `hadron-web/crates/hadron-core/style_guides/whatson_release_notes.md`
- Create: `hadron-web/migrations/016_release_notes_ai.sql`

- [ ] **Step 1: Copy style guide from desktop**

```bash
cp hadron-desktop/src-tauri/src/style_guides/whatson_release_notes.md hadron-web/crates/hadron-core/style_guides/whatson_release_notes.md
```

Verify it exists and has ~457 lines:
```bash
wc -l hadron-web/crates/hadron-core/style_guides/whatson_release_notes.md
```

- [ ] **Step 2: Create migration 016**

```sql
-- 016: Add AI generation columns to release_notes table

ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS fix_version TEXT;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'both';
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS markdown_content TEXT;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS original_ai_content TEXT;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS ticket_keys JSONB DEFAULT '[]';
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS ticket_count INTEGER DEFAULT 0;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS jql_filter TEXT;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS module_filter JSONB;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS ai_provider TEXT;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS tokens_used BIGINT DEFAULT 0;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS cost DOUBLE PRECISION DEFAULT 0.0;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS generation_duration_ms BIGINT;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS ai_insights JSONB;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_release_notes_fix_version ON release_notes(fix_version) WHERE fix_version IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_release_notes_status ON release_notes(status) WHERE status IS NOT NULL;
```

- [ ] **Step 3: Commit**

```bash
git add hadron-web/crates/hadron-core/style_guides/whatson_release_notes.md hadron-web/migrations/016_release_notes_ai.sql
git commit -m "feat: copy style guide and add migration 016 for release notes AI columns"
```

---

## Task 2: hadron-core — Release Notes Types & Insights

**Files:**
- Create: `hadron-web/crates/hadron-core/src/ai/release_notes.rs`
- Modify: `hadron-web/crates/hadron-core/src/ai/mod.rs`

- [ ] **Step 1: Create release_notes.rs with types**

```rust
// hadron-web/crates/hadron-core/src/ai/release_notes.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Embedded Style Guide ─────────────────────────────────────────────────

/// Default WHATS'ON style guide, embedded at compile time.
pub const DEFAULT_STYLE_GUIDE: &str = include_str!("../../style_guides/whatson_release_notes.md");

// ── Config Types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotesConfig {
    pub fix_version: String,
    #[serde(default)]
    pub content_type: ContentType,
    pub project_key: Option<String>,
    pub jql_filter: Option<String>,
    pub module_filter: Option<Vec<String>>,
    #[serde(default)]
    pub enrichment: AiEnrichmentConfig,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ContentType {
    Features,
    Fixes,
    #[default]
    Both,
}

impl std::fmt::Display for ContentType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Features => write!(f, "features"),
            Self::Fixes => write!(f, "fixes"),
            Self::Both => write!(f, "both"),
        }
    }
}

fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEnrichmentConfig {
    #[serde(default = "default_true")]
    pub rewrite_descriptions: bool,
    #[serde(default = "default_true")]
    pub generate_keywords: bool,
    #[serde(default = "default_true")]
    pub classify_modules: bool,
    #[serde(default = "default_true")]
    pub detect_breaking_changes: bool,
}

impl Default for AiEnrichmentConfig {
    fn default() -> Self {
        Self {
            rewrite_descriptions: true,
            generate_keywords: true,
            classify_modules: true,
            detect_breaking_changes: true,
        }
    }
}

// ── Ticket Types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNoteTicket {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub issue_type: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub components: Vec<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub module_label: Option<String>,
    #[serde(default)]
    pub keywords: Option<Vec<String>>,
    #[serde(default)]
    pub rewritten_description: Option<String>,
    #[serde(default)]
    pub is_breaking_change: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnrichedTicket {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub module_label: Option<String>,
    #[serde(default)]
    pub keywords: Option<Vec<String>>,
    #[serde(default)]
    pub rewritten_description: Option<String>,
    #[serde(default)]
    pub is_breaking_change: Option<bool>,
}

// ── Insights Types ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiInsights {
    #[serde(default)]
    pub quality_score: f64,
    #[serde(default)]
    pub suggestions: Vec<String>,
    #[serde(default)]
    pub module_breakdown: HashMap<String, i32>,
    #[serde(default)]
    pub ticket_coverage: f64,
    #[serde(default)]
    pub breaking_changes: Vec<String>,
}
```

- [ ] **Step 2: Add insights computation**

Append to `release_notes.rs`:

```rust
// ── Insights Computation ─────────────────────────────────────────────────

/// Compute insights from enriched tickets. Pure function — no AI call.
pub fn compute_insights(tickets: &[ReleaseNoteTicket]) -> AiInsights {
    if tickets.is_empty() {
        return AiInsights {
            quality_score: 0.0,
            suggestions: vec!["No tickets to analyze.".to_string()],
            ..Default::default()
        };
    }

    // Module breakdown
    let mut module_breakdown: HashMap<String, i32> = HashMap::new();
    let mut classified_count = 0;
    for ticket in tickets {
        if let Some(ref label) = ticket.module_label {
            if !label.is_empty() {
                *module_breakdown.entry(label.clone()).or_insert(0) += 1;
                classified_count += 1;
            }
        }
    }

    let ticket_coverage = classified_count as f64 / tickets.len() as f64;

    // Breaking changes
    let breaking_changes: Vec<String> = tickets
        .iter()
        .filter(|t| t.is_breaking_change == Some(true))
        .map(|t| format!("{}: {}", t.key, t.summary))
        .collect();

    // Quality score
    let coverage_score = ticket_coverage * 80.0;
    let breaking_score = if breaking_changes.is_empty() { 20.0 } else { 10.0 };
    let quality_score = (coverage_score + breaking_score).min(100.0);

    // Suggestions
    let mut suggestions = Vec::new();
    let unclassified = tickets.len() - classified_count;
    if unclassified > 0 {
        suggestions.push(format!("{} ticket(s) lack module classification.", unclassified));
    }
    if !breaking_changes.is_empty() {
        suggestions.push(format!("{} breaking change(s) detected — review before publishing.", breaking_changes.len()));
    }
    if ticket_coverage < 0.8 {
        suggestions.push("Module classification coverage is below 80%. Consider re-running enrichment.".to_string());
    }

    AiInsights {
        quality_score,
        suggestions,
        module_breakdown,
        ticket_coverage,
        breaking_changes,
    }
}
```

- [ ] **Step 3: Register module**

In `hadron-web/crates/hadron-core/src/ai/mod.rs`, add after `pub mod sentry_analysis;`:

```rust
pub mod release_notes;
```

And add re-export:

```rust
pub use release_notes::*;
```

- [ ] **Step 4: Add tests**

Append to `release_notes.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn make_ticket(key: &str, summary: &str, module: Option<&str>, breaking: Option<bool>) -> ReleaseNoteTicket {
        ReleaseNoteTicket {
            key: key.to_string(),
            summary: summary.to_string(),
            module_label: module.map(String::from),
            is_breaking_change: breaking,
            ..Default::default()
        }
    }

    #[test]
    fn test_compute_insights_full_coverage() {
        let tickets = vec![
            make_ticket("PROJ-1", "Add login", Some("auth_module"), None),
            make_ticket("PROJ-2", "Fix crash", Some("core_module"), Some(true)),
            make_ticket("PROJ-3", "Update UI", Some("ui_module"), None),
        ];
        let insights = compute_insights(&tickets);
        assert_eq!(insights.ticket_coverage, 1.0);
        assert_eq!(insights.module_breakdown.len(), 3);
        assert_eq!(insights.breaking_changes.len(), 1);
        assert!(insights.breaking_changes[0].contains("PROJ-2"));
        // coverage=80 + breaking_present=10 = 90
        assert!((insights.quality_score - 90.0).abs() < 0.1);
    }

    #[test]
    fn test_compute_insights_partial_coverage() {
        let tickets = vec![
            make_ticket("PROJ-1", "Add login", Some("auth_module"), None),
            make_ticket("PROJ-2", "Fix crash", None, None),
        ];
        let insights = compute_insights(&tickets);
        assert_eq!(insights.ticket_coverage, 0.5);
        assert!(insights.suggestions.iter().any(|s| s.contains("1 ticket(s) lack")));
        assert!(insights.suggestions.iter().any(|s| s.contains("below 80%")));
    }

    #[test]
    fn test_compute_insights_empty() {
        let insights = compute_insights(&[]);
        assert_eq!(insights.quality_score, 0.0);
        assert!(insights.suggestions[0].contains("No tickets"));
    }

    #[test]
    fn test_content_type_serialization() {
        let json = serde_json::to_string(&ContentType::Features).unwrap();
        assert_eq!(json, "\"features\"");
        let parsed: ContentType = serde_json::from_str("\"both\"").unwrap();
        assert_eq!(parsed, ContentType::Both);
    }

    #[test]
    fn test_default_enrichment_config() {
        let config = AiEnrichmentConfig::default();
        assert!(config.rewrite_descriptions);
        assert!(config.generate_keywords);
        assert!(config.classify_modules);
        assert!(config.detect_breaking_changes);
    }

    #[test]
    fn test_default_style_guide_not_empty() {
        assert!(!DEFAULT_STYLE_GUIDE.is_empty());
        assert!(DEFAULT_STYLE_GUIDE.len() > 1000);
    }
}
```

- [ ] **Step 5: Verify compilation and tests**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- release_notes`

Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add hadron-web/crates/hadron-core/src/ai/release_notes.rs hadron-web/crates/hadron-core/src/ai/mod.rs
git commit -m "feat(core): add release_notes types, insights computation, and default style guide"
```

---

## Task 3: hadron-core — Enrichment & Generation Prompts

**Files:**
- Modify: `hadron-web/crates/hadron-core/src/ai/release_notes.rs`

- [ ] **Step 1: Add enrichment system prompt and builder**

Insert before `compute_insights` in `release_notes.rs`:

```rust
// ── Enrichment Prompt ────────────────────────────────────────────────────

pub const ENRICHMENT_SYSTEM_PROMPT: &str = r#"You are a release notes enrichment engine. Given a batch of JIRA tickets, enrich each one by:

1. **Module Label**: Classify into one of the official module labels from the style guide. Use the exact label key (e.g., "contract_module", "linear_scheduling_module"). If uncertain, use "general".

2. **Keywords**: Generate 2-4 plural concept names (e.g., "contracts", "scheduling", "transmissions"). Follow the keyword rules in the style guide.

3. **Rewritten Description**: Rewrite the ticket description following the style guide:
   - For bugs/fixes: Start with "Previously, ..." and end with "This issue has been fixed."
   - For features/stories: Start with "It is now possible to...", "Users can now...", or "From now on..."
   - Use proper WHATS'ON terminology from the style guide.

4. **Breaking Change**: Set to true if the change affects pre-upgrade behavior or requires user action after upgrade.

Return ONLY valid JSON — an array of objects, one per ticket:
[
  {
    "key": "TICKET-123",
    "moduleLabel": "module_key",
    "keywords": ["keyword1", "keyword2"],
    "rewrittenDescription": "Previously, ... This issue has been fixed.",
    "isBreakingChange": false
  }
]"#;

fn truncate_chars(s: &str, max_chars: usize) -> &str {
    match s.char_indices().nth(max_chars) {
        Some((byte_pos, _)) => &s[..byte_pos],
        None => s,
    }
}

/// Build enrichment prompt for a batch of tickets.
pub fn build_enrichment_messages(
    tickets: &[ReleaseNoteTicket],
    style_guide: &str,
) -> (String, Vec<super::types::AiMessage>) {
    let system = format!(
        "{}\n\n=== STYLE GUIDE (relevant sections) ===\n{}",
        ENRICHMENT_SYSTEM_PROMPT, style_guide
    );

    let ticket_data: Vec<serde_json::Value> = tickets.iter().map(|t| {
        let desc = t.description.as_deref().unwrap_or("");
        let truncated = truncate_chars(desc, 2000);
        serde_json::json!({
            "key": t.key,
            "summary": t.summary,
            "description": truncated,
            "issueType": t.issue_type,
            "priority": t.priority,
            "components": t.components,
            "labels": t.labels,
        })
    }).collect();

    let user_content = format!(
        "Enrich the following {} ticket(s):\n\n{}",
        tickets.len(),
        serde_json::to_string_pretty(&ticket_data).unwrap_or_default()
    );

    let messages = vec![super::types::AiMessage {
        role: "user".to_string(),
        content: user_content,
    }];
    (system, messages)
}

/// Parse enrichment response JSON array.
pub fn parse_enrichment_response(raw: &str) -> crate::error::HadronResult<Vec<EnrichedTicket>> {
    let json_str = super::parsers::strip_markdown_fences(raw);
    serde_json::from_str(json_str).map_err(|e| {
        let preview = &json_str[..json_str.len().min(300)];
        crate::error::HadronError::Parse(format!(
            "Failed to parse enrichment response: {e}. Preview: {preview}"
        ))
    })
}
```

- [ ] **Step 2: Add generation system prompt and builder**

```rust
// ── Generation Prompt ────────────────────────────────────────────────────

pub const GENERATION_SYSTEM_PROMPT: &str = r#"You are a release notes writer. Generate formatted Markdown release notes following the style guide provided.

Structure depends on content type:
- **features**: Write each feature with Introduction, Detail, and Conclusion sections. Vary opening phrases ("It is now possible to...", "Users can now...", "From now on...").
- **fixes**: Create a Markdown table with columns: | Issue Key | Description | Module | Keywords |
- **both**: Two sections — "## New Features" followed by "## Fixed Issues" (table format for fixes).

Rules:
- Follow the style guide strictly for terminology, formatting, and structure.
- Use bold for on-screen text references.
- Include ticket keys in brackets [TICKET-123] for traceability.
- Group related tickets when possible.
- Use British English spelling.

Return ONLY the Markdown content — no JSON wrapping, no code fences."#;

/// Build generation prompt from enriched tickets.
pub fn build_generation_messages(
    tickets: &[ReleaseNoteTicket],
    content_type: &ContentType,
    style_guide: &str,
) -> (String, Vec<super::types::AiMessage>) {
    let system = format!(
        "{}\n\nContent type: {}\n\n=== FULL STYLE GUIDE ===\n{}",
        GENERATION_SYSTEM_PROMPT, content_type, style_guide
    );

    let mut user_parts = vec![format!(
        "Generate {} release notes for the following {} ticket(s):\n",
        content_type, tickets.len()
    )];

    for ticket in tickets {
        let desc = ticket.rewritten_description.as_deref()
            .or(ticket.description.as_deref())
            .unwrap_or("(no description)");
        let keywords = ticket.keywords.as_ref()
            .map(|kw| kw.join(", "))
            .unwrap_or_default();
        let module = ticket.module_label.as_deref().unwrap_or("unclassified");
        let breaking = if ticket.is_breaking_change == Some(true) { " [BREAKING]" } else { "" };

        user_parts.push(format!(
            "---\nKey: {}\nType: {}\nPriority: {}\nSummary: {}\nModule: {}\nKeywords: {}\nDescription: {}{}\n",
            ticket.key, ticket.issue_type, ticket.priority, ticket.summary,
            module, keywords, desc, breaking
        ));
    }

    let messages = vec![super::types::AiMessage {
        role: "user".to_string(),
        content: user_parts.join("\n"),
    }];
    (system, messages)
}
```

- [ ] **Step 3: Add prompt and parser tests**

Add to the `tests` module:

```rust
    #[test]
    fn test_build_enrichment_prompt() {
        let tickets = vec![ReleaseNoteTicket {
            key: "PROJ-100".to_string(),
            summary: "Fix login timeout".to_string(),
            description: Some("Login times out after 30 seconds".to_string()),
            issue_type: "Bug".to_string(),
            ..Default::default()
        }];
        let (system, messages) = build_enrichment_messages(&tickets, "Test style guide");
        assert!(system.contains("enrichment engine"));
        assert!(system.contains("Test style guide"));
        assert_eq!(messages.len(), 1);
        assert!(messages[0].content.contains("PROJ-100"));
        assert!(messages[0].content.contains("Fix login timeout"));
    }

    #[test]
    fn test_parse_enrichment_response() {
        let json = r#"[
            {
                "key": "PROJ-100",
                "moduleLabel": "auth_module",
                "keywords": ["authentication", "login"],
                "rewrittenDescription": "Previously, login timed out. This issue has been fixed.",
                "isBreakingChange": false
            }
        ]"#;
        let result = parse_enrichment_response(json).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].key, "PROJ-100");
        assert_eq!(result[0].module_label.as_deref(), Some("auth_module"));
        assert_eq!(result[0].keywords.as_ref().unwrap().len(), 2);
        assert_eq!(result[0].is_breaking_change, Some(false));
    }

    #[test]
    fn test_parse_enrichment_defaults() {
        let json = r#"[{"key": "PROJ-1"}]"#;
        let result = parse_enrichment_response(json).unwrap();
        assert_eq!(result[0].key, "PROJ-1");
        assert!(result[0].module_label.is_none());
        assert!(result[0].keywords.is_none());
    }

    #[test]
    fn test_build_generation_prompt_features() {
        let tickets = vec![make_ticket("PROJ-1", "New dashboard", Some("ui_module"), None)];
        let (system, messages) = build_generation_messages(&tickets, &ContentType::Features, "guide");
        assert!(system.contains("Content type: features"));
        assert!(messages[0].content.contains("PROJ-1"));
    }

    #[test]
    fn test_build_generation_prompt_fixes() {
        let tickets = vec![make_ticket("PROJ-2", "Fix crash", Some("core_module"), Some(true))];
        let (system, messages) = build_generation_messages(&tickets, &ContentType::Fixes, "guide");
        assert!(system.contains("Content type: fixes"));
        assert!(messages[0].content.contains("[BREAKING]"));
    }

    #[test]
    fn test_build_generation_prompt_both() {
        let tickets = vec![
            make_ticket("PROJ-1", "New feature", Some("ui_module"), None),
            make_ticket("PROJ-2", "Bug fix", Some("core_module"), None),
        ];
        let (system, messages) = build_generation_messages(&tickets, &ContentType::Both, "guide");
        assert!(system.contains("Content type: both"));
        assert!(messages[0].content.contains("2 ticket(s)"));
    }

    #[test]
    fn test_parse_enrichment_with_fences() {
        let raw = "```json\n[{\"key\": \"X-1\", \"moduleLabel\": \"test\"}]\n```";
        let result = parse_enrichment_response(raw).unwrap();
        assert_eq!(result[0].module_label.as_deref(), Some("test"));
    }
```

- [ ] **Step 4: Verify compilation and tests**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- release_notes`

Expected: All 13 tests pass (6 from Task 2 + 7 from Task 3).

- [ ] **Step 5: Commit**

```bash
git add hadron-web/crates/hadron-core/src/ai/release_notes.rs
git commit -m "feat(core): add release notes enrichment and generation prompts with tests"
```

---

## Task 4: hadron-server — JIRA Fix Versions & DB Helpers

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/integrations/jira.rs`
- Modify: `hadron-web/crates/hadron-server/src/db/mod.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/integrations.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Add `list_fix_versions` to jira integration**

In `hadron-web/crates/hadron-server/src/integrations/jira.rs`, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraFixVersion {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub released: bool,
    pub release_date: Option<String>,
}

pub async fn list_fix_versions(
    config: &JiraConfig,
    project_key: &str,
) -> HadronResult<Vec<JiraFixVersion>> {
    let client = build_client()?;
    let url = format!(
        "{}/rest/api/3/project/{}/versions",
        config.base_url.trim_end_matches('/'),
        project_key
    );
    let resp = client
        .get(&url)
        .basic_auth(&config.email, Some(&config.api_token))
        .send()
        .await
        .map_err(|e| HadronError::external_service(format!("JIRA fix versions request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(HadronError::external_service(format!(
            "JIRA returned {status} for fix versions: {body}"
        )));
    }

    let versions: Vec<JiraFixVersion> = resp.json().await
        .map_err(|e| HadronError::external_service(format!("Failed to parse fix versions: {e}")))?;
    Ok(versions)
}
```

- [ ] **Step 2: Add fix versions route handler**

In `hadron-web/crates/hadron-server/src/routes/integrations.rs`, add:

```rust
pub async fn jira_fix_versions(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(project): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let poller_config = crate::db::get_poller_config(&state.db)
        .await
        .map_err(|e| AppError(e))?;
    let api_token = crate::crypto::decrypt_value(&poller_config.jira_api_token)
        .map_err(|e| AppError(e))?;
    let config = crate::integrations::jira::JiraConfig {
        base_url: poller_config.jira_base_url,
        email: poller_config.jira_email,
        api_token,
        project_key: project.clone(),
    };
    let versions = crate::integrations::jira::list_fix_versions(&config, &project)
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(versions))
}
```

- [ ] **Step 3: Add DB helper for building JiraConfig from poller config**

In `hadron-web/crates/hadron-server/src/db/mod.rs`, add:

```rust
/// Build a JiraConfig from the poller configuration table.
pub async fn get_jira_config_from_poller(pool: &PgPool) -> HadronResult<crate::integrations::jira::JiraConfig> {
    let poller = get_poller_config(pool).await?;
    if poller.jira_base_url.is_empty() || poller.jira_email.is_empty() || poller.jira_api_token.is_empty() {
        return Err(HadronError::validation("JIRA is not configured. Set up JIRA in the admin panel."));
    }
    let api_token = crate::crypto::decrypt_value(&poller.jira_api_token)?;
    Ok(crate::integrations::jira::JiraConfig {
        base_url: poller.jira_base_url,
        email: poller.jira_email,
        api_token,
        project_key: String::new(),
    })
}
```

- [ ] **Step 4: Add DB helper for inserting AI-generated release note**

```rust
/// Insert an AI-generated release note with all enriched fields.
pub async fn insert_ai_release_note(
    pool: &PgPool,
    user_id: Uuid,
    title: &str,
    fix_version: &str,
    content_type: &str,
    markdown_content: &str,
    ticket_keys: &serde_json::Value,
    ticket_count: i32,
    jql_filter: Option<&str>,
    module_filter: Option<&serde_json::Value>,
    ai_model: Option<&str>,
    ai_provider: Option<&str>,
    tokens_used: i64,
    cost: f64,
    generation_duration_ms: i64,
    ai_insights: Option<&serde_json::Value>,
) -> HadronResult<i64> {
    let row: (i64,) = sqlx::query_as(
        "INSERT INTO release_notes (
            user_id, title, fix_version, content_type, content, markdown_content,
            original_ai_content, ticket_keys, ticket_count, jql_filter, module_filter,
            ai_model, ai_provider, tokens_used, cost, generation_duration_ms, ai_insights,
            format, status
         ) VALUES ($1, $2, $3, $4, $5, $5, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'markdown', 'draft')
         RETURNING id",
    )
    .bind(user_id)
    .bind(title)
    .bind(fix_version)
    .bind(content_type)
    .bind(markdown_content)  // binds to both content, markdown_content, and original_ai_content ($5)
    .bind(ticket_keys)
    .bind(ticket_count)
    .bind(jql_filter)
    .bind(module_filter)
    .bind(ai_model)
    .bind(ai_provider)
    .bind(tokens_used)
    .bind(cost)
    .bind(generation_duration_ms)
    .bind(ai_insights)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.0)
}
```

- [ ] **Step 5: Register fix versions route**

In `routes/mod.rs`, add with the JIRA routes:

```rust
.route("/jira/fix-versions/{project}", get(integrations::jira_fix_versions))
```

- [ ] **Step 6: Verify compilation**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check`

- [ ] **Step 7: Commit**

```bash
git add hadron-web/crates/hadron-server/src/integrations/jira.rs hadron-web/crates/hadron-server/src/db/mod.rs hadron-web/crates/hadron-server/src/routes/integrations.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(server): add JIRA fix versions route and release notes DB helpers"
```

---

## Task 5: hadron-server — Admin Style Guide Routes

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/routes/admin.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Add style guide handlers to admin.rs**

```rust
// ── Style Guide ──────────────────────────────────────────────────────────

pub async fn get_style_guide(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let custom = db::get_global_setting(&state.db, "release_notes_style_guide")
        .await?
        .filter(|s| !s.is_empty());

    let guide = custom.unwrap_or_else(|| hadron_core::ai::DEFAULT_STYLE_GUIDE.to_string());
    let is_custom = db::get_global_setting(&state.db, "release_notes_style_guide")
        .await?
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    Ok(Json(serde_json::json!({
        "content": guide,
        "isCustom": is_custom,
    })))
}

pub async fn update_style_guide(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<UpdateStyleGuideRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;
    db::set_global_setting(&state.db, "release_notes_style_guide", &req.content, user.user.id).await?;

    let _ = db::write_audit_log(
        &state.db, user.user.id, "admin.style_guide_updated",
        "global_settings", None,
        &serde_json::json!({"length": req.content.len()}), None,
    ).await;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_style_guide(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;
    db::set_global_setting(&state.db, "release_notes_style_guide", "", user.user.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct UpdateStyleGuideRequest {
    pub content: String,
}
```

- [ ] **Step 2: Register routes**

In `routes/mod.rs`:

```rust
.route("/admin/style-guide", get(admin::get_style_guide))
.route("/admin/style-guide", put(admin::update_style_guide))
.route("/admin/style-guide", delete(admin::delete_style_guide))
```

- [ ] **Step 3: Verify and commit**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check
git add hadron-web/crates/hadron-server/src/routes/admin.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(server): add admin style guide routes"
```

---

## Task 6: hadron-server — Generate Pipeline Route

**Files:**
- Create: `hadron-web/crates/hadron-server/src/routes/release_notes_gen.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

This is the most complex server task — the multi-phase SSE pipeline.

- [ ] **Step 1: Create release_notes_gen.rs**

```rust
use axum::{
    extract::{State},
    response::{sse::{Event, KeepAlive, Sse}, IntoResponse},
    Json,
};
use futures::stream::Stream;
use futures::StreamExt;
use hadron_core::ai::{
    self as ai_core, ReleaseNotesConfig, ReleaseNoteTicket, ContentType,
};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::middleware::AuthenticatedUser;
use crate::routes::AppError;
use crate::AppState;
use crate::{ai, db};

const ENRICHMENT_BATCH_SIZE: usize = 10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub phase: String,
    pub progress: f64,
    pub message: String,
    pub ticket_count: Option<i32>,
    pub release_note_id: Option<i64>,
}

/// Resolve the style guide: custom from global_settings, or embedded default.
async fn resolve_style_guide(pool: &sqlx::PgPool) -> String {
    db::get_global_setting(pool, "release_notes_style_guide")
        .await
        .ok()
        .flatten()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| ai_core::DEFAULT_STYLE_GUIDE.to_string())
}

/// SSE stream helper for progress events.
fn progress_stream(
    rx: mpsc::Receiver<ProgressEvent>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = ReceiverStream::new(rx).map(|event| {
        let data = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
        Ok(Event::default().data(data))
    });
    Sse::new(stream).keep_alive(
        KeepAlive::new().interval(Duration::from_secs(15)).text("ping"),
    )
}

/// POST /api/release-notes/preview-tickets — dry-run ticket fetch.
pub async fn preview_tickets(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(config): Json<ReleaseNotesConfig>,
) -> Result<impl IntoResponse, AppError> {
    let jira_config = db::get_jira_config_from_poller(&state.db).await?;
    let jql = build_jql(&config, &jira_config.project_key);
    let results = crate::integrations::jira::search_issues(
        &jira_config, Some(&jql), None, 200,
    ).await.map_err(|e| AppError(e))?;

    let tickets: Vec<ReleaseNoteTicket> = results.issues.iter().map(|issue| {
        ReleaseNoteTicket {
            key: issue.key.clone(),
            summary: issue.summary.clone(),
            description: issue.description.clone(),
            issue_type: issue.issue_type.clone(),
            priority: issue.priority.clone().unwrap_or_default(),
            status: issue.status.clone(),
            components: issue.components.clone(),
            labels: issue.labels.clone(),
            ..Default::default()
        }
    }).collect();

    Ok(Json(tickets))
}

fn build_jql(config: &ReleaseNotesConfig, default_project: &str) -> String {
    if let Some(ref custom_jql) = config.jql_filter {
        if !custom_jql.is_empty() {
            return custom_jql.clone();
        }
    }
    let project = config.project_key.as_deref().unwrap_or(default_project);
    format!("project = \"{}\" AND fixVersion = \"{}\"", project, config.fix_version)
}

/// POST /api/release-notes/generate/stream — full pipeline with SSE progress.
pub async fn generate_stream(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(config): Json<ReleaseNotesConfig>,
) -> Result<impl IntoResponse, AppError> {
    let jira_config = db::get_jira_config_from_poller(&state.db).await?;
    let ai_config = crate::routes::analyses::resolve_ai_config(
        &state.db, None, None, None,
    ).await?;

    let (tx, rx) = mpsc::channel::<ProgressEvent>(50);
    let db_pool = state.db.clone();
    let user_id = user.user.id;

    tokio::spawn(async move {
        let start = Instant::now();
        let mut total_tokens: i64 = 0;
        let mut total_cost: f64 = 0.0;

        // Phase 1: Fetch tickets
        let _ = tx.send(ProgressEvent {
            phase: "fetching_tickets".to_string(),
            progress: 5.0,
            message: "Fetching tickets from JIRA...".to_string(),
            ticket_count: None,
            release_note_id: None,
        }).await;

        let jql = build_jql(&config, &jira_config.project_key);
        let search_result = match crate::integrations::jira::search_issues(
            &jira_config, Some(&jql), None, 500,
        ).await {
            Ok(r) => r,
            Err(e) => {
                let _ = tx.send(ProgressEvent {
                    phase: "failed".to_string(),
                    progress: 0.0,
                    message: format!("Failed to fetch tickets: {}", e.client_message()),
                    ticket_count: None,
                    release_note_id: None,
                }).await;
                return;
            }
        };

        let mut tickets: Vec<ReleaseNoteTicket> = search_result.issues.iter().map(|issue| {
            ReleaseNoteTicket {
                key: issue.key.clone(),
                summary: issue.summary.clone(),
                description: issue.description.clone(),
                issue_type: issue.issue_type.clone(),
                priority: issue.priority.clone().unwrap_or_default(),
                status: issue.status.clone(),
                components: issue.components.clone(),
                labels: issue.labels.clone(),
                ..Default::default()
            }
        }).collect();

        let ticket_count = tickets.len() as i32;
        let _ = tx.send(ProgressEvent {
            phase: "fetching_tickets".to_string(),
            progress: 15.0,
            message: format!("Found {} tickets.", ticket_count),
            ticket_count: Some(ticket_count),
            release_note_id: None,
        }).await;

        if tickets.is_empty() {
            let _ = tx.send(ProgressEvent {
                phase: "failed".to_string(),
                progress: 0.0,
                message: "No tickets found for this fix version.".to_string(),
                ticket_count: Some(0),
                release_note_id: None,
            }).await;
            return;
        }

        // Phase 2: Enrich (batch processing)
        let style_guide = resolve_style_guide(&db_pool).await;
        let any_enrichment = config.enrichment.rewrite_descriptions
            || config.enrichment.generate_keywords
            || config.enrichment.classify_modules
            || config.enrichment.detect_breaking_changes;

        if any_enrichment {
            let batches: Vec<Vec<ReleaseNoteTicket>> = tickets.chunks(ENRICHMENT_BATCH_SIZE)
                .map(|chunk| chunk.to_vec())
                .collect();
            let total_batches = batches.len();

            for (i, batch) in batches.iter().enumerate() {
                let progress = 15.0 + (45.0 * (i as f64 / total_batches as f64));
                let _ = tx.send(ProgressEvent {
                    phase: "enriching".to_string(),
                    progress,
                    message: format!("Enriching batch {}/{} ({} tickets)...", i + 1, total_batches, batch.len()),
                    ticket_count: Some(ticket_count),
                    release_note_id: None,
                }).await;

                let (system, messages) = ai_core::build_enrichment_messages(batch, &style_guide);
                match ai::complete(&ai_config, messages, Some(&system)).await {
                    Ok(raw) => {
                        if let Ok(enriched) = ai_core::parse_enrichment_response(&raw) {
                            // Apply enrichments to tickets
                            for e in &enriched {
                                if let Some(ticket) = tickets.iter_mut().find(|t| t.key == e.key) {
                                    if config.enrichment.classify_modules {
                                        ticket.module_label = e.module_label.clone();
                                    }
                                    if config.enrichment.generate_keywords {
                                        ticket.keywords = e.keywords.clone();
                                    }
                                    if config.enrichment.rewrite_descriptions {
                                        ticket.rewritten_description = e.rewritten_description.clone();
                                    }
                                    if config.enrichment.detect_breaking_changes {
                                        ticket.is_breaking_change = e.is_breaking_change;
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Enrichment batch {} failed: {}", i + 1, e);
                    }
                }
            }
        }

        // Phase 3: Generate markdown
        let _ = tx.send(ProgressEvent {
            phase: "generating".to_string(),
            progress: 65.0,
            message: "Generating release notes...".to_string(),
            ticket_count: Some(ticket_count),
            release_note_id: None,
        }).await;

        let (system, messages) = ai_core::build_generation_messages(
            &tickets, &config.content_type, &style_guide,
        );
        let markdown = match ai::complete(&ai_config, messages, Some(&system)).await {
            Ok(text) => text,
            Err(e) => {
                let _ = tx.send(ProgressEvent {
                    phase: "failed".to_string(),
                    progress: 0.0,
                    message: format!("Generation failed: {}", e.client_message()),
                    ticket_count: Some(ticket_count),
                    release_note_id: None,
                }).await;
                return;
            }
        };

        // Phase 4: Compute insights
        let _ = tx.send(ProgressEvent {
            phase: "computing_insights".to_string(),
            progress: 88.0,
            message: "Computing insights...".to_string(),
            ticket_count: Some(ticket_count),
            release_note_id: None,
        }).await;

        let insights = ai_core::compute_insights(&tickets);
        let insights_json = serde_json::to_value(&insights).ok();

        // Phase 5: Save
        let _ = tx.send(ProgressEvent {
            phase: "saving".to_string(),
            progress: 93.0,
            message: "Saving release notes...".to_string(),
            ticket_count: Some(ticket_count),
            release_note_id: None,
        }).await;

        let title = format!("Release Notes — {} ({})", config.fix_version, config.content_type);
        let ticket_keys_json = serde_json::to_value(
            tickets.iter().map(|t| &t.key).collect::<Vec<_>>()
        ).unwrap_or_default();
        let module_filter_json = config.module_filter.as_ref()
            .map(|mf| serde_json::to_value(mf).unwrap_or_default());
        let duration_ms = start.elapsed().as_millis() as i64;

        let note_id = match db::insert_ai_release_note(
            &db_pool, user_id, &title, &config.fix_version,
            &config.content_type.to_string(), &markdown,
            &ticket_keys_json, ticket_count,
            config.jql_filter.as_deref(),
            module_filter_json.as_ref(),
            None, None, // ai_model, ai_provider — set by resolve_ai_config
            total_tokens, total_cost, duration_ms,
            insights_json.as_ref(),
        ).await {
            Ok(id) => id,
            Err(e) => {
                let _ = tx.send(ProgressEvent {
                    phase: "failed".to_string(),
                    progress: 0.0,
                    message: format!("Failed to save: {}", e.client_message()),
                    ticket_count: Some(ticket_count),
                    release_note_id: None,
                }).await;
                return;
            }
        };

        // Phase 6: Complete
        let _ = tx.send(ProgressEvent {
            phase: "complete".to_string(),
            progress: 100.0,
            message: format!("Release notes generated with {} tickets.", ticket_count),
            ticket_count: Some(ticket_count),
            release_note_id: Some(note_id),
        }).await;
    });

    Ok(progress_stream(rx))
}

/// POST /api/release-notes/generate — non-streaming fallback.
pub async fn generate(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(config): Json<ReleaseNotesConfig>,
) -> Result<impl IntoResponse, AppError> {
    // Simplified: reuses the same logic but synchronously
    // For brevity, this calls the pipeline inline and returns the result
    // Implementation follows the same steps as generate_stream but without SSE
    let jira_config = db::get_jira_config_from_poller(&state.db).await?;
    let ai_config = crate::routes::analyses::resolve_ai_config(
        &state.db, None, None, None,
    ).await?;
    let style_guide = resolve_style_guide(&state.db).await;
    let start = Instant::now();

    // Fetch
    let jql = build_jql(&config, &jira_config.project_key);
    let search_result = crate::integrations::jira::search_issues(
        &jira_config, Some(&jql), None, 500,
    ).await.map_err(|e| AppError(e))?;

    let mut tickets: Vec<ReleaseNoteTicket> = search_result.issues.iter().map(|issue| {
        ReleaseNoteTicket {
            key: issue.key.clone(),
            summary: issue.summary.clone(),
            description: issue.description.clone(),
            issue_type: issue.issue_type.clone(),
            priority: issue.priority.clone().unwrap_or_default(),
            status: issue.status.clone(),
            components: issue.components.clone(),
            labels: issue.labels.clone(),
            ..Default::default()
        }
    }).collect();

    if tickets.is_empty() {
        return Err(AppError(hadron_core::error::HadronError::validation(
            "No tickets found for this fix version.",
        )));
    }

    // Enrich
    let any_enrichment = config.enrichment.rewrite_descriptions
        || config.enrichment.generate_keywords
        || config.enrichment.classify_modules
        || config.enrichment.detect_breaking_changes;
    if any_enrichment {
        for batch in tickets.chunks(ENRICHMENT_BATCH_SIZE).map(|c| c.to_vec()).collect::<Vec<_>>() {
            let (system, messages) = ai_core::build_enrichment_messages(&batch, &style_guide);
            if let Ok(raw) = ai::complete(&ai_config, messages, Some(&system)).await {
                if let Ok(enriched) = ai_core::parse_enrichment_response(&raw) {
                    for e in &enriched {
                        if let Some(ticket) = tickets.iter_mut().find(|t| t.key == e.key) {
                            ticket.module_label = e.module_label.clone();
                            ticket.keywords = e.keywords.clone();
                            ticket.rewritten_description = e.rewritten_description.clone();
                            ticket.is_breaking_change = e.is_breaking_change;
                        }
                    }
                }
            }
        }
    }

    // Generate
    let (system, messages) = ai_core::build_generation_messages(&tickets, &config.content_type, &style_guide);
    let markdown = ai::complete(&ai_config, messages, Some(&system)).await?;

    // Insights + Save
    let insights = ai_core::compute_insights(&tickets);
    let insights_json = serde_json::to_value(&insights).ok();
    let title = format!("Release Notes — {} ({})", config.fix_version, config.content_type);
    let ticket_keys_json = serde_json::to_value(tickets.iter().map(|t| &t.key).collect::<Vec<_>>()).unwrap_or_default();
    let module_filter_json = config.module_filter.as_ref().map(|mf| serde_json::to_value(mf).unwrap_or_default());
    let duration_ms = start.elapsed().as_millis() as i64;

    let note_id = db::insert_ai_release_note(
        &state.db, user.user.id, &title, &config.fix_version,
        &config.content_type.to_string(), &markdown,
        &ticket_keys_json, tickets.len() as i32,
        config.jql_filter.as_deref(), module_filter_json.as_ref(),
        None, None, 0, 0.0, duration_ms, insights_json.as_ref(),
    ).await?;

    Ok(Json(serde_json::json!({
        "id": note_id,
        "title": title,
        "markdownContent": markdown,
        "ticketCount": tickets.len(),
        "insights": insights,
    })))
}
```

- [ ] **Step 2: Register routes in mod.rs**

Add `mod release_notes_gen;` and routes:

```rust
// Release notes AI generation
.route("/release-notes/preview-tickets", post(release_notes_gen::preview_tickets))
.route("/release-notes/generate/stream", post(release_notes_gen::generate_stream))
.route("/release-notes/generate", post(release_notes_gen::generate))
```

- [ ] **Step 3: Verify compilation**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check`

This will likely need adjustments based on the exact `JiraSearchResponse` and `JiraSearchIssue` types. Read the existing search_issues return type to match field names.

- [ ] **Step 4: Commit**

```bash
git add hadron-web/crates/hadron-server/src/routes/release_notes_gen.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(server): add release notes AI generation pipeline with SSE streaming"
```

---

## Task 7: Frontend — API Types, Methods & useProgressStream Hook

**Files:**
- Modify: `hadron-web/frontend/src/services/api.ts`
- Create: `hadron-web/frontend/src/hooks/useProgressStream.ts`

- [ ] **Step 1: Add types to api.ts**

```typescript
// ── Release Notes AI Generation Types ─────────────────────────────────

export interface JiraFixVersion {
  id: string;
  name: string;
  released: boolean;
  releaseDate: string | null;
}

export interface ReleaseNotesGenerateRequest {
  fixVersion: string;
  contentType: 'features' | 'fixes' | 'both';
  projectKey?: string;
  jqlFilter?: string;
  moduleFilter?: string[];
  enrichment: {
    rewriteDescriptions: boolean;
    generateKeywords: boolean;
    classifyModules: boolean;
    detectBreakingChanges: boolean;
  };
}

export interface ReleaseNoteTicketPreview {
  key: string;
  summary: string;
  issueType: string;
  priority: string;
  status: string;
  components: string[];
  labels: string[];
}

export interface AiInsights {
  qualityScore: number;
  suggestions: string[];
  moduleBreakdown: Record<string, number>;
  ticketCoverage: number;
  breakingChanges: string[];
}

export interface StyleGuideResponse {
  content: string;
  isCustom: boolean;
}
```

- [ ] **Step 2: Add API methods**

```typescript
  // ── Release Notes AI Generation ─────────────────────────────────
  async getJiraFixVersions(project: string): Promise<JiraFixVersion[]> {
    return this.request<JiraFixVersion[]>(`/jira/fix-versions/${encodeURIComponent(project)}`);
  }

  async previewReleaseNotesTickets(config: ReleaseNotesGenerateRequest): Promise<ReleaseNoteTicketPreview[]> {
    return this.request('/release-notes/preview-tickets', {
      method: 'POST',
      headers: { ...await this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
  }

  async generateReleaseNotes(config: ReleaseNotesGenerateRequest): Promise<{ id: number; title: string; markdownContent: string; ticketCount: number; insights: AiInsights }> {
    return this.request('/release-notes/generate', {
      method: 'POST',
      headers: { ...await this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
  }

  async getStyleGuide(): Promise<StyleGuideResponse> {
    return this.request<StyleGuideResponse>('/admin/style-guide');
  }

  async updateStyleGuide(content: string): Promise<void> {
    await this.request('/admin/style-guide', {
      method: 'PUT',
      headers: { ...await this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  }

  async deleteStyleGuide(): Promise<void> {
    await this.request('/admin/style-guide', { method: 'DELETE', headers: await this.headers() });
  }
```

- [ ] **Step 3: Create useProgressStream.ts**

Model after `useAiStream.ts` but for structured progress events:

```typescript
// hadron-web/frontend/src/hooks/useProgressStream.ts

import { useState, useRef, useCallback } from 'react';
import { acquireToken } from '../auth';

export interface ProgressEvent {
  phase: string;
  progress: number;
  message: string;
  ticketCount?: number;
  releaseNoteId?: number;
}

interface UseProgressStreamReturn {
  startStream: (path: string, body: object) => void;
  progress: number;
  phase: string;
  message: string;
  isStreaming: boolean;
  error: string | null;
  completedData: ProgressEvent | null;
  reset: () => void;
}

export function useProgressStream(): UseProgressStreamReturn {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  const [message, setMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedData, setCompletedData] = useState<ProgressEvent | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setProgress(0);
    setPhase('');
    setMessage('');
    setIsStreaming(false);
    setError(null);
    setCompletedData(null);
  }, []);

  const startStream = useCallback(async (path: string, body: object) => {
    reset();
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = await acquireToken();
      const baseUrl = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';
      const resp = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === 'ping') continue;

          try {
            const event: ProgressEvent = JSON.parse(data);
            setProgress(event.progress);
            setPhase(event.phase);
            setMessage(event.message);

            if (event.phase === 'complete') {
              setCompletedData(event);
            } else if (event.phase === 'failed') {
              setError(event.message);
            }
          } catch {
            // skip unparseable events
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setError(e.message);
      }
    } finally {
      setIsStreaming(false);
    }
  }, [reset]);

  return { startStream, progress, phase, message, isStreaming, error, completedData, reset };
}
```

- [ ] **Step 4: Commit**

```bash
git add hadron-web/frontend/src/services/api.ts hadron-web/frontend/src/hooks/useProgressStream.ts
git commit -m "feat(frontend): add release notes API types and useProgressStream hook"
```

---

## Task 8: Frontend — ReleaseNotesGenerator

**Files:**
- Create: `hadron-web/frontend/src/components/release-notes/ReleaseNotesGenerator.tsx`
- Create: `hadron-web/frontend/src/components/release-notes/releaseNotesHelpers.ts`

- [ ] **Step 1: Create releaseNotesHelpers.ts**

```typescript
export function getPhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    fetching_tickets: 'Fetching Tickets',
    enriching: 'Enriching Content',
    generating: 'Generating Release Notes',
    computing_insights: 'Computing Insights',
    saving: 'Saving',
    complete: 'Complete',
    failed: 'Failed',
  };
  return labels[phase] || phase;
}

export function getPhaseColor(phase: string): string {
  if (phase === 'complete') return 'bg-green-500';
  if (phase === 'failed') return 'bg-red-500';
  return 'bg-amber-500';
}
```

- [ ] **Step 2: Create ReleaseNotesGenerator.tsx**

This component has: fix version picker, content type selector, enrichment toggles, preview tickets, generate with progress bar. ~200-250 lines.

**Props:** `{ onComplete: (releaseNoteId: number) => void }`

**State:**
- `fixVersions` (JiraFixVersion[]), `selectedVersion` (string)
- `contentType` ('features'|'fixes'|'both')
- `enrichment` (4 booleans)
- `jqlFilter` (string)
- `previewTickets` (ReleaseNoteTicketPreview[] | null)
- `loading` (boolean)

**Uses** `useProgressStream` hook for generation.

**UI:**
- Project key input (default from config or "MGXPRODUCT")
- Fix version dropdown (from `api.getJiraFixVersions`)
- Content type: 3 radio buttons
- Enrichment: 4 checkboxes in a grid
- Optional JQL filter input
- "Preview Tickets" button → shows ticket count + list
- "Generate" button → starts SSE stream, shows multi-phase progress bar
- Progress bar: colored by phase, percentage label, phase name, message

Follow the pattern of other generator components in the project (e.g., CodeAnalyzerView's input section). Use amber color scheme for release notes.

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/release-notes/ReleaseNotesGenerator.tsx hadron-web/frontend/src/components/release-notes/releaseNotesHelpers.ts
git commit -m "feat(frontend): add ReleaseNotesGenerator with progress streaming"
```

---

## Task 9: Frontend — ReleaseNotesInsights & StyleGuide Components

**Files:**
- Create: `hadron-web/frontend/src/components/release-notes/ReleaseNotesInsights.tsx`
- Create: `hadron-web/frontend/src/components/release-notes/ReleaseNotesStyleGuide.tsx`
- Create: `hadron-web/frontend/src/components/admin/StyleGuidePanel.tsx`
- Modify: `hadron-web/frontend/src/components/admin/AdminPanel.tsx`

- [ ] **Step 1: Create ReleaseNotesInsights.tsx (~100 lines)**

**Props:** `{ insights: AiInsights }`

**UI:**
- Quality score gauge (reuse SVG pattern from QualityGauge: circle with colored stroke)
- Module breakdown: horizontal bars (sorted by count descending)
- Breaking changes: red-bordered list of ticket key + summary strings
- Suggestions: bullet list
- Ticket coverage: percentage with colored indicator

- [ ] **Step 2: Create ReleaseNotesStyleGuide.tsx (~60 lines)**

**Props:** none

**On mount:** Fetch from `api.getStyleGuide()`

**UI:**
- Title: "Release Notes Style Guide"
- Badge: "Custom" or "Default" based on `isCustom` flag
- Content rendered in a `<pre>` block with `whitespace-pre-wrap`

- [ ] **Step 3: Create StyleGuidePanel.tsx (~120 lines)**

Admin panel component following AiConfigPanel/SentryConfigPanel patterns.

**State:** `content`, `isCustom`, `loading`, `saved`
**On mount:** Load from `api.getStyleGuide()`
**UI:**
- Title: "Release Notes Style Guide"
- Large textarea (20 rows) with guide content
- "Save" button → `api.updateStyleGuide(content)`
- "Reset to Default" button → `api.deleteStyleGuide()`, reload
- Status indicator (Custom/Default)

- [ ] **Step 4: Wire into AdminPanel.tsx**

Add `"style-guide"` to AdminTab type, add tab button "Style Guide", add conditional render:
```tsx
{activeTab === "style-guide" && <StyleGuidePanel />}
```

- [ ] **Step 5: Commit**

```bash
git add hadron-web/frontend/src/components/release-notes/ReleaseNotesInsights.tsx hadron-web/frontend/src/components/release-notes/ReleaseNotesStyleGuide.tsx hadron-web/frontend/src/components/admin/StyleGuidePanel.tsx hadron-web/frontend/src/components/admin/AdminPanel.tsx
git commit -m "feat(frontend): add insights, style guide viewer, and admin style guide panel"
```

---

## Task 10: Frontend — ReleaseNotesView Refactor & Editor Enhancements

**Files:**
- Modify: `hadron-web/frontend/src/components/release-notes/ReleaseNotesView.tsx`
- Modify: `hadron-web/frontend/src/components/release-notes/ReleaseNoteEditor.tsx`

- [ ] **Step 1: Refactor ReleaseNotesView to 4 tabs**

Rewrite the component to have:
- 3 tabs: Generate | Drafts | Style Guide
- State: `activeTab`, `editingId` (for editing a draft)
- Generate tab → `<ReleaseNotesGenerator onComplete={handleGenComplete} />`
- Drafts tab → existing list (current content)
- Style Guide tab → `<ReleaseNotesStyleGuide />`
- When `editingId` is set → `<ReleaseNoteEditor noteId={editingId} onSaved={...} onCancel={...} />`

`handleGenComplete(id)`: set editingId to the new note, switch to editor view.

- [ ] **Step 2: Enhance ReleaseNoteEditor**

Add to the existing editor:
- Three view mode buttons above the textarea: Edit | Preview | Diff
- In Preview mode: render markdown content as formatted text (simple conversion or `<pre>` with whitespace-pre-wrap)
- If the note has `aiInsights` in `source_data` or in a new field: render `<ReleaseNotesInsights>` below the editor
- Load `aiInsights` from the release note's data (may need to parse from `source_data` JSONB or add to ReleaseNote type)

The existing editor is ~213 lines. These changes should add ~50-80 lines.

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/release-notes/ReleaseNotesView.tsx hadron-web/frontend/src/components/release-notes/ReleaseNoteEditor.tsx
git commit -m "feat(frontend): refactor ReleaseNotesView with 4 tabs, enhance editor"
```

---

## Task 11: Integration Verification & Cleanup

**Files:** Various — compilation fixes

- [ ] **Step 1: Verify backend compilation**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check`

Fix any compilation errors.

- [ ] **Step 2: Run hadron-core tests**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- release_notes`

Expected: All 13 release_notes tests pass.

- [ ] **Step 3: Run all hadron-core tests**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core`

Expected: All tests pass (sentry + release_notes + existing).

- [ ] **Step 4: Verify frontend build**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web/frontend && npx tsc --noEmit && npx vite build`

Fix any TypeScript errors.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(web): complete Release Notes AI generation (Phase 4a)"
```

---

## Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | Infrastructure | Copy style guide + migration 016 |
| 2 | hadron-core | Types, insights computation, tests |
| 3 | hadron-core | Enrichment & generation prompts, tests |
| 4 | hadron-server | JIRA fix versions + DB helpers |
| 5 | hadron-server | Admin style guide routes |
| 6 | hadron-server | Generate pipeline with SSE streaming |
| 7 | Frontend | API types, methods, useProgressStream hook |
| 8 | Frontend | ReleaseNotesGenerator + helpers |
| 9 | Frontend | Insights, StyleGuide viewer, admin panel |
| 10 | Frontend | ReleaseNotesView refactor, editor enhancements |
| 11 | Verification | Build checks, test runs, cleanup |
