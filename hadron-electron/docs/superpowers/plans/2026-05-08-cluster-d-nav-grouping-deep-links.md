# Cluster D: Navigation Grouping + Integration Deep-links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single thin nav divider with three explicitly labeled zones (Tools / Integrations / History), and add a direct "Configure →" button to each integration view's not-configured empty state.

**Architecture:** Two independent changes — (1) `Navigation.tsx` gains a local `NavSeparator` component and History moves to its own zone; (2) three integration views gain an optional `onOpenSettings` prop that renders a CTA button, wired from `App.tsx`'s existing `handleOpenSettings`. No new files, no new state, no architectural changes.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, lucide-react icons, Electron renderer process.

---

## File Map

| File | Change |
|------|--------|
| `src/components/Navigation.tsx` | Add `NavSeparator`, restructure tab arrays into three zones |
| `src/components/JiraAnalyzerView.tsx` | Add `onOpenSettings?` prop + "Configure JIRA →" button |
| `src/components/SentryAnalyzerView.tsx` | Add `onOpenSettings?` prop + "Configure Sentry →" button |
| `src/components/ReleaseNotesView.tsx` | Add `onOpenSettings?` prop + "Configure JIRA →" button |
| `src/App.tsx` | Pass `onOpenSettings={handleOpenSettings}` to all three views |

---

## Task 1: Three-zone Navigation

**Files:**
- Modify: `src/components/Navigation.tsx`

### Background

`Navigation.tsx` currently has:
- `coreTabs` array: Crash Analyzer, Code Analyzer, Performance Analyzer
- `integrationTabs` array: JIRA, Sentry, Release Notes, **History**
- A single `<div className="w-px h-5 self-center mx-1 bg-gray-600/30 shrink-0" />` thin divider between them

Goal: three zones separated by labeled dividers: Tools → Integrations → History.

- [ ] **Step 1: Add the `NavSeparator` component**

Add this function directly above the `Navigation` export function in `src/components/Navigation.tsx`:

```tsx
function NavSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-[5px] mx-1.5 flex-shrink-0" aria-hidden="true">
      <div className="w-px h-[18px] bg-gray-600/30" />
      <span
        className="text-[8px] uppercase tracking-widest"
        style={{ color: 'rgba(255,255,255,0.18)' }}
      >
        {label}
      </span>
      <div className="w-px h-[18px] bg-gray-600/30" />
    </div>
  )
}
```

- [ ] **Step 2: Restructure the tab arrays**

Inside the `Navigation` function body, replace:

```ts
const integrationTabs: TabConfig[] = [
  { id: "jira",          label: "JIRA Analyzer",   icon: Ticket,        enabled: showJiraAnalyzer,   settingsSection: "jira"  },
  { id: "sentry",        label: "Sentry Analyzer",  icon: AlertTriangle, enabled: showSentryAnalyzer, settingsSection: "sentry" },
  { id: "release_notes", label: "Release Notes",    icon: FileText,      enabled: showReleaseNotes,   settingsSection: "jira"  },
  { id: "history",       label: "History",          icon: History },
];
```

with:

```ts
const integrationTabs: TabConfig[] = [
  { id: "jira",          label: "JIRA Analyzer",  icon: Ticket,        enabled: showJiraAnalyzer,   settingsSection: "jira"   },
  { id: "sentry",        label: "Sentry Analyzer", icon: AlertTriangle, enabled: showSentryAnalyzer, settingsSection: "sentry" },
  { id: "release_notes", label: "Release Notes",   icon: FileText,      enabled: showReleaseNotes,   settingsSection: "jira"   },
];

const historyTab: TabConfig = { id: "history", label: "History", icon: History };
```

- [ ] **Step 3: Update the JSX render**

In the `return (...)` block, replace:

```tsx
{coreTabs.map(renderTab)}

{/* Visual separator between core tools and integrations */}
<div className="w-px h-5 self-center mx-1 bg-gray-600/30 shrink-0" aria-hidden="true" />

{integrationTabs.map(renderTab)}

{/* Spacer pushes Ask Hadron to right */}
<div className="flex-1" />
```

with:

```tsx
{coreTabs.map(renderTab)}

<NavSeparator label="Integrations" />

{integrationTabs.map(renderTab)}

<NavSeparator label="History" />

{renderTab(historyTab)}

{/* Spacer pushes Ask Hadron to right */}
<div className="flex-1" />
```

- [ ] **Step 4: Verify TypeScript — web process**

