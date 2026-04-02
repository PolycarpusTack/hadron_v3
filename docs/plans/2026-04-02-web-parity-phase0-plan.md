# Phase 0: Infrastructure Sprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build shared infrastructure (server-side AI keys, hadron-core AI module, reusable SSE hook) that all subsequent web-desktop parity phases depend on.

**Architecture:** Three sub-phases executed in order. 0a adds encrypted global settings + admin AI config endpoints. 0b extracts AI types/prompts/parsers into hadron-core. 0c generalizes the SSE module and adds a frontend `useAiStream` React hook. Existing analysis/chat flows gain a server-key fallback chain so per-request keys remain optional.

**Tech Stack:** Rust (Axum 0.8, sqlx, aes-gcm), React 18 + TypeScript, PostgreSQL

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `migrations/013_global_settings.sql` | `global_settings` table |
| `crates/hadron-server/src/crypto.rs` | AES-256-GCM encrypt/decrypt using `SERVER_ENCRYPTION_KEY` env |
| `crates/hadron-core/src/ai/mod.rs` | AI module root — re-exports types, prompts, parsers |
| `crates/hadron-core/src/ai/types.rs` | `AiProvider`, `AiMessage`, `AiConfig` (transport-agnostic) |
| `crates/hadron-core/src/ai/prompts.rs` | System prompts + prompt builders |
| `crates/hadron-core/src/ai/parsers.rs` | `strip_markdown_fences()`, JSON response parsers |
| `frontend/src/hooks/useAiStream.ts` | Shared SSE streaming React hook |
| `frontend/src/components/admin/AiConfigPanel.tsx` | Admin AI configuration card |

### Modified files

| File | Change |
|------|--------|
| `crates/hadron-core/src/lib.rs` | Add `pub mod ai` |
| `crates/hadron-server/Cargo.toml` | Add `aes-gcm = "0.10"` and `rand = "0.8"` |
| `crates/hadron-server/src/main.rs` | Add `mod crypto` |
| `crates/hadron-server/src/ai/mod.rs` | Import types from hadron-core, remove prompt constants, keep transport layer |
| `crates/hadron-server/src/sse/mod.rs` | Rename `chat_stream_response` → `stream_response`, add `stream_ai_completion()` |
| `crates/hadron-server/src/db/mod.rs` | Add `global_settings` CRUD + `get_server_ai_config()` |
| `crates/hadron-server/src/routes/mod.rs` | Add admin AI config routes |
| `crates/hadron-server/src/routes/admin.rs` | Add AI config GET/PUT/test handlers |
| `crates/hadron-server/src/routes/analyses.rs` | Make `api_key` optional with server-key fallback |
| `crates/hadron-server/src/routes/chat.rs` | Make `api_key` optional with server-key fallback |
| `crates/hadron-core/src/models.rs` | Make `api_key` optional in `AnalyzeRequest` / `ChatRequest` |
| `frontend/src/services/api.ts` | Add `getAiConfigStatus()`, `updateAiConfig()`, `testAiConfig()` methods + `AiConfigStatus` type |
| `frontend/src/components/admin/AdminPanel.tsx` | Add "AI Config" tab, render `AiConfigPanel` |

---

## Task 1: Database Migration — `global_settings` Table

**Files:**
- Create: `hadron-web/migrations/013_global_settings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 013_global_settings.sql
-- Server-side configuration (AI keys, feature flags, etc.)

CREATE TABLE global_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID REFERENCES users(id)
);

-- Seed AI configuration keys with empty defaults
INSERT INTO global_settings (key, value) VALUES
    ('ai_provider', 'openai'),
    ('ai_model_openai', 'gpt-4o'),
    ('ai_model_anthropic', 'claude-sonnet-4-20250514'),
    ('ai_api_key_openai', ''),
    ('ai_api_key_anthropic', '');
```

- [ ] **Step 2: Verify migration file ordering**

Run: `ls hadron-web/migrations/ | tail -3`
Expected: `013_global_settings.sql` appears after `012_gold_analyses.sql`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/migrations/013_global_settings.sql
git commit -m "feat(web): add migration 013 — global_settings table for server-side AI config"
```

---

## Task 2: Encryption Helpers — `crypto.rs`

**Files:**
- Create: `hadron-web/crates/hadron-server/src/crypto.rs`
- Modify: `hadron-web/crates/hadron-server/Cargo.toml`
- Modify: `hadron-web/crates/hadron-server/src/main.rs`

- [ ] **Step 1: Add dependencies to `hadron-server/Cargo.toml`**

Add under `[dependencies]`:

```toml
# Encryption
aes-gcm = "0.10"
rand = "0.8"
```

- [ ] **Step 2: Write `crypto.rs`**

```rust
//! AES-256-GCM encryption for sensitive global settings (API keys).
//!
//! Uses `SERVER_ENCRYPTION_KEY` env var (64 hex chars = 32 bytes).
//! Values are stored as hex(nonce || ciphertext || tag).

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use hadron_core::error::{HadronError, HadronResult};
use rand::RngCore;
use std::sync::LazyLock;

static ENCRYPTION_KEY: LazyLock<Option<[u8; 32]>> = LazyLock::new(|| {
    std::env::var("SERVER_ENCRYPTION_KEY")
        .ok()
        .and_then(|s| {
            let bytes = hex::decode(s.trim()).ok()?;
            if bytes.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&bytes);
                Some(key)
            } else {
                tracing::error!(
                    "SERVER_ENCRYPTION_KEY must be 64 hex chars (32 bytes), got {} bytes",
                    bytes.len()
                );
                None
            }
        })
});

/// Encrypt a plaintext string. Returns hex-encoded nonce+ciphertext.
/// If no encryption key is configured, returns the plaintext as-is (dev mode).
pub fn encrypt_value(plaintext: &str) -> HadronResult<String> {
    let Some(key_bytes) = ENCRYPTION_KEY.as_ref() else {
        tracing::warn!("SERVER_ENCRYPTION_KEY not set — storing value unencrypted");
        return Ok(plaintext.to_string());
    };

    let cipher = Aes256Gcm::new_from_slice(key_bytes)
        .map_err(|e| HadronError::Config(format!("Invalid encryption key: {e}")))?;

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| HadronError::Internal(format!("Encryption failed: {e}")))?;

    // Prefix with "enc:" marker, then hex(nonce || ciphertext)
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(format!("enc:{}", hex::encode(combined)))
}

