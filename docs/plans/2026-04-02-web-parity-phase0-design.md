# Web-Desktop Parity — Phase 0: Infrastructure Sprint

**Date:** 2026-04-02
**Status:** Approved
**Parent:** `docs/plans/2026-03-25-web-desktop-parity-design.md`

Phase 0 builds the shared infrastructure that all subsequent feature phases depend on: server-side AI key management, a transport-agnostic AI module in hadron-core, and a reusable SSE streaming pattern.

---

## 0a. Server-side AI API Key Management

### Current state
Every AI-calling request (analysis, chat) requires `api_key` in the request body. Keys live in `sessionStorage` client-side.

### Database

New migration `013_global_settings.sql`:

```sql
CREATE TABLE global_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID REFERENCES users(id)
);
```

Seeded keys (inserted by migration as empty strings):
- `ai_provider` — `"openai"` or `"anthropic"` (plaintext)
- `ai_model_openai` — e.g. `"gpt-4o"` (plaintext)
- `ai_model_anthropic` — e.g. `"claude-sonnet-4-20250514"` (plaintext)
- `ai_api_key_openai` — encrypted
- `ai_api_key_anthropic` — encrypted

### Encryption

AES-256-GCM using `SERVER_ENCRYPTION_KEY` env var (32-byte hex or base64). Only API key values are encrypted; provider/model stored as plaintext. Uses the `aes-gcm` crate. Random 96-bit nonce prepended to ciphertext, stored as hex in the `value` column.

### Backend

**DB functions** (`db/mod.rs`):
- `get_global_setting(pool, key) -> Option<String>` — raw read
- `set_global_setting(pool, key, value, user_id)` — upsert
- `get_ai_config(pool) -> Option<AiConfig>` — reads provider + key + model, decrypts key, returns `None` if no key configured

**Encryption helpers** (`crypto.rs` — new file in hadron-server):
- `encrypt_value(plaintext: &str) -> Result<String>` — AES-256-GCM, returns hex(nonce || ciphertext)
- `decrypt_value(encrypted: &str) -> Result<String>` — reverse
- Reads `SERVER_ENCRYPTION_KEY` from env once via `std::sync::LazyLock`

**AI-calling routes updated:**
- `analyses::upload_and_analyze`, `analyses::analyze_content`, `chat::chat_send` all gain a fallback chain:
  1. Check `global_settings` for server-side AI config
  2. If absent, use `api_key` from request body
  3. If neither, return 400 "No AI configuration available"
- The `api_key` field in `AnalyzeRequest` / `ChatRequest` becomes `Option<String>`

### Admin API

All admin-only (require `Role::Admin`):

- `GET /api/admin/ai-config` — returns `{ provider, modelOpenai, modelAnthropic, hasOpenaiKey: bool, hasAnthropicKey: bool }` (never returns the actual key)
- `PUT /api/admin/ai-config` — accepts `{ provider?, modelOpenai?, modelAnthropic?, apiKeyOpenai?, apiKeyAnthropic? }`. Only provided fields are updated. Keys are encrypted before storage.
- `POST /api/admin/ai-config/test` — builds `AiConfig` from stored settings, sends a minimal completion request, returns success/error

### Frontend

**AdminPanel.tsx** — new "AI Configuration" card:
- Provider selector: radio group (OpenAI / Anthropic)
- Model input fields for each provider
- API key inputs (masked, placeholder shows "••••••• (configured)" when key exists)
- "Test Connection" button → calls `/api/admin/ai-config/test`
- "Save" button → calls `PUT /api/admin/ai-config`

**Analysis/Chat flows:**
- If server has AI config (`GET /api/admin/ai-config` returns `hasOpenaiKey` or `hasAnthropicKey`), hide per-request API key input. Show "(Server-configured)" indicator.
- If no server config, show the existing user-key input as fallback.
- New API helper: `getAiConfigStatus()` in `api.ts` — cached on load, used by components to decide whether to show key inputs.

---

## 0b. AI Service in hadron-core

### Current state
All AI logic lives in `hadron-server/src/ai/mod.rs` — provider enum, message types, streaming, system prompts. `hadron-core` has no AI module.

### New module: `hadron-core::ai`

**`ai/types.rs`** — Transport-agnostic types (moved from hadron-server):
- `AiProvider` enum (`OpenAi`, `Anthropic`) with `from_str()`
- `AiMessage { role: String, content: String }`
- `AiConfig { provider: AiProvider, api_key: String, model: String }`

**`ai/prompts.rs`** — All system prompts centralized:
- `CRASH_ANALYSIS_PROMPT` — existing analysis prompt (moved from server)
- `CHAT_SYSTEM_PROMPT` — existing chat prompt (moved from server)
- `CODE_ANALYSIS_PROMPT` — 6-tab structured JSON prompt for Phase 1a
- Types: `CodeAnalysisResult`, `CodeIssue`, `WalkthroughSection`, `CodeQualityScores`, `GlossaryTerm`
- Builder: `build_code_analysis_prompt(code: &str, language: &str) -> Vec<AiMessage>`

