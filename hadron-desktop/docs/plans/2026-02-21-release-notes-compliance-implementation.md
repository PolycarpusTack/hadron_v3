# Release Notes Compliance Checker — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an on-demand style compliance checker that validates release notes drafts against the WHATS'ON style guide, surfaces violations with inline fix suggestions, and suggests screenshot placements.

**Architecture:** Single Tauri command calls the configured AI provider with the draft + embedded style guide, returns structured JSON. A new "Compliance" review sub-tab surfaces results with Apply Fix / Insert Placeholder actions. Editor content is lifted to shared parent state so Compliance and Editor tabs stay in sync.

**Tech Stack:** Rust (Tauri command, serde structs), React/TypeScript (new component, lifted state), existing AI provider abstraction (`ai_service::call_provider_raw_json`).

---

### Task 1: Add Rust Compliance Structs and Service Function

**Files:**
- Modify: `hadron-desktop/src-tauri/src/release_notes_service.rs`

**Step 1: Add the compliance data structures**

Add after the existing `AiInsights` struct (around line 114):

```rust
// ============================================================================
// Style Compliance
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceReport {
    pub terminology_violations: Vec<TerminologyViolation>,
    pub structure_violations: Vec<StructureViolation>,
    pub screenshot_suggestions: Vec<ScreenshotSuggestion>,
    pub score: f64,
    pub tokens_used: i32,
    pub cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminologyViolation {
    pub line_context: String,
    pub violation: String,
    pub suggested_fix: String,
    pub rule_reference: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureViolation {
    pub section: String,
    pub violation: String,
    pub suggested_fix: String,
    pub rule_reference: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotSuggestion {
    pub ticket_key: String,
    pub description: String,
    pub placement_hint: String,
    pub inline_placeholder: String,
}
```

**Step 2: Add the compliance check function**

Add after the `compute_ai_insights` function (around line 623):

```rust
// ============================================================================
// Style Compliance Check
// ============================================================================

pub async fn check_compliance(
    markdown: &str,
    api_key: &str,
    model: &str,
    provider: &str,
) -> Result<ComplianceReport, String> {
    let system_prompt = r#"You are a WHATS'ON release notes style auditor. You enforce the company's release notes style guide with precision.

Given a draft and the full style guide, analyze the draft and return a JSON object with exactly these fields:

1. "terminologyViolations" — array of objects with: lineContext, violation, suggestedFix, ruleReference. Check wrong UI terms against Section 1 terminology table, abbreviations, "customers" vs "users", incorrect capitalization, passive voice, quotes around UI text instead of bold, etc.

2. "structureViolations" — array of objects with: section, violation, suggestedFix, ruleReference. Check: features missing Introduction/Detail/Conclusion structure, fixes not starting with "Previously,...", missing ticket references in brackets, titles with colons or quotes, content not ending with "This issue has been fixed in this version." for fixes, etc.

3. "screenshotSuggestions" — array of objects with: ticketKey, description, placementHint, inlinePlaceholder. Identify places where a screenshot would help readers understand a UI change, new dialog, new column, new button, layout change, etc. The inlinePlaceholder should be formatted as [SCREENSHOT: brief description of what to capture].

4. "score" — number 0-100 reflecting overall style guide compliance. 100 = perfect compliance. Deduct points per violation: terminology -3, structure -5, missing screenshots don't affect score.

Be thorough but concise. For each violation, provide just enough context to identify and fix it. Return ONLY valid JSON. No markdown fences."#;

    let user_prompt = format!(
        "## Style Guide:\n\n{}\n\n---\n\n## Draft to Review:\n\n{}",
        STYLE_GUIDE, markdown
    );

    let request_body = build_ai_request(provider, system_prompt, &user_prompt, model, 6000);
    let response = ai_service::call_provider_raw_json(provider, request_body, api_key).await?;

    let (content, tokens, cost) = extract_ai_response(provider, &response);

    let mut report: ComplianceReport = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse compliance report: {}. Raw: {}", e, &content[..content.len().min(200)]))?;

    report.tokens_used = tokens;
    report.cost = cost;

    Ok(report)
}
```

