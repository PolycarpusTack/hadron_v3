# Hadron Developer Guide

> **"Building software is like building a house. This guide shows you where all the rooms are and what happens inside each one."**

## What is Hadron?

Hadron is a **Smalltalk crash log analyzer** - think of it as a detective that reads cryptic crash reports and tells you what went wrong in plain English.

```
┌─────────────────────────────────────────────────────────────────┐
│                         HADRON                                  │
│                                                                 │
│   Crash Log  ──────►  Parsing  ──────►  AI Analysis  ──────►   │
│   (Mystery)           (Clues)           (Solution)              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Architecture Overview

Hadron uses a **hybrid architecture** with three main layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React + TypeScript)                   │
│    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │
│    │  Views   │  │Components│  │ Services │  │    State (Hooks) │    │
│    └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘    │
│         │             │             │                  │              │
└─────────┼─────────────┼─────────────┼──────────────────┼──────────────┘
          │             │             │                  │
          └─────────────┴──────┬──────┴──────────────────┘
                               │
                    ┌──────────▼───────────┐
                    │   Tauri IPC Bridge   │
                    └──────────┬───────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────────────┐
│                        BACKEND (Rust)                                   │
│    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐     │
│    │ Commands │  │  Parser  │  │ AI Svc   │  │    Database      │     │
│    └──────────┘  └──────────┘  └──────────┘  └──────────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                    ┌──────────▼───────────┐
                    │   Python Scripts     │
                    │   (Translation/RAG)  │
                    └──────────────────────┘
```

### The Three Layers Explained

| Layer | Technology | Job |
|-------|------------|-----|
| **Frontend** | React + TypeScript | Shows the UI, handles user interactions |
| **Backend** | Rust + Tauri | Does the heavy lifting - parsing, AI calls, database |
| **Scripts** | Python | Specialized AI tasks (translation, RAG retrieval) |

---

## Directory Structure

```
hadron-desktop/
├── src/                    # Frontend (React)
│   ├── components/         # UI components (50+ files)
│   ├── hooks/              # React hooks for state management
│   ├── services/           # API calls, caching, integrations
│   ├── utils/              # Helper functions
│   ├── types/              # TypeScript type definitions
│   ├── App.tsx             # Main application component
│   └── main.tsx            # Entry point
│
├── src-tauri/              # Backend (Rust)
│   ├── src/
│   │   ├── main.rs         # Application entry point
│   │   ├── commands.rs     # Tauri command handlers (frontend → backend)
│   │   ├── ai_service.rs   # AI provider integration
│   │   ├── database.rs     # SQLite operations
│   │   ├── parser/         # Crash log parsing engine
│   │   ├── patterns/       # Pattern matching system
│   │   └── export/         # Report generation
│   ├── data/patterns/      # TOML pattern definitions
│   └── Cargo.toml          # Rust dependencies
│
├── python/                 # Python scripts
│   ├── translate.py        # AI translation service
│   └── rag/                # RAG (Retrieval Augmented Generation)
│       ├── cli.py          # RAG command-line interface
│       └── ...             # Vector store, embeddings
│
├── docs/                   # Documentation
└── tests/                  # Test suites
```

---

## Data Flow: From Crash Log to Analysis

