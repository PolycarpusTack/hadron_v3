# Hadron Design System — Style Guide

Design specification for the support engineering analysis tooling suite. This guide covers both the WCR Crash Analysis Viewer and the Database Performance Viewer, and should be followed when building any new analysis screen in the system.

---

## Design Philosophy

**Industrial Utilitarian.** These are tools used under time pressure — during incident response, crash triage, and performance investigation. Every design decision serves information density and scanability. Decoration is absent. Color is semantic. Typography is functional.

Three principles:

1. **Information first.** The data is the interface. Chrome, borders, and containers exist only to organize — never to decorate.
2. **Color means something.** If it's colored, it communicates severity, classification, or state. If it doesn't need to communicate, it's gray.
3. **Audience-aware density.** A DBA and an executive need different information at different densities. The same data is never presented the same way to both.

---

## Color System

### Backgrounds

The background palette is near-black with subtle elevation through transparency. No solid background colors except the base.

| Token | Value | Usage |
|-------|-------|-------|
| `base` | `#0a0a0c` | Page background (WCR viewer) |
| `base-db` | `#090a0d` | Page background (DB viewer — slightly bluer) |
| `surface-1` | `rgba(255,255,255,0.01)` | Header bar, tab bar |
| `surface-2` | `rgba(255,255,255,0.02)` | Cards, panels, table rows |
| `surface-3` | `rgba(255,255,255,0.03)` | Table headers, input fields, elevated panels |
| `surface-4` | `rgba(255,255,255,0.04)` | Buttons (default state), hover backgrounds |
| `overlay` | `rgba(0,0,0,0.3)` | Code blocks, source inspector |
| `backdrop` | `rgba(0,0,0,0.5)` | Modal/drawer backdrop with `backdrop-filter: blur(2px)` |
| `drawer` | `#111114` | Export drawer background |

**Rule:** Never use opaque backgrounds for content containers. The transparency layering creates depth without hard edges.

### Borders

| Token | Value | Usage |
|-------|-------|-------|
| `border-subtle` | `rgba(255,255,255,0.03)` | Table row dividers, inner separators |
| `border-default` | `rgba(255,255,255,0.06)` | Card borders, panel borders, section dividers |
| `border-emphasis` | `rgba(255,255,255,0.08)` | Input borders, button borders |
| `border-strong` | `rgba(255,255,255,0.1)` | Header button borders, drawer borders |
| `border-focus` | `rgba(255,255,255,0.12)` | Active/focused elements |

### Semantic Colors

Each color has a single semantic meaning. Do not use them interchangeably.

| Color | Hex | Meaning | Usage |
|-------|-----|---------|-------|
| **Red** | `#ef4444` | Danger / crash / failure / critical | Crash cause frames, critical severity, failed steps, TEMP exhaustion |
| **Amber** | `#f59e0b` | Warning / high severity / attention | High severity badge, P1 priority, warning indicators |
| **Blue** | `#3b82f6` | Informational / fix target / medium | Fix target frames, medium severity, component cards |
| **Cyan** | `#22d3ee` | Database / SQL / technical data | SQL keywords, table names, index names, DB engine badge |
| **Green** | `#10b981` | Success / safe / resolved / workaround | Fixed status, safe components, OK gauges, workaround panels |
| **Purple** | `#8b5cf6` | ORM / site / descriptor / metadata | GLORP mapping panel, site badges, index type tags |
| **Pink** | `#e879f9` | Communication / messaging | Slack export, chat summary |
| **Gray** | `#6b7280` | Neutral / infrastructure / low priority | Infrastructure frames, P2 priority, secondary text |

### Semantic Color Surfaces

Each semantic color has a transparent surface variant for panel backgrounds:

```
Background:   {color}08  (e.g., rgba(239,68,68,0.08))
Border:       {color}22  (e.g., rgba(239,68,68,0.22))
Light border: {color}15  (e.g., rgba(239,68,68,0.15))
Tag fill:     {color}18  (e.g., rgba(239,68,68,0.18))
```

Pattern: `background: rgba(R,G,B,0.06)` + `border: 1px solid rgba(R,G,B,0.15)` + `borderLeft: 3px solid #hex` for accented panels.

### Text Colors

| Token | Value | Usage |
|-------|-------|-------|
| `text-primary` | `#e5e7eb` | Headings, primary content, emphasis |
| `text-secondary` | `#d1d5db` | Body text, descriptions, table values |
| `text-tertiary` | `#9ca3af` | Secondary descriptions, metadata, timestamps |
| `text-muted` | `#6b7280` | Labels, section headers, inactive tabs |
| `text-faint` | `#4b5563` | Divider characters (│), disabled text, pipe separators |

