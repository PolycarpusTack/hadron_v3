import { useState, useEffect } from "react";
import { X, BookOpen, HelpCircle, GraduationCap, ChevronRight, ExternalLink, Layers, ArrowRightLeft, FileCode, Cpu, ScrollText } from "lucide-react";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { APP_VERSION } from "../constants/version";

// Documentation content types
type DocType = "getting-started" | "architecture" | "data-flow" | "api-reference" | "module-deep-dive" | "version-history" | "troubleshooting";

interface DocumentationViewerProps {
  isOpen: boolean;
  onClose: () => void;
  initialDoc?: DocType;
}

interface DocSection {
  id: DocType;
  title: string;
  icon: React.ReactNode;
  description: string;
}

const docSections: DocSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: <GraduationCap className="w-5 h-5" />,
    description: "Tutorial for new users — learn Hadron step by step",
  },
  {
    id: "architecture",
    title: "Architecture",
    icon: <Layers className="w-5 h-5" />,
    description: "Directory structure, system diagram, and technology stack",
  },
  {
    id: "data-flow",
    title: "Data Flow",
    icon: <ArrowRightLeft className="w-5 h-5" />,
    description: "How requests flow through the system end to end",
  },
  {
    id: "api-reference",
    title: "API Reference",
    icon: <FileCode className="w-5 h-5" />,
    description: "All Tauri commands, chat tools, and integration endpoints",
  },
  {
    id: "module-deep-dive",
    title: "Module Deep-Dive",
    icon: <Cpu className="w-5 h-5" />,
    description: "Purpose, dependencies, and key logic for every major module",
  },
  {
    id: "version-history",
    title: "Version History",
    icon: <ScrollText className="w-5 h-5" />,
    description: "Release notes and changelog for each version",
  },
  {
    id: "troubleshooting",
    title: "Help & Troubleshooting",
    icon: <HelpCircle className="w-5 h-5" />,
    description: "Solve common problems and find answers",
  },
];

