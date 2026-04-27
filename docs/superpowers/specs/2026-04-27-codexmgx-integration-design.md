# CodexMgX Investigation Integration Design

**Date:** 2026-04-27  
**Status:** Approved  
**Scope:** Hadron Desktop + Hadron Web — full parity

---

## Overview

Integrate the CodexMgX investigation engine into Hadron as a native Rust library, exposing deep Jira + Confluence investigation capabilities in AskHadron chat, the JIRA Analyzer, and the Elena widget. The PowerShell MCP plugin (`docs/CodexMgX plugin/`) serves as the reference implementation; this design translates it to Rust for use on both the desktop (Tauri) and the web (Axum server).

**Investigation capabilities added:**
- Full ticket dossier (`investigate_ticket`) — changelog, rendered comments, worklogs, remote links, project context, agile context, attachment extraction, evidence bundle
- Regression family analysis (`investigate_regression_family`)
- Expected behavior lookup (`investigate_expected_behavior`) — Confluence + WHATS'ON KB
- Customer history (`investigate_customer_history`)
- Confluence search + page fetch
- Related issue search (3-strategy JQL)

---

## 1. Architecture

### New crate: `hadron-investigation`

Location: `hadron-web/crates/hadron-investigation/`

Added as a path dependency in:
- `hadron-web/crates/hadron-server/Cargo.toml`
- `hadron-desktop/src-tauri/Cargo.toml`

```
hadron-investigation/
  Cargo.toml
  src/
    lib.rs
    atlassian/
      mod.rs
      jira.rs          ← extended Jira API (issue_full, related, attachments, changelog)
      confluence.rs    ← search + get content + get related content + MOD docs
      adf.rs           ← Atlassian Document Format → plain text converter
      attachments.rs   ← txt/log/json/xml/html/zip/docx/PDF text extraction
    investigation/
      mod.rs
      evidence.rs      ← InvestigationDossier, EvidenceClaim, RelatedIssue, Hypothesis types
      related.rs       ← 3-strategy related-issue finder
      ticket.rs        ← investigate_ticket orchestrator
      regression.rs    ← investigate_regression_family
      expected.rs      ← investigate_expected_behavior
      customer.rs      ← investigate_customer_history
    knowledge_base/
      mod.rs           ← WHATS'ON KB index manifest + chunk search
```

### Desktop wiring

New file: `hadron-desktop/src-tauri/src/commands/investigation.rs`  
Thin Tauri command wrappers calling into `hadron-investigation`.  
Registered in `main.rs` alongside existing commands.

### Web wiring

New file: `hadron-web/crates/hadron-server/src/routes/investigation.rs`  
Axum handlers, same `hadron-investigation` calls.  
Routes registered in the server's router setup.

---

## 2. Investigation Output Model

```rust
pub struct InvestigationDossier {
    pub ticket_key: String,
    pub ticket_summary: String,
    pub ticket_url: String,
    pub status: String,
    pub assignee: Option<String>,

    // Core evidence
    pub claims: Vec<EvidenceClaim>,
    pub related_issues: Vec<RelatedIssue>,
    pub confluence_docs: Vec<ConfluenceDoc>,

    // AI reasoning aids
    pub hypotheses: Vec<Hypothesis>,
    pub open_questions: Vec<String>,
    pub next_checks: Vec<String>,

    // Attachment signals
    pub attachments: Vec<AttachmentResult>,

    // Meta
    pub warnings: Vec<String>,
    pub investigation_type: InvestigationType,
    pub investigation_status: InvestigationStatus,
}

pub struct EvidenceClaim {
    pub text: String,
    pub category: EvidenceCategory,
    pub entities: Vec<String>,
}

pub enum EvidenceCategory {
    ObservedBehavior,
    LinkedContext,
    HistoricalMatch,
    ExpectedBehavior,
    AttachmentSignal,
    IssueComment,
    CustomerHistory,
}

pub struct RelatedIssue {
    pub key: String,
    pub summary: String,
    pub status: String,
    pub relation_type: RelationType, // DirectLink | ProjectHistory | CrossProjectSibling
    pub url: String,
}

pub struct Hypothesis {
    pub text: String,
    pub confidence: Confidence, // High | Medium | Low
    pub supporting_claims: Vec<String>,
}

pub struct AttachmentResult {
    pub filename: String,
    pub extracted_text: Option<String>, // truncated to 8 KB
    pub extraction_status: ExtractionStatus, // Success | Skipped | Failed(reason)
}

pub enum InvestigationType {
    Ticket,
    RegressionFamily,
    ExpectedBehavior,
    CustomerHistory,
}

pub enum InvestigationStatus {
    Complete,
    PartialFailure, // some sub-calls failed, warnings populated
}
```

