//! Common types shared across command modules

use crate::database::Database;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

/// Type alias for Arc-wrapped database state
pub type DbState<'a> = State<'a, Arc<Database>>;

/// Maximum file size for crash log analysis (5 MB)
pub const MAX_CRASH_LOG_SIZE_BYTES: u64 = 5 * 1024 * 1024;

/// Maximum content size for translation (1 MB)
pub const MAX_TRANSLATION_CONTENT_SIZE: usize = 1024 * 1024;

/// Maximum content size for pasted logs (5 MB)
pub const MAX_PASTED_LOG_SIZE: usize = 5 * 1024 * 1024;

/// Maximum file size for performance trace analysis (10 MB)
pub const MAX_PERFORMANCE_TRACE_SIZE_BYTES: u64 = 10 * 1024 * 1024;

/// Progress update for analysis operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisProgress {
    /// Current phase of analysis
    pub phase: AnalysisPhase,
    /// Progress within current phase (0-100)
    pub progress: u8,
    /// Human-readable status message
    pub message: String,
    /// Current step number (e.g., chunk 3 of 10)
    pub current_step: Option<usize>,
    /// Total steps in current phase
    pub total_steps: Option<usize>,
}

/// Phases of the analysis process
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisPhase {
    /// Reading and validating file
    Reading,
    /// Estimating tokens and selecting strategy
    Planning,
    /// Extracting key evidence (for extraction mode)
    Extracting,
    /// Chunking content (for deep scan)
    Chunking,
    /// Analyzing chunks (map phase of deep scan)
    Analyzing,
    /// Synthesizing results (reduce phase of deep scan)
    Synthesizing,
    /// Saving to database
    Saving,
    /// Analysis complete
    Complete,
    /// Analysis failed
    Failed,
}

/// Summary of auto-tagging operation results
#[derive(Debug, Serialize)]
pub struct AutoTagSummary {
    pub scanned: i64,
    pub tagged: i64,
    pub skipped: i64,
    pub failed: i64,
}
