use serde::{Deserialize, Serialize};
use serde_json::json;
use log;

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub error_type: String,
    pub error_message: Option<String>,
    pub severity: String,
    pub root_cause: String,
    pub suggested_fixes: Vec<String>,
    pub component: Option<String>,
    pub stack_trace: Option<String>,
    pub confidence: String,
    pub tokens_used: i32,
    pub cost: f64,
    pub was_truncated: Option<bool>,
    pub analysis_duration_ms: Option<i32>,
}

const COMPLETE_ANALYSIS_SYSTEM_PROMPT: &str = "You are an expert VisualWorks Smalltalk developer with 15+ years of experience debugging production issues.

Your expertise includes:
- Message-passing semantics and method lookup
- Common Smalltalk pitfalls (nil receivers, missing selectors, block closures)
- VisualWorks-specific classes (OrderedCollection, Dictionary, etc.)
- Stack trace analysis and error propagation
- Production incident management and remediation

You provide COMPLETE, COMPREHENSIVE analysis in a structured 10-part format that helps both developers and management understand crashes.";

const SPECIALIZED_ANALYSIS_SYSTEM_PROMPT: &str = "You are an expert VisualWorks Smalltalk developer specialized in deep crash log analysis.
Perform multiple specialized analyses from different perspectives: patterns, recommendations, memory, database, performance, root cause, general, and basic.";

