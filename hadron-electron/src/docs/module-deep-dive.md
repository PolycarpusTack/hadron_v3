# Module Deep-Dive

Detailed documentation for every major module in the system.

---

## Frontend Core

### App.tsx — Root Orchestrator
- **Purpose:** Routes all views, manages global state, orchestrates lazy loading.
- **Dependencies:** All views (lazy), useAppState, useKeyboardShortcuts, DocumentationViewer, ConsoleViewer.
- **Exports:** Root React component.
- **Key Logic:** `useAppState` (useReducer) provides centralized state with 40+ action types covering navigation, analysis lifecycle, batch processing, code analysis, and error display. Routes to 10 views via `currentView` state. Lazy-loads heavy views (AnalysisDetailView, WhatsOnDetailView, AskHadronView, ReleaseNotesView) with Suspense.

### services/api.ts — Backend Gateway
- **Purpose:** Tauri IPC wrappers for all 100+ backend commands.
- **Dependencies:** `@tauri-apps/api/core` (invoke).
- **Exports:** 40+ async functions (analyzeCrashLog, getAllAnalyses, searchAnalyses, etc.).
- **Key Logic:** Each function maps to a Tauri command. Provider/model configuration stored in localStorage. File path validation delegated to backend.

### services/circuit-breaker.ts — Provider Failover
- **Purpose:** Resilient API calls with automatic provider switching.
- **Exports:** `circuitBreaker.call()`, `circuitBreaker.getState()`.
- **Key Logic:** Tracks error rates per provider (50% threshold). Three states: closed (healthy), open (failing), half-open (testing). Auto-falls back to next healthy provider. 5-minute timeout for deep scan operations.

### services/chat.ts — Chat Streaming
- **Purpose:** Ask Hadron chat session management and real-time event streaming.
- **Exports:** `sendChatMessage`, `cancelChat`, event subscribers, session CRUD.
- **Key Logic:** Invokes `chat_send` while subscribing to Tauri events: `chat:stream` (tokens), `chat:tool-use` (tool invocations), `chat:diagnostics` (retrieval stats), `chat:final-content` (complete response). Subscriptions scoped by requestId.

---

## Frontend — Widget System

### widget/WidgetApp.tsx — Widget Root
- **Purpose:** Manages the floating widget window (FAB and expanded states).
- **Key Logic:** Two states: FAB (44x44px) and expanded (400x520px). Smart positioning: detects screen quadrant, expands away from edges. Saves position to localStorage. All window operations serialized via `withWidgetLock` to prevent wry/WebView2 crashes on Windows.

### widget/widgetLock.ts — Concurrency Control
- **Purpose:** Prevents concurrent widget window operations.
- **Key Logic:** Promise-based queue. Only one operation (show/hide/resize/move) at a time. Required because concurrent Tauri window API calls cause ILLEGAL_INSTRUCTION crashes.

---

## Backend Core

### main.rs — Entry Point
- **Purpose:** Tauri builder configuration and startup.
- **Key Logic:** Registers 100+ commands, 10+ plugins (log, dialog, store, updater, process, notification, window-state, global-shortcut, clipboard). Manages shared state: Database (Arc), PatternEngine (RwLock), EmbeddingCache, WidgetLock. Conditional log level: Debug in dev, Info in release.

### error.rs — Error System
- **Purpose:** Unified error handling for the entire backend.
- **Exports:** `HadronError` enum (20+ variants), `CommandResult<T>` type.
- **Key Logic:** Covers Database, IO, Security, AI, Parse, Http, Jira, Keeper, Config, Validation errors. Implements Serialize for Tauri IPC. `to_ipc_string()` sanitizes security errors. Auto-converts from rusqlite, reqwest, serde_json, tauri errors.

### database.rs — SQLite Wrapper
- **Purpose:** All database operations (50+ methods).
- **Key Logic:** Connection protected by parking_lot::Mutex (never poisons). WAL mode for concurrent reads. FTS5 with weighted BM25 ranking. Soft deletes via `deleted_at`. Parameterized queries for SQL injection prevention. Tables include: analyses, translations, tags, crash_signatures, jira_links, chat_sessions, gold_analyses, release_notes, and more.

### ai_service.rs — Multi-Provider AI
- **Purpose:** AI provider abstraction layer.
- **Key Logic:** Supports 4 providers with provider-specific request/response formats. OpenAI: JSON mode + tool calling. Anthropic: tool use + streaming. Z.ai: OpenAI-compatible. llama.cpp: local streaming. Cost estimation per provider/model. Token budget management for large crash logs. Parses tool calls from responses.

### chat_commands.rs — Agentic Loop
- **Purpose:** Ask Hadron chat with tool calling.
- **Key Logic:** Builds system prompt with 15 tool definitions. Agent loop (max 8 iterations): send to AI > parse tool calls > execute tools > append results > repeat. Streaming via Tauri events. RAG context injection. Citation extraction and validation. Evidence synthesis using XML source tags.

---

## Backend — Parser

