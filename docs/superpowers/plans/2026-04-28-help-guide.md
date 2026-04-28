# Help & Tutorial Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a comprehensive in-app help and tutorial guide to both Hadron Desktop and Hadron Web with a shared content base, sticky TOC, live search, IntersectionObserver scroll tracking, and a version upgrade banner.

**Architecture:** A shared `HelpSection[]` data array drives all rendering. `HelpView.tsx` (identical in both apps) owns layout, TOC, search, and scroll logic. Each app has its own `helpContent.ts` that imports the shared base and appends app-specific sections.

**Tech Stack:** React 18, TypeScript, Tailwind CSS (both apps), Lucide icons, CSS custom properties (`--hd-*` on desktop, Tailwind `slate-*` on web), `IntersectionObserver` API, `localStorage`.

---

## File Map

### New files

| File | Responsibility |
|---|---|
| `hadron-desktop/src/help/helpContentBase.tsx` | Canonical shared sections (platform: 'both') — 13 sections |
| `hadron-desktop/src/help/helpContent.ts` | Imports base + 5 desktop-only sections, exports `HelpSection[]` |
| `hadron-desktop/src/components/HelpView.tsx` | TOC + content + search + scroll tracking component |
| `hadron-web/frontend/src/help/helpContentBase.tsx` | Copy of desktop base — keep in sync comment |
| `hadron-web/frontend/src/help/helpContent.ts` | Imports base + 3 web-only sections, exports `HelpSection[]` |
| `hadron-web/frontend/src/components/HelpView.tsx` | Identical component to desktop |

### Modified files

| File | Change |
|---|---|
| `hadron-desktop/src/styles.css` | Append `.help-*` CSS classes |
| `hadron-desktop/src/hooks/useAppState.ts` | Add `'help'` to `View` union (line 19) |
| `hadron-desktop/src/components/Navigation.tsx` | Add Help tab before History; import `HelpCircle` |
| `hadron-desktop/src/App.tsx` | Add `helpScrollTarget` state + `HelpView` render arm |
| `hadron-web/frontend/src/index.css` | Append `.help-*` CSS classes (Tailwind color equivalents) |
| `hadron-web/frontend/src/App.tsx` | Add `'help'` to `View` union, header icon, render arm, version banner |

---

## Task 1: CSS Foundation (both apps)

**Files:**
- Modify: `hadron-desktop/src/styles.css` (append after line 994)
- Modify: `hadron-web/frontend/src/index.css` (append at end)

No automated tests exist for CSS. Verify visually in Task 5 (desktop) and Task 7 (web).

- [ ] **Step 1: Append help CSS to desktop styles.css**

Open `hadron-desktop/src/styles.css` and append at the very end:

```css
/* ============================================================================
   Help & Tutorial Guide
   ============================================================================ */

.help-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 1.5rem;
  align-items: start;
}

.help-toc {
  position: sticky;
  top: 0;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  padding-right: 0.5rem;
}

.help-toc-section {
  margin-bottom: 1.25rem;
}

.help-toc-label {
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--hd-text-muted);
  padding: 0 0.5rem;
  margin-bottom: 0.25rem;
}

.help-toc-link {
  display: block;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.8rem;
  color: var(--hd-text-secondary);
  text-decoration: none;
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}

.help-toc-link:hover {
  color: var(--hd-text);
  background: var(--hd-bg-hover);
}

.help-toc-link.active {
  color: var(--hd-accent);
  border-left-color: var(--hd-accent);
  background: rgba(var(--hd-accent-rgb, 99, 102, 241), 0.08);
}

.help-content {
  background: var(--hd-bg-raised);
  border: 1px solid var(--hd-border);
  border-radius: var(--hd-radius);
  padding: 1.5rem 2rem;
}

.help-section {
  scroll-margin-top: 1rem;
  margin-bottom: 2.5rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid var(--hd-border-subtle);
}

.help-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

.help-h2 {
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--hd-text);
  margin-bottom: 0.75rem;
}

.help-h3 {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--hd-text);
  margin-top: 1.25rem;
  margin-bottom: 0.5rem;
}

.help-p {
  font-size: 0.85rem;
  color: var(--hd-text-secondary);
  line-height: 1.7;
  margin-bottom: 0.75rem;
}

.help-callout {
  background: linear-gradient(135deg, rgba(99,102,241,0.07), rgba(99,102,241,0.03));
  border: 1px solid rgba(99,102,241,0.25);
  border-left: 3px solid var(--hd-accent);
  border-radius: var(--hd-radius-sm);
  padding: 0.75rem 1rem;
  margin: 0.75rem 0;
}

.help-callout-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--hd-accent);
  margin-bottom: 0.25rem;
}

.help-callout p {
  font-size: 0.82rem;
  color: var(--hd-text-secondary);
  margin: 0;
  line-height: 1.6;
}

.help-steps {
  list-style: none;
  padding: 0;
  margin: 0.75rem 0;
  counter-reset: help-step;
}

.help-steps li {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  padding: 0.6rem 0.75rem;
  background: var(--hd-bg-surface);
  border: 1px solid var(--hd-border-subtle);
  border-radius: var(--hd-radius-sm);
  margin-bottom: 0.4rem;
  counter-increment: help-step;
  font-size: 0.83rem;
  color: var(--hd-text-secondary);
  line-height: 1.5;
}

.help-steps li::before {
  content: counter(help-step);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.4rem;
  height: 1.4rem;
  background: var(--hd-accent);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  border-radius: 50%;
  flex-shrink: 0;
}

.help-code {
  display: block;
  background: #0d1117;
  border: 1px solid var(--hd-border);
  border-radius: var(--hd-radius-sm);
  padding: 0.75rem 1rem;
  font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 0.8rem;
  color: #c9d1d9;
  overflow-x: auto;
  margin: 0.5rem 0;
  white-space: pre;
}

.help-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
  margin: 0.75rem 0;
}

.help-table th {
  text-align: left;
  padding: 0.5rem 0.75rem;
  background: var(--hd-bg-surface);
  color: var(--hd-text-secondary);
  font-weight: 600;
  border-bottom: 1px solid var(--hd-border);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.help-table td {
  padding: 0.5rem 0.75rem;
  color: var(--hd-text-secondary);
  border-bottom: 1px solid var(--hd-border-subtle);
  vertical-align: top;
}

.help-table tr:last-child td {
  border-bottom: none;
}

.help-table code {
  font-family: monospace;
  font-size: 0.8em;
  background: var(--hd-bg-surface);
  padding: 0.1em 0.35em;
  border-radius: 3px;
}

.help-search {
  width: 100%;
  background: var(--hd-bg-surface);
  border: 1px solid var(--hd-border);
  border-radius: var(--hd-radius-sm);
  padding: 0.4rem 0.75rem;
  font-size: 0.85rem;
  color: var(--hd-text);
  outline: none;
  transition: border-color 0.15s;
}

.help-search:focus {
  border-color: var(--hd-accent);
}

.help-search::placeholder {
  color: var(--hd-text-muted);
}

.help-upgrade-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(99,102,241,0.06));
  border: 1px solid rgba(99,102,241,0.3);
  border-radius: var(--hd-radius-sm);
  padding: 0.6rem 1rem;
  margin-bottom: 1rem;
  font-size: 0.83rem;
  color: var(--hd-text-secondary);
}

.help-upgrade-link {
  color: var(--hd-accent);
  text-decoration: underline;
  cursor: pointer;
  background: none;
  border: none;
  font-size: inherit;
  padding: 0;
}

.help-upgrade-dismiss {
  background: none;
  border: none;
  color: var(--hd-text-muted);
  cursor: pointer;
  font-size: 1rem;
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
}
```

