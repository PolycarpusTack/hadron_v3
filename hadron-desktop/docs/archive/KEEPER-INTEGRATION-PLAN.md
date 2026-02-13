# Keeper Secrets Manager Integration - Implementation Plan

## Overview

This document details the implementation plan for integrating Keeper Secrets Manager (KSM) into Hadron v3, enabling users to retrieve API keys from their organization's Keeper vault without ever seeing the actual key values.

## Architecture Decision

**Recommended: Hybrid Approach (Option C)**

- Store Keeper One-Time Token in frontend using existing Tauri encrypted storage
- Create new Tauri/Rust commands to fetch secrets via Keeper SDK
- API key only exists in Rust backend memory during API calls
- User never sees actual API key - only the Keeper connection status

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src-tauri/Cargo.toml` | Modify | Add Keeper SDK dependency |
| `src-tauri/src/keeper_service.rs` | Create | New Keeper integration module |
| `src-tauri/src/main.rs` | Modify | Register new Keeper commands |
| `src-tauri/src/commands.rs` | Modify | Add Keeper-aware API key resolution |
| `src/services/secure-storage.ts` | Modify | Add Keeper config storage functions |
| `src/services/keeper.ts` | Create | Frontend Keeper service |
| `src/components/SettingsPanel.tsx` | Modify | Add Keeper configuration UI |
| `src/types/index.ts` | Modify | Add Keeper-related types |

---

## Detailed Implementation

### 1. Backend: Rust Keeper Service

#### 1.1 Add Dependency to `src-tauri/Cargo.toml`

```toml
[dependencies]
# ... existing dependencies ...

# Keeper Secrets Manager SDK
keeper-secrets-manager-core = "17.0"
```

#### 1.2 Create `src-tauri/src/keeper_service.rs`

```rust
//! Keeper Secrets Manager Integration
//!
//! Provides secure retrieval of API keys from Keeper vault without
//! exposing the actual key values to the frontend.

use keeper_secrets_manager_core::{
    keeper_secrets_manager::SecretsManager,
    storage::FileKeyValueStorage,
    client_options::ClientOptions,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use log;

/// Result of initializing Keeper with a one-time token
#[derive(Debug, Serialize, Deserialize)]
pub struct KeeperInitResult {
    pub success: bool,
    pub message: String,
    pub secrets_count: Option<usize>,
}

/// Information about a secret in Keeper (without the actual value)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KeeperSecretInfo {
    pub uid: String,
    pub title: String,
    pub record_type: String,
}

/// Result of fetching secrets list
#[derive(Debug, Serialize, Deserialize)]
pub struct KeeperSecretsListResult {
    pub success: bool,
    pub secrets: Vec<KeeperSecretInfo>,
    pub message: String,
}

/// Get the Keeper config file path
fn get_keeper_config_path() -> Result<PathBuf, String> {
    let app_dir = dirs::data_dir()
        .ok_or("Failed to get app data directory")?
        .join("Hadron");

    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create app directory: {}", e))?;

    Ok(app_dir.join("keeper-config.json"))
}

/// Initialize Keeper with a one-time access token
pub async fn initialize_keeper(one_time_token: &str) -> Result<KeeperInitResult, String> {
    let config_path = get_keeper_config_path()?;

    log::info!("Initializing Keeper with one-time token");

    // Create storage for Keeper config
    let storage = FileKeyValueStorage::new(&config_path)
        .map_err(|e| format!("Failed to create Keeper storage: {}", e))?;

    // Initialize with one-time token
    let options = ClientOptions::new_client_options_with_token(
        one_time_token.to_string(),
        Box::new(storage),
    );

    let mut secrets_manager = SecretsManager::new(options)
        .map_err(|e| format!("Failed to create Keeper client: {}", e))?;

    // Perform initial fetch to bind the token
    let secrets = secrets_manager.get_secrets(Vec::new())
        .map_err(|e| format!("Failed to fetch secrets: {}", e))?;

    log::info!("Keeper initialized successfully, found {} secrets", secrets.len());

    Ok(KeeperInitResult {
        success: true,
        message: format!("Connected to Keeper. Found {} secrets.", secrets.len()),
        secrets_count: Some(secrets.len()),
    })
}

