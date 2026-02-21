# Release Notes Style Compliance Checker — Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create the implementation plan from this design.

**Goal:** Add an on-demand style compliance checker to the release notes pipeline that validates drafts against the WHATS'ON style guide, highlights terminology and structure violations with inline fix suggestions, and identifies where screenshots should be added.

**Architecture:** Single AI call approach — one new Tauri command sends the draft + embedded style guide to the configured AI provider and returns a structured JSON compliance report. A new "Compliance" review sub-tab surfaces results with per-violation "Apply Fix" and "Insert Placeholder" actions that modify the editor content directly.

**Tech Stack:** Rust (Tauri command + service function), React/TypeScript (new component + lifted state), existing AI provider abstraction.

---

## Backend

### Data Structures (`release_notes_service.rs`)

```rust
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceReport {
    pub terminology_violations: Vec<TerminologyViolation>,
    pub structure_violations: Vec<StructureViolation>,
    pub screenshot_suggestions: Vec<ScreenshotSuggestion>,
    pub score: f64,
    pub tokens_used: i32,
    pub cost: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminologyViolation {
    pub line_context: String,
    pub violation: String,
    pub suggested_fix: String,
    pub rule_reference: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureViolation {
    pub section: String,
    pub violation: String,
    pub suggested_fix: String,
    pub rule_reference: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotSuggestion {
    pub ticket_key: String,
    pub description: String,
    pub placement_hint: String,
    pub inline_placeholder: String,
}
```

### Service Function (`release_notes_service.rs`)

New function `check_compliance(markdown: &str, api_key: &str, model: &str, provider: &str) -> Result<ComplianceReport, String>`:

- Builds a system prompt instructing the AI to act as a WHATS'ON style auditor
- Includes the full `STYLE_GUIDE` (already embedded at compile time) in the user prompt alongside the draft
- Requests JSON response with the three arrays + score
- Uses `json_mode` for OpenAI, structured prompting for Anthropic
- Max tokens: 6000 (flexible for larger drafts)
- Parses the response into `ComplianceReport`, attaches token/cost metadata

### AI Prompt

**System prompt:**
```
You are a WHATS'ON release notes style auditor. You enforce the company's
release notes style guide with precision.

Given a draft and the full style guide, analyze the draft and return a JSON
object with exactly these fields:

1. "terminologyViolations" — array of objects with: lineContext, violation,
   suggestedFix, ruleReference. Check wrong UI terms against Section 1
   terminology table, abbreviations, "customers" vs "users", incorrect
   capitalization, etc.

2. "structureViolations" — array of objects with: section, violation,
   suggestedFix, ruleReference. Check: features missing Introduction/Detail/
   Conclusion, fixes not starting with "Previously,...", missing ticket
   references in brackets, titles with colons or quotes, passive voice, etc.

3. "screenshotSuggestions" — array of objects with: ticketKey, description,
   placementHint, inlinePlaceholder. Identify places where a screenshot would
   help readers understand a UI change, new dialog, new column, new button,
   etc. The inlinePlaceholder should be formatted as
   [SCREENSHOT: brief description].

4. "score" — number 0-100 reflecting overall style guide compliance.

Be thorough but concise. For each violation, provide just enough context to
identify and fix it. Return ONLY valid JSON. No markdown fences.
```

**User prompt:**
```
## Style Guide:
{STYLE_GUIDE}

## Draft to Review:
{markdown_content}
```

### Tauri Command (`commands/release_notes.rs`)

```rust
#[tauri::command]
pub async fn check_release_notes_compliance(
    content: String,
    api_key: String,
    model: String,
    provider: String,
) -> Result<ComplianceReport, String>
```

Register in `main.rs` invoke handler list.

---

## Frontend

### Shared Editor State

Lift `content` state from `ReleaseNotesEditor` up to `ReleaseNotesView`:

- `ReleaseNotesView` holds `editorContent: string | null` and provides `setEditorContent`
- `ReleaseNotesEditor` receives `content` + `onContentChange` props; removes local `content` state
- `ReleaseNotesCompliance` receives `content` (to send to backend) and `onContentChange` (to apply fixes)
- Draft loading stays in `ReleaseNotesEditor` — on load, it calls `onContentChange(data.markdownContent)` to sync up
- Autosave stays in `ReleaseNotesEditor` — triggered by `onContentChange` from either the editor textarea or compliance fix actions

### New Sub-Tab

Add "Compliance" as the 4th review sub-tab in `ReleaseNotesView`:

```tsx
{ id: "compliance" as const, label: "Compliance" }
```

### New Component: `ReleaseNotesCompliance.tsx`

**Props:**
```tsx
interface Props {
  draftId: number;
  content: string;
  onContentChange: (content: string) => void;
}
```

**UI Structure:**
- "Check Compliance" button (amber themed, top of panel)
- Loading state with spinner during AI call
- Score display: `87/100` with progress bar (green >80, amber 50-80, red <50)
- Three collapsible sections:
  - **Terminology** — warning icon, offending text in context, rule reference, suggested fix, [Apply Fix] button
  - **Structure** — same pattern, keyed by section/ticket
  - **Screenshots** — camera icon, ticket key, description of what to capture, [Insert Placeholder] button
- Empty state: "Run a compliance check to validate your draft against the WHATS'ON style guide."

**Apply Fix behavior:**
- Find `violation.lineContext` in the current content
- Replace with `violation.suggestedFix`
- Call `onContentChange(updatedContent)`
- Mark the violation as "applied" (local state, grey it out)

**Insert Placeholder behavior:**
- Find the ticket key reference (e.g., `(MGXPRODUCT-12345)`) in the content
- Insert `\n\n[SCREENSHOT: description]\n` after the paragraph containing the reference
- Call `onContentChange(updatedContent)`
- Mark the suggestion as "inserted"

### Service Layer (`services/release-notes.ts`)

New function:
```typescript
export async function checkCompliance(
  content: string
): Promise<ComplianceReport>
```

Reads API key, model, provider from stored settings (same pattern as `generateReleaseNotes`).

### Types (`types/index.ts`)

Add TypeScript interfaces matching the Rust structs:
```typescript
interface ComplianceReport { ... }
interface TerminologyViolation { ... }
interface StructureViolation { ... }
interface ScreenshotSuggestion { ... }
```

---

## Not In Scope

- Auto-running compliance during generation (on-demand only)
- Learning from corrections / feedback loop
- Actual screenshot capture (placeholders only)
- Compliance history / tracking over time