- [ ] **Step 2: Append help CSS to web index.css**

Open `hadron-web/frontend/src/index.css` and append at the very end:

```css
/* ============================================================================
   Help & Tutorial Guide
   ============================================================================ */

.help-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 1.5rem;
  align-items: start;
}

.help-toc {
  position: sticky;
  top: 0;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  padding-right: 0.5rem;
}

.help-toc-section {
  margin-bottom: 1.25rem;
}

.help-toc-label {
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94a3b8; /* slate-400 */
  padding: 0 0.5rem;
  margin-bottom: 0.25rem;
}

.help-toc-link {
  display: block;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.8rem;
  color: #cbd5e1; /* slate-300 */
  text-decoration: none;
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}

.help-toc-link:hover {
  color: #f1f5f9; /* slate-100 */
  background: rgba(255,255,255,0.05);
}

.help-toc-link.active {
  color: #3b82f6; /* blue-500 */
  border-left-color: #3b82f6;
  background: rgba(59,130,246,0.08);
}

.help-content {
  background: #1e293b; /* slate-800 */
  border: 1px solid #334155; /* slate-700 */
  border-radius: 0.5rem;
  padding: 1.5rem 2rem;
}

.help-section {
  scroll-margin-top: 1rem;
  margin-bottom: 2.5rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid #334155; /* slate-700 */
}

.help-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

.help-h2 {
  font-size: 1.15rem;
  font-weight: 600;
  color: #f1f5f9; /* slate-100 */
  margin-bottom: 0.75rem;
}

.help-h3 {
  font-size: 0.9rem;
  font-weight: 600;
  color: #f1f5f9;
  margin-top: 1.25rem;
  margin-bottom: 0.5rem;
}

.help-p {
  font-size: 0.85rem;
  color: #94a3b8; /* slate-400 */
  line-height: 1.7;
  margin-bottom: 0.75rem;
}

.help-callout {
  background: linear-gradient(135deg, rgba(59,130,246,0.07), rgba(59,130,246,0.03));
  border: 1px solid rgba(59,130,246,0.25);
  border-left: 3px solid #3b82f6;
  border-radius: 0.375rem;
  padding: 0.75rem 1rem;
  margin: 0.75rem 0;
}

.help-callout-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: #3b82f6;
  margin-bottom: 0.25rem;
}

.help-callout p {
  font-size: 0.82rem;
  color: #94a3b8;
  margin: 0;
  line-height: 1.6;
}

.help-steps {
  list-style: none;
  padding: 0;
  margin: 0.75rem 0;
  counter-reset: help-step;
}

.help-steps li {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  padding: 0.6rem 0.75rem;
  background: #0f172a; /* slate-900 */
  border: 1px solid #334155;
  border-radius: 0.375rem;
  margin-bottom: 0.4rem;
  counter-increment: help-step;
  font-size: 0.83rem;
  color: #94a3b8;
  line-height: 1.5;
}

.help-steps li::before {
  content: counter(help-step);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.4rem;
  height: 1.4rem;
  background: #3b82f6;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  border-radius: 50%;
  flex-shrink: 0;
}

.help-code {
  display: block;
  background: #0d1117;
  border: 1px solid #334155;
  border-radius: 0.375rem;
  padding: 0.75rem 1rem;
  font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 0.8rem;
  color: #c9d1d9;
  overflow-x: auto;
  margin: 0.5rem 0;
  white-space: pre;
}

.help-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
  margin: 0.75rem 0;
}

.help-table th {
  text-align: left;
  padding: 0.5rem 0.75rem;
  background: #0f172a;
  color: #94a3b8;
  font-weight: 600;
  border-bottom: 1px solid #334155;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.help-table td {
  padding: 0.5rem 0.75rem;
  color: #94a3b8;
  border-bottom: 1px solid #1e293b;
  vertical-align: top;
}

.help-table tr:last-child td {
  border-bottom: none;
}

.help-table code {
  font-family: monospace;
  font-size: 0.8em;
  background: #0f172a;
  padding: 0.1em 0.35em;
  border-radius: 3px;
}

.help-search {
  width: 100%;
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 0.375rem;
  padding: 0.4rem 0.75rem;
  font-size: 0.85rem;
  color: #f1f5f9;
  outline: none;
  transition: border-color 0.15s;
}

.help-search:focus {
  border-color: #3b82f6;
}

.help-search::placeholder {
  color: #475569; /* slate-600 */
}

.help-upgrade-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  background: rgba(59,130,246,0.08);
  border: 1px solid rgba(59,130,246,0.25);
  border-radius: 0.375rem;
  padding: 0.6rem 1rem;
  margin-bottom: 1rem;
  font-size: 0.83rem;
  color: #94a3b8;
}

.help-upgrade-link {
  color: #3b82f6;
  text-decoration: underline;
  cursor: pointer;
  background: none;
  border: none;
  font-size: inherit;
  padding: 0;
}

.help-upgrade-dismiss {
  background: none;
  border: none;
  color: #475569;
  cursor: pointer;
  font-size: 1rem;
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
}
```

- [ ] **Step 3: Commit**

```bash
git add hadron-desktop/src/styles.css hadron-web/frontend/src/index.css
git commit -m "feat: add help guide CSS classes to desktop and web"
```

---

## Task 2: HelpView Component (shared logic, desktop first)

**Files:**
- Create: `hadron-desktop/src/components/HelpView.tsx`

No unit tests for this component (UI-only rendering). Tested visually in Task 5.

- [ ] **Step 1: Create HelpView.tsx**

