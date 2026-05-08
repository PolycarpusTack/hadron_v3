# Cluster E: History Open Button + Ask Hadron Tool Pills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a direct one-click Open button to each History row, and display a lightweight tool pill strip under Ask Hadron responses that used tools.

**Architecture:** Two independent surgical edits — (1) `HistoryView.tsx` gains a `LogIn` icon button in the actions column; (2) `ChatMessageBubble.tsx` gains a pill chip row above DiagnosticsPanel that renders whenever `toolTraces` is non-empty. No new files, no new state, no new props.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, lucide-react icons, Vitest.

---

## File Map

| File | Change |
|------|--------|
| `src/components/HistoryView.tsx` | Add `LogIn` import; Open button in actions column; column width 56→72 |
| `src/components/ChatMessageBubble.tsx` | Add tool pill strip above DiagnosticsPanel |

---

## Task 1: History Row Open Button

**Files:**
- Modify: `src/components/HistoryView.tsx`

### Background

`HistoryView.tsx` renders a list of history items (analyses + JIRA briefs). Each row has an actions column at `width: 56` containing ★ (favorite) and 🗑 (delete). Opening an analysis requires two clicks: click row → preview panel opens → click "Open Full Detail". The goal is a direct `LogIn` icon button per row that calls the same handlers the preview panel already uses.

Key code locations:
- **lucide import** — line 2
- **Column header "Actions"** — line 1001: `<span style={{ width: 56, flexShrink: 0, textAlign: "right" }}>Actions</span>`
- **Actions div** — line 1095: `<div style={{ width: 56, flexShrink: 0, display: "flex", gap: 3, alignItems: "center", justifyContent: "flex-end" }}>`
- **Favorite button** — line 1097 (first button inside the actions div, only for `item.kind === "analysis"`)
- **Delete button** — line 1099

`handleView(id: number)` is defined at line 334 — loads the analysis and calls `onViewAnalysis`.
`onViewJiraTicket(jiraKey: string)` is a prop at line 43 — navigates to the JIRA Analyzer view.

---

- [ ] **Step 1: Add `LogIn` to the lucide-react import**

In `src/components/HistoryView.tsx`, line 2, replace:

```tsx
import { Search, AlertCircle, SlidersHorizontal, X, CheckSquare, Download, Columns, Tag, Trash2 } from "lucide-react";
```

with:

```tsx
import { Search, AlertCircle, SlidersHorizontal, X, CheckSquare, Download, Columns, Tag, Trash2, LogIn } from "lucide-react";
```

---

- [ ] **Step 2: Update the "Actions" column header width from 56 to 72**

Find (line ~1001):

```tsx
              <span style={{ width: 56, flexShrink: 0, textAlign: "right" }}>Actions</span>
```

Replace with:

```tsx
              <span style={{ width: 72, flexShrink: 0, textAlign: "right" }}>Actions</span>
```

---

- [ ] **Step 3: Update the actions `div` width from 56 to 72**

Find (line ~1095):

```tsx
                        <div style={{ width: 56, flexShrink: 0, display: "flex", gap: 3, alignItems: "center", justifyContent: "flex-end" }}>
```

Replace with:

```tsx
                        <div style={{ width: 72, flexShrink: 0, display: "flex", gap: 3, alignItems: "center", justifyContent: "flex-end" }}>
```

---

- [ ] **Step 4: Add the Open button as the first button inside the actions div**

The actions div currently starts with the favorite button (inside a conditional) followed by the delete button. Add the Open button before both, unconditionally:

Find the opening of the actions div and its first child (the favorite button conditional):

```tsx
                        <div style={{ width: 72, flexShrink: 0, display: "flex", gap: 3, alignItems: "center", justifyContent: "flex-end" }}>
                          {item.kind === "analysis" && (
                            <button aria-label={(item.data as Analysis).is_favorite ? "Remove from favorites" : "Add to favorites"}
```

Replace with:

