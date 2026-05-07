---
title: "Cluster E — History view + Ask Hadron UX"
date: 2026-05-07
status: ready-for-planning
---

# Cluster E — History view + Ask Hadron UX

## Context

Full review of Ask Hadron, Elena widget, and HistoryView was conducted before this brainstorm. Key findings drove the scope below.

---

## What We're Building

Four independent workstreams discovered during the review:

### E-1: Fix AskHadronDrawer — wire to real AI

**Problem:** The header `MessageCircle` button opens `AskHadronDrawer`, which is a complete stub. It has its own private `ChatMessage` type, hardcoded seed conversation, and a `setTimeout(() => "analyzing…", 600)` mock. It never calls `sendChatMessage()`. This is the first Ask Hadron experience for most users and it is entirely fake.

**Decision:** Wire the drawer to real AI using `sendChatMessage()` from `services/chat.ts`. Keep the drawer as a slim overlay. Persist conversations to SQLite using the same session mechanism as AskHadronView. When "Open in full view" is clicked, the active session carries over (App.tsx already has `pendingWidgetMessages` plumbing that can be adapted, or simpler: just navigate to chat with the session ID).

**Approach:**
- Replace drawer's local fake `ChatMessage` type with the real one from `services/chat.ts`
- Add a single active session state to the drawer (session ID + messages)
- On first send, create a new session via `createChatSession()`; on subsequent sends, append
- Stream tokens using `sendChatMessage()` with `onStream` / `onFinalContent` callbacks (same pattern as AskHadronView)
- "Open in full view" passes the active session ID to AskHadronView via a new `initialSessionId?: string` prop (AskHadronView already loads sessions from SQLite — it just needs to activate the right one on mount)
- Keep the drawer UI slim: no session list sidebar, no RAG toggles, no diagnostics — just the message thread and input

### E-2: Tool call timeline in Ask Hadron

**Problem:** `tool_use` stream events carry `{ tool_name, tool_args, iteration }` — rich data — but `AskHadronView` overwrites a single `toolActivity: string | null` slot on every call. All prior tool calls during a response are silently discarded. `DiagnosticsPanel` already has a `ToolTraceCard` sub-component and a `toolTraces?: ToolTrace[]` prop prepared for per-tool drill-down (marked "Phase 7" in comments), but the prop is never populated.

**Decision:** Accumulate tool calls during streaming into a ref (same pattern as `streamingContentRef`). On `onFinalContent`, store the accumulated `ToolTrace[]` on the message and pass it to `DiagnosticsPanel.toolTraces`. During streaming, still show the single `toolActivity` label (current behaviour) — the timeline is a post-response view only.

**Also fix:** `hasSummary` / `hasGoldAnswers` on `ChatSession` are never populated by `getChatSessions()` — the fields are dead. Either populate them in the query (preferred) or remove the badge rendering.

### E-3: History row UX fixes

**Problem:** Multiple issues found in review:

1. **"DEL" text button** — raw `<button>` with red "DEL" text instead of an icon. Visually loud, no accessible label.
2. **Star button has no aria-label** — raw `★` character with no tooltip or aria-label. Close `×` buttons also unlabelled.
3. **`HistoryListItem.tsx` is dead code** — not imported by HistoryView.tsx. Has drifted from data model.
4. **"No tags" quick filter is a stub** — returns unchanged items, no feedback to user.
5. **Silent 50-item cap** — `limit: 50` hardcoded in `filtersToApiOptions`, `FilteredResults.hasMore` never read. No indication to the user.
6. **Dual sort system conflict** — toolbar `sortBy` (client-side) and `HistoryFilters.sortBy` (API-level) both active simultaneously. They silently fight.

