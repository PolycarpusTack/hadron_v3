# Version History

## v5.0.1 — Bug Fixes (May 2026)

### Ask Hadron / Chat

- **Fixed OpenAI 400 error on follow-up questions** — Conversations with OpenAI models (GPT-5, GPT-4.1) now correctly handle multi-turn exchanges. Previously, when the AI used tools (search, JIRA lookup, etc.) on any turn, subsequent messages triggered a 400 error: *"Invalid type for input[N].content: got null instead."* The root cause was that OpenAI's Chat Completions API sends `content: null` on tool-calling assistant turns; those null values were being forwarded to the Responses API, which rejects them. The conversation history sent to synthesis is now snapshotted before tool-call turns are appended.
- **Fixed MCP tool failures silently returning garbage** — When CodexMgX MCP was enabled but a tool call failed (server offline, wrong tool name, network error), the failure was masked as the string `"(MCP unavailable)"` and sent to the AI as if it were real tool output. The AI would then hallucinate answers based on that placeholder. Now all MCP-dispatched tools (`search_kb`, `investigate_jira_ticket`, all investigation and Confluence tools) properly fall back to their native implementations when MCP returns nothing.

### UI / Visual

- **Fixed loading screen broken image** — The native splash window showed a broken image icon because its inline `<script>` was blocked by the page's own Content-Security-Policy (`default-src 'none'` covers `script-src`). The image path is now set via a direct relative `src="splash.png"` attribute — no script needed.
- **Fixed app header and widget icon missing after install** — The Hadron logo in the header and the floating widget button both used absolute paths (`/elena-button.png`, `/logo.png`) that work in the Vite dev server but resolve to the filesystem root under `file://` in a packaged Electron app. Paths changed to relative (`./`).
- **Fixed floating widget showing scrollbars instead of icon** — Caused by the same broken image path above: the alt text `"Hadron"` overflowed the 68 × 68 transparent window, producing visible scroll arrows. Resolved by the relative path fix.

### History

- **Performance traces now saved to History** — Analyzing a `.trace` / time-profile file now writes a row to the `analyses` table with `analysis_type = 'performance'`, so results appear in the History tab and can be reopened.
- **Distinct icons per analysis type in History** — Code analysis shows `⌥` (indigo), performance shows `◷` (cyan), comprehensive/WCR shows `◈` (green), quick shows `◎`, Sentry shows `⊕`, JIRA shows `◉`.

### Bulk Actions

- **Fixed Select → Delete / Favorite / Unfavorite / Export doing nothing** — All six bulk IPC handlers (`bulk_delete_analyses`, `bulk_delete_translations`, `bulk_add_tag_to_analyses`, `bulk_remove_tag_from_analyses`, `bulk_set_favorite_analyses`, `bulk_set_favorite_translations`) were returning `undefined` instead of a result object. The frontend accessed `result.successCount` on `undefined` and threw a TypeError before any UI update could run. DB writes were succeeding, but the list never refreshed.

### Light Mode

- **Light mode toggle now works** — All design tokens (`--hd-*`) were only defined in `:root` (always dark). Added a full `html:not(.dark)` override block with correct light values for backgrounds, borders, text, and accent colours.
- **Nav bar now responds to light mode** — An inline `background: rgba(12,18,34,0.7)` style on the nav element overrode the CSS class. Removed; the `.hd-nav-bar` class now controls background through the token system.
- **Fixed invisible text in dropzone and performance results in light mode** — Several components used hardcoded `text-white` / `text-gray-300` classes on transparent backgrounds, making text invisible on light backgrounds. Changed to `dark:text-white text-gray-900` equivalents.

---

## v5.0.0 — Electron Relaunch (May 2026)

Hadron migrated from the Tauri + Rust stack to **Electron + Node.js**, keeping the same React/TypeScript frontend. This is a ground-up rebuild of the desktop shell; all analysis, history, chat, and integration features carry over.

---

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