### parser/crash_file.rs
- **Purpose:** Main crash log parser for WCR and text formats.
- **Key Logic:** Splits crash logs by section headers. Delegates to 9 section parsers: header, exception, stack_trace, context, environment, database, processes, memory, windows. Returns `CrashFile` struct with all parsed sections.

---

## Backend — Pattern Matching

### patterns/engine.rs
- **Purpose:** Crash pattern matching orchestrator.
- **Key Logic:** Iterates 30+ patterns (built-in + custom) against parsed CrashFile. Each pattern has multiple matchers (exception, stack_top, context, database). Match strength scored 0.0-1.0. Version filtering supported. Built-in patterns: NIL_RECEIVER, MESSAGE_NOT_UNDERSTOOD, SUBSCRIPTION_OUT_OF_BOUNDS, DEADLOCK, DATABASE_TIMEOUT, MEMORY_PRESSURE, etc.

---

## Backend — Retrieval/RAG

### retrieval/hybrid_analysis.rs — FTS5 Search
- **Purpose:** Full-text search with AI-generated query variants.
- **Key Logic:** Uses AI to generate alternative queries for broader recall. Runs multiple FTS5 searches in parallel. Deduplicates and scores results. Sanitizes FTS5 operators to prevent injection.

### retrieval/hybrid_kb.rs — Knowledge Base
- **Purpose:** Multi-source knowledge base retrieval.
- **Key Logic:** Searches OpenSearch using both KNN (vector) and BM25 (text). Includes release notes indices. Fuses results via RRF. Customer-specific filtering.

### retrieval/rrf.rs — Rank Fusion
- **Purpose:** Merge ranked results from heterogeneous sources.
- **Key Logic:** Reciprocal Rank Fusion: `score = sum(1/(k + rank))` across all source lists. Normalizes dissimilar scoring systems.

### retrieval/citation.rs — Citation Validation
- **Purpose:** Extract and validate citations in LLM responses.
- **Key Logic:** Extracts markdown links. Validates against tool results. Detects hallucinated references. Generates numbered reference lists.

---

## Backend — External Services

### jira_service.rs
- **Purpose:** JIRA Cloud REST API v2/v3 client.
- **Key Logic:** Basic Auth (email + token). Project listing, issue creation, JQL search with pagination, fix versions, comments.

### hadron-investigation (shared crate)
- **Purpose:** Deep investigation engine — ported from the CodexMgX Codex Desktop plugin (original author: Ante Gulin). Shared between the desktop Tauri app and the web Axum server.
- **Key Logic:** `AtlassianClient` with Basic Auth. Extended Jira API (`get_issue_full`, changelog, rendered comments, worklogs, remote links, agile context). Attachment extractor (txt/html/zip/docx/pdf, 8KB cap). ADF-to-plaintext converter. Three-strategy related-issue finder (direct links, same-project 90d, cross-project 6m). Confluence search, page fetch, and MOD documentation helpers. WHATS'ON KB token-scored search. Evidence builder assembles claims, matched entities, and cross-check results. Hypothesis engine scores candidates with confidence levels and surfaces open questions. Four top-level orchestrators: `investigate_ticket`, `investigate_regression_family`, `investigate_expected_behavior`, `investigate_customer_history`.

### sentry_service.rs
- **Purpose:** Sentry REST API client.
- **Key Logic:** Bearer token auth. Issues, events, project listing. Org-level and project-level queries.

### keeper_service.rs
- **Purpose:** Keeper Secrets Manager integration.
- **Key Logic:** C FFI SDK wrapper. Retrieves API keys from vault. Thread-safe singleton. Graceful fallback when unavailable.

---

## Backend — Export

### export/generators/
- **Purpose:** Multi-format report generation.
- **Key Logic:** 6 generators: HTML (template-based), Interactive HTML (collapsible sections), Markdown, JSON, TXT, XLSX. All support audience-aware content (technical, management, executive). PII sanitization via `sanitizer.rs`.

---

## Python Modules (Optional)

### python/rag/ — Vector Search
- **Purpose:** Chroma-based vector retrieval + BM25 hybrid search.
- **Key Logic:** OpenAI embeddings (text-embedding-3-small, 1536d) with local fallback via llama.cpp. 500-token chunks with 50-token overlap. Hybrid scoring: 70% vector + 30% BM25. JSON IPC via stdin/stdout for Tauri subprocess calls.

### python/offline/ — Offline Analysis
- **Purpose:** Fully offline crash analysis via llama.cpp.
- **Key Logic:** Connects to local llama-server (OpenAI-compatible API). Three modes: DISABLED, HYBRID, FULL. Requires 16GB RAM, 8GB VRAM.

### python/training/ — Fine-Tuning
- **Purpose:** QLoRA fine-tuning pipeline.
- **Key Logic:** 4-bit quantization of Llama-3.1-8B-Instruct. QLoRA: r=16, alpha=32. Training: 3 epochs, batch 4, lr=2e-4. Exports to GGUF for llama.cpp.
