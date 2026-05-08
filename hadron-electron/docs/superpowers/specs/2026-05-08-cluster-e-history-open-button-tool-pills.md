# Cluster E: History Open Button + Ask Hadron Tool Pills

## Goal

Two targeted UX improvements: (1) eliminate the two-click friction to open an analysis from History by adding a direct Open button per row, and (2) make Ask Hadron's tool usage permanently visible under each response as lightweight pill chips.

## Architecture

Two independent, self-contained changes. Neither requires new files, new state, or new props.

**Part 1 — History Open button:** The actions column in `HistoryView.tsx` gains a third icon button (`LogIn`) alongside the existing ★ and 🗑. It calls `handleView(id)` for analyses and `onViewJiraTicket(jiraKey)` for JIRA rows — the same functions already wired to the preview panel's "Open Full Detail" / "Open in JIRA Analyzer" buttons. Column width expands from 56px to 72px.

**Part 2 — Tool pill strip:** `ChatMessageBubble` already receives `toolTraces?: ToolTrace[]`, and each `ToolTrace.summary` already holds a human-readable label (set from `TOOL_LABELS` at creation in `AskHadronView`). A small chip row is added above the `DiagnosticsPanel`, guarded by `!isUser && !message.isStreaming && toolTraces && toolTraces.length > 0`. The `DiagnosticsPanel` continues to render beneath it when `diagnostics` is also present.

---

## Part 1: History Row Open Button

### Change

In `HistoryView.tsx`, the actions column `div` (currently `width: 56, display: flex, gap: 3`) gains a third button before the existing favorite and delete buttons:

```tsx
<button
  aria-label="Open"
  title="Open full detail"
  onClick={e => {
    e.stopPropagation();
    if (item.kind === "analysis") handleView((item.data as Analysis).id);
    else onViewJiraTicket((item.data as TicketBrief).jira_key);
  }}
  style={{
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--hd-text-dim)",
    padding: 2,
    display: "flex",
    alignItems: "center",
  }}
>
  <LogIn style={{ width: 11, height: 11 }} />
</button>
```

The column header `<span style={{ width: 56 ... }}>Actions</span>` and the column `div` both change to `width: 72`. Button order within the column: Open (leftmost) → ★ → 🗑.

`LogIn` is added to the existing lucide-react import.

### Files changed

- `src/components/HistoryView.tsx` — import `LogIn`, add Open button, column 56→72

---

## Part 2: Tool Pill Strip

### Chip design

```
[search_analyses] [get_analysis_detail] [find_similar_crashes]
```

Each chip is a `<span>` with a small neutral pill style (gray background, border, tiny text). The strip is a flex row with `flex-wrap` so it doesn't overflow on long tool lists.

### Insertion point

In `ChatMessageBubble.tsx`, directly above the existing DiagnosticsPanel block:

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

### Files changed

- `src/components/ChatMessageBubble.tsx` — add tool pill strip above DiagnosticsPanel

---

## Error handling

- Open button: `handleView` already has a try/catch + toast; `onViewJiraTicket` is a navigation callback with no async work.
- Tool pills: purely presentational — no error surface. Empty `toolTraces` is guarded by `toolTraces.length > 0`.

## Testing

**History Open button:**
- Clicking the Open button on an analysis row calls `handleView` with the correct id
- Clicking the Open button on a JIRA row calls `onViewJiraTicket` with the correct key
- Click does not propagate to row (no preview panel opens on button click)
- Column renders at 72px width

**Tool pill strip:**
- When `toolTraces` is undefined or empty: no pill strip renders
- When `toolTraces` has entries: one chip per trace, each showing `trace.summary`
- Strip does not render while `message.isStreaming` is true
- Strip renders independently of whether `diagnostics` is present
- When both `toolTraces` and `diagnostics` are present: strip appears above DiagnosticsPanel