fn get_complete_analysis_prompt(crash_content: &str) -> String {
    format!(r#"Analyze this VisualWorks Smalltalk crash log with a COMPLETE, COMPREHENSIVE approach following a structured 10-part format.

CRASH LOG:
{}

═══════════════════════════════════════════════════════════════════

PERFORM COMPLETE ANALYSIS WITH THESE 10 PARTS:

1. ERROR CLASSIFICATION - Error type, severity, component
2. USER ACTION RECONSTRUCTION - What user was trying to do
3. ROOT CAUSE (TECHNICAL) - Detailed technical explanation with causal chain
4. ROOT CAUSE (FUNCTIONAL) - User-friendly explanation with business context
5. DEVELOPER REMEDIATION - P0/P1/P2 fixes with code examples
6. USER REMEDIATION - Workarounds and guidance
7. REPRODUCTION STEPS - How to reproduce the issue
8. MONITORING & DETECTION - Metrics, alerts, logging
9. SIMILAR ISSUES - Pattern signature, related issues
10. VALIDATION STRATEGY - How to verify fix works

═══════════════════════════════════════════════════════════════════

OUTPUT FORMAT (JSON):
{{
  "error_type": "MessageNotUnderstood",
  "error_message": "Receiver does not understand selector",
  "severity": "critical",
  "root_cause": "Start with header # COMPLETE ANALYSIS (10 PARTS) then include all 10 parts: PART 1 through PART 10 with detailed markdown sections",
  "suggested_fixes": [
    "P0 - Fix missing method in MyClass",
    "P1 - Add validation before sending",
    "P2 - Refactor protocol handling"
  ],
  "component": "MyClass",
  "stack_trace": "Stack trace with key frames",
  "confidence": "high"
}}

REQUIREMENTS:
- root_cause field must contain ALL 10 PARTS with detailed analysis
- Be specific: use Class>>method notation for code locations
- Include actual code examples in suggested fixes where possible
- Make analysis comprehensive and actionable
- Use markdown formatting within the root_cause field

IMPORTANT: Return ONLY valid JSON, no additional text outside the JSON structure."#, crash_content)
}

fn get_specialized_analysis_prompt(crash_content: &str) -> String {
    format!(r#"Analyze this VisualWorks Smalltalk crash log using SPECIALIZED ANALYSES SUITE - perform ALL 8 analyses from different perspectives.

CRASH LOG:
{}

═══════════════════════════════════════════════════════════════════
EXECUTE ALL 8 SPECIALIZED ANALYSES IN SEQUENCE
═══════════════════════════════════════════════════════════════════

ANALYSIS 1: PATTERN ANALYSIS
- Pattern classification (Isolated|Recurring|Clustered|Systematic)
- Statistical patterns (exception, stack trace, attributes)
- Temporal analysis and triggers
- Similarity to known patterns
- Clustering analysis and blast radius
- Predictive insights and early warnings
- Pattern-breaking preventive recommendations

ANALYSIS 2: RECOMMENDATIONS ANALYSIS
- P0 immediate fixes with code, steps, validation
- P1 short-term improvements with benefits
- P2 architectural improvements with migration path
- Monitoring & detection strategy
- Testing strategy (unit, integration, chaos)
- Implementation roadmap with milestones

ANALYSIS 3: MEMORY ANALYSIS
- Memory forensics (heap, leak indicators, object counts)
- Growth patterns and pressure assessment
- Immediate actions if memory issue detected
- OR state "No memory issue detected" with explanation

ANALYSIS 4: DATABASE ANALYSIS
- Database connectivity and query analysis
- Connection state, encoding compatibility
- Query performance and optimization
- OR state "No database issue detected" with explanation

ANALYSIS 5: PERFORMANCE ANALYSIS
- Performance profiling (bottleneck, latency, resources)
- Optimization opportunities
- Expected impact of fixes
- OR state "No performance issue detected" with explanation

ANALYSIS 6: ROOT CAUSE ANALYSIS (DEEP)
- Failure point identification with exact location
- Causal chain reconstruction (5 Whys)
- Hypothesis testing (A/B/C with confidence scores)
- Impact zones and blast radius
- Definitive root cause statement
- Evidence summary
- Fix verification strategy

ANALYSIS 7: GENERAL ANALYSIS
- Immediate context (exception, component, user activity)
- Root cause determination (5 Whys)
- Impact assessment with risk factors
- Actionable recommendations (P0/P1/P2)
- Patterns and preventive insights

ANALYSIS 8: BASIC ANALYSIS
- Summary (crash ID, user, site, timestamp, exception)
- Root cause in 2-3 paragraphs (clear for all audiences)
- Immediate impact and workaround
- Quick fix (P0) with specific action
- Monitoring recommendations

═══════════════════════════════════════════════════════════════════

OUTPUT FORMAT (JSON):
{{
  "error_type": "MessageNotUnderstood",
  "error_message": "Receiver does not understand selector",
  "severity": "critical",
  "root_cause": "Start with header # SPECIALIZED ANALYSES SUITE (8 PARTS) then include all 8 analyses: ANALYSIS 1 through ANALYSIS 8 with detailed markdown sections",
  "suggested_fixes": [
    "P0 - Fix missing method in MyClass",
    "P1 - Add validation before sending",
    "P2 - Refactor protocol handling"
  ],
  "component": "MyClass",
  "stack_trace": "Stack trace with key frames",
  "confidence": "high"
}}

REQUIREMENTS FOR ALL ANALYSES:
- Perform ALL 8 analyses even if some do not apply (state when not applicable)
- Be specific with Class method notation
- Include code examples in recommendations
- For non-applicable analyses clearly state why
- Maintain consistent findings across all 8 analyses
- Use markdown formatting in root_cause field
- Make each analysis actionable and specific

IMPORTANT: Return ONLY valid JSON with all 8 analyses in the root_cause field."#, crash_content)
}

pub async fn call_openai(
    system_prompt: &str,
    user_prompt: &str,
    api_key: &str,
    model: &str,
) -> Result<AnalysisResult, String> {
    let client = reqwest::Client::new();

    // GPT-4 and GPT-5 models use different parameter names
    let is_gpt5 = model.starts_with("gpt-5") || model.starts_with("o1") || model.starts_with("o3");

    let mut request_body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.3
    });

    // Use appropriate token parameter based on model
    if is_gpt5 {
        request_body["max_completion_tokens"] = json!(4000);
    } else {
        request_body["max_tokens"] = json!(4000);
    }

    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("OpenAI API request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("OpenAI API error: {}", error_text));
    }

    let response_data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;

    let content = response_data["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("No content in OpenAI response")?;

    let tokens = response_data["usage"]["total_tokens"]
        .as_i64()
        .unwrap_or(0) as i32;

    // Rough cost estimate (GPT-4 Turbo pricing)
    let cost = (tokens as f64 / 1000.0) * 0.01;

    parse_analysis_json(content, tokens, cost)
}

pub async fn call_anthropic(
    system_prompt: &str,
    user_prompt: &str,
    api_key: &str,
    model: &str,
) -> Result<AnalysisResult, String> {
    let client = reqwest::Client::new();

    let request_body = json!({
        "model": model,
        "max_tokens": 4000,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": user_prompt}
        ]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("Content-Type", "application/json")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Anthropic API request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Anthropic API error: {}", error_text));
    }

    let response_data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

    let content = response_data["content"][0]["text"]
        .as_str()
        .ok_or("No content in Anthropic response")?;

    let input_tokens = response_data["usage"]["input_tokens"].as_i64().unwrap_or(0);
    let output_tokens = response_data["usage"]["output_tokens"].as_i64().unwrap_or(0);
    let tokens = (input_tokens + output_tokens) as i32;

    // Rough cost estimate (Claude 3.5 Sonnet pricing: $3/$15 per M tokens)
    let cost = (input_tokens as f64 / 1_000_000.0) * 3.0 + (output_tokens as f64 / 1_000_000.0) * 15.0;

    parse_analysis_json(content, tokens, cost)
}

pub async fn call_zai(
    system_prompt: &str,
    user_prompt: &str,
    api_key: &str,
    model: &str,
) -> Result<AnalysisResult, String> {
    let client = reqwest::Client::new();

    let request_body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
    });

    // NOTE: Z.ai endpoint inconsistency - This uses open.bigmodel.cn for chat completions,
    // while model_fetcher.rs uses api.z.ai for listing models. Consider unifying to a single
    // endpoint domain to reduce provider-specific surprises and improve maintainability.
    let response = client
        .post("https://open.bigmodel.cn/api/paas/v4/chat/completions")
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Z.ai API request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Z.ai API error: {}", error_text));
    }

    let response_data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Z.ai response: {}", e))?;

    let content = response_data["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("No content in Z.ai response")?;

    let tokens = response_data["usage"]["total_tokens"]
        .as_i64()
        .unwrap_or(0) as i32;

    // Z.ai is flat $3/month, so cost is minimal per request
    let cost = 0.001;

    parse_analysis_json(content, tokens, cost)
}

