# Web-Desktop Parity Phase 4c: Confluence Export

**Date:** 2026-04-04
**Status:** Design approved
**Parent:** `docs/plans/2026-03-25-web-desktop-parity-design.md`
**Depends on:** Phase 4a (Release Notes AI Generation)

## Overview

Add Confluence wiki markup export (download) and direct publish to Confluence via REST API for release notes. Reuses JIRA credentials for Confluence auth. Admin configures space key and parent page ID. Upsert logic prevents duplicate pages.

## Design Decisions

1. **Markup conversion:** Pure function in hadron-core, ported from desktop. Line-by-line: headings, tables, bold, bullets, code blocks.
2. **Credentials:** Reuse JIRA poller config (same Atlassian Cloud auth). No separate Confluence credentials.
3. **Page management:** Upsert by title under admin-configured parent page. Creates new or updates existing.
4. **Config storage:** `global_settings` keys for space key + parent page ID. No new migration.

---

## 1. hadron-core

**Extend `ai/release_notes.rs`** with:

```rust
pub fn markdown_to_confluence(markdown: &str) -> String
```

Line-by-line conversion:
- Headings: `######` → `h6.` ... `#` → `h1.`
- Table separator lines (`|---|`): skip
- Table header rows (line before separator): `| ` → `|| `, strip `**` from headers
- Table body rows: pass through
- Bold: `**text**` → `*text*`
- Bullets: `- ` → `* `
- Code blocks: ` ``` ` → `{code}`, ` ```lang ` → `{code:language=lang}`
- Everything else: pass through

**Tests:**
- `test_markdown_to_confluence_headings` — all heading levels
- `test_markdown_to_confluence_tables` — header + body rows, separator skipped
- `test_markdown_to_confluence_bold_bullets` — inline conversion
- `test_markdown_to_confluence_code_blocks` — with and without language

---

## 2. hadron-server

### New Integration: `integrations/confluence.rs`

```rust
pub struct ConfluencePageResult {
    pub id: String,
    pub url: String,
    pub created: bool,  // true if new page, false if updated
}

pub async fn publish_page(
    base_url: &str,
    email: &str,
    api_token: &str,
    space_key: &str,
    parent_page_id: &str,
    title: &str,
    confluence_markup: &str,
) -> HadronResult<ConfluencePageResult>
```

Upsert logic:
1. `GET /wiki/rest/api/content?spaceKey={space_key}&title={title}` — search for existing page
2. If found (results.size > 0): `PUT /wiki/rest/api/content/{id}` with incremented version number, body in storage format "wiki"
3. If not found: `POST /wiki/rest/api/content` with type "page", space key, ancestors [parent_page_id], body in storage format "wiki"
4. Return page ID + `{base_url}/wiki/spaces/{space_key}/pages/{id}` URL

Auth: basic auth with email + API token (same as JIRA).

### Admin Config

Store in `global_settings`:
- `confluence_space_key` (string)
- `confluence_parent_page_id` (string)

Routes in `admin.rs`:
- `GET /api/admin/confluence` — returns `{ spaceKey, parentPageId, configured }`
- `PUT /api/admin/confluence` — saves space key + parent page ID, admin-only

### Export & Publish Routes

In `routes/release_notes.rs`:

- `POST /api/release-notes/{id}/export/confluence` — loads note, converts markdown → Confluence wiki markup via `hadron_core::ai::markdown_to_confluence()`, returns as text with `Content-Type: text/plain`
- `POST /api/release-notes/{id}/publish/confluence` — loads note, converts, loads Confluence config + JIRA credentials, calls `confluence::publish_page()`, returns `ConfluencePageResult` JSON

---

## 3. Frontend

### ReleaseNoteEditor.tsx

Add two buttons in the action area:
- "Export Confluence" (amber outline) — calls `api.exportConfluence(id)`, triggers download as `.txt` file
- "Publish to Confluence" (amber solid) — calls `api.publishToConfluence(id)`, shows success message with clickable link to the published page. Only visible if Confluence is configured.

### ConfluenceConfigPanel.tsx (admin)

Simple panel:
- Space Key input
- Parent Page ID input
- Save button
- Status indicator (configured / not configured)

Wired into AdminPanel as "Confluence" tab.

### API additions (api.ts)

Types:
```typescript
export interface ConfluencePageResult { id: string; url: string; created: boolean; }
export interface ConfluenceConfig { spaceKey: string; parentPageId: string; configured: boolean; }
```

Methods:
- `exportConfluence(id: number): Promise<string>` — POST, returns text
- `publishToConfluence(id: number): Promise<ConfluencePageResult>` — POST
- `getConfluenceConfig(): Promise<ConfluenceConfig>` — GET
- `updateConfluenceConfig(config: { spaceKey: string; parentPageId: string }): Promise<void>` — PUT

---

## 4. Testing & Implementation Order

### hadron-core tests (4 new)
- Heading conversion (all levels)
- Table conversion (header + body + separator skip)
- Bold + bullet conversion
- Code block conversion

### Implementation order
1. hadron-core — `markdown_to_confluence()` + tests
2. hadron-server — `integrations/confluence.rs` (publish_page)
3. hadron-server — admin Confluence config routes
4. hadron-server — export + publish routes
5. Frontend — API types + methods
6. Frontend — ConfluenceConfigPanel + AdminPanel wiring
7. Frontend — Editor export/publish buttons
8. Integration verification