/// List available secrets (titles only, not values)
pub async fn list_keeper_secrets() -> Result<KeeperSecretsListResult, String> {
    let config_path = get_keeper_config_path()?;

    if !config_path.exists() {
        return Ok(KeeperSecretsListResult {
            success: false,
            secrets: vec![],
            message: "Keeper not configured. Please enter a one-time token first.".to_string(),
        });
    }

    let storage = FileKeyValueStorage::new(&config_path)
        .map_err(|e| format!("Failed to load Keeper config: {}", e))?;

    let options = ClientOptions::new_client_options(Box::new(storage));

    let mut secrets_manager = SecretsManager::new(options)
        .map_err(|e| format!("Failed to create Keeper client: {}", e))?;

    let secrets = secrets_manager.get_secrets(Vec::new())
        .map_err(|e| format!("Failed to fetch secrets: {}", e))?;

    let secret_infos: Vec<KeeperSecretInfo> = secrets
        .iter()
        .map(|s| KeeperSecretInfo {
            uid: s.uid.clone(),
            title: s.title.clone(),
            record_type: s.record_type.clone(),
        })
        .collect();

    Ok(KeeperSecretsListResult {
        success: true,
        secrets: secret_infos,
        message: format!("Found {} secrets", secrets.len()),
    })
}

/// Get API key from Keeper by secret UID
/// This is called internally - the key value never reaches the frontend
pub fn get_api_key_from_keeper(secret_uid: &str) -> Result<String, String> {
    let config_path = get_keeper_config_path()?;

    if !config_path.exists() {
        return Err("Keeper not configured".to_string());
    }

    let storage = FileKeyValueStorage::new(&config_path)
        .map_err(|e| format!("Failed to load Keeper config: {}", e))?;

    let options = ClientOptions::new_client_options(Box::new(storage));

    let mut secrets_manager = SecretsManager::new(options)
        .map_err(|e| format!("Failed to create Keeper client: {}", e))?;

    let secrets = secrets_manager.get_secrets(vec![secret_uid.to_string()])
        .map_err(|e| format!("Failed to fetch secret: {}", e))?;

    let secret = secrets.first()
        .ok_or("Secret not found")?;

    // Find the password field
    let password = secret.field("password")
        .and_then(|f| f.first())
        .ok_or("No password field in secret")?;

    Ok(password.clone())
}

/// Check if Keeper is configured
pub fn is_keeper_configured() -> bool {
    get_keeper_config_path()
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// Clear Keeper configuration
pub async fn clear_keeper_config() -> Result<(), String> {
    let config_path = get_keeper_config_path()?;

    if config_path.exists() {
        std::fs::remove_file(&config_path)
            .map_err(|e| format!("Failed to remove Keeper config: {}", e))?;
        log::info!("Keeper configuration cleared");
    }

    Ok(())
}
```

#### 1.3 Modify `src-tauri/src/main.rs`

Add the new module and register commands:

```rust
// Add to module declarations
mod keeper_service;

// Add to command registrations in invoke_handler
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...

    // Keeper Integration
    initialize_keeper,
    list_keeper_secrets,
    get_keeper_status,
    clear_keeper_config,
    test_keeper_connection,
])
```

#### 1.4 Add Keeper Commands to `src-tauri/src/commands.rs`

```rust
use crate::keeper_service;

/// Initialize Keeper with one-time token
#[tauri::command]
pub async fn initialize_keeper(token: String) -> Result<keeper_service::KeeperInitResult, String> {
    log::info!("Initializing Keeper connection");
    keeper_service::initialize_keeper(&token).await
}

/// List available secrets from Keeper
#[tauri::command]
pub async fn list_keeper_secrets() -> Result<keeper_service::KeeperSecretsListResult, String> {
    keeper_service::list_keeper_secrets().await
}

/// Get Keeper connection status
#[tauri::command]
pub async fn get_keeper_status() -> Result<serde_json::Value, String> {
    let configured = keeper_service::is_keeper_configured();

    if configured {
        match keeper_service::list_keeper_secrets().await {
            Ok(result) => Ok(serde_json::json!({
                "configured": true,
                "connected": result.success,
                "secrets_count": result.secrets.len(),
                "message": result.message,
            })),
            Err(e) => Ok(serde_json::json!({
                "configured": true,
                "connected": false,
                "secrets_count": 0,
                "message": format!("Connection error: {}", e),
            })),
        }
    } else {
        Ok(serde_json::json!({
            "configured": false,
            "connected": false,
            "secrets_count": 0,
            "message": "Keeper not configured",
        }))
    }
}