### Severity Palette

| Level | Color | Background | Badge text |
|-------|-------|------------|------------|
| Critical | `#ef4444` | `rgba(239,68,68,0.12)` | `CRITICAL` |
| High | `#f59e0b` | `rgba(245,158,11,0.12)` | `HIGH` |
| Medium | `#3b82f6` | `rgba(59,130,246,0.12)` | `MEDIUM` |
| Low | `#10b981` | `rgba(16,185,129,0.12)` | `LOW` |

### Stack Frame Classification Colors

Used exclusively in the WCR Crash Analysis Viewer for annotating stack traces.

| Classification | Dot | Text | Background | Border | Meaning |
|---------------|-----|------|------------|--------|---------|
| Red | `#ef4444` | `#fca5a5` | `rgba(239,68,68,0.08)` | `#ef4444` | Crash cause — exception origin |
| Blue | `#3b82f6` | `#93c5fd` | `rgba(59,130,246,0.08)` | `#3b82f6` | Fix target — application code where a guard could prevent the crash |
| Orange | `#f97316` | `#fdba74` | `rgba(249,115,22,0.08)` | `#f97316` | Query/database issue — SQL or persistence concern |
| Gray | `#6b7280` | `#9ca3af` | `rgba(107,114,128,0.06)` | `#4b5563` | Infrastructure — VM, event system, framework plumbing |

---

## Typography

### Font Stack

| Role | Family | Fallback | Import |
|------|--------|----------|--------|
| **Body / UI** | IBM Plex Sans | `-apple-system, BlinkMacSystemFont, sans-serif` | Google Fonts: `wght@400;500;600;700` |
| **Code / Data** | JetBrains Mono | `Fira Code, monospace` | Google Fonts: `wght@400;500;700` |

**IBM Plex Sans** is the primary typeface. It is used for all body text, descriptions, headings, button labels (non-technical), and prose content. Chosen for its clarity at small sizes and its industrial character without being cold.

**JetBrains Mono** is the data typeface. It is used for all identifiers (crash IDs, ticket numbers, class names, method names, SQL), numeric values, timestamps, section header labels, format badges, code blocks, and any content that a developer would expect to be monospaced. This is the typeface that gives the tool its terminal-meets-dashboard character.

### Type Scale

| Usage | Family | Size | Weight | Letter-spacing | Color |
|-------|--------|------|--------|----------------|-------|
| Page title / hero | Plex Sans | 18px | 700 | 0 | `text-primary` |
| Section heading | JetBrains Mono | 10px | 700 | 0.12em | `text-muted` |
| Card label | JetBrains Mono | 10px | 400 | 0.1em | `text-muted` |
| Card value | JetBrains Mono | 13-14px | 600 | 0 | `text-primary` |
| Body text | Plex Sans | 13px | 400 | 0 | `text-secondary` |
| Small description | Plex Sans | 12px | 400 | 0 | `text-tertiary` |
| Code / identifiers | JetBrains Mono | 12-13px | 400-600 | 0 | Varies by context |
| SQL keywords | JetBrains Mono | 12px | 700 | 0 | `#22d3ee` (cyan) |
| Tag / badge | JetBrains Mono | 9px | 700 | 0.06-0.08em | Semantic color |
| Severity badge | JetBrains Mono | 11px | 700 | 0.08em | Severity color |
| Timestamp / metadata | JetBrains Mono | 11px | 400 | 0 | `text-muted` |
| Tooltip / hint | JetBrains Mono | 10px | 400 | 0 | `text-faint` |

### Typography Rules

- Section headers are ALWAYS uppercase, always JetBrains Mono, always `letter-spacing: 0.12em`, always `text-muted`. They are classification labels, not prose headings.
- Never use font sizes below 9px or above 20px. The scale is deliberately narrow to maintain information density.
- Severity and status labels are uppercase. Everything else is sentence case or code case (as authored).
- Line height for prose: `1.5-1.6`. Line height for code: `1.6-1.7`. Line height for dense data (tables, metadata): `1.3-1.4`.

---

## Spacing

The spacing system is deliberately compact. These tools prioritize information density over breathing room.

