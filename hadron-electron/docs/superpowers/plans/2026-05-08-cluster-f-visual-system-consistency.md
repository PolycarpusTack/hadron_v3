# Cluster F: Visual System Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded Tailwind gray values with the `--hd-*` design token system across the 10 highest-traffic component files, eliminating the visual inconsistency between Tailwind's blue-tinted gray scale and the app's pure-dark neutral tokens.

**Architecture:** Purely cosmetic — no component API changes, no new files, no new CSS classes. All replacements stay in `className` attributes using Tailwind's arbitrary CSS-variable syntax (`bg-[var(--hd-bg-surface)]`). Token exceptions for intentional code-block styling in `ChatMessageBubble` are documented per task. One commit per surface.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3.4 (arbitrary value syntax), `--hd-*` CSS custom properties defined in `src/styles.css`.

---

## Token Mapping Reference

Every task uses this table. Do not deviate — consistency across files is the goal.

| Remove | Replace with |
|--------|-------------|
| `text-gray-100` | `text-[var(--hd-text)]` |
| `text-gray-200` | `text-[var(--hd-text)]` |
| `text-gray-300` | `text-[var(--hd-text)]` |
| `text-gray-400` | `text-[var(--hd-text-muted)]` |
| `text-gray-500` | `text-[var(--hd-text-dim)]` |
| `text-gray-600` | `text-[var(--hd-text-dim)]` |
| `bg-gray-700` | `bg-[var(--hd-bg-hover)]` |
| `bg-gray-800` | `bg-[var(--hd-bg-surface)]` |
| `bg-gray-900` | `bg-[var(--hd-bg-raised)]` |
| `bg-gray-700/50` | `bg-[var(--hd-bg-surface)]/60` |
| `bg-gray-800/50` | `bg-[var(--hd-bg-surface)]/60` |
| `bg-gray-800/60` | `bg-[var(--hd-bg-surface)]/60` |
| `bg-gray-900/50` | `bg-[var(--hd-bg-raised)]/60` |
| `bg-gray-900/45` | `bg-[var(--hd-bg-raised)]/50` |
| `border-gray-600` | `border-[var(--hd-border)]` |
| `border-gray-700` | `border-[var(--hd-border)]` |
| `border-gray-700/50` | `border-[var(--hd-border-subtle)]` |
| `border-gray-800` | `border-[var(--hd-border-subtle)]` |
| `placeholder-gray-500` | `placeholder-[var(--hd-text-dim)]` |
| `hover:bg-gray-600` | `hover:bg-[var(--hd-bg-surface)]` |
| `hover:bg-gray-700` | `hover:bg-[var(--hd-bg-hover)]` |
| `hover:bg-gray-700/50` | `hover:bg-[var(--hd-bg-surface)]/60` |
| `hover:text-gray-200` | `hover:text-[var(--hd-text)]` |
| `hover:text-gray-300` | `hover:text-[var(--hd-text)]` |
| `hover:border-gray-600` | `hover:border-[var(--hd-border)]` |
| `disabled:bg-gray-700` | `disabled:bg-[var(--hd-bg-hover)]` |
| `disabled:text-gray-500` | `disabled:text-[var(--hd-text-dim)]` |
| `text-[10px]` | `hd-text-3xs` |
| `text-[11px]` | `hd-text-2xs` |

**State variant rule:** Apply the same mapping to any Tailwind state prefix. `focus:border-gray-700` → `focus:border-[var(--hd-border)]`, `peer-checked:bg-gray-700` → `peer-checked:bg-[var(--hd-bg-hover)]`, etc.

**Do not replace** non-gray colors (`text-emerald-*`, `text-blue-*`, `text-red-*`, etc.) or `after:border-gray-300` (checkbox knob border — intentional white/gray styling for the toggle knob visual).

---

## File Map

| File | Task |
|------|------|
| `src/components/AppHeader.tsx` | Task 1 |
| `src/components/ChatMessageBubble.tsx` | Task 2 |
| `src/components/AskHadronView.tsx` | Task 3 |
| `src/components/AnalysisDetailView.tsx` | Task 4 |
| `src/components/settings/AiProviderSection.tsx` | Task 5 |
| `src/components/settings/MaintenanceSection.tsx` | Task 6 |
| `src/components/settings/PreferencesSection.tsx` | Task 7 |
| `src/components/settings/SettingsDashboard.tsx` | Task 7 |
| `src/components/settings/SettingsSidebar.tsx` | Task 7 |
| `src/components/settings/CodexMgXSettings.tsx` | Task 7 |

---

## Task 1: AppHeader.tsx

**Files:**
- Modify: `src/components/AppHeader.tsx`

2 violations — both are arbitrary `text-[10px]` sizes that should use the type scale.

- [ ] **Step 1: Apply replacements**

Find (line ~121):
```tsx
                <span className="text-[10px]" style={{ color: "var(--hd-text-dim)" }}>
```
Replace with:
```tsx
                <span className="hd-text-3xs" style={{ color: "var(--hd-text-dim)" }}>
```

Find (line ~139):
```tsx
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px]"
```
Replace with:
```tsx
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 hd-text-3xs"
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/AppHeader.tsx
git commit -m "style(header): replace arbitrary text-[10px] with hd-text-3xs token"
```

---

## Task 2: ChatMessageBubble.tsx

**Files:**
- Modify: `src/components/ChatMessageBubble.tsx`

