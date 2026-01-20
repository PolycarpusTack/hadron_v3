use crate::token_budget::estimate_tokens;
/// Text Chunking for Deep Scan Analysis
///
/// Splits large walkback content into overlapping chunks for map-reduce processing.
use serde::{Deserialize, Serialize};

// ============================================================================
// Data Structures
// ============================================================================

/// A chunk of text with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextChunk {
    /// Chunk index (0-based)
    pub index: usize,
    /// Total number of chunks
    pub total: usize,
    /// The chunk content
    pub content: String,
    /// Starting line number in original text
    pub start_line: usize,
    /// Ending line number in original text
    pub end_line: usize,
    /// Estimated token count
    pub estimated_tokens: u32,
    /// Whether this chunk contains the crash point
    pub contains_crash_point: bool,
}

/// Configuration for chunking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkConfig {
    /// Target tokens per chunk
    pub target_tokens_per_chunk: u32,
    /// Maximum tokens per chunk (hard limit)
    pub max_tokens_per_chunk: u32,
    /// Overlap lines between chunks
    pub overlap_lines: usize,
    /// Minimum lines per chunk
    pub min_lines_per_chunk: usize,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            target_tokens_per_chunk: 4000,
            max_tokens_per_chunk: 6000,
            overlap_lines: 50,
            min_lines_per_chunk: 20,
        }
    }
}

impl ChunkConfig {
    /// Create config for a specific model's context
    pub fn for_model_budget(safe_budget: u32) -> Self {
        // Use about 1/4 of safe budget per chunk for map phase
        // This leaves room for system prompt + chunk content + response
        let chunk_budget = safe_budget / 4;

        Self {
            target_tokens_per_chunk: chunk_budget.min(4000),
            max_tokens_per_chunk: (chunk_budget * 3 / 2).min(6000),
            overlap_lines: 50,
            min_lines_per_chunk: 20,
        }
    }
}

// ============================================================================
// Chunker
// ============================================================================

/// Splits text into chunks for processing
pub struct Chunker {
    config: ChunkConfig,
}

impl Chunker {
    /// Create a new chunker with default config
    pub fn new() -> Self {
        Self {
            config: ChunkConfig::default(),
        }
    }

    /// Create with custom configuration
    pub fn with_config(config: ChunkConfig) -> Self {
        Self { config }
    }

    /// Split text into chunks
    pub fn chunk(&self, text: &str, crash_point_hint: Option<usize>) -> Vec<TextChunk> {
        let lines: Vec<&str> = text.lines().collect();
        let total_lines = lines.len();

        if total_lines == 0 {
            return vec![];
        }

        // Estimate total tokens
        let total_tokens = estimate_tokens(text);

        // If content fits in one chunk, return as single chunk
        if total_tokens <= self.config.target_tokens_per_chunk {
            return vec![TextChunk {
                index: 0,
                total: 1,
                content: text.to_string(),
                start_line: 1,
                end_line: total_lines,
                estimated_tokens: total_tokens,
                contains_crash_point: true,
            }];
        }

        // Calculate approximate chunk boundaries
        let estimated_chunks =
            (total_tokens as f32 / self.config.target_tokens_per_chunk as f32).ceil() as usize;
        let lines_per_chunk = (total_lines / estimated_chunks).max(self.config.min_lines_per_chunk);

        let mut chunks = Vec::new();
        let mut current_start = 0;

        while current_start < total_lines {
            // Calculate chunk end
            let ideal_end = (current_start + lines_per_chunk).min(total_lines);

            // Try to end at a natural boundary (empty line or section marker)
            let chunk_end = self.find_boundary(&lines, ideal_end, total_lines);

            // Build chunk content
            let chunk_lines: Vec<&str> = lines[current_start..chunk_end].to_vec();
            let chunk_content = chunk_lines.join("\n");
            let chunk_tokens = estimate_tokens(&chunk_content);

            // Check if this chunk contains the crash point
            let contains_crash = match crash_point_hint {
                Some(point) => current_start <= point && point < chunk_end,
                None => false,
            };

            chunks.push(TextChunk {
                index: chunks.len(),
                total: 0, // Will be updated after
                content: chunk_content,
                start_line: current_start + 1, // 1-based
                end_line: chunk_end,
                estimated_tokens: chunk_tokens,
                contains_crash_point: contains_crash,
            });

            // Move to next chunk with overlap
            current_start = if chunk_end >= total_lines {
                total_lines
            } else {
                (chunk_end - self.config.overlap_lines).max(current_start + 1)
            };

            // Safety check to prevent infinite loops
            if chunks.len() > 100 {
                log::warn!("Chunker hit safety limit of 100 chunks");
                break;
            }
        }

        // Update total count
        let total = chunks.len();
        for chunk in &mut chunks {
            chunk.total = total;
        }

        chunks
    }

