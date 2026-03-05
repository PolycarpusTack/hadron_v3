# Code Analyzer Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Resolve all 9 findings from the Code Analyzer evaluation in order of risk — without regressions,
with a review gate and a research pause after each completed finding.

**Architecture:** Findings are batched into 4 phases by blast radius. Phase 1 covers all pure-TypeScript
frontend fixes (zero Rust rebuilds). Phase 2 fixes the core architectural flaw (double DB write). Phase 3
adds the token-budget safety net on both sides. Phase 4 refactors the monolithic component into separate
tab files. Each phase ends with a review cycle and a technical-debt check before the next begins.

**Tech Stack:** React 18 / TypeScript (frontend), Rust / Tauri 2 (backend), SQLite (database),
`parking_lot` Mutex (widget locking pattern to follow), Vitest (if present) or manual smoke tests.

---

## Glossary

| Term | Meaning in this plan |
|---|---|
| **DoR** | Definition of Ready — all prerequisites to START a task |
| **DoD** | Definition of Done — all conditions to CLOSE a task |
| **Tech-Debt Cycle** | Brief assessment: does this task add, remove, or hold debt neutral? |
| **Review Gate** | Mandatory diff-read + smoke-test before moving to next phase |
| **Research Pause** | Read one external reference and note any pattern difference from what we implemented |

---

## Phase 1 — Frontend Quick Wins (6 findings, TypeScript only)

> **Phase DoR:** `cargo check` passes on current `main`. Dev server starts (`npm run dev` in
> `hadron-desktop/`). You have read `src/components/CodeAnalyzerView.tsx` in full.

### Finding H3 — Clamp quality scores to [0, 100]

**Risk:** Low. One-line change in the parser. No Rust, no DB.

**Files:**
- Modify: `hadron-desktop/src/services/code-analysis.ts:135`

**Background:**
`parseCodeAnalysisResponse` passes `parsed.qualityScores` straight through with only a missing-object
fallback. An LLM that returns `{"overall": 150}` causes the SVG gauge's `strokeDashoffset` to go
negative, rendering a broken circle.

---

**Step 1 — Read the current parser to anchor your edit**

Open `hadron-desktop/src/services/code-analysis.ts`, lines 87–138. Note the `DEFAULT_SCORES` constant
and the final `return { ... qualityScores: parsed.qualityScores || DEFAULT_SCORES }` line.

---

**Step 2 — Add a `clampScores` helper just above `parseCodeAnalysisResponse`**

```typescript
function clampScores(raw: unknown): CodeQualityScores {
  const defaults = { overall: 50, security: 50, performance: 50, maintainability: 50, bestPractices: 50 };
  if (!raw || typeof raw !== "object") return defaults;
  const r = raw as Record<string, unknown>;
  const clamp = (v: unknown) => Math.max(0, Math.min(100, Number(v) || 50));
  return {
    overall:        clamp(r.overall),
    security:       clamp(r.security),
    performance:    clamp(r.performance),
    maintainability: clamp(r.maintainability),
    bestPractices:  clamp(r.bestPractices),
  };
}
```

Insert this immediately before the `export function parseCodeAnalysisResponse` line (~line 95).

---

**Step 3 — Replace the unclamped assignment**

Find:
```typescript
    qualityScores: parsed.qualityScores || DEFAULT_SCORES,
```
Replace with:
```typescript
    qualityScores: clampScores(parsed.qualityScores),
```

The `DEFAULT_SCORES` constant above is now only used as fallback documentation — you may keep it or remove it. Keep it; it documents intent.

---

**Step 4 — Smoke test**

In the browser dev console, manually call:
```javascript
// Open browser devtools → Console while app is running
// Paste a fake response through the analyzer, then check:
// result.qualityScores values should all be in [0,100]
```

Or verify in code: `clampScores({ overall: 150, security: -5 })` should return `{ overall: 100, security: 0, ... }`.

---

**Step 5 — Commit**

```bash
git add hadron-desktop/src/services/code-analysis.ts
git commit -m "fix(code-analyzer): clamp qualityScores to [0,100] to prevent broken SVG gauges"
```

**DoD — H3:**
- [ ] `clampScores` helper exists and handles non-numeric, missing, and out-of-range values
- [ ] `parseCodeAnalysisResponse` uses `clampScores` instead of bare passthrough
- [ ] `DEFAULT_SCORES` constant retained as documentation

**Tech-Debt Cycle — H3:** Removes debt. The unclamped passthrough was a latent rendering bug waiting for
a hallucinating model.

---

### Finding M6 — Language dropdown missing entries

**Risk:** Trivial. Two HTML `<option>` additions.

**Files:**
- Modify: `hadron-desktop/src/components/CodeAnalyzerView.tsx` (the `<select>` inside the main component)

**Background:**
`LANGUAGE_EXTENSIONS` at line 50 maps 18 extensions including Java, Ruby, HTML, CSS, JSON, YAML,
Markdown. The manual `<select>` dropdown at line ~965 only lists 10, omitting those 8. Auto-detect covers
them via extension, but a user pasting code without a filename cannot manually override to e.g. Ruby.

