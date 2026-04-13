//! AI enrichment for performance trace analysis.

use serde::{Deserialize, Serialize};
use crate::error::{HadronError, HadronResult};
use crate::performance::types::*;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceEnrichment {
    #[serde(default)]
    pub scenario_narrative: String,
    #[serde(default)]
    pub recommendations: Vec<Recommendation>,
    #[serde(default)]
    pub summary: String,
}

pub const PERFORMANCE_ENRICHMENT_PROMPT: &str = r#"You are a performance analysis expert for VisualWorks Smalltalk applications. Given structured profiling data, provide:

1. A clear, contextual narrative explaining what happened during the trace period (2-4 sentences)
2. Prioritized recommendations for improvement (3-5 items)
3. A one-sentence executive summary

Return ONLY valid JSON:
{
  "scenarioNarrative": "What happened and why...",
  "recommendations": [
    { "recType": "optimization|workaround|investigation|configuration|documentation", "title": "Short title", "priority": "high|medium|low", "description": "What to do and why", "effort": "low|medium|high" }
  ],
  "summary": "One-sentence summary"
}"#;

pub fn build_performance_enrichment_messages(
    result: &PerformanceTraceResult,
) -> (String, Vec<super::types::AiMessage>) {
    let system = PERFORMANCE_ENRICHMENT_PROMPT.to_string();
    let user_content = format!(
        "Analyze this VisualWorks performance trace:\n\n\
         File: {}\nUser: {}\n\n\
         Metrics: CPU {:.1}%, Activity {:.1}%, GC Pressure {:.2}, Samples {}\n\n\
         Detected Patterns:\n{}\n\n\
         Top Methods:\n{}\n\n\
         Current Scenario: {} \u{2192} {}",
        result.filename,
        result.user.as_deref().unwrap_or("unknown"),
        result.derived.cpu_utilization,
        result.derived.activity_ratio,
        result.derived.gc_pressure,
        result.header.samples,
        result.patterns.iter()
            .map(|p| format!("- [{}] {} ({:.0}%)", p.severity, p.title, p.confidence))
            .collect::<Vec<_>>().join("\n"),
        result.top_methods.iter().take(5)
            .map(|m| format!("- {:.1}% {} ({})", m.percentage, m.method, m.category))
            .collect::<Vec<_>>().join("\n"),
        result.scenario.trigger,
        result.scenario.action,
    );
    let messages = vec![super::types::AiMessage {
        role: "user".to_string(),
        content: user_content,
    }];
    (system, messages)
}

pub fn parse_performance_enrichment(raw: &str) -> HadronResult<PerformanceEnrichment> {
    let json_str = super::parsers::strip_markdown_fences(raw);
    serde_json::from_str(json_str).map_err(|e| {
        let mut end = json_str.len().min(300);
        while end > 0 && !json_str.is_char_boundary(end) { end -= 1; }
        let preview = &json_str[..end];
        HadronError::Parse(format!("Failed to parse performance enrichment: {e}. Preview: {preview}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_enrichment_prompt() {
        let result = PerformanceTraceResult {
            filename: "trace.log".to_string(),
            derived: DerivedMetrics { cpu_utilization: 85.0, activity_ratio: 70.0, gc_pressure: 0.5, sample_density: 400.0 },
            header: PerformanceHeader { samples: 1500, ..Default::default() },
            scenario: UserScenario { trigger: "Application".to_string(), action: "Processing".to_string(), ..Default::default() },
            ..Default::default()
        };
        let (system, messages) = build_performance_enrichment_messages(&result);
        assert!(system.contains("performance analysis expert"));
        assert!(messages[0].content.contains("trace.log"));
        assert!(messages[0].content.contains("85.0%"));
    }

    #[test]
    fn test_parse_enrichment_response() {
        let json = r#"{"scenarioNarrative": "The system was under load", "recommendations": [{"recType": "optimization", "title": "Reduce GC", "priority": "high", "description": "Lower allocations", "effort": "medium"}], "summary": "High GC pressure"}"#;
        let result = parse_performance_enrichment(json).unwrap();
        assert!(!result.scenario_narrative.is_empty());
        assert_eq!(result.recommendations.len(), 1);
        assert!(!result.summary.is_empty());
    }
}
