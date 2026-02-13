/// Token Budget Management for Safe LLM Analysis
///
/// Provides token estimation and strategy selection to prevent context_length_exceeded errors.
use serde::{Deserialize, Serialize};

// ============================================================================
// Model Context Limits
// ============================================================================

/// Known context window sizes for different models
pub fn get_model_context_limit(model: &str) -> u32 {
    let model_lower = model.to_lowercase();

    // OpenAI models
    // GPT-4 Turbo variants (128K context): gpt-4-turbo, gpt-4o, gpt-4.1, gpt-4.5, etc.
    if model_lower.starts_with("gpt-4-turbo")
        || model_lower.contains("gpt-4o")
        || model_lower.starts_with("gpt-4.1")
        || model_lower.starts_with("gpt-4.5")
        || model_lower.starts_with("gpt-4-1")
    {
        return 128_000;
    }
    if model_lower.starts_with("gpt-4-32k") {
        return 32_768;
    }
    // Legacy GPT-4 (8K context) - only if no turbo/4o/4.x variant
    if model_lower.starts_with("gpt-4") && !model_lower.contains("turbo") {
        return 8_192;
    }
    if model_lower.starts_with("o1") || model_lower.starts_with("o3") {
        return 128_000;
    }
    if model_lower.starts_with("gpt-5") {
        return 200_000;
    }

    // Anthropic Claude models
    if model_lower.contains("claude") {
        return 200_000;
    }

    // Z.ai GLM models
    if model_lower.contains("glm-4") {
        return 128_000;
    }

    // llama.cpp local models - conservative default
    if model_lower.contains("llama") || model_lower.contains("mistral") {
        return 8_192;
    }
    if model_lower.contains("qwen") {
        return 32_768;
    }
    if model_lower.contains("deepseek") {
        return 64_000;
    }

    // Conservative default for unknown models
    32_000
}

// ============================================================================
// Configuration
// ============================================================================

/// Default configuration for token budgeting
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetConfig {
    /// Reserve for system prompt (typically 2-4K)
    pub system_reserve: u32,
    /// Reserve for expected output (4-8K for detailed analysis)
    pub output_reserve: u32,
    /// Safety margin percentage (0.0-0.2)
    pub safety_margin: f32,
    /// Minimum tokens needed for useful input
    pub min_input_tokens: u32,
    /// Threshold ratio for auto-fallback to deep scan
    pub deep_scan_threshold: f32,
}

impl Default for BudgetConfig {
    fn default() -> Self {
        Self {
            system_reserve: 3_000,
            output_reserve: 6_000,
            safety_margin: 0.10,
            min_input_tokens: 1_000,
            deep_scan_threshold: 0.85, // Trigger deep scan if input uses >85% of budget
        }
    }
}

// ============================================================================
// Token Estimation
// ============================================================================

/// Estimate token count from text
/// Uses a conservative approximation: ~4 chars per token for English
/// Smalltalk code tends to be more verbose, so we use 3.5 for safety
pub fn estimate_tokens(text: &str) -> u32 {
    // Conservative estimate: 3.5 characters per token
    // This accounts for Smalltalk's verbose nature (>>methodName, etc.)
    (text.len() as f32 / 3.5).ceil() as u32
}

/// Estimate tokens for structured crash data
pub fn estimate_crash_data_tokens(crash_json: &str) -> u32 {
    // JSON is more compact, use 4.0 chars per token
    (crash_json.len() as f32 / 4.0).ceil() as u32
}

// ============================================================================
// Strategy Selection
// ============================================================================

/// Analysis strategy based on token budget
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AnalysisStrategy {
    /// Input fits comfortably, single API call
    SingleCall,
    /// Need to extract evidence to fit
    ExtractionRequired,
    /// Input still too large, need chunked deep scan
    DeepScanRequired,
    /// Input exceeds all reasonable limits
    InputTooLarge,
}

/// Result of token budget analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetAnalysis {
    /// Recommended strategy
    pub strategy: AnalysisStrategy,
    /// Total context limit for the model
    pub model_context_limit: u32,
    /// Safe input budget after reserves
    pub safe_input_budget: u32,
    /// Estimated input tokens
    pub estimated_input_tokens: u32,
    /// Budget utilization (0.0-1.0+)
    pub utilization: f32,
    /// Recommended preview lines for walkback
    pub recommended_preview_lines: usize,
    /// Recommended max matched lines
    pub recommended_matched_lines: usize,
    /// Whether to include full DB sessions
    pub include_full_db_sessions: bool,
    /// Whether to include full windows list
    pub include_full_windows: bool,
}

// ============================================================================
// TokenBudgeter
// ============================================================================

/// Token budget manager for crash analysis
pub struct TokenBudgeter {
    config: BudgetConfig,
    model_limit: u32,
}

impl TokenBudgeter {
    /// Create a new budgeter for the specified model
    pub fn new(model: &str) -> Self {
        Self {
            config: BudgetConfig::default(),
            model_limit: get_model_context_limit(model),
        }
    }

    /// Create with custom configuration
    #[allow(dead_code)]
    pub fn with_config(model: &str, config: BudgetConfig) -> Self {
        Self {
            config,
            model_limit: get_model_context_limit(model),
        }
    }

