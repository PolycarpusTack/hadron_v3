//! Evidence Sufficiency Gate
//!
//! Before final LLM synthesis, checks if the retrieved evidence is sufficient.
//! If not, injects "don't hallucinate" instructions into the system prompt.

use serde::Serialize;

use crate::chat_tools::ToolResult;

/// Assessment of whether retrieved evidence is sufficient for answering.
#[derive(Debug, Clone, Serialize)]
pub struct EvidenceAssessment {
    /// Whether evidence is judged sufficient
    pub sufficient: bool,
    /// Confidence level (0.0 = no evidence, 1.0 = strong evidence)
    pub confidence: f64,
    /// Total number of results from all tool calls
    pub total_results: usize,
    /// Number of results considered high-quality
    pub high_quality_results: usize,
    /// Number of distinct source types
    pub source_diversity: usize,
    /// Human-readable explanation
    pub reason: String,
}

/// Instruction appended to system prompt when evidence is insufficient.
pub const INSUFFICIENT_EVIDENCE_INSTRUCTION: &str =
    "The tool searches returned limited results. You MUST: \
     (1) State what information IS available from the search results. \
     (2) Clearly note what you could NOT find or verify. \
     (3) Do NOT speculate or fabricate information beyond what the tools returned. \
     (4) Suggest what the user could try next (different search terms, checking JIRA, etc.).";

/// Assess whether tool results provide sufficient evidence for a high-quality answer.
///
/// `tool_results`: all tool result outputs from the agent loop.
/// `tool_names`: names of tools that were called (parallel Vec with tool_results).
pub fn assess_evidence(
    tool_results: &[ToolResult],
    tool_names: &[String],
) -> EvidenceAssessment {
    if tool_results.is_empty() {
        return EvidenceAssessment {
            sufficient: false,
            confidence: 0.0,
            total_results: 0,
            high_quality_results: 0,
            source_diversity: 0,
            reason: "No tools were called.".to_string(),
        };
    }

    let mut total_results = 0usize;
    let mut high_quality = 0usize;
    let mut source_types = std::collections::HashSet::new();
    let mut has_error_results = false;

    for (i, result) in tool_results.iter().enumerate() {
        if result.is_error {
            has_error_results = true;
            continue;
        }

        let content = &result.content;
        let tool_name = tool_names.get(i).map(|s| s.as_str()).unwrap_or("");

        // Detect "no results" responses
        let is_empty = content.contains("No analyses found")
            || content.contains("No Knowledge Base documents found")
            || content.contains("No similar crashes found")
            || content.contains("No JIRA issues found")
            || content.contains("No crash signatures found")
            || content.contains("No data for the last")
            || content.contains("No error patterns found")
            || content.contains("No signature found");

        if is_empty {
            continue;
        }

        // Count results based on tool type
        let result_count = estimate_result_count(content);
        total_results += result_count;

        // High-quality if substantial content
        if content.len() > 200 && result_count > 0 {
            high_quality += result_count.min(3); // Cap per tool call
        }

        // Track source diversity
        match tool_name {
            "search_analyses" | "find_similar_crashes" | "get_analysis_detail" => {
                source_types.insert("analyses");
            }
            "search_kb" => {
                source_types.insert("kb");
            }
            "search_jira" | "create_jira_ticket" => {
                source_types.insert("jira");
            }
            "get_crash_signature" | "get_top_signatures" | "get_crash_timeline" => {
                source_types.insert("signatures");
            }
            "get_trend_data" | "get_error_patterns" | "get_statistics" => {
                source_types.insert("analytics");
            }
            _ => {
                source_types.insert("other");
            }
        }
    }

    let source_diversity = source_types.len();

    // Compute confidence
    let confidence = compute_confidence(total_results, high_quality, source_diversity);

    let sufficient = confidence >= 0.3 && total_results >= 1;

    let reason = if sufficient {
        format!(
            "{} results from {} sources (confidence: {:.0}%)",
            total_results,
            source_diversity,
            confidence * 100.0
        )
    } else if total_results == 0 {
        if has_error_results {
            "All tool calls returned errors.".to_string()
        } else {
            "No relevant results found across all searches.".to_string()
        }
    } else {
        format!(
            "Only {} result(s) found with low confidence ({:.0}%).",
            total_results,
            confidence * 100.0
        )
    };

    EvidenceAssessment {
        sufficient,
        confidence,
        total_results,
        high_quality_results: high_quality,
        source_diversity,
        reason,
    }
}

/// Estimate number of individual results in a tool output string.
fn estimate_result_count(content: &str) -> usize {
    // Count "Analysis #" markers
    let analysis_count = content.matches("Analysis #").count();
    // Count table rows (lines starting with |)
    let table_rows = content
        .lines()
        .filter(|l| l.starts_with("| ") && !l.starts_with("| #") && !l.starts_with("|---"))
        .count();
    // Count "Found N" header
    let found_count = content
        .lines()
        .find_map(|l| {
            if l.starts_with("Found ") {
                l.split_whitespace()
                    .nth(1)
                    .and_then(|n| n.parse::<usize>().ok())
            } else {
                None
            }
        })
        .unwrap_or(0);

    // Return the best estimate
    analysis_count.max(table_rows).max(found_count).max(if content.len() > 100 { 1 } else { 0 })
}

fn compute_confidence(total: usize, high_quality: usize, diversity: usize) -> f64 {
    let count_signal = (total as f64 / 5.0).min(1.0); // 5+ results = full signal
    let quality_signal = (high_quality as f64 / 3.0).min(1.0); // 3+ high-quality = full
    let diversity_signal = (diversity as f64 / 2.0).min(1.0); // 2+ sources = full

    0.4 * count_signal + 0.4 * quality_signal + 0.2 * diversity_signal
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_result(content: &str, is_error: bool) -> ToolResult {
        ToolResult {
            tool_use_id: "test".to_string(),
            content: content.to_string(),
            is_error,
        }
    }

    #[test]
    fn test_empty_tools() {
        let assessment = assess_evidence(&[], &[]);
        assert!(!assessment.sufficient);
        assert_eq!(assessment.confidence, 0.0);
    }

    #[test]
    fn test_no_results_found() {
        let results = vec![make_result("No analyses found matching the query.", false)];
        let names = vec!["search_analyses".to_string()];
        let assessment = assess_evidence(&results, &names);
        assert!(!assessment.sufficient);
    }

    #[test]
    fn test_good_results() {
        let content = "Found 5 analyses:\n\n**[Analysis #42]** — crash.log (critical)\n- Error: NilReceiver\n- Root Cause: PSI namespace conflict caused null pointer dereference during scheduling engine initialization phase.\n- Component: PSI\n- Date: 2025-01-15\n\n";
        let results = vec![make_result(content, false)];
        let names = vec!["search_analyses".to_string()];
        let assessment = assess_evidence(&results, &names);
        assert!(assessment.sufficient);
        assert!(assessment.confidence > 0.3);
    }

    #[test]
    fn test_error_results() {
        let results = vec![make_result("Error: Connection refused", true)];
        let names = vec!["search_kb".to_string()];
        let assessment = assess_evidence(&results, &names);
        assert!(!assessment.sufficient);
    }
}