Here's how a crash log becomes a helpful analysis:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 1: USER DROPS FILE                                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   User  ──►  FileDropZone.tsx  ──►  App.tsx (handleFileUpload)         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 2: PARSE THE CRASH LOG (Rust)                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   commands.rs::parse_crash_file()                                       │
│        │                                                                │
│        ├──► parser/crash_file.rs    (Read and structure the file)      │
│        ├──► parser/sections/*.rs    (Extract each section)             │
│        │       ├── header.rs        (Version, timestamp)               │
│        │       ├── exception.rs     (Error message, type)              │
│        │       ├── stack_trace.rs   (Call stack)                       │
│        │       ├── memory.rs        (Memory state)                     │
│        │       ├── database.rs      (DB connections)                   │
│        │       └── context.rs       (Environment info)                 │
│        │                                                                │
│        └──► patterns/engine.rs      (Match known patterns)             │
│                                                                         │
│   Output: ParsedCrashReport struct                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 3: AI ANALYSIS (Rust + External API)                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   commands.rs::analyze_crash()                                          │
│        │                                                                │
│        ├──► ai_service.rs::analyze()                                   │
│        │       ├── Build prompt with crash context                     │
│        │       ├── Call AI provider (OpenAI/Anthropic/Ollama)          │
│        │       └── Parse structured JSON response                       │
│        │                                                                │
│        └──► (Optional) RAG context enhancement                          │
│             rag_commands.rs::rag_build_context_internal()              │
│                                                                         │
│   Output: AnalysisResult (summary, root cause, fix suggestions)        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 4: STORE & DISPLAY                                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   database.rs::save_analysis()   ──►  SQLite (analysis.db)             │
│        │                                                                │
│        └──►  Frontend receives result via IPC                          │
│             └──►  AnalysisResults.tsx / WhatsOnDetailView.tsx          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Key Modules Explained

### Frontend Components (React)

| Component | Purpose |
|-----------|---------|
| `App.tsx` | Main orchestrator - manages global state, routing, file handling |
| `FileDropZone.tsx` | Drag-and-drop file upload interface |
| `AnalysisResults.tsx` | Displays Quick Analysis results |
| `WhatsOnDetailView.tsx` | Displays Comprehensive (WHATS'ON) analysis |
| `HistoryView.tsx` | Shows past analyses with filtering |
| `SettingsPanel.tsx` | API key configuration, preferences |
| `DashboardPanel.tsx` | Statistics and trends visualization |

### Backend Modules (Rust)

| Module | Purpose |
|--------|---------|
| `commands.rs` | All Tauri commands (frontend entry points) |
| `ai_service.rs` | Multi-provider AI integration (OpenAI, Anthropic, Ollama) |
| `database.rs` | SQLite CRUD operations |
| `parser/*.rs` | Crash log parsing engine |
| `patterns/*.rs` | Known error pattern matching |
| `export/*.rs` | Report generation (Markdown, HTML, JSON) |
| `signature.rs` | Crash signature calculation for deduplication |

### Services (TypeScript)

| Service | Purpose |
|---------|---------|
| `api.ts` | Tauri command invocation wrappers |
| `jira.ts` | JIRA integration for ticket creation |
| `keeper.ts` | Keeper Secrets Manager integration |
| `cache.ts` | In-memory caching for performance |
| `circuit-breaker.ts` | Resilience patterns for API calls |

---

## Analysis Types

Hadron supports two analysis types:

### Quick Analysis
```
┌────────────────────────────────────────┐
│         QUICK ANALYSIS                 │
├────────────────────────────────────────┤
│ • Fast (5-10 seconds)                  │
│ • Basic summary                        │
│ • Root cause identification            │
│ • Suggested fix                        │
│ • Good for: Triage, quick checks       │
└────────────────────────────────────────┘
```

### Comprehensive (WHATS'ON) Analysis
```
┌────────────────────────────────────────┐
│         WHATS'ON ANALYSIS              │
├────────────────────────────────────────┤
│ • Full scan (30-60 seconds)            │
│ • User scenario reconstruction         │
│ • Impact analysis                      │
│ • Multiple fix suggestions             │
│ • Test scenarios                       │
│ • Reproduction steps                   │
│ • Good for: Deep investigation         │
└────────────────────────────────────────┘
```

Notes:
- Comprehensive is enforced as a full scan (Deep Scan) for full-file coverage.
- Quick avoids deep scan and focuses on crash + root cause + fix.

---

## Development Setup

### Prerequisites

```bash
# Required tools
- Node.js 18+
- Rust 1.70+
- Python 3.10+ (for translation/RAG)
```

### Quick Start

```bash
# 1. Clone and enter the directory
cd hadron-desktop

# 2. Install frontend dependencies
npm install

# 3. Install Python dependencies (optional, for translation)
pip install -r python/requirements.txt

# 4. Run in development mode
npm run tauri dev
```

### Build for Production

```bash
# Build the application
npm run tauri build

# Output locations:
# - Windows: src-tauri/target/release/bundle/msi/*.msi
# - macOS: src-tauri/target/release/bundle/dmg/*.dmg
# - Linux: src-tauri/target/release/bundle/appimage/*.AppImage
```

---

## Configuration

### API Keys (Settings Panel)

| Provider | Models | Required For |
|----------|--------|--------------|
| OpenAI | gpt-4o, gpt-4-turbo | Quick/Comprehensive Analysis |
| Anthropic | claude-3-opus | Alternative provider |
| Ollama | llama3, mistral | Local/offline analysis |

### Database Location

```
Windows: %APPDATA%/com.hadron.desktop/analysis.db
macOS:   ~/Library/Application Support/com.hadron.desktop/analysis.db
Linux:   ~/.local/share/com.hadron.desktop/analysis.db
```

---

## Adding New Features

### Adding a New Tauri Command

1. **Define the command in Rust** (`src-tauri/src/commands.rs`):
```rust
#[tauri::command]
pub async fn my_new_command(input: String) -> Result<String, String> {
    // Implementation
    Ok("result".to_string())
}
```

2. **Register in main.rs**:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    commands::my_new_command,
])
```

3. **Call from Frontend** (`src/services/api.ts`):
```typescript
export async function myNewCommand(input: string): Promise<string> {
  return invoke<string>('my_new_command', { input });
}
```

### Adding a New React Component

1. Create the component in `src/components/`:
```typescript
// src/components/MyComponent.tsx
interface MyComponentProps {
  data: SomeType;
}

export function MyComponent({ data }: MyComponentProps) {
  return <div>{/* ... */}</div>;
}
```

2. Import and use in parent component (usually `App.tsx` or a view component).

---

## Testing

```bash
# Run unit tests (frontend)
npm run test

# Run E2E tests (Playwright)
npm run test:e2e

# Run Rust tests
cd src-tauri && cargo test
```

---

## Troubleshooting Development Issues

| Issue | Solution |
|-------|----------|
| `cargo build` fails | Run `rustup update` |
| TypeScript errors | Run `npm install` then restart IDE |
| Tauri commands not found | Check `main.rs` handler registration |
| Python script not found | Ensure you're running from project root |

---

## Code Style Guidelines

- **Rust**: Follow `rustfmt` conventions, use `cargo clippy` for lints
- **TypeScript**: Use explicit types, avoid `any`
- **React**: Functional components with hooks, avoid class components
- **Comments**: Document "why", not "what" - code should be self-explanatory

---

## Further Reading

- [Tauri Documentation](https://tauri.app/v2/guides/)
- [React Documentation](https://react.dev/)
- [Rust Book](https://doc.rust-lang.org/book/)
- [Project ROADMAP](../CONSOLIDATED-ROADMAP.md)
- [User Guide](./user/USER-GUIDE.md)