**`ai/parsers.rs`** — Response parsing:
- `strip_markdown_fences(raw: &str) -> &str` — removes ```json fences
- `parse_crash_analysis(raw: &str) -> Result<CrashAnalysisResult>` — existing JSON parsing
- `parse_code_analysis(raw: &str) -> Result<CodeAnalysisResult>` — for Phase 1a

**`ai/mod.rs`** — Re-exports all types, prompts, parsers.

### What stays in hadron-server

`hadron-server::ai::mod.rs` becomes a transport layer:
- Imports `AiProvider`, `AiMessage`, `AiConfig` from `hadron-core::ai`
- Keeps `reqwest`-based `complete()` and `stream_completion()` functions
- Keeps OpenAI/Anthropic HTTP request/response structs (transport detail)
- Removes system prompt constants (now in hadron-core)

### Dependencies

`hadron-core/Cargo.toml` — no new dependencies. Uses `serde`, `serde_json` (already present) for types and parsing.

---

## 0c. SSE Streaming Pattern

### Current state
`hadron-server/src/sse/mod.rs` has `chat_stream_response()` — wraps `mpsc::Receiver<ChatStreamEvent>` into Axum SSE. Only used by chat. Frontend has no shared streaming hook.

### Backend

**Generalize `sse/mod.rs`:**
- Rename `chat_stream_response()` → `stream_response()` (already generic, just better named)
- Add `stream_ai_completion()` helper:

```rust
pub async fn stream_ai_completion(
    config: &AiConfig,
    messages: Vec<AiMessage>,
    system_prompt: Option<&str>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>>
```

Spawns `ai::stream_completion()` internally, returns the SSE response. Eliminates channel-setup boilerplate in every streaming route.

### Frontend

**New hook: `hooks/useAiStream.ts`**

```typescript
interface UseAiStreamReturn {
  streamAi: (url: string, body: object) => void;
  content: string;
  isStreaming: boolean;
  error: string | null;
  reset: () => void;
}

function useAiStream(): UseAiStreamReturn
```

Internals:
- Uses `fetch()` + `ReadableStream` reader (not `EventSource` — needs POST + auth headers)
- Parses SSE `data:` lines into `ChatStreamEvent` objects
- Accumulates `token` events into `content` string
- Handles `done` (sets `isStreaming = false`) and `error` (sets `error`) events
- Auto-acquires auth token via `acquireToken()` (or skips in dev mode)
- Aborts fetch on component unmount via `AbortController`
- No reconnection (AI calls are one-shot), no retry (user re-triggers)

**Consumers:** Phase 1a Code Analyzer, Phase 1b JIRA Deep Analysis, future streaming features. Existing chat can optionally migrate later (not in scope).

---

## File Summary

### New files
| File | Purpose |
|------|---------|
| `migrations/013_global_settings.sql` | `global_settings` table |
| `crates/hadron-core/src/ai/mod.rs` | AI module root, re-exports |
| `crates/hadron-core/src/ai/types.rs` | `AiProvider`, `AiMessage`, `AiConfig` |
| `crates/hadron-core/src/ai/prompts.rs` | System prompts + prompt builders |
| `crates/hadron-core/src/ai/parsers.rs` | Response parsing functions |
| `crates/hadron-server/src/crypto.rs` | AES-256-GCM encrypt/decrypt helpers |
| `frontend/src/hooks/useAiStream.ts` | Shared SSE streaming React hook |

### Modified files
| File | Change |
|------|--------|
| `crates/hadron-core/src/lib.rs` | Add `pub mod ai` |
| `crates/hadron-core/Cargo.toml` | No changes (deps already present) |
| `crates/hadron-server/src/main.rs` | Add `mod crypto` |
| `crates/hadron-server/src/ai/mod.rs` | Import types from hadron-core, remove prompts, thin wrapper |
| `crates/hadron-server/src/sse/mod.rs` | Rename + add `stream_ai_completion()` |
| `crates/hadron-server/src/db/mod.rs` | Add `global_settings` CRUD + `get_ai_config()` |
| `crates/hadron-server/src/routes/mod.rs` | Add admin AI config routes |
| `crates/hadron-server/src/routes/admin.rs` | Add AI config handlers |
| `crates/hadron-server/src/routes/analyses.rs` | Make `api_key` optional, server-key fallback |
| `crates/hadron-server/src/routes/chat.rs` | Make `api_key` optional, server-key fallback |
| `crates/hadron-server/Cargo.toml` | Add `aes-gcm` crate |
| `hadron-core/models.rs` | Make `api_key` optional in `AnalyzeRequest` / `ChatRequest` |
| `frontend/src/services/api.ts` | Add `getAiConfigStatus()`, `updateAiConfig()`, `testAiConfig()` |
| `frontend/src/components/admin/AdminPanel.tsx` | Add AI Configuration card |
