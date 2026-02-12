# Hadron

**AI-Powered Smalltalk Crash Analyzer**

Hadron is a desktop application that uses AI to analyze VisualWorks Smalltalk crash logs, providing intelligent root cause detection, suggested fixes, and searchable analysis history.

---

## Features

- **Multi-Provider AI** - OpenAI, Anthropic Claude, Z.ai, Ollama (offline)
- **Intelligent Analysis** - Root cause detection, fix suggestions, severity classification
- **Offline Operation** - 100% local analysis with Ollama/local LLMs
- **Full-Text Search** - SQLite FTS5 with BM25 ranking
- **Circuit Breaker** - Automatic failover between AI providers
- **Secure Storage** - OS-level encryption for API keys
- **Cross-Platform** - Windows, macOS, Linux

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Backend | Rust (Tauri 2) |
| Database | SQLite with FTS5 |
| AI Engine | Python 3.10+ |
| Build | Vite |

## Quick Start

```bash
# Clone the repository
git clone https://github.com/PolycarpysTack/hadron_v3.git
cd hadron-desktop

# Install dependencies
npm install
cd python && pip install -r requirements-api.txt && cd ..

# Run in development mode
npm run tauri dev
```

### Prerequisites

- **Node.js** 18+
- **Rust** (latest stable)
- **Python** 3.10+

## Project Structure

```
Hadron_v3/
├── hadron-desktop/          # Main application
│   ├── src/                 # React frontend
│   ├── src-tauri/           # Rust backend
│   ├── python/              # AI analysis engine
│   └── docs/                # Documentation
└── .archive/                # Archived planning docs
```

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](hadron-desktop/docs/GETTING-STARTED.md) | Installation and first steps |
| [User Guide](hadron-desktop/docs/user/USER-GUIDE.md) | Complete usage guide |
| [Developer Guide](hadron-desktop/docs/DEVELOPER-GUIDE.md) | Development setup |
| [Features](hadron-desktop/FEATURES.md) | Full feature list |
| [Troubleshooting](hadron-desktop/TROUBLESHOOTING.md) | Common issues |

## Build

```bash
cd hadron-desktop

# Build for production
npm run tauri build

# Output:
# Windows: src-tauri/target/release/bundle/msi/
# macOS:   src-tauri/target/release/bundle/dmg/
# Linux:   src-tauri/target/release/bundle/deb/
```

## Version

**Current**: v3.9.0

## License

Proprietary - MediaGeniX / Hadron Project

---

Built with [Tauri](https://tauri.app), [React](https://react.dev), and AI providers including [OpenAI](https://openai.com), [Anthropic](https://anthropic.com), and [Ollama](https://ollama.com).