**Step 3: Verify it compiles**

Run: `cd hadron-desktop/src-tauri && cargo check 2>&1 | tail -5`
Expected: Compiles with no new errors (existing warnings OK).

**Step 4: Commit**

```bash
git add hadron-desktop/src-tauri/src/release_notes_service.rs
git commit -m "feat(release-notes): add compliance check structs and service function"
```

---

### Task 2: Add Tauri Command and Register It

**Files:**
- Modify: `hadron-desktop/src-tauri/src/commands/release_notes.rs`
- Modify: `hadron-desktop/src-tauri/src/main.rs:305`

**Step 1: Add the Tauri command**

Add at the end of `commands/release_notes.rs`, before the closing of the file:

```rust
/// On-demand style compliance check
#[tauri::command]
pub async fn check_release_notes_compliance(
    content: String,
    api_key: String,
    model: String,
    provider: String,
) -> Result<release_notes_service::ComplianceReport, String> {
    log::info!("Running release notes compliance check");
    release_notes_service::check_compliance(&content, &api_key, &model, &provider).await
}
```

**Step 2: Register the command in main.rs**

Find line 305 in `main.rs` (after `commands::release_notes::delete_release_notes,`) and add:

```rust
            commands::release_notes::check_release_notes_compliance,
```

**Step 3: Verify it compiles**

Run: `cd hadron-desktop/src-tauri && cargo check 2>&1 | tail -5`
Expected: Compiles with no new errors.

**Step 4: Commit**

```bash
git add hadron-desktop/src-tauri/src/commands/release_notes.rs hadron-desktop/src-tauri/src/main.rs
git commit -m "feat(release-notes): add check_release_notes_compliance Tauri command"
```

---

### Task 3: Add TypeScript Types and Service Function

**Files:**
- Modify: `hadron-desktop/src/types/index.ts`
- Modify: `hadron-desktop/src/services/release-notes.ts`

**Step 1: Add TypeScript types**

Add after the `ReleaseNotesExportFormat` type (line 1181 in `types/index.ts`):

```typescript
// Style Compliance
export interface ComplianceReport {
  terminologyViolations: TerminologyViolation[];
  structureViolations: StructureViolation[];
  screenshotSuggestions: ScreenshotSuggestion[];
  score: number;
  tokensUsed: number;
  cost: number;
}

export interface TerminologyViolation {
  lineContext: string;
  violation: string;
  suggestedFix: string;
  ruleReference: string;
}

export interface StructureViolation {
  section: string;
  violation: string;
  suggestedFix: string;
  ruleReference: string;
}

export interface ScreenshotSuggestion {
  ticketKey: string;
  description: string;
  placementHint: string;
  inlinePlaceholder: string;
}
```

**Step 2: Add service function**

Add at the end of `services/release-notes.ts`, before the final closing (after the `deleteReleaseNotes` function):

```typescript
// ============================================================================
// Style Compliance
// ============================================================================

export async function checkCompliance(content: string): Promise<ComplianceReport> {
  try {
    const ai = await getAiCredentials();
    return await invoke<ComplianceReport>("check_release_notes_compliance", {
      content,
      apiKey: ai.apiKey,
      model: ai.model,
      provider: ai.provider,
    });
  } catch (error) {
    logger.error("Compliance check failed", { error });
    throw error;
  }
}
```

**Step 3: Add `ComplianceReport` to the import list**

In `services/release-notes.ts` line 10-18, add the new types to the import:

```typescript
import type {
  ReleaseNotesConfig,
  ReleaseNotesDraft,
  ReleaseNotesSummary,
  ReleaseNoteTicketPreview,
  JiraFixVersion,
  ReleaseNotesExportFormat,
  AiEnrichmentConfig,
  ReleaseNotesContentType,
  ComplianceReport,
} from "../types";
```