| Token | Value | Usage |
|-------|-------|-------|
| `space-xs` | 3-4px | Tag padding, inline gaps between small elements |
| `space-sm` | 5-6px | Button padding (vertical), tight grid gaps |
| `space-md` | 8-10px | Panel padding (small), grid gaps, list item spacing |
| `space-lg` | 12-14px | Panel padding (standard), section gaps, card padding |
| `space-xl` | 16-20px | Major section gaps, metadata panel padding |
| `space-2xl` | 24px | Page padding, content area padding, max section gap |

### Spacing Rules

- Grid gaps between cards: `10-12px`.
- Gaps between sections (collapsible `<Sec>` components): `20-24px`.
- Internal padding for panels/cards: `12-14px`.
- Code block padding: `10-16px`.
- Table cell padding: `7-8px` vertical, `12-14px` horizontal.
- The content area has a `maxWidth` of `960-1080px`. Content does not stretch to fill wide screens.

---

## Border Radius

| Usage | Radius |
|-------|--------|
| Full-width panels, cards, inputs | `6-8px` |
| Buttons | `4-6px` |
| Tags, badges | `3-4px` |
| Code blocks | `4-6px` |
| Severity dots | `50%` (circle) |
| Header color indicator | `2px` (square-ish) |
| Accented panels (left-border) | `0 4px 4px 0` (right side only) |

**Rule:** Radius never exceeds `10px` except for circular elements. Rounded corners are functional (indicating interactivity or containment), not decorative.

---

## Component Library

### Severity Badge

A compact inline badge showing severity level with a colored dot.

```
┌─────────────┐
│ ⬤  HIGH     │  ← JetBrains Mono 11px/700, letter-spacing 0.08em
└─────────────┘
   ↑ 6px dot     Background: severity surface color
                  Color: severity text color
```

### Info Card (Crd)

A metric card with a colored top border accent.

```
━━━━━━━━━━━━━━━  ← 2px top border in accent color
│ LABEL          │  ← JetBrains Mono 10px/400, text-muted, letter-spacing 0.1em
│ Value          │  ← JetBrains Mono 13px/600, text-primary
│ optional sub   │  ← 10px, text-muted
└────────────────┘
```

Grid layout: typically 3-4 columns at `repeat(N, 1fr)` with `10-12px` gap.

### Tag

A tiny inline label for classification, format type, or status.

```
┌──────┐
│ DOCX │  ← JetBrains Mono 9px/700, letter-spacing 0.06em
└──────┘
   Color: semantic color
   Background: {color}18
   Padding: 2px 6px
   Border-radius: 3px
```

### Collapsible Section (Sec)

Every content group is wrapped in a collapsible section with a monospaced header.

```
▶ SECTION TITLE                    [optional actions]
  ↑ rotates 90° when open          ↑ CopyBtn, etc.
  │
  └─ Children rendered when open
```

- Header: `▶` chevron + JetBrains Mono 10px/700, `letter-spacing: 0.12em`, `text-muted`.
- Chevron rotates `0° → 90°` with `transition: transform 0.15s`.
- Default state: open (`true`). Sections start expanded so the user sees everything on first load.
- Actions (buttons) appear right-aligned, only when section is open. They stop click propagation so they don't collapse the section.

### Copy Button (CopyBtn)

A small utility button that copies text to clipboard with feedback.

```
Default:  [Copy]     ← rgba(255,255,255,0.04) bg, text-tertiary
Copied:   [✓ Copied] ← green bg, green text, auto-resets after 2s
```

- Font: JetBrains Mono 11px.
- Transition: `all 0.2s`.
- Used on: code blocks, SQL panels, export items, customer replies.

### Gauge

A horizontal progress bar with label and value.

```
TEMP Tablespace                    94 GB / 100 GB (94%)
[████████████████████████████████████░░]
⚠ Sort operation requires ~142GB — exceeds available TEMP
```

- Bar height: `4-6px`.
- Bar radius: `2-3px`.
- Color auto-scales: `<60%` green, `60-85%` amber, `>85%` red. Can be overridden with `forceColor`.
- Warning text: red, 10px, prefixed with `⚠`.

### SQL View

Syntax-highlighted SQL display with bind value chips.

```
┌────────────────────────────────────────────┐
│ SELECT DISTINCT                            │  ← keywords in cyan (#22d3ee), bold
│     r.OID, r.TITLE, ...                    │  ← identifiers in text-secondary
│ FROM CM2RUN r                              │
│     JOIN CM2CONTRACT c ON ...              │
└────────────────────────────────────────────┘
  [:1] 'ACTIVE' VARCHAR2   [:2] 'PLANNED' VARCHAR2   ← bind value chips
```

