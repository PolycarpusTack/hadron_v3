---
title: "refactor: Settings Panel Restructure (Cluster B)"
type: refactor
date: 2026-05-07
deepened: 2026-05-07
brainstorm: docs/brainstorms/2026-05-07-settings-panel-restructure-brainstorm.md
---

# refactor: Settings Panel Restructure (Cluster B)

## Enhancement Summary

**Deepened on:** 2026-05-07  
**Research agents:** architecture-strategist, kieran-typescript-reviewer, julik-frontend-races-reviewer, code-simplicity-reviewer, performance-oracle, best-practices-researcher, feature-dev:code-architect, pattern-recognition-specialist

### Key improvements over original plan
1. **YAGNI cuts:** `IntegrationsOverview.tsx` eliminated; `KnowledgeBaseSection.tsx` inlined; `initialSubSection?: string` deferred to Cluster D — saves ~80 lines and a nav-authority conflict
2. **Typed `ProviderId`:** `Settings.provider: string` → `'openai' | 'anthropic' | 'zai' | 'llamacpp'` union — eliminates every `as keyof typeof settings.apiKeys` cast in the file
3. **Correct `onSettingsChange` callback type:** `Partial<Settings>` replaced with functional updater `(prev: Settings) => Settings` — prevents provider/model coherence bugs
4. **5 async race conditions fixed:** `loadSettings` abort flag; stale-closure `setSettings` spreads → updater form; `handleRefreshModels` provider capture; `JiraSettings.loadConfig` cancelled guard; unawaited `handleRefreshModels` inside `handleTestConnection`
5. **`integrationsOpen` derived state:** auto-expands when child section is active; click-to-collapse is silently ignored if child is active
6. **Component map routing:** typed `SECTION_COMPONENTS` record replaces switch — exhaustively checked by TypeScript
7. **ARIA and keyboard nav:** `aria-current="page"` (not `aria-selected`), roving tabindex with arrow key support
8. **`EmbeddedConsoleViewer` CSS-hidden not unmounted:** live log stream preserved on navigate-away
9. **Callback naming unified:** `onConfigChange` renamed to `onSettingsChange` across all 4 existing sub-components

### New files identified by research
- `src/components/settings/types.ts` (not `src/types/index.ts`) — settings-local types
- `src/components/settings/settingsSectionMap.ts` — lazy component map
- `src/hooks/useAutoTimeout.ts` — replaces duplicated `safeTimeout`/`timeoutsRef` pattern

---

## Overview

Replace the 1,497-line `SettingsPanel.tsx` god component with a left-sidebar navigation shell and fully extracted section components. The restructure solves both user-facing discoverability (no navigation today) and maintainability (29 `useState` variables in one file).

The new layout mirrors VS Code Settings / macOS System Preferences: a narrow sidebar nav on the left, the active section rendered in the right pane. A Dashboard landing page (the existing 3-card overview) is the default view.

---

## Problem Statement

**User experience:** Opening Settings drops users into a flat vertical scroll with two accordion expand states and no obvious way to jump to a specific section. "Change Provider" opens the Advanced accordion — there is no real routing.

**Maintainability:** `SettingsPanel.tsx` has 29 `useState` variables, ~30 deeply nested JSX blocks, and owns 5 conceptually separate areas. Every bug fix requires navigating 1,500 lines.

**Correctness issues in the current code (fixed in this refactor):**
- Five async race conditions (detailed in Phase 6 and Risk Analysis)
- `Settings.provider` typed as `string` causes unsafe key access throughout
- Stale-closure `setSettings` spreads in async handlers silently drop concurrent updates

**Precedent:** The Code Analyzer split (1,109 → orchestrator + 6 tab files) is the established pattern for this class of refactor.

---

## Proposed Solution

### New file layout

```
src/components/
  SettingsPanel.tsx                  ← thin shell + isInline/modal wrapper, ~120 lines
  settings/
    types.ts                         ← SettingsSection, ProviderId, SettingsSectionProps
    settingsSectionMap.ts            ← SECTION_COMPONENTS lazy record
    SettingsSidebar.tsx              ← sidebar nav (fixed w-44)
    SettingsDashboard.tsx            ← read-only 3-card overview (no Settings prop)
    AiProviderSection.tsx            ← provider, model, API keys, Keeper (~350 lines)
    PreferencesSection.tsx           ← theme, PII, analysis mode, toggles, providers (~180 lines)
    MaintenanceSection.tsx           ← diagnostics, DB admin, dirs, update check (~250 lines)
    CodexMgXSettings.tsx             ← extracted from inline block in current panel
src/hooks/
  useAutoTimeout.ts                  ← shared hook, replaces safeTimeout/timeoutsRef
```

