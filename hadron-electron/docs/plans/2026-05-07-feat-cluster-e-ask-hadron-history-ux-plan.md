---
title: "feat: Cluster E — Ask Hadron drawer, tool timeline, History UX, widget persistence"
type: feat
date: 2026-05-07
brainstorm: docs/brainstorms/2026-05-07-cluster-e-history-ask-hadron-ux-brainstorm.md
cluster: E
---

# feat: Cluster E — Ask Hadron drawer, tool timeline, History UX, widget persistence

## Overview

Four independent workstreams discovered during a full review of Ask Hadron, Elena widget, and HistoryView:

| # | Workstream | Files touched |
|---|---|---|
| E-1 | Wire AskHadronDrawer to real AI | `AskHadronDrawer.tsx`, `App.tsx`, `AskHadronView.tsx` |
| E-2 | Tool call timeline + hasSummary/hasGoldAnswers badges | `AskHadronView.tsx`, `ChatMessageBubble.tsx`, `services/chat.ts` |
| E-3 | History row UX fixes | `HistoryView.tsx`, `HistoryListItem.tsx` (deleted), `history-filters.ts` |
| E-4 | Widget session persistence + tool activity + real drop zone | `widget/WidgetChat.tsx`, `widget/WidgetDropZone.tsx` |

---

## E-1: Wire AskHadronDrawer to real AI

### Problem
`AskHadronDrawer.tsx` is a complete stub. It has its own private `ChatMessage` type (no id, timestamp, or sources), a hardcoded seed conversation, and a `setTimeout(() => "I'm analyzing…", 600)` mock. It never calls `sendChatMessage()`. This is the first Ask Hadron experience for users opening the header button and it is entirely fake.

### Solution
Replace the stub with real `sendChatMessage()` streaming. Persist the drawer conversation to SQLite using the same session model as `AskHadronView`. Keep the UI slim — no session sidebar, no RAG toggles. When "Open in full view" is clicked, the active session is activated in `AskHadronView` so the conversation is not lost.

### Implementation

#### `src/components/AskHadronDrawer.tsx` — near-complete rewrite

**Remove:**
- Local `interface ChatMessage` (private stub type)
- Hardcoded `initialMessages` state with seed conversation
- `setTimeout` mock in `handleSend`

**Add imports:**
```ts
import {
  ChatMessage,
  sendChatMessage,
  saveChatSession,
  getChatSessions,
  getChatSessionMessages,
  createSessionId,
  createMessageId,
  generateSessionTitle,
} from "../services/chat";
import { TOOL_LABELS } from "../constants/tool-labels"; // or inline map
```

**Props change:**
```ts
interface AskHadronDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenFullView: (sessionId?: string) => void; // passes session ID for carry-over
}
```

**State:**
```ts
const [sessionId, setSessionId] = useState<string | null>(null);
const [messages, setMessages] = useState<ChatMessage[]>([]);
const [input, setInput] = useState("");
const [isLoading, setIsLoading] = useState(false);
const [toolActivity, setToolActivity] = useState<string | null>(null);
const streamingContentRef = useRef("");
```

**Load last session on mount:**
```ts
useEffect(() => {
  const storedId = localStorage.getItem("hadron-drawer-session-id");
  if (storedId) {
    getChatSessionMessages(storedId)
      .then((msgs) => { setSessionId(storedId); setMessages(msgs); })
      .catch(() => localStorage.removeItem("hadron-drawer-session-id"));
  }
}, []);
```