fn parse_analysis_json(content: &str, tokens: i32, cost: f64) -> Result<AnalysisResult, String> {
    // Extract JSON from response (look for first { to last }).
    // If no JSON is found or parsing fails, fall back to treating the entire
    // response as a free-form root cause description.
    if let (Some(json_start), Some(json_end)) = (content.find('{'), content.rfind('}')) {
        let json_str = &content[json_start..=json_end];

        match serde_json::from_str::<serde_json::Value>(json_str) {
            Ok(parsed) => {
                return Ok(AnalysisResult {
                    error_type: parsed["error_type"].as_str().unwrap_or("Unknown").to_string(),
                    error_message: parsed["error_message"].as_str().map(|s| s.to_string()),
                    severity: parsed["severity"].as_str().unwrap_or("medium").to_lowercase(),
                    root_cause: parsed["root_cause"].as_str().unwrap_or("Unable to determine root cause").to_string(),
                    suggested_fixes: parsed["suggested_fixes"]
                        .as_array()
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default(),
                    component: parsed["component"].as_str().map(|s| s.to_string()),
                    stack_trace: parsed["stack_trace"].as_str().map(|s| s.to_string()),
                    confidence: parsed["confidence"].as_str().unwrap_or("medium").to_string(),
                    tokens_used: tokens,
                    cost,
                    was_truncated: Some(false),
                    analysis_duration_ms: None,
                });
            }
            Err(e) => {
                log::warn!(
                    "Failed to parse AI JSON response, falling back to raw text. Error: {}",
                    e
                );
            }
        }
    } else {
        log::warn!("No JSON object found in AI response, falling back to raw text.");
    }

    // Fallback: treat the entire content as a narrative root cause description.
    Ok(AnalysisResult {
        error_type: "Unknown".to_string(),
        error_message: None,
        severity: "medium".to_string(),
        root_cause: content.to_string(),
        suggested_fixes: Vec::new(),
        component: None,
        stack_trace: None,
        confidence: "low".to_string(),
        tokens_used: tokens,
        cost,
        was_truncated: Some(false),
        analysis_duration_ms: None,
    })
}

