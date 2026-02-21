//! Tauri command handlers
//!
//! This module re-exports from commands_legacy while we gradually migrate
//! to the new modular structure.

pub mod common;

// Re-export everything from the legacy commands module
pub use crate::commands_legacy::*;

// Modular command handlers (migrated from commands_legacy)
pub mod archive;
pub mod crud;
pub mod notes;
pub mod performance;

// New feature modules
pub mod gold_answers;
pub mod release_notes;
pub mod summaries;