`warnings` is non-fatal — attachment failures, Confluence timeouts, and missing KB config are captured there. The dossier returns whatever evidence was gathered rather than failing entirely.

---

## 3. Atlassian API Layer

### Extended Jira (`atlassian/jira.rs`)

Extends the existing `jira_service.rs` plumbing. New API calls added:

| Endpoint | Purpose |
|---|---|
| `/rest/api/3/issue/{key}/changelog` | Field-change history |
| `/rest/api/3/issue/{key}/comment?expand=renderedBody` | Comments with rendered HTML |
| `/rest/api/3/issue/{key}/worklog` | Work log entries |
| `/rest/api/3/issue/{key}/remotelink` | Remote links |
| `/rest/api/3/project/{key}` | Project details |
| `/rest/api/3/project/{key}/version` | Project versions |
| `/rest/api/3/project/{key}/components` | Project components |
| `/rest/agile/1.0/board?projectKeyOrId={key}` | Agile boards + sprints |

**3-strategy related issue finder** (runs sub-queries in parallel):
1. **Direct links** — from remote links + issue links fields on the ticket
2. **Same-project history** — JQL: same project + error tokens from summary, last 90 days
3. **Cross-project siblings** — JQL: error tokens across all projects, last 6 months

Stop-word list and token scoring follow the PowerShell reference implementation.

### Confluence (`atlassian/confluence.rs`)

| Function | API |
|---|---|
| `search(cql, limit)` | `/wiki/rest/api/search` |
| `get_content(id)` | `/wiki/rest/api/content/{id}?expand=body.storage` |
| `get_related_content(entities)` | CQL built from extracted entity names |
| `search_mod_docs(query)` | Search scoped to `MOD_DOCS_HOMEPAGE_ID` ancestor |
| `get_mod_page(id)` | `get_content` defaulting to homepage ID |

### ADF Parser (`atlassian/adf.rs`)

Recursive descent over Atlassian Document Format JSON. Handles: `text`, `paragraph`, `heading`, `bulletList`, `orderedList`, `listItem`, `hardBreak`, `rule`, `codeBlock`, `blockquote`, `panel`, `table`, `tableRow`, `tableCell`, `emoji`, `mention`, `inlineCard`, `mediaSingle`, `media`. Outputs clean plain text with preserved paragraph breaks and list items. Used for all comments and descriptions returned as ADF objects.

### Attachment Extractor (`atlassian/attachments.rs`)

Downloads attachment bytes via authenticated Jira API, dispatches by file extension:

| Extension | Method | Quality |
|---|---|---|
| `.txt`, `.log`, `.json`, `.xml` | UTF-8 decode | 100% |
| `.html` | Strip tags | ~100% |
| `.zip` | Iterate entries, extract text files recursively | 100% for text entries |
| `.docx` | Unzip → parse `word/document.xml` (Office Open XML) | ~100% |
| `.pdf` | `lopdf` crate — content-stream text extraction | Good for software-generated PDFs |
| `.png`, `.jpg`, scanned PDF | No extraction | 0% — warning added |

Output truncated to **8 KB per attachment** to keep evidence bundles token-friendly.

**Phase 2 (OCR):** Add optional Tesseract integration via the `tesseract` crate for scanned PDFs and image attachments. This is a known gap — the codebase has PDFs and screenshots that will not be extracted in Phase 1.

---

## 4. Settings & Credentials

### Confluence credentials

Default: reuse JIRA `base_url` / `email` / `api_token` (same Atlassian account).

