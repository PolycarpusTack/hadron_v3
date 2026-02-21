/// Evidence Extraction for Token-Safe Analysis
///
/// Extracts the most relevant evidence from raw walkback data to reduce token usage
/// while preserving critical information for AI analysis.
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

// Static compiled regexes — compiled once, reused across all EvidenceExtractor instances.
static RE_ORACLE_ERROR: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)ORA-\d{5}").expect("static regex"));
static RE_POSTGRES_ERROR: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(SQLSTATE|ERROR|FATAL|PANIC):?\s*[\[\(]?\d{5}").expect("static regex"));
static RE_SMALLTALK_EXCEPTION: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b[A-Z][a-zA-Z0-9]*(\s+class)?>>[\w:]+").expect("static regex"));
static RE_DEADLOCK_MARKER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(deadlock|ORA-00060|mutex|lock wait|blocking)").expect("static regex"));
static RE_MEMORY_ERROR: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(out of memory|heap|allocation failed|memory exhausted|ORA-04031)").expect("static regex"));
static RE_NETWORK_ERROR: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(connection (refused|reset|timed out)|socket|TNS-|network error)").expect("static regex"));
static RE_ERROR_KEYWORD: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(ERROR|FATAL|EXCEPTION|FAILED|ABORT|CRASH|PANIC)\b").expect("static regex"));
static RE_STACK_FRAME: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*\d+\s+[A-Z][a-zA-Z0-9]*").expect("static regex"));

// ============================================================================
// Data Structures
// ============================================================================

/// Extracted evidence pack from crash data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidencePack {
    /// Preview of walkback (last N lines around crash)
    pub walkback_preview: Vec<String>,
    /// Lines matching critical patterns (errors, exceptions, etc.)
    pub matched_lines: Vec<MatchedLine>,
    /// Detected error signatures (deduplicated)
    pub detected_signatures: Vec<String>,
    /// Stack trace fragments extracted from raw text
    pub stack_traces: Vec<StackFragment>,
    /// Extraction statistics
    pub stats: EvidenceStats,
}

/// A line that matched a critical pattern
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchedLine {
    /// Original line number in walkback
    pub line_number: usize,
    /// The line content
    pub content: String,
    /// Pattern category that matched
    pub category: MatchCategory,
}

/// Categories of matched patterns
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MatchCategory {
    OracleError,
    PostgresError,
    SmalltalkException,
    Deadlock,
    MemoryError,
    NetworkError,
    ErrorKeyword,
    StackFrame,
}

/// A stack trace fragment extracted from raw text
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackFragment {
    /// Starting line number
    pub start_line: usize,
    /// The frames in this fragment
    pub frames: Vec<String>,
    /// Whether this appears to be the crash point
    pub is_crash_origin: bool,
}

/// Statistics about the extraction process
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceStats {
    /// Original walkback size in bytes
    pub raw_walkback_bytes: usize,
    /// Total lines in original walkback
    pub total_lines: usize,
    /// Lines in preview
    pub preview_lines: usize,
    /// Number of matched lines
    pub matched_line_count: usize,
    /// Number of unique signatures found
    pub signature_count: usize,
    /// Number of stack fragments
    pub stack_fragment_count: usize,
    /// Estimated token reduction percentage
    pub reduction_percent: f32,
}

// ============================================================================
// Configuration
// ============================================================================

/// Configuration for evidence extraction
#[derive(Debug, Clone)]
pub struct ExtractionConfig {
    /// Maximum lines to include in preview
    pub max_preview_lines: usize,
    /// Maximum matched lines to include
    pub max_matched_lines: usize,
    /// Maximum stack fragments to extract
    pub max_stack_fragments: usize,
    /// Maximum frames per stack fragment
    pub max_frames_per_stack: usize,
    /// Maximum unique signatures
    pub max_signatures: usize,
    /// Lines of context around crash point
    pub context_lines: usize,
}

impl Default for ExtractionConfig {
    fn default() -> Self {
        Self {
            max_preview_lines: 300,
            max_matched_lines: 200,
            max_stack_fragments: 10,
            max_frames_per_stack: 30,
            max_signatures: 50,
            context_lines: 20,
        }
    }
}

impl ExtractionConfig {
    /// Create a minimal config for very tight token budgets
    #[allow(dead_code)]
    pub fn minimal() -> Self {
        Self {
            max_preview_lines: 50,
            max_matched_lines: 50,
            max_stack_fragments: 3,
            max_frames_per_stack: 15,
            max_signatures: 20,
            context_lines: 10,
        }
    }

    /// Create config with specific caps
    pub fn with_caps(preview: usize, matched: usize) -> Self {
        Self {
            max_preview_lines: preview,
            max_matched_lines: matched,
            ..Default::default()
        }
    }
}

// ============================================================================
// Evidence Extractor
// ============================================================================

/// Extracts evidence from raw walkback content
pub struct EvidenceExtractor {
    config: ExtractionConfig,
}

impl EvidenceExtractor {
    /// Create a new extractor with default config
    pub fn new() -> Self {
        Self::with_config(ExtractionConfig::default())
    }

    /// Create with custom configuration
    pub fn with_config(config: ExtractionConfig) -> Self {
        Self { config }
    }

    /// Extract evidence from raw walkback content
    pub fn extract(&self, raw_walkback: &str) -> EvidencePack {
        let lines: Vec<&str> = raw_walkback.lines().collect();
        let total_lines = lines.len();
        let raw_bytes = raw_walkback.len();

        // 1. Find crash point and extract preview around it
        let crash_point = self.find_crash_point(&lines);
        let walkback_preview = self.extract_preview(&lines, crash_point);

        // 2. Find all lines matching critical patterns
        let matched_lines = self.extract_matched_lines(&lines);

        // 3. Extract unique error signatures
        let detected_signatures = self.extract_signatures(&lines, &matched_lines);

        // 4. Extract stack trace fragments
        let stack_traces = self.extract_stack_fragments(&lines);

        // Calculate statistics before moving values
        let matched_line_count = matched_lines.len();
        let signature_count = detected_signatures.len();
        let stack_fragment_count = stack_traces.len();

        let evidence_size = self.calculate_evidence_size(
            &walkback_preview,
            &matched_lines,
            &detected_signatures,
            &stack_traces,
        );
        let reduction_percent = if raw_bytes > 0 {
            ((raw_bytes - evidence_size) as f32 / raw_bytes as f32) * 100.0
        } else {
            0.0
        };

        EvidencePack {
            walkback_preview,
            matched_lines,
            detected_signatures,
            stack_traces,
            stats: EvidenceStats {
                raw_walkback_bytes: raw_bytes,
                total_lines,
                preview_lines: self.config.max_preview_lines.min(total_lines),
                matched_line_count,
                signature_count,
                stack_fragment_count,
                reduction_percent,
            },
        }
    }

    /// Find the most likely crash point in the walkback
    fn find_crash_point(&self, lines: &[&str]) -> usize {
        // Look for common crash indicators
        let crash_markers = [
            "MessageNotUnderstood",
            "doesNotUnderstand:",
            "Error",
            "Exception",
            "Unhandled",
            "CRASH",
            "FATAL",
        ];

        for (i, line) in lines.iter().enumerate() {
            for marker in &crash_markers {
                if line.contains(marker) {
                    return i;
                }
            }
        }

        // Default to middle of file if no crash point found
        lines.len() / 2
    }

    /// Extract preview lines around the crash point
    fn extract_preview(&self, lines: &[&str], crash_point: usize) -> Vec<String> {
        let max_lines = self.config.max_preview_lines;
        let context = self.config.context_lines;

        if lines.len() <= max_lines {
            return lines.iter().map(|s| s.to_string()).collect();
        }

        let mut result = Vec::new();

        // Strategy: Take context around crash + beginning + end
        let start_context = crash_point.saturating_sub(context);
        let end_context = (crash_point + context).min(lines.len());

        // Lines around crash point
        let crash_context: Vec<String> = lines[start_context..end_context]
            .iter()
            .map(|s| s.to_string())
            .collect();

        // First N lines (often contain header info)
        let header_lines = 30.min(max_lines / 4);
        let header: Vec<String> = lines
            .iter()
            .take(header_lines)
            .map(|s| s.to_string())
            .collect();

        // Last N lines (often contain error summary)
        let tail_lines = 50.min(max_lines / 3);
        let tail: Vec<String> = lines
            .iter()
            .rev()
            .take(tail_lines)
            .rev()
            .map(|s| s.to_string())
            .collect();

        // Combine, avoiding duplicates
        let mut seen_lines: HashSet<String> = HashSet::new();

        // Add header
        for line in header {
            if seen_lines.insert(line.clone()) && result.len() < max_lines {
                result.push(line);
            }
        }

        // Add marker if there's a gap
        if result.len() < start_context {
            result.push("... [content trimmed for brevity] ...".to_string());
        }

        // Add crash context
        for line in crash_context {
            if seen_lines.insert(line.clone()) && result.len() < max_lines {
                result.push(line);
            }
        }

        // Add marker if there's a gap
        if end_context < lines.len().saturating_sub(tail_lines) {
            result.push("... [content trimmed for brevity] ...".to_string());
        }

        // Add tail
        for line in tail {
            if seen_lines.insert(line.clone()) && result.len() < max_lines {
                result.push(line);
            }
        }

        result
    }

    /// Extract lines matching critical patterns
    fn extract_matched_lines(&self, lines: &[&str]) -> Vec<MatchedLine> {
        let mut matched = Vec::new();

        for (i, line) in lines.iter().enumerate() {
            if let Some(category) = self.categorize_line(line) {
                matched.push(MatchedLine {
                    line_number: i + 1,
                    content: line.to_string(),
                    category,
                });

                if matched.len() >= self.config.max_matched_lines {
                    break;
                }
            }
        }

        matched
    }

    /// Categorize a line by pattern match
    fn categorize_line(&self, line: &str) -> Option<MatchCategory> {
        if RE_ORACLE_ERROR.is_match(line) {
            Some(MatchCategory::OracleError)
        } else if RE_POSTGRES_ERROR.is_match(line) {
            Some(MatchCategory::PostgresError)
        } else if RE_DEADLOCK_MARKER.is_match(line) {
            Some(MatchCategory::Deadlock)
        } else if RE_MEMORY_ERROR.is_match(line) {
            Some(MatchCategory::MemoryError)
        } else if RE_NETWORK_ERROR.is_match(line) {
            Some(MatchCategory::NetworkError)
        } else if RE_SMALLTALK_EXCEPTION.is_match(line) && RE_ERROR_KEYWORD.is_match(line) {
            Some(MatchCategory::SmalltalkException)
        } else if RE_ERROR_KEYWORD.is_match(line) {
            Some(MatchCategory::ErrorKeyword)
        } else {
            None
        }
    }

    /// Extract unique error signatures
    fn extract_signatures(&self, lines: &[&str], matched: &[MatchedLine]) -> Vec<String> {
        let mut signature_counts: HashMap<String, usize> = HashMap::new();

        // Extract from matched lines first (higher priority)
        for m in matched {
            if let Some(sig) = self.normalize_signature(&m.content) {
                *signature_counts.entry(sig).or_insert(0) += 1;
            }
        }

        // Also scan all lines for patterns
        for line in lines {
            // Oracle errors
            if let Some(captures) = RE_ORACLE_ERROR.find(line) {
                let sig = captures.as_str().to_uppercase();
                *signature_counts.entry(sig).or_insert(0) += 1;
            }

            // Smalltalk method signatures at crash
            if let Some(captures) = RE_SMALLTALK_EXCEPTION.find(line) {
                let sig = captures.as_str().to_string();
                *signature_counts.entry(sig).or_insert(0) += 1;
            }
        }

        // Sort by frequency and take top N
        let mut sig_vec: Vec<_> = signature_counts.into_iter().collect();
        sig_vec.sort_by(|a, b| b.1.cmp(&a.1));

        sig_vec
            .into_iter()
            .take(self.config.max_signatures)
            .map(|(sig, _)| sig)
            .collect()
    }

    /// Normalize a line into a signature
    fn normalize_signature(&self, line: &str) -> Option<String> {
        // Look for Oracle error
        if let Some(m) = RE_ORACLE_ERROR.find(line) {
            return Some(m.as_str().to_uppercase());
        }

        // Look for Smalltalk method signature
        if let Some(m) = RE_SMALLTALK_EXCEPTION.find(line) {
            return Some(m.as_str().to_string());
        }

        None
    }

    /// Extract stack trace fragments
    fn extract_stack_fragments(&self, lines: &[&str]) -> Vec<StackFragment> {
        let mut fragments = Vec::new();
        let mut current_fragment: Option<(usize, Vec<String>)> = None;
        let mut in_stack = false;

        for (i, line) in lines.iter().enumerate() {
            let looks_like_frame = RE_STACK_FRAME.is_match(line);

            if looks_like_frame {
                if !in_stack {
                    // Start new fragment
                    in_stack = true;
                    current_fragment = Some((i + 1, vec![line.to_string()]));
                } else if let Some((_, ref mut frames)) = current_fragment {
                    if frames.len() < self.config.max_frames_per_stack {
                        frames.push(line.to_string());
                    }
                }
            } else if in_stack {
                // End of stack fragment
                if let Some((start, frames)) = current_fragment.take() {
                    if frames.len() >= 3 {
                        // Only keep meaningful fragments
                        let is_crash = frames.iter().any(|f| {
                            f.contains("Error")
                                || f.contains("Exception")
                                || f.contains("doesNotUnderstand")
                        });
                        fragments.push(StackFragment {
                            start_line: start,
                            frames,
                            is_crash_origin: is_crash,
                        });
                    }
                }
                in_stack = false;

                if fragments.len() >= self.config.max_stack_fragments {
                    break;
                }
            }
        }

        // Don't forget last fragment
        if let Some((start, frames)) = current_fragment {
            if frames.len() >= 3 && fragments.len() < self.config.max_stack_fragments {
                let is_crash = frames
                    .iter()
                    .any(|f| f.contains("Error") || f.contains("Exception"));
                fragments.push(StackFragment {
                    start_line: start,
                    frames,
                    is_crash_origin: is_crash,
                });
            }
        }

        // Sort by crash origin first
        fragments.sort_by(|a, b| b.is_crash_origin.cmp(&a.is_crash_origin));

        fragments
    }

    /// Calculate total size of extracted evidence
    fn calculate_evidence_size(
        &self,
        preview: &[String],
        matched: &[MatchedLine],
        signatures: &[String],
        stacks: &[StackFragment],
    ) -> usize {
        let preview_size: usize = preview.iter().map(|s| s.len()).sum();
        let matched_size: usize = matched.iter().map(|m| m.content.len()).sum();
        let sig_size: usize = signatures.iter().map(|s| s.len()).sum();
        let stack_size: usize = stacks
            .iter()
            .flat_map(|s| s.frames.iter())
            .map(|f| f.len())
            .sum();

        preview_size + matched_size + sig_size + stack_size
    }
}

impl Default for EvidenceExtractor {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Formatting for Prompts
// ============================================================================

impl EvidencePack {
    /// Format evidence pack for inclusion in AI prompt
    pub fn format_for_prompt(&self) -> String {
        let mut output = String::new();

        // Walkback preview section
        output.push_str("## Walkback Preview\n");
        output.push_str(&format!(
            "(Showing {} of {} total lines)\n\n",
            self.stats.preview_lines, self.stats.total_lines
        ));
        for line in &self.walkback_preview {
            output.push_str(line);
            output.push('\n');
        }

        // Matched critical lines
        if !self.matched_lines.is_empty() {
            output.push_str("\n## Critical Pattern Matches\n");
            for m in &self.matched_lines {
                output.push_str(&format!(
                    "L{}: [{}] {}\n",
                    m.line_number,
                    format!("{:?}", m.category).to_uppercase(),
                    m.content
                ));
            }
        }

        // Error signatures
        if !self.detected_signatures.is_empty() {
            output.push_str("\n## Detected Error Signatures\n");
            for sig in &self.detected_signatures {
                output.push_str(&format!("- {}\n", sig));
            }
        }

        // Stack traces
        if !self.stack_traces.is_empty() {
            output.push_str("\n## Stack Trace Fragments\n");
            for (i, stack) in self.stack_traces.iter().enumerate() {
                let marker = if stack.is_crash_origin {
                    " [CRASH ORIGIN]"
                } else {
                    ""
                };
                output.push_str(&format!(
                    "\n### Fragment {} (line {}){}\n",
                    i + 1,
                    stack.start_line,
                    marker
                ));
                for frame in &stack.frames {
                    output.push_str(frame);
                    output.push('\n');
                }
            }
        }

        output
    }

    /// Get a compact summary for metadata
    pub fn summary(&self) -> String {
        format!(
            "Extracted {} lines from {} total ({:.1}% reduction). Found {} signatures, {} critical matches.",
            self.stats.preview_lines,
            self.stats.total_lines,
            self.stats.reduction_percent,
            self.stats.signature_count,
            self.stats.matched_line_count
        )
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_oracle_error_extraction() {
        let extractor = EvidenceExtractor::new();
        let walkback = r#"
Starting process...
ORA-00060: deadlock detected while waiting for resource
ORA-06512: at "WHATS.ON_SCHEDULE", line 42
Some other line
ORA-01403: no data found
End of log
        "#;

        let evidence = extractor.extract(walkback);

        // Should find Oracle errors
        assert!(evidence
            .detected_signatures
            .iter()
            .any(|s| s.contains("ORA-00060")));
        assert!(evidence
            .matched_lines
            .iter()
            .any(|m| matches!(m.category, MatchCategory::OracleError)));
    }

    #[test]
    fn test_smalltalk_exception_extraction() {
        let extractor = EvidenceExtractor::new();
        let walkback = r#"
Error: MessageNotUnderstood
  1 UndefinedObject>>doesNotUnderstand:
  2 MyClass>>processData:
  3 MyClass class>>newWithConfig:
  4 WorkflowEngine>>execute
        "#;

        let evidence = extractor.extract(walkback);

        // Should find stack frames
        assert!(!evidence.stack_traces.is_empty());
        assert!(evidence
            .matched_lines
            .iter()
            .any(|m| m.content.contains("doesNotUnderstand") || m.content.contains("Error")));
    }

    #[test]
    fn test_preview_extraction() {
        let extractor = EvidenceExtractor::with_config(ExtractionConfig {
            max_preview_lines: 10,
            ..Default::default()
        });

        // Create a 100-line walkback
        let lines: Vec<String> = (0..100).map(|i| format!("Line {}", i)).collect();
        let walkback = lines.join("\n");

        let evidence = extractor.extract(&walkback);

        assert!(evidence.walkback_preview.len() <= 10);
        assert!(evidence.stats.reduction_percent > 80.0);
    }

    #[test]
    fn test_signature_deduplication() {
        let extractor = EvidenceExtractor::new();
        let walkback = r#"
ORA-00060: deadlock
ORA-00060: deadlock again
ORA-00060: same error
ORA-01403: different error
        "#;

        let evidence = extractor.extract(walkback);

        // ORA-00060 should appear only once despite multiple occurrences
        let ora_60_count = evidence
            .detected_signatures
            .iter()
            .filter(|s| s.contains("ORA-00060"))
            .count();
        assert_eq!(ora_60_count, 1);
    }
}
