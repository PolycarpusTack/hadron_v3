# Cluster A — Trust & Readiness

**Date:** 2026-05-06
**Status:** Approved, ready for implementation

## Problem

Three separate surfaces show AI readiness state inconsistently:
- `AppHeader` shows only "Connected: provider + JIRA + Sentry" as a text pill
- `ApiKeyWarning` shows a generic "API Key Required" banner with no provider specifics
- `App.tsx` throws hardcoded "Please set your OpenAI API key" errors regardless of active provider
- The model dropdown in Settings and in the Crash Analyzer's Analysis Options panel shows no suitability information
- `FileDropZone` advertises "up to 5MB" — the real safe limit is ~600 KB for most models

Users cannot tell before clicking Analyze: which AI will run, where its key comes from, whether the model can handle the file, or what will happen if something fails.

## Goals

- Single "ready / needs setup" surface visible at all times without consuming vertical space
- Model selection shows which models are safe for large logs and which may truncate
- File size fit check appears after a file is loaded, with specific numbers
- All components derive readiness state from one place — no duplicated localStorage reads

## Out of Scope

Settings panel restructure, navigation grouping, History/Ask Hadron UX, JIRA/Sentry empty-state deep-links. These are addressed in separate cluster specs (B–F).

---

## Architecture

### 1. `src/hooks/useReadinessStatus.ts` (new)

Central hook. Reads provider, model, API key presence, Keeper config, MCP config, and integration state. Returns a `ReadinessStatus` object. Polls every 5 s so the status bar stays live after settings changes without a page reload.

```ts
interface DimensionStatus {
  state: "ok" | "warning" | "not-configured" | "disabled";
  // "ok"             → green dot
  // "warning"        → amber dot — functional but degraded
  // "not-configured" → red dot — needs user action
  // "disabled"       → muted grey dot — intentionally off, not an error
  label: string;           // short label shown in the status bar dot tooltip
  detail: string;          // full sentence shown in the popover
  settingsSection: string; // "ai" | "keeper" | "mcp" | "jira" | "sentry"
}

interface ReadinessStatus {
  overall: "ready" | "warning" | "not-configured";
  ai: DimensionStatus;
  keeper: DimensionStatus;
  mcp: DimensionStatus;
  jira: DimensionStatus;
  sentry: DimensionStatus;
}
```

**AI dimension logic:**
- `not-configured` if no provider set or no API key present (and Keeper is not active for the provider)
- `warning` if the selected model is not in `CURATED_MODELS[provider]` or has `suitableForHadron !== true`
- `ok` otherwise

**Keeper dimension logic:**
- Grey (not shown as error) if Keeper is not enabled — intentional opt-out
- `warning` if enabled but `status.secrets_count === 0` or connection failed
- `ok` if enabled and connected

**MCP (CodexMgX) dimension logic:**
- `disabled` if not enabled
- `warning` if enabled but the env file check fails — resolved via `invoke("codexmgx_check_env")` IPC call (existing Tauri command that returns a boolean); on the Electron build this is shimmed to always return `true` since MCP runs as a child process rather than via Tauri
- `ok` if enabled and env check passes

