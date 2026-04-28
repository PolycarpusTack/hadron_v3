# Help & User Guide — Design Spec

**Date:** 2026-04-28
**Status:** Approved

---

## Overview

Add a comprehensive help and tutorial guide to both Hadron Desktop and Hadron Web, matching the quality and interaction model of the ServiceSentinel-Electron help view. The guide uses a data-driven architecture with shared core content and app-specific sections.

---

## Goals

- Give users a single place to learn every Hadron feature without leaving the app
- Surface "What's New" sections after version upgrades via a dismissible banner
- Match ServiceSentinel's TOC + content + search interaction model exactly
- Keep shared content in one canonical source so it never drifts between apps

---

## Architecture

### Content Schema

```ts
interface HelpSection {
  id: string;                        // anchor ID, e.g. 'help-crash-analyzer'
  title: string;                     // TOC link label
  group: string;                     // TOC group heading, e.g. 'Getting Started'
  platform: 'both' | 'desktop' | 'web';
  render: () => React.ReactNode;     // JSX content
}
```

### File Structure

```
hadron-desktop/src/
  help/
    helpContentBase.ts   ← shared sections (platform: 'both') — CANONICAL SOURCE
    helpContent.ts       ← imports base, appends desktop-only sections, exports HelpSection[]
  components/
    HelpView.tsx         ← rendering component (TOC + content + search + scroll tracking)

hadron-web/frontend/src/
  help/
    helpContentBase.ts   ← copy of desktop base — comment: "keep in sync with hadron-desktop"
    helpContent.ts       ← imports base, appends web-only sections, exports HelpSection[]
  components/
    HelpView.tsx         ← identical component to desktop
```

`HelpView` is intentionally identical in both apps. It receives `sections: HelpSection[]` as a prop and owns all rendering logic. `App.tsx` in each app only passes the right content array.

---

## Entry Points

### Desktop

- Add `'help'` to the `View` union type in `hadron-desktop/src/hooks/useAppState.ts`
- Add a `HelpCircle` icon tab to `Navigation.tsx` as the second-to-last tab, immediately before History (which stays the last tab before the flex spacer that pushes Ask Hadron right)
- Add `helpScrollTarget: string | undefined` to the desktop App state (local `useState`). Set when navigating from the version banner; cleared after `HelpView` consumes it.
- `App.tsx`: `{currentView === 'help' && <HelpView sections={desktopHelpContent} scrollToId={helpScrollTarget} />}`

### Web

- Add `'help'` to the `View` union type in `hadron-web/frontend/src/App.tsx`
- Add a `?` (HelpCircle) icon button to the header, right side, between the user info block and Sign out
- Clicking sets `activeView = 'help'`; the view renders in the `<main>` content area

### Version Upgrade Banner

Shown on the `analyze` view (the landing view in both apps) after a version upgrade.

**Desktop storage:** `invoke('store_setting', { key: 'help_last_seen_version' })` / `invoke('get_setting', { key: 'help_last_seen_version' })`

**Web storage:** `localStorage.getItem/setItem('hadron_help_last_seen_version')`

**Logic (both apps):**
1. On mount, read `lastSeenVersion`
2. If `lastSeenVersion === undefined` — first run, silently write current version, no banner
3. If `lastSeenVersion === APP_VERSION` — already seen, no banner
4. Otherwise — show banner: *"Hadron updated to X.X.X — see what's new →"*
5. Clicking the link sets view to `help` and passes `scrollToId = 'help-whatsnew-XYZ'`
6. Dismiss button writes current version and hides the banner

---

## HelpView Component

### Layout

CSS Grid: `260px sticky TOC | 1fr scrollable content`, matching ServiceSentinel's `.help-layout` pattern. The TOC column is `position: sticky; top: 0; max-height: calc(100vh - 120px); overflow-y: auto`.

### TOC

- Sections grouped by `group` field. `HelpView` renders whatever it receives — platform filtering is done upstream in each app's `helpContent.ts` before the array is passed as a prop.
- Each group: small-caps label + list of anchor links
- Active link: left accent border (`var(--hd-accent)` on desktop, `blue-500` on web)
- Hidden links: `display: none` when filtered by search

### Scroll Tracking

`IntersectionObserver` watches all rendered `<section>` elements with:
```
rootMargin: '-10% 0px -70% 0px'
threshold: 0
```
When a section enters the viewport, the matching TOC link receives the active state.

### Search

