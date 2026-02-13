# Hadron Desktop — User Guide

**Version**: 4.0.1 | **Last Updated**: 2026-02-13

Complete guide to using Hadron Desktop for crash analysis, AI-assisted support, and team collaboration.

---

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [First-Time Setup](#first-time-setup)
4. [Analyzing Crash Logs](#analyzing-crash-logs)
5. [Ask Hadron (AI Chatbot)](#ask-hadron-ai-chatbot)
6. [Search & History](#search--history)
7. [JIRA Integration](#jira-integration)
8. [Sentry Integration](#sentry-integration)
9. [Release Notes](#release-notes)
10. [Settings & Preferences](#settings--preferences)
11. [Keyboard Shortcuts](#keyboard-shortcuts)

---

## Overview

Hadron Desktop is an **AI-powered support assistant** for the WHATS'ON broadcast management system. It helps developers and support engineers:

- **Analyze crash logs** — AI explains root causes and suggests fixes
- **Ask questions** — Agentic chatbot with access to your crash history, JIRA, and knowledge base
- **Monitor production** — Browse and analyze Sentry issues with pattern detection
- **Generate release notes** — AI-powered release notes from JIRA fix versions
- **Track patterns** — Crash signatures, deduplication, and trend analysis

### Key Features

- **Multi-provider AI**: OpenAI, Anthropic Claude, Z.ai, or llama.cpp (local/offline)
- **Agentic chatbot**: 15 tools including search, JIRA, knowledge base, and crash analysis
- **Full-text search**: SQLite FTS5 with BM25 relevance ranking
- **Feedback loop**: Rate responses to improve future search results
- **Encrypted storage**: API keys secured with OS-level encryption
- **Export**: Share analyses as Markdown, HTML, or JSON

---

## Installation

### Download

Get the installer for your platform from the releases page.

| Platform | Package |
|----------|---------|
| **Windows** | `hadron-desktop_4.0.1_x64_en-US.msi` |
| **macOS (Intel)** | `hadron-desktop_4.0.1_x64.dmg` |
| **macOS (Apple Silicon)** | `hadron-desktop_4.0.1_aarch64.dmg` |
| **Linux (Debian/Ubuntu)** | `hadron-desktop_4.0.1_amd64.deb` |
| **Linux (AppImage)** | `hadron-desktop_4.0.1_amd64.AppImage` |

### Install

**Windows**: Double-click the `.msi` installer, follow the wizard, launch from Start Menu.

**macOS**: Open the `.dmg`, drag Hadron to Applications. First launch: right-click > Open (to bypass Gatekeeper).

**Linux (Debian/Ubuntu)**:
```bash
sudo dpkg -i hadron-desktop_4.0.1_amd64.deb
```

**Linux (AppImage)**:
```bash
chmod +x hadron-desktop_4.0.1_amd64.AppImage
./hadron-desktop_4.0.1_amd64.AppImage
```

---

## First-Time Setup

### Step 1: Choose AI Provider

Open **Settings** (`Ctrl+,`) and select your AI provider:

| Provider | Cost | Best For |
|----------|------|----------|
| **OpenAI** | ~$0.01-0.03/analysis | General use, reliable |
| **Anthropic** | ~$0.003-0.015/analysis | Large logs, strong reasoning |
| **Z.ai** | $3/month (unlimited) | Heavy daily use |
| **llama.cpp** | Free (runs locally) | Offline use, privacy |

### Step 2: Add API Key

- **OpenAI**: Get key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **Anthropic**: Get key at [console.anthropic.com](https://console.anthropic.com)
- **Z.ai**: Get key at [z.ai](https://z.ai)
- **llama.cpp**: No key needed — start the server: `llama-server -m model.gguf --host 127.0.0.1 --port 8080`

Paste your API key and click **Save Settings**. Keys are encrypted using OS-level storage (macOS Keychain / Windows Credential Manager / Linux Secret Service).

---

## Analyzing Crash Logs

### Supported File Types

Any text file containing error messages or stack traces: `.log`, `.txt`, `.crash`, etc.

### How to Analyze

**Method 1: Choose File** — Click **Choose File**, select one or more crash logs.

**Method 2: Paste Log Text** — Click **Paste Log Text**, paste content, click **Analyze**.

### Analysis Types

| | Quick Analysis | Comprehensive (WHATS'ON) |
|-|----------------|--------------------------|
| **Speed** | 5-10 seconds | 30-60 seconds |
| **Focus** | Root cause + fix | Full 10-part structured report |
| **Includes** | Summary, severity, fix | Impact analysis, test scenarios, reproduction steps |

### Understanding Results

Each analysis includes:
- **Summary** — What went wrong in plain English
- **Root Cause** — Technical explanation of the failure
- **Suggested Fix** — Code changes or steps to resolve
- **Severity** — Critical, High, Medium, or Low
- **Component** — Which application module was affected

### Actions on Results

- **Export** — Markdown, HTML, or JSON
- **Create JIRA Ticket** — Pre-filled ticket from the analysis
- **Add Tags** — Organize with custom labels
- **Add Notes** — Record your investigation findings
- **Re-analyze** — Try a different provider or analysis type

---

## Ask Hadron (AI Chatbot)

Click the **Ask Hadron** tab in the sidebar.

### What It Can Do

Ask Hadron is an **agentic AI assistant** with access to 15 tools:

| Category | Tools |
|----------|-------|
| **Search** | Search crash analyses, knowledge base, JIRA issues |
| **Analysis** | Get analysis details, find similar crashes, compare crashes |
| **Patterns** | Get crash signatures, top signatures, error patterns |
| **Trends** | Get trend data, statistics, component health |
| **Actions** | Create JIRA tickets, correlate crashes to JIRA |

### How to Use

1. Type a question or select a starter prompt
2. Watch the tool activity panel to see the agent's reasoning
3. Rate responses with thumbs up/down

### Example Questions

- "What are the most common crashes this week?"
- "Find crashes related to database timeouts"
- "What JIRA tickets are linked to NullReferenceException crashes?"
- "Compare crash #42 with crash #57"
- "How is the OrderProcessor component doing?"

### Chat Sessions

Conversations are saved automatically. Click **New Chat** to start fresh, or browse previous sessions in the sidebar.

---

## Search & History

Press `Ctrl+H` to open History.

### Search

Type in the search bar to find analyses by:
- File name, error message, class name, method name
- Any text in the analysis content

Search is powered by SQLite FTS5 with BM25 relevance ranking.

### Filters

- **Severity**: Critical, High, Medium, Low
- **Date Range**: Last 7 days, 30 days, all time
- **Tags**: Filter by custom tags
- **Provider**: OpenAI, Anthropic, Z.ai, llama.cpp

### Tags & Notes

- Click the **tag icon** on any analysis to add tags (`production`, `investigated`, `wontfix`)
- Click **Add Notes** to record findings, decisions, or follow-ups

---

## JIRA Integration

### Setup

1. Settings > JIRA Integration
2. Enter:
   - **Base URL**: `https://yourcompany.atlassian.net` (must include `https://`)
   - **Email**: Your Atlassian account email
   - **API Token**: Generate at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens)
   - **Project Key** (optional): Default project (e.g., `PSI`)
3. Click **Test Connection**

### Usage

- **From crash analysis**: Click **Create JIRA Ticket** to create a pre-filled ticket
- **From Ask Hadron**: Ask "search JIRA for timeout issues" or "create a JIRA ticket for this crash"
- **Linked tickets**: Crash analyses show linked JIRA tickets

---

## Sentry Integration

### Setup

1. Settings > Sentry Integration
2. Enter:
   - **Base URL**: `https://sentry.io` (or your self-hosted URL)
   - **Auth Token**: Generate at Sentry > Settings > Auth Tokens (needs `project:read`, `event:read`)
   - **Organization**: Your org slug
   - **Project**: Your project slug
3. Click **Test Connection**

### Usage

Click the **Sentry Analyzer** tab to:
- Browse production errors with search, filtering, and pagination
- View event details, stack traces, and breadcrumbs
- Run AI analysis on individual Sentry issues
- View detected patterns:

| Pattern | What It Detects |
|---------|----------------|
| **Deadlock** | Lock timeouts, deadlock keywords |
| **N+1 Query** | Repeated database query patterns |
| **Memory Leak** | Out-of-memory, heap exhaustion |
| **Unhandled Promise** | Unhandled rejections in async code |

---

## Release Notes

### Prerequisites

JIRA must be configured (release notes pull from JIRA fix versions).

### How to Generate

1. Click the **Release Notes** tab in the sidebar
2. In the **Generate** sub-tab, select a JIRA fix version
3. Click **Generate** — AI creates draft release notes from the tickets
4. Switch to the **Review** sub-tab to edit and refine

### Lifecycle

```
Draft -> In Review -> Approved -> Published
```

You can also discard drafts or archive published notes.

---

## Settings & Preferences

### AI Provider

- Switch providers anytime in Settings
- Each provider has recommended models
- llama.cpp runs locally with no API key

### Theme

Toggle dark/light mode in the top-right corner.

### Database Administration

- **Verify Database** — Check for schema issues
- **Repair Database** — Fix corrupted data
- **Cleanup Old Records** — Remove old analyses

### Security

- API keys are encrypted using OS-level storage
- Keys are cleared from memory after use (`zeroize` crate)
- Keys are never written to log files or transmitted to third parties

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| New Analysis | `Ctrl+N` |
| Open History | `Ctrl+H` |
| Open Settings | `Ctrl+,` |
| Open Console | `Ctrl+Y` |
| Close Panel | `Esc` |

---

## Troubleshooting

For detailed troubleshooting, see the **Help & Troubleshooting** guide in the Documentation viewer (`Ctrl+,` > Help icon).

### Quick Fixes

| Problem | Solution |
|---------|----------|
| "All AI providers failed" | Re-enter API key in Settings |
| Empty analysis results | Retry; check Console (`Ctrl+Y`) |
| JIRA connection failed | Verify URL has `https://`, check token |
| Sentry access denied | Token needs `project:read`, `event:read` scopes |
| Slow performance | Cleanup old records, use Quick Analysis |
| History empty | Settings > Database Administration > Verify/Repair |

### Console Viewer

Press `Ctrl+Y` for detailed logs: API requests, parsing progress, error details, token usage.