**`handleSend` — real streaming:**
```ts
const handleSend = async () => {
  const trimmed = input.trim();
  if (!trimmed || isLoading) return;
  setInput("");

  const userMsg: ChatMessage = {
    id: createMessageId(),
    role: "user",
    content: trimmed,
    timestamp: Date.now(),
  };
  const newMessages = [...messages, userMsg];
  setMessages(newMessages);

  // Create session on first message
  let sid = sessionId;
  if (!sid) {
    sid = createSessionId();
    setSessionId(sid);
    localStorage.setItem("hadron-drawer-session-id", sid);
  }

  // Streaming assistant placeholder
  const assistantId = createMessageId();
  streamingContentRef.current = "";
  setMessages([...newMessages, { id: assistantId, role: "assistant", content: "", timestamp: Date.now(), isStreaming: true }]);
  setIsLoading(true);

  try {
    const response = await sendChatMessage(newMessages, {
      useRag: true,
      callbacks: {
        onStream: (chunk) => {
          streamingContentRef.current += chunk;
          setMessages(prev => prev.map(m =>
            m.id === assistantId ? { ...m, content: streamingContentRef.current } : m
          ));
        },
        onFinalContent: (content) => {
          setMessages(prev => prev.map(m =>
            m.id === assistantId ? { ...m, content, isStreaming: false } : m
          ));
        },
        onToolUse: (tool) => {
          setToolActivity(TOOL_LABELS[tool.tool_name] ?? tool.tool_name);
        },
      },
    });

    // Persist session
    const title = generateSessionTitle(trimmed);
    const finalMessages = [...newMessages, { id: assistantId, role: "assistant" as const, content: response.content, timestamp: Date.now() }];
    await saveChatSession({ id: sid, title, messages: finalMessages, createdAt: Date.now(), updatedAt: Date.now() });
  } finally {
    setIsLoading(false);
    setToolActivity(null);
  }
};
```

**Tool activity indicator in UI** — add below the input, only when `toolActivity` is set:
```tsx
{toolActivity && (
  <div style={{ padding: "4px 16px 0", fontSize: "0.75rem", color: "var(--hd-text-dim)", display: "flex", alignItems: "center", gap: 4 }}>
    <Loader2 className="w-3 h-3 animate-spin" />
    {toolActivity}
  </div>
)}
```

**"Open in Full View" button** — pass session ID:
```tsx
<button onClick={() => onOpenFullView(sessionId ?? undefined)}>
  Open in Full View →
</button>
```

**New Chat button** — add to header, clears session:
```tsx
<button onClick={() => { setMessages([]); setSessionId(null); localStorage.removeItem("hadron-drawer-session-id"); }}>
  New Chat
</button>
```

Remove cosmetic "RAG ON" / "KB OFF" badges — they were fake.

---

#### `src/App.tsx` — wire session carry-over

Add state:
```ts
const [pendingDrawerSessionId, setPendingDrawerSessionId] = useState<string | undefined>(undefined);
```

Change drawer's `onOpenFullView` handler:
```tsx
<AskHadronDrawer
  isOpen={drawerOpen}
  onClose={() => setDrawerOpen(false)}
  onOpenFullView={(sessionId) => {
    setPendingDrawerSessionId(sessionId);
    setDrawerOpen(false);
    actions.setView("chat");
  }}
  pendingWidgetMessages={pendingWidgetMessages}
  onInitialMessagesConsumed={() => setPendingWidgetMessages(null)}
/>
```

Pass to AskHadronView:
```tsx
<AskHadronView
  initialSessionId={pendingDrawerSessionId}
  onInitialSessionConsumed={() => setPendingDrawerSessionId(undefined)}
  // ... existing props
/>
```

---

#### `src/components/AskHadronView.tsx` — accept initialSessionId

Add to props:
```ts
initialSessionId?: string;
onInitialSessionConsumed?: () => void;
```

In the session-load effect, after `getChatSessions()`:
```ts
if (initialSessionId) {
  const target = loadedSessions.find(s => s.id === initialSessionId);
  if (target) {
    setActiveSessionId(target.id);
    const msgs = await getChatSessionMessages(target.id);
    setMessages(msgs);
    onInitialSessionConsumed?.();
    return;
  }
}
// ... existing: activate last session
```

---

## E-2: Tool call timeline + badge fixes

### Problem
`tool_use` stream events carry `{ tool_name, tool_args, iteration }` but `AskHadronView` overwrites a single `toolActivity: string | null` slot on each call — all prior tool calls for a response are silently discarded. `DiagnosticsPanel` already has a `ToolTraceCard` component and `toolTraces?: ToolTrace[]` prop (defined at `DiagnosticsPanel.tsx:30–36`) but the prop is never populated (noted "Phase 7").

