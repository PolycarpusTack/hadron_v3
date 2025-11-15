# Smalltalk Crash Analyzer - Phased Development Master Plan
## Alex Chen's Pragmatic Approach: Ship, Learn, Iterate

---

## Philosophy

> *"Each phase must deliver standalone value. If users don't need the next phase, we're done. That's success, not failure."*

---

## UI Design Inspiration

### Design Principles (Borrowed from Best-in-Class)

**From VSCode:**
- Clean, distraction-free interface
- Sidebar for navigation (collapsible)
- Command palette for power users (Cmd+P)
- Panel system (bottom panels for details)
- Excellent keyboard shortcuts
- Dark theme by default (light theme available)

**From Obsidian:**
- Markdown-first content
- Graph view for connections (we'll use for similar crashes)
- Minimal chrome, maximum content
- Quick switcher
- Tags and backlinks

**From Claude Desktop:**
- Clean conversation-like interface
- Sidebar for history/sessions
- Simple, focused interactions
- No clutter
- Fast and responsive

### Our UI Principles

1. **Content First**: The crash analysis is the hero, UI is invisible
2. **Keyboard Everything**: Every action has a keyboard shortcut
3. **Dark by Default**: Easy on developer eyes
4. **Fast & Snappy**: <100ms response to all interactions
5. **Progressive Disclosure**: Show simple by default, advanced on demand

---

## Phase Overview

### Phase 0: Week 1 MVP (Python Script)
**Duration:** 1 week | **Validation:** Core AI value
**Deliverable:** Python CLI that analyzes crash logs
**Success Metric:** 3 developers say it's useful

### Phase 1: Desktop Foundation
**Duration:** 2-3 weeks | **Validation:** UI adds value over CLI
**Deliverable:** Tauri app with basic UI and local storage (10-20MB bundle vs Electron's 100-200MB)
**Success Metric:** Users prefer app over Python script
**Key Repos:** tauri-apps/tauri, tauri-plugin-keyring, better-sqlite3

### Phase 2: Database & Search
**Duration:** 1-2 weeks | **Validation:** History is useful
**Deliverable:** SQLite (desktop) + PostgreSQL/pgvector (backend), FTS5 search, crash history
**Success Metric:** Users regularly search old crashes
**Key Repos:** better-sqlite3, pgvector/pgvector, pg_trgm for fuzzy search

### Phase 3: AI Enhancement
**Duration:** 1-2 weeks | **Validation:** Better AI = better results
**Deliverable:** Multiple AI providers, better prompts, caching, PII redaction, circuit breakers
**Success Metric:** Analysis accuracy >80%
**Key Repos:** logpai/logparser (Drain algorithm), microsoft/presidio (PII), nodeshift/opossum (circuit breakers)

### Phase 4: Crash Management
**Duration:** 2-3 weeks | **Validation:** Workflow improvements matter
**Deliverable:** Validation, tags, categories, export, hybrid search (FTS + vector + fuzzy)
**Success Metric:** Users manage crashes systematically
**Key Repos:** qdrant/qdrant-js (RRF hybrid search patterns), pdfkit (PDF export)

### Phase 5: Team Features (Optional)
**Duration:** 3-4 weeks | **Validation:** Sharing is needed
**Deliverable:** Web app, offline-first sync, JWT auth, PWA
**Success Metric:** >2 people per team actively using
**Key Repos:** dexie/Dexie.js (IndexedDB), GoogleChrome/workbox (PWA), helmet (security headers)

### Phase 6: Production Polish (Optional)
**Duration:** 2-3 weeks | **Validation:** Ready for wider use
**Deliverable:** Installers, auto-update, documentation, CRDT-based sync
**Success Metric:** Non-technical users can install and use
**Key Repos:** tauri-apps/tauri-plugin-updater, automerge/automerge (CRDT sync), offlinefirst/research

---

## Phase Dependency Chain

```
Phase 0 (MVP) ─────► DECISION: Is AI useful?
                         │
                         ├─NO──► Stop or pivot
                         │
                         └─YES─► Phase 1 (Desktop UI)
                                      │
                                      ├─► DECISION: Is UI better than CLI?
                                      │        │
                                      │        ├─NO──► Keep MVP, stop here
                                      │        │
                                      │        └─YES─► Phase 2 (Database)
                                      │                     │
                                      │                     └─► Phase 3 (AI++)
                                      │                              │
                                      │                              └─► Phase 4 (Management)
                                      │                                       │
                                      │                                       └─► DECISION: Need sharing?
                                      │                                                │
                                      │                                                ├─NO──► Done!
                                      │                                                │
                                      │                                                └─YES─► Phase 5 (Team)
                                      │                                                         │
                                      │                                                         └─► Phase 6 (Polish)
```

---

## Success Gates (Between Phases)

### Gate 0 → 1: Should we build a UI?
**Ask users:**
- [ ] Do you use the CLI script regularly?
- [ ] Would you prefer a visual interface?
- [ ] What's painful about the CLI?

**Proceed to Phase 1 ONLY if:** >70% want a visual interface

### Gate 1 → 2: Should we add database/history?
**Ask users:**
- [ ] Do you need to reference old crash analyses?
- [ ] Do you want to search across crashes?
- [ ] Is re-running the script on same file annoying?

**Proceed to Phase 2 ONLY if:** Users manually keep/organize old results

### Gate 2 → 3: Should we improve AI?
**Measure:**
- [ ] How often is AI analysis wrong?
- [ ] Do users want different AI providers?
- [ ] Are analyses too slow/expensive?

**Proceed to Phase 3 ONLY if:** Accuracy <80% or cost/speed issues

### Gate 3 → 4: Should we add workflow features?
**Ask users:**
- [ ] Do you validate/confirm AI suggestions before fixing?
- [ ] Do you categorize or tag crashes?
- [ ] Do you export reports for your team?

**Proceed to Phase 4 ONLY if:** Users have manual processes we can automate

### Gate 4 → 5: Should we add team features?
**Ask users:**
- [ ] Do multiple people need access to crash analyses?
- [ ] Do you want to share analyses with teammates?
- [ ] Would web access be useful?

**Proceed to Phase 5 ONLY if:** >2 people per team want to collaborate

---

## Technology Stack (By Phase)

### Phase 0: MVP
- **Language:** Python 3.10+
- **AI SDKs:** OpenAI, Anthropic
- **Config:** YAML
- **Storage:** JSON files
- **Security:** Input validation baseline

### Phase 1: Desktop Foundation
- **Desktop Framework:** Tauri 1.5+ (Rust + TypeScript) - 10-20MB bundle
- **Frontend:** React 18+ with TypeScript
- **Styling:** Tailwind CSS (VSCode-inspired theme)
- **Local DB:** better-sqlite3 with FTS5
- **IPC:** Tauri commands for secure frontend-backend communication
- **Credentials:** tauri-plugin-keyring for API key storage

### Phase 2: Database & Backend
- **Desktop DB:** SQLite (better-sqlite3) with FTS5 full-text search
- **Backend DB:** PostgreSQL 15+ with pgvector extension
- **Vector Search:** pgvector for crash similarity (cosine distance)
- **Fuzzy Search:** pg_trgm for typo tolerance
- **Backend:** Node.js 18+ with Express + TypeScript
- **Security:** helmet, express-rate-limit, express-validator

### Phase 3: AI Enhancement
- **AI Providers:** OpenAI, Anthropic, Ollama (local)
- **Log Parsing:** logpai/logparser (Drain algorithm for pattern extraction)
- **PII Redaction:** microsoft/presidio (automatic sensitive data removal)
- **Circuit Breaker:** nodeshift/opossum (fault tolerance)
- **Response Caching:** In-memory + SQLite cache
- **Prompt Management:** Versioned prompt templates
- **Observability:** OpenTelemetry + winston structured logging

### Phase 4: Crash Management
- **Hybrid Search:**
  - FTS5 (full-text)
  - pgvector (semantic similarity)
  - pg_trgm (fuzzy matching)
  - RRF (Reciprocal Rank Fusion) for result merging
- **Export:** pdfkit for PDF generation
- **Markdown Editor:** CodeMirror with syntax highlighting
- **Tag System:** Hierarchical tags with autocomplete

### Phase 5: Team Features
- **Web Framework:** React 18+ (shared components with desktop!)
- **Offline Storage:** Dexie.js (IndexedDB wrapper)
- **PWA:** GoogleChrome/workbox (service workers, offline support)
- **Auth:** JWT with refresh tokens
- **Security Headers:** helmet middleware
- **API:** Express REST API with OpenAPI docs

### Phase 6: Production Polish
- **Auto-Update:** tauri-plugin-updater (background updates)
- **Sync:** automerge (CRDT for conflict-free sync)
- **Offline-First:** offlinefirst patterns
- **Installers:** Tauri built-in (.dmg, .exe, .AppImage)
- **Code Signing:** Apple Developer + Microsoft Authenticode
- **Telemetry:** Privacy-preserving analytics

---

## File Structure

Each phase will have its own backlog file:

```
backlogs/
├── phase-0-mvp-backlog.md           # Week 1 MVP
├── phase-1-desktop-backlog.md       # Desktop app foundation
├── phase-2-database-backlog.md      # SQLite + search
├── phase-3-ai-enhancement-backlog.md # Better AI
├── phase-4-management-backlog.md    # Workflow features
├── phase-5-team-backlog.md          # Web + sync
└── phase-6-polish-backlog.md        # Production ready
```

Each backlog contains:
- **EPICs**: Major features
- **User Stories**: Specific user needs
- **Tasks**: Granular implementation steps
- **Acceptance Criteria**: Definition of done
- **UI Mockups**: Visual designs (ASCII for now)
- **Technical Specs**: Implementation details

---

## Alex Chen's Rules for Each Phase

### Rule 1: Ship at End of Each Phase
Every phase must result in a working, usable application. No half-finished features.

### Rule 2: User Validation Required
Can't proceed to next phase without user feedback proving it's needed.

### Rule 3: Delete More Than You Add
Each phase should simplify or remove complexity from previous phase if possible.

### Rule 4: No Speculative Features
If it's not solving a pain point users reported, don't build it.

### Rule 5: 80/20 Everything
20% of features deliver 80% of value. Focus on the 20%.

---

## UI Theme Specifications

### Color Palette (VSCode Dark+ Inspired)

```css
--background-primary: #1e1e1e;      /* Main background */
--background-secondary: #252526;    /* Sidebar, panels */
--background-tertiary: #2d2d30;     /* Hover states */

--text-primary: #cccccc;            /* Main text */
--text-secondary: #808080;          /* Secondary text */
--text-accent: #4ec9b0;             /* Highlights */

--accent-primary: #007acc;          /* Primary actions */
--accent-success: #4ec9b0;          /* Success states */
--accent-warning: #dcdcaa;          /* Warnings */
--accent-error: #f48771;            /* Errors */

--border: #3e3e42;                  /* Dividers */
```

### Typography

```css
--font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
--font-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

--text-xs: 11px;
--text-sm: 13px;
--text-base: 14px;
--text-lg: 16px;
--text-xl: 20px;
```

### Layout Grid (Obsidian-inspired)

```
┌─────────────────────────────────────────────────────┐
│  Title Bar (Tauri native, platform-specific)        │
├──────────┬──────────────────────────────────────────┤
│          │  Main Content Area                       │
│ Sidebar  │  (Crash Analysis View)                   │
│          │                                           │
│ - Recent │  ┌─────────────────────────────────────┐ │
│ - Search │  │                                     │ │
│ - Tags   │  │  Content goes here                  │ │
│          │  │                                     │ │
│          │  └─────────────────────────────────────┘ │
│          │                                           │
├──────────┴───────────────────────────────────────────┤
│  Status Bar (analysis state, sync status)            │
└─────────────────────────────────────────────────────┘

Note: Tauri uses native OS window decorations for better integration
      and smaller bundle size (10-20MB vs Electron's 100-200MB)
```

---

## Key Metrics (Track Throughout)

### Development Velocity
- Lines of code written per phase
- Features shipped per week
- Time to ship each phase

### User Adoption
- Number of active users
- Daily/weekly crash analyses performed
- Feature usage breakdown

### Quality
- Bugs reported per phase
- AI analysis accuracy
- User satisfaction (NPS)

### Performance
- App startup time (<3s)
- Analysis time (<60s)
- Search response time (<100ms)

---

## Risk Management

### Phase 0 Risks
- **Risk:** AI doesn't help with Smalltalk crashes
- **Mitigation:** Test with 5 sample crashes before committing

### Phase 1 Risks
- **Risk:** Tauri learning curve (Rust backend)
- **Mitigation:** Use tauri-apps/tauri examples, start with simple IPC commands
- **Risk:** Desktop bundle size concerns
- **Mitigation:** Tauri produces 10-20MB bundles vs Electron's 100-200MB (already solved!)

### Phase 2 Risks
- **Risk:** Search doesn't scale with 1000+ crashes
- **Mitigation:** Use SQLite FTS5 for desktop, PostgreSQL + pgvector for backend, test with 10K records
- **Risk:** Vector similarity search performance
- **Mitigation:** Use IVFFlat indexing, benchmark with pgvector examples

### Phase 3 Risks
- **Risk:** AI costs spiral out of control
- **Mitigation:** Implement caching, use cheaper models for similar crashes, circuit breakers with opossum
- **Risk:** PII leakage in crash logs
- **Mitigation:** Use microsoft/presidio for automatic redaction before sending to AI
- **Risk:** AI service outages
- **Mitigation:** Circuit breaker pattern, fallback to local Ollama models

### Phase 5 Risks
- **Risk:** Sync conflicts are too complex
- **Mitigation:** Start with simple last-write-wins, upgrade to automerge CRDT in Phase 6 if conflicts occur
- **Risk:** Offline-first complexity
- **Mitigation:** Use proven patterns from offlinefirst/research, Dexie.js for IndexedDB abstraction

---

## Reference Implementations & Acceleration

This project leverages **30+ battle-tested open-source repositories** to accelerate development by ~28% (27 weeks → 19.5 weeks).

### Key Benefits

✅ **Proven Patterns**: Use production-tested code instead of reinventing
✅ **Time Savings**: ~7.5 weeks saved by leveraging existing solutions
✅ **Quality**: Battle-tested libraries with thousands of stars and active maintenance
✅ **Security**: Industry-standard security practices (helmet, express-rate-limit, presidio)
✅ **Performance**: Optimized implementations (pgvector, Tauri, Dexie.js)

### Quick Reference by Phase

| Phase | Key Repos | Purpose |
|-------|-----------|---------|
| **Phase 0** | OpenAI SDK, Anthropic SDK | AI integration baseline |
| **Phase 1** | tauri-apps/tauri, better-sqlite3 | Lightweight desktop (10-20MB vs 100-200MB) |
| **Phase 2** | pgvector/pgvector, pg_trgm | Vector similarity + fuzzy search |
| **Phase 3** | logpai/logparser, microsoft/presidio, opossum | Log parsing, PII redaction, circuit breakers |
| **Phase 4** | qdrant/qdrant-js, pdfkit | Hybrid search (RRF), PDF export |
| **Phase 5** | Dexie.js, workbox, helmet | Offline-first web app, PWA, security |
| **Phase 6** | automerge, tauri-plugin-updater | CRDT sync, auto-updates |

### Detailed Guide

See **[REFERENCE-IMPLEMENTATION-GUIDE.md](./REFERENCE-IMPLEMENTATION-GUIDE.md)** for:
- Complete repository list with descriptions
- Code examples adapted to our use case
- License compliance rules (MIT, Apache-2.0, BSD-3-Clause)
- Integration patterns for each phase
- Time savings breakdown

### Architecture Decisions (Based on Reference Repos)

**Desktop Framework: Tauri > Electron**
- **Why:** 10-20MB bundles vs 100-200MB, better security (sandboxing), native performance
- **Reference:** tauri-apps/tauri (65k+ stars, mature v1.x)

**Vector Search: pgvector**
- **Why:** Native PostgreSQL extension, production-proven, IVFFlat indexing
- **Reference:** pgvector/pgvector (9k+ stars, used by major platforms)

**PII Protection: Presidio**
- **Why:** Microsoft's production PII detection, multi-language support
- **Reference:** microsoft/presidio (2.8k+ stars, enterprise-grade)

**Offline-First: Dexie.js + Workbox**
- **Why:** IndexedDB abstraction, PWA service workers, Google-maintained
- **Reference:** dexie/Dexie.js (10k+ stars), GoogleChrome/workbox (12k+ stars)

**Conflict Resolution: Automerge (Phase 6)**
- **Why:** CRDT for automatic conflict resolution, no central authority needed
- **Reference:** automerge/automerge (3.5k+ stars, research-backed)

---

## Next Steps

1. Review this master plan
2. Generate detailed backlog for Phase 0 (MVP)
3. Build and ship Phase 0
4. Evaluate at success gate
5. Repeat for each phase

**Remember:** We might stop at Phase 2 and that's PERFECT if users are happy.

---

## Appendix: Design References

### Command Palette (VSCode-style)

```
┌─────────────────────────────────────────────┐
│ > analyze new crash                         │
├─────────────────────────────────────────────┤
│ 📄 Analyze New Crash Log                    │
│ 🔍 Search Crashes                           │
│ 🏷️  Manage Tags                             │
│ ⚙️  Settings                                │
└─────────────────────────────────────────────┘
```

### Crash Detail View (Clean, focused)

```
┌─────────────────────────────────────────────────────┐
│ MessageNotUnderstood • HIGH SEVERITY • 2 hours ago  │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Root Cause:                                         │
│ The receiver of 'formatDate:' is nil...            │
│                                                     │
│ Suggested Fixes:                                    │
│ 1. Add nil check before calling formatDate:        │
│    date ifNotNil: [ ... ]                           │
│                                                     │
│ 2. Initialize date in constructor                   │
│                                                     │
│ [View Full Stack Trace]  [Export]  [Mark Resolved] │
└─────────────────────────────────────────────────────┘
```

### Graph View (Similar Crashes - Obsidian-inspired)

```
        ┌─────────────┐
        │  Current    │
        │   Crash     │
        └──────┬──────┘
               │
       ┌───────┼───────┐
       │       │       │
   ┌───▼──┐ ┌──▼──┐ ┌─▼────┐
   │Crash1│ │Crash2│ │Crash3│
   │85%   │ │72%  │ │68%   │
   └──────┘ └─────┘ └──────┘

   Similar crashes by error type and stack trace
```

---

**Now let's generate the actual backlogs!** 🚀