**Step 4: Verify TypeScript compiles**

Run: `cd hadron-desktop && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors.

**Step 5: Commit**

```bash
git add hadron-desktop/src/types/index.ts hadron-desktop/src/services/release-notes.ts
git commit -m "feat(release-notes): add compliance TypeScript types and service function"
```

---

### Task 4: Lift Editor Content State to ReleaseNotesView

**Files:**
- Modify: `hadron-desktop/src/components/ReleaseNotesView.tsx`
- Modify: `hadron-desktop/src/components/release-notes/ReleaseNotesEditor.tsx`

**Step 1: Add shared state to ReleaseNotesView**

In `ReleaseNotesView.tsx`, add state for editor content alongside the existing state (around line 37):

```typescript
const [editorContent, setEditorContent] = useState<string>("");
```

**Step 2: Pass props to ReleaseNotesEditor**

Change the Editor rendering (line 202-203) from:

```tsx
<ReleaseNotesEditor draftId={activeDraftId} />
```

to:

```tsx
<ReleaseNotesEditor
  draftId={activeDraftId}
  content={editorContent}
  onContentChange={setEditorContent}
/>
```

**Step 3: Update ReleaseNotesEditor props and state**

In `ReleaseNotesEditor.tsx`, update the Props interface:

```typescript
interface Props {
  draftId: number;
  content: string;
  onContentChange: (content: string) => void;
}
```

Update the component signature:

```typescript
export default function ReleaseNotesEditor({ draftId, content, onContentChange }: Props) {
```

Remove the local `content` state:

```typescript
// REMOVE: const [content, setContent] = useState("");
```

**Step 4: Replace all `setContent` calls with `onContentChange`**

In `loadDraft` (around line 67):
```typescript
// Change: setContent(data.markdownContent);
// To:
onContentChange(data.markdownContent);
```

In `handleContentChange` (around line 80):
```typescript
// Change: setContent(newContent);
// To:
onContentChange(newContent);
```

In the textarea `onChange` handler (around line 272):
```typescript
// Change: onChange={(e) => handleContentChange(e.target.value)}
// To: (no change needed — handleContentChange already calls onContentChange internally)
```

Update `handleContentChange` to use the callback instead of local state:

```typescript
const handleContentChange = useCallback(
  (newContent: string) => {
    onContentChange(newContent);
    setSaved(false);

    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
    }

    autosaveTimer.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      try {
        setSaving(true);
        await updateContent(draftId, newContent);
        if (!mountedRef.current) return;
        setActionError(null);
        setSaved(true);
        setTimeout(() => {
          if (mountedRef.current) setSaved(false);
        }, 2000);
      } catch (err) {
        if (!mountedRef.current) return;
        setActionError("Autosave failed. Please retry manual save.");
        logger.error("Autosave failed", { error: err });
      } finally {
        if (mountedRef.current) setSaving(false);
      }
    }, 1500);
  },
  [draftId, onContentChange],
);
```

Update `handleManualSave` to use `content` prop (already does — no change needed since `content` is now a prop).

**Step 5: Verify TypeScript compiles**

Run: `cd hadron-desktop && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors.

**Step 6: Commit**

```bash
git add hadron-desktop/src/components/ReleaseNotesView.tsx hadron-desktop/src/components/release-notes/ReleaseNotesEditor.tsx
git commit -m "refactor(release-notes): lift editor content state to parent for cross-tab sharing"
```

---

### Task 5: Create ReleaseNotesCompliance Component

**Files:**
- Create: `hadron-desktop/src/components/release-notes/ReleaseNotesCompliance.tsx`

**Step 1: Create the component**