20+ violations across prose elements and UI chrome. **Exception:** inline code (`text-emerald-300 bg-gray-700/50`) and table cell borders (`border-gray-700` inside `<th>` and `<td>`) are intentional — leave them untouched.

- [ ] **Step 1: Fix prose markdown elements (lines 47–97)**

Find (line ~47):
```tsx
    <p className="text-sm text-gray-200 mb-2 last:mb-0">{children}</p>
```
Replace with:
```tsx
    <p className="text-sm text-[var(--hd-text)] mb-2 last:mb-0">{children}</p>
```

Find (line ~64) — pre block (leave the `bg-gray-700/50` in the sibling `<code>` at line ~59 untouched):
```tsx
        className={`block bg-gray-900/50 border border-gray-700 rounded-md p-3 text-xs overflow-x-auto my-2 ${className || ""}`}
```
Replace with:
```tsx
        className={`block bg-[var(--hd-bg-raised)]/60 border border-[var(--hd-border)] rounded-md p-3 text-xs overflow-x-auto my-2 ${className || ""}`}
```

Find (line ~72):
```tsx
    <ul className="text-sm text-gray-200 list-disc pl-4 mb-2 space-y-1">
```
Replace with:
```tsx
    <ul className="text-sm text-[var(--hd-text)] list-disc pl-4 mb-2 space-y-1">
```

Find (line ~77):
```tsx
    <ol className="text-sm text-gray-200 list-decimal pl-4 mb-2 space-y-1">
```
Replace with:
```tsx
    <ol className="text-sm text-[var(--hd-text)] list-decimal pl-4 mb-2 space-y-1">
```

Find (line ~82):
```tsx
    <h1 className="text-base font-bold text-gray-100 mt-3 mb-2">
```
Replace with:
```tsx
    <h1 className="text-base font-bold text-[var(--hd-text)] mt-3 mb-2">
```

Find (line ~87):
```tsx
    <h2 className="text-sm font-bold text-gray-100 mt-3 mb-1.5">
```
Replace with:
```tsx
    <h2 className="text-sm font-bold text-[var(--hd-text)] mt-3 mb-1.5">
```

Find (line ~92):
```tsx
    <h3 className="text-sm font-semibold text-gray-200 mt-2 mb-1">
```
Replace with:
```tsx
    <h3 className="text-sm font-semibold text-[var(--hd-text)] mt-2 mb-1">
```

Find (line ~97):
```tsx
    <blockquote className="border-l-2 border-emerald-500/30 pl-3 italic text-gray-400 my-2">
```
Replace with:
```tsx
    <blockquote className="border-l-2 border-emerald-500/30 pl-3 italic text-[var(--hd-text-muted)] my-2">
```

- [ ] **Step 2: Fix UI chrome — bubble background and action buttons (lines 205–443)**

Find (line ~205) — assistant bubble background:
```tsx
            : "bg-gray-800/50 border border-gray-700 rounded-2xl rounded-bl-md"
```
Replace with:
```tsx
            : "bg-[var(--hd-bg-surface)]/60 border border-[var(--hd-border)] rounded-2xl rounded-bl-md"
```

Find (line ~210) — streaming plain text:
```tsx
            <p className="text-sm text-gray-200 whitespace-pre-wrap">
```
Replace with:
```tsx
            <p className="text-sm text-[var(--hd-text)] whitespace-pre-wrap">
```

Find (line ~218) — copy button:
```tsx
                  className="p-1 rounded text-gray-500 hover:bg-gray-700/50 hover:text-gray-300 transition"
```
Replace with:
```tsx
                  className="p-1 rounded text-[var(--hd-text-dim)] hover:bg-[var(--hd-bg-surface)]/60 hover:text-[var(--hd-text)] transition"
```

Find (line ~265) — streaming indicator text:
```tsx
              <span className="inline-flex items-center gap-1.5 text-sm text-gray-500">
```
Replace with:
```tsx
              <span className="inline-flex items-center gap-1.5 text-sm text-[var(--hd-text-dim)]">
```

Find (line ~279) — footer divider:
```tsx
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700/50">
```
Replace with:
```tsx
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--hd-border-subtle)]">
```

Find (line ~315) — tool tag (emerald):
```tsx
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400/70 rounded text-[10px]">
```
Replace with:
```tsx
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400/70 rounded hd-text-3xs">
```

Find (line ~321) — tool tag (blue):
```tsx
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/10 text-blue-400/70 rounded text-[10px]">
```
Replace with:
```tsx
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/10 text-blue-400/70 rounded hd-text-3xs">
```

Find (line ~327) — tool tag (amber):
```tsx
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/10 text-amber-400/70 rounded text-[10px]">
```
Replace with:
```tsx
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/10 text-amber-400/70 rounded hd-text-3xs">
```

Find (line ~333) — tool tag (neutral gray):
```tsx
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-500/10 text-gray-400/70 rounded text-[10px]">
```
Replace with:
```tsx
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[var(--hd-bg-surface)]/20 text-[var(--hd-text-muted)]/70 rounded hd-text-3xs">
```

Find (line ~347) — action button class string (first occurrence):
```tsx
                    : "text-gray-500 hover:bg-gray-700/50 hover:text-gray-300"
```
Replace with:
```tsx
                    : "text-[var(--hd-text-dim)] hover:bg-[var(--hd-bg-surface)]/60 hover:text-[var(--hd-text)]"
```