**Decisions:**
- Replace "DEL" button with `<button aria-label="Delete">` + `Trash2` icon from lucide-react, same destructive styling
- Add `aria-label` to star toggle (`aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}`), all `×` close buttons, and AdvancedFilterPanel close
- Delete `HistoryListItem.tsx`
- Remove the "No tags" quick filter pill (it does nothing and misleads users); alternatively, implement the filter properly if the data is available
- Add a "Showing 50 of N — load more" affordance when `FilteredResults.hasMore` is true (or simply bump the default limit to 200 and remove the cap confusion)
- Remove the client-side `sortBy` / `groupBy` local state entirely — rely on `HistoryFilters.sortBy` (API-level) as the single sort mechanism. The toolbar sort select should update `filters.sortBy` directly.

### E-4: Widget (Elena) — session persistence + feature parity

**Problem:** WidgetChat stores all messages in local component state. Collapsing Elena loses the conversation. Additionally, `onToolUse` is not connected in WidgetChat (so no tool activity indicator), and `WidgetDropZone` is a file picker button despite being named "drop zone".

**Decisions:**
- Persist widget conversations to SQLite using the same `createChatSession` / `saveChatSession` / `appendChatMessage` calls already used by AskHadronView. The widget window has IPC access to all Tauri commands.
- Load the last widget session on mount; create a new one only on "New Chat"
- Wire `onToolUse` callback in WidgetChat — show the same single-label `toolActivity` indicator as AskHadronView (no full timeline needed in the compact widget)
- Fix `WidgetDropZone` to accept actual file drops (dragover/drop events on a div) in addition to the file-picker button

---

## Why These Approaches

- **E-1 drawer:** Keeping the slim overlay preserves the "quick access without leaving context" UX value. Reusing the real session model means conversations are never lost and carry into the full view.
- **E-2 timeline:** The data already flows through the stream — no backend changes needed. Accumulating into a ref is zero-cost; the `DiagnosticsPanel` UI is already built. This is essentially just connecting a wire.
- **E-3 history:** These are small, discrete fixes. Removing dead code + fixing accessibility + removing the misleading stub are hygiene improvements that lower the cognitive load of every future history work.
- **E-4 widget:** Session persistence makes Elena a real tool rather than a scratch pad. WidgetDropZone rename/fix removes the gap between name and behaviour.

---

## Key Decisions

| # | Decision | Rationale |
|---|---|---|
| E-1 | Drawer uses real `sendChatMessage()`, slim UI, no session sidebar | Minimal new surface; reuses proven streaming infrastructure |
| E-1 | "Open full view" activates the drawer's session in AskHadronView | No conversation loss; one chat thread across surfaces |
| E-2 | Accumulate tool calls in ref, expose as `toolTraces` post-response only | Consistent with existing `streamingContentRef` pattern; timeline is a review artifact, not a live feed |
| E-2 | Fix `hasSummary`/`hasGoldAnswers` in `getChatSessions()` query | Simple DB-level fix; badges are already rendered |
| E-3 | Remove client-side sort; single sort via `HistoryFilters.sortBy` | Eliminates the silent dual-sort conflict; simpler state |
| E-3 | Bump limit or add load-more instead of removing the cap silently | Users need to see all their data |
| E-3 | Delete `HistoryListItem.tsx` | Dead code is worse than no code |
| E-4 | Persist widget sessions using existing chat service commands | Zero new API surface; same SQLite tables |

---

## Open Questions

- **E-1:** Should the drawer remember which session was last open, or always start fresh? Decision: remember last session (consistent with how AskHadronView restores the last active session).
- **E-3:** Should "No tags" be implemented or removed? If tag data is available in the list items, implement it. If not, remove the pill to avoid misleading users.
- **E-3:** Bump limit to 200 (simple) or implement proper load-more with `hasMore`/`offset` (correct but more work)? Decision: bump to 200 as the immediate fix; proper pagination deferred.
- **E-4:** Should the widget persist all sessions or only the most recent one? Decision: one active session, overwritten on "New Chat" (keeps it simple; full history is in the main view).
