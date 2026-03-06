# JIRA History in General History Tab — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show JIRA ticket briefs in the History tab alongside crash/code analyses, with quick-filter chips to toggle between item types, and a preview panel that can navigate to the JIRA Analyzer.

**Architecture:** New `get_all_briefs` Rust query + Tauri command returns all `ticket_briefs` rows. The frontend merges them with analyses into a unified `HistoryItem` discriminated union, adds "JIRA" / "Analyses" quick-filter chips, and renders JIRA items in the existing triage grid with a JIRA-specific preview panel. An `onViewJiraTicket` callback navigates to the JIRA tab.

**Tech Stack:** Rust (rusqlite, Tauri), React/TypeScript, existing `HistoryView.tsx` triage layout.

---

### Task 1: Add `get_all_briefs` to Rust data layer

**Files:**
- Modify: `hadron-desktop/src-tauri/src/ticket_briefs.rs` (after `get_briefs_batch`, ~line 140)
- Modify: `hadron-desktop/src-tauri/src/database.rs` (after `get_ticket_briefs_batch`, ~line 3735)

**Step 1 — Add `get_all_briefs` function to `ticket_briefs.rs`**

After the `get_briefs_batch` function (around line 140), add:

```rust
/// Fetch all ticket briefs, ordered by most recently updated first.
pub fn get_all_briefs(conn: &Connection) -> Result<Vec<TicketBrief>> {
    let mut stmt = conn.prepare(
        "SELECT jira_key, title, customer, severity, category, tags,
                triage_json, brief_json, posted_to_jira, posted_at,
                engineer_rating, engineer_notes, created_at, updated_at
         FROM ticket_briefs ORDER BY updated_at DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(TicketBrief {
            jira_key:        row.get(0)?,
            title:           row.get(1)?,
            customer:        row.get(2)?,
            severity:        row.get(3)?,
            category:        row.get(4)?,
            tags:            row.get(5)?,
            triage_json:     row.get(6)?,
            brief_json:      row.get(7)?,
            posted_to_jira:  row.get::<_, i64>(8)? != 0,
            posted_at:       row.get(9)?,
            engineer_rating: row.get(10)?,
            engineer_notes:  row.get(11)?,
            created_at:      row.get(12)?,
            updated_at:      row.get(13)?,
        })
    })?;

    rows.collect()
}
```

**Step 2 — Add Database wrapper in `database.rs`**

After the `get_ticket_briefs_batch` method (~line 3735), add:

```rust
    pub fn get_all_ticket_briefs(&self) -> Result<Vec<crate::ticket_briefs::TicketBrief>> {
        let conn = self.lock_conn();
        crate::ticket_briefs::get_all_briefs(&conn)
    }
```

**Step 3 — Verify compile**

```bash
cargo check --manifest-path hadron-desktop/src-tauri/Cargo.toml 2>&1 | grep "^error"
```

Expected: no output (no errors).

**Step 4 — Commit**

```bash
git add hadron-desktop/src-tauri/src/ticket_briefs.rs hadron-desktop/src-tauri/src/database.rs
git commit -m "feat(jira-assist): add get_all_briefs query for history tab"
```

---

### Task 2: Add Tauri command and TypeScript API

**Files:**
- Modify: `hadron-desktop/src-tauri/src/commands/jira_assist.rs` (after `get_ticket_briefs_batch` command, ~line 102)
- Modify: `hadron-desktop/src-tauri/src/main.rs` (in invoke_handler, ~line 402)
- Modify: `hadron-desktop/src/services/jira-assist.ts` (after `deleteTicketBrief`, ~line 66)

**Step 1 — Add Tauri command in `commands/jira_assist.rs`**

After the `get_ticket_briefs_batch` command (~line 102), add:

```rust
/// Fetch all ticket briefs for the history view.
#[tauri::command]
pub async fn get_all_ticket_briefs(
    db: DbState<'_>,
) -> Result<Vec<TicketBrief>, String> {
    log::debug!("cmd: get_all_ticket_briefs");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.get_all_ticket_briefs()
            .map_err(|e| format!("Database error: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}
```