---

**Step 1 — Find the select block**

Search for `<option>Auto-detect</option>` in `CodeAnalyzerView.tsx`. The full `<select>` block is ~15
lines below the language label.

---

**Step 2 — Replace the select options**

Current:
```tsx
<option>Auto-detect</option>
<option>SQL</option>
<option>React</option>
<option>TypeScript</option>
<option>JavaScript</option>
<option>Smalltalk</option>
<option>Python</option>
<option>Rust</option>
<option>Go</option>
<option>XML</option>
<option>Plaintext</option>
```

Replace with (alphabetical after Auto-detect, matching `LANGUAGE_EXTENSIONS` values exactly):
```tsx
<option>Auto-detect</option>
<option>CSS</option>
<option>Go</option>
<option>HTML</option>
<option>Java</option>
<option>JavaScript</option>
<option>JSON</option>
<option>Markdown</option>
<option>Python</option>
<option>React</option>
<option>Ruby</option>
<option>Rust</option>
<option>Smalltalk</option>
<option>SQL</option>
<option>TypeScript</option>
<option>XML</option>
<option>YAML</option>
<option>Plaintext</option>
```

---

**Step 3 — Verify parity with LANGUAGE_EXTENSIONS**

Scan `LANGUAGE_EXTENSIONS` values: SQL, React, TypeScript, JavaScript, Smalltalk, Python, Rust, Go, Java,
XML, HTML, CSS, JSON, YAML, Markdown, Ruby. All 16 distinct values should now appear in the dropdown.

---

**Step 4 — Commit**

```bash
git add hadron-desktop/src/components/CodeAnalyzerView.tsx
git commit -m "fix(code-analyzer): add missing languages to manual override dropdown"
```

**DoD — M6:**
- [ ] Every value in `LANGUAGE_EXTENSIONS` appears as a `<option>` in the select
- [ ] Options are sorted alphabetically (Auto-detect first, Plaintext last)

**Tech-Debt Cycle — M6:** Removes debt. The mismatch between the map and the dropdown was a feature-gap
that would have required a two-place update for every new language added.

---

### Finding L8 — Frontend file size warning before analysis

**Risk:** Low. Adds a guard on the existing `handleDrop` and `handleFileSelect` paths.

**Files:**
- Modify: `hadron-desktop/src/components/CodeAnalyzerView.tsx`

**Background:**
`handleFileSelect` and `handleDrop` read any file with `FileReader.readAsText()`. A user dragging a
compiled binary or a 10 MB log file will produce garbled text that burns tokens and hits the 1 MB Rust
guard with a confusing error message. A 200 KB warning threshold (chosen to stay well under the Rust 1 MB
cap while matching typical source file sizes) gives the user a chance to reconsider.

---

**Step 1 — Add the constant at the top of the component file**

After the imports, before `LANGUAGE_EXTENSIONS`, add:
```typescript
const MAX_FILE_SIZE_BYTES = 200_000; // ~200 KB — warn before hitting Rust's 1 MB hard cap
```

---

**Step 2 — Add a size check helper**

Directly below the constant:
```typescript
function warnIfLargeFile(file: File): boolean {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    // Using native alert is acceptable here — this is a rare destructive-path warning
    return window.confirm(
      `"${file.name}" is ${(file.size / 1024).toFixed(0)} KB. ` +
      `Large files may exceed AI context limits and produce incomplete results. ` +
      `Continue anyway?`
    );
  }
  return true;
}
```

---

**Step 3 — Gate handleFileSelect**

Find `handleFileSelect`:
```typescript
const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
```

Add the guard immediately after `if (file) {`:
```typescript
    if (file) {
      if (!warnIfLargeFile(file)) return;
```

---

**Step 4 — Gate handleDrop**

Find `handleDrop`:
```typescript
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
```

Add the guard immediately after `if (file) {`:
```typescript
    if (file) {
      if (!warnIfLargeFile(file)) return;
```

---

**Step 5 — Commit**

```bash
git add hadron-desktop/src/components/CodeAnalyzerView.tsx
git commit -m "fix(code-analyzer): warn user before loading files larger than 200 KB"
```

**DoD — L8:**
- [ ] Files ≤ 200 KB load silently
- [ ] Files > 200 KB show a confirmation dialog with file size
- [ ] Cancelling the dialog leaves the textarea unchanged
- [ ] Guard applies to both drag-drop and file-browse paths

**Tech-Debt Cycle — L8:** Removes debt. The missing guard was a UX footgun for any user working with
generated code or minified files.

---

### Finding M4 — Remove fake improvement badges from Optimized tab

**Risk:** Low. UI-only change, no data model impact.

**Files:**
- Modify: `hadron-desktop/src/components/CodeAnalyzerView.tsx` (`OptimizedTab` component)

**Background:**
`OptimizedTab` hardcodes three "Improvements Applied" chip badges (Security, Performance, Best Practices)
regardless of what was actually changed. This is actively misleading — if the AI only renamed a variable,
it still claims security and performance improvements. The badges should either be removed or derived from
the actual issue categories that were present in the analysis.