/// Decrypt a value. If not prefixed with "enc:", returns as-is (unencrypted/legacy).
pub fn decrypt_value(stored: &str) -> HadronResult<String> {
    let Some(hex_data) = stored.strip_prefix("enc:") else {
        // Not encrypted — return as-is
        return Ok(stored.to_string());
    };

    let Some(key_bytes) = ENCRYPTION_KEY.as_ref() else {
        return Err(HadronError::Config(
            "SERVER_ENCRYPTION_KEY required to decrypt value".to_string(),
        ));
    };

    let combined = hex::decode(hex_data)
        .map_err(|e| HadronError::Internal(format!("Invalid hex in encrypted value: {e}")))?;

    if combined.len() < 13 {
        return Err(HadronError::Internal("Encrypted value too short".to_string()));
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher = Aes256Gcm::new_from_slice(key_bytes)
        .map_err(|e| HadronError::Config(format!("Invalid encryption key: {e}")))?;

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| HadronError::Internal(format!("Decryption failed: {e}")))?;

    String::from_utf8(plaintext)
        .map_err(|e| HadronError::Internal(format!("Decrypted value is not valid UTF-8: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip_without_key() {
        // Without SERVER_ENCRYPTION_KEY, values pass through unencrypted
        let result = encrypt_value("my-secret").unwrap();
        // Without key, returns plaintext
        let decrypted = decrypt_value(&result).unwrap();
        assert_eq!(decrypted, "my-secret");
    }

    #[test]
    fn test_decrypt_unencrypted_value() {
        // Values without "enc:" prefix are returned as-is
        let result = decrypt_value("plain-value").unwrap();
        assert_eq!(result, "plain-value");
    }
}
```

- [ ] **Step 3: Register the module in `main.rs`**

In `hadron-web/crates/hadron-server/src/main.rs`, add after the existing `mod sse;` line:

```rust
mod crypto;
```

- [ ] **Step 4: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -5`
Expected: no errors related to `crypto`

- [ ] **Step 5: Run tests**

Run: `cd hadron-web && cargo test -p hadron-server crypto 2>&1 | tail -10`
Expected: `test_roundtrip_without_key` and `test_decrypt_unencrypted_value` pass

- [ ] **Step 6: Commit**

```bash
git add hadron-web/crates/hadron-server/Cargo.toml hadron-web/crates/hadron-server/src/crypto.rs hadron-web/crates/hadron-server/src/main.rs
git commit -m "feat(web): add AES-256-GCM crypto module for encrypting API keys at rest"
```

---

## Task 3: Database Functions for Global Settings

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/db/mod.rs`

- [ ] **Step 1: Add global settings DB functions**

Append to the end of `hadron-web/crates/hadron-server/src/db/mod.rs` (before any `#[cfg(test)]` block if present):

```rust
// ============================================================================
// Global Settings
// ============================================================================

pub async fn get_global_setting(pool: &PgPool, key: &str) -> HadronResult<Option<String>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM global_settings WHERE key = $1")
            .bind(key)
            .fetch_optional(pool)
            .await
            .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.map(|(v,)| v))
}

pub async fn set_global_setting(
    pool: &PgPool,
    key: &str,
    value: &str,
    user_id: Uuid,
) -> HadronResult<()> {
    sqlx::query(
        "INSERT INTO global_settings (key, value, updated_at, updated_by)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = $3",
    )
    .bind(key)
    .bind(value)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

/// Load server-side AI configuration from global_settings.
/// Returns None if no API key is configured for the active provider.
pub async fn get_server_ai_config(
    pool: &PgPool,
) -> HadronResult<Option<crate::ai::AiConfig>> {
    use crate::ai::{AiConfig, AiProvider};

    let provider_str = get_global_setting(pool, "ai_provider")
        .await?
        .unwrap_or_else(|| "openai".to_string());

    let provider = AiProvider::from_str(&provider_str);

    let (key_setting, model_setting) = match provider {
        AiProvider::OpenAi => ("ai_api_key_openai", "ai_model_openai"),
        AiProvider::Anthropic => ("ai_api_key_anthropic", "ai_model_anthropic"),
    };

    let encrypted_key = get_global_setting(pool, key_setting).await?;
    let model = get_global_setting(pool, model_setting)
        .await?
        .unwrap_or_else(|| match provider {
            AiProvider::OpenAi => "gpt-4o".to_string(),
            AiProvider::Anthropic => "claude-sonnet-4-20250514".to_string(),
        });

    // Decrypt the API key — empty means not configured
    let api_key = match encrypted_key {
        Some(enc) if !enc.is_empty() => crate::crypto::decrypt_value(&enc)?,
        _ => return Ok(None),
    };

    if api_key.is_empty() {
        return Ok(None);
    }

    Ok(Some(AiConfig {
        provider,
        api_key,
        model,
    }))
}
```

- [ ] **Step 2: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -5`
Expected: compiles cleanly

- [ ] **Step 3: Commit**

```bash
git add hadron-web/crates/hadron-server/src/db/mod.rs
git commit -m "feat(web): add global_settings DB functions with encrypted AI key support"
```

---

## Task 4: Admin AI Config API Routes

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/routes/admin.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Add AI config handlers to `admin.rs`**

Append to the end of `hadron-web/crates/hadron-server/src/routes/admin.rs`:

```rust
// ============================================================================
// AI Configuration (Admin)
// ============================================================================

/// Response for GET /api/admin/ai-config — never returns actual API keys.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigStatusResponse {
    pub provider: String,
    pub model_openai: String,
    pub model_anthropic: String,
    pub has_openai_key: bool,
    pub has_anthropic_key: bool,
}

pub async fn get_ai_config(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    let provider = db::get_global_setting(&state.db, "ai_provider")
        .await?
        .unwrap_or_else(|| "openai".to_string());
    let model_openai = db::get_global_setting(&state.db, "ai_model_openai")
        .await?
        .unwrap_or_else(|| "gpt-4o".to_string());
    let model_anthropic = db::get_global_setting(&state.db, "ai_model_anthropic")
        .await?
        .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());

    let openai_key = db::get_global_setting(&state.db, "ai_api_key_openai")
        .await?
        .unwrap_or_default();
    let anthropic_key = db::get_global_setting(&state.db, "ai_api_key_anthropic")
        .await?
        .unwrap_or_default();

    Ok(Json(AiConfigStatusResponse {
        provider,
        model_openai,
        model_anthropic,
        has_openai_key: !openai_key.is_empty(),
        has_anthropic_key: !anthropic_key.is_empty(),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAiConfigRequest {
    pub provider: Option<String>,
    pub model_openai: Option<String>,
    pub model_anthropic: Option<String>,
    pub api_key_openai: Option<String>,
    pub api_key_anthropic: Option<String>,
}

pub async fn update_ai_config(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<UpdateAiConfigRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    if let Some(ref provider) = req.provider {
        if provider != "openai" && provider != "anthropic" {
            return Err(AppError(hadron_core::error::HadronError::validation(
                "provider must be 'openai' or 'anthropic'",
            )));
        }
        db::set_global_setting(&state.db, "ai_provider", provider, user.user.id).await?;
    }

    if let Some(ref model) = req.model_openai {
        db::set_global_setting(&state.db, "ai_model_openai", model, user.user.id).await?;
    }

    if let Some(ref model) = req.model_anthropic {
        db::set_global_setting(&state.db, "ai_model_anthropic", model, user.user.id).await?;
    }

    if let Some(ref key) = req.api_key_openai {
        let encrypted = crate::crypto::encrypt_value(key)?;
        db::set_global_setting(&state.db, "ai_api_key_openai", &encrypted, user.user.id).await?;
    }

    if let Some(ref key) = req.api_key_anthropic {
        let encrypted = crate::crypto::encrypt_value(key)?;
        db::set_global_setting(&state.db, "ai_api_key_anthropic", &encrypted, user.user.id).await?;
    }

    // Audit log
    let _ = db::write_audit_log(
        &state.db,
        user.user.id,
        "admin.ai_config_updated",
        "global_settings",
        None,
        &serde_json::json!({
            "provider_changed": req.provider.is_some(),
            "openai_key_changed": req.api_key_openai.is_some(),
            "anthropic_key_changed": req.api_key_anthropic.is_some(),
        }),
        None,
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn test_ai_config(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    let config = db::get_server_ai_config(&state.db).await?;
    let config = config.ok_or_else(|| {
        AppError(hadron_core::error::HadronError::validation(
            "No AI API key configured. Save a key first.",
        ))
    })?;

    // Send a minimal completion to test the key
    let test_messages = vec![crate::ai::AiMessage {
        role: "user".to_string(),
        content: "Reply with exactly: OK".to_string(),
    }];

    match crate::ai::complete(&config, test_messages, None).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "success": true,
            "provider": format!("{:?}", config.provider),
            "model": config.model,
        }))),
        Err(e) => Ok(Json(serde_json::json!({
            "success": false,
            "error": e.client_message(),
        }))),
    }
}
```

- [ ] **Step 2: Register routes in `routes/mod.rs`**

In `hadron-web/crates/hadron-server/src/routes/mod.rs`, add these three lines inside `api_router()`, after the existing admin routes (after `.route("/admin/audit-log", get(admin::admin_audit_log))`):

```rust
        // Admin: AI configuration
        .route("/admin/ai-config", get(admin::get_ai_config))
        .route("/admin/ai-config", put(admin::update_ai_config))
        .route("/admin/ai-config/test", post(admin::test_ai_config))
```

- [ ] **Step 3: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -5`
Expected: compiles cleanly

- [ ] **Step 4: Commit**

```bash
git add hadron-web/crates/hadron-server/src/routes/admin.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(web): add admin AI config endpoints (GET/PUT/test)"
```

---

## Task 5: Server-Key Fallback in Analysis & Chat Routes

**Files:**
- Modify: `hadron-web/crates/hadron-core/src/models.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/analyses.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/chat.rs`

- [ ] **Step 1: Make `api_key` optional in `AnalyzeRequest`**

In `hadron-web/crates/hadron-core/src/models.rs`, change the `AnalyzeRequest` struct's `api_key` field from:

```rust
    pub api_key: String,
```

to:

```rust
    pub api_key: Option<String>,
```

- [ ] **Step 2: Make `api_key` optional in `ChatRequest`**

In the same file, change the `ChatRequest` struct's `api_key` field from:

```rust
    pub api_key: String,
```

to:

```rust
    pub api_key: Option<String>,
```

- [ ] **Step 3: Add `resolve_ai_config` helper to `analyses.rs`**

At the top of `hadron-web/crates/hadron-server/src/routes/analyses.rs`, after the existing imports, add:

```rust
/// Resolve AI config: prefer request-provided key, fall back to server-side config.
async fn resolve_ai_config(
    pool: &sqlx::PgPool,
    api_key: Option<&str>,
    model: Option<&str>,
    provider: Option<&str>,
) -> Result<crate::ai::AiConfig, AppError> {
    // If the request includes an API key, use it
    if let Some(key) = api_key {
        if !key.is_empty() {
            return Ok(crate::ai::AiConfig {
                provider: AiProvider::from_str(provider.unwrap_or("openai")),
                api_key: key.to_string(),
                model: model.unwrap_or("gpt-4o").to_string(),
            });
        }
    }

    // Fall back to server-side config
    crate::db::get_server_ai_config(pool)
        .await?
        .ok_or_else(|| {
            AppError(hadron_core::error::HadronError::validation(
                "No AI configuration available. Ask an admin to configure API keys, or provide your own.",
            ))
        })
}
```

- [ ] **Step 4: Update `upload_and_analyze` to use fallback**

In `analyses.rs`, the `upload_and_analyze` handler currently has:

```rust
    let api_key = api_key
        .ok_or_else(|| AppError(hadron_core::error::HadronError::validation("api_key required")))?;
```

Replace that line and the `let result = run_analysis(...)` call (lines ~111-118) with:

```rust
    let filename = filename.unwrap_or_else(|| "uploaded_file.txt".to_string());
    let model = model.unwrap_or_else(|| "gpt-4o".to_string());
    let provider_str = provider.unwrap_or_else(|| "openai".to_string());

    let ai_config = resolve_ai_config(
        &state.db,
        api_key.as_deref(),
        Some(&model),
        Some(&provider_str),
    ).await?;

    let result =
        run_analysis_with_config(&state, &user, &content, &filename, &ai_config, None).await?;
```

Note: You will also need to remove the duplicate `let filename`, `let model`, `let provider_str` lines that follow the original `api_key` validation, since they are now above it.

- [ ] **Step 5: Update `analyze_content` to use fallback**

Replace the body of `analyze_content` with:

```rust
    let filename = req.filename.unwrap_or_else(|| "pasted_content.txt".to_string());
    let provider = req.provider.unwrap_or_else(|| "openai".to_string());
    let mode = req.analysis_mode.as_deref();

    let ai_config = resolve_ai_config(
        &state.db,
        req.api_key.as_deref(),
        Some(&req.model),
        Some(&provider),
    ).await?;

    let result =
        run_analysis_with_config(&state, &user, &req.content, &filename, &ai_config, mode).await?;

    Ok((StatusCode::CREATED, Json(result)))
```

- [ ] **Step 6: Refactor `run_analysis` to accept `AiConfig` directly**

Rename `run_analysis` to `run_analysis_with_config` and change its signature from:

```rust
async fn run_analysis(
    state: &AppState,
    user: &AuthenticatedUser,
    content: &str,
    filename: &str,
    api_key: &str,
    model: &str,
    provider: &str,
    analysis_mode: Option<&str>,
) -> Result<AnalysisResponse, AppError> {
```

to:

```rust
async fn run_analysis_with_config(
    state: &AppState,
    user: &AuthenticatedUser,
    content: &str,
    filename: &str,
    ai_config: &AiConfig,
    analysis_mode: Option<&str>,
) -> Result<AnalysisResponse, AppError> {
```

Inside the function body, replace the `AiConfig` construction block (lines ~173-177):

```rust
    let ai_config = AiConfig {
        provider: AiProvider::from_str(provider),
        api_key: api_key.to_string(),
        model: model.to_string(),
    };
```

with just using `ai_config` directly (it's already passed in). Change `ai::complete(...)` call to use the parameter:

```rust
    let ai_response = ai::complete(
        ai_config,
        vec![AiMessage {
            role: "user".to_string(),
            content: prompt,
        }],
        Some(system_prompt),
    )
    .await?;
```

Also update the fire-and-forget embedding block to use `ai_config.api_key` instead of `api_key`:

```rust
    let api_key_clone = ai_config.api_key.clone();
```

And update the audit log to use `ai_config`:

```rust
        &serde_json::json!({ "filename": filename, "model": &ai_config.model, "provider": format!("{:?}", ai_config.provider) }),
```

- [ ] **Step 7: Update `chat_send` for server-key fallback**

In `hadron-web/crates/hadron-server/src/routes/chat.rs`, replace the AI config construction block (lines ~102-108):

```rust
    let ai_config = AiConfig {
        provider: AiProvider::from_str(
            req.provider.as_deref().unwrap_or("openai"),
        ),
        api_key: req.api_key.clone(),
        model: req.model.unwrap_or_else(|| "gpt-4o".to_string()),
    };
```

with:

```rust
    // Resolve AI config: request key > server key
    let ai_config = if let Some(ref key) = req.api_key {
        if !key.is_empty() {
            AiConfig {
                provider: AiProvider::from_str(req.provider.as_deref().unwrap_or("openai")),
                api_key: key.clone(),
                model: req.model.unwrap_or_else(|| "gpt-4o".to_string()),
            }
        } else {
            db::get_server_ai_config(&state.db)
                .await
                .map_err(AppError::from)?
                .ok_or_else(|| AppError(HadronError::validation(
                    "No AI configuration available. Ask an admin to configure API keys, or provide your own.",
                )))?
        }
    } else {
        db::get_server_ai_config(&state.db)
            .await
            .map_err(AppError::from)?
            .ok_or_else(|| AppError(HadronError::validation(
                "No AI configuration available. Ask an admin to configure API keys, or provide your own.",
            )))?
    };
```

- [ ] **Step 8: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`
Expected: compiles cleanly

- [ ] **Step 9: Commit**

```bash
git add hadron-web/crates/hadron-core/src/models.rs hadron-web/crates/hadron-server/src/routes/analyses.rs hadron-web/crates/hadron-server/src/routes/chat.rs
git commit -m "feat(web): server-side AI key fallback — api_key now optional in analysis and chat"
```

---

## Task 6: hadron-core AI Module — Types

**Files:**
- Create: `hadron-web/crates/hadron-core/src/ai/mod.rs`
- Create: `hadron-web/crates/hadron-core/src/ai/types.rs`
- Modify: `hadron-web/crates/hadron-core/src/lib.rs`

- [ ] **Step 1: Create the `ai` directory**

Run: `mkdir -p hadron-web/crates/hadron-core/src/ai`

- [ ] **Step 2: Write `ai/types.rs`**

```rust
//! Transport-agnostic AI types shared between hadron-core and hadron-server.

use serde::{Deserialize, Serialize};

/// AI provider selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AiProvider {
    OpenAi,
    Anthropic,
}

impl AiProvider {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "anthropic" | "claude" => AiProvider::Anthropic,
            _ => AiProvider::OpenAi,
        }
    }
}