    /// Calculate safe input budget
    pub fn safe_input_budget(&self) -> u32 {
        let reserved = self.config.system_reserve + self.config.output_reserve;
        let available = self.model_limit.saturating_sub(reserved);
        let after_margin = (available as f32 * (1.0 - self.config.safety_margin)) as u32;
        after_margin.max(self.config.min_input_tokens)
    }

    /// Analyze input and recommend strategy
    pub fn analyze(
        &self,
        structured_content: &str,
        raw_walkback: Option<&str>,
        system_prompt_tokens: u32,
    ) -> BudgetAnalysis {
        let safe_budget = self.safe_input_budget();

        // Estimate tokens for structured content
        let structured_tokens = estimate_crash_data_tokens(structured_content);

        // Estimate tokens for raw walkback (if present)
        let walkback_tokens = raw_walkback.map(estimate_tokens).unwrap_or(0);

        // Adjust for actual system prompt size
        let effective_budget = safe_budget
            .saturating_sub(system_prompt_tokens.saturating_sub(self.config.system_reserve));

        // Total estimated input
        let total_estimated = structured_tokens + walkback_tokens;
        let utilization = total_estimated as f32 / effective_budget as f32;

        // Determine strategy
        let strategy = if utilization <= 0.7 {
            AnalysisStrategy::SingleCall
        } else if utilization <= self.config.deep_scan_threshold {
            AnalysisStrategy::ExtractionRequired
        } else if utilization <= 2.0 {
            AnalysisStrategy::DeepScanRequired
        } else {
            // Even with deep scan, this might be too large
            // We can still try deep scan with aggressive chunking
            AnalysisStrategy::DeepScanRequired
        };

        // Calculate recommended caps based on remaining budget
        let (preview_lines, matched_lines, include_db, include_windows) =
            self.calculate_caps(effective_budget, structured_tokens, walkback_tokens);

        BudgetAnalysis {
            strategy,
            model_context_limit: self.model_limit,
            safe_input_budget: effective_budget,
            estimated_input_tokens: total_estimated,
            utilization,
            recommended_preview_lines: preview_lines,
            recommended_matched_lines: matched_lines,
            include_full_db_sessions: include_db,
            include_full_windows: include_windows,
        }
    }

    /// Calculate recommended caps for various sections
    fn calculate_caps(
        &self,
        budget: u32,
        structured_tokens: u32,
        walkback_tokens: u32,
    ) -> (usize, usize, bool, bool) {
        // Base caps for comfortable fit
        let base_preview = 300;
        let base_matched = 200;

        let utilization = (structured_tokens + walkback_tokens) as f32 / budget as f32;

        if utilization <= 0.5 {
            // Plenty of room - use generous defaults
            (base_preview, base_matched, true, true)
        } else if utilization <= 0.7 {
            // Getting tight - reduce slightly
            (200, 150, true, true)
        } else if utilization <= 0.85 {
            // Need to trim
            (150, 100, true, false)
        } else if utilization <= 1.0 {
            // Aggressive trimming
            (100, 75, false, false)
        } else {
            // Minimal extraction only
            (50, 50, false, false)
        }
    }

    /// Get the model's context limit
    #[allow(dead_code)]
    pub fn model_limit(&self) -> u32 {
        self.model_limit
    }

    /// Get the configuration
    #[allow(dead_code)]
    pub fn config(&self) -> &BudgetConfig {
        &self.config
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_context_limits() {
        assert_eq!(get_model_context_limit("gpt-4-turbo"), 128_000);
        assert_eq!(get_model_context_limit("gpt-4o-mini"), 128_000);
        assert_eq!(get_model_context_limit("gpt-4"), 8_192);
        assert_eq!(get_model_context_limit("claude-3-sonnet"), 200_000);
        assert_eq!(get_model_context_limit("o1-preview"), 128_000);
        assert_eq!(get_model_context_limit("unknown-model"), 32_000);
    }

    #[test]
    fn test_token_estimation() {
        // 100 chars should be roughly 25-30 tokens
        let text = "a".repeat(100);
        let tokens = estimate_tokens(&text);
        assert!(
            (25..=35).contains(&tokens),
            "Got {} tokens for 100 chars",
            tokens
        );
    }

    #[test]
    fn test_strategy_selection_small_input() {
        let budgeter = TokenBudgeter::new("gpt-4-turbo");
        let small_content = r#"{"exception": "MessageNotUnderstood"}"#;

        let analysis = budgeter.analyze(small_content, None, 3000);
        assert_eq!(analysis.strategy, AnalysisStrategy::SingleCall);
        assert!(analysis.utilization < 0.1);
    }

    #[test]
    fn test_strategy_selection_large_walkback() {
        let budgeter = TokenBudgeter::new("gpt-4"); // Small 8K context
        let content = r#"{"exception": "Test"}"#;
        // Create a large walkback (200KB)
        let walkback = "Stack frame\n".repeat(20000);

        let analysis = budgeter.analyze(content, Some(&walkback), 3000);
        assert!(matches!(
            analysis.strategy,
            AnalysisStrategy::ExtractionRequired | AnalysisStrategy::DeepScanRequired
        ));
    }

    #[test]
    fn test_safe_budget_calculation() {
        let budgeter = TokenBudgeter::new("gpt-4-turbo"); // 128K context
        let safe = budgeter.safe_input_budget();

        // Should be roughly 128K - 9K reserves - 10% margin
        // = 119K * 0.9 = ~107K
        assert!(safe > 100_000 && safe < 120_000, "Safe budget: {}", safe);
    }
}
