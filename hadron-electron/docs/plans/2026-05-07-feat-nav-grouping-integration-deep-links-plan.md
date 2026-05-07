---
title: "feat: Navigation grouping + integration tab deep-links"
type: feat
date: 2026-05-07
brainstorm: docs/brainstorms/2026-05-07-cluster-d-nav-grouping-deep-links-brainstorm.md
cluster: D
---

# feat: Navigation grouping + integration tab deep-links

## Overview

Two small, focused changes to the top navigation bar:

1. **Visual separator** between core tool tabs (Crash, Code, Performance) and integration tabs (JIRA, Sentry, Release Notes).
2. **Always-visible integration tabs** — currently hidden when not configured; change to always shown but dimmed, with a lock icon. Clicking a dimmed tab opens Settings directly at the relevant section.

**Scope:** Two files — `Navigation.tsx` and `App.tsx`. No new components, no new abstractions.

---

## Problem Statement

- JIRA, Sentry, and Release Notes tabs silently disappear when the integration isn't configured. New users never discover these features exist.
- The status-bar dots already provide a deep-link path to settings, but it's a secondary affordance (small dot → popover → button). The nav tab is the primary surface and should also guide users to configure.
- There's no visual grouping between "always-on" tools and "integration-dependent" tools.

---

## Proposed Solution

### Navigation.tsx changes

**1. Extend `TabConfig` with optional `enabled` and `settingsSection`:**

```ts
// src/components/Navigation.tsx
import type { SettingsSection } from './settings/types';

interface TabConfig {
  id: View;
  label: string;
  icon: typeof FileUp;
  enabled?: boolean;          // defaults to true; false = dimmed + deep-link
  settingsSection?: SettingsSection; // target when disabled tab is clicked
}
```

**2. Add `onOpenSettings` prop to `NavigationProps`:**

```ts
interface NavigationProps {
  // ...existing props unchanged...
  onOpenSettings?: (section: SettingsSection) => void;
}
```

**3. Restructure tab list into two groups — build once, render with separator between:**

```ts
const coreTabs: TabConfig[] = [
  { id: "analyze", label: "Crash Analyzer", icon: FileUp },
  ...(showCodeAnalyzer ? [{ id: "translate" as View, label: "Code Analyzer", icon: Code }] : []),
  ...(showPerformanceAnalyzer ? [{ id: "performance" as View, label: "Performance Analyzer", icon: Cpu }] : []),
];

const integrationTabs: TabConfig[] = [
  { id: "jira", label: "JIRA Analyzer", icon: Ticket,
    enabled: showJiraAnalyzer, settingsSection: "jira" },
  { id: "sentry", label: "Sentry Analyzer", icon: AlertTriangle,
    enabled: showSentryAnalyzer, settingsSection: "sentry" },
  { id: "release_notes", label: "Release Notes", icon: FileText,
    enabled: showReleaseNotes, settingsSection: "jira" },  // JIRA section gates RN
  { id: "history", label: "History", icon: History },      // always enabled
];
```

**4. Render helper for a single tab button:**

```tsx
function renderTab(tab: TabConfig) {
  const Icon = tab.icon;
  const isEnabled = tab.enabled !== false;
  const isActive = tab.id === currentView || (tab.id === "history" && currentView === "detail");

  if (!isEnabled) {
    return (
      <button
        key={tab.id}
        onClick={() => tab.settingsSection && onOpenSettings?.(tab.settingsSection)}
        role="tab"
        aria-selected={false}
        aria-label={`${tab.label} — click to configure`}
        title={`${tab.label} — click to configure`}
        className="hd-nav-btn opacity-40 hover:opacity-60 transition-opacity cursor-pointer"
      >
        <Lock className="w-[15px] h-[15px]" />
        <span>{tab.label}</span>
      </button>
    );
  }

  return (
    <button
      key={tab.id}
      onClick={() => onViewChange(tab.id)}
      role="tab"
      aria-selected={isActive}
      aria-controls={`${tab.id}-panel`}
      className={`hd-nav-btn ${isActive ? "hd-nav-btn-active" : ""}`}
    >
      <Icon className="w-[15px] h-[15px]" />
      <span>{tab.label}</span>
    </button>
  );
}
```

