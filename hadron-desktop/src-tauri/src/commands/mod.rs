//! Tauri command handlers

pub mod common;

// Re-export shared types used by database.rs
pub use search::{AdvancedFilterOptions, FilteredResults};
pub use patterns::PatternEngineState;

// Core AI analysis commands
pub mod ai;
pub mod providers;
pub mod info;

// Data access
pub mod analytics;
pub mod archive;
pub mod bulk_ops;
pub mod crud;
pub mod export;
pub mod intelligence;
pub mod notes;
pub mod search;
pub mod tags;

// Feature modules
pub mod gold_answers;
pub mod investigation;
pub mod jira;
pub mod jira_assist;
pub mod keeper;
pub mod patterns;
pub mod performance;
pub mod release_notes;
pub mod sentry;
pub mod signatures;
pub mod summaries;
