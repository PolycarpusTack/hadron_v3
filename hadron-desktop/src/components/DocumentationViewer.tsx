import { useState, useEffect } from "react";
import { X, BookOpen, Code, HelpCircle, GraduationCap, ChevronRight, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Documentation content types
type DocType = "getting-started" | "help" | "developer";

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
    description: "Tutorial for new users - learn Hadron step by step",
  },
  {
    id: "help",
    title: "Help & Troubleshooting",
    icon: <HelpCircle className="w-5 h-5" />,
    description: "Solve common problems and find answers",
  },
  {
    id: "developer",
    title: "Developer Guide",
    icon: <Code className="w-5 h-5" />,
    description: "Architecture, codebase structure, and contribution guide",
  },
];

// Documentation content - embedded for reliability
const DOCS: Record<DocType, string> = {
  "getting-started": `# Getting Started with Hadron

Welcome to Hadron — your AI-powered support assistant for WHATS'ON crash analysis, JIRA integration, Sentry monitoring, and release notes generation.

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

From results, you can: **Export** (Markdown/HTML/JSON), **Create JIRA Ticket**, **Add Tags**, or **Re-analyze**.

---

## Module 3: Ask Hadron (AI Chatbot)

Click the **Ask Hadron** tab in the sidebar to open the AI assistant.

- Type questions like "What are the most common crashes this week?"
- The agent has access to **15 tools**: search analyses, search JIRA, search the knowledge base, find similar crashes, get trends, and more
- Watch the **tool activity** panel to see what the agent is doing
- **Rate responses** with thumbs up/down to improve future results

---

## Module 4: Integrations

### JIRA
Configure in Settings > JIRA Integration. Once connected, you can create tickets directly from crash analyses and the chatbot can search/create JIRA issues.

### Sentry
Configure in Settings > Sentry Integration. The **Sentry Analyzer** tab lets you browse production errors, view event details, and run AI analysis on Sentry issues. Detects patterns: Deadlocks, N+1 Queries, Memory Leaks, Unhandled Promises.

### Release Notes
The **Release Notes** tab generates AI-powered release notes from JIRA fix versions. Lifecycle: Draft -> In Review -> Approved -> Published.

---

## Module 5: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| \`Ctrl+N\` | New analysis |
| \`Ctrl+H\` | Open History |
| \`Ctrl+,\` | Open Settings |
| \`Ctrl+Y\` | Open Console |
| \`Esc\` | Close panel |

---

## Getting Help

- Check the **Help & Troubleshooting** guide for common issues
- Press \`Ctrl+Y\` to open the Console Viewer for debugging
`,

  help: `# Hadron Help & Troubleshooting Guide

Quick solutions to common problems in Hadron 4.0.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| \`Ctrl+N\` | New analysis |
| \`Ctrl+H\` | Open History |
| \`Ctrl+,\` | Open Settings |
| \`Ctrl+Y\` | Open Console Viewer |
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

## Ask Hadron Not Responding

1. Ensure an AI provider is configured and working (test with a crash analysis first)
2. Check Console (\`Ctrl+Y\`) for error details
3. The agent runs up to 8 tool-calling iterations — complex queries take longer
4. If stuck, start a **New Chat** and rephrase the question

---

## Slow Performance

1. **Reduce History Size** — Settings > Cleanup Old Records
2. **Use Quick Analysis** for initial triage
3. Large crash logs (>1MB) are automatically truncated

---

## Console Viewer

Press \`Ctrl+Y\` to see detailed logs:
- API requests and responses
- Parsing progress and errors
- AI token usage and cost estimates
- Tool execution details (Ask Hadron)

---

## Database & Log Locations

| Data | Windows | macOS | Linux |
|------|---------|-------|-------|
| Database | \`%APPDATA%/com.hadron.desktop/analysis.db\` | \`~/Library/Application Support/com.hadron.desktop/analysis.db\` | \`~/.local/share/com.hadron.desktop/analysis.db\` |
| Logs | \`%APPDATA%/com.hadron.desktop/logs/\` | \`~/Library/Logs/com.hadron.desktop/\` | \`~/.local/share/com.hadron.desktop/logs/\` |

---

## Export Formats

| Format | Use Case |
|--------|----------|
| **Markdown** | Documentation, wikis, GitHub issues |
| **HTML** | Browser viewing, email sharing |
| **JSON** | Integrations, automation |

---

## Report a Bug

Include: Hadron version (shown in footer), OS, steps to reproduce, and Console logs.
`,

  developer: `# Hadron Developer Guide

## What is Hadron?

Hadron is an **AI-powered support assistant** for the WHATS'ON broadcast management system. It analyzes crash logs, connects to JIRA and Sentry, provides an agentic AI chatbot, and generates release notes.

---

## Architecture

Hadron uses a **hybrid architecture** with three layers:

| Layer | Technology | Role |
|-------|------------|------|
| **Frontend** | React 18 + TypeScript | UI (61 components), state management, services |
| **Backend** | Rust + Tauri 2 | Parsing, AI calls, database, integrations |
| **Scripts** | Python 3.10+ | Translation, RAG, training (optional) |

Communication: Frontend <-> Backend via **Tauri IPC** (\`invoke()\`).

---

## Directory Structure

\`\`\`
hadron-desktop/
src/                        # Frontend (React + TypeScript)
  components/               # 61 UI components
  hooks/                    # React hooks
  services/                 # API wrappers, cache, circuit breaker
  types/                    # TypeScript type definitions
  App.tsx                   # Main orchestrator

src-tauri/src/              # Backend (Rust)
  main.rs                   # Entry point, command registration
  commands.rs               # Tauri commands (analysis, export, DB)
  chat_commands.rs          # Ask Hadron agentic loop
  chat_tools.rs             # 15 tool definitions + executors
  ai_service.rs             # Multi-provider AI (OpenAI, Anthropic, Z.ai, llama.cpp)
  database.rs               # SQLite CRUD (15+ tables)
  migrations.rs             # 10 schema migrations
  sentry_service.rs         # Sentry API + pattern detection
  jira_service.rs           # JIRA REST API v3
  release_notes_service.rs  # Release notes generation
  parser/                   # Crash log parsing engine
  patterns/                 # Pattern matching (TOML-driven)
  data/patterns/            # 4 TOML pattern files

python/                     # Optional Python modules
  api/                      # FastAPI server
  rag/                      # Chroma + embeddings
  offline/                  # llama.cpp integration
  training/                 # QLoRA fine-tuning
\`\`\`

---

## Key Backend Modules

| Module | Purpose |
|--------|---------|
| \`ai_service.rs\` | 4 AI providers with ProviderConfig abstraction (AuthStyle, ResponseStyle, CostCalculator) |
| \`chat_commands.rs\` | Agentic tool-calling loop (max 8 iterations per message) |
| \`chat_tools.rs\` | 15 tools: search_analyses, search_kb, search_jira, create_jira_ticket, find_similar_crashes, etc. |
| \`database.rs\` | SQLite with FTS5 (BM25 ranking), 10 migrations, 15+ tables |
| \`sentry_service.rs\` | Sentry issue fetching, event details, pattern detection (Deadlock, N+1, Memory Leak, Unhandled Promise) |
| \`jira_service.rs\` | JIRA search, ticket creation, fix version listing |
| \`release_notes_service.rs\` | AI-generated release notes with draft/review/approve/publish lifecycle |
| \`parser/\` | Extracts header, exception, stack trace, memory, database, context from crash logs |
| \`patterns/\` | TOML-driven pattern matching (null_errors, collection_errors, database_errors, whatson_specific) |

---

## Key Frontend Services

| Service | Purpose |
|---------|---------|
| \`api.ts\` | Tauri invoke wrappers for all backend commands |
| \`chat.ts\` | Ask Hadron chat session management |
| \`jira.ts\` | JIRA integration helpers |
| \`circuit-breaker.ts\` | Resilience: auto-failover after 3 consecutive failures |
| \`cache.ts\` | In-memory caching |

---

## Development Setup

**Prerequisites:** Node.js 18+, Rust stable, Python 3.10+ (optional)

\`\`\`bash
npm install                        # Frontend deps
pip install -r python/requirements.txt  # Optional Python deps
npm run tauri dev                  # Dev mode with hot reload
\`\`\`

**Build:** \`npm run tauri build\`

**Test:**
\`\`\`bash
npm run test          # Vitest unit tests
npm run test:e2e      # Playwright E2E tests
cd src-tauri && cargo test  # Rust tests
\`\`\`

---

## Adding a New Tauri Command

1. Define in Rust:
\`\`\`rust
#[tauri::command]
pub async fn my_command(input: String) -> Result<String, String> {
    Ok("result".to_string())
}
\`\`\`

2. Register in \`main.rs\` invoke handler
3. Call from frontend: \`invoke<string>('my_command', { input })\`

---

## Adding a Chat Tool (Ask Hadron)

1. Add tool definition to \`get_tool_definitions()\` in \`chat_tools.rs\`
2. Add executor match arm in \`execute_tool()\`
3. Add tool label in \`AskHadronView.tsx\` for the activity indicator

---

## Code Style

- **Rust**: \`rustfmt\` + \`cargo clippy\`
- **TypeScript**: Explicit types, avoid \`any\`, functional components with hooks
- **Comments**: Document "why", not "what"

---

## Further Reading

- [Tauri v2 Docs](https://tauri.app/v2/guides/)
- [React Docs](https://react.dev/)
- [Rust Book](https://doc.rust-lang.org/book/)
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

  if (!isOpen) return null;

  const handleSelectDoc = (docId: DocType) => {
    setSelectedDoc(docId);
    setShowSelector(false);
  };

  const handleBack = () => {
    setShowSelector(true);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
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
              <button
                onClick={handleBack}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
              >
                Back to Menu
              </button>
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
            <div className="p-6 space-y-4">
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Choose a guide to get help with Hadron:
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
              <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
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
          </p>
        </div>
      </div>
    </div>
  );
}