Additionally, `hasSummary` and `hasGoldAnswers` on `ChatSession` are never populated by `getChatSessions()`, making the session sidebar badges always blank.

### Solution
Accumulate tool calls into a ref during streaming (same pattern as `streamingContentRef`). Capture into per-message state on response completion. Pass to `DiagnosticsPanel.toolTraces`.

### Implementation

#### `src/components/AskHadronView.tsx`

**Add ref and per-message tool traces map:**
```ts
import type { ToolTrace } from "./DiagnosticsPanel";

const streamingToolsRef = useRef<ToolTrace[]>([]);
const [messageToolTraces, setMessageToolTraces] = useState<Record<string, ToolTrace[]>>({});
```

**In `handleSend`, clear ref before each request:**
```ts
streamingToolsRef.current = [];
```

**In `onToolUse` callback (alongside existing toolActivity update):**
```ts
onToolUse: (tool) => {
  setToolActivity(TOOL_LABELS[tool.tool_name] ?? tool.tool_name);
  streamingToolsRef.current = [
    ...streamingToolsRef.current,
    {
      name: tool.tool_name,
      args: tool.tool_args as Record<string, unknown>,
      summary: TOOL_LABELS[tool.tool_name] ?? tool.tool_name,
    },
  ];
},
```

**In `onFinalContent` (when setting the final message), capture tool traces:**
```ts
onFinalContent: (content, messageId) => {
  setMessages(prev => prev.map(m =>
    m.id === messageId ? { ...m, content, isStreaming: false } : m
  ));
  if (streamingToolsRef.current.length > 0) {
    setMessageToolTraces(prev => ({ ...prev, [messageId]: streamingToolsRef.current }));
  }
},
```

**Pass toolTraces to ChatMessageBubble and DiagnosticsPanel:**

In the message render:
```tsx
<ChatMessageBubble
  message={msg}
  toolTraces={messageToolTraces[msg.id]}
  diagnostics={messageDiagnostics[msg.id]}
  // ... other props
/>
```

In `ChatMessageBubble.tsx`, pass through to `DiagnosticsPanel`:
```tsx
<DiagnosticsPanel
  diagnostics={diagnostics}
  toolTraces={toolTraces}  // already in prop signature, just never passed
/>
```

#### `src/services/chat.ts` — fix hasSummary / hasGoldAnswers

`getChatSessions()` currently returns sessions with `hasSummary: undefined` and `hasGoldAnswers: undefined` always. Fix by querying the DB for each session:

```ts
// In getChatSessions(), after loading sessions from DB:
// hasSummary: check if session has a summary_text stored
// hasGoldAnswers: check if any message has gold feedback

// Simplest approach for hasSummary — if the DB has a summary_text column:
// hasSummary: row.summary_text != null

// For hasGoldAnswers — query chat_feedback table for this session:
// hasGoldAnswers: await invoke("chat_session_has_gold", { session_id: session.id })
```

If the Tauri command `chat_session_has_gold` doesn't exist, add it, or derive from client-side `goldMessageIds` state by checking if any session's gold feedback exists in `localStorage` under `STORAGE_KEYS.CHAT_FEEDBACK`.

**Alternative (simpler):** if reliable DB query is hard, read the `CHAT_FEEDBACK` localStorage store in `getChatSessions` and mark `hasGoldAnswers: true` for any session that has at least one 'accept' or high-rating feedback entry.

---

## E-3: History row UX fixes

### Problems
1. "DEL" button is red text, not an icon, no `aria-label`
2. Star `★` button has no `aria-label`, no tooltip
3. Preview close `×`, filter close `×`, search clear `×` have no `aria-label`
4. "No tags" quick filter pill does nothing (stub at line 739) but looks clickable
5. Hard-coded `limit: 50` in `filtersToApiOptions` silently truncates results with no UI indication
6. Client-side `sortBy` / `groupBy` local state conflicts with `HistoryFilters.sortBy` API-level sort
7. `HistoryListItem.tsx` is dead code (not imported anywhere)

### Implementation

#### `src/components/HistoryView.tsx`

