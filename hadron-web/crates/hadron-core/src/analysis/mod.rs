//! Analysis orchestration logic.
//!
//! Token budget management, chunking strategies, and evidence extraction
//! coordination — framework-agnostic business logic.

use serde::{Deserialize, Serialize};

/// Analysis strategy selected based on file size and token limits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisStrategy {
    /// Direct analysis — small files under token limit.
    Quick,
    /// Extract key evidence first, then analyze the extract.
    QuickExtracted,
    /// Chunk file into sections and analyze in parallel.
    DeepScan,
}

/// Configuration for the token budget manager.
#[derive(Debug, Clone)]
pub struct TokenBudgetConfig {
    /// Maximum tokens for a single AI call.
    pub max_tokens_per_call: usize,
    /// Threshold (in KB) to switch from Quick to QuickExtracted.
    pub quick_extract_threshold_kb: f64,
    /// Threshold (in KB) to switch from QuickExtracted to DeepScan.
    pub deep_scan_threshold_kb: f64,
    /// Approximate tokens per KB of crash log text.
    pub tokens_per_kb: f64,
}

impl Default for TokenBudgetConfig {
    fn default() -> Self {
        Self {
            max_tokens_per_call: 8000,
            quick_extract_threshold_kb: 50.0,
            deep_scan_threshold_kb: 200.0,
            tokens_per_kb: 400.0,
        }
    }
}

/// Select analysis strategy based on file size and config.
pub fn select_strategy(file_size_kb: f64, config: &TokenBudgetConfig) -> AnalysisStrategy {
    if file_size_kb <= config.quick_extract_threshold_kb {
        AnalysisStrategy::Quick
    } else if file_size_kb <= config.deep_scan_threshold_kb {
        AnalysisStrategy::QuickExtracted
    } else {
        AnalysisStrategy::DeepScan
    }
}

/// Split content into chunks of approximately `max_tokens` tokens each.
/// Uses line boundaries to avoid splitting mid-line.
pub fn chunk_content(content: &str, max_chars_per_chunk: usize) -> Vec<String> {
    if content.len() <= max_chars_per_chunk {
        return vec![content.to_string()];
    }

    let mut chunks = Vec::new();
    let mut current_chunk = String::new();

    for line in content.lines() {
        if current_chunk.len() + line.len() + 1 > max_chars_per_chunk && !current_chunk.is_empty()
        {
            chunks.push(current_chunk);
            current_chunk = String::new();
        }
        if !current_chunk.is_empty() {
            current_chunk.push('\n');
        }
        current_chunk.push_str(line);
    }

    if !current_chunk.is_empty() {
        chunks.push(current_chunk);
    }

    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_select_strategy() {
        let config = TokenBudgetConfig::default();
        assert_eq!(select_strategy(10.0, &config), AnalysisStrategy::Quick);
        assert_eq!(
            select_strategy(100.0, &config),
            AnalysisStrategy::QuickExtracted
        );
        assert_eq!(
            select_strategy(500.0, &config),
            AnalysisStrategy::DeepScan
        );
    }

    #[test]
    fn test_chunk_content() {
        let content = "line1\nline2\nline3\nline4\nline5";
        let chunks = chunk_content(content, 12);
        assert!(chunks.len() > 1);
        // Each chunk respects line boundaries
        for chunk in &chunks {
            assert!(chunk.len() <= 12 || !chunk.contains('\n'));
        }
    }

    #[test]
    fn test_chunk_small_content() {
        let content = "small file";
        let chunks = chunk_content(content, 1000);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], "small file");
    }
}