```tsx
/**
 * Release Notes Compliance Checker
 * On-demand style guide validation with inline fix suggestions and screenshot placement hints.
 */

import { useState, useCallback } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  Camera,
  ChevronDown,
  ChevronUp,
  Loader2,
  Check,
  Type,
  ListChecks,
} from "lucide-react";
import Button from "../ui/Button";
import { checkCompliance } from "../../services/release-notes";
import type {
  ComplianceReport,
  TerminologyViolation,
  StructureViolation,
  ScreenshotSuggestion,
} from "../../types";
import logger from "../../services/logger";

interface Props {
  draftId: number;
  content: string;
  onContentChange: (content: string) => void;
}

export default function ReleaseNotesCompliance({ draftId, content, onContentChange }: Props) {
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedFixes, setAppliedFixes] = useState<Set<string>>(new Set());
  const [insertedScreenshots, setInsertedScreenshots] = useState<Set<string>>(new Set());

  // Collapsible sections
  const [showTerminology, setShowTerminology] = useState(true);
  const [showStructure, setShowStructure] = useState(true);
  const [showScreenshots, setShowScreenshots] = useState(true);

  const handleCheck = useCallback(async () => {
    if (!content.trim()) {
      setError("No content to check. Write or generate release notes first.");
      return;
    }
    setLoading(true);
    setError(null);
    setReport(null);
    setAppliedFixes(new Set());
    setInsertedScreenshots(new Set());

    try {
      const result = await checkCompliance(content);
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      logger.error("Compliance check failed", { error: err });
    } finally {
      setLoading(false);
    }
  }, [content]);

  const handleApplyFix = useCallback(
    (violation: TerminologyViolation | StructureViolation, key: string) => {
      const searchText = "lineContext" in violation ? violation.lineContext : violation.section;
      if (!searchText) return;

      const idx = content.indexOf(searchText);
      if (idx === -1) {
        // Fallback: try to find a shorter substring
        logger.warn("Could not find violation context in content", { searchText });
        return;
      }

      const updated = content.slice(0, idx) + violation.suggestedFix + content.slice(idx + searchText.length);
      onContentChange(updated);
      setAppliedFixes((prev) => new Set(prev).add(key));
    },
    [content, onContentChange],
  );

  const handleInsertScreenshot = useCallback(
    (suggestion: ScreenshotSuggestion, key: string) => {
      const placeholder = `\n\n${suggestion.inlinePlaceholder}\n`;

      // Try to find the ticket reference to insert after
      const ticketPattern = new RegExp(`\\(${suggestion.ticketKey.replace(/[-]/g, "\\-")}\\)`);
      const match = content.match(ticketPattern);

      let updated: string;
      if (match && match.index !== undefined) {
        // Insert after the paragraph containing the ticket reference
        const afterRef = match.index + match[0].length;
        const nextNewline = content.indexOf("\n", afterRef);
        const insertPos = nextNewline !== -1 ? nextNewline : afterRef;
        updated = content.slice(0, insertPos) + placeholder + content.slice(insertPos);
      } else {
        // Fallback: append at the end
        updated = content + placeholder;
      }

      onContentChange(updated);
      setInsertedScreenshots((prev) => new Set(prev).add(key));
    },
    [content, onContentChange],
  );

  const scoreColor = (score: number) => {
    if (score >= 80) return "text-green-400";
    if (score >= 50) return "text-amber-400";
    return "text-red-400";
  };

  const scoreBarColor = (score: number) => {
    if (score >= 80) return "bg-green-400";
    if (score >= 50) return "bg-amber-400";
    return "bg-red-400";
  };

  return (
    <div className="space-y-4">
      {/* Check Button */}
      <div className="flex items-center justify-between">
        <Button
          variant="primary"
          onClick={handleCheck}
          disabled={loading || !content.trim()}
          icon={loading ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
        >
          {loading ? "Checking..." : "Check Compliance"}
        </Button>

        {report && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">
              {report.tokensUsed} tokens | ${report.cost.toFixed(4)}
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Empty State */}
      {!report && !loading && !error && (
        <div className="text-center py-12 text-gray-500">
          <ShieldCheck className="w-8 h-8 mx-auto mb-3 text-gray-600" />
          <p className="text-sm">
            Run a compliance check to validate your draft against the WHATS'ON style guide.
          </p>
        </div>
      )}

      {/* Report */}
      {report && (
        <div className="space-y-4">
          {/* Score */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-300">Compliance Score</span>
              <span className={`text-lg font-bold ${scoreColor(report.score)}`}>
                {Math.round(report.score)}/100
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${scoreBarColor(report.score)}`}
                style={{ width: `${Math.min(report.score, 100)}%` }}
              />
            </div>
          </div>

          {/* Terminology Violations */}
          <ComplianceSection
            title="Terminology"
            icon={<Type className="w-4 h-4" />}
            count={report.terminologyViolations.length}
            open={showTerminology}
            onToggle={() => setShowTerminology(!showTerminology)}
          >
            {report.terminologyViolations.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No terminology violations found.</p>
            ) : (
              report.terminologyViolations.map((v, i) => {
                const key = `term-${i}`;
                const applied = appliedFixes.has(key);
                return (
                  <ViolationCard
                    key={key}
                    icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
                    context={v.lineContext}
                    violation={v.violation}
                    suggestedFix={v.suggestedFix}
                    ruleRef={v.ruleReference}
                    applied={applied}
                    onApply={() => handleApplyFix(v, key)}
                  />
                );
              })
            )}
          </ComplianceSection>

          {/* Structure Violations */}
          <ComplianceSection
            title="Structure"
            icon={<ListChecks className="w-4 h-4" />}
            count={report.structureViolations.length}
            open={showStructure}
            onToggle={() => setShowStructure(!showStructure)}
          >
            {report.structureViolations.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No structure violations found.</p>
            ) : (
              report.structureViolations.map((v, i) => {
                const key = `struct-${i}`;
                const applied = appliedFixes.has(key);
                return (
                  <ViolationCard
                    key={key}
                    icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
                    context={v.section}
                    violation={v.violation}
                    suggestedFix={v.suggestedFix}
                    ruleRef={v.ruleReference}
                    applied={applied}
                    onApply={() => handleApplyFix(v, key)}
                  />
                );
              })
            )}
          </ComplianceSection>

          {/* Screenshot Suggestions */}
          <ComplianceSection
            title="Screenshots"
            icon={<Camera className="w-4 h-4" />}
            count={report.screenshotSuggestions.length}
            open={showScreenshots}
            onToggle={() => setShowScreenshots(!showScreenshots)}
          >
            {report.screenshotSuggestions.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No screenshot suggestions.</p>
            ) : (
              report.screenshotSuggestions.map((s, i) => {
                const key = `screen-${i}`;
                const inserted = insertedScreenshots.has(key);
                return (
                  <div
                    key={key}
                    className={`border border-gray-700 rounded-lg p-3 space-y-2 ${inserted ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <Camera className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="text-xs font-mono text-amber-400">{s.ticketKey}</span>
                          <p className="text-sm text-gray-300 mt-0.5">{s.description}</p>
                          <p className="text-xs text-gray-500 mt-1">{s.placementHint}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleInsertScreenshot(s, key)}
                        disabled={inserted}
                        className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap transition-colors"
                      >
                        {inserted ? "Inserted" : "Insert Placeholder"}
                      </button>
                    </div>
                    <div className="bg-gray-900 rounded px-2 py-1 text-xs font-mono text-gray-400">
                      {s.inlinePlaceholder}
                    </div>
                  </div>
                );
              })
            )}
          </ComplianceSection>
        </div>
      )}
    </div>
  );
}

/** Collapsible section wrapper */
function ComplianceSection({
  title,
  icon,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-gray-300">{title}</span>
          <span
            className={`text-xs px-1.5 py-0.5 rounded-full ${
              count === 0
                ? "bg-green-500/20 text-green-400"
                : "bg-amber-500/20 text-amber-400"
            }`}
          >
            {count}
          </span>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        )}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

/** Individual violation card with apply-fix button */
function ViolationCard({
  icon,
  context,
  violation,
  suggestedFix,
  ruleRef,
  applied,
  onApply,
}: {
  icon: React.ReactNode;
  context: string;
  violation: string;
  suggestedFix: string;
  ruleRef: string;
  applied: boolean;
  onApply: () => void;
}) {
  return (
    <div className={`border border-gray-700 rounded-lg p-3 space-y-2 ${applied ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {icon}
          <div>
            <p className="text-sm text-gray-300">{violation}</p>
            <p className="text-xs text-gray-500 mt-0.5">{ruleRef}</p>
          </div>
        </div>
        <button
          onClick={onApply}
          disabled={applied}
          className="text-xs px-2 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap transition-colors"
        >
          {applied ? (
            <span className="flex items-center gap-1">
              <Check className="w-3 h-3" /> Applied
            </span>
          ) : (
            "Apply Fix"
          )}
        </button>
      </div>
      {!applied && (
        <>
          <div className="bg-red-500/5 border border-red-500/20 rounded px-2 py-1 text-xs font-mono text-red-400 line-through">
            {context}
          </div>
          <div className="bg-green-500/5 border border-green-500/20 rounded px-2 py-1 text-xs font-mono text-green-400">
            {suggestedFix}
          </div>
        </>
      )}
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd hadron-desktop && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors.

**Step 3: Commit**

```bash
git add hadron-desktop/src/components/release-notes/ReleaseNotesCompliance.tsx
git commit -m "feat(release-notes): add ReleaseNotesCompliance component with apply-fix and screenshot placeholders"
```

---

### Task 6: Wire Compliance Tab into ReleaseNotesView

**Files:**
- Modify: `hadron-desktop/src/components/ReleaseNotesView.tsx`

**Step 1: Import the new component**

Add to the imports (after the other release-notes imports around line 18):

```typescript
import ReleaseNotesCompliance from "./release-notes/ReleaseNotesCompliance";
```

**Step 2: Update the ReviewSubTab type**

Change:

```typescript
type ReviewSubTab = "editor" | "checklist" | "insights";
```

to:

```typescript
type ReviewSubTab = "editor" | "checklist" | "insights" | "compliance";
```

**Step 3: Add the Compliance sub-tab button**

In the sub-tabs array (around line 183), add the 4th entry:

```tsx
{([
  { id: "editor" as const, label: "Editor" },
  { id: "checklist" as const, label: "Checklist" },
  { id: "insights" as const, label: "Insights" },
  { id: "compliance" as const, label: "Compliance" },
]).map((sub) => (
```

**Step 4: Render the Compliance component**

After the Insights rendering (around line 210), add:

```tsx
{reviewSubTab === "compliance" && (
  <ReleaseNotesCompliance
    draftId={activeDraftId}
    content={editorContent}
    onContentChange={setEditorContent}
  />
)}
```

**Step 5: Verify TypeScript compiles**

Run: `cd hadron-desktop && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors.

**Step 6: Verify both Rust and TypeScript compile together**

Run: `cd hadron-desktop/src-tauri && cargo check 2>&1 | tail -5`
Expected: Compiles with no new errors.

**Step 7: Commit**

```bash
git add hadron-desktop/src/components/ReleaseNotesView.tsx
git commit -m "feat(release-notes): wire Compliance tab into review sub-tabs"
```

---

### Task 7: Final Verification and Version Note

**Step 1: Run full TypeScript build**

Run: `cd hadron-desktop && npx tsc --noEmit`
Expected: No errors.

**Step 2: Run Rust check**

Run: `cd hadron-desktop/src-tauri && cargo check 2>&1 | tail -5`
Expected: Compiles (existing warnings only).

**Step 3: Commit any remaining adjustments**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix(release-notes): address build issues from compliance feature"
```
