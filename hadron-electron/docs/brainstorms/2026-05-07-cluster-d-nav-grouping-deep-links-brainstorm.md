---
title: "Cluster D — Navigation grouping + integration deep-links"
date: 2026-05-07
status: ready-for-planning
---

# Cluster D — Navigation grouping + integration deep-links

## What We're Building

Two small, related changes to the top navigation bar:

1. **Visual separator** — a slim vertical divider between the core tool tabs (Crash, Code, Performance) and the integration tabs (JIRA, Sentry, Release Notes), with History and Ask Hadron remaining after.

2. **Always-visible integration tabs** — JIRA, Sentry, and Release Notes currently disappear from the nav when not configured. Instead they always appear, dimmed, with a visual cue (greyed text + lock or plug icon). Clicking a dimmed tab navigates directly to that integration's Settings section rather than loading the analyzer view.

## Why This Approach

**Minimal scope.** Changes are confined to `Navigation.tsx` (tab rendering) and a small wiring addition in `App.tsx` (the `onOpenSettings` call). No new abstractions, no new types, no new components.

**Discoverability without clutter.** Users currently have no idea JIRA/Sentry/Release Notes exist until they configure them. Always-visible-but-dimmed tabs show what the app can do while guiding new users directly to the right configuration section with a single click.

**Consistent with existing patterns.** The status-bar dots already deep-link into settings via `onOpenSettings(section)` / `setPendingSettingsSection`. The dimmed-tab click reuses the exact same mechanism — no new concepts.

**History stays after the separator.** History is a core utility tab, not an integration. It stays on the right side of the separator alongside the integration tabs (or after them), before the Ask Hadron button.

## Key Decisions

- **Separator placement:** between Performance and JIRA (i.e., after all core analyzers, before all integration tabs).
- **Dimmed tab visual:** reduced opacity (`opacity-40` or similar) + lock icon (or plug icon). No tooltip needed — clicking it immediately opens settings.
- **Click target for dimmed tab:** calls `onOpenSettings(settingsSection)` using the existing `App.tsx` / `AppHeader` wiring. Maps: `jira` → `'jira'`, `sentry` → `'sentry'`, `release_notes` → `'jira'` (Release Notes shares the JIRA settings section).
- **Release Notes deep-link target:** Release Notes is gated on JIRA readiness, so clicking its dimmed tab opens the `'jira'` settings section (where JIRA credentials are configured).
- **Tab structure unchanged:** `TabConfig` and `tabs[]` array in `Navigation.tsx` are not changed structurally. The separator is a rendered element between specific indices, not a data model concept.
- **History tab position:** remains last before Ask Hadron (after the integration tabs). No change.
- **No tooltip or modal:** YAGNI — the immediate navigation to settings is sufficient feedback.

## Open Questions

- Should the dimmed integration tabs show a specific icon (lock vs. plug vs. none)? Any icon will do — lock is most universally understood for "not available yet."
- Should `release_notes` deep-link to `'jira'` (where you configure the JIRA connection that gates it) or have no deep-link at all? Decision: `'jira'` settings section, since that's where the user needs to act.
- Does the separator need a label (e.g., "Integrations" text above or beside it)? Decision: no label — keep it a simple slim visual break.
