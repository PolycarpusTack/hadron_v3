# Changelog
All notable changes to Hadron Desktop will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [4.6.0] - 2026-04-28

Deep investigation layer for JIRA tickets, powered by the CodexMgX
investigation engine originally built by **Ante Gulin**. Ported from
a standalone Codex Desktop plugin to a native Rust crate
(`hadron-investigation`) and wired throughout AskHadron, the JIRA
Analyzer, and FloatingElena.

### Added

- **Deep JIRA investigation in AskHadron**: four new chat tools let
  the AI agent run structured investigations on demand:
  - `investigate_jira_ticket` — builds a full evidence dossier:
    changelog, rendered comments, worklogs, remote links, project
    context, agile context, related Confluence pages, attachment
    text, and a set of hypotheses with confidence scores and open
    questions.
  - `investigate_regression_family` — finds historical sibling and
    predecessor issues across the same project (90 days) and
    cross-project (6 months). Use when a ticket might be a
    regression.
  - `investigate_expected_behavior` — searches Confluence and MOD
    documentation to answer "what should this actually do?".
  - `investigate_customer_history` — profiles the reporting customer
    by pulling their full issue history and surfacing patterns.
  - `search_confluence` / `get_confluence_page` — direct Confluence
    search and page fetch now available mid-conversation.
- **Investigate button in JIRA Analyzer**: one-click investigation
  from any loaded ticket, on both desktop and web. Results render in
  the new `InvestigationPanel` showing evidence, hypotheses, and
  next-check suggestions.
- **FloatingElena quick action**: "Investigate" added as the fifth
  quick action on the floating chat widget (web).
- **Confluence override in JIRA Settings**: teams that use a
  separate Confluence instance can now configure a distinct base URL,
  email, and API token. Falls back to the JIRA credentials when not
  set.
- **Attachment text extraction**: investigation reads text from
  `.txt`, `.html`, `.zip`, `.docx`, and `.pdf` attachments
  automatically, up to 8 KB per file.
- **WHATS'ON Knowledge Base**: token-scored search against the
  WHATS'ON KB index, accessible to all investigation tools.
- **`hadron-investigation` crate**: self-contained Rust library
  (originally the CodexMgX PowerShell MCP plugin by Ante Gulin),
  shared between the desktop Tauri app and the web Axum server.
  Implements the full Atlassian REST client, ADF-to-plaintext
  converter, attachment extractor, three-strategy related-issue
  finder, evidence builder, hypothesis engine, and four investigation
  orchestrators.
- **Investigation settings** (web admin): new database migration
  (`019_investigation_settings.sql`) and admin API routes for
  storing Confluence credentials server-side with encryption at rest.

---

## [4.5.0] - 2026-04-17

Security-focused release. Closes every actionable finding from the
2026-04-15 third-party retest plus a post-sprint residual review.

Minor version bump because the release contains **breaking API and
deployment changes**: API request bodies that previously accepted
`api_key`, `model`, and `provider` fields have those fields removed
(the backend now uses admin-configured server-side AI keys
exclusively), docker-compose defaults changed (see Ops upgrade
notes below), and new env vars are mandatory for features that were
previously fail-open.

### Security

- **Dev auth double-gate**: `AUTH_MODE=dev` now also requires
  `ALLOW_DEV_AUTH=true`, or the server refuses to start. Prevents a
  single-env-var misconfiguration from exposing the seeded admin.
- **Bring-your-own-key flow removed**: `api_key`, `model`, and
  `provider` fields removed from `AnalyzeRequest`, `ChatRequest`,
  `CodeAnalysisRequest`, the multipart upload path, and the embed
  endpoint. Frontend no longer persists API keys in
  `sessionStorage`. AI provider + key is admin-configured only.
- **Release-notes IDOR fixed**: `update_release_note_checklist`
  now enforces `WHERE user_id = $N` in SQL. `export_confluence`
  and `run_compliance_check` require `Role::Lead` with intent
  documented in the route.
