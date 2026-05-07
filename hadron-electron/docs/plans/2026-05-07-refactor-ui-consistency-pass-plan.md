---
title: "refactor: UI consistency pass — tokens, primitives, and screen normalization"
type: refactor
date: 2026-05-07
---

# refactor: UI consistency pass — tokens, primitives, and screen normalization

## Overview

The app shell (Navigation, AppHeader, Settings, Ask Hadron) is visually coherent and uses
the shared `--hd-*` token system and `hd-*` utility classes. Detail-heavy and older screens
bypass these entirely: History has its own terminal-like inline-style system, AnalysisDetailView
renders a full-height shell inside the app shell, CodeAnalyzerView and QuickAnalysisDetailView
use raw `bg-gray-*` / `dark:bg-gray-*` Tailwind, and five screens each hand-roll their own
tab bar while `TabBar.tsx` sits unused.

Goal: bring all seven affected screens into the shared token system without changing any
functional behaviour, data flow, or visual intent — only the implementation.

## Scope

| File | LOC | Primary issue |
|---|---|---|
| `src/components/HistoryView.tsx` | 1,209 | Inline styles throughout; own colour palette; no hd-* |
| `src/components/AnalysisDetailView.tsx` | 1,276 | `minHeight: 100vh` shell inside app shell |
| `src/components/code-analyzer/CodeAnalyzerView.tsx` | 486 | `bg-white dark:bg-gray-800`, violet tab |
| `src/components/QuickAnalysisDetailView.tsx` | 481 | `bg-gray-800 border-gray-700` raw cards |
| `src/components/JiraAnalyzerView.tsx` | 137 | Hand-rolled tab bar |
| `src/components/SentryAnalyzerView.tsx` | 217 | Hand-rolled tab bar |
| `src/components/ReleaseNotesView.tsx` | 267 | Hand-rolled tab bar |

## Token reference

Existing tokens in `src/styles.css` that should replace ad-hoc values:

```
Surface/bg:  --hd-bg-base, --hd-bg-surface, --hd-bg-raised, --hd-bg-surface-2
Border:      --hd-border, --hd-border-subtle
Text:        --hd-text, --hd-text-muted, --hd-text-faint
Accent:      --hd-accent (emerald-400)
Radius:      --hd-radius (12px), --hd-radius-sm (8px)
Font-size:   --hd-font-3xs … --hd-font-lg
Shadow:      --hd-shadow-sm

Utility classes:
  hd-panel          raised card (gradient bg + border + radius + shadow)
  hd-card           subtle inner card
  hd-panel-soft     flat surface with border
  hd-chip           badge pill
  hd-chip-emerald/blue/amber/neutral
  hd-pill-btn       toggle-style button
  hd-pill-btn-active
  hd-search-wrap / hd-search-input
  hd-btn-ghost
  hd-setting-row / hd-setting-card
```

Existing UI primitives in `src/components/ui/`:
- `TabBar.tsx` — generic, supports icon + count badge, `accentColor` prop
- `Button.tsx` — all variants
- `Tag.tsx`, `InfoCard.tsx`, `Section.tsx`

## Implementation Phases

### Phase 1 — Upgrade TabBar and wire it everywhere
**Files:** `TabBar.tsx`, `JiraAnalyzerView.tsx`, `SentryAnalyzerView.tsx`, `ReleaseNotesView.tsx`, `CodeAnalyzerView.tsx`

TabBar currently uses hard-coded `border-gray-700`. Make it use `--hd-border` so it fits both
the token-based screens and legacy ones without a colour mismatch. Then replace every
hand-rolled tab nav with `<TabBar>`.

- [ ] `TabBar.tsx`: replace `border-gray-700` with `style={{ borderColor: 'var(--hd-border)' }}`; replace `text-gray-400 hover:text-gray-300 hover:border-gray-600` with CSS-var equivalents
- [ ] `JiraAnalyzerView.tsx:103–124`: remove hand-rolled nav, import and use `<TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} accentColor="sky" />`
- [ ] `SentryAnalyzerView.tsx:165–191`: same pattern, `accentColor="emerald"`
- [ ] `ReleaseNotesView.tsx:151`: identify and replace hand-rolled tabs
- [ ] `CodeAnalyzerView.tsx`: replace violet tab bar with `<TabBar accentColor="violet" />`

### Phase 2 — CodeAnalyzerView and QuickAnalysisDetailView: token swap
**Files:** `CodeAnalyzerView.tsx`, `QuickAnalysisDetailView.tsx`

These screens use raw Tailwind `bg-gray-*` / `dark:bg-gray-800` / `border-gray-700`. Replace
with `hd-panel`, `hd-card`, and `--hd-*` CSS variables on inline styles that require dynamic
values.