- Background: `rgba(0,0,0,0.35)` with cyan border `rgba(6,182,212,0.15)`.
- Keywords detected via regex and wrapped in cyan/bold spans.
- Bind values rendered as chips below the SQL block, each showing position, value, and type.

### Execution Plan Tree

Indented tree showing query plan operations.

```
  1  SELECT STATEMENT              Cost: 284,712 | Rows: 847K
    2  SORT ORDER BY                Cost: 284,712 | Rows: 847K
       ⚠ TEMP spill — estimated 142GB for sort
    3  HASH UNIQUE (DISTINCT)       Cost: 198,400 | Rows: 847K
       ⚠ Redundant — OID already unique
      4  HASH JOIN                   Cost: 12,840 | Rows: 847K
        6  TABLE ACCESS FULL  [CM2RUN]          ← cyan tag
           ⚠ Full scan — no index on STATUS
```

- Each node has: ID, operation name, optional table tag (cyan), optional index tag (purple), cost/rows metadata right-aligned in gray.
- Indentation: `indent * 24px` left margin.
- Warned nodes: red-tinted background, red left border, red warning text below.
- Non-warned nodes: subtle background, default left border.

### Timeline (Journey / Session)

A vertical or horizontal timeline with step markers.

**Vertical (User Journey):**
```
  ○ 1. Logged in as user
  │
  ○ 2. Opened planner
  │
  ● 3. Permission failed        ← red dot for failure steps
  │
  ● 4. Application crashed      ← red dot + red text
```

- Dot: `11px` circle, `2px` border.
- Normal: transparent fill, subtle border.
- Failure: `#ef4444` fill, red border glow.
- Vertical connector: `1px` line, `rgba(255,255,255,0.08)`.

**Horizontal (Session Windows):**
```
┌──────────────────┐     ┌──────────────────┐
│ 1  Launcher      │ →   │ 2  Planner       │
│    11:15:02      │     │    11:18:44      │
│    ACTIVE        │     │    CRASHED       │
└──────────────────┘     └──────────────────┘
```

- Window ID in a small square badge (18×18px, rounded 4px).
- Arrow `→` between windows in `text-faint`.
- Crashed windows: red-tinted background and border.

### Blast Radius

A three-column grid grouping components by vulnerability status.

```
┌── ✗ VULNERABLE (3) ──┐  ┌── ✓ SAFE (2) ────────┐  ┌── ? UNKNOWN (1) ──┐
│ TM2TrailerGridPlanner │  │ ContractNavigator     │  │ RightsExplorer    │
│ ContinuityPlanner     │  │ ScheduleBrowser       │  │                   │
│ MediaAssetPlanner     │  │                       │  │                   │
└───────────────────────┘  └───────────────────────┘  └───────────────────┘
    border: red               border: green              border: gray
```

### Confidence Panel

Three stacked panels for evidence classification.

```
┌─ ✓ CONFIRMED — Direct evidence in WCR ────────────────────┐
│   • User lacks Editor permission (exception args)          │
│   • Crash path: deleteKeyPressed: → ... (stack trace)      │
└────────────────────────────────────────────────────────────┘
┌─ ~ INFERRED — Pattern-based, not proven ──────────────────┐
│   • Other planners likely have same missing pre-check      │
└────────────────────────────────────────────────────────────┘
┌─ ? UNKNOWN — Cannot determine from available data ────────┐
│   • Whether site has custom override                       │
└────────────────────────────────────────────────────────────┘
```

- Green/amber/gray color scheme matching confidence level.
- Icon badge (16×16px square, 3px radius) before the label.
- Items indented 18-22px from left.

### Remediation Blocks

Priority-grouped fix recommendations.

