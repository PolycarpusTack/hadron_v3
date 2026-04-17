use thiserror::Error;

#[derive(Debug, Error)]
pub enum McpError {
    #[error("tool not found: {0}")]
    ToolNotFound(String),

    #[error("invalid arguments: {0}")]
    InvalidArguments(String),

    #[error("unauthorized")]
    Unauthorized,

    #[error("forbidden")]
    Forbidden,

    #[error("not found")]
    NotFound,

    #[error("not supported: {0}")]
    NotSupported(String),

    #[error("internal error: {0}")]
    Internal(String),
}

impl McpError {
    pub fn internal<E: std::fmt::Display>(e: E) -> Self {
        Self::Internal(e.to_string())
    }

    /// Sanitized message safe to return to MCP clients.
    /// Never exposes raw DB errors or internal details.
    pub fn client_message(&self) -> &str {
        match self {
            Self::ToolNotFound(_) => "Tool not found",
            Self::InvalidArguments(_) => "Invalid arguments",
            Self::Unauthorized => "Unauthorized",
            Self::Forbidden => "Forbidden",
            Self::NotFound => "Not found",
            Self::NotSupported(_) => "Not supported on this backend",
            Self::Internal(_) => "Internal server error",
        }
    }

    /// JSON-RPC 2.0 error code.
    pub fn jsonrpc_code(&self) -> i64 {
        match self {
            Self::ToolNotFound(_) => -32601,    // Method not found
            Self::InvalidArguments(_) => -32602, // Invalid params
            Self::Unauthorized => -32001,        // Application: unauthorized
            Self::Forbidden => -32002,           // Application: forbidden
            Self::NotFound => -32003,            // Application: not found
            Self::NotSupported(_) => -32004,     // Application: not supported
            Self::Internal(_) => -32603,         // Internal error
        }
    }
}

pub type McpResult<T> = Result<T, McpError>;
