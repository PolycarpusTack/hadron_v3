//! AI response parsers — extract structured data from AI text output.

use crate::error::{HadronError, HadronResult};
use serde::{Deserialize, Serialize};

/// Strip markdown code fences from AI output.
///
/// Handles ```json ... ``` and ``` ... ``` wrappers.
pub fn strip_markdown_fences(raw: &str) -> &str {
    let trimmed = raw.trim();

    for marker in ["```json", "```JSON", "```"] {
        if let Some(start_idx) = trimmed.find(marker) {
            let content_start = start_idx + marker.len();
            if let Some(end_idx) = trimmed[content_start..].find("```") {
                let block = trimmed[content_start..content_start + end_idx].trim();
                if !block.is_empty() {
                    return block;
                }
            }
        }
    }

    trimmed
}

// ============================================================================
// Code Analysis Types & Parser
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeAnalysisResult {
    #[serde(default)]
    pub overview: CodeOverview,
    #[serde(default)]
    pub walkthrough: Vec<WalkthroughSection>,
    #[serde(default)]
    pub issues: Vec<CodeIssue>,
    #[serde(default)]
    pub optimized: OptimizedCode,
    #[serde(default)]
    pub quality: CodeQualityScores,
    #[serde(default)]
    pub glossary: Vec<GlossaryTerm>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeOverview {
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub lines_of_code: u32,
    #[serde(default)]
    pub complexity: String,
    #[serde(default)]
    pub purpose: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WalkthroughSection {
    #[serde(default)]
    pub section: String,
    #[serde(default)]
    pub start_line: u32,
    #[serde(default)]
    pub end_line: u32,
    #[serde(default)]
    pub explanation: String,
    #[serde(default)]
    pub key_points: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeIssue {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub line: u32,
    #[serde(default)]
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OptimizedCode {
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub changes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeQualityScores {
    #[serde(default)]
    pub overall: u8,
    #[serde(default)]
    pub readability: u8,
    #[serde(default)]
    pub maintainability: u8,
    #[serde(default)]
    pub reliability: u8,
    #[serde(default)]
    pub security: u8,
    #[serde(default)]
    pub performance: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryTerm {
    #[serde(default)]
    pub term: String,
    #[serde(default)]
    pub definition: String,
    #[serde(default)]
    pub related_terms: Vec<String>,
}

/// Parse an AI response into a CodeAnalysisResult.
pub fn parse_code_analysis(raw: &str) -> HadronResult<CodeAnalysisResult> {
    let json_str = strip_markdown_fences(raw);
    serde_json::from_str(json_str).map_err(|e| {
        HadronError::Parse(format!("Failed to parse code analysis response: {e}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_markdown_fences_json() {
        let input = "Here is the result:\n\n```json\n{\"key\": \"value\"}\n```\n\nDone.";
        assert_eq!(strip_markdown_fences(input), r#"{"key": "value"}"#);
    }

    #[test]
    fn test_strip_markdown_fences_plain() {
        let input = r#"{"key": "value"}"#;
        assert_eq!(strip_markdown_fences(input), r#"{"key": "value"}"#);
    }

    #[test]
    fn test_parse_code_analysis_valid() {
        let input = r#"{"overview":{"summary":"test","language":"rust","linesOfCode":10,"complexity":"LOW","purpose":"test"},"walkthrough":[],"issues":[],"optimized":{"code":"","changes":[]},"quality":{"overall":80,"readability":85,"maintainability":75,"reliability":80,"security":70,"performance":90},"glossary":[]}"#;
        let result = parse_code_analysis(input).unwrap();
        assert_eq!(result.overview.language, "rust");
        assert_eq!(result.quality.overall, 80);
    }

    #[test]
    fn test_parse_code_analysis_with_fences() {
        let input = "```json\n{\"overview\":{\"summary\":\"hello\",\"language\":\"python\"},\"walkthrough\":[],\"issues\":[],\"optimized\":{\"code\":\"\",\"changes\":[]},\"quality\":{\"overall\":50},\"glossary\":[]}\n```";
        let result = parse_code_analysis(input).unwrap();
        assert_eq!(result.overview.language, "python");
    }

    #[test]
    fn test_parse_code_analysis_defaults() {
        let input = r#"{"overview":{}}"#;
        let result = parse_code_analysis(input).unwrap();
        assert_eq!(result.overview.summary, "");
        assert_eq!(result.quality.overall, 0);
        assert!(result.issues.is_empty());
    }
}
