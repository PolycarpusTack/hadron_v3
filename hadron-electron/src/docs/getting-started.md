# Getting Started with Hadron

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

1. **Click the Settings icon** (gear) in the top right corner, or press `Ctrl+,`
2. **Select a provider** and enter your API key:

| Provider | Key Source | Cost |
|----------|-----------|------|
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | Per-token |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) | Per-token |
| **Z.ai** | [z.ai](https://z.ai) | Flat-rate |
| **llama.cpp** | No key needed | Free (local) |

3. **Click "Save Settings"**

> **Tip:** For llama.cpp, start the server first: `llama-server -m model.gguf --host 127.0.0.1 --port 8080`

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
| `Ctrl+N` | New analysis |
| `Ctrl+H` | Open History |
| `Ctrl+,` | Open Settings |
| `Ctrl+Y` | Open Console |
| `Alt+H` | Toggle Widget |
| `Esc` | Close panel |