```
P0 — FIX TODAY                           ← red, JetBrains Mono 10px/700
┌─────────────────────────────────────────────────────────┐
│ Add pre-action permission check    Risk: Low  ⏱ 2-3h   │
│ 📍 TM2TrailerGridPlanner >> deleteKeyPressed:           │
│                                                         │
│ PROPOSED FIX                                   [Copy]   │
│ ┌─────────────────────────────────────────────────┐     │
│ │ deleteKeyPressed: event                         │     │
│ │     self checkIsModifiable: #Editor ifNot: [    │     │
│ │         Dialog warn: '...'                      │     │
│ │         ^self].                                 │     │
│ │     self doRemoveTxEvent                        │     │
│ └─────────────────────────────────────────────────┘     │
│ ┌── BEFORE ──────────┐  ┌── AFTER ───────────────┐     │
│ │ DELETE → crash     │  │ DELETE → dialog → OK   │     │
│ └────────────────────┘  └────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

- P0: red accent. P1: amber accent. P2: gray accent.
- Tags for risk and time estimate.
- Code blocks with copy button.
- Before/After comparison in red/green side-by-side panels.

---

## Layout Patterns

### Page Structure

```
┌─ Header ─────────────────────────────────── [Standard/Expanded] [Export] ─┐
├─ Cause/Issue Banner ─────────────────────────────────────────────────────┤
├─ Tab Bar ──────────────────────────────────────────────────────────────────┤
│                                                                            │
│   Content Area (max-width: 960-1080px)                                    │
│   ┌─ Section ──────────────────────────────────────────────────────┐      │
│   │  ...                                                           │      │
│   └────────────────────────────────────────────────────────────────┘      │
│   ┌─ Section ──────────────────────────────────────────────────────┐      │
│   │  ...                                                           │      │
│   └────────────────────────────────────────────────────────────────┘      │
│                                                                            │
├─ Quick Actions (expanded only) ── sticky bottom ─────────────────────────┤
└────────────────────────────────────────────────────────────────────────────┘
```

- Header: crash/performance ID, severity badge, site, component, date. Right side: view toggle + export button.
- Cause banner: exception type (bold, red mono) + message (lighter). Thin red-tinted background.
- Tab bar: audience tabs with bottom-border indicator. Active tab: white text + 2px bottom border. Inactive: muted text + transparent border.
- Content area: scrollable, padded, max-width constrained.
- Quick actions: sticky footer, only visible in expanded mode.

### Audience Tab Architecture

Each viewer has exactly four tabs, ordered by most-frequent-user first:

**WCR Crash Viewer:**
1. Support Engineer (default) — triage-first
2. Developer — deep technical
3. Customer-Facing — communication
4. Executive — decision-making

**DB Performance Viewer:**
1. DBA (default) — database-first
2. Developer — ORM/application code
3. Support — customer impact
4. Executive — business impact

**Rule:** Each tab shows only information relevant to its audience. A support engineer never sees stack frames. An executive never sees SQL. A DBA never sees customer reply drafts. Sections are NOT duplicated across tabs — if the same underlying data appears in two tabs, it is presented differently.

### Standard vs. Expanded

The Standard/Expanded toggle controls information density, not layout. Standard shows the essential analysis; Expanded adds contextual intelligence.

**Standard** sections (always visible):
- Classification / summary
- Primary evidence (stack trace, SQL)
- Remediation
- Reproduction / workaround

**Expanded** sections (toggled on):
- Cross-reference panels (similar crashes, blast radius)
- Environment health (gauges, session monitors)
- Deep technical (GLORP mapping, N+1 detection, wait events)
- Meta-analysis (confidence, table statistics)
- Collaboration (investigation notes)

The toggle button uses purple accent when active (expanded) to clearly distinguish it from semantic colors:
- Standard: `rgba(255,255,255,0.04)` bg, gray text, reads `○ Standard`
- Expanded: `rgba(139,92,246,0.12)` bg, purple text, reads `◉ Expanded`

For the DB viewer, cyan is used instead of purple for the toggle, matching the database accent color.

---

## Export Drawer

A slide-out panel from the right edge. Two sections: **Copy to Clipboard** and **Download File**.

### Structure

```
┌──────────────────────────────────────────────────────────────────────┐
│ Export Analysis                                               [×]   │
│ WCR_5-2_11-23-15                                                    │
├──────────────────────────────────────┬───────────────────────────────┤
│ ⎘ COPY TO CLIPBOARD                 │ Preview: Developer Brief      │
│                                      │                               │
│ ┌─ Developer Brief ──── [MD] ──────┐ │ # Developer Brief — WCR...   │
│ │ Stack, root cause, P0 fix, repro │ │                               │
│ │ [Copy] [Preview]                 │ │ ## Root Cause                │
│ └──────────────────────────────────┘ │ MgXViolationError...         │
│                                      │                               │
│ ┌─ Support Summary ──── [MD] ──────┐ │                    [Copy all] │
│ │ Verdict, workaround, handoff     │ │                               │
│ │ [Copy] [Preview]                 │ │                               │
│ └──────────────────────────────────┘ │                               │
│                                      │                               │
│ ↓ DOWNLOAD FILE                      │                               │
│ ┌─ Full Report ──────── [DOCX] ────┐ │                               │
│ │ Word document                    │ │                               │
│ │ [↓ .docx]                       │ │                               │
│ └──────────────────────────────────┘ │                               │
│                                      │                               │
│         Press [Esc] to close         │                               │
└──────────────────────────────────────┴───────────────────────────────┘
```

- Width: `370px` without preview, `700-720px` with preview.
- Transition: `width 0.25s ease`.
- Backdrop: semi-transparent black with blur.
- Close: `×` button or `Esc` key or backdrop click.
- Each clipboard item: title + format tag + description + [Copy] + [Preview].
- Each download item: title + format tag + description + [↓ .format].
- Preview pane: monospaced content, scrollable, with "Copy all" button in header.

---

## Interaction Patterns

### State Feedback

All interactive elements provide immediate visual feedback:

- **Copy buttons:** default → green bg + "✓ Copied" text → auto-reset after 2 seconds.
- **Download buttons:** default → green bg + "✓ Downloaded" → auto-reset after 2.5 seconds.
- **Quick action buttons:** default → green bg + "✓" → auto-reset after 2 seconds.
- **Section collapse:** chevron rotates 0°→90° with `0.15s` transition.
- **Tab switching:** instant, no animation. Active state: white text + 2px bottom border.
- **View toggle:** background + text color transition `0.2s`.

### Transitions

- Use `transition: all 0.15s` for small elements (buttons, chevrons, borders).
- Use `transition: all 0.2s` for medium elements (view toggle, panel backgrounds).
- Use `transition: width 0.25s ease` for drawer expand/collapse.
- Gauge fill bars: `transition: width 0.6s ease` for smooth animation on load.
- No spring physics, no bouncing, no elaborate entrance animations. This is a professional tool.

---

## Anti-Patterns

Things this design system explicitly avoids:

| Avoid | Why | Do instead |
|-------|-----|-----------|
| Solid colored backgrounds | Creates hard edges, feels like blocks stacked on a page | Use transparency layers (`rgba(255,255,255, 0.02-0.04)`) |
| Purple gradients on white | Generic AI aesthetic | Near-black base with semantic accent colors |
| Inter, Roboto, Arial | Ubiquitous, characterless | IBM Plex Sans + JetBrains Mono |
| Rounded pill buttons | Feels consumer/playful | Sharp-ish corners (`4-6px` radius) |
| Icons from icon libraries | Adds visual noise, inconsistent with the monospaced aesthetic | Unicode symbols (`▶ ⬤ ◎ ⌘ ✉ ◈ ⊞ ↗ ⎘ ⛁`) |
| Loading spinners | Out of scope — these viewers render from pre-computed data | Instant render |
| Toast notifications | Transient feedback is lost | Inline state changes on the button itself |
| Modal dialogs for confirmations | Interrupts flow | Inline actions with visual feedback |
| Horizontal scrolling | Indicates layout failure | Constrain content width, use `whiteSpace: pre-wrap` for code |
| Decorative borders or shadows | No decoration | Borders only for containment, shadows only on floating elements (drawer) |
| Color for decoration | Color is semantic | Gray everything that doesn't need to communicate status |
| Emoji in UI labels | Inconsistent rendering, unprofessional | Unicode symbols or plain text |

---

## Screen-Specific Accent Mapping

While both viewers share the same design system, they each have a dominant accent color that distinguishes their domain:

| Viewer | Primary accent | Usage |
|--------|---------------|-------|
| WCR Crash Analysis | Red (`#ef4444`) | Crash context — severity, failure points, exception banners |
| DB Performance | Cyan (`#22d3ee`) | Database context — SQL keywords, table names, indexes, engine badge |

The active tab indicator follows this mapping: white (`#e5e7eb`) for the WCR viewer, cyan (`#22d3ee`) for the DB viewer.

---

## Extending the System

When building a new analysis screen:

1. **Choose the primary accent** based on the domain (red for crashes, cyan for database, amber for performance, green for health/monitoring).
2. **Define four audience tabs** ordered by most-frequent-user. Each tab must have a distinct information architecture, not just filtered content.
3. **Identify Standard vs. Expanded panels.** Standard = what you need for triage. Expanded = what you need for deep investigation.
4. **Use existing components.** Sec, Crd, Tag, Gauge, CopyBtn, Bdg, SqlView, PlanTree, Confidence, Notes — all are reusable.
5. **Add a Quick Actions bar** with the 3-5 most common next-steps for the analysis type.
6. **Add export targets** specific to the analysis type — at minimum: developer brief, support summary, customer reply, JIRA body, and a downloadable full report.