/// Clear Keeper configuration
#[tauri::command]
pub async fn clear_keeper_config() -> Result<(), String> {
    keeper_service::clear_keeper_config().await
}

/// Test Keeper connection by fetching secrets
#[tauri::command]
pub async fn test_keeper_connection() -> Result<keeper_service::KeeperSecretsListResult, String> {
    keeper_service::list_keeper_secrets().await
}
```

#### 1.5 Modify `analyze_crash_log` Command for Keeper Support

Update the existing command to support Keeper-sourced API keys:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct AnalysisRequest {
    pub file_path: String,
    pub api_key: String,           // Direct API key (if not using Keeper)
    pub keeper_secret_uid: Option<String>,  // NEW: Keeper secret UID
    pub model: String,
    pub provider: String,
    pub analysis_type: String,
    pub redact_pii: Option<bool>,
}

#[tauri::command]
pub async fn analyze_crash_log(
    request: AnalysisRequest,
    db: State<'_, Database>,
) -> Result<AnalysisResponse, String> {
    // Resolve API key - prefer Keeper if configured
    let api_key = if let Some(keeper_uid) = &request.keeper_secret_uid {
        log::info!("Fetching API key from Keeper for analysis");
        keeper_service::get_api_key_from_keeper(keeper_uid)?
    } else {
        request.api_key.clone()
    };

    // ... rest of existing implementation using resolved api_key ...
}
```

---

### 2. Frontend Changes

#### 2.1 Add Types to `src/types/index.ts`

```typescript
// Keeper Integration Types
export interface KeeperConfig {
  enabled: boolean;
  secretMappings: {
    openai?: string;      // Keeper secret UID for OpenAI key
    anthropic?: string;   // Keeper secret UID for Anthropic key
    zai?: string;         // Keeper secret UID for Z.ai key
  };
}

export interface KeeperSecretInfo {
  uid: string;
  title: string;
  record_type: string;
}

export interface KeeperStatus {
  configured: boolean;
  connected: boolean;
  secrets_count: number;
  message: string;
}

export interface KeeperInitResult {
  success: boolean;
  message: string;
  secrets_count?: number;
}

export interface KeeperSecretsListResult {
  success: boolean;
  secrets: KeeperSecretInfo[];
  message: string;
}
```

#### 2.2 Create `src/services/keeper.ts`

```typescript
/**
 * Keeper Secrets Manager Service
 * Handles communication with Keeper via Tauri backend
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  KeeperStatus,
  KeeperInitResult,
  KeeperSecretsListResult,
  KeeperSecretInfo,
  KeeperConfig,
} from "../types";
import { getSetting, storeSetting } from "./secure-storage";
import logger from "./logger";

const KEEPER_CONFIG_KEY = "keeper_config";

/**
 * Initialize Keeper with a one-time access token
 */
export async function initializeKeeper(token: string): Promise<KeeperInitResult> {
  logger.info("Initializing Keeper connection");
  return await invoke<KeeperInitResult>("initialize_keeper", { token });
}

/**
 * Get current Keeper connection status
 */
export async function getKeeperStatus(): Promise<KeeperStatus> {
  return await invoke<KeeperStatus>("get_keeper_status");
}

/**
 * List available secrets from Keeper (titles only, not values)
 */
export async function listKeeperSecrets(): Promise<KeeperSecretsListResult> {
  return await invoke<KeeperSecretsListResult>("list_keeper_secrets");
}

/**
 * Test Keeper connection
 */
export async function testKeeperConnection(): Promise<KeeperSecretsListResult> {
  return await invoke<KeeperSecretsListResult>("test_keeper_connection");
}

/**
 * Clear Keeper configuration
 */
export async function clearKeeperConfig(): Promise<void> {
  await invoke<void>("clear_keeper_config");
  await storeSetting(KEEPER_CONFIG_KEY, JSON.stringify({
    enabled: false,
    secretMappings: {},
  }));
  logger.info("Keeper configuration cleared");
}

/**
 * Get stored Keeper configuration
 */
export async function getKeeperConfig(): Promise<KeeperConfig> {
  const stored = await getSetting<string>(KEEPER_CONFIG_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      logger.warn("Failed to parse Keeper config, using defaults");
    }
  }
  return {
    enabled: false,
    secretMappings: {},
  };
}

/**
 * Save Keeper configuration
 */
export async function saveKeeperConfig(config: KeeperConfig): Promise<void> {
  await storeSetting(KEEPER_CONFIG_KEY, JSON.stringify(config));
  logger.debug("Keeper config saved", { enabled: config.enabled });
}

/**
 * Map a provider to a Keeper secret
 */
export async function mapProviderToSecret(
  provider: string,
  secretUid: string | null
): Promise<void> {
  const config = await getKeeperConfig();

  if (secretUid) {
    config.secretMappings[provider as keyof typeof config.secretMappings] = secretUid;
  } else {
    delete config.secretMappings[provider as keyof typeof config.secretMappings];
  }

  await saveKeeperConfig(config);
}

/**
 * Get the Keeper secret UID for a provider (if configured)
 */
export async function getKeeperSecretForProvider(
  provider: string
): Promise<string | null> {
  const config = await getKeeperConfig();

  if (!config.enabled) {
    return null;
  }

  return config.secretMappings[provider as keyof typeof config.secretMappings] || null;
}

/**
 * Check if Keeper is enabled and configured for a provider
 */
export async function isKeeperEnabledForProvider(provider: string): Promise<boolean> {
  const config = await getKeeperConfig();
  return (
    config.enabled &&
    !!config.secretMappings[provider as keyof typeof config.secretMappings]
  );
}
```