Unchanged (reused with `onSettingsChange` prop renamed from `onConfigChange`):
- `JiraSettings.tsx`
- `SentrySettings.tsx`
- `OpenSearchSettings.tsx`
- `KeeperSettings.tsx`

> **Cut from original plan (YAGNI):** `IntegrationsOverview.tsx` and `KnowledgeBaseSection.tsx` are eliminated. Clicking "Integrations" in the sidebar navigates directly to JIRA. The Knowledge Base right pane renders `<OpenSearchSettings>` + `<CodexMgXSettings>` inline.

### Sidebar navigation structure

```
Settings
├── Dashboard                ← default view on open
├── AI Provider
├── Integrations             ← click to toggle tree; auto-expands when child is active
│   ├── JIRA                 ← default when "Integrations" is clicked
│   ├── Sentry
│   └── Knowledge Base
├── Preferences
└── Maintenance
```

### Types (`src/components/settings/types.ts`)

```ts
export type ProviderId = 'openai' | 'anthropic' | 'zai' | 'llamacpp';

export type SettingsSection =
  | 'dashboard'
  | 'ai-provider'
  | 'jira'
  | 'sentry'
  | 'knowledge-base'
  | 'preferences'
  | 'maintenance';

// Exhaustive metadata for sidebar rendering
export interface SectionMeta {
  label: string;
  icon: LucideIcon;
  group: 'root' | 'integrations';
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  'dashboard':      { label: 'Dashboard',       group: 'root',         icon: LayoutDashboard },
  'ai-provider':    { label: 'AI Provider',      group: 'root',         icon: Bot             },
  'jira':           { label: 'JIRA',             group: 'integrations', icon: Ticket          },
  'sentry':         { label: 'Sentry',           group: 'integrations', icon: Bug             },
  'knowledge-base': { label: 'Knowledge Base',   group: 'integrations', icon: Database        },
  'preferences':    { label: 'Preferences',      group: 'root',         icon: SlidersHorizontal },
  'maintenance':    { label: 'Maintenance',      group: 'root',         icon: Wrench          },
};

// Base interface all section components extend
export interface SettingsSectionProps {
  onNavigate: (section: SettingsSection) => void;
}

// Type guard used by shell to derive integrationsOpen
const INTEGRATION_SECTIONS = new Set<SettingsSection>(['jira', 'sentry', 'knowledge-base']);
export function isIntegrationSection(s: SettingsSection | undefined): s is 'jira' | 'sentry' | 'knowledge-base' {
  return s !== undefined && INTEGRATION_SECTIONS.has(s);
}
```

> **Why `settings/types.ts` not `src/types/index.ts`:** These types are settings-local. Putting them in the global types file would pollute the top-level namespace with section names that mean nothing outside Settings.

### Component map (`src/components/settings/settingsSectionMap.ts`)

```ts
import { lazy } from 'react';
import type { SettingsSection } from './types';

// Type-safe: TypeScript errors if SettingsSection has a value with no entry here
export const SECTION_COMPONENTS: Record<SettingsSection, React.LazyExoticComponent<any> | React.FC<any>> = {
  'dashboard':      lazy(() => import('./SettingsDashboard')),
  'ai-provider':    lazy(() => import('./AiProviderSection')),
  'jira':           lazy(() => import('../JiraSettings')),
  'sentry':         lazy(() => import('../SentrySettings')),
  'knowledge-base': lazy(() => import('./KnowledgeBaseInline')),  // thin inline module
  'preferences':    lazy(() => import('./PreferencesSection')),
  'maintenance':    lazy(() => import('./MaintenanceSection')),
};
```

> **Why a component map:** Switch statements in JSX grow unboundedly and lose exhaustiveness checking. A `Record<SettingsSection, ...>` literal errors at compile time when a new section is added without a corresponding component.

### Shell state after restructure

```ts
// SettingsPanel.tsx — only 6 state vars in the shell
const [activeSection, setActiveSection] = useState<SettingsSection>(
  props.initialSection ?? 'dashboard'
);
// Derived: auto-expands when child section is active; user toggle stored separately
const [localIntegrationsOpen, setLocalIntegrationsOpen] = useState(false);
const integrationsOpen = localIntegrationsOpen || isIntegrationSection(activeSection);

const [settings, setSettings] = useState<Settings>(...);  // shared by AI + Prefs
const [isSaving, setIsSaving] = useState(false);
const [saveMessage, setSaveMessage] = useState<string | null>(null);
const [isOnline, setIsOnline] = useState(navigator.onLine);
```

> **Why derived `integrationsOpen`:** If the sidebar auto-collapsed integrations while a child section was active, the active item would disappear from the nav. The `localIntegrationsOpen || isIntegrationSection(activeSection)` pattern ensures user collapse is silently ignored when a child is active — matching VS Code and macOS Settings behaviour.

