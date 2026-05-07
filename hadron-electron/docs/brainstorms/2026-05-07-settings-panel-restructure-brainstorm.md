# Settings Panel Restructure — Brainstorm

**Date:** 2026-05-07
**Cluster:** B
**Status:** Ready for planning

---

## What We're Building

A full restructure of the Settings panel — both its user-facing navigation and its internal code organisation. The current `SettingsPanel.tsx` is a 1,497-line god component with two accordion expand-states and no real navigation, making it hard to use and hard to maintain. The restructure replaces it with a left-sidebar navigation shell and fully extracted section components.

---

## Why This Approach

Both discoverability (users can't find where things live) and code maintainability (one enormous file owning ~30 state variables) are equally important targets.

A **left sidebar nav** was chosen over tabs or scroll-with-anchors because:
- Scales gracefully as more sections are added (no wrapping)
- Supports a 2-level tree for integrations (JIRA / Sentry / Knowledge Base as sub-items)
- Familiar pattern (VS Code Settings, macOS System Preferences)
- Pairs naturally with a **Dashboard landing page** — the default view before any section is selected

---

## Key Decisions

### Navigation structure

```
Settings
├── Dashboard            ← default landing, 3-card overview
├── AI Provider          ← provider, model, API keys, Keeper
├── Integrations         ← expandable in sidebar
│   ├── JIRA
│   ├── Sentry
│   └── Knowledge Base   ← OpenSearch + CodexMgX
├── Preferences          ← theme, PII, default analysis, feature toggles, active providers
└── Maintenance          ← stability mode, crash log dir, export dir, DB admin, diagnostics
```

### Integration sub-nav: tree-expand

Clicking "Integrations" in the sidebar expands the sub-tree in place. Clicking a child (JIRA, Sentry, Knowledge Base) selects it and the right panel shows only that integration's settings. The existing `JiraSettings.tsx`, `SentrySettings.tsx`, `OpenSearchSettings.tsx` components are reused as-is as the right-pane content for each child.

### Dashboard landing page

The 3-column card grid (AI summary, Integrations status badges, Preferences summary) is preserved as the default view when Settings first opens — before any sidebar item is selected. Cards act as quick-glance summaries and "jump to section" entry points.

### Advanced accordion eliminated

The current Advanced accordion mixed too many unrelated concerns. Content is redistributed:
- AI config + Keeper Secrets Manager + manual API keys → **AI Provider** section
- Feature toggles (Visible Menu Items) + Active Providers checkboxes → **Preferences** section  
- Stability mode, crash log dir, export dir, DB admin, diagnostics, update check, auto-tag, EmbeddedConsoleViewer → **Maintenance** section

### Full code extraction

`SettingsPanel.tsx` becomes a thin shell (~100–150 lines) containing only:
- The sidebar nav (section list, expand/collapse state for Integrations)
- Active section routing (`activeSection` state)
- The right-pane slot that renders the active section component

Each section gets its own file under `src/components/settings/`:

| File | Content |
|------|---------|
| `SettingsPanel.tsx` | Shell: sidebar + section router |
| `settings/SettingsDashboard.tsx` | 3-card overview landing page |
| `settings/AiProviderSection.tsx` | Provider, model, API keys, Keeper |
| `settings/IntegrationsSection.tsx` | Thin wrapper + sub-nav coordination |
| `settings/PreferencesSection.tsx` | Theme, PII, default analysis, toggles, active providers |
| `settings/MaintenanceSection.tsx` | Diagnostics, DB admin, crash dirs, update check |

Existing extracted components (`JiraSettings.tsx`, `SentrySettings.tsx`, `OpenSearchSettings.tsx`, `KeeperSettings.tsx`) are consumed by the relevant section file without moving them.

---

## Section Content Map

### AI Provider
- Provider dropdown (Anthropic / OpenAI / local)
- ModelPicker (primary model)
- Auxiliary model select
- Keeper Secrets Manager (currently in Advanced)
- Manual API key inputs (currently in Advanced sub-collapsible)
- Test Connection button

### Integrations → JIRA
- Full `JiraSettings.tsx` content as-is

### Integrations → Sentry
- Full `SentrySettings.tsx` content as-is

### Integrations → Knowledge Base
- `OpenSearchSettings.tsx` content
- CodexMgX configuration block (currently inline in SettingsPanel — extract to `CodexMgXSettings.tsx`)

### Preferences
- Theme toggle (light / dark / system)
- PII Redaction toggle
- Default Analysis segmented control
- Visible Menu Items feature toggles (currently in Advanced 3-col grid col 1)
- Active Providers checkboxes + circuit-breaker indicators (currently in Advanced col 2)

### Maintenance
- Update check
- Diagnostics panel
- Auto-tag toggle
- Crash log directory picker
- Stability mode toggle
- Export location picker
- Database Admin section
- Embedded Console Viewer

---

## Open Questions

1. **Deep-link from status bar**: Cluster D will add deep-links from the readiness status dots to their integration settings. The routing should be designed so `SettingsPanel` accepts an optional `initialSection` + `initialSubSection` prop. Worth noting in the plan.
2. **CodexMgX extraction**: The inline CodexMgX block in the current panel needs a new `CodexMgXSettings.tsx` component — is that in scope for this cluster or should it land in Cluster B? (Assume in-scope since it lives in the same section.)
3. **Sidebar width**: Fixed width (e.g. `w-44`) or resizable? Assume fixed for now.
4. **Section scroll preservation**: Should each section's scroll position be preserved when switching tabs? Probably not necessary for now — reset to top on section change.