// Documentation content - embedded for reliability
const DOCS: Record<DocType, string> = {
  "getting-started": `# Getting Started with Hadron

Welcome to **Hadron** — your AI-powered support assistant for WHATS'ON crash analysis, JIRA integration, Sentry monitoring, and release notes generation.

---

## What You'll Learn

By the end of this tutorial, you'll be able to:
- Set up Hadron with your AI provider
- Analyze your first crash log
- Use Ask Hadron (the AI chatbot)
- Browse Sentry issues and generate release notes
- Export and share reports

**Estimated time: 10 minutes**

---

## Module 1: First Launch & Setup

### Step 1.1: Launch Hadron

When you first open Hadron, a splash screen appears, then the main interface with the Crash Analyzer panel.

### Step 1.2: Configure Your AI Provider

1. **Click the Settings icon** (gear) in the top right corner, or press \`Ctrl+,\`
2. **Select a provider** and enter your API key:

| Provider | Key Source | Cost |
|----------|-----------|------|
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | Per-token |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) | Per-token |
| **Z.ai** | [z.ai](https://z.ai) | Flat-rate |
| **llama.cpp** | No key needed | Free (local) |

3. **Click "Save Settings"**

> **Tip:** For llama.cpp, start the server first: \`llama-server -m model.gguf --host 127.0.0.1 --port 8080\`

> **Checkpoint:** You should see the provider status in the footer bar.

---

## Module 2: Your First Analysis

### Step 2.1: Load a Crash Log

**Option A: Choose File**
1. Click **Choose File** and select one or more crash log files

**Option B: Paste Log Text**
1. Click **Paste Log Text**, paste the content, and click **Analyze**

### Step 2.2: Choose Analysis Type

| Quick Analysis | Comprehensive (WHATS'ON) |
|----------------|--------------------------|
| Fast (5-10s) | Full scan (30-60s) |
| Crash focus | 10-part structured report |
| Root cause + fix | Impact, test scenarios, reproduction steps |

### Step 2.3: Understanding Results

Results include:
- **Summary** — What crashed and why
- **Root Cause** — Technical explanation
- **Suggested Fix** — Code changes or steps to resolve
- **Severity** — Critical, High, Medium, or Low
- **Component** — Which part of the application was affected

From results, you can: **Export** (Markdown/HTML/JSON/XLSX), **Create JIRA Ticket**, **Add Tags**, or **Re-analyze**.

---

## Module 3: Ask Hadron (AI Chatbot)

Click the **Ask Hadron** tab in the sidebar to open the AI assistant.

- Type questions like "What are the most common crashes this week?"
- The agent has access to **22 tools**: search analyses, search JIRA, search the knowledge base, find similar crashes, get trends, deep-investigate tickets, search Confluence, and more
- Watch the **tool activity** panel to see what the agent is doing
- **Rate responses** with thumbs up/down to improve future results

---

## Module 4: Integrations

### JIRA
Configure in Settings > JIRA Integration. Once connected, you can create tickets directly from crash analyses and the chatbot can search/create JIRA issues. Use the **Investigate** button in the JIRA Analyzer to run a deep investigation on any ticket — returning a full evidence dossier with changelog, comments, related issues, Confluence docs, attachment text, and AI-generated hypotheses.

### Sentry
Configure in Settings > Sentry Integration. The **Sentry Analyzer** tab lets you browse production errors, view event details, and run AI analysis on Sentry issues. Detects patterns: Deadlocks, N+1 Queries, Memory Leaks, Unhandled Promises.

### Release Notes
The **Release Notes** tab generates AI-powered release notes from JIRA fix versions. Lifecycle: Draft > In Review > Approved > Published.

### Keeper Secrets
Configure in Settings > Keeper Integration to securely store API keys in Keeper vault instead of local storage.

---

## Module 5: Widget (Floating Button)

The widget is a small floating button that stays on top of other windows:

- **Click** to expand into a quick chat panel
- **Right-click** for quick action templates (Explain Error, Summarize for Jira, etc.)
- **Drag** to reposition anywhere on screen
- **Drop files** onto the expanded panel for quick analysis
- Toggle via **Alt+H** or in Settings

---

## Module 6: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| \`Ctrl+N\` | New analysis |
| \`Ctrl+H\` | Open History |
| \`Ctrl+,\` | Open Settings |
| \`Ctrl+Y\` | Open Console |
| \`Alt+H\` | Toggle Widget |
| \`Esc\` | Close panel |
`,

  architecture: `# Architecture

Hadron uses a **three-layer hybrid architecture**:

| Layer | Technology | Role |
|-------|------------|------|
| **Frontend** | React 18 + TypeScript + Tailwind | 68 components, state management, services |
| **Backend** | Rust + Tauri v2 | Parsing, AI calls, database, integrations, 100+ commands |
| **Scripts** | Python 3.10+ (optional) | RAG vector search, training, offline analysis |

Communication: Frontend <-> Backend via **Tauri IPC** (\`invoke()\` calls + event streaming).

---

## Directory Structure

\`\`\`
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
\`\`\`

---

## System Architecture Diagram

\`\`\`
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
\`\`\`

---

## Database Schema (SQLite + FTS5)

**15+ tables** across 13 migrations:

| Table | Purpose |
|-------|---------|
| \`analyses\` | Core crash analysis records (30+ columns) |
| \`analyses_fts\` | FTS5 full-text search (BM25 ranking) |
| \`translations\` | Content translations |
| \`tags\` / \`analysis_tags\` | Tagging system (many-to-many) |
| \`crash_signatures\` | Error deduplication + tracking |
| \`analysis_notes\` | User notes on analyses |
| \`analysis_feedback\` | Accept/reject/edit/rating feedback |
| \`gold_analyses\` | Verified gold-standard answers |
| \`gold_answers\` | Ask Hadron Q&A pairs |
| \`jira_links\` | JIRA ticket linking |
| \`chat_sessions\` / \`chat_messages\` | Chat history |
| \`chat_feedback\` | Chat response ratings |
| \`release_notes\` | Generated release notes |
| \`session_summaries\` | Chat session summaries |

**Configuration:** WAL mode, NORMAL synchronous, 256MB mmap, FTS5 with weighted BM25 (error_type x10, root_cause x8, component x7).
`,

  "data-flow": `# Data Flow

## Crash Analysis Flow

When a user drops a crash log file, the following sequence occurs:

\`\`\`
User drops file
  |
  v
FileDropZone.onFileSelect()
  |
  v
api.analyzeCrashLog(filePath, options)
  |
  v
circuit-breaker.ts ── checks provider health
  |
  v
invoke("analyze_crash_log", request)
  |
  v
Backend: validate_file_path() ── security check
  |
  v
parser/crash_file.rs: parse_file(path)
  |── header.rs:     timestamp, product, version
  |── exception.rs:  error type, message, code
  |── stack_trace.rs: frames, symbols, addresses
  |── context.rs:    registers, heap state
  |── environment.rs: system info
  |── database.rs:   query history
  |── processes.rs:  running processes
  |── memory.rs:     memory layout
  |── windows.rs:    UI state
  v
CrashFile (all parsed sections)
  |
  +──[if RAG enabled]──> retrieval/hybrid_analysis.rs
  |                       |── FTS5 search (similar analyses)
  |                       |── Query variant generation
  |                       v
  |                     RAGContext (similar cases)
  |
  +──[if KB enabled]───> retrieval/hybrid_kb.rs
  |                       |── OpenSearch KNN (vector search)
  |                       |── OpenSearch BM25 (text search)
  |                       |── retrieval/rrf.rs (fusion)
  |                       v
  |                     KBContext (knowledge base hits)
  |
  v
ai_service.rs: call_provider_raw_json()
  |── Build prompt with crash data + RAG context + KB context
  |── Send to provider (OpenAI / Anthropic / Z.ai / llama.cpp)
  v
JSON analysis result
  |
  v
database.rs: insert_analysis()
  |── FTS5 auto-indexed via triggers
  |── Auto-tagging (if enabled)
  v
Return Analysis to frontend
  |
  v
Render AnalysisDetailView / WhatsOnDetailView
\`\`\`

---

## Ask Hadron Chat Flow

When a user sends a message to Ask Hadron:

\`\`\`
User types message
  |
  v
chat.ts: sendChatMessage(messages, options)
  |── Subscribe to events: chat:stream, chat:tool-use, chat:diagnostics
  v
invoke("chat_send", { messages, options })
  |
  v
chat_commands.rs: Build system prompt + 15 tool definitions
  |
  +──[RAG context]──> FTS5 search + similar analyses
  |
  v
AGENT LOOP (max 8 iterations):
  |
  |── ai_service: call_provider_streaming(messages + tools)
  |     |
  |     +──> emit("chat:stream", token)  ──> Frontend renders token
  |     v
  |   Response from AI
  |     |
  |     +── [if tool_calls detected]
  |     |     |
  |     |     v
  |     |   chat_tools.rs: execute_tool(name, args)
  |     |     |── search_analyses → SQLite FTS5
  |     |     |── search_kb → OpenSearch
  |     |     |── search_jira → JIRA API
  |     |     |── create_jira_ticket → JIRA API
  |     |     |── find_similar_crashes → SQLite
  |     |     |── get_trend_data → SQLite
  |     |     |── investigate_jira_ticket → hadron-investigation
  |     |     |── investigate_regression_family → hadron-investigation
  |     |     |── investigate_expected_behavior → hadron-investigation
  |     |     |── investigate_customer_history → hadron-investigation
  |     |     |── search_confluence → hadron-investigation
  |     |     |── get_confluence_page → hadron-investigation
  |     |     |── ... (22 tools total)
  |     |     v
  |     |   Append tool result to messages → CONTINUE LOOP
  |     |
  |     +── [if text response (no tools)]
  |           |
  |           v
  |         BREAK LOOP
  |
  v
Citation extraction + validation
  |── Extract markdown links from response
  |── Validate against tool results
  |── Flag hallucinated citations
  v
emit("chat:final-content", response)
  |
  v
Frontend renders final response with citations
\`\`\`

---

## Widget Communication Flow

\`\`\`
Widget Window (WidgetApp.tsx)              Main Window (App.tsx)
  |                                           |
  |── Click FAB → expand panel                |
  |── WidgetChat: user types message          |
  |── Chat completes                          |
  |                                           |
  |── "Open in Main" clicked                  |
  |     |                                     |
  |     +── emit("widget:open-in-main",       |
  |     |        { messages })                |
  |     |                                     |
  |     +── invoke("focus_main_window")       |
  |                                     ──────|
  |                                     listen("widget:open-in-main")
  |                                     AskHadronView receives messages
  |
  +── Settings changed in main window
  |     |
  |     +─────────────── emit("settings:hover-button-changed")
  |     |                                     |
  |     v                                     |
  |   Widget hides/shows accordingly          |
\`\`\`

---

## Circuit Breaker Pattern

\`\`\`
API Call
  |
  v
Check circuit state for provider
  |
  +── CLOSED (healthy): Execute call
  |     |
  |     +── Success → Record success, return result
  |     +── Failure → Record failure
  |           |
  |           +── Error rate > 50%? → OPEN circuit
  |
  +── OPEN (failing): Skip provider
  |     |
  |     +── Cooldown elapsed? → HALF-OPEN
  |     +── Otherwise → Try next provider
  |
  +── HALF-OPEN (testing): Execute single test call
        |
        +── Success → CLOSED
        +── Failure → OPEN (reset cooldown)
\`\`\`
`,

  "api-reference": `# API Reference

All backend functionality is exposed as Tauri commands, invoked from the frontend via \`invoke("command_name", { params })\`.

---

## Analysis & CRUD

| Command | Inputs | Returns |
|---------|--------|---------|
| \`analyze_crash_log\` | file_path, api_key, model, provider, analysis_type, verbosity, redact_pii | \`Analysis\` |
| \`analyze_jira_ticket\` | JiraTicketAnalyzeRequest | \`Analysis\` |
| \`save_external_analysis\` | ExternalAnalysisRequest | \`Analysis\` |
| \`get_all_analyses\` | — | \`Vec<Analysis>\` |
| \`get_analyses_paginated\` | limit?, offset? | \`Vec<Analysis>\` |
| \`get_analysis_by_id\` | id | \`Analysis\` |
| \`get_analyses_count\` | — | \`i64\` |
| \`delete_analysis\` | id | \`()\` |
| \`toggle_favorite\` | id | \`bool\` |
| \`get_favorites\` | — | \`Vec<Analysis>\` |
| \`get_recent\` | limit | \`Vec<Analysis>\` |
| \`search_analyses\` | query, severity_filter? | \`Vec<Analysis>\` |
| \`get_analyses_filtered\` | query, date_from?, date_to?, severity?, type?, component? | \`Vec<Analysis>\` |
| \`get_database_statistics\` | — | \`DatabaseStatistics\` |

---

## Tags

| Command | Inputs | Returns |
|---------|--------|---------|
| \`create_tag\` | name, color | \`Tag\` |
| \`update_tag\` | id, name?, color? | \`Tag\` |
| \`delete_tag\` | id | \`()\` |
| \`get_all_tags\` | — | \`Vec<Tag>\` |
| \`add_tag_to_analysis\` | analysis_id, tag_id | \`()\` |
| \`remove_tag_from_analysis\` | analysis_id, tag_id | \`()\` |
| \`auto_tag_analyses\` | — | \`{ tagged, skipped }\` |

---

## Ask Hadron (Chat)

| Command | Inputs | Returns |
|---------|--------|---------|
| \`chat_send\` | messages, options (useRag, useKb, requestId, verbosity) | \`String\` |
| \`chat_save_session\` | ChatSession | \`i64\` |
| \`chat_list_sessions\` | — | \`Vec<ChatSession>\` |
| \`chat_get_messages\` | session_id | \`Vec<ChatMessage>\` |
| \`chat_delete_session\` | session_id | \`()\` |
| \`chat_submit_feedback\` | session_id, message_id, type, reason? | \`()\` |

### Chat Tools (22)

The AI agent can invoke these tools during conversation:

| Tool | Purpose |
|------|---------|
| \`search_analyses\` | Full-text search past crash analyses |
| \`search_kb\` | Semantic search the knowledge base |
| \`search_jira\` | JQL search for JIRA issues |
| \`create_jira_ticket\` | Create a new JIRA issue |
| \`find_similar_crashes\` | Find analyses with similar error signatures |
| \`get_analysis_detail\` | Load full analysis by ID |
| \`get_trend_data\` | Error trends over a time period |
| \`get_top_error_patterns\` | Most frequent crash patterns |
| \`get_crash_signatures\` | Signature deduplication data |
| \`search_release_notes\` | Search generated release notes |
| \`get_gold_answers\` | Retrieve verified Q&A pairs |
| \`search_sentry_issues\` | Search Sentry issues |
| \`get_database_stats\` | Database statistics |
| \`calculate\` | Evaluate math expressions |
| \`get_current_date\` | Return current date/time |
| \`investigate_jira_ticket\` | Deep-investigate a ticket: full changelog, comments, worklogs, related issues, Confluence docs, attachment text, hypotheses, and open questions |
| \`investigate_regression_family\` | Find historical sibling and predecessor issues — same project (90 days) and cross-project (6 months) |
| \`investigate_expected_behavior\` | Search Confluence and MOD documentation to establish what the correct behavior should be |
| \`investigate_customer_history\` | Profile the reporting customer by pulling their full issue history and surfacing patterns |
| \`search_confluence\` | Full-text search across Confluence spaces |
| \`get_confluence_page\` | Fetch a Confluence page by ID |

---

## JIRA Integration

| Command | Inputs | Returns |
|---------|--------|---------|
| \`test_jira_connection\` | base_url, email, api_token | \`JiraTestResponse\` |
| \`list_jira_projects\` | base_url, email, api_token | \`Vec<JiraProjectInfo>\` |
| \`create_jira_ticket\` | JiraCreateRequest | \`JiraCreateResponse\` |
| \`search_jira_issues\` | base_url, email, api_token, jql | \`Vec<JiraIssue>\` |
| \`link_jira_to_analysis\` | analysis_id, jira_link | \`i64\` |
| \`unlink_jira_from_analysis\` | analysis_id, jira_key | \`()\` |
| \`post_jira_comment\` | base_url, email, api_token, issue_key, comment | \`()\` |

---

## Sentry Integration

| Command | Inputs | Returns |
|---------|--------|---------|
| \`test_sentry_connection\` | org_slug, auth_token | \`SentryTestResponse\` |
| \`list_sentry_projects\` | org_slug, auth_token | \`Vec<SentryProject>\` |
| \`list_sentry_issues\` | project_id, auth_token | \`Vec<SentryIssue>\` |
| \`fetch_sentry_issue\` | project_id, issue_id, auth_token | \`SentryIssueDetail\` |
| \`analyze_sentry_issue\` | SentryAnalyzeRequest | \`Analysis\` |

---

## Export & Reports

| Command | Inputs | Returns |
|---------|--------|---------|
| \`generate_report\` | analysis_id, format, audience?, sections? | \`ReportResult\` |
| \`generate_report_multi\` | analysis_id, formats[] | \`Vec<ReportResult>\` |
| \`preview_report\` | analysis_id | \`String (HTML)\` |
| \`check_sensitive_content\` | content | \`SensitiveContentResult\` |
| \`sanitize_content\` | content, audience | \`String\` |
| \`get_export_formats\` | — | \`Vec<ExportFormat>\` |

**Supported formats:** HTML, Interactive HTML, Markdown, JSON, TXT, XLSX

---

## Widget

| Command | Inputs | Returns |
|---------|--------|---------|
| \`toggle_widget\` | — | \`()\` |
| \`show_widget\` | — | \`()\` |
| \`hide_widget\` | — | \`()\` |
| \`resize_widget\` | width, height | \`()\` |
| \`move_widget\` | x, y | \`()\` |
| \`get_widget_position\` | — | \`WidgetPosition { x, y }\` |
| \`focus_main_window\` | — | \`()\` |
| \`is_main_window_visible\` | — | \`bool\` |

---

## Intelligence Platform

| Command | Inputs | Returns |
|---------|--------|---------|
| \`submit_analysis_feedback\` | analysis_id, type, field_name?, values?, rating?, reason? | \`()\` |
| \`promote_to_gold\` | analysis_id | \`()\` |
| \`verify_gold_analysis\` | gold_id | \`()\` |
| \`reject_gold_analysis\` | gold_id, reason | \`()\` |
| \`export_gold_jsonl\` | — | \`String (JSONL)\` |
| \`save_gold_answer\` | question, answer, component?, severity? | \`i64\` |
| \`search_gold_answers_cmd\` | query | \`Vec<GoldAnswer>\` |

---

## Release Notes

| Command | Inputs | Returns |
|---------|--------|---------|
| \`generate_release_notes\` | jira_version, config | \`ReleaseNotes\` |
| \`list_release_notes\` | — | \`Vec<ReleaseNotes>\` |
| \`get_release_notes\` | id | \`ReleaseNotes\` |
| \`update_release_notes_status\` | id, status | \`()\` |
| \`export_release_notes\` | id, format | \`String\` |

---

## Database Maintenance

| Command | Inputs | Returns |
|---------|--------|---------|
| \`optimize_fts_index\` | — | \`()\` |
| \`check_database_integrity\` | — | \`bool\` |
| \`compact_database\` | — | \`()\` |
| \`checkpoint_wal\` | — | \`()\` |
| \`get_database_info\` | — | \`DatabaseInfo\` |

---

## Pattern Matching

| Command | Inputs | Returns |
|---------|--------|---------|
| \`parse_crash_file\` | path | \`CrashFile\` |
| \`parse_crash_content\` | content, filename | \`CrashFile\` |
| \`match_patterns\` | crash_file | \`Vec<PatternMatchResult>\` |
| \`get_best_pattern_match\` | crash_file | \`PatternMatchResult?\` |
| \`list_patterns\` | — | \`Vec<CrashPattern>\` |
| \`reload_patterns\` | — | \`()\` |

---

## Crash Signatures

| Command | Inputs | Returns |
|---------|--------|---------|
| \`compute_crash_signature\` | crash_file | \`String (hash)\` |
| \`register_crash_signature\` | CrashSignature | \`()\` |
| \`get_signature_occurrences\` | hash | \`i32\` |
| \`get_top_signatures\` | limit | \`Vec<CrashSignature>\` |
| \`update_signature_status\` | hash, status | \`()\` |
| \`link_ticket_to_signature\` | hash, ticket_system, ticket_id, url | \`()\` |
`,

  "module-deep-dive": `# Module Deep-Dive

Detailed documentation for every major module in the system.

---

## Frontend Core

### App.tsx — Root Orchestrator
- **Purpose:** Routes all views, manages global state, orchestrates lazy loading.
- **Dependencies:** All views (lazy), useAppState, useKeyboardShortcuts, DocumentationViewer, ConsoleViewer.
- **Exports:** Root React component.
- **Key Logic:** \`useAppState\` (useReducer) provides centralized state with 40+ action types covering navigation, analysis lifecycle, batch processing, code analysis, and error display. Routes to 10 views via \`currentView\` state. Lazy-loads heavy views (AnalysisDetailView, WhatsOnDetailView, AskHadronView, ReleaseNotesView) with Suspense.

### services/api.ts — Backend Gateway
- **Purpose:** Tauri IPC wrappers for all 100+ backend commands.
- **Dependencies:** \`@tauri-apps/api/core\` (invoke).
- **Exports:** 40+ async functions (analyzeCrashLog, getAllAnalyses, searchAnalyses, etc.).
- **Key Logic:** Each function maps to a Tauri command. Provider/model configuration stored in localStorage. File path validation delegated to backend.

### services/circuit-breaker.ts — Provider Failover
- **Purpose:** Resilient API calls with automatic provider switching.
- **Exports:** \`circuitBreaker.call()\`, \`circuitBreaker.getState()\`.
- **Key Logic:** Tracks error rates per provider (50% threshold). Three states: closed (healthy), open (failing), half-open (testing). Auto-falls back to next healthy provider. 5-minute timeout for deep scan operations.

### services/chat.ts — Chat Streaming
- **Purpose:** Ask Hadron chat session management and real-time event streaming.
- **Exports:** \`sendChatMessage\`, \`cancelChat\`, event subscribers, session CRUD.
- **Key Logic:** Invokes \`chat_send\` while subscribing to Tauri events: \`chat:stream\` (tokens), \`chat:tool-use\` (tool invocations), \`chat:diagnostics\` (retrieval stats), \`chat:final-content\` (complete response). Subscriptions scoped by requestId.

---

## Frontend — Widget System

### widget/WidgetApp.tsx — Widget Root
- **Purpose:** Manages the floating widget window (FAB and expanded states).
- **Key Logic:** Two states: FAB (44x44px) and expanded (400x520px). Smart positioning: detects screen quadrant, expands away from edges. Saves position to localStorage. All window operations serialized via \`withWidgetLock\` to prevent wry/WebView2 crashes on Windows.

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
- **Exports:** \`HadronError\` enum (20+ variants), \`CommandResult<T>\` type.
- **Key Logic:** Covers Database, IO, Security, AI, Parse, Http, Jira, Keeper, Config, Validation errors. Implements Serialize for Tauri IPC. \`to_ipc_string()\` sanitizes security errors. Auto-converts from rusqlite, reqwest, serde_json, tauri errors.

### database.rs — SQLite Wrapper
- **Purpose:** All database operations (50+ methods).
- **Key Logic:** Connection protected by parking_lot::Mutex (never poisons). WAL mode for concurrent reads. FTS5 with weighted BM25 ranking. Soft deletes via \`deleted_at\`. Parameterized queries for SQL injection prevention. Tables include: analyses, translations, tags, crash_signatures, jira_links, chat_sessions, gold_analyses, release_notes, and more.

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
- **Key Logic:** Splits crash logs by section headers. Delegates to 9 section parsers: header, exception, stack_trace, context, environment, database, processes, memory, windows. Returns \`CrashFile\` struct with all parsed sections.

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
- **Key Logic:** Reciprocal Rank Fusion: \`score = sum(1/(k + rank))\` across all source lists. Normalizes dissimilar scoring systems.

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
- **Key Logic:** \`AtlassianClient\` with Basic Auth. Extended Jira API (\`get_issue_full\`, changelog, rendered comments, worklogs, remote links, agile context). Attachment extractor (txt/html/zip/docx/pdf, 8KB cap). ADF-to-plaintext converter. Three-strategy related-issue finder (direct links, same-project 90d, cross-project 6m). Confluence search, page fetch, and MOD documentation helpers. WHATS'ON KB token-scored search. Evidence builder assembles claims, matched entities, and cross-check results. Hypothesis engine scores candidates with confidence levels and surfaces open questions. Four top-level orchestrators: \`investigate_ticket\`, \`investigate_regression_family\`, \`investigate_expected_behavior\`, \`investigate_customer_history\`.

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
- **Key Logic:** 6 generators: HTML (template-based), Interactive HTML (collapsible sections), Markdown, JSON, TXT, XLSX. All support audience-aware content (technical, management, executive). PII sanitization via \`sanitizer.rs\`.

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
`,

  "version-history": `# Version History

## v4.6.0 — Deep Investigation (April 2026)

### Investigation Engine
- **4 new investigation tools in Ask Hadron** — \`investigate_jira_ticket\`, \`investigate_regression_family\`, \`investigate_expected_behavior\`, \`investigate_customer_history\`. Ask Hadron can now build a full evidence dossier for any JIRA ticket and reason over it.
- **Investigate button in JIRA Analyzer** — one click from any loaded ticket to a structured investigation panel showing evidence, hypotheses, open questions, and next-check suggestions.
- **Confluence search in chat** — \`search_confluence\` and \`get_confluence_page\` tools give Ask Hadron direct access to Confluence mid-conversation.
- **Attachment text extraction** — investigation reads text from \`.txt\`, \`.html\`, \`.zip\`, \`.docx\`, and \`.pdf\` attachments automatically (up to 8 KB each).
- **WHATS'ON KB integration** — token-scored search against the WHATS'ON knowledge base, available in all investigation tools.
- **Confluence credential override** — teams on a separate Confluence instance can configure distinct base URL, email, and API token in JIRA Settings.
- **\`hadron-investigation\` crate** — self-contained Rust library (ported from the CodexMgX plugin by Ante Gulin) shared between desktop and web. Implements the full Atlassian client, ADF converter, three-strategy related-issue finder, evidence builder, and hypothesis engine.

---

## v4.4.1 — Keeper & Crash Fixes (March 2026)

### Keeper Secrets Manager
- **Fixed API key extraction** — Records using Notes fields, encryptedNotes records, and custom-labeled fields are now detected
- **Case-insensitive label matching** — Labels like "Api Key", "api key", "token", "secret key" now match regardless of case
- **Login field excluded** — Brute-force extraction no longer returns usernames instead of passwords
- **Wired into model refresh & connection test** — Keeper-managed keys now work with "Refresh Models", "Test Connection", and the API key warning banner
- **Improved diagnostics** — Extraction failures now log the full record structure including field types, labels, and top-level keys

### Crash Fixes
- **Fixed hotkey registration crash** — App no longer panics if Ctrl+Shift+H is already registered (e.g. from a previous unclean exit); unregisters first, catches errors gracefully
- **SDK errors logged** — Keeper SDK errors are now logged at trace level instead of being silently swallowed

---

## v4.4.0 — Stability & Safety (March 2026)

This release focuses on **runtime stability**, fixing crash-causing bugs and hardening the codebase against real-world failure conditions. All issues were identified through a systematic runtime stability audit.

### Critical Fixes
- **Resolved ILLEGAL_INSTRUCTION crashes** — Added \`.cargo/config.toml\` with \`target-cpu=x86-64\` to prevent AVX/AVX2 instructions from crashing on older CPUs
- **Fixed auto-restart fork bomb** — The tao paint-bug restart logic now caps at 2 retries via an environment variable, preventing infinite process spawning
- **Fixed UTF-8 panics** — All 7 instances of unsafe byte-index slicing (\`&s[..200]\`) replaced with \`floor_char_boundary()\` to prevent crashes on non-ASCII content (accented characters, CJK, emoji)
- **Fixed silent data loss** — AI providers returning empty responses no longer silently persist blank release notes; callers now receive a clear error

### Stability Improvements
- **Poller cancel flag fixed** — Background JIRA poller now uses the correct \`AtomicBool\` for graceful shutdown instead of a disconnected copy
- **Poller timeout added** — Network calls in the background poller are now wrapped in a 5-minute timeout to prevent indefinite hangs
- **Cancellation responsiveness** — Chat LLM calls now check the cancel flag after each network call and between dual synthesis passes
- **Transactional chat saves** — Session + messages are now saved atomically in a single SQLite transaction, preventing partial writes on error
- **Widget lock upgraded** — Replaced blocking \`parking_lot::Mutex\` with \`tokio::sync::Mutex\` to prevent starving the async runtime under rapid widget operations
- **Embedding validation** — Cosine similarity now skips embeddings with mismatched dimensions instead of producing silent wrong results
- **COMMIT failure recovery** — Added ROLLBACK on COMMIT failure in embedding upserts to prevent stuck database connections
- **Prompt size cap** — Release notes generation now truncates enriched descriptions and caps total prompt size at 512KB
- **TLS certificate verification** — OpenSearch connections now verify TLS certificates by default; \`verify_certs: false\` must be explicitly set for self-signed certs
- **ROLLBACK error handling** — Fixed 3 bulk operations where a ROLLBACK failure would swallow the original error

### Minor Fixes
- **Duration overflow** — Replaced unsafe \`as i32\` casts on elapsed time with saturating conversion
- **Async SQLite calls** — Chat metadata commands (star, tag, update) now use \`spawn_blocking\` instead of blocking the Tokio runtime
- **Thread pool for Keeper** — Replaced raw \`std::thread::spawn\` with \`tokio::task::spawn_blocking\` to prevent orphaned threads on cancellation
- **Shared HTTP client** — OpenSearch embedding calls now reuse a shared \`reqwest::Client\` instead of creating one per call
- **Range validation** — \`get_trend_data\` now clamps \`range_days\` to a minimum of 1
- **Transactional deletes** — Chat session deletion is now atomic (messages + session in one transaction)
- **JSON extraction** — Python runner now tries multiple \`{\` positions for more robust JSON extraction from stdout
- **Confluence tables** — Markdown-to-Confluence conversion now correctly uses \`||\` only for header rows, not data rows
- **Error clarity** — "Promote to Gold" for already-promoted analyses now returns a descriptive error instead of \`QueryReturnedNoRows\`

---

## v4.3.0 — Unified Export & JIRA Assist (March 2026)

### JIRA Assist (Sprints 1-7)
- AI-powered ticket triage with severity/category classification
- Investigation briefs with parallel triage + deep analysis
- Duplicate detection via OpenAI embeddings and cosine similarity
- JIRA round-trip: post briefs as comments, collect engineer feedback
- Project feed integration with batch triage and client-side filters
- Background poller with configurable JQL, interval, and OS notifications

### Unified Export
- Generic export system supporting Markdown, HTML, Interactive HTML, JSON, TXT, and XLSX
- Export added to Crash Analyzer, Code Analyzer, Sentry Analyzer, and JIRA Analyzer
- File location picker: Download / Default Folder / Choose
- Default export directory preference in Settings

### Code Analyzer
- Component split into orchestrator + 6 tabs + 3 shared components
- \`call_ai\` command for AI calls without DB persistence
- Token budget: frontend warns at 50KB, backend rejects at 512KB
`,
  troubleshooting: `# Help & Troubleshooting

Quick solutions to common problems in Hadron ${APP_VERSION}.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| \`Ctrl+N\` | New analysis |
| \`Ctrl+H\` | Open History |
| \`Ctrl+,\` | Open Settings |
| \`Ctrl+Y\` | Open Console Viewer |
| \`Alt+H\` | Toggle Widget |
| \`Esc\` | Close current panel/modal |

---

## "All AI providers failed"

**Cause:** Missing or invalid API key, or provider is unreachable.

1. Press \`Ctrl+,\` to open Settings
2. Re-enter your API key from your provider's dashboard:
   - OpenAI: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   - Anthropic: [console.anthropic.com](https://console.anthropic.com)
3. Select a valid model (e.g., \`gpt-4o\`, \`claude-sonnet-4-5-20250929\`)
4. Save and retry

For **llama.cpp**: ensure \`llama-server\` is running on port 8080.

---

## Comprehensive (WHATS'ON) Analysis Shows Empty Data

1. Wait for the progress bar to reach 100%
2. Check Console (\`Ctrl+Y\`) for specific errors
3. Retry — AI responses can vary between calls
4. Try a different provider or model

---

## "Python script not found in bundle"

Core features (parsing, AI analysis, JIRA, Sentry) work without Python. Python is only needed for Translation and RAG features. Reinstall if you need those features.

---

## Application Doesn't Start

1. **Check requirements:** Windows 10/11, macOS 10.15+, 4GB RAM
2. **Reset configuration:**
   - Windows: Delete \`%APPDATA%/com.hadron.desktop/\`
   - macOS: Delete \`~/Library/Application Support/com.hadron.desktop/\`
   - Linux: Delete \`~/.local/share/com.hadron.desktop/\`
3. Restart Hadron

---

## History Not Loading

1. Go to Settings > Database Administration
2. Click **Verify Database**
3. If errors found, click **Repair Database**

---

## JIRA Integration Not Working

1. Verify Settings > JIRA Integration:
   - **URL**: Must include \`https://\` (e.g., \`https://yourcompany.atlassian.net\`)
   - **Email**: Your Atlassian account email
   - **API Token**: From [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Test Connection** — should show "Connected successfully"

---

## Sentry Integration Not Working

1. Verify Settings > Sentry Integration:
   - **Base URL**: \`https://sentry.io\` or your self-hosted instance
   - **Auth Token**: Must have \`project:read\` and \`event:read\` scopes
   - **Organization** and **Project** slugs must match exactly
2. Click **Test Connection**

---

## Keeper Integration Not Working

1. Verify Settings > Keeper Integration:
   - **One-Time Access Token**: Must include region prefix (e.g., \`US:xxxx\`)
   - Token is single-use — generate a new one if it fails
2. Click **Test Connection**

---

## Ask Hadron Not Responding

1. Ensure an AI provider is configured and working (test with a crash analysis first)
2. Check Console (\`Ctrl+Y\`) for error details
3. The agent runs up to 8 tool-calling iterations — complex queries take longer
4. If stuck, start a **New Chat** and rephrase the question

---

## Widget Not Appearing

1. Check Settings > Hover Button is **enabled**
2. The widget may be off-screen — reset position: close Hadron, delete localStorage, reopen
3. Try the \`Alt+H\` hotkey to toggle visibility

---

## Slow Performance

1. **Reduce History Size** — Settings > Cleanup Old Records
2. **Use Quick Analysis** for initial triage
3. Large crash logs (>1MB) are automatically truncated
4. Run **Settings > Database Administration > Compact Database** periodically

---

## Export Issues

| Format | Use Case |
|--------|----------|
| **Markdown** | Documentation, wikis, GitHub issues |
| **HTML** | Browser viewing, email sharing |
| **Interactive HTML** | Collapsible sections, self-contained reports |
| **JSON** | Integrations, automation pipelines |
| **TXT** | Plain text for email/chat |
| **XLSX** | Spreadsheets, management reporting |

---

## Console Viewer

Press \`Ctrl+Y\` to see detailed logs:
- API requests and responses
- Parsing progress and errors
- AI token usage and cost estimates
- Tool execution details (Ask Hadron)
- Retrieval diagnostics (RAG + KB)

---

## Database & Log Locations

| Data | Windows | macOS | Linux |
|------|---------|-------|-------|
| Database | \`%APPDATA%/com.hadron.desktop/analysis.db\` | \`~/Library/Application Support/com.hadron.desktop/analysis.db\` | \`~/.local/share/com.hadron.desktop/analysis.db\` |
| Logs | \`%APPDATA%/com.hadron.desktop/logs/\` | \`~/Library/Logs/com.hadron.desktop/\` | \`~/.local/share/com.hadron.desktop/logs/\` |

---

## Report a Bug

Include: Hadron version (shown in header), OS, steps to reproduce, and Console logs (\`Ctrl+Y\`).
`,
};

