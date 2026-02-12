# Hadron Desktop - AI-Powered Smalltalk Crash Analyzer

<div align="center">

**Intelligent crash analysis** | **Multiple AI providers** | **Full-text search** | **Production-ready**

[Features](#features) • [Quick Start](#quick-start) • [Documentation](#documentation) • [Download](#download)

</div>

---

## Overview

Hadron Desktop uses AI to analyze Smalltalk crash logs and provide:
- **Root cause identification** - Understand what went wrong
- **Fix suggestions** - Actionable steps to resolve issues
- **Knowledge base** - Search and reference past analyses
- **Faster debugging** - AI explains complex stack traces instantly

---

## Features

### Core Features

- **Multi-provider AI**: OpenAI, Anthropic Claude, Z.ai, Ollama (offline)
- **Analysis Modes**: Complete (comprehensive) or Specialized (targeted) analysis
- **Multiple API Keys**: Store API keys for all providers simultaneously
- **Drag & drop**: Simply drop crash log files to analyze
- **Full-text search**: SQLite with FTS5 and BM25 ranking
- **Dark mode**: Eye-friendly interface for long debugging sessions
- **Export**: Save analyses to Markdown or PDF

### Production Features

- **Auto-updater**: Automatic update checks and one-click installation
- **Encrypted storage**: API keys secured with OS-level encryption (Keychain/Credential Manager)
- **Circuit breaker**: Automatic failover to backup AI providers
- **Structured logging**: JSON + human-readable logs with automatic rotation

### Status

- **Version**: 3.9.0
- **Platform**: Windows, macOS, Linux
- **Security**: 0 production vulnerabilities
- **Test Coverage**: Core features validated

---

## Quick Start

### 1. Download

Get the installer for your platform:
- **Windows**: `hadron-desktop_3.9.0_x64_en-US.msi`
- **macOS**: `hadron-desktop_3.9.0_x64.dmg` (Intel) or `_aarch64.dmg` (Apple Silicon)
- **Linux**: `hadron-desktop_3.9.0_amd64.deb` or `.AppImage`

📥 **Download**: [GitHub Releases](https://github.com/PolycarpusTack/hadron_v3/releases)

### 2. Install

**Windows**: Run `.msi` installer
**macOS**: Open `.dmg` and drag to Applications
**Linux**: `sudo dpkg -i hadron-desktop_3.9.0_amd64.deb`

### 3. Configure

1. Launch Hadron Desktop
2. Click **Settings** (⚙️ icon)
3. Select AI provider (OpenAI/Anthropic/Z.ai)
4. Enter your API key
5. Click **Save Settings**

### 4. Analyze

**Drag & drop** a crash log file onto the window. Done!

---

## AI Provider Comparison

| Provider | Cost/Analysis | Context | Best For |
|----------|---------------|---------|----------|
| **OpenAI GPT-5.1** | $0.01-$0.03 | 128K tokens | Latest model, best capabilities |
| **Anthropic Claude Sonnet 4.5** | $0.003-$0.015 | 200K tokens | Latest Sonnet, best reasoning |
| **Z.ai GLM-4.6** | $0 ($3/month) | 200K tokens | Daily use, unlimited |

**Get API keys**:
- OpenAI: https://platform.openai.com/api-keys
- Anthropic: https://console.anthropic.com
- Z.ai: https://z.ai

**Detailed comparison**: [MULTI-PROVIDER-SUPPORT.md](MULTI-PROVIDER-SUPPORT.md)

---

## Documentation

### For Users
- [Complete User Guide](docs/user/USER-GUIDE.md) - Installation, features, tips & tricks
- [Troubleshooting](TROUBLESHOOTING.md) - Common issues and solutions
- [Features](FEATURES.md) - Full feature list
- [Changelog](CHANGELOG.md) - Release history

### For Developers
- [Auto-Updater Setup](docs/developer/AUTO-UPDATER-SETUP.md) - Configure updates
- [GitHub Release Guide](docs/developer/GITHUB-RELEASE-GUIDE.md) - Publishing releases
- [Code Signing](docs/developer/PRODUCTION-SIGNING-SETUP.md) - Sign installers
- [Developer Guide](docs/DEVELOPER-GUIDE.md) - Development setup and architecture

---

## Development

### Prerequisites

- **Node.js** 18+
- **Rust** (latest stable)
- **Python** 3.10+

### Setup

```bash
# Clone repository
git clone https://github.com/hadron-team/hadron-desktop.git
cd hadron-desktop

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

### Test

```bash
# Frontend tests
npm test

# Rust tests
cd src-tauri && cargo test

# E2E tests (coming in v1.1)
npm run test:e2e
```

---

## Technology Stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **Backend**: Tauri 2 (Rust)
- **Analysis Engine**: Python 3.10+ with OpenAI/Anthropic SDK
- **Database**: SQLite with FTS5 (full-text search)
- **Build Tool**: Vite

---

## Roadmap

See [CONSOLIDATED-ROADMAP.md](CONSOLIDATED-ROADMAP.md) and [FURTHER_ROADMAP.md](FURTHER_ROADMAP.md) for the complete development roadmap including:

- RAG-powered knowledge base integration
- Advanced pattern detection
- Team collaboration features
- JIRA/Keeper integrations

---

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

**See [DOCUMENTATION.md](DOCUMENTATION.md) for documentation guidelines**

---

## Support

- **Issues**: [GitHub Issues](https://github.com/hadron-team/hadron-desktop/issues)
- **Discussions**: [GitHub Discussions](https://github.com/hadron-team/hadron-desktop/discussions)
- **Email**: support@hadron.dev (planned)

---

## License

**Proprietary** - MediaGeniX / Hadron Project

Copyright © 2025 MediaGeniX. All rights reserved.

---

## Acknowledgments

Built with:
- [Tauri](https://tauri.app) - Desktop framework
- [React](https://react.dev) - Frontend UI
- [OpenAI](https://openai.com) - AI analysis
- [Anthropic](https://anthropic.com) - Claude AI
- [Z.ai](https://z.ai) - GLM models
- [SQLite](https://sqlite.org) - Database

---

<div align="center">

Built by the Hadron Team

</div>