impl std::fmt::Display for AiProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AiProvider::OpenAi => write!(f, "openai"),
            AiProvider::Anthropic => write!(f, "anthropic"),
        }
    }
}

/// A message in an AI conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

/// Configuration for an AI API call.
#[derive(Debug, Clone)]
pub struct AiConfig {
    pub provider: AiProvider,
    pub api_key: String,
    pub model: String,
}
```

- [ ] **Step 3: Write `ai/mod.rs`**

```rust
//! AI module — types, prompts, and response parsers.
//!
//! Transport-agnostic: no HTTP client, no async runtime.
//! The server layer handles actual API calls.

pub mod types;
pub mod prompts;
pub mod parsers;

pub use types::{AiConfig, AiMessage, AiProvider};
pub use prompts::*;
pub use parsers::*;
```

- [ ] **Step 4: Register in `lib.rs`**

In `hadron-web/crates/hadron-core/src/lib.rs`, add:

```rust
pub mod ai;
```

- [ ] **Step 5: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check -p hadron-core 2>&1 | tail -5`

Note: This will fail because `prompts` and `parsers` modules don't exist yet. That's expected — we'll create them in the next tasks. For now, temporarily comment out `pub mod prompts;`, `pub mod parsers;`, and the corresponding `pub use` lines in `ai/mod.rs` to verify types compile:

```rust
pub mod types;
// pub mod prompts;
// pub mod parsers;

pub use types::{AiConfig, AiMessage, AiProvider};
```

Expected: compiles cleanly

- [ ] **Step 6: Commit (types only)**

```bash
git add hadron-web/crates/hadron-core/src/ai/ hadron-web/crates/hadron-core/src/lib.rs
git commit -m "feat(web): add hadron-core::ai module with transport-agnostic types"
```

---

## Task 7: hadron-core AI Module — Prompts

**Files:**
- Create: `hadron-web/crates/hadron-core/src/ai/prompts.rs`
- Modify: `hadron-web/crates/hadron-core/src/ai/mod.rs` (uncomment prompts)

- [ ] **Step 1: Write `ai/prompts.rs`**

```rust
//! System prompts for all AI features.
//!
//! Centralizes prompts so hadron-server and future consumers share the same prompt text.

use super::types::AiMessage;

/// System prompt for crash log analysis.
pub const CRASH_ANALYSIS_PROMPT: &str = r#"You are Hadron, an expert crash log analyzer for the WHATS'ON / MediaGeniX broadcast management system.

Analyze the provided crash log and return a JSON response with this exact structure:
{
  "error_type": "The exception/error class name",
  "error_message": "Brief description of the error",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "component": "The affected module (PSI, BM, PL, WOn, EX, or null)",
  "root_cause": "Technical explanation of why the crash occurred",
  "suggested_fixes": ["Fix 1", "Fix 2", "Fix 3"],
  "confidence": "HIGH|MEDIUM|LOW"
}

Focus on:
1. Identifying the exact exception type and where it originated
2. Tracing the call chain from the error back to application code
3. Distinguishing application bugs from framework/environmental issues
4. Providing actionable, specific fix suggestions

Return ONLY valid JSON, no markdown formatting."#;

/// System prompt for chat interactions.
pub const CHAT_SYSTEM_PROMPT: &str = r#"You are Hadron, an AI assistant specialized in crash analysis and support for the WHATS'ON / MediaGeniX broadcast management system.

You help users understand crash logs, debug issues, and find solutions. You have deep knowledge of:
- WHATS'ON architecture (PSI, BM, PL, WOn, EX modules)
- Common crash patterns and their resolutions
- Database issues (Oracle, PostgreSQL)
- Smalltalk/VisualWorks runtime errors

Be concise, technical, and actionable. Reference specific modules and methods when relevant."#;

/// System prompt for 6-tab code analysis (Phase 1a).
pub const CODE_ANALYSIS_PROMPT: &str = r#"You are Hadron, an expert code analyzer. Analyze the provided source code and return a JSON response with this exact structure:

{
  "overview": {
    "summary": "2-3 sentence summary of what this code does",
    "language": "detected programming language",
    "linesOfCode": 0,
    "complexity": "LOW|MEDIUM|HIGH",
    "purpose": "brief purpose description"
  },
  "walkthrough": [
    {
      "section": "Section name",
      "startLine": 1,
      "endLine": 10,
      "explanation": "What this section does",
      "keyPoints": ["point 1", "point 2"]
    }
  ],
  "issues": [
    {
      "id": "ISS-001",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO",
      "category": "Bug|Performance|Security|Style|Logic|Error Handling",
      "title": "Brief issue title",
      "description": "Detailed explanation",
      "line": 42,
      "suggestion": "How to fix it"
    }
  ],
  "optimized": {
    "code": "The full optimized version of the code",
    "changes": ["Change 1 description", "Change 2 description"]
  },
  "quality": {
    "overall": 75,
    "readability": 80,
    "maintainability": 70,
    "reliability": 75,
    "security": 65,
    "performance": 80
  },
  "glossary": [
    {
      "term": "Term name",
      "definition": "What it means in this context",
      "relatedTerms": ["related1"]
    }
  ]
}

Analyze thoroughly. Every issue must have a specific line number. Quality scores are 0-100.
Return ONLY valid JSON, no markdown formatting."#;

/// Build the messages array for a code analysis request.
pub fn build_code_analysis_messages(code: &str, language: &str) -> Vec<AiMessage> {
    vec![AiMessage {
        role: "user".to_string(),
        content: format!(
            "Analyze this {} code:\n\n```{}\n{}\n```",
            language, language, code
        ),
    }]
}

/// Build the messages array for a crash analysis request.
pub fn build_crash_analysis_messages(content: &str) -> Vec<AiMessage> {
    vec![AiMessage {
        role: "user".to_string(),
        content: format!("Analyze this crash log:\n\n{content}"),
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_code_analysis_messages() {
        let msgs = build_code_analysis_messages("fn main() {}", "rust");
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, "user");
        assert!(msgs[0].content.contains("rust"));
        assert!(msgs[0].content.contains("fn main() {}"));
    }

    #[test]
    fn test_build_crash_analysis_messages() {
        let msgs = build_crash_analysis_messages("ERROR: NullPointerException");
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].content.contains("NullPointerException"));
    }
}
```