**Decision:** Remove the static badge section entirely. The optimized code speaks for itself; the Issues
tab already tells the user what was wrong.

---

**Step 1 — Locate the badges block in OptimizedTab**

Search for `Improvements Applied` in `CodeAnalyzerView.tsx`. The block is:
```tsx
{/* Improvements Made */}
<div className="bg-green-50 ...">
  <h3 ...>Improvements Applied</h3>
  <div className="flex flex-wrap gap-2">
    <span ...><Shield .../> Security</span>
    <span ...><Zap .../> Performance</span>
    <span ...><Check .../> Best Practices</span>
  </div>
</div>
```

---

**Step 2 — Delete the entire "Improvements Made" block**

Remove the `{/* Improvements Made */}` div and its contents. The `return` of `OptimizedTab` should now
open directly with the `{/* Optimized Code */}` block (the dark `bg-gray-900` div).

---

**Step 3 — Remove now-unused imports if applicable**

Check whether `Shield` and `Zap` from `lucide-react` are still used elsewhere in the file.
- `Shield` is used in `OverviewTab` (Critical Issues header) → keep
- `Zap` — search for other uses. If none, remove from the import line at the top.

---

**Step 4 — Commit**

```bash
git add hadron-desktop/src/components/CodeAnalyzerView.tsx
git commit -m "fix(code-analyzer): remove hardcoded improvement badges from Optimized tab"
```

**DoD — M4:**
- [ ] `OptimizedTab` no longer renders the static badges section
- [ ] No unused imports remain
- [ ] The optimized code block renders correctly when `code` is not null
- [ ] The "no optimized code available" fallback still renders when `code` is null

**Tech-Debt Cycle — M4:** Removes debt. The hardcoded UI was technically a lie that eroded trust in the
feature.

---

### Finding M5 — highlightIssueId does not reset on re-click

**Risk:** Low. State management fix in `CodeAnalyzerView`, no backend impact.

**Files:**
- Modify: `hadron-desktop/src/components/CodeAnalyzerView.tsx`

**Background:**
`navigateToIssue(id)` calls `setHighlightIssueId(id)` then `onTabChange("issues")`. If you click the
same critical issue twice, the second click is a no-op — React bails on the `setState` because the value
didn't change, so `IssuesTab` never re-expands. The fix is to briefly reset to `undefined` before setting
the new value, forcing React to see a state change.

Additionally, `IssuesTab` initialises `expanded` with `highlightIssueId` only in `useState` initial
state, meaning subsequent changes to `highlightIssueId` are ignored after mount. `IssuesTab` needs a
`useEffect` to react to prop changes.

---

**Step 1 — Fix `navigateToIssue` in the main component (lines ~827)**

Find:
```typescript
const navigateToIssue = (issueId: number) => {
    setHighlightIssueId(issueId);
    onTabChange("issues");
  };
```

Replace with:
```typescript
const navigateToIssue = (issueId: number) => {
    // Reset first so the same ID re-triggers IssuesTab's useEffect
    setHighlightIssueId(undefined);
    requestAnimationFrame(() => {
      setHighlightIssueId(issueId);
      onTabChange("issues");
    });
  };
```

---

**Step 2 — Add `useEffect` to `IssuesTab` to react to prop changes**

`IssuesTab` currently uses `highlightIssueId` only in `useState` initialiser (line ~463):
```typescript
const [expanded, setExpanded] = useState<Set<number>>(new Set(highlightIssueId ? [highlightIssueId] : []));
```

Add a `useEffect` immediately after that line:
```typescript
useEffect(() => {
    if (highlightIssueId !== undefined) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(highlightIssueId);
        return next;
      });
    }
  }, [highlightIssueId]);
```

`useEffect` is already imported at the top of the file (line 1).

---

**Step 3 — Verify: scroll-to-issue (optional enhancement)**

If you want the highlighted issue to scroll into view, add a `ref` map approach:
```typescript
const issueRefs = useRef<Record<number, HTMLDivElement | null>>({});
// on each issue card:
ref={(el) => { issueRefs.current[issue.id] = el; }}
// in the useEffect:
setTimeout(() => issueRefs.current[highlightIssueId]?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
```
This is optional — implement only if the panel is tall enough to need scrolling.

---

**Step 4 — Commit**

```bash
git add hadron-desktop/src/components/CodeAnalyzerView.tsx
git commit -m "fix(code-analyzer): highlight issue re-triggers correctly on repeated navigation"
```

**DoD — M5:**
- [ ] Clicking the same critical issue in Overview twice navigates to and expands it in Issues both times
- [ ] `IssuesTab` reacts to `highlightIssueId` prop changes (not just initial mount)
- [ ] No infinite loop (the `useEffect` dep array only contains `highlightIssueId`)

**Tech-Debt Cycle — M5:** Removes debt. The stale-closure-style initialiser-only state was a subtle
React anti-pattern.

---

### Finding L9 — Keeper API key flow is opaque

**Risk:** Minimal. Documentation + sentinel value only.

