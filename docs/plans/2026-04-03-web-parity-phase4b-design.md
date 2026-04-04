# Web-Desktop Parity Phase 4b: Release Notes Review & Compliance

**Date:** 2026-04-03
**Status:** Design approved
**Parent:** `docs/plans/2026-03-25-web-desktop-parity-design.md`
**Depends on:** Phase 4a (Release Notes AI Generation)

## Overview

Add review workflow, interactive checklist, and AI compliance checking to the web release notes feature. Status workflow with role-based gating, admin-configurable checklist, and AI-powered style guide compliance audit.

## Design Decisions

1. **Checklist:** Admin-configurable via `global_settings`. 12 WHATS'ON items as default, admin can customize.
2. **Status workflow:** Hybrid role gating — creator owns draft→in_review, lead+ can approve, admin can publish. Checklist must be 100% complete for forward transitions.
3. **Compliance checker:** Full AI-powered audit returning structured violations (terminology, structure, screenshots) with a score. On-demand (user clicks button), not automatic.
4. **Append feature:** Deferred to a follow-up — keeps 4b focused on review/compliance.

---

## 1. hadron-core — Compliance Types & Prompt

### Extend `ai/release_notes.rs`

**New types:**

```rust
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

**Compliance prompt:**

`COMPLIANCE_SYSTEM_PROMPT` — AI auditor role, instructs to:
- Check terminology against the style guide (wrong UI terms, abbreviations, "customers" vs "users", passive voice, quotes around UI text)
- Check structure (features missing intro/detail/conclusion, fixes not starting "Previously...", missing ticket references, titles with colons/quotes)
- Suggest screenshot placements (UI changes, new dialogs, new columns, layout changes)
- Return score 0-100: terminology violations -3pts each, structure violations -5pts each, screenshots don't affect score

`build_compliance_messages(markdown: &str, style_guide: &str) -> (String, Vec<AiMessage>)` — sends full markdown content + complete style guide.

`parse_compliance_response(raw: &str) -> HadronResult<ComplianceReport>` — strips markdown fences, parses JSON.

**Default checklist:**

```rust
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

**Tests:**
- `test_build_compliance_prompt` — markdown + style guide present in messages
- `test_parse_compliance_response` — full JSON with all 3 violation types
- `test_parse_compliance_defaults` — minimal JSON
- `test_default_checklist_items` — 12 items, none empty

---

## 2. hadron-server — Migration, Routes & Role Gating

### Migration 017

```sql
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS checklist_state JSONB;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id);
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
```

### Status Transition Route

`PUT /api/release-notes/{id}/status`

Request: `{ "status": "in_review" | "approved" | "published" | "archived" }`

**Role gating:**

| Transition | Who | Checklist Required |
|---|---|---|
| draft → in_review | owner (creator) | Yes (100%) |
| in_review → approved | lead or admin | Yes (100%) |
| approved → published | admin only | Yes (100%) |
| any → archived | owner or admin | No |
| in_review → draft | owner | No (withdraw) |

Sets `reviewed_by` + `reviewed_at` on approval. Sets `published_at` on publish.

Returns error if checklist is incomplete for forward transitions.

### Checklist Routes

- `GET /api/release-notes/{id}/checklist` — returns `{ items: [{ item: string, checked: boolean }], complete: boolean }`
  - If `checklist_state` is null, initialize from the configured checklist items (all unchecked)
- `PUT /api/release-notes/{id}/checklist` — saves `[{ item: string, checked: boolean }]` to `checklist_state` JSONB

### Admin Checklist Config Routes

- `GET /api/admin/checklist-config` — returns items from `global_settings` key `release_notes_checklist`, or `DEFAULT_CHECKLIST_ITEMS`
- `PUT /api/admin/checklist-config` — saves JSON array of strings, admin-only
- `DELETE /api/admin/checklist-config` — resets to default

### Compliance Route

`POST /api/release-notes/{id}/compliance`

- Loads release note's `markdown_content`
- Loads style guide (custom or default, via `resolve_style_guide()`)
- Builds compliance messages via hadron-core
- Calls `ai::complete()` (non-streaming — compliance reports are small, fast)
- Parses and returns `ComplianceReport` JSON

### DB Helpers

- `update_release_note_status(pool, id, user_id, status, reviewed_by?, reviewed_at?, published_at?)` — validates ownership, updates status + optional reviewer fields
- `update_release_note_checklist(pool, id, user_id, checklist_json)` — saves `checklist_state`
- `get_release_note_owner(pool, id)` — returns `user_id` for ownership check