- [ ] **Step 2: Uncomment prompts in `ai/mod.rs`**

Update `hadron-web/crates/hadron-core/src/ai/mod.rs` to:

```rust
pub mod types;
pub mod prompts;
// pub mod parsers;  // Task 8

pub use types::{AiConfig, AiMessage, AiProvider};
pub use prompts::*;
```

- [ ] **Step 3: Run tests**

Run: `cd hadron-web && cargo test -p hadron-core ai::prompts 2>&1 | tail -10`
Expected: both tests pass

- [ ] **Step 4: Commit**

```bash
git add hadron-web/crates/hadron-core/src/ai/
git commit -m "feat(web): add centralized AI prompts to hadron-core (crash, chat, code analysis)"
```

---

## Task 8: hadron-core AI Module — Parsers

**Files:**
- Create: `hadron-web/crates/hadron-core/src/ai/parsers.rs`
- Modify: `hadron-web/crates/hadron-core/src/ai/mod.rs` (uncomment parsers)

- [ ] **Step 1: Write `ai/parsers.rs`**

```rust
//! AI response parsers — extract structured data from AI text output.

use crate::error::{HadronError, HadronResult};
use serde::{Deserialize, Serialize};

/// Strip markdown code fences from AI output.
///
/// Handles `\`\`\`json ... \`\`\`` and `\`\`\` ... \`\`\`` wrappers.
pub fn strip_markdown_fences(raw: &str) -> &str {
    let trimmed = raw.trim();

    // Try ```json or ```JSON first
    for marker in ["```json", "```JSON", "```"] {
        if let Some(start_idx) = trimmed.find(marker) {
            let content_start = start_idx + marker.len();
            if let Some(end_idx) = trimmed[content_start..].find("```") {
                let block = trimmed[content_start..content_start + end_idx].trim();
                if !block.is_empty() {
                    return block;
                }
            }
        }
    }

    trimmed
}