Find (line ~359) — action button class string (second occurrence, same pattern):
```tsx
                    : "text-gray-500 hover:bg-gray-700/50 hover:text-gray-300"
```
Replace with:
```tsx
                    : "text-[var(--hd-text-dim)] hover:bg-[var(--hd-bg-surface)]/60 hover:text-[var(--hd-text)]"
```

Find (line ~368) — copy button on code block:
```tsx
                className="p-1 rounded hover:bg-gray-700/50 transition text-gray-500 hover:text-gray-300"
```
Replace with:
```tsx
                className="p-1 rounded hover:bg-[var(--hd-bg-surface)]/60 transition text-[var(--hd-text-dim)] hover:text-[var(--hd-text)]"
```

Find (line ~373) — failed label:
```tsx
                    <span className="text-[10px] text-red-400 px-0.5">Failed</span>
```
Replace with:
```tsx
                    <span className="hd-text-3xs text-red-400 px-0.5">Failed</span>
```

Find (line ~388) — action button class string (third occurrence):
```tsx
                      : "text-gray-500 hover:bg-gray-700/50 hover:text-gray-300"
```
Replace with:
```tsx
                      : "text-[var(--hd-text-dim)] hover:bg-[var(--hd-bg-surface)]/60 hover:text-[var(--hd-text)]"
```

Find (line ~401) — icon action button:
```tsx
                className="p-1 rounded hover:bg-gray-700/50 transition text-gray-500 hover:text-gray-300"
```
Replace with:
```tsx
                className="p-1 rounded hover:bg-[var(--hd-bg-surface)]/60 transition text-[var(--hd-text-dim)] hover:text-[var(--hd-text)]"
```

Find (line ~418) — feedback toggle inactive class:
```tsx
                    : "bg-gray-800/50 border-gray-700/50 text-gray-400 hover:border-gray-600 hover:text-gray-300"
```
Replace with:
```tsx
                    : "bg-[var(--hd-bg-surface)]/60 border-[var(--hd-border-subtle)] text-[var(--hd-text-muted)] hover:border-[var(--hd-border)] hover:text-[var(--hd-text)]"
```

Find (line ~430) — error text below bubble:
```tsx
          <div className="mt-1 text-[10px] text-red-400/60">
```
Replace with:
```tsx
          <div className="mt-1 hd-text-3xs text-red-400/60">
```

Find (line ~443) — tool pill chip (the one we added in Cluster E):
```tsx
                className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800/60 border border-gray-700/50 text-gray-400"
```
Replace with:
```tsx
                className="px-1.5 py-0.5 rounded hd-text-3xs bg-[var(--hd-bg-surface)]/60 border border-[var(--hd-border-subtle)] text-[var(--hd-text-muted)]"
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatMessageBubble.tsx
git commit -m "style(chat): replace hardcoded grays with hd-* tokens in ChatMessageBubble"
```

---

## Task 3: AskHadronView.tsx

**Files:**
- Modify: `src/components/AskHadronView.tsx`

33 violations across the conversation sidebar, header, empty state, and input area.

- [ ] **Step 1: Fix sidebar panel and conversation list (lines 768–880)**

Find (line ~768) — sidebar panel bg:
```tsx
        <div className="hd-panel-soft flex w-64 flex-shrink-0 flex-col bg-gray-900/45">
```
Replace with:
```tsx
        <div className="hd-panel-soft flex w-64 flex-shrink-0 flex-col bg-[var(--hd-bg-raised)]/50">
```

Find (line ~775) — disabled new-chat button:
```tsx
                ? "bg-gray-700 text-gray-500 cursor-not-allowed"
```
Replace with:
```tsx
                ? "bg-[var(--hd-bg-hover)] text-[var(--hd-text-dim)] cursor-not-allowed"
```

Find (line ~791) — empty conversations text:
```tsx
              <p className="text-gray-500 text-xs text-center py-4">
```
Replace with:
```tsx
              <p className="text-[var(--hd-text-dim)] text-xs text-center py-4">
```

Find (line ~811) — conversation list item inactive class:
```tsx
                    : `text-gray-400 ${!isLoading ? "hover:bg-gray-700/50 hover:text-gray-200" : ""}`
```
Replace with:
```tsx
                    : `text-[var(--hd-text-muted)] ${!isLoading ? "hover:bg-[var(--hd-bg-surface)]/60 hover:text-[var(--hd-text)]" : ""}`
```

Find (line ~836) — conversation item options button hover:
```tsx
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-gray-300 transition"
```
Replace with:
```tsx
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-[var(--hd-text)] transition"
```

Find (line ~849) — context menu popup:
```tsx
                className="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 min-w-[140px]"
```
Replace with:
```tsx
                className="fixed bg-[var(--hd-bg-surface)] border border-[var(--hd-border)] rounded-lg shadow-xl py-1 z-50 min-w-[140px]"
```

Find (line ~858) — context menu item (rename):
```tsx
                className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 transition flex items-center gap-2"
```
Replace with:
```tsx
                className="w-full text-left px-3 py-1.5 text-xs text-[var(--hd-text)] hover:bg-[var(--hd-bg-hover)] transition flex items-center gap-2"
```

Find (line ~873) — context menu item (duplicate):
```tsx
                className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 transition flex items-center gap-2"
```
Replace with:
```tsx
                className="w-full text-left px-3 py-1.5 text-xs text-[var(--hd-text)] hover:bg-[var(--hd-bg-hover)] transition flex items-center gap-2"
```