**5. Render with separator between groups:**

```tsx
return (
  <nav ...>
    {coreTabs.map(renderTab)}

    {/* Separator between core tools and integrations */}
    <div className="w-px h-5 self-center mx-1 bg-gray-600/30 shrink-0" aria-hidden="true" />

    {integrationTabs.map(renderTab)}

    {/* Spacer + Ask Hadron — unchanged */}
    <div className="flex-1" />
    ...
  </nav>
);
```

### App.tsx changes

Pass `onOpenSettings` to `<Navigation>` by reusing the existing handler already passed to `<AppHeader>`:

```tsx
// Extract the handler so it can be reused
const handleOpenSettings = useCallback((section?: SettingsSection | string) => {
  if (section) {
    setPendingSettingsSection(section as SettingsSection);
    setSettingsNavKey(k => k + 1);
  }
  actions.setView("configure");
}, [actions]);

// AppHeader (existing — unchanged):
<AppHeader onOpenSettings={handleOpenSettings} ... />

// Navigation (add onOpenSettings):
<Navigation
  currentView={currentView}
  onViewChange={actions.setView}
  onOpenSettings={handleOpenSettings}
  showJiraAnalyzer={jiraEnabled}
  showSentryAnalyzer={sentryEnabled}
  showReleaseNotes={jiraEnabled}
  showCodeAnalyzer={showCodeAnalyzer}
  showPerformanceAnalyzer={showPerformanceAnalyzer}
  showAskHadron={showAskHadron}
/>
```

> **Note:** The `handleOpenSettings` inline arrow currently lives in JSX (`onOpenSettings={(section) => { ... }}`). Extract it to a named `useCallback` so it can be passed to both `AppHeader` and `Navigation` without duplication.

---

## Acceptance Criteria

- [x] Visual separator (slim `w-px h-5 bg-gray-600/30`) always visible between Performance and JIRA tabs
- [x] JIRA, Sentry, Release Notes tabs always rendered even when not configured
- [x] Disabled integration tabs are visually dimmed (`opacity-40`), show `Lock` icon instead of their normal icon
- [x] Clicking a disabled JIRA tab → opens Settings at `'jira'` section
- [x] Clicking a disabled Sentry tab → opens Settings at `'sentry'` section
- [x] Clicking a disabled Release Notes tab → opens Settings at `'jira'` section
- [x] Enabled integration tabs work exactly as before (no regression)
- [x] Separator is `aria-hidden="true"` (not a tab stop)
- [x] Disabled tabs have `aria-selected={false}` and descriptive `title` attribute
- [x] `handleOpenSettings` extracted to `useCallback` in App.tsx (no duplication)
- [x] `npx tsc --noEmit` passes with zero errors

---

## Implementation Checklist

- [x] `src/components/Navigation.tsx`:
  - [x] Import `Lock` from `lucide-react`, `SettingsSection` from `./settings/types`
  - [x] Extend `TabConfig` with `enabled?: boolean`, `settingsSection?: SettingsSection`
  - [x] Add `onOpenSettings?: (section: SettingsSection) => void` to `NavigationProps`
  - [x] Split `tabs[]` into `coreTabs[]` + `integrationTabs[]`
  - [x] Add `renderTab` helper (disabled branch + enabled branch)
  - [x] Add separator `<div>` between groups in JSX
- [x] `src/App.tsx`:
  - [x] Extract inline `onOpenSettings` arrow → `handleOpenSettings` `useCallback`
  - [x] Pass `onOpenSettings={handleOpenSettings}` to `<Navigation>`

---

## References

- `src/components/Navigation.tsx` — current tab list (line 35–43) and render loop (line 55–71)
- `src/App.tsx:632–638` — existing `onOpenSettings` handler to extract
- `src/App.tsx:645–654` — `<Navigation>` call site to update
- `src/App.tsx:324–326` — `jiraEnabled` / `sentryEnabled` derived from `readinessStatus`
- `src/components/settings/types.ts` — `SettingsSection` union type
- `src/components/AppHeader.tsx` — existing `onOpenSettings(section?: string)` prop contract
- Brainstorm: `docs/brainstorms/2026-05-07-cluster-d-nav-grouping-deep-links-brainstorm.md`