pub async fn call_ollama(
    system_prompt: &str,
    user_prompt: &str,
    model: &str,
) -> Result<AnalysisResult, String> {
    let client = reqwest::Client::new();

    let request_body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "stream": false
    });

    // Ollama runs locally at http://127.0.0.1:11434
    // No API key required for local Ollama instances
    let response = client
        .post("http://127.0.0.1:11434/api/chat")
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed (is Ollama running?): {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Ollama API error: {}", error_text));
    }

    let response_data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    // Ollama response structure: {"message": {"content": "..."}, ...}
    let content = response_data["message"]["content"]
        .as_str()
        .ok_or("No content in Ollama response")?;

    // Ollama is local and free: zero tokens and zero cost
    let tokens = 0;
    let cost = 0.0;

    parse_analysis_json(content, tokens, cost)
}

/// Translate technical content to plain language using Ollama
pub async fn translate_ollama(
    content: &str,
    model: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    let system_prompt = "You are a technical translator. Convert complex technical content into clear, plain language that non-technical users can understand. Maintain accuracy while simplifying jargon and explaining concepts.";

    let user_prompt = format!("Translate this technical content to plain language:\n\n{}", content);

    let request_body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "stream": false
    });

    // Ollama runs locally at http://127.0.0.1:11434
    let response = client
        .post("http://127.0.0.1:11434/api/chat")
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Ollama translation request failed (is Ollama running?): {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Ollama translation error: {}", error_text));
    }

    let response_data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama translation response: {}", e))?;

    // Ollama response structure: {"message": {"content": "..."}, ...}
    let translation = response_data["message"]["content"]
        .as_str()
        .ok_or("No content in Ollama translation response")?
        .to_string();

    Ok(translation)
}

pub async fn analyze_crash_log(
    crash_content: &str,
    api_key: &str,
    model: &str,
    provider: &str,
    analysis_type: &str,
) -> Result<AnalysisResult, String> {
    let start_time = std::time::Instant::now();

    let (system_prompt, user_prompt) = if analysis_type == "complete" {
        (COMPLETE_ANALYSIS_SYSTEM_PROMPT, get_complete_analysis_prompt(crash_content))
    } else {
        (SPECIALIZED_ANALYSIS_SYSTEM_PROMPT, get_specialized_analysis_prompt(crash_content))
    };

    let mut result = match provider.to_lowercase().as_str() {
        "openai" => call_openai(&system_prompt, &user_prompt, api_key, model).await?,
        "anthropic" => call_anthropic(&system_prompt, &user_prompt, api_key, model).await?,
        "zai" => call_zai(&system_prompt, &user_prompt, api_key, model).await?,
        "ollama" => call_ollama(&system_prompt, &user_prompt, model).await?,
        _ => return Err(format!("Unknown provider: {}", provider))
    };

    // Add analysis duration
    result.analysis_duration_ms = Some(start_time.elapsed().as_millis() as i32);

    Ok(result)
}
