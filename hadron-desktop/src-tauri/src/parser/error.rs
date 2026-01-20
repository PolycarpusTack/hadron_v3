use thiserror::Error;

#[derive(Error, Debug)]
#[allow(dead_code)]
pub enum ParseError {
    #[error("Failed to read file: {0}")]
    IoError(#[from] std::io::Error),

    #[error("File appears to be empty or invalid")]
    EmptyFile,

    #[error("Missing required section: {0}")]
    MissingSection(String),

    #[error("Failed to parse section '{section}': {message}")]
    InvalidSection { section: String, message: String },

    #[error("Invalid timestamp format: {0}")]
    InvalidTimestamp(String),

    #[error("Unexpected format in {context}: {details}")]
    UnexpectedFormat { context: String, details: String },
}

pub type ParseResult<T> = Result<T, ParseError>;