#### 2.3 Modify `src/services/secure-storage.ts`

Add Keeper-aware API key retrieval:

```typescript
import { getKeeperConfig, getKeeperSecretForProvider } from "./keeper";

/**
 * Get API key source info for a provider
 * Returns whether the key comes from Keeper or direct storage
 */
export async function getApiKeySource(provider: string): Promise<{
  source: "keeper" | "direct" | "none";
  keeperSecretUid?: string;
}> {
  const keeperConfig = await getKeeperConfig();

  if (keeperConfig.enabled) {
    const secretUid = keeperConfig.secretMappings[provider as keyof typeof keeperConfig.secretMappings];
    if (secretUid) {
      return { source: "keeper", keeperSecretUid: secretUid };
    }
  }

  const directKey = await getApiKey(provider);
  if (directKey) {
    return { source: "direct" };
  }

  return { source: "none" };
}
```

#### 2.4 Modify `src/components/SettingsPanel.tsx`

Add Keeper configuration section. Here's the key addition (to be inserted after the "API Keys Section"):

```tsx
// Add to imports
import { Key, Shield, Link, Unlink } from "lucide-react";
import {
  getKeeperStatus,
  initializeKeeper,
  listKeeperSecrets,
  clearKeeperConfig,
  getKeeperConfig,
  saveKeeperConfig,
  testKeeperConnection,
} from "../services/keeper";
import type { KeeperStatus, KeeperSecretInfo, KeeperConfig } from "../types";

// Add to state declarations
const [keeperStatus, setKeeperStatus] = useState<KeeperStatus | null>(null);
const [keeperSecrets, setKeeperSecrets] = useState<KeeperSecretInfo[]>([]);
const [keeperConfig, setKeeperConfig] = useState<KeeperConfig>({
  enabled: false,
  secretMappings: {},
});
const [keeperToken, setKeeperToken] = useState("");
const [isInitializingKeeper, setIsInitializingKeeper] = useState(false);
const [keeperMessage, setKeeperMessage] = useState<string | null>(null);
const [showKeeperToken, setShowKeeperToken] = useState(false);

// Add to loadSettings function
async function loadSettings() {
  // ... existing code ...

  // Load Keeper status and config
  try {
    const status = await getKeeperStatus();
    setKeeperStatus(status);

    if (status.connected) {
      const secretsResult = await listKeeperSecrets();
      setKeeperSecrets(secretsResult.secrets);
    }

    const config = await getKeeperConfig();
    setKeeperConfig(config);
  } catch (e) {
    console.warn("Failed to load Keeper status:", e);
  }
}

// Add handler functions
const handleInitializeKeeper = async () => {
  if (!keeperToken.trim()) {
    setKeeperMessage("Please enter a one-time access token");
    return;
  }

  setIsInitializingKeeper(true);
  setKeeperMessage(null);

  try {
    const result = await initializeKeeper(keeperToken);

    if (result.success) {
      setKeeperMessage(`✅ ${result.message}`);
      setKeeperToken(""); // Clear token after successful init

      // Refresh status and secrets
      const status = await getKeeperStatus();
      setKeeperStatus(status);

      const secretsResult = await listKeeperSecrets();
      setKeeperSecrets(secretsResult.secrets);

      // Enable Keeper
      setKeeperConfig(prev => ({ ...prev, enabled: true }));
    } else {
      setKeeperMessage(`❌ ${result.message}`);
    }
  } catch (error) {
    setKeeperMessage(`❌ Failed to initialize Keeper: ${error}`);
  } finally {
    setIsInitializingKeeper(false);
    setTimeout(() => setKeeperMessage(null), 5000);
  }
};

const handleClearKeeper = async () => {
  if (!confirm("Are you sure you want to disconnect from Keeper? You will need a new one-time token to reconnect.")) {
    return;
  }

  try {
    await clearKeeperConfig();
    setKeeperStatus({ configured: false, connected: false, secrets_count: 0, message: "" });
    setKeeperSecrets([]);
    setKeeperConfig({ enabled: false, secretMappings: {} });
    setKeeperMessage("✅ Keeper disconnected");
  } catch (error) {
    setKeeperMessage(`❌ Failed to disconnect: ${error}`);
  }

  setTimeout(() => setKeeperMessage(null), 3000);
};

const handleMapSecret = (provider: string, secretUid: string | null) => {
  setKeeperConfig(prev => ({
    ...prev,
    secretMappings: {
      ...prev.secretMappings,
      [provider]: secretUid || undefined,
    },
  }));
};

const handleToggleKeeperEnabled = () => {
  setKeeperConfig(prev => ({
    ...prev,
    enabled: !prev.enabled,
  }));
};

// Add to handleSaveSettings
const handleSaveSettings = async () => {
  // ... existing code ...

  // Save Keeper config
  await saveKeeperConfig(keeperConfig);

  // ... rest of existing code ...
};
```

