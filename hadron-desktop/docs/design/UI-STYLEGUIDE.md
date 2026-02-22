# Hadron UI Style Guide

## Purpose
This guide defines the baseline UI language for Hadron after the workspace redesign.
Use it for all new screens and during refactors of legacy screens.

## Product IA
- Top-level workspaces: `Analyze`, `Investigate`
- Global action (not tab): `Ask Hadron`
- Keep top-level navigation stable; add feature growth in workspace-level views.

## Core Principles
- Clarity over density: default to essential controls, reveal advanced controls progressively.
- Actionable state: warnings should include clear next action.
- Non-blocking feedback: prefer toasts/in-app banners over browser `alert/confirm`.
- Predictable layout: keep headers, filters, and primary actions in consistent positions.

## Layout
- App shell max width: `max-w-7xl`
- Main spacing rhythm: `gap-4` or `gap-6`
- Card shape: rounded (`rounded-lg` to `rounded-2xl`) with subtle border
- Header block: compact identity + immediate actions + status chips

## Color Roles
- Primary action: blue (`bg-blue-600` family)
- Investigate/history accent: amber (`text-amber-400` family)
- Ask Hadron action: emerald (`bg-emerald-*` family)
- Danger/destructive: red (`bg-red-600` and red tint surfaces)
- Informational banner: blue/yellow tint with 20-30% border opacity

## Typography
- Page titles: `text-2xl` to `text-3xl`, `font-bold`
- Section titles: `text-lg`, `font-semibold`
- Supporting copy: `text-sm text-gray-400`
- Meta/status chips: `text-xs`

## Components

### Header
- Required: product identity, docs/help, dashboard, settings
- Optional: compact status chips under main row
- Keep CTAs right-aligned, identity left-aligned

### Navigation
- Workspace toggle first (`Analyze`, `Investigate`)
- Workspace tabs second
- `Ask Hadron` as right-side action button, not a tab

### Intake Panels
- Large drop/select area with explicit instruction
- Two primary ingest paths only:
  - Choose files
  - Paste log text
- Analysis depth selector directly below intake

### History/Investigation
- Start with search + tabs
- Advanced filters behind a single filter control
- Keep quick filters optional and collapsible when possible
- Bulk actions should appear only in selection mode

### Settings
- Use a modal shell with:
  - Title + concise subtitle
  - status chips (e.g., offline/encrypted/workspace-ready)
  - compact tab row with clear active state
- Name feature visibility controls as `Visible Menu Items` (not tabs) after workspace redesign.

### Ask Hadron
- Keep chat as a dedicated action entrypoint from navigation.
- Header should include concise capability chips (context-aware, session memory).
- Retrieval/verbosity controls are toggle buttons and should expose `aria-pressed`.
- Keep advanced retrieval filters collapsed by default.

## Feedback & States
- Success: toast + concise confirmation text
- Error: toast + recovery guidance where possible
- Empty states: explain next action in one sentence
- Loading states: keep current layout and fill with skeleton/loading text

## Accessibility Baseline
- Interactive controls must be real `button`/`input` elements.
- Every icon-only button must have an `aria-label`.
- Preserve visible focus outlines (`:focus-visible`).
- Ensure keyboard access for all primary actions.

## Copy Style
- Keep labels task-oriented and concrete:
  - Use `Choose Files` instead of `Upload`
  - Use `Investigation History` instead of generic `History`
- Avoid marketing language in critical workflows.

## Implementation Notes
- Reuse `Button`, `Modal`, and `Toast` primitives.
- Prefer shared `hd-*` utility classes for shell/navigation/chips:
  - Panels: `hd-shell-card`, `hd-panel-soft`, `hd-panel-chat`, `hd-modal-shell`
  - Chips: `hd-chip` + semantic variants (`hd-chip-emerald`, `hd-chip-blue`, `hd-chip-amber`, `hd-chip-neutral`)
  - Settings: `hd-setting-row`, `hd-setting-card`, `hd-toggle`, `hd-toggle-knob`
  - Navigation: `hd-workspace-*`, `hd-subnav-*`, `hd-ask-btn*`
- Avoid inline one-off styles unless interaction requires runtime values.
- Prefer introducing small shared utility classes over ad-hoc duplication.

## Review Checklist
- Does this screen map clearly to `Analyze` or `Investigate`?
- Are destructive actions confirmed in-app (not browser confirm)?
- Is there one obvious primary action?
- Are advanced controls hidden until needed?
- Is keyboard and focus behavior intact?