**Step 2 — Register in `main.rs`**

Find the line `commands::jira_assist::get_ticket_briefs_batch,` (~line 402). Add after it:

```rust
            commands::jira_assist::get_all_ticket_briefs,
```

**Step 3 — Add TypeScript API in `jira-assist.ts`**

After the `deleteTicketBrief` function (~line 66), add:

```typescript
/** Fetch all ticket briefs for the history view. */
export async function getAllTicketBriefs(): Promise<TicketBrief[]> {
  return invoke<TicketBrief[]>("get_all_ticket_briefs");
}
```

**Step 4 — Verify compile**

```bash
cargo check --manifest-path hadron-desktop/src-tauri/Cargo.toml 2>&1 | grep "^error"
npx tsc --noEmit 2>&1 | grep "jira-assist"
```

Expected: no errors.

**Step 5 — Commit**

```bash
git add hadron-desktop/src-tauri/src/commands/jira_assist.rs hadron-desktop/src-tauri/src/main.rs hadron-desktop/src/services/jira-assist.ts
git commit -m "feat(jira-assist): add get_all_ticket_briefs command and API"
```

---

### Task 3: Add `onViewJiraTicket` prop to HistoryView and wire App.tsx

**Files:**
- Modify: `hadron-desktop/src/components/HistoryView.tsx` (interface + prop destructuring)
- Modify: `hadron-desktop/src/App.tsx` (pass the prop, handle navigation)

**Step 1 — Extend HistoryViewProps**

In `HistoryView.tsx`, find:

```typescript
interface HistoryViewProps {
  onViewAnalysis: (analysis: Analysis) => void;
}
```

Replace with:

```typescript
interface HistoryViewProps {
  onViewAnalysis: (analysis: Analysis) => void;
  onViewJiraTicket: (jiraKey: string) => void;
}
```

**Step 2 — Destructure the new prop**

Find:

```typescript
export default function HistoryView({ onViewAnalysis }: HistoryViewProps) {
```

Replace with:

```typescript
export default function HistoryView({ onViewAnalysis, onViewJiraTicket }: HistoryViewProps) {
```

**Step 3 — Wire `onViewJiraTicket` in App.tsx**

Find (~line 575):

```tsx
                <HistoryView onViewAnalysis={actions.viewAnalysis} />
```

Replace with:

```tsx
                <HistoryView
                  onViewAnalysis={actions.viewAnalysis}
                  onViewJiraTicket={(jiraKey) => {
                    actions.setView("jira");
                    // The JIRA tab will need to pick up the key — store it for now
                    sessionStorage.setItem("hadron_jira_navigate_key", jiraKey);
                  }}
                />
```

**Step 4 — Commit**

```bash
git add hadron-desktop/src/components/HistoryView.tsx hadron-desktop/src/App.tsx
git commit -m "feat(history): add onViewJiraTicket prop and wire App.tsx navigation"
```

---

### Task 4: Load JIRA briefs and merge into unified item list

**Files:**
- Modify: `hadron-desktop/src/components/HistoryView.tsx`

This is the core integration task. All changes are in `HistoryView.tsx`.

**Step 1 — Add imports**

At the top of the file, add after the existing imports:

```typescript
import { getAllTicketBriefs, deleteTicketBrief } from "../services/jira-assist";
import type { TicketBrief } from "../services/jira-assist";
```

**Step 2 — Add JIRA state**

After `const [goldStatusByAnalysisId, ...` (~line 98), add:

```typescript
  const [jiraBriefs, setJiraBriefs] = useState<TicketBrief[]>([]);
```

**Step 3 — Load JIRA briefs in `loadData`**

Find the `loadData` callback. Inside the `try` block, after translations are loaded (~line 266 `setTranslations(filtered)`), add:

```typescript
        // Load JIRA briefs
        try {
          const briefs = await getAllTicketBriefs();
          setJiraBriefs(briefs);
        } catch (e) {
          log.warn("Failed to load JIRA briefs", { error: e });
          // Non-fatal — history still works without JIRA items
        }
```