Find (line ~880) — context menu item (delete — red, only fix hover bg):
```tsx
                className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-700 transition flex items-center gap-2"
```
Replace with:
```tsx
                className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-[var(--hd-bg-hover)] transition flex items-center gap-2"
```

- [ ] **Step 2: Fix chat header area (lines 893–940)**

Find (line ~893) — header bottom border:
```tsx
        <div className="border-b border-gray-700 px-6 py-4">
```
Replace with:
```tsx
        <div className="border-b border-[var(--hd-border)] px-6 py-4">
```

Find (line ~902) — header icon button:
```tsx
              className="p-1.5 rounded-md hover:bg-gray-700/50 transition text-gray-400"
```
Replace with:
```tsx
              className="p-1.5 rounded-md hover:bg-[var(--hd-bg-surface)]/60 transition text-[var(--hd-text-muted)]"
```

Find (line ~909) — subtitle:
```tsx
              <p className="text-sm text-gray-400">AI Assistant</p>
```
Replace with:
```tsx
              <p className="text-sm text-[var(--hd-text-muted)]">AI Assistant</p>
```

Find (lines ~920–921) — model selector disabled/active classes:
```tsx
                    ? "text-gray-600 cursor-not-allowed"
                    : "text-gray-400 hover:bg-gray-700/50 hover:text-gray-200"
```
Replace with:
```tsx
                    ? "text-[var(--hd-text-dim)] cursor-not-allowed"
                    : "text-[var(--hd-text-muted)] hover:bg-[var(--hd-bg-surface)]/60 hover:text-[var(--hd-text)]"
```

Find (lines ~939–940) — clear button disabled/active classes:
```tsx
                    ? "text-gray-600 cursor-not-allowed"
                    : "text-gray-400 hover:text-gray-200"
```
Replace with:
```tsx
                    ? "text-[var(--hd-text-dim)] cursor-not-allowed"
                    : "text-[var(--hd-text-muted)] hover:text-[var(--hd-text)]"
```

- [ ] **Step 3: Fix empty state and suggested prompts (lines 971–991)**

Find (line ~971) — empty state heading:
```tsx
                <h3 className="text-lg font-semibold text-gray-200 mb-1">
```
Replace with:
```tsx
                <h3 className="text-lg font-semibold text-[var(--hd-text)] mb-1">
```

Find (line ~974) — empty state subtext:
```tsx
                <p className="text-sm text-gray-400 max-w-md">
```
Replace with:
```tsx
                <p className="text-sm text-[var(--hd-text-muted)] max-w-md">
```

Find (line ~991) — suggested prompt button:
```tsx
                    className="px-3 py-2.5 text-left text-sm text-gray-300 bg-gray-800/50 border border-gray-700 rounded-lg hover:bg-gray-700/50 hover:border-emerald-500/30 hover:text-emerald-300 transition"
```
Replace with:
```tsx
                    className="px-3 py-2.5 text-left text-sm text-[var(--hd-text)] bg-[var(--hd-bg-surface)]/60 border border-[var(--hd-border)] rounded-lg hover:bg-[var(--hd-bg-hover)]/60 hover:border-emerald-500/30 hover:text-emerald-300 transition"
```

- [ ] **Step 4: Fix input toolbar and textarea (lines 1023–1156)**

Find (line ~1023) — input area top border:
```tsx
        <div className="border-t border-gray-700 px-4 py-3">
```
Replace with:
```tsx
        <div className="border-t border-[var(--hd-border)] px-4 py-3">
```

Find (line ~1032) — toolbar button inactive (first occurrence):
```tsx
                  : "bg-gray-700/50 text-gray-500 border border-gray-600 hover:text-gray-300"
```
Replace with:
```tsx
                  : "bg-[var(--hd-bg-surface)]/60 text-[var(--hd-text-dim)] border border-[var(--hd-border)] hover:text-[var(--hd-text)]"
```

Find (line ~1046) — toolbar button inactive (second occurrence, same pattern):
```tsx
                  : "bg-gray-700/50 text-gray-500 border border-gray-600 hover:text-gray-300"
```
Replace with:
```tsx
                  : "bg-[var(--hd-bg-surface)]/60 text-[var(--hd-text-dim)] border border-[var(--hd-border)] hover:text-[var(--hd-text)]"
```

Find (lines ~1059–1060) — active/inactive toggle button:
```tsx
                  ? "bg-gray-600/50 text-gray-300 border border-gray-500"
                  : "bg-gray-700/50 text-gray-500 border border-gray-600 hover:text-gray-300"
```
Replace with:
```tsx
                  ? "bg-[var(--hd-bg-hover)]/60 text-[var(--hd-text)] border border-[var(--hd-border)]"
                  : "bg-[var(--hd-bg-surface)]/60 text-[var(--hd-text-dim)] border border-[var(--hd-border)] hover:text-[var(--hd-text)]"
```

Find (line ~1068) — vertical separator span:
```tsx
            <span className="w-px h-4 bg-gray-700 mx-0.5" />
```
Replace with:
```tsx
            <span className="w-px h-4 bg-[var(--hd-border)] mx-0.5" />
```

Find (line ~1075) — toolbar button inactive (third occurrence):
```tsx
                  : "bg-gray-700/50 text-gray-500 border border-gray-600 hover:text-gray-300"
```
Replace with:
```tsx
                  : "bg-[var(--hd-bg-surface)]/60 text-[var(--hd-text-dim)] border border-[var(--hd-border)] hover:text-[var(--hd-text)]"
```

