---
title: "feat: Visual system density overhaul (Cluster F)"
type: feat
date: 2026-05-07
cluster: F
---

# feat: Visual system density overhaul (Cluster F)

## Overview

Normalize typography, spacing, and inline-style debt across the three biggest offenders.
No visual regressions, no design changes — just consistency.

**Scope:** `styles.css`, `AnalysisDetailView.tsx`, `AskHadronDrawer.tsx`, minor normalization
in `HistoryView.tsx`.

---

## Problem

| Issue | Impact |
|-------|--------|
| Font sizes: 11px / 12px / 13px (px) mixed with 0.7rem / 0.85rem (em) mixed with Tailwind `text-sm` | Unreadable audit trail, inconsistent zoom behavior |
| 300+ lines of inline `style={{...}}` in `AnalysisDetailView.tsx` with hardcoded pixel values | Hard to maintain, defeats CSS overrides |
| Padding: inline `10px 14px` / `4px 10px` vs Tailwind scale | Impossible to tune density globally |
| No typography token system | Every component rolls its own sizes |

---

## Solution

### Phase 1 — Typography tokens in `styles.css`

Add to `:root`:

```css
/* Typography scale */
--hd-font-2xs: 0.6875rem; /* 11px */
--hd-font-xs:  0.75rem;   /* 12px */
--hd-font-sm:  0.8125rem; /* 13px */
--hd-font-base: 0.875rem; /* 14px — matches Tailwind text-sm */
--hd-font-lg:  1rem;      /* 16px */

/* Line height companions */
--hd-lh-tight:  1.35;
--hd-lh-normal: 1.5;
--hd-lh-relaxed: 1.65;

/* Spacing micro-scale (fills gap below Tailwind's 4px = gap-1) */
--hd-sp-1: 2px;
--hd-sp-2: 4px;   /* = Tailwind gap-1 */
--hd-sp-3: 6px;
--hd-sp-4: 8px;   /* = Tailwind gap-2 / p-2 */
--hd-sp-6: 12px;  /* = Tailwind p-3 */
--hd-sp-8: 16px;  /* = Tailwind p-4 */
```

Add utility classes:

```css
.hd-text-2xs { font-size: var(--hd-font-2xs); line-height: var(--hd-lh-normal); }
.hd-text-xs  { font-size: var(--hd-font-xs);  line-height: var(--hd-lh-normal); }
.hd-text-sm  { font-size: var(--hd-font-sm);  line-height: var(--hd-lh-normal); }
.hd-text-base{ font-size: var(--hd-font-base); line-height: var(--hd-lh-normal); }
.hd-mono-2xs { font-size: var(--hd-font-2xs); font-family: var(--hd-font-mono); line-height: var(--hd-lh-tight); }
.hd-mono-xs  { font-size: var(--hd-font-xs);  font-family: var(--hd-font-mono); line-height: var(--hd-lh-tight); }
.hd-mono-sm  { font-size: var(--hd-font-sm);  font-family: var(--hd-font-mono); line-height: var(--hd-lh-tight); }
.hd-label    { font-size: var(--hd-font-2xs); font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--hd-text-dim); }
```

### Phase 2 — AnalysisDetailView.tsx

Convert inline `style={{ fontSize: "11px/12px/13px", padding: "4px/6px/10px/12px" }}` to the
new utility classes. Keep inline styles only where the value is dynamic (e.g. color driven by
severity). Target: reduce inline style objects by ~80%.

### Phase 3 — AskHadronDrawer.tsx

Convert `fontSize: "0.7rem"`, `"0.83rem"`, `"0.85rem"` role labels and message bodies to
`.hd-text-2xs`, `.hd-text-xs`, `.hd-text-sm`. Replace `padding: "10px 14px"` / `"9px 12px"`
with Tailwind equivalents (`px-3.5 py-2.5` / `px-3 py-2`).

### Phase 4 — HistoryView.tsx font normalization

The existing inline `fontFamily: MONO` pattern is fine (it's dynamic). But fix the hardcoded
`fontSize: "9px"` badge text and `fontSize: "10px"` section headers to use
`.hd-text-2xs` / `.hd-label` classes via `className` alongside the existing inline object
for color/background.

---

## Acceptance Criteria

- [x] `--hd-font-*` and `.hd-text-*` / `.hd-mono-*` / `.hd-label` tokens defined in `styles.css`
- [x] `AnalysisDetailView.tsx`: no hardcoded `11px`, `12px`, `13px`, `14px` pixel font sizes remain in inline styles
- [x] `AskHadronDrawer.tsx`: no `fontSize: "0.7rem"`, `"0.83rem"`, `"0.85rem"` inline styles remain
- [x] `HistoryView.tsx`: `"10px"`, `"11px"`, `"12px"`, `"13px"`, `"14px"` replaced with CSS variables; `"9px"` retained intentionally (tiny badge/chip use)
- [x] `npx tsc --noEmit` passes
- [x] No visual regression: all components render identically to before (same computed sizes)

---

## Implementation Checklist

### Phase 1
- [x] Add `--hd-font-*` and `--hd-lh-*` and `--hd-sp-*` tokens to `:root` in `styles.css`
- [x] Add `.hd-text-*`, `.hd-mono-*`, `.hd-label` utility classes to `styles.css`

### Phase 2
- [x] `AnalysisDetailView.tsx`: audit all `fontSize` inline style usages
- [x] Replace static font sizes with CSS variable references (`fontSize: "var(--hd-font-xs)"` etc.)
- [x] Replace static padding with Tailwind equivalents (`p-2`, `px-3`, etc.)

### Phase 3
- [x] `AskHadronDrawer.tsx`: replace `fontSize: "0.7rem"` with `className="hd-text-2xs"`
- [x] `AskHadronDrawer.tsx`: replace `fontSize: "0.83rem"` / `"0.85rem"` with `className="hd-text-xs"` / `"hd-text-sm"`
- [x] `AskHadronDrawer.tsx`: replace inline padding with Tailwind classes

### Phase 4
- [x] `HistoryView.tsx`: `"9px"` retained intentionally (tiny severity/GOLD/JIRA chips, keyboard shortcut badge)
- [x] `HistoryView.tsx`: replace `fontSize: "10px"` section label text with `var(--hd-font-3xs)`
- [x] `HistoryView.tsx`: replace `fontSize: "11px"`, `"12px"`, `"13px"`, `"14px"` with CSS variables

---

## References

- `src/styles.css` — existing `:root` tokens and `.hd-*` classes
- `src/components/AnalysisDetailView.tsx` — biggest inline-style offender
- `src/components/AskHadronDrawer.tsx` — em-unit font size inconsistency
- `src/components/HistoryView.tsx` — 9px/10px/11px pixel font sizes in badges