**Add this JSX section after the "API Keys Section" in the render:**

```tsx
{/* Keeper Secrets Manager Section */}
<div className="space-y-4 p-4 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-lg border border-purple-500/30">
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-3">
      <Shield className="w-5 h-5 text-purple-400" />
      <div>
        <h3 className="font-semibold text-purple-300">Keeper Secrets Manager</h3>
        <p className="text-xs text-gray-400">
          Securely retrieve API keys from your organization's Keeper vault
        </p>
      </div>
    </div>
    {keeperStatus?.connected && (
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={keeperConfig.enabled}
          onChange={handleToggleKeeperEnabled}
          className="w-4 h-4 rounded"
        />
        <span className="text-sm text-gray-400">Enable</span>
      </div>
    )}
  </div>

  {/* Connection Status */}
  {keeperStatus && (
    <div className={`p-3 rounded-lg ${
      keeperStatus.connected
        ? "bg-green-500/10 border border-green-500/20"
        : "bg-gray-900/50 border border-gray-700"
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            keeperStatus.connected ? "bg-green-400" : "bg-gray-500"
          }`} />
          <span className={`text-sm ${
            keeperStatus.connected ? "text-green-400" : "text-gray-400"
          }`}>
            {keeperStatus.connected
              ? `Connected (${keeperStatus.secrets_count} secrets available)`
              : "Not connected"
            }
          </span>
        </div>
        {keeperStatus.connected && (
          <button
            onClick={handleClearKeeper}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  )}

  {/* Initialize with Token (if not connected) */}
  {!keeperStatus?.connected && (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-semibold text-gray-400 mb-2">
          One-Time Access Token
        </label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type={showKeeperToken ? "text" : "password"}
              value={keeperToken}
              onChange={(e) => setKeeperToken(e.target.value)}
              placeholder="Paste your Keeper one-time token"
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:border-purple-500"
            />
            <button
              onClick={() => setShowKeeperToken(!showKeeperToken)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-700 rounded"
            >
              {showKeeperToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button
            onClick={handleInitializeKeeper}
            disabled={isInitializingKeeper || !keeperToken.trim()}
            className="px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition flex items-center gap-2"
          >
            {isInitializingKeeper ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Key className="w-4 h-4" />
            )}
            Connect
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Get a one-time token from your Keeper administrator or generate one in the{" "}
          <a
            href="https://keepersecurity.com/vault"
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-400 hover:underline"
          >
            Keeper Web Vault
          </a>
        </p>
      </div>
    </div>
  )}

  {/* Secret Mappings (if connected and enabled) */}
  {keeperStatus?.connected && keeperConfig.enabled && (
    <div className="space-y-3">
      <label className="block text-xs font-semibold text-gray-400">
        Map Secrets to Providers
      </label>

      {["openai", "anthropic", "zai"].map((provider) => (
        <div key={provider} className="flex items-center gap-3">
          <span className="w-24 text-sm text-gray-300 capitalize">{provider}</span>
          <select
            value={keeperConfig.secretMappings[provider as keyof typeof keeperConfig.secretMappings] || ""}
            onChange={(e) => handleMapSecret(provider, e.target.value || null)}
            className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
          >
            <option value="">-- Select a secret --</option>
            {keeperSecrets.map((secret) => (
              <option key={secret.uid} value={secret.uid}>
                {secret.title}
              </option>
            ))}
          </select>
          {keeperConfig.secretMappings[provider as keyof typeof keeperConfig.secretMappings] ? (
            <Link className="w-4 h-4 text-green-400" />
          ) : (
            <Unlink className="w-4 h-4 text-gray-500" />
          )}
        </div>
      ))}

      <p className="text-xs text-gray-500">
        When enabled, API keys will be fetched from Keeper instead of local storage.
        You won't need to enter API keys directly.
      </p>
    </div>
  )}

  {/* Keeper Message */}
  {keeperMessage && (
    <div className={`p-3 rounded-lg ${
      keeperMessage.includes("✅")
        ? "bg-green-500/10 border border-green-500/20 text-green-400"
        : "bg-red-500/10 border border-red-500/20 text-red-400"
    }`}>
      {keeperMessage}
    </div>
  )}
</div>
```

