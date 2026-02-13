# Hadron - AI Support Assistant

<div align="center">

**Crash analysis** | **Agentic AI chatbot** | **JIRA & Sentry integration** | **Knowledge base** | **Release notes generation**

[Features](#features) • [Quick Start](#quick-start) • [Documentation](#documentation) • [Download](#download)

</div>

---

## Overview

Hadron is an AI-powered support assistant for the WHATS'ON broadcast management system. It combines crash log analysis, an agentic chatbot, Sentry error monitoring, JIRA integration, and a knowledge base into a single desktop application that helps support engineers debug issues faster.

- **Crash Analysis** — Drop a crash log and get AI-identified root causes, fix suggestions, and severity ratings
- **Ask Hadron** — Agentic chatbot with 15 tools that searches analyses, knowledge base docs, JIRA tickets, and trend data to answer questions
- **Sentry Integration** — Browse, search, and AI-analyze production errors from Sentry with pattern detection (deadlocks, N+1 queries, memory leaks)
- **JIRA Integration** — Correlate crashes to existing tickets, search issues, and create new tickets directly from the app
- **Knowledge Base** — Search WHATS'ON documentation and release notes via OpenSearch
- **Release Notes Generator** — AI-generated release notes from JIRA fix versions with editorial review workflow
- **Intelligence Platform** — Crash signatures, trend analytics, component health dashboards, and feedback-driven learning

---

## Features

### Analysis Engines

- **Crash Analyzer** — Drag & drop Smalltalk crash logs for AI analysis with root cause identification, fix suggestions, and severity classification
- **Code Analyzer** — Analyze source code files for issues and patterns
- **JIRA Analyzer** — Pull and analyze JIRA tickets with AI insights
- **Sentry Analyzer** — Browse Sentry issues with AI-powered pattern detection (deadlocks, N+1 queries, memory leaks, unhandled promises)
- **Performance Analyzer** — Analyze performance-related logs and metrics

### Ask Hadron — Agentic Chatbot

An AI assistant with a tool-calling agent loop and 15 integrated tools:

- `search_analyses` — Multi-query search with Reciprocal Rank Fusion (RRF)
- `search_kb` — Knowledge base documentation search via OpenSearch
- `search_jira` / `create_jira_ticket` — JIRA search and ticket creation
- `find_similar_crashes` / `compare_crashes` — Crash similarity and comparison
- `get_crash_signature` / `get_top_signatures` — Signature-based crash grouping
- `get_trend_data` / `get_error_patterns` / `get_statistics` — Analytics and trends
- `correlate_crash_to_jira` / `get_crash_timeline` — Cross-referencing and history
- `get_component_health` / `get_analysis_detail` — Component health and drill-down

Features: context-aware suggestions, conversation query rewriting, true SSE streaming, feedback-boosted retrieval, SQLite-persisted sessions.

### Release Notes Generator

- AI-generated release notes from JIRA fix versions
- Draft/review/approve/publish lifecycle
- Side-by-side editor with style guide
- Export to Markdown

### Intelligence Platform

- **Crash Signatures** — Automatic signature grouping with top-N dashboards
- **Trend Analytics** — Severity trends, error patterns over time
- **Component Health** — Per-component crash frequency and status
- **Feedback Loop** — Accept/reject/rate analyses; feedback boosts future search results
- **Gold Analyses** — Curated expert analyses for RAG retrieval

### Production Features

- **Multi-provider AI**: OpenAI, Anthropic Claude, Z.ai, llama.cpp (local/offline)
- **Encrypted storage**: API keys secured with OS-level encryption (Keychain/Credential Manager)
- **Circuit breaker**: Automatic failover to backup AI providers
- **Structured logging**: JSON + human-readable logs with automatic rotation
- **Auto-updater**: Automatic update checks and one-click installation
- **Full-text search**: SQLite with FTS5 and BM25 ranking
- **Export**: Save analyses to Markdown or PDF

### Status

- **Version**: 4.0.1
- **Platform**: Windows, macOS, Linux
- **Architecture**: Tauri 2 (Rust) + React/TypeScript

---

## Quick Start

### 1. Download

Get the installer for your platform:
- **Windows**: `hadron-desktop_4.0.1_x64_en-US.msi`
- **macOS**: `hadron-desktop_4.0.1_x64.dmg` (Intel) or `_aarch64.dmg` (Apple Silicon)
- **Linux**: `hadron-desktop_4.0.1_amd64.deb` or `.AppImage`

### 2. Install

**Windows**: Run `.msi` installer
**macOS**: Open `.dmg` and drag to Applications
**Linux**: `sudo dpkg -i hadron-desktop_4.0.1_amd64.deb`

### 3. Configure

1. Launch Hadron
2. Click **Settings** (gear icon)
3. Select AI provider (OpenAI / Anthropic / Z.ai / llama.cpp)
4. Enter your API key (not needed for llama.cpp)
5. Optionally configure JIRA, Sentry, and OpenSearch connections
6. Click **Save Settings**

### 4. Use

- **Analyze a crash**: Drag & drop a crash log file onto the window
- **Ask a question**: Switch to the Ask Hadron tab and chat with the AI assistant
- **Browse Sentry**: Connect your Sentry org and browse/analyze production errors
- **Generate release notes**: Select a JIRA fix version and generate AI-written release notes

---

## AI Provider Comparison

| Provider | Cost/Analysis | Context | Best For |
|----------|---------------|---------|----------|
| **OpenAI GPT-5.1** | $0.01-$0.03 | 128K tokens | Latest model, best capabilities |
| **Anthropic Claude Sonnet 4.5** | $0.003-$0.015 | 200K tokens | Best reasoning, large context |
| **Z.ai GLM-4.6** | $0 ($3/month) | 200K tokens | Daily use, unlimited |
| **llama.cpp** | Free (local) | Model-dependent | Offline use, no API key needed |

**Get API keys**:
- OpenAI: https://platform.openai.com/api-keys
- Anthropic: https://console.anthropic.com
- Z.ai: https://z.ai
- llama.cpp: Run `llama-server -m model.gguf --host 127.0.0.1 --port 8080`

---

## Documentation

### For Users
- [Complete User Guide](docs/user/USER-GUIDE.md) — Installation, features, tips & tricks
- [Troubleshooting](TROUBLESHOOTING.md) — Common issues and solutions
- [Features](FEATURES.md) — Full feature list
- [Changelog](CHANGELOG.md) — Release history

### For Developers
- [Developer Guide](docs/DEVELOPER-GUIDE.md) — Development setup and architecture
- [Auto-Updater Setup](docs/developer/AUTO-UPDATER-SETUP.md) — Configure updates
- [GitHub Release Guide](docs/developer/GITHUB-RELEASE-GUIDE.md) — Publishing releases
- [Code Signing](docs/developer/PRODUCTION-SIGNING-SETUP.md) — Sign installers

---

## Development

### Prerequisites

- **Node.js** 18+
- **Rust** (latest stable)
- **Python** 3.10+

### Setup

```bash
# Clone repository
git clone https://github.com/PolycarpusTack/hadron_v3.git
cd hadron_v3/hadron-desktop

# Install dependencies
npm install
cd python && pip install -r requirements.txt && cd ..

# Run in development mode
npm run tauri dev
```

### Build

```bash
# Build for production
npm run tauri build

# Output location:
# Windows: src-tauri/target/release/bundle/msi/
# macOS: src-tauri/target/release/bundle/dmg/
# Linux: src-tauri/target/release/bundle/deb/
```

---

## Technology Stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **Backend**: Tauri 2 (Rust)
- **AI Providers**: OpenAI, Anthropic, Z.ai, llama.cpp (local)
- **Database**: SQLite with FTS5 full-text search
- **Knowledge Base**: OpenSearch (optional)
- **Integrations**: JIRA REST API, Sentry API
- **Build Tool**: Vite

---

## License

**Proprietary** — MediaGeniX / Hadron Project

Copyright © 2025 MediaGeniX. All rights reserved.

---

## Acknowledgments

Built with [Tauri](https://tauri.app), [React](https://react.dev), [OpenAI](https://openai.com), [Anthropic](https://anthropic.com), [Z.ai](https://z.ai), [llama.cpp](https://github.com/ggerganov/llama.cpp), and [SQLite](https://sqlite.org).

---

<div align="center">

Built by the Hadron Team

</div>