**DEL button → Trash2 icon (line ~1103):**
```tsx
// Before:
<button className="..." onClick={...}>DEL</button>

// After:
<button
  className="p-1.5 rounded text-red-400 hover:bg-red-500/10 hover:text-red-300 transition"
  aria-label="Delete"
  title="Delete"
  onClick={...}
>
  <Trash2 className="w-3.5 h-3.5" />
</button>
```
Add `Trash2` to lucide-react imports.

**Star button — add aria-label (line ~1101):**
```tsx
<button
  aria-label={item.isFavorite ? "Remove from favorites" : "Add to favorites"}
  title={item.isFavorite ? "Remove from favorites" : "Add to favorites"}
  onClick={...}
>
  ★
</button>
```

**All `×` close buttons — add aria-label:**
- Search clear (`×` near line 879): `aria-label="Clear search"`
- Preview panel close (`×` near line 1123): `aria-label="Close preview"`
- AdvancedFilterPanel close (AdvancedFilterPanel.tsx ~line 166): `aria-label="Close filters"`

**Remove "No tags" quick filter pill:**
- Remove the `"noTags"` entry from the quick filter bar render
- Remove the `case "noTags"` branch in the filter logic (line ~739)
- Remove it from the `quickFilter` state's valid values

**Bump limit + add result count:**

In `filtersToApiOptions` call (line ~221 in HistoryView, or in `history-filters.ts:DEFAULT`):
```ts
// Change: filtersToApiOptions(apiOptions) → limit: 200 instead of 50
const apiOptions = filtersToApiOptions(filters, 200, 0);
```

After loading, display count:
```tsx
{totalCount > 0 && (
  <span className="text-xs text-gray-500 ml-2">
    {analyses.length < totalCount
      ? `Showing ${analyses.length} of ${totalCount}`
      : `${totalCount} results`}
    </span>
)}
```

**Consolidate dual sort:** Remove local `sortBy` / `groupBy` `useState` (lines ~94-95 in HistoryView). Route the toolbar sort select to update `filters.sortBy` and `filters.sortOrder` directly via `setFilters`:
```tsx
// Toolbar sort select — change from:
<select value={sortBy} onChange={e => setSortBy(e.target.value)}>

// To:
<select value={filters.sortBy} onChange={e => setFilters(prev => ({ ...prev, sortBy: e.target.value as HistoryFilters["sortBy"] }))}>
```

Remove client-side sort application from `sortedUnifiedItems` computation. The API result is now the single source of truth. Grouping (`groupBy`) is a display-only concern; keep it but make it a local state that applies cosmetic grouping headers without re-sorting.

---

#### `src/types/history-filters.ts`

Change default limit:
```ts
// In filtersToApiOptions, change default parameter:
export function filtersToApiOptions(filters: HistoryFilters, limit = 200, offset = 0)
```

---

#### `src/components/HistoryListItem.tsx` — **delete the file**

This file is not imported anywhere in the codebase. It defines `AnalysisListItem` and `TranslationListItem` with a card layout that was superseded when HistoryView was rewritten to the compact table style. Keeping it risks it drifting further from the data model.

Verify with: `grep -r "HistoryListItem\|AnalysisListItem\|TranslationListItem" src/` — confirm zero imports before deleting.

---

## E-4: Widget (Elena) — session persistence + tool activity + real drop zone

### Problems
1. `WidgetChat.tsx` stores all messages in local component state — collapsing Elena loses the entire conversation
2. `onToolUse` callback is not connected — no tool activity indicator during generation
3. `WidgetDropZone.tsx` accepts file-picker only (no actual drag-and-drop) despite the component name

### Implementation

#### `src/components/widget/WidgetChat.tsx` — session persistence

Add imports:
```ts
import {
  ChatMessage,
  saveChatSession,
  getChatSessions,
  getChatSessionMessages,
  createSessionId,
  createMessageId,
  generateSessionTitle,
} from "../../services/chat";
```

Add state:
```ts
const [sessionId, setSessionId] = useState<string | null>(null);
const [toolActivity, setToolActivity] = useState<string | null>(null);
```

