//! AI module — types, prompts, and response parsers.
//!
//! Transport-agnostic: no HTTP client, no async runtime.
//! The server layer handles actual API calls.

pub mod types;
pub mod prompts;
pub mod parsers;
pub mod detect_language;
pub mod jira_analysis;
pub mod jira_triage;
pub mod jira_brief;
pub mod sentry_analysis;
pub mod release_notes;

pub use types::{AiConfig, AiMessage, AiProvider};
pub use prompts::*;
pub use parsers::*;
pub use detect_language::detect_language;
pub use jira_analysis::*;
pub use jira_triage::*;
pub use jira_brief::*;
pub use sentry_analysis::*;
pub use release_notes::*;