### Settings object update contract

```ts
// ✅ Correct: functional updater prevents stale-closure clobber
const handleSettingsChange = useCallback(
  (updater: (prev: Settings) => Settings) => {
    setSettings(updater);
  },
  []
);

// Call sites in AiProviderSection / PreferencesSection:
onSettingsChange(prev => ({ ...prev, provider: newProvider }));

// ✅ NOT: Partial<Settings> — allows incoherent updates (provider without model)
// ✅ NOT: setSettings({ ...settings, ... }) — stale closure in async handlers
```

### `useAutoTimeout` hook

```ts
// src/hooks/useAutoTimeout.ts
// Replaces the duplicated safeTimeout/timeoutsRef pattern across sections
export function useAutoTimeout() {
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timeoutsRef.current.push(id);
    return id;
  }, []);

  useEffect(() => () => { timeoutsRef.current.forEach(clearTimeout); }, []);

  return schedule;
}
```

---

## Technical Approach

### Architecture diagram

```
SettingsPanel (shell)               ~120 lines
├── isOnline offline banner
├── SettingsSidebar                 props: activeSection, onSelect, integrationsOpen, onToggleIntegrations
│   ├── root nav items (4)
│   └── Integrations group + sub-items (3)
├── Right pane  <Suspense>
│   └── SECTION_COMPONENTS[activeSection]   ← lazy, each receives shared props
└── Save/Cancel footer
```

### Section component interfaces

```ts
// AiProviderSection
interface AiProviderSectionProps extends SettingsSectionProps {
  settings: Settings;
  onSettingsChange: (updater: (prev: Settings) => Settings) => void;
}

// PreferencesSection
interface PreferencesSectionProps extends SettingsSectionProps {
  settings: Settings;
  onSettingsChange: (updater: (prev: Settings) => Settings) => void;
  darkMode: boolean;
  onThemeChange: (dark: boolean) => void;
}

// SettingsDashboard — read-only, no settings prop
interface SettingsDashboardProps extends SettingsSectionProps {
  providerLabel: string;    // derived from settings in shell, not the full object
  modelLabel: string;
}

// JiraSettings, SentrySettings, OpenSearchSettings, KeeperSettings (rename prop)
interface XxxSettingsProps {
  onSettingsChange?: () => void;   // renamed from onConfigChange
}

// MaintenanceSection — fully self-contained
// (no props beyond SettingsSectionProps)
```

> **Why SettingsDashboard is read-only:** The dashboard is a summary + navigation hub, not an editor. Quick-toggles (theme, PII) belong in PreferencesSection. Passing the full `Settings` object to Dashboard just to render two values creates unnecessary coupling. Pass only the derived display values.

> **Why darkMode / onThemeChange go to PreferencesSection, not the shell:** In the current code these are top-level SettingsPanel props (`darkMode`, `onThemeChange`). They are only ever used inside the preferences card. After extraction, PreferencesSection is the correct owner. The shell interface gets smaller.

### State ownership after extraction

| State variable | Owner after restructure |
|---|---|
| `settings` (provider, keys, model, PII, activeProviders) | Shell → props to AiProvider + Preferences |
| `isSaving`, `saveMessage` | Shell (footer) |
| `isOnline` | Shell (global banner) |
| `localIntegrationsOpen` | Shell (sidebar tree toggle) |
| `activeSection` | Shell (routing) |
| `isTestingConnection`, `connectionTestResult` | AiProviderSection |
| `isRefreshingModels`, `modelsMessage` | AiProviderSection |
| `cachedModels`, `modelFilter` | AiProviderSection |
| `keeperConfig`, `showManualKeys`, `showApiKeys` | AiProviderSection |
| `defaultAnalysisMode` | PreferencesSection |
| `isCheckingUpdate`, `updateMessage` | MaintenanceSection |
| `diagnosticsMessage` | MaintenanceSection |
| `isAutoTagging`, `autoTagMessage` | MaintenanceSection |
| `crashLogDir`, `crashLogMsg` | MaintenanceSection |
| `stabilityMode`, `stabilityMsg` | MaintenanceSection |
| `defaultExportDir` | MaintenanceSection |
| `jiraConnected`, `sentryConnected` | SettingsDashboard (loads locally on mount) |
| `codexMgxConfig`, `codexMgxAdvanced` | CodexMgXSettings (self-contained, own save) |

### CodexMgX save contract

`CodexMgXSettings` must be **fully autonomous** like JiraSettings/SentrySettings — it loads its own config on mount and saves independently. The current shell calls `saveCodexMgXConfig(codexMgxConfig)` inside `handleSaveSettings`. After extraction, remove that call from `handleSaveSettings` — CodexMgX saves via its own "Save" button, not the global footer. This matches how every other integration sub-component works.