Optional override (three fields, all nullable):
- `confluence_override_url`
- `confluence_override_email`
- `confluence_override_token`

**Desktop:** stored in Tauri encrypted store alongside existing JIRA settings.  
**Web:** three new nullable columns in the settings table (single additive migration).

### WHATS'ON Knowledge Base

Default URL: `https://whatsonknowledgebase.mediagenix.tv/latest_version/` (public, no token).

Optional override: `whatson_kb_url`

### MOD Documentation

Optional overrides:
- `mod_docs_homepage_id` (default: `"1888060283"`)
- `mod_docs_space_path` (default: `"modkb"`)

### Settings UI

Inside **Settings → Integrations → JIRA**, below existing JIRA fields:

```
[ ] Use separate Confluence instance
    └─ (collapsed unless checked)
       Confluence URL    [____________]
       Email             [____________]
       API Token         [____________]

▼ Advanced
   WHATS'ON KB URL       [____________]  (default shown as placeholder)
   MOD Docs Homepage ID  [____________]  (default: 1888060283)
   MOD Docs Space Path   [____________]  (default: modkb)
```

No top-level "Confluence" section — stays nested under JIRA since it is the same Atlassian account.

---

## 5. Web Routes

New file: `hadron-web/crates/hadron-server/src/routes/investigation.rs`

```
POST /api/investigation/ticket              → investigate_ticket
POST /api/investigation/regression-family  → investigate_regression_family
POST /api/investigation/expected-behavior  → investigate_expected_behavior
POST /api/investigation/customer-history   → investigate_customer_history
POST /api/confluence/search                → confluence_search
GET  /api/confluence/content/:id           → confluence_get_content
```

Auth: existing JWT middleware, minimum `analyst` role (same as JIRA analysis routes).

Request bodies carry ticket key + optional source/limit overrides.  
Response: serialised `InvestigationDossier`.

Frontend service module: `hadron-web/frontend/src/services/investigation.ts`

---

## 6. Desktop Commands

New file: `hadron-desktop/src-tauri/src/commands/investigation.rs`

```rust
#[tauri::command] investigate_jira_ticket(key, db, settings) -> InvestigationDossier
#[tauri::command] investigate_regression_family(key, db, settings) -> InvestigationDossier
#[tauri::command] investigate_expected_behavior(key, db, settings) -> InvestigationDossier
#[tauri::command] investigate_customer_history(key, db, settings) -> InvestigationDossier
#[tauri::command] search_confluence(query, space_key, limit, settings) -> Vec<ConfluenceDoc>
#[tauri::command] get_confluence_page(content_id, settings) -> ConfluenceDoc
```

Frontend service module: `hadron-desktop/src/services/investigation.ts`

---

## 7. AskHadron Chat Tools

Six new tool definitions added to `chat_tools.rs` (desktop) and the web AI service equivalent:

| Tool name | Description |
|---|---|
| `investigate_jira_ticket` | Full investigation dossier for a ticket key |
| `investigate_regression_family` | Regression siblings across projects |
| `investigate_expected_behavior` | Confluence + KB lookup for expected behaviour |
| `investigate_customer_history` | Customer history timeline from Jira |
| `search_confluence` | Free-text or CQL Confluence search |
| `get_confluence_page` | Fetch a specific Confluence page by content ID |

Tools are passed to the configured AI provider on every chat message. The AI calls them autonomously based on conversation context — no button press needed. The configured provider (Anthropic, OpenAI, etc.) drives tool selection, not any hardcoded model.

New `TOOL_LABELS` entries in `AskHadronView.tsx`:

```ts
investigate_jira_ticket: "Investigating ticket",
investigate_regression_family: "Analysing regression family",
investigate_expected_behavior: "Looking up expected behaviour",
investigate_customer_history: "Fetching customer history",
search_confluence: "Searching Confluence",
get_confluence_page: "Fetching Confluence page",
```

---

## 8. UI Placement

### JIRA Analyzer — "Analyze Ticket" tab

An **"Investigate"** button (with `Microscope` icon) sits below the existing "Analyze" button in `JiraTicketAnalyzer`. The two actions are independent — both can be run on the same ticket.