Create `hadron-desktop/src/components/HelpView.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";

export interface HelpSection {
  id: string;
  title: string;
  group: string;
  platform: "both" | "desktop" | "web";
  render: () => React.ReactNode;
}

interface HelpViewProps {
  sections: HelpSection[];
  scrollToId?: string;
}

// ── Helper sub-components ────────────────────────────────────────────────────

export function HelpCallout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="help-callout">
      <div className="help-callout-title">{title}</div>
      <p>{children}</p>
    </div>
  );
}

export function HelpSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="help-steps">
      {steps.map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
  );
}

export function HelpCode({ children }: { children: string }) {
  return <code className="help-code">{children}</code>;
}

export function HelpTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <table className="help-table">
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} dangerouslySetInnerHTML={{ __html: cell }} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── HelpView ─────────────────────────────────────────────────────────────────

export default function HelpView({ sections, scrollToId }: HelpViewProps) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Build groups for TOC
  const groups = Array.from(new Set(sections.map((s) => s.group)));

  // Search filter
  const filteredIds = query.trim()
    ? new Set(
        sections
          .filter((s) => {
            const el = document.getElementById(s.id);
            return el?.textContent?.toLowerCase().includes(query.toLowerCase());
          })
          .map((s) => s.id),
      )
    : null;

  // Scroll tracking
  useEffect(() => {
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-10% 0px -70% 0px", threshold: 0 },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observerRef.current!.observe(el);
    });
    return () => observerRef.current?.disconnect();
  }, [sections]);

  // Deep-link scroll on mount
  useEffect(() => {
    if (!scrollToId) return;
    const el = document.getElementById(scrollToId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(scrollToId);
    }
  }, [scrollToId]);

  return (
    <div className="help-layout">
      {/* TOC */}
      <aside className="help-toc">
        <input
          className="help-search mb-4"
          placeholder="Search help…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {groups.map((group) => (
          <div key={group} className="help-toc-section">
            <div className="help-toc-label">{group}</div>
            {sections
              .filter((s) => s.group === group)
              .map((s) => (
                <a
                  key={s.id}
                  className={`help-toc-link ${activeId === s.id ? "active" : ""}`}
                  style={
                    filteredIds && !filteredIds.has(s.id)
                      ? { display: "none" }
                      : undefined
                  }
                  onClick={() => {
                    document
                      .getElementById(s.id)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    setActiveId(s.id);
                  }}
                >
                  {s.title}
                </a>
              ))}
          </div>
        ))}
      </aside>

      {/* Content */}
      <article className="help-content" ref={contentRef}>
        {sections.map((s) => (
          <section
            key={s.id}
            id={s.id}
            className="help-section"
            style={
              filteredIds && !filteredIds.has(s.id)
                ? { display: "none" }
                : undefined
            }
          >
            {s.render()}
          </section>
        ))}
      </article>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add hadron-desktop/src/components/HelpView.tsx
git commit -m "feat: add HelpView component with TOC, search, and scroll tracking"
```

---

## Task 3: Shared Help Content Base

**Files:**
- Create: `hadron-desktop/src/help/helpContentBase.tsx`
- Create: `hadron-desktop/src/help/helpContent.ts`

All 13 shared sections written in full JSX. Helper components imported from `HelpView.tsx`.

- [ ] **Step 1: Create the help/ directory and helpContentBase.tsx**

Create `hadron-desktop/src/help/helpContentBase.tsx`:

```tsx
import { HelpCallout, HelpCode, HelpSteps, HelpTable } from "../components/HelpView";
import type { HelpSection } from "../components/HelpView";

// Keep in sync with hadron-web/frontend/src/help/helpContentBase.tsx

const sharedSections: HelpSection[] = [
  // ── Release Notes ──────────────────────────────────────────────────────────
  {
    id: "help-whatsnew-451",
    title: "What's new in 4.5.1",
    group: "Release Notes",
    platform: "both",
    render: () => (
      <>
        <h2 className="help-h2">What's new in Hadron 4.5.1</h2>
        <p className="help-p">Released 2026-04-17 — security and stability release.</p>
        <ul className="help-steps">
          <li>Security hardening and dependency updates across all crates and npm packages</li>
          <li>Bug fixes based on feedback from the 4.5.0 rollout</li>
          <li>Improved error messages when Keeper Secrets Manager config is missing or corrupt</li>
        </ul>
      </>
    ),
  },
  {
    id: "help-whatsnew-450",
    title: "What's new in 4.5.0",
    group: "Release Notes",
    platform: "both",
    render: () => (
      <>
        <h2 className="help-h2">What's new in Hadron 4.5.0</h2>
        <p className="help-p">Released 2026-04-17 — major feature release.</p>
        <HelpCallout title="CodexMgX Investigation Integration">
          Deep-dive JIRA ticket investigation is now available from the JIRA Analyzer and Ask Hadron. Hadron can fetch changelogs, comments, worklogs, related tickets, and Confluence documentation to build investigation hypotheses automatically.
        </HelpCallout>
        <ul className="help-steps">
          <li>New <strong>investigate_jira_ticket</strong> tool in Ask Hadron — say "investigate MGX-56673" to get a full deep-dive report</li>
          <li>Regression family detection with <strong>investigate_regression_family</strong></li>
          <li>Expected behavior / feature docs lookup with <strong>investigate_expected_behavior</strong></li>
          <li>Customer issue history with <strong>investigate_customer_history</strong></li>
          <li>Confluence search and page fetch directly from Ask Hadron chat</li>
          <li>Investigation settings in JIRA configuration (Confluence override, WHATS'ON KB URL, MOD Docs URL)</li>
          <li>FloatingElena widget now has an "Investigate JIRA ticket" quick action</li>
          <li>MCP server with 8 read-only tools for external integrations</li>
        </ul>
      </>
    ),
  },

  // ── Getting Started ────────────────────────────────────────────────────────
  {
    id: "help-overview",
    title: "What is Hadron?",
    group: "Getting Started",
    platform: "both",
    render: () => (
      <>
        <h2 className="help-h2">What is Hadron?</h2>
        <p className="help-p">
          Hadron is an AI-powered support analysis platform built specifically for the WHATS'ON / MediaGeniX broadcast management system. It transforms raw crash logs, JIRA tickets, and code into actionable insights — without requiring deep knowledge of the entire system.
        </p>
        <HelpCallout title="Who is Hadron for?">
          Support engineers, developers, and team leads who work with WHATS'ON incidents, crashes, and integration issues. Hadron saves hours of manual log triage and ticket investigation per day.
        </HelpCallout>
        <p className="help-p">
          Hadron connects to your AI provider (OpenAI or Anthropic), your JIRA instance, Confluence, and optionally Sentry and OpenSearch to give you a complete picture of every incident.
        </p>
      </>
    ),
  },
  {
    id: "help-concepts",
    title: "Core concepts",
    group: "Getting Started",
    platform: "both",
    render: () => (
      <>
        <h2 className="help-h2">Core concepts</h2>
        <HelpTable
          headers={["Concept", "Description"]}
          rows={[
            ["<strong>Analyzer</strong>", "A view that accepts input (crash log, code, JIRA key, Sentry issue) and produces an AI-powered analysis."],
            ["<strong>Analysis</strong>", "A saved result from an analyzer — stored in the database and accessible from History."],
            ["<strong>Ask Hadron</strong>", "An AI chat assistant with access to your analyses, knowledge base, JIRA, and investigation tools."],
            ["<strong>Gold Answer</strong>", "A verified, curated answer that Hadron surfaces preferentially for known problem patterns."],
            ["<strong>Investigation</strong>", "A deep-dive report for a JIRA ticket: changelog, comments, Confluence docs, hypotheses."],
            ["<strong>Provider</strong>", "The AI backend: OpenAI (GPT-4o) or Anthropic (Claude). Configured per-installation."],
          ]}
        />
      </>
    ),
  },
  {
    id: "help-quickstart",
    title: "5-minute quick start",
    group: "Getting Started",
    platform: "both",
    render: () => (
      <>
        <h2 className="help-h2">5-minute quick start</h2>
        <p className="help-p">Get your first crash analysis in under 5 minutes.</p>
        <HelpSteps
          steps={[
            "Open Settings and enter your AI API key (OpenAI or Anthropic). If using Hadron Web, your admin has already configured this.",
            "Drag a crash log file (.log, .txt) onto the Crash Analyzer drop zone, or paste the log text directly.",
            "Click Analyze. Hadron identifies the error type, root cause, severity, and suggested fixes in seconds.",
            "Click any suggested fix to copy it, or open Ask Hadron to drill deeper into the crash.",
            "Browse History to see all past analyses. Use the search bar to filter by filename or error type.",
          ]}
        />
        <HelpCallout title="JIRA connected?">
          If your JIRA instance is configured, Hadron can link crash analyses to open tickets and even create new ones with pre-filled summaries.
        </HelpCallout>
      </>
    ),
  },

  // ── Features ───────────────────────────────────────────────────────────────
  {
    id: "help-crash-analyzer",
    title: "Crash Analyzer",
    group: "Features",
    platform: "both",
    render: () => (
      <>
        <h2 className="help-h2">Crash Analyzer</h2>
        <p className="help-p">
          The Crash Analyzer is Hadron's core feature. It accepts WHATS'ON crash logs and produces a structured JSON analysis: exception type, component, severity, root cause, and suggested fixes.
        </p>
        <h3 className="help-h3">Supported input formats</h3>
        <ul className="help-steps">
          <li>Drag and drop a <code>.log</code> or <code>.txt</code> file onto the drop zone</li>
          <li>Click the drop zone to browse for a file</li>
          <li>On desktop, crash logs are auto-detected from the configured WHATS'ON log directory</li>
        </ul>
        <h3 className="help-h3">Severity levels</h3>
        <HelpTable
          headers={["Severity", "Meaning"]}
          rows={[
            ["<strong>CRITICAL</strong>", "System crash, data loss risk, production blocker"],
            ["<strong>HIGH</strong>", "Core feature broken, significant user impact"],
            ["<strong>MEDIUM</strong>", "Degraded functionality, workaround available"],
            ["<strong>LOW</strong>", "Minor issue, cosmetic or edge-case only"],
          ]}
        />
        <HelpCallout title="Confidence scoring">
          Each analysis includes a confidence rating (HIGH / MEDIUM / LOW) reflecting how certain the AI is about its root cause hypothesis. Low confidence means the log may lack enough context — try including more surrounding log lines.
        </HelpCallout>
      </>
    ),
  },
  {
    id: "help-code-analyzer",
    title: "Code Analyzer",
    group: "Features",
    platform: "both",
    render: () => (
      <>
        <h2 className="help-h2">Code Analyzer</h2>
        <p className="help-p">
          The Code Analyzer performs a comprehensive review of any source file. It produces a structured report with issues, a line-by-line walkthrough, quality scores, and an optimized version of the code.
        </p>
        <h3 className="help-h3">How to use</h3>
        <HelpSteps
          steps={[
            "Open the Code Analyzer tab.",
            "Paste code directly or upload a file. Hadron auto-detects the language.",
            "Click Analyze. The result is organized into tabs: Overview, Issues, Walkthrough, Optimized, Scores.",
            "Use the Issues tab to see severity-ranked findings with specific line references and fix suggestions.",
            "Use the Walkthrough tab to understand unfamiliar code section-by-section.",
          ]}
        />
        <h3 className="help-h3">Issue categories</h3>
        <HelpTable
          headers={["Category", "Examples"]}
          rows={[
            ["<strong>Security</strong>", "SQL injection, hardcoded credentials, unsafe deserialization"],
            ["<strong>Performance</strong>", "N+1 queries, unbounded loops, unnecessary allocations"],
            ["<strong>Error handling</strong>", "Uncaught exceptions, silent failures, bare panics"],
            ["<strong>Best practices</strong>", "Dead code, naming violations, missing documentation"],
          ]}
        />
      </>
    ),
  },
  {
    id: "help-jira-analyzer",
    title: "JIRA Analyzer",
    group: "Features",
    platform: "both",
    render: () => (
      <>
        <h2 className="help-h2">JIRA Analyzer</h2>
        <p className="help-p">
          The JIRA Analyzer fetches a ticket by key, runs an AI analysis of its summary, description, and comments, and produces a triage brief with suggested next actions. It also detects potential duplicate tickets.
        </p>
        <h3 className="help-h3">How to use</h3>
        <HelpSteps
          steps={[
            "Enter a JIRA ticket key (e.g. MGX-56673) in the input field.",
            "Click Analyze. Hadron fetches the ticket from your JIRA instance.",
            "Review the triage brief: problem summary, affected component, severity estimate, suggested next steps.",
            "Click 'Investigate' for a deeper dive — this triggers the full CodexMgX investigation pipeline.",
          ]}
        />
        <HelpCallout title="Requires JIRA configuration">
          The JIRA Analyzer requires a configured JIRA connection. Set this up in Settings → JIRA & Confluence.
        </HelpCallout>
      </>
    ),
  },
  {
    id: "help-performance-analyzer",
    title: "Performance Analyzer",
    group: "Features",
    platform: "both",
    render: () => (
      <>
        <h2 className="help-h2">Performance Analyzer</h2>
        <p className="help-p">
          The Performance Analyzer interprets WHATS'ON performance logs and profiling output. It identifies bottlenecks, slow queries, and resource contention issues.
        </p>
        <HelpSteps
          steps={[
            "Open the Performance Analyzer tab.",
            "Upload a performance log or profiling export.",
            "Hadron produces a ranked list of hotspots with timing data and optimization recommendations.",
          ]}
        />
      </>
    ),
  },
  {
    id: "help-sentry-analyzer",
    title: "Sentry Analyzer",
    group: "Features",
    platform: "both",
    render: () => (
      <>
        <h2 className="help-h2">Sentry Analyzer</h2>
        <p className="help-p">
          The Sentry Analyzer connects to your Sentry organization and analyzes issues directly from the Sentry API. It maps Sentry error groups to WHATS'ON components and cross-references with your crash analysis history.
        </p>
        <HelpCallout title="Requires Sentry configuration">
          Set up your Sentry DSN and organization token in Settings → Sentry.
        </HelpCallout>
        <HelpSteps
          steps={[
            "Open the Sentry Analyzer tab.",
            "Browse or search your Sentry issues. Hadron loads them from your configured Sentry org.",
            "Select an issue to run a full AI analysis with WHATS'ON context.",
            "Use 'Find similar' to search your history for related past crashes.",
          ]}
        />
      </>
    ),
  },
  {
    id: "help-ask-hadron",
    title: "Ask Hadron",
    group: "Features",
    platform: "both",
    render: () => (
      <>
        <h2 className="help-h2">Ask Hadron</h2>
        <p className="help-p">
          Ask Hadron is an AI chat assistant with access to all of Hadron's tools: your crash analysis history, knowledge base, JIRA, Confluence, and the investigation pipeline.
        </p>
        <h3 className="help-h3">What you can ask</h3>
        <ul className="help-steps">
          <li><strong>Crash questions:</strong> "What caused the crash in analysis #42?" / "Show me all CRITICAL crashes from last week"</li>
          <li><strong>JIRA investigation:</strong> "Investigate ticket MGX-56673" — triggers a full deep-dive report</li>
          <li><strong>Confluence lookup:</strong> "Find documentation about the BM module scheduler"</li>
          <li><strong>Pattern analysis:</strong> "What are the most common crash patterns this month?"</li>
          <li><strong>Gold answers:</strong> "How do I fix a NullPointerException in the PSI module?"</li>
        </ul>
        <h3 className="help-h3">Investigation tools</h3>
        <HelpTable
          headers={["Tool", "When Ask Hadron uses it"]}
          rows={[
            ["<code>investigate_jira_ticket</code>", "\"Investigate MGX-56673\", \"deep-dive on BR-997\", \"look into SRF-1165\""],
            ["<code>investigate_regression_family</code>", "\"Find related tickets\", \"Is this a regression?\""],
            ["<code>investigate_expected_behavior</code>", "\"How should the scheduler work?\", \"What does the BM module do?\""],
            ["<code>investigate_customer_history</code>", "\"What other issues did this customer report?\""],
            ["<code>search_confluence</code>", "\"Find Confluence docs about X\""],
            ["<code>get_confluence_page</code>", "\"Show me the page about Y\""],
          ]}
        />
        <HelpCallout title="Tip: be direct">
          Ask Hadron responds best to direct commands. "Investigate MGX-56673" is better than "Can you help me understand MGX-56673?". It will use its tools automatically — you don't need to specify which tool to use.
        </HelpCallout>
      </>
    ),
  },

  // ── Reference ──────────────────────────────────────────────────────────────
  {
    id: "help-shortcuts",
    title: "Keyboard shortcuts",
    group: "Reference",
    platform: "both",
    render: () => (
      <>
        <h2 className="help-h2">Keyboard shortcuts</h2>
        <HelpTable
          headers={["Shortcut", "Action"]}
          rows={[
            ["<code>Ctrl/Cmd + K</code>", "Open command search"],
            ["<code>Ctrl/Cmd + /</code>", "Open Ask Hadron"],
            ["<code>Escape</code>", "Close dialog / drawer"],
            ["<code>Enter</code>", "Submit analysis (when file loaded)"],
            ["<code>Ctrl/Cmd + S</code>", "Export current analysis"],
          ]}
        />
      </>
    ),
  },
  {
    id: "help-faq",
    title: "Troubleshooting & FAQ",
    group: "Reference",
    platform: "both",
    render: () => (
      <>
        <h2 className="help-h2">Troubleshooting & FAQ</h2>

        <h3 className="help-h3">Analysis returns no results</h3>
        <p className="help-p">
          Check that your AI API key is valid and has sufficient credits. On Hadron Web, contact your admin if analyses are failing for all users.
        </p>

        <h3 className="help-h3">JIRA Analyzer shows "JIRA is not configured"</h3>
        <p className="help-p">
          Open Settings → JIRA & Confluence and enter your JIRA base URL, email, and API token. The API token is a personal access token from your Atlassian account settings.
        </p>

        <h3 className="help-h3">Ask Hadron says "I cannot access external URLs"</h3>
        <p className="help-p">
          This can happen if JIRA is not configured. The investigation tools require a connected JIRA instance. Configure JIRA in Settings first.
        </p>

        <h3 className="help-h3">search_jira returns 0 results for a ticket key</h3>
        <p className="help-p">
          Ask Hadron directly: "Investigate MGX-56673" — this bypasses the search and fetches the ticket directly. The search tool uses full-text search which doesn't index ticket keys.
        </p>

        <h3 className="help-h3">Keeper Secrets Manager crash on startup</h3>
        <p className="help-p">
          If Hadron Desktop crashes on startup with a Keeper-related error, go to Settings → Keeper and reconfigure your Keeper credentials. An empty or corrupt keeper-config.json will cause this.
        </p>

        <HelpCallout title="Still stuck?">
          Open Ask Hadron and describe your problem — it can search the knowledge base and past analyses to suggest solutions. For bugs, report issues to your Hadron administrator.
        </HelpCallout>
      </>
    ),
  },
];

export default sharedSections;
```