### EmbeddedConsoleViewer mount strategy

`EmbeddedConsoleViewer` holds a live log stream. **Do not unmount it** when the user navigates away from Maintenance. Use CSS to hide it:

```tsx
// MaintenanceSection.tsx
<div className={activeSection === 'maintenance' ? 'block' : 'hidden'}>
  <Suspense fallback={null}>
    <EmbeddedConsoleViewer />
  </Suspense>
</div>
```

> This means MaintenanceSection must be mounted for the lifetime of the SettingsPanel, not lazily mounted on navigate. Wrap it in the shell alongside the `SECTION_COMPONENTS` switch:
> ```tsx
> {/* Always mounted, CSS-hidden when not active */}
> <MaintenanceSection className={activeSection === 'maintenance' ? 'block' : 'hidden'} />
> {/* Lazily mounted section content */}
> <Suspense fallback={<SectionSkeleton />}>
>   {activeSection !== 'maintenance' && <ActiveSection ... />}
> </Suspense>
> ```

### Save/Cancel footer

The global footer saves the `settings` object (AI + Preferences). For sections where no `settings` mutation occurs (Integrations, Maintenance, Dashboard), the Save button is present but a no-op — no per-section visibility logic.

---

## Pre-work: One-time fixes before Phase 1

These correctness fixes should land as a separate commit before the restructure begins. They reduce the blast radius of extraction.

### Fix 1 — `ProviderId` type

```ts
// src/components/settings/types.ts  (or src/types/index.ts temporarily)
export type ProviderId = 'openai' | 'anthropic' | 'zai' | 'llamacpp';

// In Settings interface:
provider: ProviderId;
apiKeys: Record<ProviderId, string>;
```

Remove all `as keyof typeof settings.apiKeys` casts — they become unnecessary.

### Fix 2 — Stale-closure `setSettings` in async handlers

Replace all `setSettings({ ...settings, ... })` with `setSettings(prev => ({ ...prev, ... }))` at lines: 362–367, 379, 451–458, 459, 628–633, 811, 813–815, and `handleProviderChange`.

### Fix 3 — `loadSettings` abort flag

```ts
useEffect(() => {
  if (!isOpen) return;
  let cancelled = false;
  loadSettings(cancelled).then(() => { if (!cancelled) { /* apply */ } });
  return () => { cancelled = true; };
}, [isOpen]);
```

### Fix 4 — `JiraSettings.loadConfig` cancelled guard

```ts
// JiraSettings.tsx — mirror the existing KeeperSettings pattern
useEffect(() => {
  let cancelled = false;
  loadConfig().then(result => { if (!cancelled) applyResult(result); });
  return () => { cancelled = true; };
}, []);
```

### Fix 5 — `handleRefreshModels` provider capture

```ts
const handleRefreshModels = async () => {
  const providerAtStart = settings.provider;  // capture before async work
  setIsRefreshingModels(true);
  try {
    const models = await fetchModels(providerAtStart);
    if (settings.provider !== providerAtStart) return; // user switched — ignore
    setCachedModels(prev => ({ ...prev, [providerAtStart]: models }));
  } finally {
    setIsRefreshingModels(false);
  }
};
```

---

## Implementation Phases

### Phase 1 — Foundation: types + shell + sidebar nav

**Goal:** Introduce the type system, sidebar nav, and section routing without moving any content. Zero regression risk.

**Tasks:**

- [x] Create `src/components/settings/types.ts`
  - `ProviderId` union (if Pre-work Fix 1 not yet done, do it here)
  - `SettingsSection` union (7 members — no `'integrations'` parent node)
  - `SECTION_META` constant record (label + icon + group for each section)
  - `isIntegrationSection` type guard
  - `SettingsSectionProps` base interface
- [x] Create `src/hooks/useAutoTimeout.ts` (replaces `safeTimeout`/`timeoutsRef` pattern)
- [x] Create `src/components/settings/SettingsSidebar.tsx`
  - Props: `activeSection: SettingsSection`, `onSelect: (s: SettingsSection) => void`, `integrationsOpen: boolean`, `onToggleIntegrations: () => void`
  - Derives nav items from `SECTION_META` — no hardcoded labels/icons in JSX
  - Active state: `bg-emerald-500/15 text-emerald-400`; hover: `text-gray-200 hover:bg-white/5`
  - Sub-items: `pl-8`, `text-xs`; visible when `integrationsOpen`
  - ARIA: `<nav aria-label="Settings navigation">` → `<ul role="list">` → `<li>` → `<button aria-current={active ? "page" : undefined}>`
  - Integrations group header: `aria-expanded={integrationsOpen}` on the toggle button
  - Keyboard: roving `tabindex` — active item gets `tabIndex={0}`, rest `tabIndex={-1}`; Up/Down arrows move focus via `itemRefs`; Tab moves to right pane

  ```tsx
  // Roving tabindex pattern
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'ArrowDown') itemRefs.current[idx + 1]?.focus();
    if (e.key === 'ArrowUp')   itemRefs.current[idx - 1]?.focus();
  };
  ```