- **Ownership & role gates**: analysis notes, feedback, and
  signatures endpoints now enforce owner or role.
- **OpenSearch SSRF hardening**: proxy route requires `Role::Lead`,
  rejects non-http(s) schemes, and enforces an allowlist via
  `OPENSEARCH_ALLOWED_HOSTS` that supports both bare-host and
  `host:port` pinning. Mixed allowlists evaluate each entry
  independently. 7 unit tests cover the matcher including
  userinfo-smuggling (`user@good@evil`), IDN, case, trailing-dot,
  and scheme.
- **JIRA JQL pass-through closed**: direct endpoint and chat tool
  both strip user-supplied JQL; free-text search only, scoped to
  the configured project.
- **Encryption fails closed**: `encrypt_value` returns
  `HadronError::Config` when `SERVER_ENCRYPTION_KEY` is missing
  (was fail-open to plaintext). Regression test added.
- **Admin role checks**: style guide, checklist, confluence, and
  embedding-status admin-prefixed read endpoints now require
  `Role::Admin`.
- **Native tool calling for AI chat**: replaces prose-JSON tool-use
  parsing with provider-native `tool_calls` (OpenAI) /
  `tool_use` (Anthropic) structured fields. Prompt-injected
  `{"tool_use": ...}` strings embedded in retrieved content can
  no longer forge a tool invocation. Regression test locks this in.
- **Rate limiting** via `tower_governor` with `TRUSTED_PROXY=true`
  opt-in for `X-Forwarded-For` parsing; defaults to direct
  peer-IP to prevent spoofing on direct connections. Tunable via
  `RATE_LIMIT_PER_SECOND` (default 10) and `RATE_LIMIT_BURST`
  (default 100).
- **HTTP security headers**: `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`.
- **Postgres port**: bound to `127.0.0.1:5432` in docker-compose
  instead of exposed on all interfaces.
- **Health endpoint**: returns generic `"Database unavailable"`
  to unauthenticated callers; full error traced server-side via
  `tracing::error!` only.
- **Chat message persistence**: failures now logged at `warn` level
  instead of silently dropped.
- **Desktop plugin-shell** bumped from `~2.0.0` to `^2.3.5`,
  closing `GHSA-c9pr-q8gx-3mgp`. Both `hadron-desktop` and
  `hadron-web/frontend` lockfiles regenerated via `npm install`
  and `npm audit fix`. `npm audit` now reports 0 vulnerabilities.
- **Tauri updater public key**: explicit
  `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY_BEFORE_ACTIVATION`
  placeholder replaces the empty string. Updater still
  `active: false`; must populate before activation.
- **`cargo audit`** ignore configs added with rationale for two
  unreachable transitive advisories (`rsa 0.9.10` Marvin via
  `sqlx-mysql` which we do not enable; `time 0.3.41` DoS blocked
  by Rust MSRV). Both workspaces now report 0 errors.

### Added

- `hadron-mcp` shared crate (Model Context Protocol) with 8
  read-only tools: ticket, search, release-notes, and sentry
  lookups. Desktop stdio binary and web HTTP endpoint at
  `/.well-known/mcp` (ungated discovery by design; tools
  themselves are user-scoped).
- PII-awareness notice on chat input reminding users to avoid
  pasting customer identifiers. Companion retention plan drafted
  at `docs/plans/2026-04-17-chat-message-retention.md`.
- Codex crash-analysis planning artefacts and evaluation fixtures
  (`docs/plans/2026-04-16-codex-crash-analysis-*.md`, `tests/fixtures/crash-analysis/`).
- F8 implementation plan (now complete):
  `docs/plans/2026-04-17-chat-native-tool-calling.md`.

### Changed

- **Breaking (API)**: `AnalyzeRequest`, `ChatRequest`, and
  `CodeAnalysisRequest` no longer accept `api_key`, `model`, or
  `provider` fields. Requests that include them are silently
  ignored. Admins must configure the shared AI key via
  `/api/admin/ai`.