New component: `InvestigationPanel.tsx` — identical implementation in both frontend projects (desktop and web are separate React codebases, so it lives in each).

Renders in collapsible sections:
1. Ticket summary, status, assignee
2. Evidence claims — grouped by category (Observed → Linked → Historical → Expected → Attachments → Comments)
3. Related issues — grouped by relation type (Direct Links / Project History / Cross-Project), each row linkable
4. Confluence docs — title + excerpt + URL
5. Hypotheses — with confidence badge (High / Medium / Low)
6. Open questions + Next checks — bullet lists
7. Attachments — filename + extraction status + truncated preview
8. Warnings — amber dismissable banner (shown only if `warnings` is non-empty)

A loading state shows a spinner with a descriptive label while the investigation runs.

### Elena Widget

**Web (`FloatingElena`):** 5th entry added to `QUICK_ACTIONS`:
```ts
{
  label: "Investigate JIRA ticket",
  prompt: "Investigate this JIRA ticket: [paste ticket key or describe the issue]",
}
```
Opens the chat panel and fires the prompt; the AI resolves it with `investigate_jira_ticket`.

**Desktop (`AskHadronView`):** `"Investigate this JIRA ticket"` added to `CONTEXTUAL_STARTERS`. Appears as a suggested prompt in the AskHadron drawer.

---

## 9. Error Handling

- Each sub-call returns `Result<T, InvestigationError>`.
- Failed attachment extraction → skip that attachment, add entry to `dossier.warnings`.
- Confluence timeout / auth failure → skip Confluence sections, add warning.
- Missing KB config → skip KB search, add warning.
- All Jira API failures → propagate as a hard error (the ticket itself must be reachable).
- Partial results are valid — `InvestigationStatus::PartialFailure` + populated `warnings`.

---

## 10. Known Limitations & Phase 2 Path

| Limitation | Phase 2 path |
|---|---|
| No OCR for scanned PDFs and image attachments (`.png`, `.jpg`, image-only PDFs) | Add optional `tesseract` crate integration. Configurable on/off in settings. Critical given the codebase has PDFs and screenshots. |
| Investigation is one-shot (full response when complete) | Stream progress events so the UI can show per-step updates in real time. |
| No KB search in web version (WHATS'ON KB is a static JS index) | Evaluate if the KB index can be fetched and parsed server-side; may require caching. |

---

## 11. Files Created / Modified

### New files
- `hadron-web/crates/hadron-investigation/` (full new crate, ~12 source files)
- `hadron-desktop/src-tauri/src/commands/investigation.rs`
- `hadron-web/crates/hadron-server/src/routes/investigation.rs`
- `hadron-desktop/src/services/investigation.ts`
- `hadron-web/frontend/src/services/investigation.ts`
- `hadron-desktop/src/components/jira/InvestigationPanel.tsx`
- `hadron-web/frontend/src/components/jira/InvestigationPanel.tsx`

### Modified files
- `hadron-web/Cargo.toml` — workspace member
- `hadron-desktop/src-tauri/Cargo.toml` — path dependency
- `hadron-web/crates/hadron-server/Cargo.toml` — dependency
- `hadron-web/crates/hadron-server/src/routes/mod.rs` — register routes
- `hadron-desktop/src-tauri/src/commands/mod.rs` — register commands
- `hadron-desktop/src-tauri/src/main.rs` — register commands
- `hadron-desktop/src-tauri/src/chat_tools.rs` — 6 new tool definitions + executors
- `hadron-desktop/src/components/AskHadronView.tsx` — TOOL_LABELS + CONTEXTUAL_STARTERS
- `hadron-desktop/src/components/jira/JiraTicketAnalyzer.tsx` — Investigate button
- `hadron-web/frontend/src/components/widget/FloatingElena.tsx` — 5th quick action
- `hadron-web/frontend/src/components/jira/JiraTicketAnalyzer.tsx` — Investigate button
- Settings UI files (desktop + web) — Confluence override + advanced fields
- Web settings migration — 3 new nullable columns + WHATS'ON KB URL + MOD doc overrides
