# Version History

## v4.6.0 — Deep Investigation (April 2026)

### Investigation Engine
- **4 new investigation tools in Ask Hadron** — `investigate_jira_ticket`, `investigate_regression_family`, `investigate_expected_behavior`, `investigate_customer_history`. Ask Hadron can now build a full evidence dossier for any JIRA ticket and reason over it.
- **Investigate button in JIRA Analyzer** — one click from any loaded ticket to a structured investigation panel showing evidence, hypotheses, open questions, and next-check suggestions.
- **Confluence search in chat** — `search_confluence` and `get_confluence_page` tools give Ask Hadron direct access to Confluence mid-conversation.
- **Attachment text extraction** — investigation reads text from `.txt`, `.html`, `.zip`, `.docx`, and `.pdf` attachments automatically (up to 8 KB each).
- **WHATS'ON KB integration** — token-scored search against the WHATS'ON knowledge base, available in all investigation tools.
- **Confluence credential override** — teams on a separate Confluence instance can configure distinct base URL, email, and API token in JIRA Settings.
- **`hadron-investigation` crate** — self-contained Rust library (ported from the CodexMgX plugin by Ante Gulin) shared between desktop and web. Implements the full Atlassian client, ADF converter, three-strategy related-issue finder, evidence builder, and hypothesis engine.

---

## v4.4.1 — Keeper & Crash Fixes (March 2026)

### Keeper Secrets Manager
- **Fixed API key extraction** — Records using Notes fields, encryptedNotes records, and custom-labeled fields are now detected
- **Case-insensitive label matching** — Labels like "Api Key", "api key", "token", "secret key" now match regardless of case
- **Login field excluded** — Brute-force extraction no longer returns usernames instead of passwords
- **Wired into model refresh & connection test** — Keeper-managed keys now work with "Refresh Models", "Test Connection", and the API key warning banner
- **Improved diagnostics** — Extraction failures now log the full record structure including field types, labels, and top-level keys

### Crash Fixes
- **Fixed hotkey registration crash** — App no longer panics if Ctrl+Shift+H is already registered (e.g. from a previous unclean exit); unregisters first, catches errors gracefully
- **SDK errors logged** — Keeper SDK errors are now logged at trace level instead of being silently swallowed

---

## v4.4.0 — Stability & Safety (March 2026)

This release focuses on **runtime stability**, fixing crash-causing bugs and hardening the codebase against real-world failure conditions. All issues were identified through a systematic runtime stability audit.

### Critical Fixes
- **Resolved ILLEGAL_INSTRUCTION crashes** — Added `.cargo/config.toml` with `target-cpu=x86-64` to prevent AVX/AVX2 instructions from crashing on older CPUs
- **Fixed auto-restart fork bomb** — The tao paint-bug restart logic now caps at 2 retries via an environment variable, preventing infinite process spawning
- **Fixed UTF-8 panics** — All 7 instances of unsafe byte-index slicing (`&s[..200]`) replaced with `floor_char_boundary()` to prevent crashes on non-ASCII content (accented characters, CJK, emoji)
- **Fixed silent data loss** — AI providers returning empty responses no longer silently persist blank release notes; callers now receive a clear error

### Stability Improvements
- **Poller cancel flag fixed** — Background JIRA poller now uses the correct `AtomicBool` for graceful shutdown instead of a disconnected copy
- **Poller timeout added** — Network calls in the background poller are now wrapped in a 5-minute timeout to prevent indefinite hangs
- **Cancellation responsiveness** — Chat LLM calls now check the cancel flag after each network call and between dual synthesis passes
- **Transactional chat saves** — Session + messages are now saved atomically in a single SQLite transaction, preventing partial writes on error
- **Widget lock upgraded** — Replaced blocking `parking_lot::Mutex` with `tokio::sync::Mutex` to prevent starving the async runtime under rapid widget operations
- **Embedding validation** — Cosine similarity now skips embeddings with mismatched dimensions instead of producing silent wrong results
- **COMMIT failure recovery** — Added ROLLBACK on COMMIT failure in embedding upserts to prevent stuck database connections
- **Prompt size cap** — Release notes generation now truncates enriched descriptions and caps total prompt size at 512KB
- **TLS certificate verification** — OpenSearch connections now verify TLS certificates by default; `verify_certs: false` must be explicitly set for self-signed certs
- **ROLLBACK error handling** — Fixed 3 bulk operations where a ROLLBACK failure would swallow the original error

### Minor Fixes
- **Duration overflow** — Replaced unsafe `as i32` casts on elapsed time with saturating conversion
- **Async SQLite calls** — Chat metadata commands (star, tag, update) now use `spawn_blocking` instead of blocking the Tokio runtime
- **Thread pool for Keeper** — Replaced raw `std::thread::spawn` with `tokio::task::spawn_blocking` to prevent orphaned threads on cancellation
- **Shared HTTP client** — OpenSearch embedding calls now reuse a shared `reqwest::Client` instead of creating one per call
- **Range validation** — `get_trend_data` now clamps `range_days` to a minimum of 1
- **Transactional deletes** — Chat session deletion is now atomic (messages + session in one transaction)
- **JSON extraction** — Python runner now tries multiple `{` positions for more robust JSON extraction from stdout
- **Confluence tables** — Markdown-to-Confluence conversion now correctly uses `||` only for header rows, not data rows
- **Error clarity** — "Promote to Gold" for already-promoted analyses now returns a descriptive error instead of `QueryReturnedNoRows`

---

## v4.3.0 — Unified Export & JIRA Assist (March 2026)

### JIRA Assist (Sprints 1-7)
- AI-powered ticket triage with severity/category classification
- Investigation briefs with parallel triage + deep analysis
- Duplicate detection via OpenAI embeddings and cosine similarity
- JIRA round-trip: post briefs as comments, collect engineer feedback
- Project feed integration with batch triage and client-side filters
- Background poller with configurable JQL, interval, and OS notifications

### Unified Export
- Generic export system supporting Markdown, HTML, Interactive HTML, JSON, TXT, and XLSX
- Export added to Crash Analyzer, Code Analyzer, Sentry Analyzer, and JIRA Analyzer
- File location picker: Download / Default Folder / Choose
- Default export directory preference in Settings

### Code Analyzer
- Component split into orchestrator + 6 tabs + 3 shared components
- `call_ai` command for AI calls without DB persistence
- Token budget: frontend warns at 50KB, backend rejects at 512KB