- **Breaking (deployment)**: compose default `AUTH_MODE` flipped
  from `dev` to `azure_ad`. Local dev now requires `AUTH_MODE=dev`
  plus the new `ALLOW_DEV_AUTH=true` flag.
- **Breaking (deployment)**: `SERVER_ENCRYPTION_KEY` is now
  mandatory — server fails secret writes without it.
- **Breaking (deployment)**: `OPENSEARCH_ALLOWED_HOSTS` is now
  mandatory for OpenSearch proxy use — empty value = reject-all.
- Settings view simplified: removed BYO-key UI; replaced with an
  "admin-managed" notice for AI configuration.

### Dependencies

- Added: `tower_governor 0.7.0`, `tower-http set-header` feature.
- Bumped transitively: `rustls-webpki 0.103.12`,
  `rkyv 0.7.46`, `tar 0.4.45`, `bytes 1.11.1`,
  `quinn-proto 0.11.14`. `time` pinned to `0.3.41` to stay on
  Rust 1.87 MSRV (0.3.47+ requires 1.88).
- Frontend: `vite`, `rollup`, `picomatch` advisories closed via
  `npm audit fix`.

### Ops upgrade notes

1. Set `SERVER_ENCRYPTION_KEY` (64 hex chars) before any admin
   secret write.
2. Set `OPENSEARCH_ALLOWED_HOSTS` (comma-separated `host` or
   `host:port` entries) if OpenSearch proxy is used.
3. Production: `AUTH_MODE` should be unset or `azure_ad`. Never
   set `ALLOW_DEV_AUTH=true` in production.
4. If behind a reverse proxy that strips incoming XFF, set
   `TRUSTED_PROXY=true` to enable per-user-ish rate limiting.
   Otherwise leave unset (per-peer-IP).
5. Run `npm install` on any deploy host that keeps a stale
   lockfile; the in-repo lockfiles are clean.

---

## [4.2.0] - 2025-02-24

### Fixed
- **Widget stability**: Added NaN/Infinity validation to `move_widget` and `resize_widget` to prevent invalid window positions causing crashes
- **Widget lock contention**: Removed unnecessary WidgetLock acquisition from `focus_main_window` and `is_main_window_visible`, eliminating deadlock potential with widget operations
- **Widget position restore**: Wrapped startup position restore and settings-triggered hide in `withWidgetLock` to prevent race conditions with other widget operations
- **Widget pointer handling**: Added `pointercancel` event cleanup to FAB drag handler, preventing orphaned listeners on touch interruption
- **Widget context menu**: Fixed unhandled promise rejection in right-click menu; menu now only shows after window resize succeeds
- **Widget click-outside**: Fixed missing `closeMenu` dependency in useEffect, ensuring click-outside detection always uses the latest handler
- **Widget chat listeners**: Fixed race condition where stream/final-content listener refs could be null during early unmount by assigning refs inside `.then()` callbacks
- **FTS5 search injection**: Sanitized user search input through `sanitize_fts5_query` before passing to SQLite FTS5, preventing query syntax errors and injection
- **Analytics render mutation**: Fixed `severity_breakdown.sort()` mutating props during render by spread-copying the array first
- **Unbounded database queries**: Added `LIMIT 500` to favorites and archived analyses queries to prevent memory exhaustion on large datasets

### Changed
- Production log level reduced from Debug to Info (Debug still used in dev builds)

---

## [4.1.0] - 2025-02-20

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

### [4.2.0] - Stability & Security Hardening

**Key Highlights**:
- **11 bug fixes** across widget system, search, analytics, database, and logging
- **Widget crash prevention**: Comprehensive input validation and lock contention fixes eliminate several causes of ILLEGAL_INSTRUCTION crashes on Windows
- **FTS5 injection fix**: User search input is now sanitized before reaching SQLite, preventing query syntax errors and potential injection
- **Production logging**: Release builds no longer emit Debug-level logs, reducing log noise and disk usage
- **Memory safety**: Unbounded database queries now have row limits; render-time array mutations eliminated

**Breaking Changes**: None (fully backward compatible)

---

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
