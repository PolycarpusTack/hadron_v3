# Web-Desktop Parity Phase 4a: Release Notes AI Generation

**Date:** 2026-04-03
**Status:** Design approved
**Parent:** `docs/plans/2026-03-25-web-desktop-parity-design.md`

## Overview

Port the desktop's Release Notes AI generation pipeline to the web. 3-stage pipeline: JIRA extraction → AI enrichment (module classification, keywords, description rewriting, breaking change detection) → Markdown generation with embedded style guide. SSE progress streaming, admin-configurable style guide, enrichment toggles.

Phase 4b (review workflow, compliance checking) and Phase 4c (Confluence export) are separate follow-ups.

## Design Decisions

1. **Style guide:** Embed WHATS'ON guide as default in hadron-core (`include_str!`). Admin can override via `global_settings`. Pipeline reads custom first, falls back to default.
2. **JIRA fix versions:** New `GET /api/jira/fix-versions/{project}` route using server-side JIRA config. Dropdown picker in UI.
3. **Enrichment pipeline:** 2-step (batch enrichment → markdown generation). Enrichment is optional — 4 toggles (rewrite descriptions, classify modules, generate keywords, detect breaking changes), all default on.
4. **Progress streaming:** SSE with phase-based `ProgressEvent` objects (not token streaming). New `useProgressStream` hook in frontend.
5. **Database migration:** Non-destructive — add columns to existing `release_notes` table. Existing data untouched.

---

## 1. hadron-core: `ai/release_notes.rs`

