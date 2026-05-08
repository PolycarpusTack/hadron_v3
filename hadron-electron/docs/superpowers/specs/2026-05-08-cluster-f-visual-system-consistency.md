# Cluster F: Visual System Consistency

## Goal

Eliminate the visual inconsistency created by Tailwind's built-in gray scale being used alongside the `--hd-*` design token system. The fix targets the 8–10 highest-traffic surfaces, replacing hardcoded Tailwind gray values with the authoritative token equivalents. No new files, no component API changes.

## Background

The `--hd-*` token system is fully defined in `src/styles.css` (colors, typography scale, radius, shadow). However, most component files also use Tailwind's default gray scale (`text-gray-400`, `bg-gray-800`, `border-gray-700`, etc.). This creates two problems:

1. **Real visual inconsistency** — Tailwind's gray scale has a slight blue tint; the `--hd-*` background and border tokens are darker pure-neutral values. Components using each system look slightly different side by side.
2. **Semantic inconsistency** — For text colors the hex values happen to match (`text-gray-400` == `--hd-text-muted`), but the token name carries meaning (muted, dim, primary) that the Tailwind class does not. Maintenance suffers.

Tailwind 3.4 supports arbitrary CSS-variable syntax (`bg-[var(--hd-bg-surface)]`), so all replacements stay in `className` — no inline `style` sprawl.

## Scope

### In scope

| File | Violations | Notes |
|------|-----------|-------|
| `src/components/AskHadronView.tsx` | 33 | Full sweep |
| `src/components/AnalysisDetailView.tsx` | 31 | Full sweep |
| `src/components/ChatMessageBubble.tsx` | 20+ | Fix prose/UI chrome; keep intentional code-block styling |
| `src/components/settings/AiProviderSection.tsx` | 14 | Full sweep |
| `src/components/settings/MaintenanceSection.tsx` | 8 | Full sweep |
| `src/components/settings/PreferencesSection.tsx` | 2 | Bundled minor cleanup |
| `src/components/settings/SettingsDashboard.tsx` | 2 | Bundled minor cleanup |
| `src/components/settings/SettingsSidebar.tsx` | 1 | Bundled minor cleanup |
| `src/components/settings/CodexMgXSettings.tsx` | 1 | Bundled minor cleanup |
| `src/components/AppHeader.tsx` | 2 | Minor cleanup |

### Out of scope (this cluster)

`HistoryView.tsx`, `Navigation.tsx` — already clean (0 violations).

All other components (analyzer entry panels, JIRA/Sentry/ReleaseNotes views, export dialogs, diagnostics, code/performance analyzer tabs) — left for a future cluster.

---

## Token Replacement Rules

Authoritative mapping for all implementers. Apply consistently across all in-scope files.

### Text colors

| Remove | Replace with | Notes |
|--------|-------------|-------|
| `text-gray-100` | `text-[var(--hd-text)]` | Same hex — semantic |
| `text-gray-200` | `text-[var(--hd-text)]` | Same hex — semantic |
| `text-gray-300` | `text-[var(--hd-text-muted)]` | Same hex — semantic |
| `text-gray-400` | `text-[var(--hd-text-muted)]` | Same hex — semantic |
| `text-gray-500` | `text-[var(--hd-text-dim)]` | Same hex — semantic |
| `text-gray-600` | `text-[var(--hd-text-dim)]` | Closest token |

### Backgrounds

| Remove | Replace with | Notes |
|--------|-------------|-------|
| `bg-gray-700` | `bg-[var(--hd-bg-hover)]` | Used for hover highlight surfaces |
| `bg-gray-800` | `bg-[var(--hd-bg-surface)]` | Slight visual shift: darker, neutral |
| `bg-gray-900` | `bg-[var(--hd-bg-raised)]` | Slight visual shift |
| `bg-gray-800/50` | `bg-[var(--hd-bg-surface)]/60` | Opacity modifier preserved |
| `bg-gray-700/50` | `bg-[var(--hd-bg-surface)]/60` | Opacity modifier preserved |

### Borders

| Remove | Replace with | Notes |
|--------|-------------|-------|
| `border-gray-700` | `border-[var(--hd-border)]` | Slight visual shift: darker |
| `border-gray-700/50` | `border-[var(--hd-border-subtle)]` | Subtle border |
| `border-gray-800` | `border-[var(--hd-border-subtle)]` | Subtle border |

### Typography

| Remove | Replace with | Notes |
|--------|-------------|-------|
| `text-[10px]` | `hd-text-3xs` | Switches to type scale (10px + defined line-height) |
| `text-[11px]` | `hd-text-2xs` | Switches to type scale (11px + defined line-height) |

### Hover and focus variants

Apply the same mapping to Tailwind state variants. `hover:bg-gray-700` → `hover:bg-[var(--hd-bg-hover)]`, `focus:border-gray-700` → `focus:border-[var(--hd-border)]`, etc. The color part of the class follows the table above regardless of the variant prefix.

### Exceptions — ChatMessageBubble markdown renderer

Leave these as-is — they are intentional content-specific styling, not UI chrome:
- Inline code: `text-emerald-300 bg-gray-700/50` — code colour distinction
- `border-gray-700` inside `<table>` cells — markdown table grid

---

## Architecture

- No new files
- No new CSS classes
- No component API changes (no new props, no new types)
- One commit per surface
- TypeScript check (`npx tsc -p tsconfig.web.json --noEmit`) after each surface
- Full test suite (`npm test`) must stay green throughout

## Testing

Each surface: verify TypeScript passes. After all surfaces: visual check in dev server — all affected surfaces should show the same border and background tones as `Navigation.tsx` and `HistoryView.tsx` (the reference clean components). No behavioral change, no new test cases needed.