- [x] Refactor `SettingsPanel.tsx`:
  - Add `activeSection` state (default: `props.initialSection ?? 'dashboard'`)
  - Add `localIntegrationsOpen` state; compute derived `integrationsOpen`
  - Add `initialSection?: SettingsSection` prop (drop `initialSubSection` — deferred to Cluster D)
  - Layout: `flex h-full` → `<SettingsSidebar />` (fixed `w-44 shrink-0`) + right pane (`flex-1 min-h-0 overflow-y-auto`)
  - Right pane: `{activeSection === 'dashboard' && <existing JSX>}` + `{activeSection !== 'dashboard' && <div className="p-6 text-gray-400">Coming soon</div>}`
  - Clicking Integrations parent button: if currently on a child → collapse local flag (section stays); otherwise → `onSelect('jira')` (navigate directly to JIRA)
  - `isInline` prop kept — shell still conditionally renders close button

- [x] Create `src/components/settings/settingsSectionMap.ts` (placeholder — add entries as phases complete)

**Acceptance criteria:**
- Sidebar renders with all 7 nav items (4 root + 3 integration children)
- Clicking Dashboard shows existing content; all other sections show "Coming soon"
- Clicking Integrations header navigates to JIRA (not an overview page)
- Clicking any integration child auto-expands tree and navigates
- Navigating to JIRA/Sentry/KB with `initialSection` prop expands the integration tree
- Offline banner renders above sidebar

---

### Phase 2 — Extract SettingsDashboard

**Goal:** Move the 3-card overview to a read-only summary component. Simplest extraction — no `settings` mutation.

**Tasks:**

- [x] Create `src/components/settings/SettingsDashboard.tsx`
  - Props: `providerLabel: string`, `modelLabel: string`, `jiraEnabled: boolean`, `sentryEnabled: boolean`, `onNavigate: (s: SettingsSection) => void`
  - Loads own connection status: `jiraConnected`, `sentryConnected` via `getJiraConfig()` / `getSentryConfig()` on mount (with `cancelled` guard)
  - Moves: 3-card grid (lines 708–849)
  - **Remove** theme toggle, PII toggle, default analysis from dashboard card — those move to PreferencesSection in Phase 5. Replace with static summary text derived from props.
  - "Change Provider" → `onNavigate('ai-provider')`
  - "Manage Integrations" → `onNavigate('jira')`
  - Section transition: add `className="animate-fadeIn"` with `@keyframes fadeIn` in `styles.css` (120ms ease-out, opacity 0→1)

- [x] Update `SettingsPanel.tsx`:
  - Replace dashboard JSX with `<SettingsDashboard providerLabel={...} modelLabel={...} ... onNavigate={setActiveSection} />`
  - Shell derives `providerLabel` / `modelLabel` from `settings` — Dashboard never sees the full Settings object
  - Remove `jiraConnected`, `sentryConnected` state from shell
  - Add `animate-fadeIn` CSS class to the right-pane content wrapper

- [x] Add to `settingsSectionMap.ts`: `'dashboard': lazy(() => import('./SettingsDashboard'))`

**Acceptance criteria:**
- Dashboard renders 3 cards with correct provider/model summary
- "Change Provider" and "Manage Integrations" navigate correctly (to placeholders at this stage)
- JIRA/Sentry connected badges show correctly
- 120ms fade plays on section switch

---

### Phase 3 — Wire integrations + extract CodexMgXSettings

**Goal:** Make JIRA, Sentry, and Knowledge Base sections fully functional. Only CodexMgX needs extracting — the other three sub-components already exist.

**Tasks:**

- [x] Rename `onConfigChange` → `onSettingsChange` in:
  - `src/components/JiraSettings.tsx` (interface + prop usage)
  - `src/components/SentrySettings.tsx`
  - `src/components/OpenSearchSettings.tsx`
  - `src/components/KeeperSettings.tsx`
  - All call sites in `SettingsPanel.tsx`

- [x] Create `src/components/settings/CodexMgXSettings.tsx`
  - Props: `onSettingsChange?: () => void`
  - Fully autonomous: loads config on mount (with `cancelled` guard), saves via own "Save" button
  - Moves: inline CodexMgX block (lines ~908–941): enable toggle, credentials info box, `codexMgxAdvanced` sub-accordion for script path
  - State: `codexMgxConfig`, `codexMgxAdvanced` — owned locally
  - Remove `saveCodexMgXConfig` call from shell's `handleSaveSettings`

