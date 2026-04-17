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
/// Fails closed when `SERVER_ENCRYPTION_KEY` is missing: refuses to persist plaintext secrets.
pub fn encrypt_value(plaintext: &str) -> HadronResult<String> {
    let Some(key_bytes) = ENCRYPTION_KEY.as_ref() else {
        return Err(HadronError::Config(
            "SERVER_ENCRYPTION_KEY must be set (64 hex chars) before storing secrets".to_string(),
        ));
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
    fn test_encrypt_fails_closed_without_key() {
        // When SERVER_ENCRYPTION_KEY is missing, encryption must refuse rather than
        // silently persisting plaintext. Guards against regressions of the fail-open bug.
        let err = encrypt_value("my-secret")
            .expect_err("encrypt_value must fail when key is not configured");
        assert!(
            matches!(err, HadronError::Config(_)),
            "expected Config error, got {err:?}"
        );
    }

    #[test]
    fn test_decrypt_unencrypted_value() {
        // Values without "enc:" prefix are returned as-is
        let result = decrypt_value("plain-value").unwrap();
        assert_eq!(result, "plain-value");
    }
}