export default function DocumentationViewer({
  isOpen,
  onClose,
  initialDoc = "getting-started",
}: DocumentationViewerProps) {
  const [selectedDoc, setSelectedDoc] = useState<DocType>(initialDoc);
  const [showSelector, setShowSelector] = useState(true);

  // Reset to selector view when opening
  useEffect(() => {
    if (isOpen) {
      setShowSelector(true);
    }
  }, [isOpen]);

  const handleSelectDoc = (docId: DocType) => {
    setSelectedDoc(docId);
    setShowSelector(false);
  };

  const handleBack = () => {
    setShowSelector(true);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-4xl">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-blue-500" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {showSelector ? "Documentation" : docSections.find((d) => d.id === selectedDoc)?.title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {!showSelector && (
              <Button variant="ghost" size="sm" onClick={handleBack}>
                Back to Menu
              </Button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {showSelector ? (
            /* Document Selector */
            <div className="p-6 space-y-3">
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Choose a section:
              </p>
              {docSections.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => handleSelectDoc(doc.id)}
                  className="w-full flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition group text-left"
                >
                  <div className="p-3 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-800/50 transition">
                    {doc.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
                      {doc.title}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {doc.description}
                    </p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition" />
                </button>
              ))}

              {/* External Links */}
              <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
                  External Resources
                </h3>
                <div className="flex flex-wrap gap-3">
                  <a
                    href="https://github.com/hadron-team/hadron-desktop"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition"
                  >
                    <ExternalLink className="w-4 h-4" />
                    GitHub Repository
                  </a>
                  <a
                    href="https://github.com/hadron-team/hadron-desktop/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Report Issues
                  </a>
                </div>
              </div>
            </div>
          ) : (
            /* Markdown Content */
            <div className="p-6 prose prose-gray dark:prose-invert max-w-none prose-headings:scroll-mt-4 prose-h1:text-2xl prose-h1:font-bold prose-h1:border-b prose-h1:border-gray-200 prose-h1:dark:border-gray-700 prose-h1:pb-2 prose-h2:text-xl prose-h2:font-semibold prose-h2:mt-8 prose-h3:text-lg prose-h3:font-medium prose-code:bg-gray-100 prose-code:dark:bg-gray-700 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-blue-600 prose-code:dark:text-blue-400 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-gray-900 prose-pre:dark:bg-gray-950 prose-table:text-sm prose-th:bg-gray-100 prose-th:dark:bg-gray-700 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-td:border-t prose-td:border-gray-200 prose-td:dark:border-gray-700 prose-a:text-blue-600 prose-a:dark:text-blue-400 prose-a:no-underline hover:prose-a:underline prose-blockquote:border-l-blue-500 prose-blockquote:bg-blue-50 prose-blockquote:dark:bg-blue-900/20 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg prose-hr:border-gray-200 prose-hr:dark:border-gray-700">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Custom link handling for external links
                  a: ({ href, children, ...props }) => {
                    const isExternal = href?.startsWith("http");
                    return (
                      <a
                        href={href}
                        target={isExternal ? "_blank" : undefined}
                        rel={isExternal ? "noopener noreferrer" : undefined}
                        {...props}
                      >
                        {children}
                        {isExternal && (
                          <ExternalLink className="inline w-3 h-3 ml-1 opacity-60" />
                        )}
                      </a>
                    );
                  },
                  // Code block styling
                  code: ({ className, children, ...props }) => {
                    const isInline = !className;
                    if (isInline) {
                      return (
                        <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-blue-600 dark:text-blue-400 text-sm" {...props}>
                          {children}
                        </code>
                      );
                    }
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {DOCS[selectedDoc]}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Press <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs">Esc</kbd> to close
            {!showSelector && (
              <> &middot; <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs cursor-pointer" onClick={handleBack}>Back</kbd> to menu</>
            )}
          </p>
        </div>
      </div>
    </Modal>
  );
}