```tsx
                        <div style={{ width: 72, flexShrink: 0, display: "flex", gap: 3, alignItems: "center", justifyContent: "flex-end" }}>
                          <button
                            aria-label="Open"
                            title={item.kind === "analysis" ? "Open full detail" : "Open in JIRA Analyzer"}
                            onClick={e => {
                              e.stopPropagation();
                              if (item.kind === "analysis") handleView((item.data as Analysis).id);
                              else onViewJiraTicket((item.data as TicketBrief).jira_key);
                            }}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--hd-text-dim)", padding: 2, display: "flex", alignItems: "center" }}
                          >
                            <LogIn style={{ width: 11, height: 11 }} />
                          </button>
                          {item.kind === "analysis" && (
                            <button aria-label={(item.data as Analysis).is_favorite ? "Remove from favorites" : "Add to favorites"}
```

---

- [ ] **Step 5: Verify TypeScript — web process**

Run:
```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: 0 errors. `LogIn` is a valid lucide-react icon, `TicketBrief` is already imported at line 25, `Analysis` at line 28.

---

- [ ] **Step 6: Verify existing tests still pass**

Run:
```bash
npm test
```

Expected: same pass/fail count as before (pre-existing `better-sqlite3` ELF mismatch failures on WSL2 are unrelated).

---

- [ ] **Step 7: Commit**

```bash
git add src/components/HistoryView.tsx
git commit -m "feat(history): add direct Open button per row — one-click to full detail"
```

---

## Task 2: Ask Hadron Tool Pill Strip

**Files:**
- Modify: `src/components/ChatMessageBubble.tsx`

### Background

`AskHadronView` accumulates tool calls into `streamingToolsRef` as `ToolTrace[]` objects during streaming. When a response completes, these are stored in `messageToolTraces` state (keyed by assistant message id) and passed to `ChatMessageBubble` via the `toolTraces?: ToolTrace[]` prop.

Each `ToolTrace` has:
```ts
interface ToolTrace {
  name: string;           // e.g. "search_analyses"
  args: Record<string, unknown>;
  summary: string;        // human-readable label, e.g. "Searching analyses"
  results?: Array<{ title?: string; snippet?: string }>;
  durationMs?: number;
}
```

The `summary` field is already set from `TOOL_LABELS` at creation time in `AskHadronView.tsx:428`.

Currently `toolTraces` are only displayed inside `DiagnosticsPanel` — which only renders when `diagnostics` is also present (line 436: `{!isUser && !message.isStreaming && diagnostics && ...}`). The goal is a lightweight pill strip that renders independently of `diagnostics`.

Key insertion point in `ChatMessageBubble.tsx` — the DiagnosticsPanel block (line ~435):

```tsx
        {/* Diagnostics panel (collapsed by default) */}
        {!isUser && !message.isStreaming && diagnostics && (
          <DiagnosticsPanel diagnostics={diagnostics} toolTraces={toolTraces} />
        )}
```

---

- [ ] **Step 1: Add the tool pill strip above the DiagnosticsPanel block**

In `src/components/ChatMessageBubble.tsx`, find:

```tsx
        {/* Diagnostics panel (collapsed by default) */}
        {!isUser && !message.isStreaming && diagnostics && (
          <DiagnosticsPanel diagnostics={diagnostics} toolTraces={toolTraces} />
        )}
```

Replace with:

```tsx
        {/* Tool pill strip — always visible when tool traces exist */}
        {!isUser && !message.isStreaming && toolTraces && toolTraces.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {toolTraces.map((trace, idx) => (
              <span
                key={idx}
                className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800/60 border border-gray-700/50 text-gray-500"
              >
                {trace.summary}
              </span>
            ))}
          </div>
        )}

        {/* Diagnostics panel (collapsed by default) */}
        {!isUser && !message.isStreaming && diagnostics && (
          <DiagnosticsPanel diagnostics={diagnostics} toolTraces={toolTraces} />
        )}
```

---

- [ ] **Step 2: Verify TypeScript — web process**

Run:
```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: 0 errors. `ToolTrace` is already imported at line 35 via `import type { ToolTrace } from "./DiagnosticsPanel"`. `toolTraces` is already in scope as a destructured prop.

---

- [ ] **Step 3: Verify existing tests still pass**

Run:
```bash
npm test
```

Expected: same pass/fail count as before.

---

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatMessageBubble.tsx
git commit -m "feat(chat): show tool pill strip under Ask Hadron responses"
```