Find (line ~1087) — toolbar button inactive (fourth occurrence):
```tsx
                  : "bg-gray-700/50 text-gray-500 border border-gray-600 hover:text-gray-300"
```
Replace with:
```tsx
                  : "bg-[var(--hd-bg-surface)]/60 text-[var(--hd-text-dim)] border border-[var(--hd-border)] hover:text-[var(--hd-text)]"
```

Find (line ~1113) — WON label:
```tsx
            <label className="text-xs text-gray-500">WON Version</label>
```
Replace with:
```tsx
            <label className="text-xs text-[var(--hd-text-dim)]">WON Version</label>
```

Find (line ~1119) — WON input:
```tsx
              className="text-xs bg-gray-800 border border-gray-600 rounded-md px-2 py-1 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 w-24"
```
Replace with:
```tsx
              className="text-xs bg-[var(--hd-bg-surface)] border border-[var(--hd-border)] rounded-md px-2 py-1 text-[var(--hd-text)] placeholder-[var(--hd-text-dim)] focus:outline-none focus:border-emerald-500/50 w-24"
```

Find (line ~1121) — Customer label:
```tsx
            <label className="text-xs text-gray-500">Customer</label>
```
Replace with:
```tsx
            <label className="text-xs text-[var(--hd-text-dim)]">Customer</label>
```

Find (line ~1127) — Customer input:
```tsx
              className="text-xs bg-gray-800 border border-gray-600 rounded-md px-2 py-1 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 w-24"
```
Replace with:
```tsx
              className="text-xs bg-[var(--hd-bg-surface)] border border-[var(--hd-border)] rounded-md px-2 py-1 text-[var(--hd-text)] placeholder-[var(--hd-text-dim)] focus:outline-none focus:border-emerald-500/50 w-24"
```

Find (line ~1140) — main textarea:
```tsx
              className="flex-1 resize-none bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition max-h-32"
```
Replace with:
```tsx
              className="flex-1 resize-none bg-[var(--hd-bg-surface)] border border-[var(--hd-border)] rounded-lg px-3 py-2.5 text-sm text-[var(--hd-text)] placeholder-[var(--hd-text-dim)] focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition max-h-32"
```

Find (line ~1156) — send button disabled state:
```tsx
                className="p-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg transition"
```
Replace with:
```tsx
                className="p-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-[var(--hd-bg-hover)] disabled:text-[var(--hd-text-dim)] rounded-lg transition"
```

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/AskHadronView.tsx
git commit -m "style(chat): replace hardcoded grays with hd-* tokens in AskHadronView"
```

---

## Task 4: AnalysisDetailView.tsx

**Files:**
- Modify: `src/components/AnalysisDetailView.tsx`

31 violations across the header breadcrumb, Sentry/JIRA metadata panel, and analysis metadata footer.

- [ ] **Step 1: Fix severity badge default case (line ~1006)**

Find:
```tsx
    default: return "bg-gray-500/20 text-gray-400 border-gray-500/30"
```
Replace with:
```tsx
    default: return "bg-[var(--hd-bg-surface)]/20 text-[var(--hd-text-muted)] border-[var(--hd-border-subtle)]"
```

- [ ] **Step 2: Fix breadcrumb header (lines 1071–1075)**

Find (line ~1071):
```tsx
          <button onClick={onBack} className="flex items-center gap-1.5 text-gray-400 hover:text-white transition">
```
Replace with:
```tsx
          <button onClick={onBack} className="flex items-center gap-1.5 text-[var(--hd-text-muted)] hover:text-white transition">
```

Find (line ~1074):
```tsx
          <span className="text-gray-600">/</span>
```
Replace with:
```tsx
          <span className="text-[var(--hd-text-dim)]">/</span>
```

Find (line ~1075):
```tsx
          <span className="text-gray-400 truncate max-w-xs">{analysis.filename}</span>
```
Replace with:
```tsx
          <span className="text-[var(--hd-text-muted)] truncate max-w-xs">{analysis.filename}</span>
```

- [ ] **Step 3: Fix Sentry/JIRA metadata card (lines 1086–1133)**

Find (line ~1086) — card container:
```tsx
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
```
Replace with:
```tsx
      <div className="bg-[var(--hd-bg-surface)] border border-[var(--hd-border)] rounded-lg p-6">
```

Find (line ~1090) — metadata row:
```tsx
            <div className="flex items-center gap-3 text-sm text-gray-400">
```
Replace with:
```tsx
            <div className="flex items-center gap-3 text-sm text-[var(--hd-text-muted)]">
```

Find (line ~1103):
```tsx
            {sentryData.shortId && <span className="text-gray-400"><span className="text-gray-500">ID:</span> <span className="font-mono text-gray-300">{sentryData.shortId}</span></span>}
```
Replace with:
```tsx
            {sentryData.shortId && <span className="text-[var(--hd-text-muted)]"><span className="text-[var(--hd-text-dim)]">ID:</span> <span className="font-mono text-[var(--hd-text)]">{sentryData.shortId}</span></span>}
```

Find (line ~1104):
```tsx
            {sentryData.platform && <span className="text-gray-400"><span className="text-gray-500">Platform:</span> {sentryData.platform}</span>}
```
Replace with:
```tsx
            {sentryData.platform && <span className="text-[var(--hd-text-muted)]"><span className="text-[var(--hd-text-dim)]">Platform:</span> {sentryData.platform}</span>}