**Files:**
- Modify: `hadron-desktop/src/services/code-analysis.ts` (comment clarification)
- Modify: `hadron-desktop/src/services/api.ts` (comment at `translateTechnicalContent`)

**Background:**
When Keeper is active, `apiKey = ""` and the empty string is passed all the way to the Rust backend.
The resolution happens inside the Python translation layer which reads the Keeper UID from a separate
channel. This works, but looks like a bug to any reader. A comment explaining the contract is sufficient
— no code change needed.

---

**Step 1 — Add an explanatory comment in `analyzeCode`**

In `code-analysis.ts`, find:
```typescript
  let apiKey = "";
  if (!keeperSecretUid) {
    apiKey = (await getApiKey(provider)) || "";
```

Replace with:
```typescript
  // When Keeper is active, keeperSecretUid is passed separately through the
  // Tauri command chain to the Python layer, which resolves it independently.
  // apiKey is intentionally left "" in that case — the backend ignores it.
  let apiKey = "";
  if (!keeperSecretUid) {
    apiKey = (await getApiKey(provider)) || "";
```

---

**Step 2 — Add a matching comment in `translateTechnicalContent` in api.ts**

Find the call:
```typescript
export async function translateTechnicalContent(
  content: string,
  apiKey: string,
  ...
```

Add above it:
```typescript
// NOTE: apiKey may be "" when Keeper secrets management is active.
// The Rust backend / Python layer resolves the key from the Keeper UID stored
// in secure settings. Callers must still pass apiKey="" (not undefined) to
// satisfy the Tauri command schema.
```

---

**Step 3 — Commit**

```bash
git add hadron-desktop/src/services/code-analysis.ts hadron-desktop/src/services/api.ts
git commit -m "docs(code-analyzer): clarify Keeper API key empty-string contract"
```

**DoD — L9:**
- [ ] Both call-sites have comments explaining the empty-string contract
- [ ] No runtime behaviour changed

**Tech-Debt Cycle — L9:** Neutral. Converts implicit knowledge into explicit documentation.

---

## Phase 1 — Review Gate

**Before moving to Phase 2, complete all of the following:**

1. **Diff review:** Run `git log --oneline` — you should see 6 commits from this phase. Run
   `git diff main..HEAD -- hadron-desktop/src/` and read every line changed. Check for:
   - No accidental deletions of working logic
   - No duplicate `useEffect` or `useState` calls introduced
   - No broken imports

2. **Smoke test (manual):** Start the dev server. Open Code Analyzer. Submit a small snippet.
   Verify: quality gauges render, Issues tab highlights work, Optimized tab has no fake badges,
   all dropdown languages appear.

3. **Research Pause — React `useEffect` and state reset patterns:**
   Read: https://react.dev/learn/synchronizing-with-effects#fetching-data
   Question to answer: *Is the `requestAnimationFrame` + double-setState in `navigateToIssue`
   the idiomatic React approach, or should we use a key-based reset instead?*
   Note your finding in a comment next to the code if the pattern should change.

4. **Technical Debt Log entry:** Open (or create) `docs/tech-debt.md` and add:

   ```markdown
   ## [Resolved] Code Analyzer Phase 1 — 2026-03-03
   - H3: qualityScores clamping ✓
   - M4: fake badges removed ✓
   - M5: highlight re-trigger fixed ✓
   - M6: dropdown parity ✓
   - L8: file size guard ✓
   - L9: Keeper contract documented ✓
   Remaining: H1 (DB architecture), H2 (token budget), L7 (component split)
   ```

---

## Phase 2 — Architectural Fix: Eliminate Double DB Write (H1)

> **Phase DoR:**
> - Phase 1 review gate is complete
> - You have read `hadron-desktop/src-tauri/src/commands_legacy.rs` lines 1679–1770 (`translate_content`)
>   and lines 1788–1840 (`save_external_analysis`)
> - You have read `hadron-desktop/src-tauri/src/ai_service.rs` in full
> - You understand the `CommandResult<T>` / `HadronError` error-handling pattern used in new commands

**Problem restated:**
`analyzeCode()` calls `translateTechnicalContent()` → Rust `translate_content` command, which:
1. Calls the AI
2. Saves the full prompt + raw JSON to the **translations** table (wrong table)
3. Returns the raw JSON string

Then `analyzeCode()` separately calls `save_external_analysis` which saves the *parsed* result to the
**analyses** table (correct table).

So every code review produces two DB rows — one in the wrong table, one correct. The translations list in
the UI shows raw AI prompts as if they were translations.

**Solution:**
Add a new Rust command `call_ai` that does only step 1 (calls the AI, returns the response) without any
DB persistence. Code analysis uses `call_ai`. The `translate_content` command stays untouched for the
actual Translation feature.

---

### Task 2.1 — Add `call_ai` Tauri command in Rust

**Files:**
- Modify: `hadron-desktop/src-tauri/src/commands_legacy.rs` (new command near `translate_content`)
- Modify: `hadron-desktop/src-tauri/src/main.rs` (register the new command)

**Step 1 — Read the existing `translate_content` command (lines 1679–1770)**

You are deriving `call_ai` from it. The key difference: omit the DB save block (lines ~1736–1764).

