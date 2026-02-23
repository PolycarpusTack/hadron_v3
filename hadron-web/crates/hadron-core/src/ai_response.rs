//! AI response parsing — extracts structured analysis fields from AI output.
//!
//! Handles both direct JSON responses and markdown-wrapped JSON (```json blocks).

use serde::{Deserialize, Serialize};

/// Structured fields extracted from an AI analysis response.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ParsedAnalysis {
    pub error_type: Option<String>,
    pub error_message: Option<String>,
    pub severity: Option<String>,
    pub component: Option<String>,
    pub root_cause: Option<String>,
    pub suggested_fixes: Option<serde_json::Value>,
    pub confidence: Option<String>,
}

/// Parse AI response text into structured analysis fields.
///
/// Handles:
/// 1. Direct JSON response (AI returned valid JSON)
/// 2. Markdown-wrapped JSON (```json ... ```)
/// 3. Fallback: extract fields from natural language using heuristics
pub fn parse_analysis_response(raw: &str) -> ParsedAnalysis {
    // Try direct JSON parse
    if let Ok(parsed) = try_json_parse(raw) {
        return parsed;
    }

    // Try extracting JSON from markdown code blocks
    if let Some(json_str) = extract_json_block(raw) {
        if let Ok(parsed) = try_json_parse(&json_str) {
            return parsed;
        }
    }

    // Fallback: heuristic extraction from natural language
    heuristic_extract(raw)
}

fn try_json_parse(s: &str) -> Result<ParsedAnalysis, ()> {
    let trimmed = s.trim();
    if !trimmed.starts_with('{') {
        return Err(());
    }

    let val: serde_json::Value = serde_json::from_str(trimmed).map_err(|_| ())?;
    Ok(value_to_parsed(&val))
}

fn extract_json_block(s: &str) -> Option<String> {
    // Look for ```json ... ``` or ``` ... ```
    let markers = ["```json", "```JSON", "```"];
    for marker in markers {
        if let Some(start_idx) = s.find(marker) {
            let content_start = start_idx + marker.len();
            if let Some(end_idx) = s[content_start..].find("```") {
                let block = s[content_start..content_start + end_idx].trim();
                if block.starts_with('{') {
                    return Some(block.to_string());
                }
            }
        }
    }
    None
}

fn value_to_parsed(val: &serde_json::Value) -> ParsedAnalysis {
    ParsedAnalysis {
        error_type: get_string(val, &["error_type", "errorType", "exception_type"]),
        error_message: get_string(val, &["error_message", "errorMessage", "message"]),
        severity: get_string(val, &["severity"]).map(|s| s.to_uppercase()),
        component: get_string(val, &["component", "module", "affected_module"]),
        root_cause: get_string(val, &["root_cause", "rootCause", "cause", "analysis"]),
        suggested_fixes: val
            .get("suggested_fixes")
            .or_else(|| val.get("suggestedFixes"))
            .or_else(|| val.get("fixes"))
            .or_else(|| val.get("recommendations"))
            .cloned(),
        confidence: get_string(val, &["confidence"]).map(|s| s.to_uppercase()),
    }
}

fn get_string(val: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(v) = val.get(key) {
            if let Some(s) = v.as_str() {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

fn heuristic_extract(raw: &str) -> ParsedAnalysis {
    let mut parsed = ParsedAnalysis::default();

    // Use the whole raw text as root cause for fallback
    parsed.root_cause = Some(raw.to_string());
    parsed.confidence = Some("LOW".to_string());
    parsed.severity = Some("MEDIUM".to_string());

    // Try to detect severity from text
    let upper = raw.to_uppercase();
    if upper.contains("CRITICAL") || upper.contains("FATAL") {
        parsed.severity = Some("CRITICAL".to_string());
    } else if upper.contains("HIGH SEVERITY") || upper.contains("SEVERE") {
        parsed.severity = Some("HIGH".to_string());
    } else if upper.contains("LOW SEVERITY") || upper.contains("MINOR") {
        parsed.severity = Some("LOW".to_string());
    }

    parsed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_direct_json() {
        let input = r#"{"error_type": "NullPointerException", "severity": "HIGH", "root_cause": "Null ref", "suggested_fixes": ["Fix 1"], "confidence": "HIGH"}"#;
        let result = parse_analysis_response(input);
        assert_eq!(result.error_type.as_deref(), Some("NullPointerException"));
        assert_eq!(result.severity.as_deref(), Some("HIGH"));
        assert_eq!(result.confidence.as_deref(), Some("HIGH"));
    }

    #[test]
    fn test_parse_markdown_wrapped_json() {
        let input = "Here is my analysis:\n\n```json\n{\"error_type\": \"StackOverflow\", \"severity\": \"CRITICAL\", \"root_cause\": \"Infinite recursion\", \"suggested_fixes\": [\"Add base case\"], \"confidence\": \"HIGH\"}\n```\n\nLet me know if you need more details.";
        let result = parse_analysis_response(input);
        assert_eq!(result.error_type.as_deref(), Some("StackOverflow"));
        assert_eq!(result.severity.as_deref(), Some("CRITICAL"));
    }

    #[test]
    fn test_parse_fallback_heuristic() {
        let input = "This crash is caused by a critical null pointer dereference in the PSI module.";
        let result = parse_analysis_response(input);
        assert_eq!(result.severity.as_deref(), Some("CRITICAL"));
        assert!(result.root_cause.is_some());
        assert_eq!(result.confidence.as_deref(), Some("LOW"));
    }

    #[test]
    fn test_parse_camel_case_keys() {
        let input = r#"{"errorType": "OutOfMemory", "errorMessage": "Heap full", "rootCause": "Memory leak", "suggestedFixes": ["Increase heap"], "confidence": "medium"}"#;
        let result = parse_analysis_response(input);
        assert_eq!(result.error_type.as_deref(), Some("OutOfMemory"));
        assert_eq!(result.root_cause.as_deref(), Some("Memory leak"));
        assert_eq!(result.confidence.as_deref(), Some("MEDIUM"));
    }
}