#### `CodeAnalyzerView.tsx`
- [ ] Outer wrapper: `bg-white dark:bg-gray-800` → `hd-panel-soft` or just background: `var(--hd-bg-base)`
- [ ] Inner cards: `bg-gray-700/50 border-gray-600` → `hd-card`
- [ ] Text: `text-gray-*` → `style={{ color: 'var(--hd-text)' }}` / `var(--hd-text-muted)` / `var(--hd-text-faint)`
- [ ] Borders: `border-gray-700` → `style={{ borderColor: 'var(--hd-border)' }}`

#### `QuickAnalysisDetailView.tsx`
- [ ] Cards: `bg-gray-800 border-gray-700` → `hd-panel` or `hd-card`
- [ ] Section headers: raw inline `background: rgba(...)` → `hd-card` or `hd-setting-card`
- [ ] Severity/status chips: raw colour spans → `hd-chip hd-chip-{colour}`

### Phase 3 — AnalysisDetailView: remove inner shell
**File:** `AnalysisDetailView.tsx`

`FlatView` and the WCR view both open with `minHeight: "100vh"` and define their own full-page
container. These are rendered inside the app's already-scrolling content area, causing a
page-within-page layout. The fix is to remove the outer shell and rely on the parent's layout.

- [ ] Locate the outermost `<div style={{ minHeight: "100vh" ... }}>` in both `FlatView` (line ~864) and `WcrView` — remove `minHeight: "100vh"` and the full-page background
- [ ] Replace `background: "#090a0d"` / `background: var(--something)` shell styling with nothing (inherit from app background) or a simple `hd-panel-soft` wrapper for the content
- [ ] Audit for any `position: fixed` or `overflow: hidden` that assumes it is the root scroll container

### Phase 4 — HistoryView: inline style to token migration
**File:** `HistoryView.tsx` (1,209 lines, largest task)

HistoryView is a custom terminal-style UI. The goal is **not** to redesign it — keep its
visual language (monospace font, density, cyan accent) but route its colours through
`--hd-*` tokens so it inherits dark/light mode and remains consistent with the rest of the
app. Structural layout (custom table, sort controls, row actions) stays unchanged.

- [ ] Header section (`background: "#090a0d"`, `color: "#d1d5db"`): use `var(--hd-bg-base)` / `var(--hd-text)`
- [ ] Search input (inline styled): replace with `hd-search-wrap` / `hd-search-input` classes
- [ ] Filter pills (severity, type, quick-filter buttons): map to `hd-pill-btn` / `hd-pill-btn-active`
- [ ] Row background: `background: "rgba(255,255,255,0.02)"` → `var(--hd-bg-surface)` on hover
- [ ] Row borders: `borderColor: "rgba(255,255,255,0.06)"` → `var(--hd-border-subtle)`
- [ ] Cyan accent (`#22d3ee`) can stay — it's a deliberate brand colour for History header; route through `--hd-accent-history: #22d3ee` or just leave as literal (it's not a palette conflict)
- [ ] Severity colour literals (`#ef4444`, `#f59e0b`, `#3b82f6`, `#10b981`) are already in `SEV_COL` module constant — leave as literals, they are semantic status colours not surface colours
- [ ] Column header (`background: "rgba(255,255,255,0.03)"`) → `var(--hd-bg-raised)` or `hd-card`
- [ ] Context menu inline styles → `hd-panel` + token text/border

### Phase 5 — ReleaseNotesView: audit and normalise
**File:** `ReleaseNotesView.tsx`

- [ ] Tab bar (Phase 1 covers this)
- [ ] Any raw `bg-gray-*` cards → `hd-panel` or `hd-card`
- [ ] Any raw `text-gray-*` → CSS variable

## Acceptance Criteria

- [ ] `npx tsc --noEmit` passes with zero errors after each phase
- [ ] `TabBar` component is used in JiraAnalyzerView, SentryAnalyzerView, ReleaseNotesView, CodeAnalyzerView — no remaining hand-rolled tab navs in those files
- [ ] AnalysisDetailView no longer contains `minHeight: "100vh"` or a full-page background
- [ ] CodeAnalyzerView and QuickAnalysisDetailView contain no `bg-gray-800`, `bg-white dark:bg-gray-800`, or `border-gray-700` Tailwind classes on structural containers
- [ ] HistoryView surface/border colours reference `--hd-*` variables; `MONO` font and `SEV_COL` semantic colours may remain as literals
- [ ] No functional regressions: all tabs still switch, all data still displays, JIRA/Sentry/history actions still work
- [ ] Each phase committed separately for easy bisect

## Implementation order rationale

Phase 1 first because it is the smallest, most mechanical, and immediately eliminates the
widest duplication (5 tab bars → 1 component). Each subsequent phase is independent and
can be reviewed as its own commit.