// ============================================================================
// Code Analysis Types & Parser
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeAnalysisResult {
    #[serde(default)]
    pub overview: CodeOverview,
    #[serde(default)]
    pub walkthrough: Vec<WalkthroughSection>,
    #[serde(default)]
    pub issues: Vec<CodeIssue>,
    #[serde(default)]
    pub optimized: OptimizedCode,
    #[serde(default)]
    pub quality: CodeQualityScores,
    #[serde(default)]
    pub glossary: Vec<GlossaryTerm>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeOverview {
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub lines_of_code: u32,
    #[serde(default)]
    pub complexity: String,
    #[serde(default)]
    pub purpose: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WalkthroughSection {
    #[serde(default)]
    pub section: String,
    #[serde(default)]
    pub start_line: u32,
    #[serde(default)]
    pub end_line: u32,
    #[serde(default)]
    pub explanation: String,
    #[serde(default)]
    pub key_points: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeIssue {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub line: u32,
    #[serde(default)]
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OptimizedCode {
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub changes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeQualityScores {
    #[serde(default)]
    pub overall: u8,
    #[serde(default)]
    pub readability: u8,
    #[serde(default)]
    pub maintainability: u8,
    #[serde(default)]
    pub reliability: u8,
    #[serde(default)]
    pub security: u8,
    #[serde(default)]
    pub performance: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryTerm {
    #[serde(default)]
    pub term: String,
    #[serde(default)]
    pub definition: String,
    #[serde(default)]
    pub related_terms: Vec<String>,
}

/// Parse an AI response into a CodeAnalysisResult.
pub fn parse_code_analysis(raw: &str) -> HadronResult<CodeAnalysisResult> {
    let json_str = strip_markdown_fences(raw);
    serde_json::from_str(json_str).map_err(|e| {
        HadronError::Parse(format!("Failed to parse code analysis response: {e}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_markdown_fences_json() {
        let input = "Here is the result:\n\n```json\n{\"key\": \"value\"}\n```\n\nDone.";
        assert_eq!(strip_markdown_fences(input), r#"{"key": "value"}"#);
    }

    #[test]
    fn test_strip_markdown_fences_plain() {
        let input = r#"{"key": "value"}"#;
        assert_eq!(strip_markdown_fences(input), r#"{"key": "value"}"#);
    }

    #[test]
    fn test_parse_code_analysis_valid() {
        let input = r#"{"overview":{"summary":"test","language":"rust","linesOfCode":10,"complexity":"LOW","purpose":"test"},"walkthrough":[],"issues":[],"optimized":{"code":"","changes":[]},"quality":{"overall":80,"readability":85,"maintainability":75,"reliability":80,"security":70,"performance":90},"glossary":[]}"#;
        let result = parse_code_analysis(input).unwrap();
        assert_eq!(result.overview.language, "rust");
        assert_eq!(result.quality.overall, 80);
    }

    #[test]
    fn test_parse_code_analysis_with_fences() {
        let input = "```json\n{\"overview\":{\"summary\":\"hello\",\"language\":\"python\"},\"walkthrough\":[],\"issues\":[],\"optimized\":{\"code\":\"\",\"changes\":[]},\"quality\":{\"overall\":50},\"glossary\":[]}\n```";
        let result = parse_code_analysis(input).unwrap();
        assert_eq!(result.overview.language, "python");
    }

    #[test]
    fn test_parse_code_analysis_defaults() {
        // Minimal JSON with missing fields — should use defaults
        let input = r#"{"overview":{}}"#;
        let result = parse_code_analysis(input).unwrap();
        assert_eq!(result.overview.summary, "");
        assert_eq!(result.quality.overall, 0);
        assert!(result.issues.is_empty());
    }
}
```

- [ ] **Step 2: Uncomment parsers in `ai/mod.rs`**

Update `hadron-web/crates/hadron-core/src/ai/mod.rs` to its final form:

```rust
//! AI module — types, prompts, and response parsers.
//!
//! Transport-agnostic: no HTTP client, no async runtime.
//! The server layer handles actual API calls.

pub mod types;
pub mod prompts;
pub mod parsers;

pub use types::{AiConfig, AiMessage, AiProvider};
pub use prompts::*;
pub use parsers::*;
```

- [ ] **Step 3: Run all hadron-core tests**

Run: `cd hadron-web && cargo test -p hadron-core 2>&1 | tail -15`
Expected: all tests pass (existing + new ai module tests)

- [ ] **Step 4: Commit**

```bash
git add hadron-web/crates/hadron-core/src/ai/
git commit -m "feat(web): add AI response parsers to hadron-core (code analysis types + markdown fence stripping)"
```

---

## Task 9: Migrate hadron-server AI Module to Use hadron-core Types

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/ai/mod.rs`

- [ ] **Step 1: Replace server-side types with hadron-core re-exports**

In `hadron-web/crates/hadron-server/src/ai/mod.rs`, replace the top section (lines 1-48) with:

```rust
//! AI service — HTTP transport for OpenAI and Anthropic APIs.
//!
//! Types and prompts come from hadron-core::ai. This module handles
//! the actual HTTP calls (reqwest) and SSE stream parsing.

pub mod tools;

// Re-export core types so existing `use crate::ai::*` imports keep working
pub use hadron_core::ai::{AiConfig, AiMessage, AiProvider};
pub use hadron_core::ai::prompts::{
    CRASH_ANALYSIS_PROMPT, CHAT_SYSTEM_PROMPT, CODE_ANALYSIS_PROMPT,
};

use hadron_core::error::{HadronError, HadronResult};
use hadron_core::models::ChatStreamEvent;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
```

Then **delete** the following blocks that are now in hadron-core:
- The `AiConfig` struct (lines ~14-19)
- The `AiProvider` enum and its `impl` blocks (lines ~21-41)
- The `AiMessage` struct (lines ~43-48)

And **delete** the system prompt constants at the bottom of the file:
- `ANALYSIS_SYSTEM_PROMPT` (rename reference sites to `CRASH_ANALYSIS_PROMPT`)
- `CODE_ANALYSIS_PROMPT` (already re-exported)
- `CHAT_SYSTEM_PROMPT` (already re-exported)

- [ ] **Step 2: Update `analyses.rs` prompt reference**

In `hadron-web/crates/hadron-server/src/routes/analyses.rs`, the `run_analysis_with_config` function references `ai::ANALYSIS_SYSTEM_PROMPT` and `ai::CODE_ANALYSIS_PROMPT`. Update:

```rust
    let system_prompt = match analysis_mode {
        Some("code_review") => ai::CODE_ANALYSIS_PROMPT,
        _ => ai::CRASH_ANALYSIS_PROMPT,
    };
```

(Change `ai::ANALYSIS_SYSTEM_PROMPT` to `ai::CRASH_ANALYSIS_PROMPT`)

- [ ] **Step 3: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`
Expected: compiles cleanly — all existing `use crate::ai::*` imports in routes still resolve via re-exports

- [ ] **Step 4: Run all tests**

Run: `cd hadron-web && cargo test 2>&1 | tail -15`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add hadron-web/crates/hadron-server/src/ai/mod.rs hadron-web/crates/hadron-server/src/routes/analyses.rs
git commit -m "refactor(web): migrate server AI module to use hadron-core types and prompts"
```

---

## Task 10: Generalize SSE Module

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/sse/mod.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/chat.rs` (update call site)

- [ ] **Step 1: Update `sse/mod.rs`**

Replace the entire contents of `hadron-web/crates/hadron-server/src/sse/mod.rs` with:

```rust
//! Server-Sent Events for streaming AI responses and long-running operations.

use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::Stream;
use futures::StreamExt;
use hadron_core::models::ChatStreamEvent;
use std::convert::Infallible;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

/// Create an SSE response from a channel receiver.
///
/// The caller spawns a task that sends `ChatStreamEvent` into the `tx` side.
/// This function wraps the `rx` side into an Axum SSE response.
pub fn stream_response(
    rx: mpsc::Receiver<ChatStreamEvent>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = ReceiverStream::new(rx).map(|event| {
        let data = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
        Ok(Event::default().data(data))
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    )
}

/// Convenience: spawn an AI streaming call and return the SSE response.
///
/// This eliminates the channel-setup boilerplate in every streaming route.
pub fn stream_ai_completion(
    config: hadron_core::ai::AiConfig,
    messages: Vec<hadron_core::ai::AiMessage>,
    system_prompt: Option<String>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let (tx, rx) = mpsc::channel::<ChatStreamEvent>(100);

    tokio::spawn(async move {
        let result = crate::ai::stream_completion(
            &config,
            messages,
            system_prompt.as_deref(),
            tx.clone(),
        )
        .await;

        match result {
            Ok(_) => {
                let _ = tx
                    .send(ChatStreamEvent::Done {
                        session_id: String::new(),
                    })
                    .await;
            }
            Err(e) => {
                let _ = tx
                    .send(ChatStreamEvent::Error {
                        message: e.client_message(),
                    })
                    .await;
            }
        }
    });

    stream_response(rx)
}
```

- [ ] **Step 2: Update chat.rs to use renamed function**

In `hadron-web/crates/hadron-server/src/routes/chat.rs`, change the last line of `chat_send` from:

```rust
    Ok(sse::chat_stream_response(rx))
```

to:

```rust
    Ok(sse::stream_response(rx))
```

- [ ] **Step 3: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -5`
Expected: compiles cleanly

- [ ] **Step 4: Commit**

```bash
git add hadron-web/crates/hadron-server/src/sse/mod.rs hadron-web/crates/hadron-server/src/routes/chat.rs
git commit -m "refactor(web): generalize SSE module — stream_response + stream_ai_completion helper"
```

---

## Task 11: Frontend — `useAiStream` Hook

**Files:**
- Create: `hadron-web/frontend/src/hooks/useAiStream.ts`

- [ ] **Step 1: Write the hook**

```typescript
/**
 * useAiStream — shared React hook for streaming AI responses via SSE.
 *
 * Uses fetch() + ReadableStream (not EventSource) so we can POST with auth headers.
 * Parses SSE `data:` lines into ChatStreamEvent objects.
 */

import { useCallback, useRef, useState } from "react";
import { acquireToken } from "../auth/msal";

const DEV_MODE = import.meta.env.VITE_AUTH_MODE === "dev";
const API_BASE = "/api";

export interface ChatStreamEvent {
  type: "token" | "toolUse" | "toolResult" | "done" | "error";
  content?: string;
  toolName?: string;
  args?: string;
  sessionId?: string;
  message?: string;
}

export interface UseAiStreamReturn {
  /** Start streaming from the given API path with the given request body. */
  streamAi: (path: string, body: object) => void;
  /** Accumulated text content from token events. */
  content: string;
  /** Whether we are currently receiving tokens. */
  isStreaming: boolean;
  /** Error message if the stream failed. */
  error: string | null;
  /** Raw stream events (all types, not just tokens). */
  events: ChatStreamEvent[];
  /** Reset state for a new request. */
  reset: () => void;
}

export function useAiStream(): UseAiStreamReturn {
  const [content, setContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<ChatStreamEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setContent("");
    setIsStreaming(false);
    setError(null);
    setEvents([]);
  }, []);

  const streamAi = useCallback(
    async (path: string, body: object) => {
      // Abort any in-flight request
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;

      setContent("");
      setIsStreaming(true);
      setError(null);
      setEvents([]);

      try {
        const token = DEV_MODE ? "dev" : await acquireToken();

        const response = await fetch(`${API_BASE}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({
            error: `HTTP ${response.status}`,
          }));
          setError(err.error || `HTTP ${response.status}`);
          setIsStreaming(false);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          setError("No response body");
          setIsStreaming(false);
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (!data) continue;

              try {
                const event: ChatStreamEvent = JSON.parse(data);
                setEvents((prev) => [...prev, event]);

                switch (event.type) {
                  case "token":
                    if (event.content) {
                      setContent((prev) => prev + event.content);
                    }
                    break;
                  case "done":
                    setIsStreaming(false);
                    break;
                  case "error":
                    setError(event.message || "Stream error");
                    setIsStreaming(false);
                    break;
                }
              } catch {
                // Skip malformed events
              }
            }
          }
        }

        // Stream ended without explicit done event
        setIsStreaming(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // User cancelled — not an error
          setIsStreaming(false);
          return;
        }
        setError(err instanceof Error ? err.message : "Stream failed");
        setIsStreaming(false);
      }
    },
    [],
  );

  return { streamAi, content, isStreaming, error, events, reset };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors related to `useAiStream`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/hooks/useAiStream.ts
git commit -m "feat(web): add useAiStream React hook for shared SSE streaming"
```

---

## Task 12: Frontend — AI Config Admin Panel + API Methods

**Files:**
- Modify: `hadron-web/frontend/src/services/api.ts`
- Create: `hadron-web/frontend/src/components/admin/AiConfigPanel.tsx`
- Modify: `hadron-web/frontend/src/components/admin/AdminPanel.tsx`

- [ ] **Step 1: Add types and API methods to `api.ts`**

In `hadron-web/frontend/src/services/api.ts`, add the type after the existing `PatternMatch` interface (around line 256):

```typescript
export interface AiConfigStatus {
  provider: string;
  modelOpenai: string;
  modelAnthropic: string;
  hasOpenaiKey: boolean;
  hasAnthropicKey: boolean;
}

export interface AiConfigTestResult {
  success: boolean;
  provider?: string;
  model?: string;
  error?: string;
}
```

Then add these methods inside the `ApiClient` class, after the existing admin methods (after `getAuditLog`):

```typescript
  // === AI Config (Admin) ===

  async getAiConfigStatus(): Promise<AiConfigStatus> {
    return this.request("GET", "/admin/ai-config");
  }

  async updateAiConfig(config: {
    provider?: string;
    modelOpenai?: string;
    modelAnthropic?: string;
    apiKeyOpenai?: string;
    apiKeyAnthropic?: string;
  }): Promise<void> {
    return this.request("PUT", "/admin/ai-config", config);
  }

  async testAiConfig(): Promise<AiConfigTestResult> {
    return this.request("POST", "/admin/ai-config/test");
  }
```

- [ ] **Step 2: Write `AiConfigPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, AiConfigStatus } from "../../services/api";
import { useToast } from "../Toast";

export function AiConfigPanel() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [config, setConfig] = useState<AiConfigStatus | null>(null);

  // Form state
  const [provider, setProvider] = useState("openai");
  const [modelOpenai, setModelOpenai] = useState("gpt-4o");
  const [modelAnthropic, setModelAnthropic] = useState("claude-sonnet-4-20250514");
  const [apiKeyOpenai, setApiKeyOpenai] = useState("");
  const [apiKeyAnthropic, setApiKeyAnthropic] = useState("");

  useEffect(() => {
    api
      .getAiConfigStatus()
      .then((c) => {
        setConfig(c);
        setProvider(c.provider);
        setModelOpenai(c.modelOpenai);
        setModelAnthropic(c.modelAnthropic);
      })
      .catch((e) =>
        toast.error(e instanceof Error ? e.message : "Failed to load AI config"),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const update: Record<string, string> = {
        provider,
        modelOpenai,
        modelAnthropic,
      };
      // Only send keys if the user typed something new
      if (apiKeyOpenai) update.apiKeyOpenai = apiKeyOpenai;
      if (apiKeyAnthropic) update.apiKeyAnthropic = apiKeyAnthropic;

      await api.updateAiConfig(update);

      // Refresh status
      const updated = await api.getAiConfigStatus();
      setConfig(updated);
      setApiKeyOpenai("");
      setApiKeyAnthropic("");
      toast.success("AI configuration saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await api.testAiConfig();
      if (result.success) {
        toast.success(`Connection successful (${result.provider} / ${result.model})`);
      } else {
        toast.error(`Connection failed: ${result.error}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-slate-400">
        Loading AI configuration...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
        <h3 className="mb-4 text-lg font-semibold text-white">
          AI Provider Configuration
        </h3>
        <p className="mb-4 text-sm text-slate-400">
          Configure a server-side AI API key so users don't need to provide their
          own. Keys are encrypted at rest.
        </p>

        {/* Provider selector */}
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-300">
            Active Provider
          </label>
          <div className="flex gap-3">
            {(["openai", "anthropic"] as const).map((p) => (
              <label
                key={p}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors ${
                  provider === p
                    ? "border-blue-500 bg-blue-500/10 text-blue-400"
                    : "border-slate-600 text-slate-400 hover:border-slate-500"
                }`}
              >
                <input
                  type="radio"
                  name="provider"
                  value={p}
                  checked={provider === p}
                  onChange={() => setProvider(p)}
                  className="sr-only"
                />
                {p === "openai" ? "OpenAI" : "Anthropic"}
              </label>
            ))}
          </div>
        </div>

        {/* OpenAI section */}
        <div className="mb-4 rounded-md border border-slate-700 p-4">
          <h4 className="mb-2 text-sm font-medium text-slate-300">OpenAI</h4>
          <div className="mb-3">
            <label className="mb-1 block text-xs text-slate-400">Model</label>
            <input
              type="text"
              value={modelOpenai}
              onChange={(e) => setModelOpenai(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
              placeholder="gpt-4o"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">API Key</label>
            <input
              type="password"
              value={apiKeyOpenai}
              onChange={(e) => setApiKeyOpenai(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
              placeholder={
                config?.hasOpenaiKey
                  ? "••••••••••••••• (configured)"
                  : "sk-..."
              }
            />
          </div>
        </div>

        {/* Anthropic section */}
        <div className="mb-4 rounded-md border border-slate-700 p-4">
          <h4 className="mb-2 text-sm font-medium text-slate-300">Anthropic</h4>
          <div className="mb-3">
            <label className="mb-1 block text-xs text-slate-400">Model</label>
            <input
              type="text"
              value={modelAnthropic}
              onChange={(e) => setModelAnthropic(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
              placeholder="claude-sonnet-4-20250514"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">API Key</label>
            <input
              type="password"
              value={apiKeyAnthropic}
              onChange={(e) => setApiKeyAnthropic(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
              placeholder={
                config?.hasAnthropicKey
                  ? "••••••••••••••• (configured)"
                  : "sk-ant-..."
              }
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Configuration"}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || (!config?.hasOpenaiKey && !config?.hasAnthropicKey)}
            className="rounded-md border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add AI Config tab to `AdminPanel.tsx`**

In `hadron-web/frontend/src/components/admin/AdminPanel.tsx`:

Add the import at the top:

```typescript
import { AiConfigPanel } from "./AiConfigPanel";
```

Update the `AdminTab` type from:

```typescript
type AdminTab = "users" | "audit" | "tags" | "gold" | "patterns" | "training";
```

to:

```typescript
type AdminTab = "users" | "ai-config" | "audit" | "tags" | "gold" | "patterns" | "training";
```

Add the tab to the `tabs` array, as the second entry (after `users`):

```typescript
    { key: "ai-config", label: "AI Config" },
```

Add the render block for the tab, after the `{activeTab === "audit" && <AuditLogView />}` line:

```tsx
      {activeTab === "ai-config" && <AiConfigPanel />}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -10`
Expected: no type errors

- [ ] **Step 5: Commit**

```bash
git add hadron-web/frontend/src/services/api.ts hadron-web/frontend/src/components/admin/AiConfigPanel.tsx hadron-web/frontend/src/components/admin/AdminPanel.tsx
git commit -m "feat(web): add AI Config admin panel with provider/model/key management"
```

---

## Task 13: Update sqlx Offline Data

**Files:**
- Modify: `hadron-web/.sqlx/` (regenerated query metadata)

This task is only needed if `SQLX_OFFLINE=true` builds fail due to new queries. The new `global_settings` queries use dynamic `sqlx::query()` (not `query!`), so they don't need compile-time checking. However, if the project uses `sqlx::query!` macros elsewhere, the offline data may need updating.

- [ ] **Step 1: Check if cargo check passes without SQLX_OFFLINE**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`

If it passes cleanly, skip this task.

If it fails with sqlx errors, you need a running Postgres to regenerate:

Run: `cd hadron-web && cargo sqlx prepare -- --workspace`

- [ ] **Step 2: Commit if changes were made**

```bash
git add hadron-web/.sqlx/
git commit -m "chore(web): update sqlx offline query data for new global_settings queries"
```

---

## Task 14: Final Verification

- [ ] **Step 1: Full cargo check**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`
Expected: compiles cleanly

- [ ] **Step 2: Run all Rust tests**

Run: `cd hadron-web && cargo test 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 3: Run frontend type check**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -10`
Expected: no type errors

- [ ] **Step 4: Verify migration file count**

Run: `ls hadron-web/migrations/ | wc -l`
Expected: 13

- [ ] **Step 5: Verify new files exist**

Run: `ls -la hadron-web/crates/hadron-core/src/ai/`
Expected: `mod.rs`, `types.rs`, `prompts.rs`, `parsers.rs`

Run: `ls hadron-web/crates/hadron-server/src/crypto.rs`
Expected: file exists

Run: `ls hadron-web/frontend/src/hooks/useAiStream.ts`
Expected: file exists

Run: `ls hadron-web/frontend/src/components/admin/AiConfigPanel.tsx`
Expected: file exists
