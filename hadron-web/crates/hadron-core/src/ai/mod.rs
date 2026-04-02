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