- [ ] **Step 2: Create helpContent.ts for desktop**

Create `hadron-desktop/src/help/helpContent.ts`:

```ts
import sharedSections from "./helpContentBase";
import type { HelpSection } from "../components/HelpView";

// Desktop-only sections are appended after the shared base.
// Platform filtering has already been done here — HelpView receives a clean array.
const desktopOnlySections: HelpSection[] = [];

const desktopHelpContent: HelpSection[] = [
  ...sharedSections.filter((s) => s.platform === "both"),
  ...desktopOnlySections,
];

export default desktopHelpContent;
```

(Desktop-only sections are added in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add hadron-desktop/src/help/
git commit -m "feat: add shared help content base with 13 sections"
```

---

## Task 4: Desktop-Specific Content & Wiring

**Files:**
- Modify: `hadron-desktop/src/help/helpContent.ts` — populate `desktopOnlySections`
- Modify: `hadron-desktop/src/hooks/useAppState.ts` — add `'help'` to `View` union
- Modify: `hadron-desktop/src/components/Navigation.tsx` — add Help tab before History
- Modify: `hadron-desktop/src/App.tsx` — add `helpScrollTarget` state + `HelpView` render arm

- [ ] **Step 1: Add 'help' to View union in useAppState.ts**

In `hadron-desktop/src/hooks/useAppState.ts`, line 19, change:

```ts
export type View = 'analyze' | 'history' | 'detail' | 'translate' | 'performance' | 'jira' | 'sentry' | 'chat' | 'release_notes' | 'configure';
```

to:

```ts
export type View = 'analyze' | 'history' | 'detail' | 'translate' | 'performance' | 'jira' | 'sentry' | 'chat' | 'release_notes' | 'configure' | 'help';
```

- [ ] **Step 2: Add Help tab to Navigation.tsx**

In `hadron-desktop/src/components/Navigation.tsx`:

1. Change the import on line 2 to include `HelpCircle`:

```ts
import { FileUp, Code, History, Cpu, Ticket, MessageCircle, FileText, AlertTriangle, HelpCircle } from "lucide-react";
```

2. In the `tabs` array, insert the Help tab immediately before the `{ id: "history", ... }` entry:

```ts
const tabs: TabConfig[] = [
  { id: "analyze", label: "Crash Analyzer", icon: FileUp },
  ...(showCodeAnalyzer !== false ? [{ id: "translate" as View, label: "Code Analyzer", icon: Code }] : []),
  ...(showPerformanceAnalyzer !== false ? [{ id: "performance" as View, label: "Performance Analyzer", icon: Cpu }] : []),
  ...(showJiraAnalyzer ? [{ id: "jira" as View, label: "JIRA Analyzer", icon: Ticket }] : []),
  ...(showSentryAnalyzer ? [{ id: "sentry" as View, label: "Sentry Analyzer", icon: AlertTriangle }] : []),
  ...(showReleaseNotes ? [{ id: "release_notes" as View, label: "Release Notes", icon: FileText }] : []),
  { id: "help" as View, label: "Help", icon: HelpCircle },
  { id: "history", label: "History", icon: History },
];
```

- [ ] **Step 3: Add helpScrollTarget state and HelpView render arm to App.tsx**

In `hadron-desktop/src/App.tsx`:

1. Add the import at the top with other component imports:

```ts
import HelpView from "./components/HelpView";
import desktopHelpContent from "./help/helpContent";
```

2. Inside `AuthenticatedApp` (or the main App function, wherever `currentView` is destructured), add a local state for the scroll target. Find the block where other local `useState` calls live and add:

```ts
const [helpScrollTarget, setHelpScrollTarget] = useState<string | undefined>(undefined);
```

3. Find the block where views are conditionally rendered (around line 659 where `currentView === "analyze"` starts) and add the help arm — insert it near the other view arms:

```tsx
{currentView === "help" && (
  <HelpView
    sections={desktopHelpContent}
    scrollToId={helpScrollTarget}
  />
)}
```

4. Add the import for `useState` if it isn't already imported (it is — `useState` is already used in App.tsx).

- [ ] **Step 4: Populate desktopOnlySections in helpContent.ts**

Replace the empty array in `hadron-desktop/src/help/helpContent.ts` with the 5 desktop-only sections:

```tsx
import { HelpCallout, HelpSteps, HelpTable } from "../components/HelpView";

const desktopOnlySections: HelpSection[] = [
  {
    id: "help-provider-setup",
    title: "Provider setup",
    group: "Settings & Integration",
    platform: "desktop",
    render: () => (
      <>
        <h2 className="help-h2">AI Provider setup</h2>
        <p className="help-p">
          Hadron Desktop supports OpenAI and Anthropic as AI backends. Configure your provider and API key in Settings → AI Provider.
        </p>
        <HelpTable
          headers={["Provider", "Recommended model", "Notes"]}
          rows={[
            ["<strong>OpenAI</strong>", "gpt-4o", "Best for crash analysis; requires an OpenAI API key from platform.openai.com"],
            ["<strong>Anthropic</strong>", "claude-sonnet-4-6", "Strong at code analysis and investigation; requires key from console.anthropic.com"],
          ]}
        />
        <HelpCallout title="API key security">
          Your API key is stored encrypted in the local app data directory. It never leaves your machine except as the Authorization header on direct API calls to your chosen provider.
        </HelpCallout>
      </>
    ),
  },
  {
    id: "help-keeper",
    title: "Keeper Secrets Manager",
    group: "Settings & Integration",
    platform: "desktop",
    render: () => (
      <>
        <h2 className="help-h2">Keeper Secrets Manager</h2>
        <p className="help-p">
          Hadron Desktop can retrieve secrets (API keys, tokens) from Keeper Secrets Manager instead of storing them locally. This is the recommended approach for team deployments.
        </p>
        <HelpSteps
          steps={[
            "In Keeper, create a shared folder and add the secrets Hadron needs (AI API key, JIRA token, etc.).",
            "In Hadron Settings → Keeper, enter your Keeper One-Time Access Token (OTA).",
            "Hadron will fetch the secrets on startup and use them automatically.",
            "If Keeper is misconfigured or the config file is empty, Hadron will show an error on startup. Reconfigure from Settings.",
          ]}
        />
        <HelpCallout title="Config file location">
          The Keeper config is stored at <code>%APPDATA%\Hadron\keeper-config.json</code> on Windows. Delete this file to reset Keeper configuration.
        </HelpCallout>
      </>
    ),
  },
  {
    id: "help-jira-config",
    title: "JIRA & Confluence configuration",
    group: "Settings & Integration",
    platform: "desktop",
    render: () => (
      <>
        <h2 className="help-h2">JIRA & Confluence configuration</h2>
        <p className="help-p">
          Configure your Atlassian connection in Settings → JIRA & Confluence to enable the JIRA Analyzer, investigation tools, and Ask Hadron JIRA search.
        </p>
        <HelpTable
          headers={["Field", "Where to find it"]}
          rows={[
            ["<strong>JIRA Base URL</strong>", "Your Atlassian domain, e.g. <code>https://your-org.atlassian.net</code>"],
            ["<strong>Email</strong>", "Your Atlassian account email"],
            ["<strong>API Token</strong>", "Generate at id.atlassian.com → Security → API tokens"],
            ["<strong>Confluence Override</strong>", "Only if Confluence is on a different domain than JIRA"],
            ["<strong>WHATS'ON KB URL</strong>", "URL of the WHATS'ON knowledge base Confluence space"],
            ["<strong>MOD Docs URL</strong>", "URL of the MOD documentation Confluence space"],
          ]}
        />
      </>
    ),
  },
  {
    id: "help-opensearch",
    title: "OpenSearch configuration",
    group: "Settings & Integration",
    platform: "desktop",
    render: () => (
      <>
        <h2 className="help-h2">OpenSearch configuration</h2>
        <p className="help-p">
          Hadron Desktop can index crash analyses into OpenSearch / Elasticsearch for advanced full-text search and analytics dashboards.
        </p>
        <HelpSteps
          steps={[
            "In Settings → OpenSearch, enter your OpenSearch endpoint URL.",
            "Enter credentials if your cluster requires authentication.",
            "Click 'Test connection' to verify connectivity.",
            "Use the Search view to query your indexed analyses.",
          ]}
        />
      </>
    ),
  },
  {
    id: "help-floating-elena",
    title: "FloatingElena widget",
    group: "Features",
    platform: "desktop",
    render: () => (
      <>
        <h2 className="help-h2">FloatingElena widget</h2>
        <p className="help-p">
          FloatingElena is a floating quick-access widget that stays visible even when Hadron Desktop is in the background. It provides one-click access to common actions without switching windows.
        </p>
        <h3 className="help-h3">Quick actions</h3>
        <ul className="help-steps">
          <li><strong>Analyze clipboard</strong> — paste a crash log from your clipboard and analyze it instantly</li>
          <li><strong>Ask Hadron</strong> — open the Ask Hadron chat without navigating the main window</li>
          <li><strong>Investigate JIRA ticket</strong> — enter a ticket key for an immediate investigation</li>
          <li><strong>Recent analyses</strong> — access your last 5 analyses directly from the widget</li>
        </ul>
        <HelpCallout title="Enable in Settings">
          FloatingElena is disabled by default. Enable it in Settings → Interface → FloatingElena widget. You can pin it to any corner of your screen.
        </HelpCallout>
      </>
    ),
  },
];
```

The full `helpContent.ts` file should then be:

```ts
import sharedSections from "./helpContentBase";
import { HelpCallout, HelpSteps, HelpTable } from "../components/HelpView";
import type { HelpSection } from "../components/HelpView";

const desktopOnlySections: HelpSection[] = [
  // ... (paste the 5 sections from Step 4 above)
];

const desktopHelpContent: HelpSection[] = [
  ...sharedSections.filter((s) => s.platform === "both"),
  ...desktopOnlySections,
];

export default desktopHelpContent;
```

- [ ] **Step 5: Commit**

```bash
git add hadron-desktop/src/hooks/useAppState.ts \
        hadron-desktop/src/components/Navigation.tsx \
        hadron-desktop/src/App.tsx \
        hadron-desktop/src/help/helpContent.ts
git commit -m "feat: wire help view into desktop navigation and app routing"
```

---

## Task 5: Desktop Version Upgrade Banner

**Files:**
- Modify: `hadron-desktop/src/App.tsx` — add banner logic to the analyze view render block

The banner is shown on the `analyze` view when `localStorage('hadron_help_last_seen_version')` differs from `APP_VERSION`.

- [ ] **Step 1: Add banner state and logic to App.tsx**

In `hadron-desktop/src/App.tsx`, add the following import at the top with the other constant imports:

```ts
import { APP_VERSION } from "./constants/version";
```

Add banner state near `helpScrollTarget`:

```ts
const [showHelpBanner, setShowHelpBanner] = useState(false);
```

Add a `useEffect` for the banner logic (place it near the other `useEffect` calls in the component):

```ts
useEffect(() => {
  const lastSeen = localStorage.getItem("hadron_help_last_seen_version");
  if (lastSeen === undefined || lastSeen === null) {
    // First run — silently record current version, no banner
    localStorage.setItem("hadron_help_last_seen_version", APP_VERSION);
  } else if (lastSeen !== APP_VERSION) {
    setShowHelpBanner(true);
  }
}, []);
```

- [ ] **Step 2: Render the banner inside the analyze view block**

Find the `{currentView === "analyze" && (` block in App.tsx. Inside it, before the existing analyze content, add:

```tsx
{showHelpBanner && (
  <div className="help-upgrade-banner">
    <span>
      Hadron updated to {APP_VERSION} —{" "}
      <button
        className="help-upgrade-link"
        onClick={() => {
          setHelpScrollTarget("help-whatsnew-451");
          actions.setView("help");
          setShowHelpBanner(false);
          localStorage.setItem("hadron_help_last_seen_version", APP_VERSION);
        }}
      >
        see what's new →
      </button>
    </span>
    <button
      className="help-upgrade-dismiss"
      aria-label="Dismiss"
      onClick={() => {
        setShowHelpBanner(false);
        localStorage.setItem("hadron_help_last_seen_version", APP_VERSION);
      }}
    >
      ×
    </button>
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add hadron-desktop/src/App.tsx
git commit -m "feat: add version upgrade banner for desktop help guide"
```

---

## Task 6: Web Adaptation

**Files:**
- Create: `hadron-web/frontend/src/help/helpContentBase.tsx` — copy of desktop base
- Create: `hadron-web/frontend/src/help/helpContent.ts` — base + 3 web-only sections
- Create: `hadron-web/frontend/src/components/HelpView.tsx` — identical to desktop
- Modify: `hadron-web/frontend/src/App.tsx` — add `'help'` to View union, header icon, render arm, banner

- [ ] **Step 1: Copy HelpView.tsx to web**

Create `hadron-web/frontend/src/components/HelpView.tsx` with the **exact same content** as `hadron-desktop/src/components/HelpView.tsx` (created in Task 2, Step 1). Do not change a single character — the component is intentionally identical.

- [ ] **Step 2: Create web helpContentBase.tsx**

Create `hadron-web/frontend/src/help/helpContentBase.tsx` with the **exact same content** as `hadron-desktop/src/help/helpContentBase.tsx` (created in Task 3, Step 1).

The only addition is a comment at the top of the file (after the imports, before the array):

```ts
// Keep in sync with hadron-desktop/src/help/helpContentBase.tsx
```

- [ ] **Step 3: Create web helpContent.ts with 3 web-only sections**

Create `hadron-web/frontend/src/help/helpContent.ts`:

```ts
import sharedSections from "./helpContentBase";
import { HelpCallout, HelpSteps, HelpTable } from "../components/HelpView";
import type { HelpSection } from "../components/HelpView";

// Keep in sync with hadron-desktop/src/help/helpContent.ts (shared base only)

const webOnlySections: HelpSection[] = [
  {
    id: "help-admin-panel",
    title: "Admin panel",
    group: "Settings & Integration",
    platform: "web",
    render: () => (
      <>
        <h2 className="help-h2">Admin panel</h2>
        <p className="help-p">
          Hadron Web administrators can manage users, configure AI providers, set JIRA/Confluence credentials, and monitor system health from the Admin panel.
        </p>
        <HelpTable
          headers={["Section", "What you can do"]}
          rows={[
            ["<strong>Users</strong>", "Create, deactivate, and change roles for team members"],
            ["<strong>AI Settings</strong>", "Set the OpenAI or Anthropic API key and select the default model"],
            ["<strong>JIRA / Confluence</strong>", "Enter org-wide JIRA credentials used by all analyzers"],
            ["<strong>System</strong>", "View server logs, database stats, and background job status"],
          ]}
        />
        <HelpCallout title="Admin role required">
          Only users with the <strong>admin</strong> role can access the Admin panel. Contact your Hadron administrator to request access.
        </HelpCallout>
      </>
    ),
  },
  {
    id: "help-team",
    title: "Team management & roles",
    group: "Settings & Integration",
    platform: "web",
    render: () => (
      <>
        <h2 className="help-h2">Team management & roles</h2>
        <p className="help-p">
          Hadron Web uses role-based access control (RBAC) with three roles:
        </p>
        <HelpTable
          headers={["Role", "Capabilities"]}
          rows={[
            ["<strong>analyst</strong>", "Run analyses, use Ask Hadron, view history. Cannot access admin settings."],
            ["<strong>lead</strong>", "All analyst capabilities + view team feed, manage gold answers, access JIRA feed."],
            ["<strong>admin</strong>", "All lead capabilities + manage users, configure integrations, access admin panel."],
          ]}
        />
        <HelpSteps
          steps={[
            "Admins can manage team members from the Admin panel → Users section.",
            "To change a user's role, click their name and select a new role from the dropdown.",
            "Role changes take effect on the user's next page load.",
          ]}
        />
      </>
    ),
  },
  {
    id: "help-mcp-server",
    title: "MCP Server",
    group: "Settings & Integration",
    platform: "web",
    render: () => (
      <>
        <h2 className="help-h2">MCP Server</h2>
        <p className="help-p">
          Hadron Web exposes an MCP (Model Context Protocol) server at <code>/mcp</code> with 8 read-only tools. External AI assistants and automation pipelines can connect to it to query your analyses, knowledge base, and JIRA data.
        </p>
        <h3 className="help-h3">Available tools</h3>
        <HelpTable
          headers={["Tool", "Description"]}
          rows={[
            ["<code>search_analyses</code>", "Full-text search across all stored analyses"],
            ["<code>get_analysis</code>", "Fetch a specific analysis by ID"],
            ["<code>get_recent_analyses</code>", "List the most recent analyses"],
            ["<code>search_knowledge_base</code>", "Search the WHATS'ON knowledge base"],
            ["<code>get_top_signatures</code>", "Get the most common error signatures"],
            ["<code>get_error_patterns</code>", "Get aggregated error pattern statistics"],
            ["<code>search_jira</code>", "Search JIRA tickets (requires JIRA configuration)"],
            ["<code>get_jira_ticket</code>", "Fetch a specific JIRA ticket by key"],
          ]}
        />
        <HelpCallout title="Authentication">
          The MCP server uses the same token-based authentication as the Hadron API. Generate an API token from Settings → API Access.
        </HelpCallout>
        <p className="help-p">
          Full MCP documentation is available at <code>/mcp/README</code> on your Hadron Web instance, or in <code>docs/mcp/README.md</code> in the source repository.
        </p>
      </>
    ),
  },
];

const webHelpContent: HelpSection[] = [
  ...sharedSections.filter((s) => s.platform === "both"),
  ...webOnlySections,
];

export default webHelpContent;
```

- [ ] **Step 4: Add 'help' to View union in web App.tsx**

In `hadron-web/frontend/src/App.tsx`, change the `View` type (lines 30–45) to add `"help"`:

```ts
type View =
  | "analyze"
  | "history"
  | "chat"
  | "search"
  | "signatures"
  | "analytics"
  | "team"
  | "releases"
  | "sentry"
  | "code-analyzer"
  | "jira-analyzer"
  | "jira-feed"
  | "performance"
  | "settings"
  | "admin"
  | "help";
```

- [ ] **Step 5: Add HelpCircle icon button and HelpView render arm to web App.tsx**

In `hadron-web/frontend/src/App.tsx`:

1. Add imports at the top:

```ts
import HelpView from "./components/HelpView";
import webHelpContent from "./help/helpContent";
import { HelpCircle } from "lucide-react";
```

2. Add `helpScrollTarget` state near the `activeView` state:

```ts
const [helpScrollTarget, setHelpScrollTarget] = useState<string | undefined>(undefined);
```

3. In the header's right-side `<div className="flex items-center gap-4">` block (around line 175), add the help icon button between the user info block and the Sign out button:

```tsx
<button
  onClick={() => setActiveView("help")}
  className={`rounded-md p-1.5 transition-colors ${
    activeView === "help"
      ? "bg-blue-600 text-white"
      : "text-slate-400 hover:text-white hover:bg-slate-700"
  }`}
  title="Help & Tutorial Guide"
>
  <HelpCircle className="h-5 w-5" />
</button>
```

4. In the `<main>` content block, add the help view arm after the last existing view:

```tsx
{activeView === "help" && (
  <HelpView sections={webHelpContent} scrollToId={helpScrollTarget} />
)}
```

- [ ] **Step 6: Add version upgrade banner to web App.tsx**

Add banner state near `helpScrollTarget`:

```ts
const [showHelpBanner, setShowHelpBanner] = useState(false);
```

Add a `useEffect` for the banner logic:

```ts
const WEB_APP_VERSION = "4.5.1";

useEffect(() => {
  const lastSeen = localStorage.getItem("hadron_help_last_seen_version");
  if (lastSeen === undefined || lastSeen === null) {
    localStorage.setItem("hadron_help_last_seen_version", WEB_APP_VERSION);
  } else if (lastSeen !== WEB_APP_VERSION) {
    setShowHelpBanner(true);
  }
}, []);
```

Find the `{activeView === "analyze" && <AnalyzeView />}` line. Change it to:

```tsx
{activeView === "analyze" && (
  <div>
    {showHelpBanner && (
      <div className="help-upgrade-banner mb-4">
        <span>
          Hadron updated to {WEB_APP_VERSION} —{" "}
          <button
            className="help-upgrade-link"
            onClick={() => {
              setHelpScrollTarget("help-whatsnew-451");
              setActiveView("help");
              setShowHelpBanner(false);
              localStorage.setItem("hadron_help_last_seen_version", WEB_APP_VERSION);
            }}
          >
            see what's new →
          </button>
        </span>
        <button
          className="help-upgrade-dismiss"
          aria-label="Dismiss"
          onClick={() => {
            setShowHelpBanner(false);
            localStorage.setItem("hadron_help_last_seen_version", WEB_APP_VERSION);
          }}
        >
          ×
        </button>
      </div>
    )}
    <AnalyzeView />
  </div>
)}
```

- [ ] **Step 7: Commit**

```bash
git add hadron-web/frontend/src/help/ \
        hadron-web/frontend/src/components/HelpView.tsx \
        hadron-web/frontend/src/App.tsx
git commit -m "feat: add help guide to Hadron Web with web-specific sections and version banner"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|---|---|
| CSS Grid layout, sticky TOC, scroll tracking | Task 1 (CSS) + Task 2 (HelpView) |
| 13 shared sections with full JSX content | Task 3 |
| HelpCallout, HelpSteps, HelpCode, HelpTable helpers | Task 2 |
| Desktop View union + Navigation tab + App wiring | Task 4 |
| 5 desktop-only sections | Task 4 |
| Desktop version banner | Task 5 |
| Web HelpView (identical) | Task 6 |
| 3 web-only sections | Task 6 |
| Web header HelpCircle icon | Task 6 |
| Web version banner | Task 6 |
| Deep-link scrollToId support | Task 2 |
| Live search (hide/show sections + TOC links) | Task 2 |
| IntersectionObserver with `-10% 0px -70% 0px` | Task 2 |
| First-run silent acknowledge (no banner) | Tasks 5 + 6 |

All requirements covered. No gaps.

### Type consistency

- `HelpSection` defined once in `HelpView.tsx`, imported everywhere.
- `HelpCallout`, `HelpSteps`, `HelpCode`, `HelpTable` exported from `HelpView.tsx`, imported in content files.
- `desktopHelpContent` / `webHelpContent` both typed as `HelpSection[]`.
- `scrollToId?: string` prop matches the `helpScrollTarget: string | undefined` state in both App files.
- `setHelpScrollTarget` used consistently before `setView('help')` / `setActiveView('help')` in both banner and navigation calls.