    /// Find a natural boundary near the target position
    fn find_boundary(&self, lines: &[&str], target: usize, max: usize) -> usize {
        // Search window: 10 lines before and after target
        let search_start = target.saturating_sub(10);
        let search_end = (target + 10).min(max);

        // Look for empty lines or section markers
        for i in (search_start..search_end).rev() {
            if i >= max {
                continue;
            }
            let line = lines[i].trim();

            // Empty line is a good boundary
            if line.is_empty() {
                return i + 1;
            }

            // Section markers
            if line.starts_with("===") || line.starts_with("---") || line.starts_with("***") {
                return i;
            }
        }

        // No good boundary found, use target
        target.min(max)
    }

    /// Get configuration
    #[allow(dead_code)]
    pub fn config(&self) -> &ChunkConfig {
        &self.config
    }
}

impl Default for Chunker {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Find the line number containing "crash" indicators
pub fn find_crash_line(text: &str) -> Option<usize> {
    let crash_markers = [
        "MessageNotUnderstood",
        "doesNotUnderstand",
        "Error:",
        "Exception",
        "CRASH",
        "FATAL",
        "Unhandled",
    ];

    for (i, line) in text.lines().enumerate() {
        for marker in &crash_markers {
            if line.contains(marker) {
                return Some(i);
            }
        }
    }

    None
}

/// Merge chunk summaries for the reduce phase
#[allow(dead_code)]
pub fn merge_chunk_summaries(summaries: &[String]) -> String {
    let mut merged = String::new();

    for (i, summary) in summaries.iter().enumerate() {
        merged.push_str(&format!("### Chunk {} Summary\n", i + 1));
        merged.push_str(summary);
        merged.push_str("\n\n");
    }

    merged
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_small_content_single_chunk() {
        let chunker = Chunker::new();
        let small_text = "Line 1\nLine 2\nLine 3";

        let chunks = chunker.chunk(small_text, None);

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].index, 0);
        assert_eq!(chunks[0].total, 1);
    }

    #[test]
    fn test_large_content_multiple_chunks() {
        let chunker = Chunker::with_config(ChunkConfig {
            target_tokens_per_chunk: 100,
            max_tokens_per_chunk: 150,
            overlap_lines: 5,
            min_lines_per_chunk: 10,
        });

        // Create content that needs multiple chunks (1000 lines)
        let lines: Vec<String> = (0..1000).map(|i| format!("Line number {}", i)).collect();
        let text = lines.join("\n");

        let chunks = chunker.chunk(&text, None);

        assert!(
            chunks.len() > 1,
            "Expected multiple chunks, got {}",
            chunks.len()
        );

        // Verify all chunks have correct total
        for chunk in &chunks {
            assert_eq!(chunk.total, chunks.len());
        }

        // Verify ordering
        for (i, chunk) in chunks.iter().enumerate() {
            assert_eq!(chunk.index, i);
        }
    }

    #[test]
    fn test_overlap_coverage() {
        let chunker = Chunker::with_config(ChunkConfig {
            target_tokens_per_chunk: 50,
            max_tokens_per_chunk: 100,
            overlap_lines: 10,
            min_lines_per_chunk: 5,
        });

        let lines: Vec<String> = (0..100).map(|i| format!("L{}", i)).collect();
        let text = lines.join("\n");

        let chunks = chunker.chunk(&text, None);

        // Check that chunks overlap
        if chunks.len() > 1 {
            for i in 1..chunks.len() {
                let prev_end = chunks[i - 1].end_line;
                let curr_start = chunks[i].start_line;
                // Overlap means current starts before previous ends (or near it)
                assert!(
                    curr_start <= prev_end + 1,
                    "No overlap between chunk {} (ends {}) and {} (starts {})",
                    i - 1,
                    prev_end,
                    i,
                    curr_start
                );
            }
        }
    }

    #[test]
    fn test_crash_point_marking() {
        let chunker = Chunker::with_config(ChunkConfig {
            target_tokens_per_chunk: 50,
            max_tokens_per_chunk: 100,
            overlap_lines: 5,
            min_lines_per_chunk: 5,
        });

        let text = "Line 0\nLine 1\nLine 2\nCRASH HERE\nLine 4\nLine 5";
        let crash_line = find_crash_line(text);

        let chunks = chunker.chunk(text, crash_line);

        // At least one chunk should be marked as containing crash
        let has_crash_chunk = chunks.iter().any(|c| c.contains_crash_point);
        assert!(has_crash_chunk || chunks.len() == 1);
    }

    #[test]
    fn test_find_crash_line() {
        let text = "Header\nSome info\nError: MessageNotUnderstood\nMore stuff";
        let crash = find_crash_line(text);
        assert_eq!(crash, Some(2)); // 0-indexed

        let no_crash = "Normal log\nNo errors here\nAll good";
        assert_eq!(find_crash_line(no_crash), None);
    }
}
