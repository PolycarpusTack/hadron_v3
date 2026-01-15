use serde::{Deserialize, Serialize};
use serde_json::json;
use log;
use std::time::Duration;

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

// ============================================================================
// Provider Configuration
// ============================================================================

/// Configuration for an AI provider endpoint
struct ProviderConfig {
    name: &'static str,
    endpoint: &'static str,
    /// How to include the API key in the request
    auth_style: AuthStyle,
    /// How to extract content from the response
    response_style: ResponseStyle,
    /// Cost calculation method
    cost_calculator: CostCalculator,
}

enum AuthStyle {
    /// Bearer token in Authorization header
    Bearer,
    /// Anthropic-style x-api-key header
    AnthropicHeader,
    /// No authentication (local providers)
    None,
}

enum ResponseStyle {
    /// OpenAI-style: choices[0].message.content
    OpenAI,
    /// Anthropic-style: content[0].text
    Anthropic,
    /// Ollama-style: message.content
    Ollama,
}

enum CostCalculator {
    /// GPT-4 Turbo pricing: $0.01 per 1K tokens
    Gpt4Turbo,
    /// Claude 3.5 Sonnet: $3/$15 per M tokens (input/output)
    Claude35Sonnet,
    /// Flat rate per request
    FlatRate(f64),
    /// Free (local providers)
    Free,
}

impl ProviderConfig {
    fn openai() -> Self {
        Self {
            name: "OpenAI",
            endpoint: "https://api.openai.com/v1/chat/completions",
            auth_style: AuthStyle::Bearer,
            response_style: ResponseStyle::OpenAI,
            cost_calculator: CostCalculator::Gpt4Turbo,
        }
    }

    fn anthropic() -> Self {
        Self {
            name: "Anthropic",
            endpoint: "https://api.anthropic.com/v1/messages",
            auth_style: AuthStyle::AnthropicHeader,
            response_style: ResponseStyle::Anthropic,
            cost_calculator: CostCalculator::Claude35Sonnet,
        }
    }

    fn zai() -> Self {
        Self {
            name: "Z.ai",
            endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
            auth_style: AuthStyle::Bearer,
            response_style: ResponseStyle::OpenAI,
            cost_calculator: CostCalculator::FlatRate(0.001),
        }
    }

    fn ollama() -> Self {
        Self {
            name: "Ollama",
            endpoint: "http://127.0.0.1:11434/api/chat",
            auth_style: AuthStyle::None,
            response_style: ResponseStyle::Ollama,
            cost_calculator: CostCalculator::Free,
        }
    }
}

// ============================================================================
// Prompts
// ============================================================================

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

// ============================================================================
// Unified HTTP Client
// ============================================================================

/// Shared HTTP client with configured timeout
fn create_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Build request body for OpenAI-compatible APIs
fn build_openai_request(
    system_prompt: &str,
    user_prompt: &str,
    model: &str,
) -> serde_json::Value {
    let is_gpt5 = model.starts_with("gpt-5") || model.starts_with("o1") || model.starts_with("o3");

    let mut body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.3
    });

    if is_gpt5 {
        body["max_completion_tokens"] = json!(4000);
    } else {
        body["max_tokens"] = json!(4000);
    }

    body
}

/// Build request body for Anthropic API
fn build_anthropic_request(
    system_prompt: &str,
    user_prompt: &str,
    model: &str,
) -> serde_json::Value {
    json!({
        "model": model,
        "max_tokens": 4000,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": user_prompt}
        ]
    })
}

/// Build request body for Ollama API
fn build_ollama_request(
    system_prompt: &str,
    user_prompt: &str,
    model: &str,
) -> serde_json::Value {
    json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "stream": false
    })
}

/// Response data extracted from provider response
struct ProviderResponse {
    content: String,
    tokens: i32,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
}

/// Extract response data based on provider's response style
fn extract_response(
    response_data: &serde_json::Value,
    style: &ResponseStyle,
) -> Result<ProviderResponse, String> {
    match style {
        ResponseStyle::OpenAI => {
            let content = response_data["choices"][0]["message"]["content"]
                .as_str()
                .ok_or("No content in response")?
                .to_string();
            let tokens = response_data["usage"]["total_tokens"]
                .as_i64()
                .unwrap_or(0) as i32;
            Ok(ProviderResponse {
                content,
                tokens,
                input_tokens: None,
                output_tokens: None,
            })
        }
        ResponseStyle::Anthropic => {
            let content = response_data["content"][0]["text"]
                .as_str()
                .ok_or("No content in response")?
                .to_string();
            let input_tokens = response_data["usage"]["input_tokens"].as_i64().unwrap_or(0);
            let output_tokens = response_data["usage"]["output_tokens"].as_i64().unwrap_or(0);
            Ok(ProviderResponse {
                content,
                tokens: (input_tokens + output_tokens) as i32,
                input_tokens: Some(input_tokens),
                output_tokens: Some(output_tokens),
            })
        }
        ResponseStyle::Ollama => {
            let content = response_data["message"]["content"]
                .as_str()
                .ok_or("No content in response")?
                .to_string();
            Ok(ProviderResponse {
                content,
                tokens: 0,
                input_tokens: None,
                output_tokens: None,
            })
        }
    }
}