---

**Step 2 — Add the `call_ai` command**

Find the end of `translate_content` (the closing `}` around line 1770). Immediately after it, add:

```rust
/// Call the AI and return the raw response, without persisting to the database.
/// Used by features (Code Analyzer, future tools) that handle their own persistence
/// via save_external_analysis or equivalent.
#[tauri::command]
pub async fn call_ai(
    content: String,
    api_key: String,
    model: String,
    provider: String,
    redact_pii: Option<bool>,
) -> CommandResult<String> {
    log::debug!("cmd: call_ai");
    let api_key = Zeroizing::new(api_key);

    if content.len() > MAX_TRANSLATION_CONTENT_SIZE {
        return Err(HadronError::Validation(format!(
            "Content too large: {} bytes exceeds maximum of {} bytes",
            content.len(),
            MAX_TRANSLATION_CONTENT_SIZE
        )));
    }

    let content_for_ai: Cow<'_, str> = if redact_pii.unwrap_or(false) {
        redact_pii_basic(&content)
    } else {
        Cow::Borrowed(&content)
    };

    let response = if provider.to_lowercase() == "llamacpp" {
        translate_llamacpp(&content_for_ai, &model)
            .await
            .map_err(|e| HadronError::External(format!("llama.cpp call failed: {}", e)))?
    } else {
        run_python_translation(&content_for_ai, api_key.as_str(), &model, &provider)
            .await
            .map_err(|e| HadronError::External(format!("AI call failed: {}", e)))?
            .translation
    };

    log::info!("call_ai completed: provider={}", provider);
    Ok(response)
}
```

**Note:** `CommandResult<T>` and `HadronError` are already in scope via `use crate::error::*` at the
top of the file. `Zeroizing`, `Cow`, `translate_llamacpp`, `run_python_translation`, and
`MAX_TRANSLATION_CONTENT_SIZE` are all already imported.

---

**Step 3 — Register `call_ai` in main.rs**

In `hadron-desktop/src-tauri/src/main.rs`, find the `invoke_handler!` block. Locate the Widget section
at the bottom (lines ~373–382). Add `call_ai` to the handler list near `translate_content`:

```rust
// Near translate_content in the invoke_handler! list:
translate_content,
call_ai,              // ← add this line
save_external_analysis,
```

---

**Step 4 — Verify it compiles**

```bash
cargo check --manifest-path hadron-desktop/src-tauri/Cargo.toml 2>&1 | grep -E "^error"
```

Expected: no output (no errors). If there are errors, they will name the missing import or type.

---

**Step 5 — Commit (Rust only)**

```bash
git add hadron-desktop/src-tauri/src/commands_legacy.rs hadron-desktop/src-tauri/src/main.rs
git commit -m "feat(backend): add call_ai command — AI call without DB persistence"
```

---

### Task 2.2 — Wire TypeScript to use `call_ai`

**Files:**
- Modify: `hadron-desktop/src/services/api.ts`
- Modify: `hadron-desktop/src/services/code-analysis.ts`

**Step 1 — Add `callAi` function to api.ts**

In `api.ts`, find `translateTechnicalContent`. Immediately after its closing `}`, add:

```typescript
/**
 * Call the AI without persisting to the translations table.
 * Use this for Code Analyzer and other features that persist via save_external_analysis.
 */
export async function callAi(
  content: string,
  apiKey: string,
  model: string,
  provider: string,
): Promise<string> {
  const redactPii = localStorage.getItem("hadron-redact-pii") === "true";
  return invoke<string>("call_ai", { content, apiKey, model, provider, redactPii });
}
```

---

**Step 2 — Update `code-analysis.ts` to import and use `callAi`**

In `code-analysis.ts` line 8, change:
```typescript
import { translateTechnicalContent, getStoredModel, getStoredProvider, saveExternalAnalysis } from "./api";
```
to:
```typescript
import { callAi, getStoredModel, getStoredProvider, saveExternalAnalysis } from "./api";
```

Then in `analyzeCode` (line ~172), change:
```typescript
const response = await translateTechnicalContent(prompt, apiKey, model, provider);
```
to:
```typescript
const response = await callAi(prompt, apiKey, model, provider);
```

---

**Step 3 — Verify `translateTechnicalContent` is still used elsewhere**

```bash
grep -rn "translateTechnicalContent" hadron-desktop/src/
```

If any other feature still uses it (e.g. the Translate view), leave the function in `api.ts`. If
`code-analysis.ts` was the only caller, it can stay for now (it serves the translation feature itself).

---

**Step 4 — Smoke test**

Run the dev server. Submit a code snippet in Code Analyzer. Then open the Translations history view.
Confirm the code analysis does **not** appear there.

---

**Step 5 — Commit**

```bash
git add hadron-desktop/src/services/api.ts hadron-desktop/src/services/code-analysis.ts
git commit -m "fix(code-analyzer): use call_ai to stop polluting translation history with code reviews"
```