**Integration dimensions (JIRA, Sentry):**
- `disabled` if `isJiraEnabled()` / `isSentryEnabled()` returns false — intentional, no error shown
- `warning` if enabled but `localStorage.getItem("jira_connection_ok") !== "true"` (set by SettingsPanel's "Test Connection" flow)
- `ok` if enabled and last connection test passed

**`overall`:** `"not-configured"` if any dimension is `"not-configured"`; `"warning"` if any is `"warning"`; `"ready"` otherwise. Dimensions with state `"disabled"` are ignored for `overall`.

---

### 2. `src/components/ui/StatusPopover.tsx` (new, ~60 lines)

Small absolutely-positioned card rendered above a status dot on click. Receives a `DimensionStatus` and an `onOpenSettings(section: string) => void` callback. Shows:
- `status.detail` — one sentence explaining the current state
- "Fix this →" button (only when `status.state === "warning" || status.state === "not-configured"`) that calls `onOpenSettings(status.settingsSection)`

Closes on outside click or Escape.

---

### 3. `src/components/AppHeader.tsx` (modified)

**Removes:** the existing status pill (`"Connected: provider + JIRA + Sentry"`).

**Adds:** a slim strip rendered as a second row inside the header panel, between the logo/buttons row and the nav. Contains one dot-group per dimension:

```
● OpenAI · GPT-5.4 Mini  |  ● Key: Manual  |  ● Keeper  |  ● MCP  |  ● JIRA  |  ● Sentry
```

Dot colors: `var(--hd-accent)` (green) = ok, amber = warning, red = not-configured. Integration dots (JIRA, Sentry, MCP, Keeper) are rendered in muted grey when the dimension is intentionally disabled — they do not show as errors.

`AppHeader` receives one new prop: `readinessStatus: ReadinessStatus`. `App.tsx` calls `useReadinessStatus()` and passes the result down. `onOpenSettings` is extended to accept an optional `section?: string` argument.

Clicking a dot renders `StatusPopover` for that dimension.

---

### 4. `src/components/ui/ModelPicker.tsx` (new, ~120 lines)

Custom `<div>`-based dropdown replacing the native `<select>` for model selection. Native `<select>` cannot render section headers or colored row tints.

```ts
interface ModelPickerProps {
  provider: string;
  value: string;
  models: ModelOption[];
  onChange: (modelId: string) => void;
}
```

Internally splits `models` into two groups:
- **Recommended for Hadron** — `suitableForHadron === true` (from `CuratedModel`)
- **May truncate your logs** — all others, or models with `context < 200_000`

Each row: model label (left), context size formatted as `"400K"` / `"1M"` (right, muted). No per-row badges — section headers carry the meaning.

Used in:
- `SettingsPanel` Advanced › AI Configuration (replaces existing `<select>`)
- `FileDropZone` Analysis Options (replaces existing `<select>`)

---

### 5. `src/utils/model-fit.ts` (new, ~30 lines)

```ts
export function getModelSafeLimit(provider: string, modelId: string): number
```

Looks up `context` from `CURATED_MODELS[provider]` for the given model. Applies a conservative byte estimate: `contextTokens × 4 × 0.7`. Returns `512_000` (500 KB) as fallback for unknown models.

Examples:
- GPT-5.4 Mini (400K tokens) → ~1,120,000 bytes (~1.1 MB)
- GPT-4o Mini (128K tokens) → ~358,400 bytes (~350 KB)
- Claude Sonnet 4 (200K tokens) → ~560,000 bytes (~547 KB)

---

### 6. `src/components/FileDropZone.tsx` (modified)

**Static copy change:** "Supports .txt and .log files up to 5MB" → **"Recommended under 1MB"**.

**Post-load fit check:** After file selection, compute `file.size` vs `getModelSafeLimit(provider, model)`. If `file.size > limit`, render an amber warning block inside the drop zone:

```
⚠ File may be truncated
GPT-5.4 Mini handles ~600 KB. This file (850 KB) may be cut off.
Consider switching to GPT-5.5 for full analysis.
```

The user can still proceed. No blocking. The "switch to X" suggestion is the highest-context `suitableForHadron` model for the active provider, derived from `CURATED_MODELS`.

If `file.size ≤ limit`: no extra UI shown.

---

### 7. `src/App.tsx` (modified)

Lines 435 and 501: `"Please set your OpenAI API key in Settings"` → `"Please configure an API key in Settings"`.

---

## File Change Summary

| File | Change |
|------|--------|
| `src/hooks/useReadinessStatus.ts` | New |
| `src/components/ui/StatusPopover.tsx` | New |
| `src/components/ui/ModelPicker.tsx` | New |
| `src/utils/model-fit.ts` | New |
| `src/components/AppHeader.tsx` | Modified — replace status pill with slim status bar |
| `src/components/FileDropZone.tsx` | Modified — fit warning + copy fix |
| `src/components/SettingsPanel.tsx` | Modified — replace model `<select>` with `ModelPicker` |
| `src/App.tsx` | Modified — fix two OpenAI-specific error strings |

4 new files, 4 modified files. `ApiKeyWarning.tsx` is deleted in this pass — it is fully superseded by the status bar and the `not-configured` state on the AI dimension.

---

## What Is Not Changing

- Settings panel layout and section structure (Cluster B)
- Navigation tab grouping (Cluster D)
- JIRA/Sentry/Release Notes empty state deep-links (Cluster D)
- History view icon buttons (Cluster E)
- Ask Hadron tool timeline (Cluster E)
- Visual system density overhaul (Cluster F)