/// Calculate cost based on provider's pricing model
fn calculate_cost(
    response: &ProviderResponse,
    calculator: &CostCalculator,
) -> f64 {
    match calculator {
        CostCalculator::Gpt4Turbo => (response.tokens as f64 / 1000.0) * 0.01,
        CostCalculator::Claude35Sonnet => {
            let input = response.input_tokens.unwrap_or(0) as f64;
            let output = response.output_tokens.unwrap_or(0) as f64;
            (input / 1_000_000.0) * 3.0 + (output / 1_000_000.0) * 15.0
        }
        CostCalculator::FlatRate(rate) => *rate,
        CostCalculator::Free => 0.0,
    }
}

/// Unified provider call function
async fn call_provider(
    config: ProviderConfig,
    request_body: serde_json::Value,
    api_key: &str,
) -> Result<AnalysisResult, String> {
    let client = create_http_client();

    // Build request with appropriate auth
    let mut request = client
        .post(config.endpoint)
        .header("Content-Type", "application/json");

    request = match config.auth_style {
        AuthStyle::Bearer => request.header("Authorization", format!("Bearer {}", api_key)),
        AuthStyle::AnthropicHeader => request
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01"),
        AuthStyle::None => request,
    };

    // Send request
    let response = request
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("{} API request failed: {}", config.name, e))?;

    // Check response status
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("{} API error: {}", config.name, error_text));
    }

    // Parse response
    let response_data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse {} response: {}", config.name, e))?;

    // Extract content and tokens
    let provider_response = extract_response(&response_data, &config.response_style)
        .map_err(|e| format!("{} response error: {}", config.name, e))?;

    // Calculate cost
    let cost = calculate_cost(&provider_response, &config.cost_calculator);

    // Parse the AI's JSON response into our result struct
    parse_analysis_json(&provider_response.content, provider_response.tokens, cost)
}

// ============================================================================
// Public Provider Functions (thin wrappers for backwards compatibility)
// ============================================================================

pub async fn call_openai(
    system_prompt: &str,
    user_prompt: &str,
    api_key: &str,
    model: &str,
) -> Result<AnalysisResult, String> {
    let request_body = build_openai_request(system_prompt, user_prompt, model);
    call_provider(ProviderConfig::openai(), request_body, api_key).await
}

pub async fn call_anthropic(
    system_prompt: &str,
    user_prompt: &str,
    api_key: &str,
    model: &str,
) -> Result<AnalysisResult, String> {
    let request_body = build_anthropic_request(system_prompt, user_prompt, model);
    call_provider(ProviderConfig::anthropic(), request_body, api_key).await
}

pub async fn call_zai(
    system_prompt: &str,
    user_prompt: &str,
    api_key: &str,
    model: &str,
) -> Result<AnalysisResult, String> {
    let request_body = build_openai_request(system_prompt, user_prompt, model);
    call_provider(ProviderConfig::zai(), request_body, api_key).await
}

pub async fn call_ollama(
    system_prompt: &str,
    user_prompt: &str,
    model: &str,
) -> Result<AnalysisResult, String> {
    let request_body = build_ollama_request(system_prompt, user_prompt, model);
    call_provider(ProviderConfig::ollama(), request_body, "").await
}

// ============================================================================
// JSON Parsing
// ============================================================================

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

// ============================================================================
// Translation (Ollama only)
// ============================================================================

/// Translate technical content to plain language using Ollama
pub async fn translate_ollama(
    content: &str,
    model: &str,
) -> Result<String, String> {
    let client = create_http_client();

    let system_prompt = "You are a technical translator. Convert complex technical content into clear, plain language that non-technical users can understand. Maintain accuracy while simplifying jargon and explaining concepts.";

    let user_prompt = format!("Translate this technical content to plain language:\n\n{}", content);

    let request_body = build_ollama_request(system_prompt, &user_prompt, model);

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

    let translation = response_data["message"]["content"]
        .as_str()
        .ok_or("No content in Ollama translation response")?
        .to_string();

    Ok(translation)
}

// ============================================================================
// Main Entry Point
// ============================================================================

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
        "openai" => call_openai(system_prompt, &user_prompt, api_key, model).await?,
        "anthropic" => call_anthropic(system_prompt, &user_prompt, api_key, model).await?,
        "zai" => call_zai(system_prompt, &user_prompt, api_key, model).await?,
        "ollama" => call_ollama(system_prompt, &user_prompt, model).await?,
        _ => return Err(format!("Unknown provider: {}. Supported: openai, anthropic, zai, ollama", provider))
    };

    // Add analysis duration
    result.analysis_duration_ms = Some(start_time.elapsed().as_millis() as i32);

    Ok(result)
}
