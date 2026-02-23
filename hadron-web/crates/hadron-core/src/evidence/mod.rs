//! Evidence extraction for token-optimized analysis.
//!
//! Extracts key evidence (error lines, stack traces, component references)
//! from crash logs to reduce token usage while preserving analytical value.

use crate::error::HadronResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedEvidence {
    /// Error type/class lines.
    pub error_lines: Vec<String>,
    /// Stack trace frames (application-level only).
    pub stack_frames: Vec<String>,
    /// Component/module references.
    pub component_refs: Vec<String>,
    /// Key data values (IDs, timestamps, sizes).
    pub key_values: Vec<String>,
    /// Approximate token savings vs full content.
    pub compression_ratio: f64,
}

/// Extract key evidence from crash log content.
///
/// Produces a condensed representation that preserves the information
/// needed for AI analysis while reducing token count.
pub fn extract_evidence(content: &str) -> HadronResult<ExtractedEvidence> {
    let mut error_lines = Vec::new();
    let mut stack_frames = Vec::new();
    let mut component_refs = Vec::new();
    let mut key_values = Vec::new();

    let error_markers = [
        "Error:",
        "Exception:",
        "CRITICAL",
        "FATAL",
        "Unhandled",
        "Segmentation fault",
    ];
    let app_namespaces = ["PSI", "BM", "PL", "WOn", "EX", "MediaGeniX"];

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Error indicators
        if error_markers.iter().any(|m| trimmed.contains(m)) {
            error_lines.push(trimmed.to_string());
            continue;
        }

        // Application stack frames
        if app_namespaces.iter().any(|ns| trimmed.contains(ns))
            && (trimmed.contains(">>") || trimmed.contains("at "))
        {
            stack_frames.push(trimmed.to_string());
            continue;
        }

        // Component references (not already captured)
        if app_namespaces.iter().any(|ns| trimmed.contains(ns)) && component_refs.len() < 10 {
            component_refs.push(trimmed.to_string());
            continue;
        }

        // Key values: IDs, timestamps, numeric data
        if (trimmed.contains("ID:") || trimmed.contains("id=") || trimmed.contains("timestamp"))
            && key_values.len() < 20
        {
            key_values.push(trimmed.to_string());
        }
    }

    let evidence_size: usize = error_lines.iter().map(|l| l.len()).sum::<usize>()
        + stack_frames.iter().map(|l| l.len()).sum::<usize>()
        + component_refs.iter().map(|l| l.len()).sum::<usize>()
        + key_values.iter().map(|l| l.len()).sum::<usize>();

    let compression_ratio = if content.is_empty() {
        1.0
    } else {
        evidence_size as f64 / content.len() as f64
    };

    Ok(ExtractedEvidence {
        error_lines,
        stack_frames,
        component_refs,
        key_values,
        compression_ratio,
    })
}

impl ExtractedEvidence {
    /// Render evidence as a condensed string for AI prompt inclusion.
    pub fn to_prompt_text(&self) -> String {
        let mut parts = Vec::new();

        if !self.error_lines.is_empty() {
            parts.push(format!("=== Errors ===\n{}", self.error_lines.join("\n")));
        }

        if !self.stack_frames.is_empty() {
            parts.push(format!(
                "=== Stack Trace ===\n{}",
                self.stack_frames.join("\n")
            ));
        }

        if !self.component_refs.is_empty() {
            parts.push(format!(
                "=== Components ===\n{}",
                self.component_refs.join("\n")
            ));
        }

        if !self.key_values.is_empty() {
            parts.push(format!(
                "=== Key Values ===\n{}",
                self.key_values.join("\n")
            ));
        }

        parts.join("\n\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_evidence() {
        let content = "Some header\n\
                       Error: SubscriptOutOfBounds\n\
                       PSITxBlock>>removeTimeAllocations: at line 42\n\
                       VisualWorks framework code\n\
                       BMProgram>>schedule at line 100\n\
                       ID: 12345\n";

        let evidence = extract_evidence(content).unwrap();
        assert_eq!(evidence.error_lines.len(), 1);
        assert_eq!(evidence.stack_frames.len(), 2);
        assert!(evidence.compression_ratio < 1.0);
    }
}
