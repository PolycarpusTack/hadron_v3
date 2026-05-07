# Architecture

Hadron uses a **three-layer hybrid architecture**:

| Layer | Technology | Role |
|-------|------------|------|
| **Frontend** | React 18 + TypeScript + Tailwind | 68 components, state management, services |
| **Backend** | Rust + Tauri v2 | Parsing, AI calls, database, integrations, 100+ commands |
| **Scripts** | Python 3.10+ (optional) | RAG vector search, training, offline analysis |

Communication: Frontend <-> Backend via **Tauri IPC** (`invoke()` calls + event streaming).

---

## Directory Structure

```
hadron-desktop/
src/                          # Frontend (React + TypeScript)
  components/                 # 68 UI components
    widget/                   #   Floating widget (FAB, panel, chat)
    jira/                     #   JIRA integration (10 components)
    sentry/                   #   Sentry integration (12 components)
    release-notes/            #   Release notes lifecycle (8 components)
    whatson/                   #   Enhanced analysis tabs (9 components)
    ui/                       #   Primitives (Button, Modal, TabBar)
  services/                   # 21 service modules (api, chat, circuit-breaker, cache, etc.)
  hooks/                      # useAppState (40+ actions), useKeyboardShortcuts, useDebounce
  types/                      # TypeScript type definitions
  utils/                      # Error detection, severity helpers, parsers

src-tauri/src/                # Backend (Rust)
  main.rs                     # Entry point: Tauri builder, plugins, commands
  error.rs                    # HadronError enum (20+ variants)
  database.rs                 # SQLite wrapper (50+ methods, WAL, FTS5)
  migrations.rs               # 13 schema migrations
  ai_service.rs               # 4 AI providers (OpenAI, Anthropic, Z.ai, llama.cpp)
  chat_commands.rs             # Agentic chat loop (8 iterations, 22 tools)
  chat_tools.rs               # Tool definitions + executors
  commands/                   # 21 modular command files (crud, tags, export, jira, investigation, etc.)
  commands_legacy.rs          # Legacy commands (being migrated)
  parser/                     # Crash log parser (WCR + text)
    sections/                 #   Per-section parsers (header, exception, stack, etc.)
  patterns/                   # Pattern matching engine
    library/builtin.rs        #   30+ built-in crash patterns
    matchers/                 #   Exception, stack, context, DB matchers
  retrieval/                  # Hybrid RAG pipeline
    hybrid_analysis.rs        #   FTS5 search with query variants
    hybrid_kb.rs              #   OpenSearch vector + text
    rrf.rs                    #   Reciprocal Rank Fusion
    citation.rs               #   Citation extraction + validation
    evidence_gate.rs          #   Sufficiency scoring
    query_planner.rs          #   LLM-driven query rewriting
  export/generators/          # HTML, Markdown, JSON, TXT, XLSX
  jira_service.rs             # JIRA REST API client
  sentry_service.rs           # Sentry REST API client
  keeper_service.rs           # Keeper Secrets Manager
  widget_commands.rs          # Widget window operations

python/                       # Optional Python modules
  api/                        #   FastAPI server
  rag/                        #   Chroma vector DB + embeddings
  offline/                    #   llama.cpp integration
  training/                   #   QLoRA fine-tuning
```

---

## System Architecture Diagram

```
+----------------------------------------------------------+
|                    Frontend (React 18)                    |
|                                                          |
|  App.tsx ──> useAppState (40+ actions)                   |
|  68 Components ──> 21 Services ──> invoke() / events     |
+----------------------------+-----------------------------+
                             | Tauri IPC
+----------------------------v-----------------------------+
|                    Backend (Rust/Tauri v2)                |
|                                                          |
|  100+ Commands ──> ai_service ──> 4 AI Providers         |
|                ──> database   ──> SQLite (15+ tables)    |
|                ──> parser     ──> CrashFile sections      |
|                ──> patterns   ──> 30+ crash patterns      |
|                ──> retrieval  ──> FTS5 + OpenSearch + RRF |
|                ──> export     ──> HTML/MD/JSON/XLSX       |
|                ──> jira/sentry/keeper services            |
+----------------------------+-----------------------------+
                             |
          +------------------+------------------+
          |                  |                  |
  +-------v------+  +-------v------+  +--------v-------+
  | OpenAI/      |  | JIRA Cloud   |  | Sentry         |
  | Anthropic/   |  | REST API     |  | REST API       |
  | Z.ai/        |  +--------------+  +----------------+
  | llama.cpp    |
  +--------------+
```

---

## Database Schema (SQLite + FTS5)

**15+ tables** across 13 migrations:

| Table | Purpose |
|-------|---------|
| `analyses` | Core crash analysis records (30+ columns) |
| `analyses_fts` | FTS5 full-text search (BM25 ranking) |
| `translations` | Content translations |
| `tags` / `analysis_tags` | Tagging system (many-to-many) |
| `crash_signatures` | Error deduplication + tracking |
| `analysis_notes` | User notes on analyses |
| `analysis_feedback` | Accept/reject/edit/rating feedback |
| `gold_analyses` | Verified gold-standard answers |
| `gold_answers` | Ask Hadron Q&A pairs |
| `jira_links` | JIRA ticket linking |
| `chat_sessions` / `chat_messages` | Chat history |
| `chat_feedback` | Chat response ratings |
| `release_notes` | Generated release notes |
| `session_summaries` | Chat session summaries |

**Configuration:** WAL mode, NORMAL synchronous, 256MB mmap, FTS5 with weighted BM25 (error_type x10, root_cause x8, component x7).