**DoD — H1:**
- [ ] `call_ai` Rust command exists, compiles, and skips DB persistence
- [ ] `code-analysis.ts` imports and calls `callAi`, not `translateTechnicalContent`
- [ ] A code analysis does not produce a row in the `translations` table
- [ ] The Translation feature's own `translate_content` command is unmodified
- [ ] `translateTechnicalContent` in `api.ts` still exists for the Translation view

**Tech-Debt Cycle — H1:** Large debt removal. The architectural mismatch was causing data pollution and
making the code analysis flow impossible to reason about in isolation.

---

## Phase 2 — Review Gate

1. **Diff review:** `git diff main..HEAD -- hadron-desktop/src-tauri/` — confirm `call_ai` is the only
   new symbol; `translate_content` is byte-for-byte unchanged.

2. **Regression test:** Submit a translation (the Translate view) — confirm it still appears in
   translation history. Submit a code analysis — confirm it does NOT appear in translation history.
   Confirm the code analysis still appears in the Analyses / History view.

3. **Research Pause — Tauri command design:**
   Read: https://tauri.app/develop/calling-rust/
   Question: *Should `call_ai` accept a `language` hint to allow future provider routing by language
   (e.g. routing Smalltalk to a specialised model)?* Note your finding; no code change required now
   (YAGNI unless needed).

4. **Technical Debt Log:** Update `docs/tech-debt.md`:
   ```markdown
   ## [Resolved] Code Analyzer Phase 2 — 2026-03-03
   - H1: double DB write eliminated ✓ (new call_ai command)
   Remaining: H2 (token budget), L7 (component split)
   ```

---

## Phase 3 — Token Budget Safety Net (H2)

> **Phase DoR:**
> - Phase 2 review gate is complete
> - You know the model context windows: GPT-4 Turbo = 128K tokens; Claude 3 = 200K tokens;
>   llama.cpp = model-dependent, typically 4K–32K
> - Rule of thumb: 1 token ≈ 4 characters for English/code mixed content

**Problem restated:**
The Rust backend checks `content.len() > 1_048_576` (1 MB). At ~4 chars/token, 1 MB ≈ 250K tokens.
GPT-4 Turbo's 128K limit means a ~500 KB prompt (including the code + prompt wrapper) will fail at the
API with a raw HTTP 400 error. This surfaces to the user as a generic "Translation failed" string.

**Solution:**
- Frontend: warn at 50 KB of raw code (≈ 12K tokens of code + prompt overhead ≈ safe margin)
- Backend (`call_ai`): add a token-estimate check and return a `HadronError::Validation` with a clear
  message before attempting the API call

---

### Task 3.1 — Frontend token estimate warning

**Files:**
- Modify: `hadron-desktop/src/components/CodeAnalyzerView.tsx`

**Step 1 — Add a constant near `MAX_FILE_SIZE_BYTES`**

```typescript
const SOFT_TOKEN_WARN_BYTES = 50_000; // ~12K tokens; warn before hitting model context limits
```

---

**Step 2 — Add a check in `handleAnalyze`**

Find `handleAnalyze` (line ~840):
```typescript
const handleAnalyze = async () => {
    if (!input.trim()) return;
```

Add after the empty-check:
```typescript
    if (input.length > SOFT_TOKEN_WARN_BYTES) {
      const proceed = window.confirm(
        `This code is ${(input.length / 1024).toFixed(0)} KB (~${Math.round(input.length / 4).toLocaleString()} tokens). ` +
        `It may exceed your AI model's context limit. Proceed anyway?`
      );
      if (!proceed) return;
    }
```

---

**Step 3 — Commit (frontend only)**

```bash
git add hadron-desktop/src/components/CodeAnalyzerView.tsx
git commit -m "fix(code-analyzer): warn before submitting code exceeding soft token limit (~12K tokens)"
```

---

### Task 3.2 — Backend token estimate in `call_ai`

**Files:**
- Modify: `hadron-desktop/src-tauri/src/commands_legacy.rs` (`call_ai` command)

**Background:**
The `call_ai` command already checks for 1 MB. Add a second check that estimates token count and returns
a clear validation error if it likely exceeds the provider's limit.

**Step 1 — Add a constant near `MAX_TRANSLATION_CONTENT_SIZE`**

Find where `MAX_TRANSLATION_CONTENT_SIZE` is defined (near the top of `commands_legacy.rs`). Add:
```rust
/// Soft limit: ~128K tokens at 4 chars/token. Exceeding this will fail most cloud models.
const MAX_AI_CONTENT_TOKENS_ESTIMATE: usize = 512_000; // 128K tokens × 4 chars
```

---

**Step 2 — Add the check in `call_ai` after the existing size check**

```rust
    // Estimate token count (4 chars ≈ 1 token for code/English mixed content)
    let estimated_tokens = content.len() / 4;
    if estimated_tokens > MAX_AI_CONTENT_TOKENS_ESTIMATE / 4 {
        return Err(HadronError::Validation(format!(
            "Content is approximately {:,} tokens, which likely exceeds your AI model's context limit (128K). \
             Please reduce the code size and try again.",
            estimated_tokens
        )));
    }
