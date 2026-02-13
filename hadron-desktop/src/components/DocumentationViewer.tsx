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

Welcome to Hadron - your AI-powered Smalltalk crash log analyzer! This tutorial will walk you through everything you need to know to become productive with Hadron.

---

## What You'll Learn

By the end of this tutorial, you'll be able to:
- Set up Hadron with your API key
- Analyze your first crash log
- Understand analysis results
- Use the History feature
- Export and share reports

**Estimated time: 15 minutes**

---

## Module 1: First Launch & Setup

### Step 1.1: Launch Hadron

When you first open Hadron, you'll see the main interface with a drop zone for crash files.

### Step 1.2: Configure Your API Key

Before analyzing crashes, you need to set up an AI provider:

1. **Click the Settings icon** (gear) in the top right corner, or press \`Ctrl+,\`
2. **Enter your API key:**
   - For OpenAI: Get yours at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   - For Anthropic: Get yours at [console.anthropic.com](https://console.anthropic.com/settings/keys)
   - For llama.cpp (local/free): No key needed, just start llama-server
3. **Click "Save Settings"**

> **Checkpoint:** You should see a green "API Key Set" indicator in the footer.

---

## Module 2: Your First Analysis

### Step 2.1: Load a Crash Log

Use one of the two inputs in the Crash Analyzer panel:

**Option A: Choose File**
1. Click **Choose File**
2. Navigate to your crash log
3. Select one or more files and click **Open**

**Option B: Paste Log Text**
1. Click **Paste Log Text**
2. Paste the crash log content
3. Click **Analyze Pasted Log**

### Step 2.2: Choose Analysis Type

Pick the analysis type before starting:

| Quick Analysis | Comprehensive (WHATS'ON) |
|----------------|--------------------------|
| Fast (5-10s) | Full scan (30-60s) |
| Crash focus | Full context |
| Root cause + fix | Test scenarios |

**For your first analysis, try "Quick Analysis"** - it's faster and focuses on the crash and fix.

### Step 2.3: Understanding Results

When analysis completes, you'll see:
- **Summary**: One-paragraph explanation of what crashed and why
- **Root Cause**: The underlying technical reason for the crash
- **Suggested Fix**: Code changes or steps to resolve the issue

---

## Module 3: Using History

Press \`Ctrl+H\` or click the **History** tab to see past analyses.

- **Search**: Type keywords like "null" or "database"
- **Filter by Severity**: Show only Critical or High issues
- **Filter by Date**: Focus on recent crashes

---

## Module 4: Keyboard Shortcuts

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
- Press \`Ctrl+Y\` to open the Console for debugging
- Report issues at [GitHub Issues](https://github.com/hadron-team/hadron-desktop/issues)

Happy crash hunting!
`,

  help: `# Hadron Help & Troubleshooting Guide

This guide helps you solve common problems when using Hadron.

---

## Quick Reference: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| \`Ctrl+N\` | New analysis |
| \`Ctrl+H\` | Open History |
| \`Ctrl+,\` | Open Settings |
| \`Ctrl+Y\` | Open Console Viewer |
| \`Esc\` | Close current panel/modal |

---

## Issue 1: "All AI providers failed" Error

### Symptoms
- Error message: "All AI providers failed"
- Analysis button spins then shows error

### Solution Steps

**Step 1: Check API Key**
1. Press \`Ctrl+,\` to open Settings
2. Look at the "API Key" field
3. If empty, the key needs to be entered

**Step 2: Re-enter API Key**
1. Delete the current API key field content
2. Paste your API key from your provider dashboard:
   - OpenAI: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   - Anthropic: [console.anthropic.com](https://console.anthropic.com/settings/keys)
3. Click "Save Settings"

**Step 3: Select Valid Model**
1. In Settings, check the "Model" dropdown
2. Select a valid model (e.g., \`gpt-4o\`, \`claude-3-sonnet\`)
3. Save and retry

---

## Issue 2: Comprehensive (WHATS'ON) Analysis Shows Empty Data

### Symptoms
- Analysis completes but shows fallback/empty view
- Content is missing

### Solution Steps

1. **Wait for full completion** - ensure progress bar reaches 100%
2. **Check Console** (\`Ctrl+Y\`) for specific errors
3. **Retry analysis** - AI responses can vary

---

## Issue 3: "Python script not found in bundle"

### Symptoms
- Translation feature doesn't work
- Error about missing Python script

### Solution
- **Core features still work** - Parsing and Quick Analysis work without Python
- **Reinstall** if needed for Translation/RAG features

---

## Issue 4: Application Doesn't Start

### Solution Steps

1. **Check System Requirements**
   - Windows 10/11 (64-bit)
   - macOS 10.15+
   - 4GB RAM minimum

2. **Reset Configuration**
   - Close Hadron
   - Delete config folder:
     - Windows: \`%APPDATA%/com.hadron.desktop/\`
     - macOS: \`~/Library/Application Support/com.hadron.desktop/\`
   - Restart Hadron

---

## Issue 5: History Not Loading

### Solution Steps

1. Go to Settings > Database Administration
2. Click "Verify Database"
3. If errors found, click "Repair Database"

---

## Issue 6: JIRA Integration Not Working

### Solution Steps

1. **Verify JIRA Settings** in Settings > JIRA Integration:
   - **URL**: Include \`https://\` (e.g., \`https://yourcompany.atlassian.net\`)
   - **Email**: Your Atlassian account email
   - **API Token**: Generate at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens)

2. **Test Connection** button should show "Connection successful"

---

## Issue 7: Slow Performance

### Solution Steps

1. **Reduce History Size** - Use "Cleanup Old Records" in Settings
2. **Use Quick Analysis** for initial triage (crash-focused)
3. **Close other applications** if memory is low

---

## Getting More Help

### Console Viewer
Press \`Ctrl+Y\` to see detailed logs including:
- API requests and responses
- Parsing progress
- Error details

### Report a Bug
File issues at: [GitHub Issues](https://github.com/hadron-team/hadron-desktop/issues)

Include:
- Hadron version (shown in footer)
- Operating system
- Steps to reproduce
- Console logs if available
`,

  developer: `# Hadron Developer Guide

## What is Hadron?

Hadron is a **Smalltalk crash log analyzer** - a detective that reads cryptic crash reports and tells you what went wrong in plain English.

---

## Architecture Overview

Hadron uses a **hybrid architecture** with three main layers:

| Layer | Technology | Job |
|-------|------------|-----|
| **Frontend** | React + TypeScript | Shows the UI, handles user interactions |
| **Backend** | Rust + Tauri | Heavy lifting - parsing, AI calls, database |
| **Scripts** | Python | Specialized AI tasks (translation, RAG) |

---

## Directory Structure

\`\`\`
hadron-desktop/
├── src/                    # Frontend (React)
│   ├── components/         # UI components (50+ files)
│   ├── hooks/              # React hooks for state management
│   ├── services/           # API calls, caching, integrations
│   ├── utils/              # Helper functions
│   ├── types/              # TypeScript type definitions
│   └── App.tsx             # Main application component
│
├── src-tauri/              # Backend (Rust)
│   ├── src/
│   │   ├── main.rs         # Application entry point
│   │   ├── commands.rs     # Tauri command handlers
│   │   ├── ai_service.rs   # AI provider integration
│   │   ├── database.rs     # SQLite operations
│   │   ├── parser/         # Crash log parsing engine
│   │   └── patterns/       # Pattern matching system
│   └── data/patterns/      # TOML pattern definitions
│
├── python/                 # Python scripts
│   ├── translate.py        # AI translation service
│   └── rag/                # RAG retrieval system
│
└── docs/                   # Documentation
\`\`\`

---

## Key Modules

### Frontend Components (React)

| Component | Purpose |
|-----------|---------|
| \`App.tsx\` | Main orchestrator - global state, routing |
| \`FileDropZone.tsx\` | Drag-and-drop file upload |
| \`AnalysisResults.tsx\` | Displays Quick Analysis results |
| \`WhatsOnDetailView.tsx\` | Displays Comprehensive (WHATS'ON) analysis |
| \`HistoryView.tsx\` | Shows past analyses with filtering |
| \`SettingsPanel.tsx\` | API key configuration |

### Backend Modules (Rust)

| Module | Purpose |
|--------|---------|
| \`commands.rs\` | All Tauri commands (frontend entry points) |
| \`ai_service.rs\` | Multi-provider AI integration |
| \`database.rs\` | SQLite CRUD operations |
| \`parser/*.rs\` | Crash log parsing engine |
| \`patterns/*.rs\` | Known error pattern matching |

---

## Development Setup

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Python 3.10+ (optional, for translation/RAG)

### Quick Start

\`\`\`bash
# 1. Install frontend dependencies
npm install

# 2. Install Python dependencies (optional)
pip install -r python/requirements.txt

# 3. Run in development mode
npm run tauri dev
\`\`\`

### Build for Production

\`\`\`bash
npm run tauri build
\`\`\`

---

## Adding New Features

### Adding a New Tauri Command

1. **Define in Rust** (\`src-tauri/src/commands.rs\`):
\`\`\`rust
#[tauri::command]
pub async fn my_command(input: String) -> Result<String, String> {
    Ok("result".to_string())
}
\`\`\`

2. **Register in main.rs**
3. **Call from Frontend** (\`src/services/api.ts\`)

### Adding a React Component

1. Create in \`src/components/\`
2. Import and use in parent component

---

## Testing

\`\`\`bash
# Frontend tests
npm run test

# E2E tests
npm run test:e2e

# Rust tests
cd src-tauri && cargo test
\`\`\`

---

## Code Style

- **Rust**: Follow \`rustfmt\`, use \`cargo clippy\`
- **TypeScript**: Use explicit types, avoid \`any\`
- **React**: Functional components with hooks
- **Comments**: Document "why", not "what"

---

## Further Reading

- [Tauri Documentation](https://tauri.app/v2/guides/)
- [React Documentation](https://react.dev/)
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
