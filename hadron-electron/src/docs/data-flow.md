# Data Flow

## Crash Analysis Flow

When a user drops a crash log file, the following sequence occurs:

```
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
```

---

## Ask Hadron Chat Flow

When a user sends a message to Ask Hadron:

```
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
```

---

## Widget Communication Flow

```
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
```

---

## Circuit Breaker Pattern

```
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
```