```

Find (line ~1105):
```tsx
            {sentryData.count && <span className="text-gray-400"><span className="text-gray-500">Events:</span> {sentryData.count}</span>}
```
Replace with:
```tsx
            {sentryData.count && <span className="text-[var(--hd-text-muted)]"><span className="text-[var(--hd-text-dim)]">Events:</span> {sentryData.count}</span>}
```

Find (line ~1106):
```tsx
            {sentryData.userCount != null && sentryData.userCount > 0 && <span className="text-gray-400"><span className="text-gray-500">Users:</span> {sentryData.userCount}</span>}
```
Replace with:
```tsx
            {sentryData.userCount != null && sentryData.userCount > 0 && <span className="text-[var(--hd-text-muted)]"><span className="text-[var(--hd-text-dim)]">Users:</span> {sentryData.userCount}</span>}
```

Find (line ~1107) — Sentry level badge default case (inline ternary):
```tsx
"bg-gray-500/20 text-gray-400"
```
Replace with:
```tsx
"bg-[var(--hd-bg-surface)]/20 text-[var(--hd-text-muted)]"
```

Find (line ~1114):
```tsx
            {jiraData.jiraPriority && <span className="text-gray-400"><span className="text-gray-500">Priority:</span> {jiraData.jiraPriority}</span>}
```
Replace with:
```tsx
            {jiraData.jiraPriority && <span className="text-[var(--hd-text-muted)]"><span className="text-[var(--hd-text-dim)]">Priority:</span> {jiraData.jiraPriority}</span>}
```

Find (line ~1115):
```tsx
            {jiraData.jiraStatus && <span className="text-gray-400"><span className="text-gray-500">Status:</span> {jiraData.jiraStatus}</span>}
```
Replace with:
```tsx
            {jiraData.jiraStatus && <span className="text-[var(--hd-text-muted)]"><span className="text-[var(--hd-text-dim)]">Status:</span> {jiraData.jiraStatus}</span>}
