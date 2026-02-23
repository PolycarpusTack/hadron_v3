use serde::Serialize;
use thiserror::Error;

/// Result alias using `HadronError`.
pub type HadronResult<T> = Result<T, HadronError>;

/// Unified error type for all Hadron operations.
///
/// Database-agnostic — specific database errors are wrapped via `Database(String)`.
/// HTTP response mapping is handled at the server layer.
#[derive(Debug, Error)]
pub enum HadronError {
    // === Database Errors ===
    #[error("Database error: {0}")]
    Database(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    // === IO Errors ===
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("File too large: {size} bytes exceeds maximum of {max} bytes")]
    FileTooLarge { size: u64, max: u64 },

    // === Auth Errors ===
    #[error("Authentication required")]
    Unauthenticated,

    #[error("Insufficient permissions: {0}")]
    Forbidden(String),

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

    // === Serialization ===
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    // === General ===
    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Operation cancelled")]
    Cancelled,

    #[error("Timeout: {0}")]
    Timeout(String),

    #[error("Rate limited")]
    RateLimited,
}

impl HadronError {
    pub fn database(msg: impl Into<String>) -> Self {
        Self::Database(msg.into())
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::NotFound(msg.into())
    }
    pub fn ai_service(msg: impl Into<String>) -> Self {
        Self::AiService(msg.into())
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::Internal(msg.into())
    }
    pub fn validation(msg: impl Into<String>) -> Self {
        Self::Validation(msg.into())
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::Forbidden(msg.into())
    }
    pub fn external_service(msg: impl Into<String>) -> Self {
        Self::Http(msg.into())
    }

    /// Whether this error should expose details to clients.
    pub fn is_user_facing(&self) -> bool {
        matches!(
            self,
            Self::NotFound(_)
                | Self::Conflict(_)
                | Self::FileNotFound(_)
                | Self::FileTooLarge { .. }
                | Self::Validation(_)
                | Self::Forbidden(_)
                | Self::Unauthenticated
                | Self::ModelNotAvailable(_)
                | Self::RateLimited
        )
    }

    /// Sanitized message safe for API responses.
    pub fn client_message(&self) -> String {
        if self.is_user_facing() {
            self.to_string()
        } else {
            match self {
                Self::Database(_) => "Database operation failed".to_string(),
                Self::AiService(_) => "AI service unavailable".to_string(),
                Self::Http(_) => "External service error".to_string(),
                _ => "Internal server error".to_string(),
            }
        }
    }
}

/// Serializes as a JSON error object for API responses.
impl Serialize for HadronError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("Error", 2)?;
        state.serialize_field("error", &self.client_message())?;
        state.serialize_field("code", &self.error_code())?;
        state.end()
    }
}

impl HadronError {
    /// Machine-readable error code for client consumption.
    pub fn error_code(&self) -> &'static str {
        match self {
            Self::Database(_) => "DATABASE_ERROR",
            Self::NotFound(_) => "NOT_FOUND",
            Self::Conflict(_) => "CONFLICT",
            Self::Io(_) => "IO_ERROR",
            Self::FileNotFound(_) => "FILE_NOT_FOUND",
            Self::FileTooLarge { .. } => "FILE_TOO_LARGE",
            Self::Unauthenticated => "UNAUTHENTICATED",
            Self::Forbidden(_) => "FORBIDDEN",
            Self::AiService(_) => "AI_SERVICE_ERROR",
            Self::ApiKey(_) => "API_KEY_ERROR",
            Self::ModelNotAvailable(_) => "MODEL_NOT_AVAILABLE",
            Self::Parse(_) => "PARSE_ERROR",
            Self::InvalidFormat(_) => "INVALID_FORMAT",
            Self::Http(_) => "HTTP_ERROR",
            Self::Jira(_) => "JIRA_ERROR",
            Self::Serialization(_) => "SERIALIZATION_ERROR",
            Self::Config(_) => "CONFIG_ERROR",
            Self::Internal(_) => "INTERNAL_ERROR",
            Self::Validation(_) => "VALIDATION_ERROR",
            Self::Cancelled => "CANCELLED",
            Self::Timeout(_) => "TIMEOUT",
            Self::RateLimited => "RATE_LIMITED",
        }
    }
}

// Note: reqwest::Error and tokio::task::JoinError conversions
// are implemented in hadron-server where those crates are available.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_user_facing_errors_show_details() {
        let err = HadronError::NotFound("analysis 42".to_string());
        assert!(err.client_message().contains("analysis 42"));
    }

    #[test]
    fn test_internal_errors_are_sanitized() {
        let err = HadronError::Database("connection pool exhausted at line 42".to_string());
        assert_eq!(err.client_message(), "Database operation failed");
    }

    #[test]
    fn test_error_codes() {
        assert_eq!(HadronError::Unauthenticated.error_code(), "UNAUTHENTICATED");
        assert_eq!(
            HadronError::Validation("bad".into()).error_code(),
            "VALIDATION_ERROR"
        );
    }
}