```

---

**Step 3 — Verify compile**

```bash
cargo check --manifest-path hadron-desktop/src-tauri/Cargo.toml 2>&1 | grep "^error"
```

---

**Step 4 — Commit**

```bash
git add hadron-desktop/src-tauri/src/commands_legacy.rs
git commit -m "fix(backend): add token-estimate guard in call_ai before hitting AI API"
```

**DoD — H2:**
- [ ] Frontend warns at >50 KB of code input (paste and file paths)
- [ ] Backend returns a clear `HadronError::Validation` with estimated token count when content > 128K token estimate
- [ ] The validation message is user-friendly (no raw HTTP errors visible)
- [ ] `translate_content` is unchanged (it has its own 1 MB check)

**Tech-Debt Cycle — H2:** Removes debt. Latent token-overflow failures become explicit, early warnings.

---

## Phase 3 — Review Gate

1. **Diff review:** Confirm the check in `call_ai` fires before the AI call, not after.

2. **Test large input:** Paste 60 KB of code (a large generated file). Confirm the frontend dialog
   appears. Confirm dismissing it prevents the API call.

3. **Research Pause — AI provider token limits:**
   Check current context windows for: GPT-4o (128K), Claude 3.5 Sonnet (200K), llama.cpp (model card).
   Question: *Should the backend check be provider-aware (different limits per provider)?* If yes,
   record as a future improvement in `docs/tech-debt.md` — don't implement now (YAGNI).

4. **Technical Debt Log:**
   ```markdown
   ## [Resolved] Code Analyzer Phase 3 — 2026-03-03
   - H2: token budget guard on frontend + backend ✓
   Future: provider-aware token limits (deferred — YAGNI for now)
   Remaining: L7 (component split)
   ```

---

## Phase 4 — Component Split (L7)

> **Phase DoR:**
> - Phases 1–3 review gates all complete
> - `CodeAnalyzerView.tsx` is currently 1,109 lines (verify with `wc -l`)
> - You have confirmed no other file imports from `CodeAnalyzerView.tsx` directly (imports come
>   from `App.tsx` only)

**Problem restated:**
All 6 tab components + helpers live in one 1,100-line file. This is a maintainability and diff-readability
issue. Each tab should be its own file, importable and testable in isolation.

**Target structure:**
```
src/components/code-analyzer/
  CodeAnalyzerView.tsx        ← trimmed orchestrator (~200 lines)
  tabs/
    OverviewTab.tsx
    WalkthroughTab.tsx
    IssuesTab.tsx
    OptimizedTab.tsx
    QualityTab.tsx
    LearnTab.tsx
  shared/
    SeverityBadge.tsx
    CategoryBadge.tsx
    QualityGauge.tsx
  detectLanguage.ts           ← pure function, no React
  constants.ts                ← MAX_FILE_SIZE_BYTES, SOFT_TOKEN_WARN_BYTES, LANGUAGE_EXTENSIONS
```

---

### Task 4.1 — Create the directory scaffold and move shared utilities

**Files:**
- Create: `hadron-desktop/src/components/code-analyzer/constants.ts`
- Create: `hadron-desktop/src/components/code-analyzer/detectLanguage.ts`
- Create: `hadron-desktop/src/components/code-analyzer/shared/SeverityBadge.tsx`
- Create: `hadron-desktop/src/components/code-analyzer/shared/CategoryBadge.tsx`
- Create: `hadron-desktop/src/components/code-analyzer/shared/QualityGauge.tsx`

**Step 1 — Create the directories**

```bash
mkdir -p hadron-desktop/src/components/code-analyzer/tabs
mkdir -p hadron-desktop/src/components/code-analyzer/shared
```

---

**Step 2 — Extract `constants.ts`**

Move from `CodeAnalyzerView.tsx` to the new file:
- `LANGUAGE_EXTENSIONS` record
- `MAX_FILE_SIZE_BYTES` constant
- `SOFT_TOKEN_WARN_BYTES` constant
- `warnIfLargeFile` helper (depends only on constants, not React)

`constants.ts` should have no React import.

---

**Step 3 — Extract `detectLanguage.ts`**

Move the `detectLanguage(code, filename)` function. It has no React dependency.
Export as `export function detectLanguage(...)`.

---

**Step 4 — Extract shared components**

Each shared component is a single function component. Move `SeverityBadge`, `CategoryBadge`, and
`QualityGauge` into their own files with `export default`.

---

**Step 5 — Update imports in `CodeAnalyzerView.tsx`**

Add the new imports. Remove the extracted code. Verify the file compiles with no TypeScript errors:
```bash
npx tsc --noEmit -p hadron-desktop/tsconfig.json 2>&1 | grep "code-analyzer"
```

---

**Step 6 — Commit scaffold**

```bash
git add hadron-desktop/src/components/code-analyzer/
git add hadron-desktop/src/components/CodeAnalyzerView.tsx
git commit -m "refactor(code-analyzer): extract constants, detectLanguage, and shared badge/gauge components"
```

---

### Task 4.2 — Extract tab components

**Files:**
- Create: `hadron-desktop/src/components/code-analyzer/tabs/OverviewTab.tsx`
- Create: `hadron-desktop/src/components/code-analyzer/tabs/WalkthroughTab.tsx`
- Create: `hadron-desktop/src/components/code-analyzer/tabs/IssuesTab.tsx`
- Create: `hadron-desktop/src/components/code-analyzer/tabs/OptimizedTab.tsx`
- Create: `hadron-desktop/src/components/code-analyzer/tabs/QualityTab.tsx`
- Create: `hadron-desktop/src/components/code-analyzer/tabs/LearnTab.tsx`
- Modify: `hadron-desktop/src/components/CodeAnalyzerView.tsx` (now only orchestration)

**Step 1 — Extract one tab at a time, in this order:**

Order matters: start with the simplest (no internal state) to build confidence:
1. `LearnTab` — pure display, no state
2. `OptimizedTab` — minimal state (`copied`)
3. `QualityTab` — pure display
4. `OverviewTab` — pure display with callback prop
5. `WalkthroughTab` — has `expanded` Set state
6. `IssuesTab` — most complex (filters, highlight, sort)

For each tab:
a. Create `tabs/TabName.tsx` with the component function and its required imports
b. Add `export default` to the function
c. Delete the function from `CodeAnalyzerView.tsx`
d. Add `import TabName from "./code-analyzer/tabs/TabName"` to `CodeAnalyzerView.tsx`
e. Run `npx tsc --noEmit` — fix any import errors before proceeding to next tab

---

**Step 2 — Move `CodeAnalyzerView.tsx` into the directory**

Once all tabs are extracted, move the orchestrator:

```bash
mv hadron-desktop/src/components/CodeAnalyzerView.tsx \
   hadron-desktop/src/components/code-analyzer/CodeAnalyzerView.tsx