- [x] Update `SettingsPanel.tsx` right-pane switch (or `settingsSectionMap.ts`):
  - `'jira'` → `<Suspense><JiraSettings onSettingsChange={onSettingsChange} /></Suspense>`
  - `'sentry'` → `<Suspense><SentrySettings onSettingsChange={onSettingsChange} /></Suspense>`
  - `'knowledge-base'` → inline:
    ```tsx
    <div className="space-y-6 p-6">
      <h2 className="text-sm font-semibold text-gray-200">Knowledge Base</h2>
      <Suspense fallback={<SectionSkeleton />}><OpenSearchSettings onSettingsChange={...} /></Suspense>
      <Suspense fallback={<SectionSkeleton />}><CodexMgXSettings onSettingsChange={...} /></Suspense>
    </div>
    ```
  - Remove old integrations expansion JSX (lines 852–941) from SettingsPanel

- [x] Add entries to `settingsSectionMap.ts` for jira, sentry, knowledge-base

**Acceptance criteria:**
- JIRA, Sentry, Knowledge Base sections all render and function correctly
- CodexMgX enable/disable and script path work independently of the global Save
- `onSettingsChange` prop name consistent across all 4 sub-components

---

### Phase 4 — Extract MaintenanceSection

**Goal:** Move all maintenance tooling out of the Advanced accordion. Fully self-contained — no shared `settings` state. `EmbeddedConsoleViewer` kept mounted with CSS hide.

**Tasks:**

- [x] Create `src/components/settings/MaintenanceSection.tsx`
  - Props: `className?: string` (for CSS-hide from shell; extends `SettingsSectionProps` minus `onNavigate`)
  - Moves all state: `isCheckingUpdate`, `updateMessage`, `diagnosticsMessage`, `isAutoTagging`, `autoTagMessage`, `crashLogDir`, `crashLogMsg`, `stabilityMode`, `stabilityMsg`, `defaultExportDir`
  - Replaces `safeTimeout`/`timeoutsRef` with `useAutoTimeout()` hook
  - Loads `crashLogDir` and `defaultExportDir` in `useEffect([], [])` on mount (not deferred to accordion open)
  - `EmbeddedConsoleViewer` rendered always but passed the parent `className` to hide/show
  - Lazy imports: `DatabaseAdminSection`, `EmbeddedConsoleViewer` — keep as `React.lazy()`
  - Layout: single-column with labelled subsections (no 3-column grid — that grid was a space compromise in the old accordion)

- [x] Update `SettingsPanel.tsx`:
  - Mount `<MaintenanceSection className={activeSection === 'maintenance' ? 'block' : 'hidden'} />` **always** (outside the lazy section switch) — preserves the live console stream
  - Remove all state variables and JSX moved to MaintenanceSection

**Acceptance criteria:**
- Maintenance section renders all tools in single-column layout
- Console viewer continues streaming when navigating away from Maintenance and back
- All maintenance actions still work: update check, diagnostics, auto-tag, crash log dir, stability mode, export location, DB admin

---

### Phase 5 — Extract PreferencesSection

**Goal:** Move theme, PII, default analysis, feature toggles, and active providers into one section. Receives `settings` via props.

**Tasks:**

- [x] Create `src/components/settings/PreferencesSection.tsx`
  - Props: `settings: Settings`, `onSettingsChange: (updater: (prev: Settings) => Settings) => void`, `darkMode: boolean`, `onThemeChange: (dark: boolean) => void`
  - Moves: `defaultAnalysisMode` state (initialized from `settings.defaultAnalysisMode ?? 'quick'`)
  - Moves all JSX:
    - Theme toggle + PII toggle (currently in Dashboard overview card and Advanced)
    - Default analysis segmented control
    - `FeatureToggleRow` × 4 (Visible Menu Items, lines 1118–1155)
    - Active Providers checkboxes + circuit breaker indicators (lines 1157–1200)
  - Groups into 3 titled subsections: "General", "Visible Features", "Active Providers"
  - Uses `useAutoTimeout()` for any toast messages
  - All `setSettings` / `onSettingsChange` calls use the functional updater form

