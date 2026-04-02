//! AI response parsers — extract structured data from AI text output.

use crate::error::{HadronError, HadronResult};
use serde::{Deserialize, Serialize};

/// Strip markdown code fences from AI output.
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
// Code Analysis Types (matches desktop schema exactly)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeAnalysisResult {
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub issues: Vec<CodeIssue>,
    #[serde(default)]
    pub walkthrough: Vec<WalkthroughSection>,
    #[serde(default)]
    pub optimized_code: Option<String>,
    #[serde(default)]
    pub quality_scores: CodeQualityScores,
    #[serde(default)]
    pub glossary: Vec<GlossaryTerm>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeIssue {
    #[serde(default)]
    pub id: u32,
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub line: u32,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub technical: String,
    #[serde(default)]
    pub fix: String,
    #[serde(default)]
    pub complexity: String,
    #[serde(default)]
    pub impact: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WalkthroughSection {
    #[serde(default)]
    pub lines: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub what_it_does: String,
    #[serde(default)]
    pub why_it_matters: String,
    #[serde(default)]
    pub evidence: String,
    #[serde(default)]
    pub dependencies: Vec<CodeDependency>,
    #[serde(default)]
    pub impact: String,
    #[serde(default)]
    pub testability: String,
    #[serde(default)]
    pub eli5: String,
    #[serde(default)]
    pub quality: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeDependency {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub dep_type: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeQualityScores {
    #[serde(default)]
    pub overall: u8,
    #[serde(default)]
    pub security: u8,
    #[serde(default)]
    pub performance: u8,
    #[serde(default)]
    pub maintainability: u8,
    #[serde(default)]
    pub best_practices: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryTerm {
    #[serde(default)]
    pub term: String,
    #[serde(default)]
    pub definition: String,
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
    fn test_parse_code_analysis_desktop_schema() {
        let input = r#"{
            "summary": "A test function",
            "issues": [{"id": 1, "severity": "high", "category": "security", "line": 5, "title": "SQL injection", "description": "Unsanitized input", "technical": "String concat in query", "fix": "Use parameterized queries", "complexity": "Low", "impact": "Data breach"}],
            "walkthrough": [{"lines": "1-5", "title": "Imports", "code": "import os", "whatItDoes": "Imports OS module", "whyItMatters": "File access", "evidence": "import statement", "dependencies": [{"name": "os", "type": "import", "note": "stdlib"}], "impact": "Required", "testability": "N/A", "eli5": "Gets tools", "quality": "Fine"}],
            "optimizedCode": "import os\n# fixed",
            "qualityScores": {"overall": 65, "security": 30, "performance": 80, "maintainability": 70, "bestPractices": 60},
            "glossary": [{"term": "SQL injection", "definition": "Malicious SQL in user input"}]
        }"#;
        let result = parse_code_analysis(input).unwrap();
        assert_eq!(result.summary, "A test function");
        assert_eq!(result.issues.len(), 1);
        assert_eq!(result.issues[0].technical, "String concat in query");
        assert_eq!(result.walkthrough[0].eli5, "Gets tools");
        assert_eq!(result.walkthrough[0].dependencies[0].dep_type, "import");
        assert_eq!(result.quality_scores.security, 30);
        assert_eq!(result.optimized_code.as_deref(), Some("import os\n# fixed"));
    }

    #[test]
    fn test_parse_code_analysis_defaults() {
        let input = r#"{"summary":"hello"}"#;
        let result = parse_code_analysis(input).unwrap();
        assert_eq!(result.summary, "hello");
        assert_eq!(result.quality_scores.overall, 0);
        assert!(result.issues.is_empty());
        assert!(result.walkthrough.is_empty());
        assert!(result.optimized_code.is_none());
    }
}