```

Update `App.tsx` import:
```typescript
// Before:
import CodeAnalyzerView from "./components/CodeAnalyzerView";
// After:
import CodeAnalyzerView from "./components/code-analyzer/CodeAnalyzerView";
```

---

**Step 3 — Final type check**

```bash
npx tsc --noEmit -p hadron-desktop/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

---

**Step 4 — Smoke test**

Run the dev server. Submit a code snippet. Cycle through all 6 tabs. Confirm no regressions.

---

**Step 5 — Commit**

```bash
git add hadron-desktop/src/components/code-analyzer/ hadron-desktop/src/components/CodeAnalyzerView.tsx hadron-desktop/src/App.tsx
git commit -m "refactor(code-analyzer): split 1,109-line component into tab files"
```

**DoD — L7:**
- [ ] `CodeAnalyzerView.tsx` (orchestrator) is under 250 lines
- [ ] Each tab is a separate file with a single `export default` component
- [ ] `App.tsx` import path updated
- [ ] `npx tsc --noEmit` reports zero errors
- [ ] All 6 tabs render correctly in the running app

**Tech-Debt Cycle — L7:** Removes debt. The monolith made diffs noisy and tab logic entangled.

---

## Phase 4 — Final Review Gate

1. **Diff review:** `git diff main..HEAD` — read every file changed. Confirm old `CodeAnalyzerView.tsx`
   at the original path no longer exists. Confirm `App.tsx` import is updated.

2. **Full smoke test:** Start fresh dev server (`npm run dev`). Test the complete Code Analyzer flow:
   - Drop a file, auto-detect language, analyze, view all 6 tabs
   - Click a critical issue in Overview → navigates to Issues tab and expands correctly
   - Submit code twice with same issue → highlights both times
   - Check Translation history — no code review entries present

3. **Research Pause — Component organisation patterns:**
   Read: https://react.dev/learn/thinking-in-react (specifically "Step 1: Break the UI into a component hierarchy")
   Question: *Is the `tabs/` folder-per-feature pattern the right long-term pattern for Hadron, or should
   it be a flat `components/` with a naming convention?* Record in `docs/architecture-decisions.md`.

4. **Final Technical Debt Log:**
   ```markdown
   ## [Resolved] Code Analyzer Phase 4 — 2026-03-03
   - L7: component split into tab files ✓

   ## All Code Analyzer Findings Resolved — 2026-03-03
   H1 ✓ H2 ✓ H3 ✓ M4 ✓ M5 ✓ M6 ✓ L7 ✓ L8 ✓ L9 ✓

   ## Future items (not in scope, revisit if needed)
   - Provider-aware token limits (deferred from Phase 3)
   - Replace window.confirm() guards with inline UI warnings (deferred — UX polish)
   ```

---

## Execution Summary

| Phase | Findings | Rust rebuild? | Risk | Commits |
|---|---|---|---|---|
| 1 — Frontend quick wins | H3, M4, M5, M6, L8, L9 | No | Low | 6 |
| 2 — Architectural (DB) | H1 | Yes (fast check only) | Medium | 3 |
| 3 — Token safety net | H2 | Yes | Low | 2 |
| 4 — Component split | L7 | No | Low | 2 |
| **Total** | **9** | | | **13** |

Each phase is fully self-contained. If any phase hits an unexpected blocker, the previous phases'
improvements already ship — nothing is held hostage by a later phase.