Live `<input>` in the view header. On each keystroke:
- Sections whose full `textContent` does not include the query get `display: none`
- Matching TOC links remain visible; non-matching ones hide
- Clearing the query restores all sections and links

### Deep-link Support

`HelpView` accepts `scrollToId?: string`. On mount, if set:
1. `document.getElementById(scrollToId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })`
2. Set that section's TOC link to active

### Helper Components

Both apps share the same helper sub-components:

**`<HelpCallout title="...">`** — highlighted info block with left accent border and subtle gradient, used for key concepts and warnings. Mirrors ServiceSentinel's `.help-callout`.

**`<HelpSteps>`** — ordered list with CSS counter bubbles (numbered steps in a card style), used for quick-start and workflow sequences. Mirrors ServiceSentinel's `.help-steps`.

**`<HelpCode>`** — monospace code/pre block with dark background, used for JQL examples, config snippets, etc.

**`<HelpTable>`** — styled table with header row, used for keyboard shortcuts, severity levels, etc.

---

## Content Plan

### Shared sections (`platform: 'both'`)

| Group | ID | Title |
|---|---|---|
| Release Notes | `help-whatsnew-451` | What's new in 4.5.1 |
| Release Notes | `help-whatsnew-450` | What's new in 4.5.0 |
| Getting Started | `help-overview` | What is Hadron? |
| Getting Started | `help-concepts` | Core concepts |
| Getting Started | `help-quickstart` | 5-minute quick start |
| Features | `help-crash-analyzer` | Crash Analyzer |
| Features | `help-code-analyzer` | Code Analyzer |
| Features | `help-jira-analyzer` | JIRA Analyzer |
| Features | `help-performance-analyzer` | Performance Analyzer |
| Features | `help-sentry-analyzer` | Sentry Analyzer |
| Features | `help-ask-hadron` | Ask Hadron |
| Reference | `help-shortcuts` | Keyboard shortcuts |
| Reference | `help-faq` | Troubleshooting & FAQ |

### Desktop-only sections (`platform: 'desktop'`)

| Group | ID | Title |
|---|---|---|
| Settings & Integration | `help-provider-setup` | Provider setup |
| Settings & Integration | `help-keeper` | Keeper Secrets Manager |
| Settings & Integration | `help-jira-config` | JIRA & Confluence configuration |
| Settings & Integration | `help-opensearch` | OpenSearch configuration |
| Features | `help-floating-elena` | FloatingElena widget |

### Web-only sections (`platform: 'web'`)

| Group | ID | Title |
|---|---|---|
| Settings & Integration | `help-admin-panel` | Admin panel |
| Settings & Integration | `help-team` | Team management & roles |
| Settings & Integration | `help-mcp-server` | MCP Server |

---

## Styling

### Desktop

Uses existing CSS custom properties (`var(--hd-*)`) and Tailwind. Help-specific styles added to `index.css` under a `.help-*` namespace matching ServiceSentinel's pattern:

- `.help-layout` — CSS Grid container
- `.help-toc`, `.help-toc-section`, `.help-toc-label`, `.help-toc-link` — TOC elements
- `.help-content` — content article (bg-panel, border, rounded-lg, padding)
- `.help-h2`, `.help-h3` — section headings
- `.help-callout`, `.help-callout-title` — callout box
- `.help-steps` — numbered step list
- `.help-code` — code block
- `.help-table` — data table
- `.help-section` — individual content section (scroll-margin-top, margin-bottom)

### Web

Same class names and structure; color values use Tailwind `slate-*` / `blue-*` palette instead of `--hd-*` variables.

---

## What's New Content (4.5.1 & 4.5.0)

**4.5.1** (security release, 2026-04-17):
- Security hardening and dependency updates
- Bug fixes from 4.5.0 feedback

**4.5.0** (2026-04-17):
- CodexMgX Investigation integration: deep-dive JIRA ticket investigation from the JIRA Analyzer and Ask Hadron
- `investigate_jira_ticket`, `investigate_regression_family`, `investigate_expected_behavior`, `investigate_customer_history` tools in Ask Hadron chat
- Confluence search and page fetch from Ask Hadron
- Investigation settings in JIRA configuration (Confluence override, WHATS'ON KB URL, MOD Docs)
- FloatingElena "Investigate JIRA ticket" quick action
- MCP server (8 read-only tools for external integrations)

---

## Out of Scope

- Searchable full-text index (browser `textContent` search is sufficient)
- Internationalisation
- Video embeds or animated tutorials
- User-editable notes or annotations

---

## Open Questions

None — all design decisions resolved.
