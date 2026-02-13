# Getting Started with Hadron

Welcome to Hadron — your AI-powered support assistant for WHATS'ON crash analysis, JIRA integration, Sentry monitoring, and release notes generation.

**Version**: 4.0.1 | **Estimated setup time**: 10 minutes

---

## What You'll Learn

By the end of this tutorial, you'll be able to:
- Set up Hadron with your AI provider
- Analyze your first crash log
- Use Ask Hadron (the AI chatbot)
- Connect JIRA and Sentry integrations
- Export and share reports

---

## Module 1: First Launch & Setup

### Step 1.1: Launch Hadron

When you first open Hadron, a splash screen appears, then the main interface with the Crash Analyzer panel.

### Step 1.2: Configure Your AI Provider

1. **Click the Settings icon** (gear) in the top right corner, or press `Ctrl+,`
2. **Select a provider** and enter your API key:

| Provider | Key Source | Cost Model |
|----------|-----------|------------|
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | Per-token pricing |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) | Per-token pricing |
| **Z.ai** | [z.ai](https://z.ai) | Flat-rate ($3/month) |
| **llama.cpp (Local)** | No key needed | Free |

3. **Click "Save Settings"**

> **Tip:** For llama.cpp, start the server first:
> ```bash
> llama-server -m model.gguf --host 127.0.0.1 --port 8080
> ```

> **Checkpoint:** You should see the provider status indicator in the footer bar.

---

## Module 2: Your First Analysis

### Step 2.1: Load a Crash Log

**Option A: Choose File**
1. Click **Choose File**
2. Select one or more crash log files (`.log`, `.txt`, `.crash`, or any text file)
3. Click **Open**

**Option B: Paste Log Text**
1. Click **Paste Log Text**
2. Paste the crash log content
3. Click **Analyze**

### Step 2.2: Choose Analysis Type

| Quick Analysis | Comprehensive (WHATS'ON) |
|----------------|--------------------------|
| Fast (5-10 seconds) | Full scan (30-60 seconds) |
| Crash focus only | 10-part structured report |
| Root cause + fix | Impact, test scenarios, reproduction steps |

**For your first analysis, try "Quick Analysis"** — it's faster and focuses on the crash and fix.

### Step 2.3: Understanding Results

When analysis completes, you'll see:
- **Summary** — One-paragraph explanation of what crashed and why
- **Root Cause** — The underlying technical reason
- **Suggested Fix** — Code changes or steps to resolve the issue
- **Severity** — Critical, High, Medium, or Low
- **Component** — Which part of the application was affected

From results, you can:
- **Export** in Markdown, HTML, or JSON
- **Create JIRA Ticket** directly from the analysis
- **Add Tags** for organization
- **Re-analyze** with a different provider or analysis type

> **Checkpoint:** You've successfully analyzed your first crash log!

---

## Module 3: Ask Hadron (AI Chatbot)

Click the **Ask Hadron** tab in the sidebar to open the AI assistant.

### What It Can Do

Ask Hadron is an **agentic chatbot** with access to 15 tools. It can:
- Search your crash analysis history
- Search JIRA for related issues
- Query the WHATS'ON knowledge base
- Find similar crashes by signature
- Get crash trends and statistics
- Create JIRA tickets
- Compare crashes side-by-side

### How to Use It

1. Type a question or select a **starter prompt**:
   - "What are the most common crashes this week?"
   - "Find crashes related to database timeouts"
   - "What components have the most issues?"
2. Watch the **tool activity** panel to see which tools the agent invokes
3. **Rate responses** with thumbs up/down — this improves future search results

### Contextual Mode

If you have a crash analysis selected, contextual starters appear:
- "Explain this crash in simple terms"
- "Find similar crashes to this one"
- "What JIRA tickets relate to this crash?"
- "Suggest a fix for this issue"

---

## Module 4: Using History

Press `Ctrl+H` or click the **History** tab to see past analyses.

- **Search**: Type keywords like "null" or "database" (powered by SQLite FTS5 with BM25 ranking)
- **Filter by Severity**: Show only Critical or High issues
- **Filter by Date**: Focus on recent crashes
- **Tags**: Organize analyses with custom tags (`production`, `investigated`, `wontfix`)
- **Notes**: Add your own findings to any analysis

---

## Module 5: Integrations

### JIRA

1. Go to **Settings** > **JIRA Integration**
2. Enter your JIRA base URL (include `https://`), email, and API token
3. Click **Test Connection**
4. Once connected:
   - Create tickets directly from crash analyses
   - Ask Hadron can search and create JIRA issues
   - Link crash analyses to JIRA tickets

### Sentry

1. Go to **Settings** > **Sentry Integration**
2. Enter your Sentry base URL, auth token (needs `project:read`, `event:read`), org slug, and project slug
3. Click **Test Connection**
4. Switch to the **Sentry Analyzer** tab to:
   - Browse production errors with filtering and pagination
   - View event details and stack traces
   - Run AI analysis on Sentry issues
   - Detect patterns: Deadlocks, N+1 Queries, Memory Leaks, Unhandled Promises

### Release Notes

1. Ensure JIRA is configured (release notes pull from JIRA fix versions)
2. Click the **Release Notes** tab in the sidebar
3. Select a JIRA fix version and click **Generate**
4. Review, edit, and publish through the lifecycle: Draft -> In Review -> Approved -> Published

---

## Module 6: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New analysis |
| `Ctrl+H` | Open History |
| `Ctrl+,` | Open Settings |
| `Ctrl+Y` | Open Console Viewer |
| `Esc` | Close current panel/modal |

---

## Module 7: Tips for Power Users

### Batch Analysis
Select multiple files at once — Hadron processes them sequentially.

### Tags & Notes
Organize analyses with tags and add your own investigation notes.

### Feedback Loop
Rate Ask Hadron responses and crash analyses. Positive ratings boost search ranking; negative ratings suppress irrelevant results.

### Console Viewer
Press `Ctrl+Y` to see API requests, parsing progress, error details, and token usage.

---

## Getting Help

| Problem | Solution |
|---------|----------|
| Feature not working | Check the **Help & Troubleshooting** guide |
| Bug in Hadron | Check Console (`Ctrl+Y`) for error details |
| General questions | Ask Hadron — it can search the knowledge base |
