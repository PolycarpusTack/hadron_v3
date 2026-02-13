# Hadron Developer Guide

**Version**: 4.0.1 | **Architecture**: Tauri 2 (Rust) + React 18/TypeScript + Python 3.10+

---

## What is Hadron?

Hadron is an **AI-powered support assistant** for the WHATS'ON broadcast management system. It analyzes crash logs, connects to JIRA and Sentry, provides an agentic AI chatbot (Ask Hadron), and generates release notes.

---

## Architecture Overview

Hadron uses a **hybrid architecture** with three layers:

| Layer | Technology | Role |
|-------|------------|------|
| **Frontend** | React 18 + TypeScript + Tailwind CSS | UI (61 components), state management, services |
| **Backend** | Rust + Tauri 2 | Crash parsing, AI calls, SQLite database, integrations |
| **Scripts** | Python 3.10+ | Translation, RAG retrieval, QLoRA training (optional) |

Communication between frontend and backend uses **Tauri IPC** (`invoke()` calls).

---

## Directory Structure

```
hadron-desktop/
├── src/                            # Frontend (React + TypeScript)
│   ├── components/                 # 61 UI components
│   │   ├── App.tsx                 # Main orchestrator (global state, routing)
│   │   ├── AskHadronView.tsx       # Agentic chatbot interface
│   │   ├── SentryView.tsx          # Sentry issue browser
│   │   ├── ReleaseNotesView.tsx    # Release notes generator
│   │   ├── SettingsPanel.tsx       # All configuration (AI, JIRA, Sentry, etc.)
│   │   ├── HistoryView.tsx         # Crash analysis history with search/filter
│   │   ├── AnalysisResults.tsx     # Quick analysis results
│   │   ├── WhatsOnDetailView.tsx   # Comprehensive analysis results
│   │   └── DocumentationViewer.tsx # In-app documentation viewer
│   ├── hooks/                      # React hooks
│   ├── services/                   # API wrappers, cache, circuit breaker
│   │   ├── api.ts                  # Tauri invoke wrappers
│   │   ├── chat.ts                 # Ask Hadron session management
│   │   ├── jira.ts                 # JIRA integration
│   │   └── circuit-breaker.ts      # Auto-failover after 3 failures
│   ├── types/                      # TypeScript type definitions
│   └── constants/                  # App version, config constants
│
├── src-tauri/                      # Backend (Rust)
│   ├── src/
│   │   ├── main.rs                 # Entry point, Tauri command registration
│   │   ├── commands.rs             # Core Tauri commands (analysis, export, DB)
│   │   ├── chat_commands.rs        # Ask Hadron agentic loop
│   │   ├── chat_tools.rs           # 15 tool definitions + executors
│   │   ├── ai_service.rs           # Multi-provider AI (OpenAI, Anthropic, Z.ai, llama.cpp)
│   │   ├── database.rs             # SQLite CRUD (15+ tables, FTS5 full-text search)
│   │   ├── migrations.rs           # 10 schema migrations (CURRENT_SCHEMA_VERSION = 10)
│   │   ├── sentry_service.rs       # Sentry API + pattern detection
│   │   ├── jira_service.rs         # JIRA REST API v3 (search, create, fix versions)
│   │   ├── release_notes_service.rs # Release notes generation + lifecycle
│   │   ├── kb_commands.rs          # OpenSearch knowledge base queries
│   │   ├── parser/                 # Crash log parsing engine
│   │   │   ├── crash_file.rs       # Main parser orchestrator
│   │   │   └── sections/           # Header, exception, stack trace, memory, DB, context
│   │   ├── patterns/               # Pattern matching engine
│   │   └── export/                 # Report generation (Markdown, HTML, JSON)
│   ├── data/patterns/              # TOML pattern files (4 files, ~550 lines total)
│   └── Cargo.toml                  # Rust dependencies
│
├── python/                         # Optional Python modules
│   ├── api/                        # FastAPI server (main.py, routers, middleware)
│   ├── rag/                        # Chroma vector store + embeddings
│   ├── offline/                    # llama.cpp offline mode integration
│   ├── training/                   # QLoRA fine-tuning pipeline
│   ├── prompts/                    # Jinja2 prompt templates
│   └── translate.py                # AI translation service
│
├── docs/                           # Documentation
│   ├── HELP.md                     # Forensic system manual (5 chapters)
│   ├── GETTING-STARTED.md          # Onboarding tutorial
│   ├── DEVELOPER-GUIDE.md          # This file
│   └── user/USER-GUIDE.md          # End-user guide
│
└── tests/                          # E2E tests (Playwright)
```

---

## Key Backend Modules

### AI Service (`ai_service.rs`)

Multi-provider AI integration with a `ProviderConfig` abstraction:

| Provider | Endpoint | Auth | Response Format |
|----------|----------|------|-----------------|
| **OpenAI** | `api.openai.com/v1/chat/completions` | Bearer token | OpenAI JSON |
| **Anthropic** | `api.anthropic.com/v1/messages` | x-api-key header | Anthropic JSON |
| **Z.ai** | `api.z.ai/api/paas/v4/chat/completions` | Authorization header | OpenAI JSON |
| **llama.cpp** | `127.0.0.1:8080/v1/chat/completions` | None | OpenAI JSON |

llama.cpp reuses the OpenAI response parser since it exposes an OpenAI-compatible API.

### Chat System (`chat_commands.rs` + `chat_tools.rs`)

The Ask Hadron chatbot uses an **agentic tool-calling loop**:
1. Send user message + tool definitions to LLM
2. If LLM returns `tool_calls`, execute them and append results
3. Repeat (max 8 iterations)
4. When no more tool calls, return the final text response

