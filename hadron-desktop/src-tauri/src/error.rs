//! Unified Error Handling for Hadron
//!
//! This module provides a consistent error type across all Hadron components.
//! Errors are categorized by domain and converted to user-friendly strings
//! at the IPC boundary.

use thiserror::Error;

/// Unified error type for all Hadron operations
#[derive(Debug, Error)]
pub enum HadronError {
    // === Database Errors ===
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Database connection error: {0}")]
    DatabaseConnection(String),

    // === IO Errors ===
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("File too large: {size} bytes exceeds maximum of {max} bytes")]
    FileTooLarge { size: u64, max: u64 },

    // === Security Errors ===
    #[error("Security violation: {0}")]
    Security(String),

    #[error("Path traversal attempt detected")]
    PathTraversal,

    #[error("Access denied: {0}")]
    AccessDenied(String),

    // === AI Service Errors ===
    #[error("AI service error: {0}")]
    AiService(String),

    #[error("API key error: {0}")]
    ApiKey(String),

    #[error("Model not available: {0}")]
    ModelNotAvailable(String),

    // === Parser Errors ===
    #[error("Parse error: {0}")]
    Parse(String),

    #[error("Invalid format: {0}")]
    InvalidFormat(String),

    // === External Service Errors ===
    #[error("HTTP error: {0}")]
    Http(String),

    #[error("JIRA error: {0}")]
    Jira(String),

    #[error("Keeper error: {0}")]
    Keeper(String),

    // === Serialization Errors ===
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    // === Configuration Errors ===
    #[error("Configuration error: {0}")]
    Config(String),

    // === General Errors ===
    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Operation cancelled")]
    Cancelled,

    #[error("Timeout: {0}")]
    Timeout(String),
}

impl HadronError {
    /// Create a security error
    pub fn security(msg: impl Into<String>) -> Self {
        Self::Security(msg.into())
    }

    /// Create an AI service error
    pub fn ai_service(msg: impl Into<String>) -> Self {
        Self::AiService(msg.into())
    }

    /// Create an internal error
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::Internal(msg.into())
    }

    /// Create a validation error
    pub fn validation(msg: impl Into<String>) -> Self {
        Self::Validation(msg.into())
    }

    /// Check if this is a user-facing error that should show details
    pub fn is_user_facing(&self) -> bool {
        matches!(
            self,
            Self::FileNotFound(_)
                | Self::FileTooLarge { .. }
                | Self::Validation(_)
                | Self::AccessDenied(_)
                | Self::ModelNotAvailable(_)
        )
    }

    /// Get a sanitized error message safe for IPC
    /// Removes internal details from sensitive errors
    pub fn to_ipc_string(&self) -> String {
        match self {
            // Security errors - don't leak internal details
            Self::Security(_) => "Security violation".to_string(),
            Self::PathTraversal => "Invalid file path".to_string(),

            // Database errors - sanitize
            Self::Database(e) => {
                let msg = e.to_string();
                if msg.contains("UNIQUE constraint") {
                    "Record already exists".to_string()
                } else if msg.contains("FOREIGN KEY") {
                    "Related record not found".to_string()
                } else {
                    "Database operation failed".to_string()
                }
            }

            // User-facing errors - show full message
            _ if self.is_user_facing() => self.to_string(),

            // All other errors - show generic message
            _ => self.to_string(),
        }
    }
}

/// Convert HadronError to String for Tauri IPC boundary
impl From<HadronError> for String {
    fn from(err: HadronError) -> Self {
        err.to_ipc_string()
    }
}

// === Conversion implementations for external error types ===

impl From<reqwest::Error> for HadronError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            Self::Timeout(err.to_string())
        } else if err.is_connect() {
            Self::Http(format!("Connection failed: {}", err))
        } else {
            Self::Http(err.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_to_ipc_string() {
        let err = HadronError::Security("internal detail".to_string());
        assert_eq!(err.to_ipc_string(), "Security violation");

        let err = HadronError::FileNotFound("/path/to/file".to_string());
        assert!(err.to_ipc_string().contains("/path/to/file"));
    }

    #[test]
    fn test_error_from_string() {
        let err = HadronError::validation("invalid input");
        let s: String = err.into();
        assert!(s.contains("invalid input"));
    }

    #[test]
    fn test_file_too_large_error() {
        let err = HadronError::FileTooLarge {
            size: 10_000_000,
            max: 5_000_000,
        };
        assert!(err.to_string().contains("10000000"));
        assert!(err.to_string().contains("5000000"));
    }
}