---

## 3. Frontend

### New Components

**ReleaseNotesReview.tsx (~150-180 lines):**

Props: `{ noteId: number; status: string; userId: string; userRole: string; onStatusChange: () => void }`

- Status badge: colored by status (gray=draft, blue=in_review, amber=approved, green=published)
- Interactive checklist: checkboxes, auto-save on toggle via `api.updateReleaseNoteChecklist()`, completion bar
- Status action buttons based on current status + role:
  - Draft: "Submit for Review" (owner, requires 100%)
  - In Review: "Approve" (lead+, requires 100%), "Return to Draft" (owner)
  - Approved: "Publish" (admin only)
  - Published/Approved: "Archive" (owner or admin)
- Buttons disabled with tooltip when checklist incomplete
- Reviewer info display (reviewed_by, reviewed_at) when applicable

**ReleaseNotesCompliance.tsx (~120-150 lines):**

Props: `{ noteId: number }`

- "Run Compliance Check" button → `api.runComplianceCheck(noteId)`
- Loading state while AI processes
- Score display: large number with color (green ≥80, amber ≥50, red <50)
- Terminology violations: cards with wrong term → correct term, context, suggestion
- Structure violations: cards with rule, description, location, suggestion
- Screenshot suggestions: cards with location, description, reason (informational, no score impact)
- Empty state when no violations found ("All clear!")

**ChecklistConfigPanel.tsx (~100-120 lines):**

Admin panel tab for managing checklist items.

- List of items with delete button per item
- "Add Item" text input + button at bottom
- "Save" button → `api.updateChecklistConfig(items)`
- "Reset to Default" button → `api.deleteChecklistConfig()`
- Item count badge

### Editor Integration

**ReleaseNoteEditor.tsx modifications:**
- Add `<ReleaseNotesReview>` section below content area (visible for AI-generated notes with status field)
- Add "Compliance Check" button in toolbar → toggles `<ReleaseNotesCompliance>` panel
- Disable textarea editing when status is `approved` or `published`
- Show status in header area

**AdminPanel.tsx:**
- Add `"checklist"` to AdminTab type
- Add tab button "Checklist"
- Render `<ChecklistConfigPanel />` when active

### API Additions (api.ts)

Types:
```typescript
export interface ComplianceReport {
  terminologyViolations: TerminologyViolation[];
  structureViolations: StructureViolation[];
  screenshotSuggestions: ScreenshotSuggestion[];
  score: number;
}
export interface TerminologyViolation { term: string; correctTerm: string; context: string; suggestion: string; }
export interface StructureViolation { rule: string; description: string; location: string; suggestion: string; }
export interface ScreenshotSuggestion { location: string; description: string; reason: string; }
export interface ChecklistItem { item: string; checked: boolean; }
export interface ChecklistResponse { items: ChecklistItem[]; complete: boolean; }
```

Methods:
- `updateReleaseNoteStatus(id, status)` → PUT
- `getReleaseNoteChecklist(id)` → GET
- `updateReleaseNoteChecklist(id, items: ChecklistItem[])` → PUT
- `runComplianceCheck(id)` → POST, returns ComplianceReport
- `getChecklistConfig()` → GET
- `updateChecklistConfig(items: string[])` → PUT
- `deleteChecklistConfig()` → DELETE

---

## 4. Testing & Implementation Order

### hadron-core tests (4 new)

1. `test_build_compliance_prompt` — markdown + style guide in messages
2. `test_parse_compliance_response` — full JSON with violations
3. `test_parse_compliance_defaults` — minimal JSON
4. `test_default_checklist_items` — 12 items, none empty

### Implementation order

1. Migration 017 (4 new columns)
2. hadron-core — compliance types, prompt, parser, default checklist, tests
3. hadron-server — DB helpers (status update, checklist CRUD, owner check)
4. hadron-server — status transition route with role gating + checklist gate
5. hadron-server — admin checklist config routes + compliance route
6. Frontend — API types and methods
7. Frontend — ChecklistConfigPanel + AdminPanel wiring
8. Frontend — ReleaseNotesReview (checklist + status buttons)
9. Frontend — ReleaseNotesCompliance (violation display)
10. Frontend — Editor integration (review section, compliance button, read-only gating)
11. Integration verification