---

### 3. Update Analysis Flow

#### 3.1 Modify `src/services/circuit-breaker.ts`

Update the `analyzeWithResilience` function to support Keeper:

```typescript
import { getKeeperSecretForProvider } from "./keeper";

export async function analyzeWithResilience(
  filePath: string,
  apiKey: string,
  model: string,
  provider: string,
  analysisType: string
): Promise<AnalysisResponse> {
  // Check if Keeper is configured for this provider
  const keeperSecretUid = await getKeeperSecretForProvider(provider);

  const request: AnalysisRequest = {
    file_path: filePath,
    api_key: keeperSecretUid ? "" : apiKey,  // Empty if using Keeper
    keeper_secret_uid: keeperSecretUid,       // Pass Keeper UID if configured
    model,
    provider,
    analysis_type: analysisType,
    redact_pii: getBooleanSetting("pii_redaction_enabled"),
  };

  return await invoke<AnalysisResponse>("analyze_crash_log", request);
}
```

---

## Security Considerations

1. **One-Time Token**: Displayed only once in Keeper, cannot be retrieved again
2. **API Key Never in Frontend**: When using Keeper, the actual API key only exists in Rust memory
3. **Encrypted Config**: Keeper client config is encrypted at rest
4. **Audit Trail**: All secret access is logged in Keeper
5. **IP Locking**: Optional IP restriction on first connection

---

## Testing Plan

### Unit Tests
- [ ] `keeper_service.rs`: Test initialization, secret listing, error handling
- [ ] `keeper.ts`: Test config storage/retrieval
- [ ] Mock Keeper responses for offline testing

### Integration Tests
- [ ] Full flow: Token entry → Connection → Secret mapping → Analysis
- [ ] Fallback behavior when Keeper is unavailable
- [ ] Error handling for invalid tokens

### Manual Testing
- [ ] Verify API key never appears in frontend
- [ ] Test with real Keeper account
- [ ] Verify analysis works with Keeper-sourced keys

---

## Rollout Plan

1. **Phase 1**: Backend implementation (Rust SDK integration)
2. **Phase 2**: Frontend UI (Settings panel changes)
3. **Phase 3**: Integration testing
4. **Phase 4**: Documentation and user guide

---

## Dependencies to Install

```bash
# Rust (in src-tauri/)
cargo add keeper-secrets-manager-core

# No additional npm packages needed - uses existing Tauri invoke
```

---

## References

- [Keeper Secrets Manager Documentation](https://docs.keeper.io/secrets-manager/)
- [Rust SDK on crates.io](https://crates.io/crates/keeper-secrets-manager-core)
- [One-Time Token Guide](https://docs.keeper.io/en/keeperpam/secrets-manager/about/one-time-token)