**Load last widget session on mount:**
```ts
useEffect(() => {
  const storedId = localStorage.getItem("hadron-widget-session-id");
  if (storedId) {
    getChatSessionMessages(storedId)
      .then(msgs => { setSessionId(storedId); setMessages(msgs); })
      .catch(() => localStorage.removeItem("hadron-widget-session-id"));
  }
}, []);
```

**On send — create session on first message:**
```ts
let sid = sessionId;
if (!sid) {
  sid = createSessionId();
  setSessionId(sid);
  localStorage.setItem("hadron-widget-session-id", sid);
}
```

**Wire `onToolUse` callback in `sendChatMessage` call:**
```ts
onToolUse: (tool) => setToolActivity(TOOL_LABELS[tool.tool_name] ?? tool.tool_name),
```

**Clear tool activity on completion:**
```ts
finally { setToolActivity(null); }
```

**Persist session after each response:**
```ts
await saveChatSession({ id: sid, title: generateSessionTitle(firstUserMessage), messages: allMessages, createdAt, updatedAt: Date.now() });
```

**Tool activity indicator in WidgetChat UI:**
```tsx
{toolActivity && (
  <div className="flex items-center gap-1 px-3 py-1 text-xs text-gray-400">
    <Loader2 className="w-3 h-3 animate-spin" />
    <span>{toolActivity}</span>
  </div>
)}
```

**"New Chat" clears session:**
```ts
const handleNewChat = () => {
  setMessages([]);
  setSessionId(null);
  localStorage.removeItem("hadron-widget-session-id");
};
```

---

#### `src/components/widget/WidgetDropZone.tsx` — add real drag-and-drop

Current: only has a `<button>` that opens a file picker. No drag-over/drop handling.

**Add drag event handlers to the outer container:**
```tsx
<div
  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setIsDragging(true); }}
  onDragLeave={() => setIsDragging(false)}
  onDrop={(e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFileSelect(file.path ?? file.name);
  }}
  className={`... ${isDragging ? "border-emerald-400 bg-emerald-500/10" : ""}`}
>
  {/* existing file-picker button stays as fallback */}
</div>
```

Add `isDragging` state for visual feedback. Note: in Electron/Tauri webviews, `File.path` is available for dropped files (unlike browser File API where path is empty). If `file.path` is unavailable, fall back to `file.name` and show an error.

---

## Acceptance Criteria

### E-1: AskHadronDrawer
- [x] Typing a message and pressing Enter calls `sendChatMessage()` — real AI response streams in
- [x] Tool activity label shows during generation (e.g. "Searching analyses…")
- [x] Conversation persists: close and reopen drawer → same messages visible
- [x] "Open in Full View" carries the conversation into `AskHadronView` — session is pre-selected, messages visible
- [x] "New Chat" button clears the conversation and creates a new session on next send
- [x] Fake "RAG ON" / "KB OFF" cosmetic badges removed
- [x] No TypeScript errors

### E-2: Tool call timeline
- [x] Multiple tool calls in a single response all appear in DiagnosticsPanel (not just the last one)
- [x] Each tool call shows its name and argument summary in a `ToolTraceCard`
- [x] DiagnosticsPanel collapses/expands as before (existing behaviour unchanged)
- [x] `hasSummary` / `hasGoldAnswers` on sessions are correctly populated — badges appear on sessions that have them
- [x] `toolActivity` still shows the latest tool name during streaming (live indicator unchanged)

### E-3: History UX
- [x] "DEL" button replaced with `Trash2` icon; has `aria-label="Delete"` and `title="Delete"`
- [x] Star button has `aria-label` that reflects current state (add/remove)
- [x] All `×` close buttons have `aria-label`
- [x] "No tags" quick filter pill removed from toolbar
- [x] Results are capped at 200 (not 50); when results are truncated, "Showing N of M" text is displayed
- [x] Toolbar sort select updates `filters.sortBy` directly — no separate client-side re-sort
- [x] `HistoryListItem.tsx` file is deleted; `grep -r "HistoryListItem"` returns no results
- [x] `npx tsc --noEmit` passes

