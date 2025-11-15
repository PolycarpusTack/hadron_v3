# Changelog
All notable changes to Hadron Desktop will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Ollama support for 100% offline operation (2025-11-14)
- Circuit breaker timeout increased to 60s for slow OpenAI responses

### Fixed
- UI encoding issues with warning emoji characters (2025-11-14)

---

## [1.1.0] - 2025-11-13

### Added
- **Multi-provider support**: OpenAI, Anthropic, Z.ai, and Ollama
- **Circuit breaker pattern**: Automatic failover between providers
- **Provider health monitoring**: Real-time status indicators
- **Active provider configuration**: Enable/disable providers individually
- **Batch analysis**: Process multiple crash logs at once
- **PII redaction**: Optional privacy-preserving preprocessing
- **Translation feature**: Convert technical content to plain language

### Changed
- Circuit breaker timeout from 15s to 60s (handles slow OpenAI responses)
- Updated UI for multi-provider selection
- Enhanced Settings panel with provider-specific info boxes

### Security
- Removed unused `shell:default` permission
- Removed unused `fs:default` permission
- Updated vulnerable dependencies (html-parse-stringify, vite, rollup)
- Implemented Content Security Policy (CSP) hardening
- Changed default allowlist deny policy to `true`
- API key encryption via OS-level keychain/credential manager

### Fixed
- API key validation edge cases
- Model selection persistence
- Connection test timeout handling
- UI text encoding issues (warning emojis)

---

## [1.0.0] - 2025-11-13

### Added
- 🚀 **Initial production release**
- **Intelligent crash analysis** for VisualWorks Smalltalk
  - Multi-provider AI support (OpenAI GPT-4, Anthropic Claude 3.5, Z.ai GLM-4.6)
  - Automatic circuit breaker with failover
  - Cost tracking and estimation
  - Rich analysis output with root cause, fix suggestions, prevention tips

- **Desktop experience**
  - Drag & drop crash log files
  - Syntax highlighting for stack traces
  - Dark mode interface
  - Export to Markdown/PDF

- **Analysis history & search**
  - SQLite database with FTS5 full-text search
  - BM25 ranking for search relevance
  - Favorites and recent files
  - Advanced filtering (provider, model, date range)

- **Production features**
  - Auto-updater with one-click installation
  - Encrypted API key storage
  - Structured logging with JSON format
  - Provider health monitoring

### Platform Support
- ✅ Windows 10+ (x64)
- ✅ macOS 10.15+ (Intel & Apple Silicon)
- ✅ Linux: Ubuntu 20.04+, Debian 10+ (x64)

### Technical Specifications
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Backend**: Rust (Tauri v2)
- **Database**: SQLite with FTS5
- **Icons**: Lucide React
- **Code Highlighting**: React Syntax Highlighter
- **Date Handling**: date-fns

### System Requirements
- RAM: 2GB minimum, 4GB recommended
- Disk: 500MB for application + storage for crash logs
- Internet: Required for AI analysis (offline mode planned)

---

## [0.1.0] - 2025-11-12

### Added
- Initial MVP implementation
- Basic crash log analysis
- OpenAI provider integration
- Simple UI for file upload and analysis display

---

## Release Notes

### [1.1.0] - Multi-Provider Support & Security Hardening

**Key Highlights**:
- **Ollama integration**: Run AI analysis 100% offline with local models
- **Provider failover**: Automatic switching if primary provider fails
- **Enhanced security**: Removed unused permissions, updated dependencies
- **Batch processing**: Analyze multiple crash logs simultaneously
- **Privacy**: Optional PII redaction before analysis

**Security Fixes** (ship-blocking):
1. Removed unused `shell:default` permission (attack surface reduction)
2. Removed unused `fs:default` permission (least privilege)
3. Updated `html-parse-stringify` to v2.2.8 (CVE fix)
4. Updated `vite` to 5.4.11 (security patches)
5. Updated `rollup` to 4.28.1 (dependency security)
6. CSP hardening in `tauri.conf.json`

**Breaking Changes**: None (fully backward compatible)

**Migration Guide**:
- Existing API keys preserved
- History and favorites migrated automatically
- No user action required

---

### [1.0.0] - Production Release

**Key Highlights**:
- First production-ready release
- Full AI-powered crash analysis
- Multi-provider support (OpenAI, Anthropic, Z.ai)
- Complete desktop application with auto-updates
- Encrypted API key storage
- Advanced search and filtering

**Known Limitations**:
- Internet connection required for cloud AI providers
- No offline mode (addressed in v1.1.0 with Ollama)
- Windows code signing planned for future release

---

## Links

- [Documentation](./README.md)
- [User Guide](./docs/user/USER-GUIDE.md)
- [Troubleshooting](./TROUBLESHOOTING.md)
- [Developer Guides](./docs/developer/)
- [GitHub Releases](https://github.com/hadron-team/hadron-desktop/releases)

---

*For detailed feature documentation, see [FEATURES.md](./FEATURES.md)*