```

Find (line ~1116):
```tsx
            {jiraData.jiraComponents?.length && <span className="flex items-center gap-1 text-gray-400"><Package className="w-3 h-3 text-gray-500" />
```
Replace with:
```tsx
            {jiraData.jiraComponents?.length && <span className="flex items-center gap-1 text-[var(--hd-text-muted)]"><Package className="w-3 h-3 text-[var(--hd-text-dim)]" />
```

Find (line ~1117):
```tsx
            {jiraData.jiraLabels?.length && <span className="flex items-center gap-1 text-gray-400"><TagIcon className="w-3 h-3 text-gray-500" />{jiraData.jiraLabels.map(l => <span key={l} className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-300">{l}</span>)}</span>}
```
Replace with:
```tsx
            {jiraData.jiraLabels?.length && <span className="flex items-center gap-1 text-[var(--hd-text-muted)]"><TagIcon className="w-3 h-3 text-[var(--hd-text-dim)]" />{jiraData.jiraLabels.map(l => <span key={l} className="px-1.5 py-0.5 bg-[var(--hd-bg-hover)] rounded text-xs text-[var(--hd-text)]">{l}</span>)}</span>}
```

Find (line ~1133) — coverage chip:
```tsx
            {analysis.coverage_summary && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-700/50 text-gray-300 border border-gray-600"><Info className="w-3.5 h-3.5" />{analysis.coverage_summary}</span>}
```
Replace with:
```tsx
            {analysis.coverage_summary && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--hd-bg-surface)]/60 text-[var(--hd-text)] border border-[var(--hd-border)]"><Info className="w-3.5 h-3.5" />{analysis.coverage_summary}</span>}
```

- [ ] **Step 4: Fix analysis body and metadata footer (lines 1144–1195)**

Find (line ~1144):
```tsx
                <span className="text-xs text-gray-500 mr-1">Detected:</span>
```
Replace with:
```tsx
                <span className="text-xs text-[var(--hd-text-dim)] mr-1">Detected:</span>
```

Find (line ~1159):
```tsx
        <p className="text-gray-300 text-lg font-medium">{analysis.error_type}</p>
```
Replace with:
```tsx
        <p className="text-[var(--hd-text)] text-lg font-medium">{analysis.error_type}</p>
```

Find (line ~1161):
```tsx
              {analysis.component && <div className="mt-3 flex items-center gap-2 text-sm"><Package className="w-4 h-4 text-blue-400" /><span className="text-gray-400">Affected Component:</span><span className="text-blue-400 font-mono">{analysis.component}</span></div>}
```
Replace with:
```tsx
              {analysis.component && <div className="mt-3 flex items-center gap-2 text-sm"><Package className="w-4 h-4 text-blue-400" /><span className="text-[var(--hd-text-muted)]">Affected Component:</span><span className="text-blue-400 font-mono">{analysis.component}</span></div>}
```

Find (line ~1177):
```tsx
              <p className="text-gray-300 flex-1">{fix}</p>
```
Replace with:
```tsx
              <p className="text-[var(--hd-text)] flex-1">{fix}</p>
```

For lines 1185–1195, all `<span className="text-gray-400">` label spans — replace all occurrences of `text-gray-400` on those lines with `text-[var(--hd-text-muted)]`. There are 9 occurrences (Analysis ID, Tokens Used, Model, Provider, Confidence, Cost, Duration, File Size, Truncated, Favorite, Views labels). Apply `replace_all: true` only within this block:

Find:
```tsx
          <div><span className="text-gray-400">Analysis ID:</span>
```
Replace with:
```tsx
          <div><span className="text-[var(--hd-text-muted)]">Analysis ID:</span>
```
Repeat the same `text-gray-400` → `text-[var(--hd-text-muted)]` substitution for each label span on lines 1186–1195 (Tokens Used, Model, Provider, Confidence, Cost, Duration, File Size, Truncated, Favorite, Views).

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/AnalysisDetailView.tsx
git commit -m "style(detail): replace hardcoded grays with hd-* tokens in AnalysisDetailView"
```

---

## Task 5: AiProviderSection.tsx

**Files:**
- Modify: `src/components/settings/AiProviderSection.tsx`

14 violations — primarily input fields and their labels. The recurring input pattern is `bg-gray-900 border border-gray-600` — applies to all text inputs and textareas.

- [ ] **Step 1: Fix status icon color constant (line ~29)**

Find:
```tsx
    return { icon: <AlertCircle className="w-4 h-4" />, color: 'text-gray-500', label: 'No key' };
```
Replace with:
```tsx
    return { icon: <AlertCircle className="w-4 h-4" />, color: 'text-[var(--hd-text-dim)]', label: 'No key' };
```

- [ ] **Step 2: Fix label (line ~188)**

Find:
```tsx
          <label className="text-sm font-medium text-gray-300">{label}</label>
```
Replace with:
```tsx
          <label className="text-sm font-medium text-[var(--hd-text)]">{label}</label>
```

- [ ] **Step 3: Fix input fields — apply these 4 replacements (lines 200, 235, 340, 358, 373)**

All text inputs share the same pattern. Replace each occurrence of the full className string:

Find (line ~200 — password input with visibility toggle):
```tsx
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 pr-10 focus:outline-none focus:border-blue-500 text-sm"
```
Replace with:
```tsx
              className="w-full bg-[var(--hd-bg-raised)] border border-[var(--hd-border)] rounded-lg px-4 py-2.5 pr-10 focus:outline-none focus:border-blue-500 text-sm"
```

Find (line ~235 — plain text input):
```tsx
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm"
```
Replace with:
```tsx
              className="w-full bg-[var(--hd-bg-raised)] border border-[var(--hd-border)] rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm"
```

Find (line ~340 — URL input with placeholder):
```tsx
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500 text-sm placeholder-gray-500"
```
Replace with:
```tsx
            className="w-full bg-[var(--hd-bg-raised)] border border-[var(--hd-border)] rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500 text-sm placeholder-[var(--hd-text-dim)]"
```

Find (line ~358):
```tsx
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm"
```
Replace with:
```tsx
              className="w-full bg-[var(--hd-bg-raised)] border border-[var(--hd-border)] rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm"
```

Find (line ~373):
```tsx
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm"
```
Replace with:
```tsx
            className="w-full bg-[var(--hd-bg-raised)] border border-[var(--hd-border)] rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm"
```

- [ ] **Step 4: Fix visibility toggle button and delete button (lines 204, 212)**

Find (line ~204):
```tsx
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-700 rounded"
```
Replace with:
```tsx
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-[var(--hd-bg-hover)] rounded"
```

Find (line ~212):
```tsx
            className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 disabled:bg-gray-700 disabled:cursor-not-allowed text-red-400 disabled:text-gray-500 rounded-lg transition text-sm"
```
Replace with:
```tsx
            className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 disabled:bg-[var(--hd-bg-hover)] disabled:cursor-not-allowed text-red-400 disabled:text-[var(--hd-text-dim)] rounded-lg transition text-sm"
```

- [ ] **Step 5: Fix helper text and Ollama hint (lines 248–250, 263, 297)**

Find (lines ~248–250):
```tsx
                  <p className="text-xs text-gray-400 mt-1">
                    No API key required. Start <code className="bg-gray-900 px-1 py-0.5 rounded text-blue-400">llama-server</code> on{' '}
                    <code className="bg-gray-900 px-1 py-0.5 rounded text-blue-400">localhost:8080</code>
```
Replace with:
```tsx
                  <p className="text-xs text-[var(--hd-text-muted)] mt-1">
                    No API key required. Start <code className="bg-[var(--hd-bg-raised)] px-1 py-0.5 rounded text-blue-400">llama-server</code> on{' '}
                    <code className="bg-[var(--hd-bg-raised)] px-1 py-0.5 rounded text-blue-400">localhost:8080</code>
```

Find (line ~263):
```tsx
              <span className="text-gray-400 text-sm">Loading Keeper settings…</span>
```
Replace with:
```tsx
              <span className="text-[var(--hd-text-muted)] text-sm">Loading Keeper settings…</span>
```

Find (line ~297):
```tsx
                <p className="text-xs text-gray-500">Keys are encrypted using your OS keychain/credential manager</p>
```
Replace with:
```tsx
                <p className="text-xs text-[var(--hd-text-dim)]">Keys are encrypted using your OS keychain/credential manager</p>
```

- [ ] **Step 6: Verify TypeScript**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/AiProviderSection.tsx
git commit -m "style(settings): replace hardcoded grays with hd-* tokens in AiProviderSection"
```

---

## Task 6: MaintenanceSection.tsx

**Files:**
- Modify: `src/components/settings/MaintenanceSection.tsx`

8 violations — input fields, icon buttons, and a toggle component.

- [ ] **Step 1: Fix input fields (lines 152, 251)**

Find (line ~152 — path input):
```tsx
                className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs font-mono"
```
Replace with:
```tsx
                className="flex-1 bg-[var(--hd-bg-raised)] border border-[var(--hd-border)] rounded px-2 py-1 text-xs font-mono"
```

Find (line ~251 — second path input, same pattern):
```tsx
                className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs font-mono"
```
Replace with:
```tsx
                className="flex-1 bg-[var(--hd-bg-raised)] border border-[var(--hd-border)] rounded px-2 py-1 text-xs font-mono"
```

- [ ] **Step 2: Fix icon buttons (lines 157, 177, 257, 271)**

Find (line ~157):
```tsx
                className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
```
Replace with:
```tsx
                className="p-1.5 rounded bg-[var(--hd-bg-hover)] hover:bg-[var(--hd-bg-surface)] transition-colors"
```

Find (line ~177):
```tsx
                className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
```
Replace with:
```tsx
                className="text-xs px-2 py-1 rounded bg-[var(--hd-bg-hover)] hover:bg-[var(--hd-bg-surface)] transition-colors"
```

Find (line ~257, same as 157):
```tsx
                className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
```
Replace with:
```tsx
                className="p-1.5 rounded bg-[var(--hd-bg-hover)] hover:bg-[var(--hd-bg-surface)] transition-colors"
```

Find (line ~271, same as 177):
```tsx
                className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
```
Replace with:
```tsx
                className="text-xs px-2 py-1 rounded bg-[var(--hd-bg-hover)] hover:bg-[var(--hd-bg-surface)] transition-colors"
```

- [ ] **Step 3: Fix toggle track bg and status text (lines 230, 287)**

Find (line ~230) — the toggle track. Replace only `bg-gray-700` (the unchecked track color); leave `after:border-gray-300` untouched (that's the knob border):
```tsx
                <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600" />
```
Replace with:
```tsx
                <div className="w-9 h-5 bg-[var(--hd-bg-hover)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600" />
```

Find (line ~287):
```tsx
            <div className="flex items-center gap-2 p-2 text-xs text-gray-400">
```
Replace with:
```tsx
            <div className="flex items-center gap-2 p-2 text-xs text-[var(--hd-text-muted)]">
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/MaintenanceSection.tsx
git commit -m "style(settings): replace hardcoded grays with hd-* tokens in MaintenanceSection"
```

---

## Task 7: Minor Settings Files (bundled)

**Files:**
- Modify: `src/components/settings/PreferencesSection.tsx`
- Modify: `src/components/settings/SettingsDashboard.tsx`
- Modify: `src/components/settings/SettingsSidebar.tsx`
- Modify: `src/components/settings/CodexMgXSettings.tsx`

1–2 violations each — bundled into a single commit.

- [ ] **Step 1: PreferencesSection.tsx (lines 61, 162)**

Find (line ~61) — shield icon color in disabled state:
```tsx
            icon={<Shield className={`w-4 h-4 ${piiRedactionEnabled ? 'text-blue-600' : 'text-gray-400'}`} />}
```
Replace with:
```tsx
            icon={<Shield className={`w-4 h-4 ${piiRedactionEnabled ? 'text-blue-600' : 'text-[var(--hd-text-muted)]'}`} />}
```

Find (line ~162) — disabled card overlay:
```tsx
                    : 'bg-gray-900/50 border-gray-700 opacity-60'
```
Replace with:
```tsx
                    : 'bg-[var(--hd-bg-raised)]/60 border-[var(--hd-border)] opacity-60'
```

- [ ] **Step 2: SettingsDashboard.tsx (lines 45, 140)**

Find (line ~45):
```tsx
            <p className="text-sm text-gray-400">
```
Replace with:
```tsx
            <p className="text-sm text-[var(--hd-text-muted)]">
```

Find (line ~140) — same shield icon pattern as PreferencesSection:
```tsx
            icon={<Shield className={`w-4 h-4 ${piiRedactionEnabled ? 'text-blue-600' : 'text-gray-400'}`} />}
```
Replace with:
```tsx
            icon={<Shield className={`w-4 h-4 ${piiRedactionEnabled ? 'text-blue-600' : 'text-[var(--hd-text-muted)]'}`} />}
```

- [ ] **Step 3: SettingsSidebar.tsx (line 89)**

Find (line ~89) — inactive nav item:
```tsx
        : 'text-gray-400 hover:text-gray-200 hover:bg-white/5',
```
Replace with:
```tsx
        : 'text-[var(--hd-text-muted)] hover:text-[var(--hd-text)] hover:bg-white/5',
```

- [ ] **Step 4: CodexMgXSettings.tsx (line 55)**

Find (line ~55) — toggle track (same pattern as MaintenanceSection; leave `after:border-gray-300` untouched):
```tsx
          <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600" />
```
Replace with:
```tsx
          <div className="w-9 h-5 bg-[var(--hd-bg-hover)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600" />
```

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Verify existing tests still pass**

```bash
npm test
```

Expected: 106 tests passing (same as before). Pre-existing `better-sqlite3` ELF mismatch failures on WSL2 are unrelated.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/PreferencesSection.tsx src/components/settings/SettingsDashboard.tsx src/components/settings/SettingsSidebar.tsx src/components/settings/CodexMgXSettings.tsx
git commit -m "style(settings): replace hardcoded grays with hd-* tokens in minor settings sections"
```