### E-4: Widget
- [x] Send a message, collapse Elena, re-expand — same conversation is visible
- [x] Tool activity spinner + label appears during generation
- [x] Dragging a log file onto the expanded widget panel triggers quick scan (not just the file-picker button)
- [x] "New Chat" clears the widget conversation

---

## Implementation Checklist

### E-1
- [x] `AskHadronDrawer.tsx`: remove stub, add real state + streaming + session persistence
- [x] `AskHadronDrawer.tsx`: add `onOpenFullView(sessionId?: string)` to props
- [x] `AskHadronDrawer.tsx`: load last session from localStorage on mount
- [x] `AskHadronDrawer.tsx`: add tool activity indicator, New Chat button, remove fake badges
- [x] `App.tsx`: add `pendingDrawerSessionId` state
- [x] `App.tsx`: wire `onOpenFullView` handler to set `pendingDrawerSessionId` + navigate to chat
- [x] `App.tsx`: pass `initialSessionId={pendingDrawerSessionId}` to `<AskHadronView>`
- [x] `AskHadronView.tsx`: add `initialSessionId?` + `onInitialSessionConsumed?` props
- [x] `AskHadronView.tsx`: activate `initialSessionId` session in load effect

### E-2
- [x] `AskHadronView.tsx`: add `streamingToolsRef` + `messageToolTraces` state
- [x] `AskHadronView.tsx`: populate ref in `onToolUse`, capture to state in `onFinalContent`
- [x] `ChatMessageBubble.tsx`: accept + pass `toolTraces` prop to `DiagnosticsPanel`
- [x] `services/chat.ts`: populate `hasSummary` and `hasGoldAnswers` in `getChatSessions()`

### E-3
- [x] `HistoryView.tsx`: replace "DEL" button with `Trash2` icon + `aria-label`
- [x] `HistoryView.tsx`: add `aria-label` to star button, all `×` close buttons
- [x] `HistoryView.tsx`: remove "No tags" quick filter pill + filter logic
- [x] `HistoryView.tsx`: bump `limit` to 200, add "Showing N of M" display
- [x] `HistoryView.tsx`: remove local `sortBy`/`groupBy` state; route sort through `filters.sortBy`
- [x] `AdvancedFilterPanel.tsx`: add `aria-label` to close button
- [x] `history-filters.ts`: bump default limit to 200
- [x] Delete `src/components/HistoryListItem.tsx`

### E-4
- [x] `widget/WidgetChat.tsx`: add session persistence (localStorage session ID + SQLite save)
- [x] `widget/WidgetChat.tsx`: wire `onToolUse` callback
- [x] `widget/WidgetChat.tsx`: add tool activity indicator + "New Chat" session clear
- [x] `widget/WidgetDropZone.tsx`: add drag-over/drop handlers + visual drag state

---

## References

- `src/components/AskHadronDrawer.tsx` — current 220-line stub to replace
- `src/components/AskHadronView.tsx` — `streamingContentRef` pattern (line ~380), `onToolUse` callback (line ~389), session load effect
- `src/services/chat.ts:199` — `sendChatMessage(messages, options)` signature
- `src/services/chat.ts:526` — `getChatSessions()` — where to add `hasSummary`/`hasGoldAnswers`
- `src/components/DiagnosticsPanel.tsx:30` — `ToolTrace` interface definition
- `src/components/DiagnosticsPanel.tsx:41` — `toolTraces?: ToolTrace[]` prop (already in signature, never passed)
- `src/components/HistoryView.tsx:1101` — star button (no aria-label)
- `src/components/HistoryView.tsx:1103` — DEL text button to replace
- `src/components/HistoryView.tsx:739` — "No tags" stub to remove
- `src/components/widget/WidgetChat.tsx` — `sendChatMessage` call site, local message state
- `src/components/widget/WidgetDropZone.tsx` — file-picker only, needs drag-and-drop
- `src/App.tsx:64` — `pendingSettingsSection` pattern to follow for `pendingDrawerSessionId`
- Brainstorm: `docs/brainstorms/2026-05-07-cluster-e-history-ask-hadron-ux-brainstorm.md`