- [x] Update `SettingsPanel.tsx`:
  - `'preferences'` → `<PreferencesSection settings={settings} onSettingsChange={handleSettingsChange} darkMode={darkMode} onThemeChange={onThemeChange} />`
  - Remove `darkMode` and `onThemeChange` from the **shell** interface — they pass through to PreferencesSection only (shell still receives them if App.tsx passes them, but doesn't use them directly)
  - Remove moved state + JSX

- [x] Add to `settingsSectionMap.ts`: `'preferences': lazy(() => import('./PreferencesSection'))`

**Acceptance criteria:**
- All preference controls render in 3 labelled groups
- Theme change applies immediately via `onThemeChange`
- PII toggle, default analysis mode, feature toggles work
- Active Providers checkboxes show circuit-breaker state
- Save Settings in footer persists changes

---

### Phase 6 — Extract AiProviderSection + shell cleanup

**Goal:** Move the entire AI configuration block. Most complex extraction. After this phase the shell reaches its target line count.

**Tasks:**

- [x] Create `src/components/settings/AiProviderSection.tsx`
  - Props: `settings: Settings`, `onSettingsChange: (updater: (prev: Settings) => Settings) => void`, `onNavigate: (s: SettingsSection) => void`
  - Moves all local state: `isTestingConnection`, `connectionTestResult`, `isRefreshingModels`, `modelsMessage`, `cachedModels`, `modelFilter`, `keeperConfig`, `showManualKeys`, `showApiKeys`
  - Uses `useAutoTimeout()` for message toasts
  - **All async handlers use functional updater**: `onSettingsChange(prev => ({ ...prev, ... }))` — no stale-closure spreads
  - `handleRefreshModels` captures `settings.provider` at call start (pre-work Fix 5 pattern)
  - `handleTestConnection` awaits `handleRefreshModels` (fixes the unawaited call)
  - `keeperConfig` loaded on mount with `cancelled` guard (same pattern as KeeperSettings)
  - `cachedModels` TTL check runs before any background refresh
  - Lazy imports: `KeeperSettings` — keep as `React.lazy()`
  - Moves all JSX from lines 952–1113: provider select, llama info box, KeeperSettings, manual API keys collapsible, ModelPicker, auxiliary model select, Test Connection

- [x] Shell cleanup (`SettingsPanel.tsx`):
  - `'ai-provider'` → `<AiProviderSection settings={settings} onSettingsChange={handleSettingsChange} onNavigate={setActiveSection} />`
  - Remove `advancedOpen` state (eliminated — no accordion needed)
  - Remove all state and refs that moved to sections
  - Remove all lazy imports no longer used at shell level
  - Shell `useAutoTimeout()` for save toast only
  - Verify shell has only: `activeSection`, `localIntegrationsOpen`, `settings`, `isSaving`, `saveMessage`, `isOnline`
  - Add `settings.provider: ProviderId` if Pre-work Fix 1 not yet applied
  - `tsc --noEmit` — zero errors
  - `npm test` — all passing tests remain passing

- [x] Add to `settingsSectionMap.ts`: `'ai-provider': lazy(() => import('./AiProviderSection'))`

**Acceptance criteria:**
- AI Provider section renders provider dropdown, Keeper settings, API keys, model picker, auxiliary model, test connection
- Switching provider updates model list; rapid switches don't show stale models
- Keeper active → manual key inputs collapse
- Test Connection shows result and triggers model refresh (sequentially, not concurrently)
- Save Settings in footer persists all AI settings
- `SettingsPanel.tsx` ≤ 150 lines
- Zero TypeScript errors

---

## Section Content Map (reference)

| Section | Content |
|---|---|
| **Dashboard** | AI summary card (providerLabel, modelLabel) + "Change Provider" → AI Provider; Integration status card (JIRA/Sentry/KB badges) + "Manage" → JIRA; Summary card (no quick-toggles) |
| **AI Provider** | Provider select → Keeper Secrets Manager → Manual API keys (collapsed when Keeper active) → Model picker → Auxiliary model → Test Connection |
| **JIRA** | Full `JiraSettings.tsx` |
| **Sentry** | Full `SentrySettings.tsx` |
| **Knowledge Base** | `OpenSearchSettings` + `CodexMgXSettings` (stacked inline, no wrapper component) |
| **Preferences** | General (theme, PII, analysis mode) → Visible Features (4× toggles) → Active Providers (checkboxes + circuit breakers) |
| **Maintenance** | Update check → Diagnostics → Auto-tag → Crash log dir → Stability mode → Export dir → DB admin → Console viewer (always mounted, CSS-hidden when not active) |

---

## Acceptance Criteria

### Functional requirements
- [x] All 7 sidebar nav items are reachable and render correctly
- [x] Integrations tree auto-expands when navigating to JIRA/Sentry/KB; collapses when navigating away unless child is active
- [x] All existing settings operations work identically: save, test connection, model refresh, JIRA connect, Sentry test, KB import, Keeper map, diagnostics export, auto-tag, crash log dir, stability mode, DB admin
- [x] Dashboard "Change Provider" → AI Provider; "Manage Integrations" → JIRA
- [x] `initialSection` prop correctly initialises active section and expands integrations tree if needed
- [x] Offline banner visible regardless of active section
- [x] `EmbeddedConsoleViewer` stream survives navigate-away and return
- [x] CodexMgX save is independent of global Save Settings button
- [x] Arrow key navigation works within sidebar; Tab moves to right pane

### Non-functional requirements
- [x] `SettingsPanel.tsx` ≤ 150 lines after Phase 6
- [x] No TypeScript errors (`tsc --noEmit`)
- [x] All currently-passing tests remain passing (`npm test`)
- [x] No new `any` types introduced
- [x] `onSettingsChange` prop name used consistently (no `onConfigChange` remaining)
- [x] All `setSettings` calls in async handlers use functional updater form

### Quality gates
- [x] Smoke test all 7 sections + 3 integration sub-sections in dev mode
- [x] Verify save/cancel on AI Provider and Preferences sections
- [x] Verify all integration sub-components still load lazily (Suspense fallbacks present)
- [x] Verify rapid provider switching doesn't produce stale model list
- [x] Verify rapid open/close of Settings panel doesn't produce stale state (abort flag)

---

## Dependencies & Prerequisites

**Required before Phase 1:**
- Pre-work Fixes 1–5 (committed separately) — reduce noise during extraction
- `useAutoTimeout.ts` created in Phase 1 before section files import it

**Phase ordering:**
- Phase 1 must complete before Phases 2–6 (establishes types and shell scaffold)
- Phases 2–6 are independent of each other after Phase 1
- Recommended order (easiest → hardest): 2 → 3 → 4 → 5 → 6

---

## Risk Analysis

| Risk | Mitigation |
|---|---|
| `settings` prop threading — AiProviderSection and PreferencesSection both receive `settings` | Acceptable: 2 levels deep. Context API adds indirection without benefit at this scale. |
| `codexMgxConfig` save removed from `handleSaveSettings` — integration not tested | Explicit acceptance criterion: verify CodexMgX save works independently in Phase 3 smoke test |
| Lazy-loaded sub-components (KeeperSettings, DatabaseAdminSection) must stay lazy | Pre-phase checklist: verify `React.lazy()` preserved in each new section file's import |
| `EmbeddedConsoleViewer` stream loss if accidentally unmounted | Phase 4 explicitly mounts it always with CSS-hide; acceptance criterion verifies stream survives navigation |
| `handleTestConnection` calling `handleRefreshModels` unawaited — cosmetic jank | Pre-work Fix 5 and Phase 6 task both call this out; resolved in AiProviderSection extraction |
| `isInline` prop branching — shell still needs to render without modal wrapper | Phase 6 cleanup task explicitly: "verify isInline prop honoured" |
| Phase 2 Dashboard is read-only — Preferences card quick-toggles disappear temporarily | Expected during development. Preferences card shown as static text in Dashboard until Phase 5 completes |
| `SECTION_META` typed record — adding new section requires updating both the union and the record | Feature: TypeScript compilation error serves as the exhaustiveness check |

---

## Future Considerations

- **Cluster D deep-links**: `initialSection?: SettingsSection` prop is designed and ready. Cluster D adds `initialSubSection` (typed as `'connection' | 'fields' | ...` per integration) when it ships.
- **Unsaved changes guard**: `isDirty = !deepEqual(settings, savedRef.current)` + inline confirmation bar (not modal) when navigating away from AI Provider or Preferences with unsaved changes. Pattern: VS Code style. Not in scope for Cluster B.
- **Settings search**: Once sections are extracted, a search input above the sidebar filtering by `SECTION_META.label` becomes feasible. Not in scope now.
- **State preservation on navigate**: If users frequently lose in-progress form state by accidentally navigating away, consider keeping section components mounted (CSS-hidden). Not needed yet — current behaviour (settings persist in shell until Save/Cancel) is acceptable.

---

## References

### Internal
- Brainstorm: `docs/brainstorms/2026-05-07-settings-panel-restructure-brainstorm.md`
- Current monolith: `src/components/SettingsPanel.tsx` (1,497 lines)
- Existing sub-components: `src/components/JiraSettings.tsx`, `SentrySettings.tsx`, `KeeperSettings.tsx`, `OpenSearchSettings.tsx`
- Race condition reference implementation (correct `cancelled` pattern): `src/components/KeeperSettings.tsx`
- Code extraction precedent: `src/components/code-analyzer/` (orchestrator + 6 tabs)
- App.tsx wiring: `currentView === 'configure'` → renders SettingsPanel with `isInline={true}`
- `isInline` prop preserved in shell throughout

### Async race conditions (lines in current SettingsPanel.tsx)
- Stale spreads: lines 362–367, 379, 451–458, 459, 628–633, 811, 813–815
- `loadSettings` missing abort: `useEffect` at ~line 271
- `handleRefreshModels` provider capture: ~line 514
- `handleTestConnection` unawaited call: lines 556–558
- `JiraSettings.loadConfig` missing cancel: `JiraSettings.tsx` line ~93