Run:
```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Verify existing tests still pass**

Run:
```bash
npm test
```

Expected: same pass/fail count as before this task (existing failures are pre-existing `better-sqlite3` ELF mismatch on WSL2, unrelated to this change).

- [ ] **Step 6: Commit**

```bash
git add src/components/Navigation.tsx
git commit -m "feat(nav): three-zone navigation — Tools / Integrations / History"
```

---

## Task 2: Integration Empty-State Deep-links

**Files:**
- Modify: `src/components/JiraAnalyzerView.tsx`
- Modify: `src/components/SentryAnalyzerView.tsx`
- Modify: `src/components/ReleaseNotesView.tsx`
- Modify: `src/App.tsx`

### Background

When JIRA/Sentry/Release Notes are not configured, each view shows a text description only — no button. The goal is to add a direct "Configure X →" button that opens the correct Settings section. `App.tsx` already has `handleOpenSettings(section?)` that does exactly this; it just hasn't been threaded down.

The prop is optional (`?`) so the views render safely without it (isolated tests, Storybook, etc.).

---

### 2a — JiraAnalyzerView

- [ ] **Step 1: Add `ExternalLink` to the lucide-react import in `JiraAnalyzerView.tsx`**

Current import (line 7–14):
```tsx
import {
  Ticket,
  AlertCircle,
  RefreshCw,
  // ... others
} from "lucide-react";
```

Add `ExternalLink` to that list:
```tsx
import {
  Ticket,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  // ... others
} from "lucide-react";
```

- [ ] **Step 2: Add `onOpenSettings` to the props interface**

Current `JiraAnalyzerViewProps` (around line 23):
```tsx
interface JiraAnalyzerViewProps {
  onAnalysisComplete?: (analysis: Analysis) => void;
}
```

Replace with:
```tsx
interface JiraAnalyzerViewProps {
  onAnalysisComplete?: (analysis: Analysis) => void;
  onOpenSettings?: (section: string) => void;
}
```

- [ ] **Step 3: Destructure the new prop in the function signature**

Current (line 35):
```tsx
export default function JiraAnalyzerView({ onAnalysisComplete }: JiraAnalyzerViewProps) {
```

Replace with:
```tsx
export default function JiraAnalyzerView({ onAnalysisComplete, onOpenSettings }: JiraAnalyzerViewProps) {
```

- [ ] **Step 4: Add the "Configure JIRA →" button in the not-configured block**

Locate the not-configured block (the `if (!configured)` branch). The inner `<div>` currently ends with:

```tsx
              <p className="text-xs text-gray-400 mt-1">
                Enable JIRA integration in Settings &rarr; Integrations &rarr; JIRA to connect
                your Atlassian instance. You'll need your JIRA URL, email, and an API token.
              </p>
            </div>
```

Add the button immediately after that closing `</p>`:

```tsx
              <p className="text-xs text-gray-400 mt-1">
                Enable JIRA integration in Settings &rarr; Integrations &rarr; JIRA to connect
                your Atlassian instance. You'll need your JIRA URL, email, and an API token.
              </p>
              {onOpenSettings && (
                <button
                  onClick={() => onOpenSettings('jira')}
                  className="mt-3 flex items-center gap-1.5 text-xs font-medium"
                  style={{ color: 'var(--hd-accent)' }}
                >
                  <ExternalLink className="w-3 h-3" />
                  Configure JIRA →
                </button>
              )}
            </div>
```

---

### 2b — SentryAnalyzerView

- [ ] **Step 5: Add `ExternalLink` to the lucide-react import in `SentryAnalyzerView.tsx`**

Find the lucide-react import block (line 7–20) and add `ExternalLink` to it.

- [ ] **Step 6: Add `onOpenSettings` to `SentryAnalyzerViewProps`**

Current (line 33):
```tsx
interface SentryAnalyzerViewProps {
  onAnalysisComplete?: (analysis: Analysis) => void;
}
```

Replace with:
```tsx
interface SentryAnalyzerViewProps {
  onAnalysisComplete?: (analysis: Analysis) => void;
  onOpenSettings?: (section: string) => void;
}
```

- [ ] **Step 7: Destructure `onOpenSettings` in the function signature**

Current (line 39):
```tsx
export default function SentryAnalyzerView({ onAnalysisComplete }: SentryAnalyzerViewProps) {
```

Replace with:
```tsx
export default function SentryAnalyzerView({ onAnalysisComplete, onOpenSettings }: SentryAnalyzerViewProps) {
```

- [ ] **Step 8: Add the "Configure Sentry →" button in the not-configured block**

The not-configured block (the `if (!configured)` branch, around line 120) currently ends with:

```tsx
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Settings className="w-4 h-4" />
          <span>Settings &gt; Integrations &gt; Sentry Integration</span>
        </div>
      </div>
```

Add the button after that inner `</div>`:

```tsx
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Settings className="w-4 h-4" />
          <span>Settings &gt; Integrations &gt; Sentry Integration</span>
        </div>
        {onOpenSettings && (
          <button
            onClick={() => onOpenSettings('sentry')}
            className="mt-4 flex items-center gap-1.5 text-xs font-medium"
            style={{ color: 'var(--hd-accent)' }}
          >
            <ExternalLink className="w-3 h-3" />
            Configure Sentry →
          </button>
        )}
      </div>
```

---

### 2c — ReleaseNotesView

- [ ] **Step 9: Add `ExternalLink` to the lucide-react import in `ReleaseNotesView.tsx`**

Current import (line 7):
```tsx
import { FileText, Wand2, CheckCircle, BookOpen, History, AlertCircle, Loader2 } from "lucide-react";
```

Replace with:
```tsx
import { FileText, Wand2, CheckCircle, BookOpen, History, AlertCircle, Loader2, ExternalLink } from "lucide-react";
```

- [ ] **Step 10: Add `onOpenSettings` to the function props**

`ReleaseNotesView` has no props interface — it takes no props. Change the signature:

Current (line 36):
```tsx
export default function ReleaseNotesView() {
```

Replace with:
```tsx
interface ReleaseNotesViewProps {
  onOpenSettings?: (section: string) => void;
}

export default function ReleaseNotesView({ onOpenSettings }: ReleaseNotesViewProps) {
```

- [ ] **Step 11: Add the "Configure JIRA →" button in the not-configured block**

The not-configured block (the `if (configured === false)` branch, around line 104) currently ends with:

```tsx
        <p className="text-gray-400 max-w-md mx-auto">
          The Release Notes Generator requires JIRA integration to fetch tickets.
          Configure your JIRA connection in Settings to get started.
        </p>
      </div>
```

Add the button after the closing `</p>`:

```tsx
        <p className="text-gray-400 max-w-md mx-auto">
          The Release Notes Generator requires JIRA integration to fetch tickets.
          Configure your JIRA connection in Settings to get started.
        </p>
        {onOpenSettings && (
          <button
            onClick={() => onOpenSettings('jira')}
            className="mt-4 flex items-center gap-1.5 text-xs font-medium mx-auto"
            style={{ color: 'var(--hd-accent)' }}
          >
            <ExternalLink className="w-3 h-3" />
            Configure JIRA →
          </button>
        )}
      </div>
```

---

### 2d — Wire `App.tsx`

- [ ] **Step 12: Pass `onOpenSettings` to JiraAnalyzerView in `App.tsx`**

Find (around line 753):
```tsx
<JiraAnalyzerView onAnalysisComplete={actions.viewAnalysis} />
```

Replace with:
```tsx
<JiraAnalyzerView onAnalysisComplete={actions.viewAnalysis} onOpenSettings={handleOpenSettings} />
```

- [ ] **Step 13: Pass `onOpenSettings` to SentryAnalyzerView in `App.tsx`**

Find (around line 762):
```tsx
<SentryAnalyzerView onAnalysisComplete={actions.viewAnalysis} />
```

Replace with:
```tsx
<SentryAnalyzerView onAnalysisComplete={actions.viewAnalysis} onOpenSettings={handleOpenSettings} />
```

- [ ] **Step 14: Pass `onOpenSettings` to ReleaseNotesView in `App.tsx`**

Find (around line 772):
```tsx
<ReleaseNotesView />
```

Replace with:
```tsx
<ReleaseNotesView onOpenSettings={handleOpenSettings} />
```

- [ ] **Step 15: Verify TypeScript — web process**

Run:
```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: 0 errors. This catches any prop mismatches — if `handleOpenSettings` type doesn't satisfy `(section: string) => void`, TypeScript will flag it here.

- [ ] **Step 16: Verify existing tests still pass**

Run:
```bash
npm test
```

Expected: same pass/fail count as before.

- [ ] **Step 17: Commit**

```bash
git add src/components/JiraAnalyzerView.tsx src/components/SentryAnalyzerView.tsx src/components/ReleaseNotesView.tsx src/App.tsx
git commit -m "feat(ux): add Configure → deep-link to unconfigured integration views"
```
