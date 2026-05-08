# Cluster D: Navigation Grouping + Integration Deep-links

## Goal

Make the nav bar's three logical zones explicit, and give users a direct path from an unconfigured integration view to the right settings section — no dead-end text walls.

## Architecture

Two independent, self-contained changes. Neither requires new files, new state, or architectural refactoring.

**Part 1 — Navigation:** A local `NavSeparator` component added inside `Navigation.tsx` replaces the existing single thin divider. History is moved out of `integrationTabs` into its own position, giving the nav bar three explicit zones.

**Part 2 — Deep-links:** An optional `onOpenSettings` prop is threaded into the three integration views. The not-configured block in each view gains a small CTA button that navigates directly to the correct settings section.

---

## Part 1: Three-zone Navigation

### Layout

```
[Crash Analyzer] [Code Analyzer] [Performance]
  —— Integrations ——
[🔒 JIRA] [🔒 Sentry] [🔒 Release Notes]
  —— History ——
[History]
[spacer]
[Ask Hadron]
```

### `NavSeparator` component

Defined locally inside `Navigation.tsx` (not a separate file — it's a 6-line presentational helper):

```tsx
function NavSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-[5px] mx-1.5 flex-shrink-0" aria-hidden="true">
      <div className="w-px h-[18px] bg-gray-600/30" />
      <span className="text-[8px] uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.18)' }}>
        {label}
      </span>
      <div className="w-px h-[18px] bg-gray-600/30" />
    </div>
  )
}
```

### Tab restructuring

`integrationTabs` is trimmed to JIRA, Sentry, Release Notes. History becomes a standalone `historyTab` constant:

```ts
const integrationTabs: TabConfig[] = [
  { id: "jira",          label: "JIRA Analyzer",  icon: Ticket,        enabled: showJiraAnalyzer,   settingsSection: "jira"   },
  { id: "sentry",        label: "Sentry Analyzer", icon: AlertTriangle, enabled: showSentryAnalyzer, settingsSection: "sentry" },
  { id: "release_notes", label: "Release Notes",   icon: FileText,      enabled: showReleaseNotes,   settingsSection: "jira"   },
]

const historyTab: TabConfig = { id: "history", label: "History", icon: History }
```

### Render order

```tsx
{coreTabs.map(renderTab)}
<NavSeparator label="Integrations" />
{integrationTabs.map(renderTab)}
<NavSeparator label="History" />
{renderTab(historyTab)}
<div className="flex-1" />   {/* spacer */}
{/* Ask Hadron button */}
```

### Files changed

- `src/components/Navigation.tsx` — add `NavSeparator`, restructure tab arrays and render order

---

## Part 2: Integration Empty-State Deep-links

### Prop contract

All three views gain an identical optional prop:

```ts
onOpenSettings?: (section: string) => void
```

Using `string` (not `SettingsSection`) keeps the views free of a settings-module import; `handleOpenSettings` in `App.tsx` already accepts `SettingsSection | string`.

### Button — added to each view's not-configured block

The button is rendered only when `onOpenSettings` is provided (safe for tests and isolated rendering):

```tsx
{onOpenSettings && (
  <button
    onClick={() => onOpenSettings('jira')}          // or 'sentry'
    className="mt-3 flex items-center gap-1.5 text-xs font-medium"
    style={{ color: 'var(--hd-accent)' }}
  >
    <ExternalLink className="w-3 h-3" />
    Configure JIRA →
  </button>
)}
```

`ExternalLink` is already in the `lucide-react` import in `StatusPopover` — each view will add it to its own import.

### Per-view mapping

| View | Section passed | Button label |
|------|---------------|--------------|
| `JiraAnalyzerView` | `'jira'` | Configure JIRA → |
| `SentryAnalyzerView` | `'sentry'` | Configure Sentry → |
| `ReleaseNotesView` | `'jira'` | Configure JIRA → |

Release Notes uses JIRA credentials, so it routes to the JIRA settings section.

### `App.tsx` wiring

The three render sites gain `onOpenSettings={handleOpenSettings}`:

```tsx
<JiraAnalyzerView
  onAnalysisComplete={actions.viewAnalysis}
  onOpenSettings={handleOpenSettings}
/>

<SentryAnalyzerView
  onAnalysisComplete={actions.viewAnalysis}
  onOpenSettings={handleOpenSettings}
/>

<ReleaseNotesView
  onOpenSettings={handleOpenSettings}
/>
```

### Files changed

- `src/components/JiraAnalyzerView.tsx` — add prop + button in not-configured block
- `src/components/SentryAnalyzerView.tsx` — add prop + button in not-configured block
- `src/components/ReleaseNotesView.tsx` — add prop + button in not-configured block
- `src/App.tsx` — pass `onOpenSettings` to all three views

---

## Error handling

- `onOpenSettings` is optional in all three views — renders gracefully without it
- `NavSeparator` is `aria-hidden="true"` — screen readers skip decorative separators

## Testing

**Navigation:**
- Renders two `NavSeparator` elements with labels "Integrations" and "History"
- History tab appears after the second separator, not after Release Notes
- Integration tabs still call `onOpenSettings` when clicked while disabled

**Integration views:**
- When `onOpenSettings` is undefined: not-configured block renders without a button
- When `onOpenSettings` is provided: button is present and calls the prop with the correct section key (`'jira'` or `'sentry'`)
- Clicking the button in `JiraAnalyzerView` calls `onOpenSettings('jira')`
- Clicking the button in `SentryAnalyzerView` calls `onOpenSettings('sentry')`
- Clicking the button in `ReleaseNotesView` calls `onOpenSettings('jira')`