**Step 4 — Add JIRA delete handler**

After the `handleDeleteTranslation` function, add:

```typescript
  const handleDeleteJiraBrief = useCallback(async (jiraKey: string, title: string) => {
    if (!window.confirm(`Delete JIRA brief for ${jiraKey} "${title}"?`)) return;
    try {
      await deleteTicketBrief(jiraKey);
      setJiraBriefs((prev) => prev.filter((b) => b.jira_key !== jiraKey));
      toast.success("JIRA brief deleted");
    } catch (e) {
      toast.error(`Failed to delete: ${e}`);
    }
  }, [toast]);
```

**Step 5 — Create unified item type and merged list**

In the "Triage Sort and Group Logic" section (~line 750), before `sortedAnalyses`, add a new type and merged-list memo:

```typescript
  // Unified history item: analysis or JIRA brief
  type HistoryItem =
    | { kind: "analysis"; data: Analysis; date: string; sortSeverity: number; sortCost: number }
    | { kind: "jira"; data: TicketBrief; date: string; sortSeverity: number; sortCost: number };

  const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  const unifiedItems = useMemo((): HistoryItem[] => {
    const items: HistoryItem[] = analyses.map((a) => ({
      kind: "analysis" as const,
      data: a,
      date: a.analyzed_at,
      sortSeverity: severityRank[a.severity.toLowerCase()] ?? 4,
      sortCost: a.cost,
    }));

    // Only include JIRA briefs if not filtered to analyses-only
    if (quickFilter !== "analyses") {
      for (const b of jiraBriefs) {
        items.push({
          kind: "jira" as const,
          data: b,
          date: b.updated_at,
          sortSeverity: severityRank[(b.severity || "").toLowerCase()] ?? 4,
          sortCost: 0,
        });
      }
    }

    // Apply quick filters
    if (quickFilter === "jira") {
      return items.filter((i) => i.kind === "jira");
    }
    if (quickFilter === "analyses") {
      return items.filter((i) => i.kind === "analysis");
    }
    if (quickFilter === "today") {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      return items.filter((i) => new Date(i.date) >= startOfToday);
    }
    if (quickFilter === "7days") {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      return items.filter((i) => new Date(i.date) >= sevenDaysAgo);
    }
    if (quickFilter === "gold") {
      return items.filter((i) => i.kind === "analysis" && goldStatusByAnalysisId[i.data.id]);
    }

    return items;
  }, [analyses, jiraBriefs, quickFilter, goldStatusByAnalysisId]);

  // Sort unified items
  const sortedUnifiedItems = useMemo(() => {
    const sorted = [...unifiedItems];
    switch (sortBy) {
      case "severity":
        sorted.sort((a, b) => a.sortSeverity - b.sortSeverity);
        break;
      case "cost":
        sorted.sort((a, b) => b.sortCost - a.sortCost);
        break;
      case "recent":
      default:
        sorted.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        break;
    }
    return sorted;
  }, [unifiedItems, sortBy]);

  // Group unified items
  const groupedUnifiedItems = useMemo(() => {
    if (groupBy === "none") return { "": sortedUnifiedItems };
    const groups: Record<string, HistoryItem[]> = {};
    for (const item of sortedUnifiedItems) {
      let key: string;
      if (groupBy === "component") {
        key = item.kind === "analysis" ? (item.data.component || "Unknown") : (item.data.category || "JIRA");
      } else if (groupBy === "severity") {
        key = item.kind === "analysis" ? item.data.severity : (item.data.severity || "Unknown");
      } else {
        key = item.kind === "analysis" ? "analyzed" : "jira";
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  }, [sortedUnifiedItems, groupBy]);
```

**Step 6 — Commit**

```bash
git add hadron-desktop/src/components/HistoryView.tsx
git commit -m "feat(history): load JIRA briefs and build unified item list with sorting/grouping"
```

---

### Task 5: Add quick-filter chips and update rendered list

**Files:**
- Modify: `hadron-desktop/src/components/HistoryView.tsx`

**Step 1 — Add "JIRA" and "Analyses" chips**

Find the quick filter chips array (~line 1053):