### Types

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotesConfig {
    pub fix_version: String,
    pub content_type: ContentType,
    pub project_key: Option<String>,
    pub jql_filter: Option<String>,
    pub module_filter: Option<Vec<String>>,
    pub enrichment: AiEnrichmentConfig,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ContentType {
    Features,
    Fixes,
    #[default]
    Both,
}

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

fn default_true() -> bool { true }

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
    // AI-enriched fields (populated after enrichment)
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiInsights {
    #[serde(default)]
    pub quality_score: f64,
    #[serde(default)]
    pub suggestions: Vec<String>,
    #[serde(default)]
    pub module_breakdown: std::collections::HashMap<String, i32>,
    #[serde(default)]
    pub ticket_coverage: f64,
    #[serde(default)]
    pub breaking_changes: Vec<String>,
}
```

### Style Guide

- Copy `hadron-desktop/src-tauri/src/style_guides/whatson_release_notes.md` to `hadron-web/crates/hadron-core/style_guides/whatson_release_notes.md`
- `pub const DEFAULT_STYLE_GUIDE: &str = include_str!("../../style_guides/whatson_release_notes.md");`

### Enrichment Prompt & Parser

`ENRICHMENT_SYSTEM_PROMPT` — instructs AI to process a batch of JIRA tickets and return a JSON array. For each ticket:
- Classify into a module from the official list (100+ module labels from style guide)
- Generate 2-4 plural keywords
- Rewrite description per style guide (fixes: "Previously..." + "This issue has been fixed"; features: "It is now possible to..." / "Users can now...")
- Flag breaking changes (pre-upgrade behavior impact)

`build_enrichment_messages(tickets: &[ReleaseNoteTicket], style_guide: &str) -> (String, Vec<AiMessage>)` — serializes ticket batch as JSON in user message, includes relevant style guide sections.

`parse_enrichment_response(raw: &str) -> HadronResult<Vec<EnrichedTicket>>` — strips markdown fences, parses JSON array.

### Generation Prompt

`GENERATION_SYSTEM_PROMPT` — instructs AI to produce formatted markdown release notes. Content type determines structure:
- Features: Introduction/Detail/Conclusion sections with varied openings
- Fixes: Confluence-style table (Issue Key | Description | Module | Keywords)
- Both: Two sections (New Features + Fixed Issues)

`build_generation_messages(tickets: &[ReleaseNoteTicket], content_type: &ContentType, style_guide: &str) -> (String, Vec<AiMessage>)` — includes enriched ticket data and full style guide in system prompt.

Response is raw markdown — no JSON parsing needed.

### Insights Computation

`compute_insights(tickets: &[ReleaseNoteTicket]) -> AiInsights` — pure function:
- Module breakdown: count tickets per module_label
- Ticket coverage: % of tickets with module_label set
- Breaking changes: collect keys where is_breaking_change == true
- Quality score: (coverage * 80) + (has_breaking_flags ? 10 : 20), capped at 100
- Suggestions: generate based on coverage gaps and missing data

### Tests

- `test_build_enrichment_prompt` — verify prompt construction
- `test_parse_enrichment_response` — parse JSON array
- `test_parse_enrichment_defaults` — partial JSON
- `test_build_generation_prompt_features` — features content type
- `test_build_generation_prompt_fixes` — fixes content type
- `test_build_generation_prompt_both` — both content type
- `test_compute_insights` — known data → expected results
- `test_compute_insights_empty` — no tickets
- `test_content_type_serialization` — enum round-trip

---

## 2. hadron-server: Migration, Routes & Pipeline

### Migration 016

Add columns to `release_notes` (non-destructive):

```sql
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
```

### New JIRA Route

`GET /api/jira/fix-versions/{project}` in `routes/integrations.rs`:
- Uses server-side JIRA config from `global_settings`
- Calls JIRA API: `GET /rest/api/2/project/{project}/versions`
- Returns `Vec<JiraFixVersion>` (id, name, released, releaseDate)

### Admin Style Guide Routes

In `routes/admin.rs`:
- `GET /api/admin/style-guide` — returns custom guide from `global_settings` key `release_notes_style_guide`, or the default if not set
- `PUT /api/admin/style-guide` — saves custom guide, admin-only
- `DELETE /api/admin/style-guide` — resets to default (removes key), admin-only

### Preview Tickets Route

`POST /api/release-notes/preview-tickets` in `routes/release_notes_gen.rs`:
- Accepts `ReleaseNotesConfig` body
- Fetches tickets from JIRA matching the fix version + JQL + module filters
- Returns `Vec<ReleaseNoteTicket>` without enrichment (dry run)

### Generate Stream Route

`POST /api/release-notes/generate/stream` in `routes/release_notes_gen.rs`:

SSE response with `ProgressEvent` objects:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub phase: String,
    pub progress: f64,
    pub message: String,
    pub ticket_count: Option<i32>,
    pub release_note_id: Option<i64>,
}
```

Pipeline phases:
1. `fetching_tickets` (0→15%) — load JIRA config, build JQL, fetch paginated tickets
2. `enriching` (15→60%) — batch enrichment (10 tickets/batch), AI call per batch, progress increments per batch
3. `generating` (60→85%) — build generation prompt with enriched tickets + style guide, single AI call
4. `computing_insights` (85→90%) — compute_insights() on enriched tickets
5. `saving` (90→95%) — persist to `release_notes` table (markdown_content, original_ai_content, ticket_keys, ai_insights, etc.)
6. `complete` (100%) — includes release_note_id in event

Uses manual `mpsc::channel<ProgressEvent>` + custom SSE serialization (not `stream_ai_completion` since these aren't token events).

### Non-Streaming Generate Route

`POST /api/release-notes/generate` — same pipeline, returns final `ReleaseNotesResult` JSON.

### Style Guide Resolution

Helper function used by the pipeline:
```rust
async fn resolve_style_guide(pool: &PgPool) -> String {
    db::get_global_setting(pool, "release_notes_style_guide")
        .await
        .ok()
        .flatten()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| hadron_core::ai::DEFAULT_STYLE_GUIDE.to_string())
}
```

---

## 3. Frontend

### New Hook: `useProgressStream.ts`

Similar to `useAiStream` but for structured progress events:
- `startStream(path: string, body: object)` — POST with auth headers, Accept: text/event-stream
- Exposes: `progress` (number 0-100), `phase` (string), `message` (string), `isStreaming` (boolean), `error` (string|null), `completedData` (any — the final event's data)
- Parses SSE `data: {json}` lines into `ProgressEvent` objects

### Component Structure

```
frontend/src/components/release-notes/
├── ReleaseNotesView.tsx         (modify — 4 tabs: Generate, Drafts, Style Guide, [editor])
├── ReleaseNoteEditor.tsx        (modify — add preview/diff modes, insights panel)
├── ReleaseNotesGenerator.tsx    (new — config + progress)
├── ReleaseNotesInsights.tsx     (new — quality score, module chart, breaking changes)
├── ReleaseNotesStyleGuide.tsx   (new — style guide viewer)
├── releaseNotesHelpers.ts       (new — formatting utilities)

frontend/src/components/admin/
├── StyleGuidePanel.tsx          (new — admin style guide editor)
```

### ReleaseNotesView.tsx (refactored)

- 4 tabs: **Generate** | **Drafts** | **Style Guide**
- Generate tab → `<ReleaseNotesGenerator onComplete={handleGenComplete} />`
- Drafts tab → existing list with click to edit
- Style Guide tab → `<ReleaseNotesStyleGuide />`
- When editing a draft → `<ReleaseNoteEditor draft={selected} onBack={...} />`

### ReleaseNotesGenerator.tsx (~200-250 lines)

- Fix version dropdown (from `api.getJiraFixVersions(project)`)
- Content type: Features / Fixes / Both (radio group)
- Enrichment toggles: 4 checkboxes, all default on
- Optional JQL filter input
- "Preview Tickets" button → shows ticket list with key, summary, type, priority
- "Generate" button → starts SSE via `useProgressStream`
- Multi-phase progress bar: phase label, percentage, message text
- On complete → calls `onComplete(releaseNoteId)`

### ReleaseNoteEditor.tsx (enhanced)

- Three view modes: Edit | Preview | Diff (toggle buttons)
- Edit: textarea with markdown, debounced autosave
- Preview: rendered markdown
- Diff: show original_ai_content vs current (if original exists), simple side-by-side
- Insights panel below (if ai_insights exists): `<ReleaseNotesInsights />`
- Export: Markdown download button
- Save button, status badge

### ReleaseNotesInsights.tsx (~100-120 lines)

- Quality score: radial gauge (reuse QualityGauge SVG pattern)
- Module breakdown: horizontal bars (module name → count)
- Breaking changes: red-highlighted ticket key list
- Suggestions: bullet list
- Ticket coverage percentage

### ReleaseNotesStyleGuide.tsx (~60-80 lines)

- Fetches guide from `api.getStyleGuide()`
- Renders as formatted text (pre-formatted or simple markdown rendering)
- Read-only viewer for all users

### StyleGuidePanel.tsx (admin, ~120 lines)

- Textarea with current guide (from `api.getStyleGuide()`)
- "Save" button → `api.updateStyleGuide(content)`
- "Reset to Default" button → `api.deleteStyleGuide()`
- Preview toggle

### API Additions (api.ts)

Types:
```typescript
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

export interface ReleaseNotesProgressEvent {
  phase: string;
  progress: number;
  message: string;
  ticketCount?: number;
  releaseNoteId?: number;
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
```

Methods:
- `getJiraFixVersions(project: string)` → GET
- `previewReleaseNotesTickets(config)` → POST
- `generateReleaseNotes(config)` → POST (non-streaming)
- `getStyleGuide()` → GET
- `updateStyleGuide(content: string)` → PUT
- `deleteStyleGuide()` → DELETE

---

## 4. Testing & Implementation Order

### hadron-core tests (9 tests)

1. `test_build_enrichment_prompt` — prompt includes tickets + style guide
2. `test_parse_enrichment_response` — parse JSON array of enriched tickets
3. `test_parse_enrichment_defaults` — partial JSON fields
4. `test_build_generation_prompt_features` — features content type in prompt
5. `test_build_generation_prompt_fixes` — fixes content type
6. `test_build_generation_prompt_both` — both content type
7. `test_compute_insights` — known tickets → expected metrics
8. `test_compute_insights_empty` — empty tickets
9. `test_content_type_serialization` — enum round-trip

### Implementation order

1. Copy style guide file + Migration 016
2. hadron-core `ai/release_notes.rs` — types, enrichment prompt/parser, generation prompt, insights, tests
3. hadron-server — fix versions route, admin style guide routes, preview-tickets route
4. hadron-server — generate/stream pipeline route with phase-based SSE
5. Frontend — useProgressStream hook, API types/methods
6. Frontend — ReleaseNotesGenerator (config form + progress)
7. Frontend — ReleaseNoteEditor enhancements + ReleaseNotesInsights
8. Frontend — ReleaseNotesStyleGuide + StyleGuidePanel admin tab
9. Frontend — ReleaseNotesView refactor (4 tabs), wiring, verification