**15 tools**: `search_analyses`, `search_kb`, `get_analysis_detail`, `find_similar_crashes`, `get_crash_signature`, `get_top_signatures`, `get_trend_data`, `get_error_patterns`, `get_statistics`, `correlate_crash_to_jira`, `get_crash_timeline`, `compare_crashes`, `get_component_health`, `search_jira`, `create_jira_ticket`

### Database (`database.rs` + `migrations.rs`)

SQLite with FTS5 full-text search (BM25 ranking). 10 migrations, 15+ tables:
- `analyses` + `analyses_fts` — Core crash analyses with full-text search
- `crash_signatures` + `analysis_signatures` — Deduplication and grouping
- `tags` + `analysis_tags` — User-defined tags
- `analysis_feedback` + `gold_analyses` — Feedback loop and expert-verified analyses
- `chat_sessions` + `chat_messages` — Persistent Ask Hadron conversations
- `release_notes` — AI-generated release notes with lifecycle
- `analysis_jira_links` — JIRA ticket linking
- `retrieval_chunks` — RAG retrieval data

### Sentry Service (`sentry_service.rs`)

Pattern detection engine:
- **Deadlock**: Keywords in title/message/exceptions/tags (confidence 0.7-0.9)
- **N+1 Query**: 3+ repeated DB query patterns in breadcrumbs (confidence 0.6-0.85)
- **Memory Leak**: OOM-related keywords (confidence 0.6-0.9)
- **Unhandled Promise**: Rejection keywords in title/exceptions (confidence 0.65-0.9)

### Parser (`parser/`)

Extracts structured data from Smalltalk/VisualWorks crash logs:
- Header (version, timestamp, OS)
- Exception (error type, message)
- Stack trace (methods, classes, line numbers)
- Memory state, DB connections, environment context

Pattern matching uses 4 TOML files: `null_errors.toml`, `collection_errors.toml`, `database_errors.toml`, `whatson_specific.toml`.

---

## Data Flow: Crash Analysis

```
User drops file
  -> FileDropZone.tsx
  -> invoke('parse_crash_file')
  -> parser/ extracts sections
  -> patterns/ matches known errors
  -> invoke('analyze_crash')
  -> ai_service.rs calls provider
  -> database.rs stores result
  -> Frontend displays AnalysisResults / WhatsOnDetailView
```

## Data Flow: Ask Hadron

```
User types message
  -> invoke('chat_send_message')
  -> chat_commands.rs enters agent loop
  -> LLM decides which tools to call
  -> chat_tools.rs executes tools (DB/HTTP)
  -> Results appended to conversation
  -> Loop repeats (max 8 iterations)
  -> Final response streamed to frontend
```

---

## Development Setup

### Prerequisites

- Node.js 18+
- Rust stable (latest)
- Python 3.10+ (optional, for translation/RAG/training)

### Quick Start

```bash
# Frontend dependencies
npm install

# Python dependencies (optional)
pip install -r python/requirements.txt

# Development mode with hot reload
npm run tauri dev
```

### Build for Production

```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/
```

### Testing

```bash
npm run test              # Vitest unit tests
npm run test:e2e          # Playwright E2E tests
npm run test:e2e:headed   # E2E with visible browser
cd src-tauri && cargo test # Rust unit tests
```

---

## Adding Features

### Adding a New Tauri Command

1. **Define in Rust** (`src-tauri/src/commands.rs`):
```rust
#[tauri::command]
pub async fn my_command(input: String) -> Result<String, String> {
    Ok("result".to_string())
}
```

2. **Register** in `main.rs` invoke handler

3. **Call from frontend** (`src/services/api.ts`):
```typescript
export async function myCommand(input: string): Promise<string> {
  return invoke<string>('my_command', { input });
}
```

### Adding a Chat Tool (Ask Hadron)

1. Add tool definition to `get_tool_definitions()` in `chat_tools.rs`
2. Add executor match arm in `execute_tool()`
3. Add tool activity label in `AskHadronView.tsx`

### Adding a React Component

1. Create in `src/components/`
2. Use functional component with hooks
3. Import and wire into parent component

---

## Code Style

- **Rust**: `rustfmt` + `cargo clippy` for linting
- **TypeScript**: Explicit types, avoid `any`, functional components with hooks
- **React**: Functional components only, state via `useState`/`useRef`
- **Comments**: Document "why", not "what" — code should be self-explanatory

---

## Configuration

### Database Location

```
Windows: %APPDATA%/com.hadron.desktop/analysis.db
macOS:   ~/Library/Application Support/com.hadron.desktop/analysis.db
Linux:   ~/.local/share/com.hadron.desktop/analysis.db
```

### Key Rust Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| `tauri` | 2.x | Desktop framework |
| `rusqlite` | 0.30 | SQLite with FTS5 |
| `reqwest` | 0.11 | HTTP client |
| `serde` / `serde_json` | 1.0 | Serialization |
| `tokio` | 1.0 | Async runtime |
| `zeroize` | 1.0 | Secure memory clearing |
| `minijinja` | 2.0 | Template engine |
| `chrono` | 0.4 | Date/time |
| `uuid` | 1.0 | ID generation |
| `base64` | 0.22 | Encoding (JIRA auth) |

---

## Further Reading

- [Full System Manual](./HELP.md) — 5-chapter forensic documentation
- [Tauri v2 Docs](https://tauri.app/v2/guides/)
- [React Docs](https://react.dev/)
- [Rust Book](https://doc.rust-lang.org/book/)