```typescript
          {(["all", "today", "7days", "gold", "noTags"] as const).map((chip) => {
            const labels: Record<string, string> = {
              all: "All",
              today: "Today",
              "7days": "Last 7 days",
              gold: "Gold only",
              noTags: "No tags",
            };
```

Replace with:

```typescript
          {(["all", "analyses", "jira", "today", "7days", "gold", "noTags"] as const).map((chip) => {
            const labels: Record<string, string> = {
              all: "All",
              analyses: "Analyses",
              jira: "JIRA",
              today: "Today",
              "7days": "Last 7 days",
              gold: "Gold only",
              noTags: "No tags",
            };
```

**Step 2 — Add JIRA preview state**

After `const [previewAnalysis, setPreviewAnalysis] = ...` (~line 110), add:

```typescript
  const [previewJiraBrief, setPreviewJiraBrief] = useState<TicketBrief | null>(null);
```

**Step 3 — Replace the list rendering to use unified items**

Find the "Scrollable List" section (~line 1229):

```tsx
            <div style={{ overflowY: "auto", flex: 1, padding: "6px 8px" }}>
              {Object.entries(quickFilteredGroups).map(([groupLabel, groupItems]) => (
```

Replace the entire scrollable list (from this `<div>` through the matching closing `</div>` at ~line 1380) with:

```tsx
            <div style={{ overflowY: "auto", flex: 1, padding: "6px 8px" }}>
              {Object.entries(groupedUnifiedItems).map(([groupLabel, groupItems]) => (
                <div key={groupLabel || "__default"}>
                  {/* Group header when grouping is active */}
                  {groupBy !== "none" && groupLabel && (
                    <div
                      style={{
                        padding: "6px 8px",
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        color: "var(--hd-accent)",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        borderBottom: "1px solid var(--hd-border-subtle)",
                        marginTop: 6,
                        marginBottom: 2,
                      }}
                    >
                      {groupLabel} ({groupItems.length})
                    </div>
                  )}

                  {groupItems.map((item) => {
                    const isActive = item.kind === "analysis"
                      ? previewAnalysis?.id === item.data.id
                      : previewJiraBrief?.jira_key === item.data.jira_key;

                    const handleClick = () => {
                      if (item.kind === "analysis") {
                        setPreviewAnalysis(item.data);
                        setPreviewJiraBrief(null);
                      } else {
                        setPreviewJiraBrief(item.data);
                        setPreviewAnalysis(null);
                      }
                    };

                    // Derive JIRA status
                    const jiraStatus = item.kind === "jira"
                      ? (item.data.posted_to_jira ? "posted" : item.data.brief_json ? "briefed" : "triaged")
                      : null;

                    return (
                      <div
                        key={item.kind === "analysis" ? `a-${item.data.id}` : `j-${item.data.jira_key}`}
                        className={`hd-triage-row ${isActive ? "hd-triage-row-active" : ""}`}
                        onClick={handleClick}
                      >
                        {visibleColumns.has("file") && (
                          <div
                            style={{
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            {item.kind === "analysis" && selectionMode && (
                              <input
                                type="checkbox"
                                checked={selectedAnalysisIds.has(item.data.id)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectAnalysis(item.data.id, e.shiftKey);
                                }}
                                onChange={() => {}}
                                style={{
                                  accentColor: "var(--hd-accent)",
                                  width: 14,
                                  height: 14,
                                  cursor: "pointer",
                                  marginRight: 4,
                                }}
                              />
                            )}
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                              {item.kind === "analysis" ? item.data.filename : item.data.jira_key}
                            </span>
                            {item.kind === "analysis" && item.data.is_favorite && (
                              <span style={{ color: "#fbbf24" }}>&#9733;</span>
                            )}
                            {item.kind === "analysis" && goldStatusByAnalysisId[item.data.id] && (
                              <span style={{ fontSize: "0.7rem", color: "#fbbf24" }}>&#11088;</span>
                            )}
                            {item.kind === "jira" && (
                              <span style={{
                                fontSize: "0.6rem",
                                fontWeight: 700,
                                padding: "1px 5px",
                                borderRadius: 4,
                                background: "rgba(99,102,241,0.15)",
                                color: "rgb(129,140,248)",
                              }}>
                                JIRA
                              </span>
                            )}
                          </div>
                        )}

                        {visibleColumns.has("rootCause") && (
                          <div
                            style={{
                              color: "var(--hd-text-muted)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontSize: "0.78rem",
                            }}
                          >
                            {item.kind === "analysis" ? item.data.root_cause : item.data.title}
                          </div>
                        )}

                        {visibleColumns.has("severity") && (
                          <div>
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${getSeverityBadgeClasses(
                                item.kind === "analysis" ? item.data.severity : (item.data.severity || "medium")
                              )}`}
                            >
                              {item.kind === "analysis" ? item.data.severity : (item.data.severity || "—")}
                            </span>
                          </div>
                        )}

                        {visibleColumns.has("status") && (
                          <div style={{ fontSize: "0.72rem", color: "var(--hd-text-muted)" }}>
                            {item.kind === "analysis" ? "analyzed" : jiraStatus}
                          </div>
                        )}

                        {visibleColumns.has("component") && (
                          <div style={{ fontSize: "0.72rem", color: "var(--hd-text-dim)" }}>
                            {item.kind === "analysis" ? (item.data.component || "\u2014") : (item.data.category || "\u2014")}
                          </div>
                        )}

                        {visibleColumns.has("cost") && (
                          <div style={{ fontSize: "0.72rem", color: "var(--hd-text-dim)", fontVariantNumeric: "tabular-nums" }}>
                            {item.kind === "analysis" ? `$${item.data.cost.toFixed(3)}` : "\u2014"}
                          </div>
                        )}

                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          {item.kind === "analysis" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleFavorite(item.data.id);
                              }}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                color: item.data.is_favorite ? "#fbbf24" : "var(--hd-text-dim)",
                                fontSize: "0.9rem",
                                padding: 2,
                              }}
                            >
                              &#9733;
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (item.kind === "analysis") {
                                handleDelete(item.data.id, item.data.filename);
                              } else {
                                handleDeleteJiraBrief(item.data.jira_key, item.data.title);
                              }
                            }}
                            style={{
                              background: "var(--hd-danger-dim, rgba(239,68,68,0.12))",
                              border: "none",
                              color: "var(--hd-danger, #ef4444)",
                              borderRadius: 4,
                              padding: "3px 6px",
                              fontSize: "0.68rem",
                              cursor: "pointer",
                            }}
                          >
                            Del
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
```

**Step 4 — Update the displayed count**

Find (~line 874):

```typescript
  const displayedAnalyses = Object.values(quickFilteredGroups).flat();
```

Replace with:

```typescript
  const displayedItems = Object.values(groupedUnifiedItems).flat();
```

Then update any references to `displayedAnalyses.length` in the toolbar to use `displayedItems.length`. Search for `displayedAnalyses` and replace all occurrences.

**Step 5 — Commit**

```bash
git add hadron-desktop/src/components/HistoryView.tsx
git commit -m "feat(history): render JIRA items in unified list with filter chips"
```

---

### Task 6: Add JIRA preview panel

**Files:**
- Modify: `hadron-desktop/src/components/HistoryView.tsx`

**Step 1 — Update the preview panel**

Find the preview panel section (~line 1414, `{/* Right: Preview Panel */}`). Inside the `<div style={{ overflowY: "auto", flex: 1, ... }}>`, the current content shows `{previewAnalysis ? ( ... ) : ( ... )}`.

Replace the entire conditional (`{previewAnalysis ? ... : ...}`) with:

```tsx
              {previewAnalysis ? (
                <>
                  {/* Root Cause section */}
                  <div className="hd-analysis-section" style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 4, color: "var(--hd-text)" }}>
                      Root Cause
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "var(--hd-text-muted)" }}>
                      {previewAnalysis.root_cause}
                    </div>
                  </div>

                  {/* Suggested Fix */}
                  <div className="hd-analysis-section" style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 4, color: "var(--hd-text)" }}>
                      Suggested Fix
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "var(--hd-text-muted)", whiteSpace: "pre-wrap" }}>
                      {previewAnalysis.suggested_fixes}
                    </div>
                  </div>

                  {/* Timeline / Details section */}
                  <div className="hd-analysis-section" style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 4, color: "var(--hd-text)" }}>
                      Details
                    </div>
                    <div
                      style={{
                        borderLeft: "2px solid rgba(16,185,129,0.3)",
                        paddingLeft: 10,
                        fontSize: "0.78rem",
                        color: "var(--hd-text-muted)",
                      }}
                    >
                      <div style={{ marginBottom: 4 }}>
                        Analyzed: {format(new Date(previewAnalysis.analyzed_at), "MMM d, yyyy 'at' h:mm a")}
                      </div>
                      <div style={{ marginBottom: 4 }}>Error: {previewAnalysis.error_type}</div>
                      <div style={{ marginBottom: 4 }}>
                        Component: {previewAnalysis.component || "\u2014"}
                      </div>
                      <div>Cost: ${previewAnalysis.cost.toFixed(4)}</div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 flex-wrap" style={{ marginTop: 12 }}>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleView(previewAnalysis.id)}
                    >
                      Open Full Detail
                    </Button>
                    <Button
                      variant="ghost-danger"
                      size="sm"
                      onClick={() => handleDelete(previewAnalysis.id, previewAnalysis.filename)}
                    >
                      Delete
                    </Button>
                  </div>
                </>
              ) : previewJiraBrief ? (
                <>
                  {/* JIRA Ticket Header */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--hd-text)", marginBottom: 4 }}>
                      {previewJiraBrief.jira_key}
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "var(--hd-text-muted)" }}>
                      {previewJiraBrief.title}
                    </div>
                  </div>

                  {/* Triage Info */}
                  <div className="hd-analysis-section" style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 6, color: "var(--hd-text)" }}>
                      Triage
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                      {previewJiraBrief.severity && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${getSeverityBadgeClasses(previewJiraBrief.severity)}`}>
                          {previewJiraBrief.severity}
                        </span>
                      )}
                      {previewJiraBrief.category && (
                        <span style={{
                          fontSize: "0.72rem",
                          padding: "2px 8px",
                          borderRadius: 9999,
                          background: "rgba(99,102,241,0.12)",
                          color: "rgb(129,140,248)",
                          fontWeight: 600,
                        }}>
                          {previewJiraBrief.category}
                        </span>
                      )}
                    </div>
                    {previewJiraBrief.customer && (
                      <div style={{ fontSize: "0.78rem", color: "var(--hd-text-dim)" }}>
                        Customer: {previewJiraBrief.customer}
                      </div>
                    )}
                  </div>

                  {/* Brief Summary (if available) */}
                  {previewJiraBrief.brief_json && (() => {
                    try {
                      const brief = JSON.parse(previewJiraBrief.brief_json);
                      const summary = brief?.analysis?.executive_summary || brief?.analysis?.summary;
                      if (!summary) return null;
                      return (
                        <div className="hd-analysis-section" style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 4, color: "var(--hd-text)" }}>
                            Brief Summary
                          </div>
                          <div style={{ fontSize: "0.78rem", color: "var(--hd-text-muted)" }}>
                            {summary}
                          </div>
                        </div>
                      );
                    } catch { return null; }
                  })()}

                  {/* Details */}
                  <div className="hd-analysis-section" style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 4, color: "var(--hd-text)" }}>
                      Details
                    </div>
                    <div
                      style={{
                        borderLeft: "2px solid rgba(99,102,241,0.3)",
                        paddingLeft: 10,
                        fontSize: "0.78rem",
                        color: "var(--hd-text-muted)",
                      }}
                    >
                      <div style={{ marginBottom: 4 }}>
                        Updated: {format(new Date(previewJiraBrief.updated_at), "MMM d, yyyy 'at' h:mm a")}
                      </div>
                      <div style={{ marginBottom: 4 }}>
                        Status: {previewJiraBrief.posted_to_jira ? "Posted to JIRA" : previewJiraBrief.brief_json ? "Brief generated" : "Triaged"}
                      </div>
                      {previewJiraBrief.engineer_rating && (
                        <div style={{ marginBottom: 4 }}>
                          Rating: {"★".repeat(previewJiraBrief.engineer_rating)}{"☆".repeat(5 - previewJiraBrief.engineer_rating)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 flex-wrap" style={{ marginTop: 12 }}>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onViewJiraTicket(previewJiraBrief.jira_key)}
                    >
                      Open in JIRA Analyzer
                    </Button>
                    <Button
                      variant="ghost-danger"
                      size="sm"
                      onClick={() => handleDeleteJiraBrief(previewJiraBrief.jira_key, previewJiraBrief.title)}
                    >
                      Delete
                    </Button>
                  </div>
                </>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    color: "var(--hd-text-dim)",
                    fontSize: "0.85rem",
                  }}
                >
                  Select an item to preview
                </div>
              )}
```

**Step 2 — Update preview header to show JIRA key**

Find the preview panel header (~line 1419):

```tsx
              <span className="text-xs" style={{ color: "var(--hd-text-dim)" }}>
                #{previewAnalysis?.id ?? "\u2014"}
              </span>
```

Replace with:

```tsx
              <span className="text-xs" style={{ color: "var(--hd-text-dim)" }}>
                {previewAnalysis ? `#${previewAnalysis.id}` : previewJiraBrief ? previewJiraBrief.jira_key : "\u2014"}
              </span>
```

**Step 3 — Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -i "HistoryView\|history"
```

Expected: no errors from HistoryView.

**Step 4 — Commit**

```bash
git add hadron-desktop/src/components/HistoryView.tsx
git commit -m "feat(history): add JIRA brief preview panel with triage info and navigation"
```

---

### Task 7: Clean up old unused code paths

**Files:**
- Modify: `hadron-desktop/src/components/HistoryView.tsx`

**Step 1 — Remove old `quickFilteredGroups` and `sortedAnalyses` / `groupedAnalyses` memos**

The old `sortedAnalyses`, `groupedAnalyses`, and `quickFilteredGroups` `useMemo` blocks are now replaced by `unifiedItems`, `sortedUnifiedItems`, and `groupedUnifiedItems`. Remove the old three memos (lines ~753–822 in the original file). Be careful — search for any remaining references to these variables and update them:

- `quickFilteredGroups` → replaced by `groupedUnifiedItems`
- `displayedAnalyses` → replaced by `displayedItems`
- `sortedAnalyses` → no longer used
- `groupedAnalyses` → no longer used

**Step 2 — Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -i "HistoryView"
```

Expected: no errors.

**Step 3 — Smoke test**

Run the dev server (`npm run tauri dev`). Open the History tab. Verify:
- JIRA items appear in the list with "JIRA" badge
- "Analyses" chip filters to analyses only
- "JIRA" chip filters to JIRA briefs only
- Clicking a JIRA item shows the preview with triage info
- "Open in JIRA Analyzer" button navigates to the JIRA tab
- Sorting by severity works (JIRA items sort alongside analyses)
- Delete works on JIRA items

**Step 4 — Commit**

```bash
git add hadron-desktop/src/components/HistoryView.tsx
git commit -m "refactor(history): remove old analysis-only sort/group/filter memos"
```

---

## Execution Summary

| Task | What | Files | Risk |
|------|------|-------|------|
| 1 | Rust `get_all_briefs` query | ticket_briefs.rs, database.rs | Low |
| 2 | Tauri command + TS API | jira_assist.rs, main.rs, jira-assist.ts | Low |
| 3 | `onViewJiraTicket` prop wiring | HistoryView.tsx, App.tsx | Low |
| 4 | Load briefs + unified item list | HistoryView.tsx | Medium |
| 5 | Quick-filter chips + unified list rendering | HistoryView.tsx | Medium |
| 6 | JIRA preview panel | HistoryView.tsx | Low |
| 7 | Clean up old code paths | HistoryView.tsx | Low |
