use futures::StreamExt;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;
use tauri::Emitter;

use crate::str_utils::floor_char_boundary;

/// Shared HTTP client singleton (reqwest::Client is Arc-based, clone is cheap).
static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

use crate::deep_scan::{ChunkAnalysis, DeepScanRunner};
use crate::evidence_extractor::{EvidenceExtractor, ExtractionConfig};
use crate::token_budget::{AnalysisStrategy, BudgetAnalysis, TokenBudgeter};

// ============================================================================
// RAG Context for Enhanced Analysis (Phase 2.3)
// ============================================================================

/// Similar case from RAG retrieval
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagSimilarCase {
    pub citation_id: String,
    pub similarity_score: f64,
    pub root_cause: String,
    pub suggested_fixes: Vec<String>,
    pub is_gold: bool,
    pub component: Option<String>,
    pub severity: Option<String>,
}

/// RAG context for enhanced analysis
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RagContext {
    pub similar_cases: Vec<RagSimilarCase>,
    pub gold_matches: Vec<RagSimilarCase>,
    pub confidence_boost: f64,
    pub retrieval_time_ms: Option<i64>,
}

/// Domain knowledge from WHATS'ON Knowledge Base and Release Notes
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DomainKnowledge {
    pub kb_results: Vec<DomainKnowledgeItem>,
    pub release_note_results: Vec<DomainKnowledgeItem>,
    pub retrieval_time_ms: Option<i64>,
    pub source_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainKnowledgeItem {
    pub text: String,
    pub link: String,
    pub page_title: String,
    pub won_version: String,
    pub score: f64,
    pub source_type: String,
}

impl DomainKnowledge {
    pub fn has_content(&self) -> bool {
        !self.kb_results.is_empty() || !self.release_note_results.is_empty()
    }

    /// Format domain knowledge for injection into the AI prompt
    pub fn format_for_prompt(&self) -> String {
        if !self.has_content() {
            return String::new();
        }

        let mut output = String::new();
        output.push_str("\n## WHATS'ON DOMAIN KNOWLEDGE (from Knowledge Base & Release Notes)\n\n");

        for item in self.kb_results.iter().chain(self.release_note_results.iter()) {
            // Truncate each result to ~800 chars to control token usage
            let text = if item.text.len() > 800 {
                let end = floor_char_boundary(&item.text, 800);
                format!("{}...", &item.text[..end])
            } else {
                item.text.clone()
            };

            output.push_str("<documentation>\n");
            if !item.link.is_empty() {
                output.push_str(&format!("<url>{}</url>", item.link));
            }
            output.push_str(&format!("<source>{}</source>", item.source_type));
            if !item.won_version.is_empty() {
                output.push_str(&format!("<won_version>{}</won_version>", item.won_version));
            }
            if !item.page_title.is_empty() {
                output.push_str(&format!("<title>{}</title>", item.page_title));
            }
            output.push_str(&format!("\n<extract>{}</extract>\n", text));
            output.push_str("</documentation>\n\n");
        }

        output
    }
}

impl From<crate::rag_commands::SimilarCase> for RagSimilarCase {
    fn from(c: crate::rag_commands::SimilarCase) -> Self {
        Self {
            citation_id: c.citation_id,
            similarity_score: c.similarity_score,
            root_cause: c.root_cause,
            suggested_fixes: c.suggested_fixes,
            is_gold: c.is_gold,
            component: c.component,
            severity: c.severity,
        }
    }
}

impl From<crate::rag_commands::RAGContext> for RagContext {
    fn from(ctx: crate::rag_commands::RAGContext) -> Self {
        Self {
            similar_cases: ctx.similar_analyses.into_iter().map(RagSimilarCase::from).collect(),
            gold_matches: ctx.gold_matches.into_iter().map(RagSimilarCase::from).collect(),
            confidence_boost: ctx.confidence_boost,
            retrieval_time_ms: ctx.retrieval_time_ms,
        }
    }
}

impl From<crate::rag_commands::KBContext> for DomainKnowledge {
    fn from(ctx: crate::rag_commands::KBContext) -> Self {
        Self {
            kb_results: ctx
                .kb_results
                .into_iter()
                .map(|r| DomainKnowledgeItem {
                    text: r.text,
                    link: r.link,
                    page_title: r.page_title,
                    won_version: r.won_version,
                    score: r.score,
                    source_type: r.source_type,
                })
                .collect(),
            release_note_results: ctx
                .release_note_results
                .into_iter()
                .map(|r| DomainKnowledgeItem {
                    text: r.text,
                    link: r.link,
                    page_title: r.page_title,
                    won_version: r.won_version,
                    score: r.score,
                    source_type: r.source_type,
                })
                .collect(),
            retrieval_time_ms: ctx.retrieval_time_ms,
            source_mode: ctx.source_mode,
        }
    }
}

impl RagContext {
    /// Check if RAG context has any useful data
    pub fn has_context(&self) -> bool {
        !self.similar_cases.is_empty() || !self.gold_matches.is_empty()
    }

    /// Build formatted context string for prompt injection
    pub fn format_for_prompt(&self) -> String {
        if !self.has_context() {
            return String::new();
        }

        let mut context = String::new();
        context.push_str("\n## SIMILAR HISTORICAL CASES (RAG Retrieved)\n\n");
        context.push_str("Use these similar past cases as reference when analyzing. CITE relevant cases in your analysis.\n\n");

        // Gold matches first (higher quality)
        if !self.gold_matches.is_empty() {
            context.push_str("### Verified Gold Standard Cases:\n");
            for case in self.gold_matches.iter() {
                let score = (case.similarity_score * 100.0).round() as i32;
                context.push_str(&format!(
                    "\n**Case #{} [{}% match] 🏆 VERIFIED**\n",
                    case.citation_id, score
                ));
                if let Some(component) = &case.component {
                    context.push_str(&format!("- Component: {}\n", component));
                }
                if let Some(severity) = &case.severity {
                    context.push_str(&format!("- Severity: {}\n", severity));
                }
                context.push_str(&format!("- Root Cause: {}\n", case.root_cause));
                if !case.suggested_fixes.is_empty() {
                    context.push_str(&format!("- Resolution: {}\n", case.suggested_fixes.join("; ")));
                }
            }
            context.push('\n');
        }

        // Similar cases
        if !self.similar_cases.is_empty() {
            context.push_str("### Similar Historical Cases:\n");
            for case in self.similar_cases.iter().take(5) {
                let score = (case.similarity_score * 100.0).round() as i32;
                let gold_badge = if case.is_gold { " 🏆" } else { "" };
                context.push_str(&format!(
                    "\n**Case #{}{} [{}% match]**\n",
                    case.citation_id, gold_badge, score
                ));
                if let Some(component) = &case.component {
                    context.push_str(&format!("- Component: {}\n", component));
                }
                context.push_str(&format!("- Root Cause: {}\n", case.root_cause));
                if !case.suggested_fixes.is_empty() {
                    context.push_str(&format!("- Resolution: {}\n", case.suggested_fixes[0]));
                }
            }
            context.push('\n');
        }

        context.push_str("### Citation Instructions:\n");
        context.push_str("- If your analysis is informed by a similar case, cite it as: \"Similar to Case #X\"\n");
        context.push_str("- If no similar cases are relevant, state: \"No directly relevant historical cases\"\n");
        context.push_str("- Prefer citing verified gold cases over unverified ones\n\n");

        context
    }
}

// ============================================================================
// Analysis Result with Token-Safe Metadata
// ============================================================================

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
    /// Raw JSON response for WHATS'ON enhanced analyses
    /// This contains the full structured analysis that can be parsed by the frontend
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_enhanced_json: Option<String>,
    /// Token-safe analysis metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analysis_meta: Option<AnalysisMeta>,
}

/// Metadata about the token-safe analysis process
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisMeta {
    /// Analysis mode used
    pub mode: AnalysisMode,
    /// What was included in the analysis
    pub coverage: AnalysisCoverage,
    /// Token estimates
    pub token_estimates: TokenEstimates,
    /// Evidence extraction summary (if applicable)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_summary: Option<String>,
    /// Number of chunks analyzed (for deep scan)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunks_analyzed: Option<usize>,
}

/// Analysis mode
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AnalysisMode {
    /// Single API call, content fit within budget
    Quick,
    /// Evidence extraction was used to reduce size
    QuickWithExtraction,
    /// Deep scan map-reduce was used
    DeepScan,
}

/// What data was included in the analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisCoverage {
    /// Structured crash data was included
    pub structured_included: bool,
    /// How walkback was included
    pub walkback_coverage: WalkbackCoverage,
    /// How DB sessions were included
    pub db_sessions_coverage: DataCoverage,
    /// How windows list was included
    pub windows_coverage: DataCoverage,
}

/// How the walkback was covered
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WalkbackCoverage {
    /// No walkback in source data
    None,
    /// Full walkback included
    Full,
    /// Preview + extracted evidence only
    Preview,
    /// Deep scanned via map-reduce
    DeepScanned,
}

/// How a data section was covered
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DataCoverage {
    /// Not present in source
    None,
    /// Fully included
    Full,
    /// Summarized/capped
    Summarized,
    /// Excluded due to budget
    Excluded,
}

/// Token usage estimates
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenEstimates {
    /// Estimated input tokens
    pub estimated_input_tokens: u32,
    /// Safe budget for input
    pub budget_input_tokens: u32,
    /// Reserved for output
    pub reserve_output_tokens: u32,
    /// Budget utilization (0.0-1.0+)
    pub utilization: f32,
}

// ============================================================================
// Analysis Request Configuration
// ============================================================================

/// Configuration for token-safe analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenSafeConfig {
    /// Force a specific analysis mode (None = auto-select)
    pub force_mode: Option<AnalysisMode>,
    /// Maximum preview lines for extraction
    pub max_preview_lines: usize,
    /// Maximum matched lines for extraction
    pub max_matched_lines: usize,
    /// Enable deep scan fallback
    pub enable_deep_scan: bool,
}

impl Default for TokenSafeConfig {
    fn default() -> Self {
        Self {
            force_mode: None,
            max_preview_lines: 300,
            max_matched_lines: 200,
            enable_deep_scan: true,
        }
    }
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

    fn llamacpp() -> Self {
        Self {
            name: "llama.cpp",
            endpoint: "http://127.0.0.1:8080/v1/chat/completions",
            auth_style: AuthStyle::None,
            response_style: ResponseStyle::OpenAI,
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

// ============================================================================
// WHATS'ON Enhanced Analysis Prompts
// ============================================================================

const WHATSON_SYSTEM_PROMPT: &str = r#"You are an expert VisualWorks Smalltalk developer with 20+ years of experience specializing in the WHATS'ON broadcast management system (MediaGeniX/Mediagenix).

## Your Expertise

### VisualWorks Smalltalk Runtime
- Message-passing semantics, method lookup chains, and doesNotUnderstand: handling
- Block closures, continuations, and non-local returns
- Memory management: oldSpace, newSpace, perm space, and garbage collection
- Process scheduling, semaphores, and shared queues
- Exception handling: on:do:, ensure:, ifCurtailed:

### WHATS'ON Domain Knowledge

#### Namespace Conventions
- **PSI.*** - Program Schedule Interface (core scheduling engine)
- **BM.*** - Broadcast Management (transmission/playout)
- **PL.*** - Playlist management and automation
- **WOn.*** - WHATS'ON application framework
- **EX.*** - External integrations and adapters
- **Core.*** - Foundation classes and utilities

#### Key Entities
- **PSITxBlock** - Transmission block representing scheduled airtime
- **BMProgramSegmentDurations** - Duration calculations for program segments
- **BMScheduleEntry** - Individual schedule entries with timing constraints
- **PLPlaylistItem** - Items in automation playlists
- **PSIChannel** - Broadcast channel configuration
- **BMAsRunLog** - As-run logging for compliance
- **WOnTransaction** - Business transaction wrapper

#### Critical Subsystems
- **Schedule Engine** - Real-time schedule optimization
- **Duration Calculator** - Frame-accurate timing (handles drop-frame, PAL/NTSC)
- **Conflict Resolver** - Schedule conflict detection and resolution
- **Playlist Generator** - Automated playlist creation from schedules
- **Rights Validator** - Content rights and holdback checking
- **Integration Hub** - Traffic, automation, and MAM system interfaces

### Broadcast Domain
- EPG (Electronic Program Guide) generation and distribution
- Traffic and scheduling workflows (proposals, contracts, orders)
- Automation system integration (playlist formats, event triggers)
- Frame-accurate timing calculations (timecodes, durations, offsets)
- Regulatory compliance (as-run logs, content ratings, accessibility)

## Analysis Approach
When analyzing crashes:
1. Identify the exact failure point in the WHATS'ON class hierarchy
2. Trace the business operation being performed (scheduling, playout, etc.)
3. Consider database session state and Oracle-specific issues
4. Evaluate memory pressure and object lifecycle
5. Map technical errors to business impact
6. Provide actionable fixes with code examples"#;

// ============================================================================
// Quick Analysis Prompts
// ============================================================================

const QUICK_ANALYSIS_SYSTEM_PROMPT: &str = r#"You are an expert VisualWorks Smalltalk developer. Your task is to quickly analyze crash logs and provide focused, actionable information.

You understand:
- VisualWorks Smalltalk runtime, message passing, and stack traces
- Common crash patterns (nil receiver, collection bounds, type errors)
- WHATS'ON/MediaGeniX broadcast scheduling domain

Keep responses concise and actionable. Focus on what matters most: the cause and the fix."#;

fn get_quick_analysis_prompt(crash_content: &str) -> String {
    format!(
        r#"Analyze this crash log quickly and provide ONLY the essential information.

CRASH LOG:
```
{}
```

Return a JSON object with this EXACT structure:
{{
  "rootCause": {{
    "title": "Brief title (max 10 words)",
    "technical": "Technical explanation of what went wrong (2-3 sentences)",
    "plainEnglish": "Simple explanation anyone can understand (1-2 sentences)",
    "affectedComponent": "The class or method that failed"
  }},
  "workaround": {{
    "available": true/false,
    "steps": ["Step 1", "Step 2"],
    "limitations": "What this workaround doesn't fix"
  }},
  "solution": {{
    "summary": "One sentence describing the proper fix",
    "steps": ["Implementation step 1", "Implementation step 2", "Implementation step 3"],
    "codeExample": "Optional: short code example if helpful",
    "complexity": "Low|Medium|High"
  }},
  "explanation": {{
    "whyThisWorks": "Why the solution addresses the root cause (2-3 sentences)",
    "prevention": "How to prevent this in the future (1-2 sentences)"
  }},
  "severity": "critical|high|medium|low",
  "errorType": "Brief error type classification"
}}

IMPORTANT:
- Be concise - this is a quick triage analysis
- Focus on actionable information
- If no workaround exists, set available to false and leave steps empty
- Return ONLY valid JSON, no markdown or additional text"#,
        crash_content
    )
}

fn get_complete_analysis_prompt(crash_content: &str) -> String {
    format!(
        r#"Analyze this VisualWorks Smalltalk crash log with a COMPLETE, COMPREHENSIVE approach following a structured 10-part format.

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

IMPORTANT: Return ONLY valid JSON, no additional text outside the JSON structure."#,
        crash_content
    )
}

fn get_specialized_analysis_prompt(crash_content: &str) -> String {
    format!(
        r#"Analyze this VisualWorks Smalltalk crash log using SPECIALIZED ANALYSES SUITE - perform ALL 8 analyses from different perspectives.

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

IMPORTANT: Return ONLY valid JSON with all 8 analyses in the root_cause field."#,
        crash_content
    )
}

fn get_whatson_analysis_prompt(crash_content: &str) -> String {
    format!(
        r#"Analyze this WHATS'ON/VisualWorks Smalltalk crash log and provide a comprehensive structured analysis.

CRASH LOG:
{}

═══════════════════════════════════════════════════════════════════
WHATS'ON ENHANCED ANALYSIS - STRUCTURED OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════

Analyze the crash log and return a JSON object with the following structure.
Be thorough and specific. Use your knowledge of WHATS'ON namespaces (PSI.*, BM.*, PL.*, WOn.*, EX.*) and broadcast domain.

OUTPUT FORMAT (JSON):
{{
  "summary": {{
    "title": "Brief descriptive title of the crash (50 chars max)",
    "severity": "critical|high|medium|low",
    "category": "scheduling|playout|database|memory|integration|ui|rights|timing|other",
    "confidence": "high|medium|low",
    "affectedWorkflow": "Brief description of the business workflow affected"
  }},
  "rootCause": {{
    "technical": "Detailed technical explanation of why the crash occurred",
    "plainEnglish": "Non-technical explanation suitable for business users",
    "affectedMethod": "ClassName>>methodName where the error originated",
    "affectedModule": "WHATS'ON module/namespace affected (e.g., PSI.ScheduleEngine)",
    "triggerCondition": "What specific condition triggered this crash"
  }},
  "userScenario": {{
    "description": "What the user was trying to accomplish",
    "workflow": "The business workflow being executed (e.g., Schedule Publication)",
    "steps": [
      {{
        "step": 1,
        "action": "User action description",
        "details": "Additional context",
        "isCrashPoint": false
      }},
      {{
        "step": 2,
        "action": "Next action where crash occurred",
        "details": "This is where the system failed",
        "isCrashPoint": true
      }}
    ],
    "expectedResult": "What should have happened",
    "actualResult": "What actually happened (the crash)",
    "reproductionLikelihood": "always|often|sometimes|rarely|unknown"
  }},
  "suggestedFix": {{
    "summary": "One-line summary of the recommended fix",
    "reasoning": "Why this fix addresses the root cause",
    "explanation": "Detailed explanation of the fix approach",
    "codeChanges": [
      {{
        "file": "ClassName or method location",
        "description": "What needs to change",
        "before": "Problematic code snippet (if identifiable)",
        "after": "Suggested fix code",
        "priority": "P0|P1|P2"
      }}
    ],
    "complexity": "simple|moderate|complex",
    "estimatedEffort": "hours|days|weeks",
    "riskLevel": "low|medium|high"
  }},
  "systemWarnings": [
    {{
      "source": "memory|database|process|network|configuration|other",
      "severity": "critical|warning|info",
      "title": "Short warning title",
      "description": "Detailed warning description",
      "recommendation": "What to do about this warning",
      "contributedToCrash": true
    }}
  ],
  "impactAnalysis": {{
    "dataAtRisk": "none|low|moderate|high|critical",
    "dataRiskDescription": "What data may have been affected",
    "directlyAffected": [
      {{
        "feature": "Feature name",
        "module": "Module name",
        "description": "How it's affected",
        "severity": "critical|high|medium|low"
      }}
    ],
    "potentiallyAffected": [
      {{
        "feature": "Feature name",
        "module": "Module name",
        "description": "Why it might be affected",
        "severity": "medium|low"
      }}
    ]
  }},
  "testScenarios": [
    {{
      "id": "TC001",
      "name": "Test scenario name",
      "priority": "P0|P1|P2",
      "type": "regression|smoke|integration|unit",
      "description": "What this test validates",
      "steps": "Step by step test procedure",
      "expectedResult": "Expected outcome",
      "dataRequirements": "Test data needed"
    }}
  ],
  "environment": {{
    "application": {{
      "version": "Extracted version if available",
      "build": "Build info if available",
      "configuration": "Relevant config details"
    }},
    "platform": {{
      "os": "Operating system",
      "memory": "Memory info if available",
      "user": "Username if available"
    }},
    "database": {{
      "type": "Oracle/other",
      "connectionInfo": "Relevant connection details",
      "sessionState": "Session state info if available"
    }}
  }},
  "context": {{
    "receiver": {{
      "class": "Class name of the receiver object",
      "state": "Known state of the receiver",
      "description": "What this object represents"
    }},
    "arguments": [
      {{
        "name": "Argument name",
        "value": "Argument value",
        "type": "Argument type"
      }}
    ],
    "relatedObjects": [
      {{
        "name": "Related object name",
        "class": "Class",
        "relationship": "How it relates to the crash"
      }}
    ]
  }},
  "memoryAnalysis": {{
    "oldSpace": {{
      "used": "Value if available",
      "total": "Value if available",
      "percentUsed": 0
    }},
    "newSpace": {{
      "used": "Value if available",
      "total": "Value if available",
      "percentUsed": 0
    }},
    "permSpace": {{
      "used": "Value if available",
      "total": "Value if available",
      "percentUsed": 0
    }},
    "warnings": ["Memory-related warnings"]
  }},
  "databaseAnalysis": {{
    "connections": [
      {{
        "name": "Connection name",
        "status": "Status",
        "database": "Database name"
      }}
    ],
    "activeSessions": [
      {{
        "id": "Session ID",
        "status": "Status",
        "lastOperation": "Last operation"
      }}
    ],
    "warnings": ["Database-related warnings"],
    "transactionState": "open|committed|rolled_back|unknown"
  }},
  "stackTrace": {{
    "frames": [
      {{
        "index": 0,
        "method": "ClassName>>methodName",
        "type": "error|application|framework|library",
        "isErrorOrigin": true,
        "context": "Additional context for this frame"
      }}
    ],
    "totalFrames": 0,
    "errorFrame": "ClassName>>methodName where error originated"
  }}
}}

IMPORTANT GUIDELINES:
1. Extract as much information as possible from the crash log
2. Use "unknown" or null for fields where information is not available
3. Be specific about WHATS'ON classes and namespaces
4. Provide actionable fixes with real Smalltalk code examples where possible
5. Map technical issues to business impact
6. Consider Oracle database specifics common in WHATS'ON deployments
7. Return ONLY valid JSON, no additional text outside the JSON structure"#,
        crash_content
    )
}

/// Build RAG-enhanced WHATS'ON analysis prompt with similar case context and domain knowledge
fn get_whatson_analysis_prompt_with_rag(
    crash_content: &str,
    rag_context: &RagContext,
    domain_knowledge: Option<&DomainKnowledge>,
) -> String {
    let rag_section = rag_context.format_for_prompt();
    let dk_section = domain_knowledge
        .map(|dk| dk.format_for_prompt())
        .unwrap_or_default();

    // If we have neither RAG context nor domain knowledge, use standard prompt
    if rag_section.is_empty() && dk_section.is_empty() {
        return get_whatson_analysis_prompt(crash_content);
    }

    format!(
        r#"Analyze this WHATS'ON/VisualWorks Smalltalk crash log and provide a comprehensive structured analysis.

{dk_section}{rag_section}
═══════════════════════════════════════════════════════════════════

CRASH LOG:
{crash_content}

═══════════════════════════════════════════════════════════════════
WHATS'ON ENHANCED ANALYSIS - STRUCTURED OUTPUT FORMAT (RAG-ENHANCED)
═══════════════════════════════════════════════════════════════════

Analyze the crash log using insights from the similar historical cases above.
Be thorough and specific. Use your knowledge of WHATS'ON namespaces (PSI.*, BM.*, PL.*, WOn.*, EX.*) and broadcast domain.

**IMPORTANT**:
- CITE any similar cases that informed your analysis (e.g., "Similar to Case #X")
- Add a "ragCitations" field to your response listing which cases were relevant
- If RAG cases don't apply, set "ragCitations": []

OUTPUT FORMAT (JSON):
{{
  "summary": {{
    "title": "Brief descriptive title of the crash (50 chars max)",
    "severity": "critical|high|medium|low",
    "category": "scheduling|playout|database|memory|integration|ui|rights|timing|other",
    "confidence": "high|medium|low",
    "affectedWorkflow": "Brief description of the business workflow affected"
  }},
  "ragCitations": [
    {{
      "caseId": "Case citation ID that was relevant",
      "relevance": "How this case informed the analysis"
    }}
  ],
  "rootCause": {{
    "technical": "Detailed technical explanation of why the crash occurred",
    "plainEnglish": "Non-technical explanation suitable for business users",
    "affectedMethod": "ClassName>>methodName where the error originated",
    "affectedModule": "WHATS'ON module/namespace affected (e.g., PSI.ScheduleEngine)",
    "triggerCondition": "What specific condition triggered this crash"
  }},
  "suggestedFix": {{
    "summary": "One-line summary of the recommended fix",
    "reasoning": "Why this fix addresses the root cause",
    "explanation": "Detailed explanation of the fix approach",
    "codeChanges": [
      {{
        "file": "ClassName or method location",
        "description": "What needs to change",
        "before": "Problematic code snippet (if identifiable)",
        "after": "Suggested fix code",
        "priority": "P0|P1|P2"
      }}
    ],
    "complexity": "simple|moderate|complex",
    "riskLevel": "low|medium|high"
  }},
  "userScenario": {{
    "description": "What the user was doing when the crash occurred",
    "steps": ["Step leading to crash"],
    "expectedResult": "What should have happened",
    "actualResult": "What actually happened (the crash)"
  }},
  "stackTrace": {{
    "frames": [],
    "errorFrame": "The frame where the error originated"
  }}
}}

Return ONLY valid JSON. No markdown, no explanation outside JSON."#,
        dk_section = dk_section,
        rag_section = rag_section,
        crash_content = crash_content
    )
}

// ============================================================================
// Request Building
// ============================================================================

/// Build request body for OpenAI-compatible APIs
fn build_openai_request(system_prompt: &str, user_prompt: &str, model: &str) -> serde_json::Value {
    build_openai_request_with_options(system_prompt, user_prompt, model, false, 4000)
}

fn build_openai_request_with_options(
    system_prompt: &str,
    user_prompt: &str,
    model: &str,
    json_mode: bool,
    max_tokens: u32,
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
        body["max_completion_tokens"] = json!(max_tokens);
    } else {
        body["max_tokens"] = json!(max_tokens);
    }

    // Enable JSON mode for structured output
    if json_mode {
        body["response_format"] = json!({"type": "json_object"});
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
            let tokens = response_data["usage"]["total_tokens"].as_i64().unwrap_or(0) as i32;
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
            let output_tokens = response_data["usage"]["output_tokens"]
                .as_i64()
                .unwrap_or(0);
            Ok(ProviderResponse {
                content,
                tokens: (input_tokens + output_tokens) as i32,
                input_tokens: Some(input_tokens),
                output_tokens: Some(output_tokens),
            })
        }
    }
}

/// Calculate cost based on provider's pricing model
fn calculate_cost(response: &ProviderResponse, calculator: &CostCalculator) -> f64 {
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
    let client = HTTP_CLIENT.clone();

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
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
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

/// Unified provider call function that returns raw content (no parsing)
/// Used for chunk analysis where we want the raw JSON response
async fn call_provider_raw(
    config: ProviderConfig,
    request_body: serde_json::Value,
    api_key: &str,
) -> Result<String, String> {
    let client = HTTP_CLIENT.clone();

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
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("{} API error: {}", config.name, error_text));
    }

    // Parse response
    let response_data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse {} response: {}", config.name, e))?;

    // Extract content only (no cost/token parsing needed for chunks)
    let provider_response = extract_response(&response_data, &config.response_style)
        .map_err(|e| format!("{} response error: {}", config.name, e))?;

    Ok(provider_response.content)
}

/// Unified provider call that returns the raw JSON response (for tool-calling agent loop).
/// Unlike call_provider_raw, this preserves the full response structure.
pub async fn call_provider_raw_json(
    provider: &str,
    request_body: serde_json::Value,
    api_key: &str,
) -> Result<serde_json::Value, String> {
    let config = match provider {
        "anthropic" => ProviderConfig::anthropic(),
        "zai" => ProviderConfig::zai(),
        "llamacpp" => ProviderConfig::llamacpp(),
        _ => ProviderConfig::openai(),
    };

    let client = HTTP_CLIENT.clone();

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

    let response = request
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("{} API request failed: {}", config.name, e))?;

    if !response.status().is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("{} API error: {}", config.name, error_text));
    }

    let response_data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse {} response: {}", config.name, e))?;

    Ok(response_data)
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

/// Call OpenAI with JSON mode enabled for structured output.
///
/// Use this when you need:
/// - Guaranteed JSON response format (OpenAI enforces valid JSON)
/// - Custom max_tokens limit for response size control
///
/// For general analysis, use `call_openai()` instead.
/// For raw string responses, use `call_openai_raw()`.
#[allow(dead_code)]
pub async fn call_openai_json(
    system_prompt: &str,
    user_prompt: &str,
    api_key: &str,
    model: &str,
    max_tokens: u32,
) -> Result<AnalysisResult, String> {
    let request_body =
        build_openai_request_with_options(system_prompt, user_prompt, model, true, max_tokens);
    call_provider(ProviderConfig::openai(), request_body, api_key).await
}

/// Call OpenAI with JSON mode and return raw content string (for chunk analysis)
pub async fn call_openai_raw(
    system_prompt: &str,
    user_prompt: &str,
    api_key: &str,
    model: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let request_body =
        build_openai_request_with_options(system_prompt, user_prompt, model, true, max_tokens);
    call_provider_raw(ProviderConfig::openai(), request_body, api_key).await
}

/// Call Anthropic and return raw content string (for chunk analysis)
pub async fn call_anthropic_raw(
    system_prompt: &str,
    user_prompt: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let request_body = build_anthropic_request(system_prompt, user_prompt, model);
    call_provider_raw(ProviderConfig::anthropic(), request_body, api_key).await
}

/// Call Z.ai and return raw content string (for chunk analysis)
pub async fn call_zai_raw(
    system_prompt: &str,
    user_prompt: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let request_body =
        build_openai_request_with_options(system_prompt, user_prompt, model, true, 1000);
    call_provider_raw(ProviderConfig::zai(), request_body, api_key).await
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

pub async fn call_llamacpp(
    system_prompt: &str,
    user_prompt: &str,
    model: &str,
) -> Result<AnalysisResult, String> {
    let request_body = build_openai_request(system_prompt, user_prompt, model);
    call_provider(ProviderConfig::llamacpp(), request_body, "").await
}

// ============================================================================
// Chat Types & Streaming (Ask Hadron)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatStreamEvent {
    pub token: String,
    pub done: bool,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
    pub tokens_used: i32,
    pub cost: f64,
}

/// Build a multi-turn chat request for OpenAI-compatible APIs
pub fn build_chat_request_openai(
    messages: &[ChatMessage],
    system_prompt: &str,
    model: &str,
    max_tokens: u32,
    stream: bool,
) -> serde_json::Value {
    let is_gpt5 = model.starts_with("gpt-5") || model.starts_with("o1") || model.starts_with("o3");

    let mut msgs = vec![json!({"role": "system", "content": system_prompt})];
    for m in messages {
        msgs.push(json!({"role": m.role, "content": m.content}));
    }

    let mut body = json!({
        "model": model,
        "messages": msgs,
        "temperature": 0.3,
        "stream": stream
    });

    if is_gpt5 {
        body["max_completion_tokens"] = json!(max_tokens);
    } else {
        body["max_tokens"] = json!(max_tokens);
    }

    body
}

/// Build a multi-turn chat request for Anthropic API
pub fn build_chat_request_anthropic(
    messages: &[ChatMessage],
    system_prompt: &str,
    model: &str,
    max_tokens: u32,
    stream: bool,
) -> serde_json::Value {
    let msgs: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| json!({"role": m.role, "content": m.content}))
        .collect();

    json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": system_prompt,
        "messages": msgs,
        "stream": stream
    })
}

/// Call a provider with streaming enabled, emitting tokens via Tauri events.
/// Returns the full accumulated response when done.
pub async fn call_provider_streaming(
    app: &tauri::AppHandle,
    provider: &str,
    request_body: serde_json::Value,
    api_key: &str,
    request_id: Option<&str>,
) -> Result<ChatResponse, String> {
    let (config_name, endpoint, auth_style, response_style, cost_calculator) = match provider {
        "anthropic" => (
            "Anthropic",
            "https://api.anthropic.com/v1/messages",
            AuthStyle::AnthropicHeader,
            ResponseStyle::Anthropic,
            CostCalculator::Claude35Sonnet,
        ),
        "zai" => (
            "Z.ai",
            "https://open.bigmodel.cn/api/paas/v4/chat/completions",
            AuthStyle::Bearer,
            ResponseStyle::OpenAI,
            CostCalculator::FlatRate(0.001),
        ),
        "llamacpp" => (
            "llama.cpp",
            "http://127.0.0.1:8080/v1/chat/completions",
            AuthStyle::None,
            ResponseStyle::OpenAI,
            CostCalculator::Free,
        ),
        _ => (
            "OpenAI",
            "https://api.openai.com/v1/chat/completions",
            AuthStyle::Bearer,
            ResponseStyle::OpenAI,
            CostCalculator::Gpt4Turbo,
        ),
    };

    let client = HTTP_CLIENT.clone();
    let mut request = client
        .post(endpoint)
        .header("Content-Type", "application/json");

    request = match &auth_style {
        AuthStyle::Bearer => request.header("Authorization", format!("Bearer {}", api_key)),
        AuthStyle::AnthropicHeader => request
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01"),
        AuthStyle::None => request,
    };

    let response = request
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("{} API request failed: {}", config_name, e))?;

    if !response.status().is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("{} API error: {}", config_name, error_text));
    }

    // Read streaming response
    let mut accumulated = String::new();
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {}", e))?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        // Process complete lines from buffer
        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].trim().to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            if line.is_empty() {
                continue;
            }

            // Extract token based on provider response format
            let token = match &response_style {
                ResponseStyle::OpenAI => parse_openai_sse_token(&line),
                ResponseStyle::Anthropic => parse_anthropic_sse_token(&line),
            };

            if let Some(tok) = token {
                if !tok.is_empty() {
                    accumulated.push_str(&tok);
                    let _ = app.emit(
                        "chat-stream",
                        ChatStreamEvent {
                            token: tok,
                            done: false,
                            error: None,
                            request_id: request_id.map(|s| s.to_string()),
                        },
                    );
                }
            }
        }
    }

    // Process any remaining buffer
    if !buffer.trim().is_empty() {
        let token = match &response_style {
            ResponseStyle::OpenAI => parse_openai_sse_token(buffer.trim()),
            ResponseStyle::Anthropic => parse_anthropic_sse_token(buffer.trim()),
        };
        if let Some(tok) = token {
            if !tok.is_empty() {
                accumulated.push_str(&tok);
                let _ = app.emit(
                    "chat-stream",
                    ChatStreamEvent {
                        token: tok,
                        done: false,
                        error: None,
                        request_id: request_id.map(|s| s.to_string()),
                    },
                );
            }
        }
    }

    // Emit done event
    let _ = app.emit(
        "chat-stream",
        ChatStreamEvent {
            token: String::new(),
            done: true,
            error: None,
            request_id: request_id.map(|s| s.to_string()),
        },
    );

    // Estimate tokens (rough: 4 chars per token)
    let est_tokens = (accumulated.len() as f64 / 4.0) as i32;
    let cost = match &cost_calculator {
        CostCalculator::Gpt4Turbo => (est_tokens as f64 / 1000.0) * 0.01,
        CostCalculator::Claude35Sonnet => (est_tokens as f64 / 1_000_000.0) * 15.0,
        CostCalculator::FlatRate(rate) => *rate,
        CostCalculator::Free => 0.0,
    };

    Ok(ChatResponse {
        content: accumulated,
        tokens_used: est_tokens,
        cost,
    })
}

/// Quick non-streaming LLM call for lightweight tasks (query rewriting, routing).
/// Uses a short timeout and low max_tokens to minimize latency.
pub async fn call_provider_quick(
    provider: &str,
    messages: &[ChatMessage],
    system_prompt: &str,
    api_key: &str,
    model: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let request_body = match provider {
        "anthropic" => build_chat_request_anthropic(messages, system_prompt, model, max_tokens, false),
        _ => build_chat_request_openai(messages, system_prompt, model, max_tokens, false),
    };

    let config = match provider {
        "anthropic" => ProviderConfig::anthropic(),
        "zai" => ProviderConfig::zai(),
        "llamacpp" => ProviderConfig::llamacpp(),
        _ => ProviderConfig::openai(),
    };

    // Use a short timeout for quick calls
    let result = tokio::time::timeout(
        Duration::from_secs(8),
        call_provider_raw(config, request_body, api_key),
    )
    .await
    .map_err(|_| "Quick LLM call timed out".to_string())?;

    result
}

/// Non-streaming chat call (fallback)
pub async fn call_provider_chat(
    provider: &str,
    request_body: serde_json::Value,
    api_key: &str,
) -> Result<ChatResponse, String> {
    let config = match provider {
        "anthropic" => ProviderConfig::anthropic(),
        "zai" => ProviderConfig::zai(),
        "llamacpp" => ProviderConfig::llamacpp(),
        _ => ProviderConfig::openai(),
    };

    let content = call_provider_raw(config, request_body, api_key).await?;
    let est_tokens = (content.len() as f64 / 4.0) as i32;

    Ok(ChatResponse {
        content,
        tokens_used: est_tokens,
        cost: 0.0,
    })
}

// ============================================================================
// Tool-Aware Request Builders & Response Parsers (Level 2)
// ============================================================================

use crate::chat_tools::{ParsedToolCall, ToolDefinition};

/// Build an OpenAI-compatible request with tool definitions
pub fn build_chat_request_with_tools_openai(
    messages: &[serde_json::Value],
    tools: &[ToolDefinition],
    system_prompt: &str,
    model: &str,
    max_tokens: u32,
) -> serde_json::Value {
    let is_gpt5 = model.starts_with("gpt-5") || model.starts_with("o1") || model.starts_with("o3");

    let mut msgs = vec![json!({"role": "system", "content": system_prompt})];
    msgs.extend_from_slice(messages);

    let tool_defs: Vec<serde_json::Value> = tools
        .iter()
        .map(|t| {
            json!({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                }
            })
        })
        .collect();

    let mut body = json!({
        "model": model,
        "messages": msgs,
        "temperature": 0.3,
        "stream": false
    });

    if is_gpt5 {
        body["max_completion_tokens"] = json!(max_tokens);
    } else {
        body["max_tokens"] = json!(max_tokens);
    }

    if !tool_defs.is_empty() {
        body["tools"] = json!(tool_defs);
        body["tool_choice"] = json!("auto");
    }

    body
}

/// Build an Anthropic request with tool definitions
pub fn build_chat_request_with_tools_anthropic(
    messages: &[serde_json::Value],
    tools: &[ToolDefinition],
    system_prompt: &str,
    model: &str,
    max_tokens: u32,
) -> serde_json::Value {
    let tool_defs: Vec<serde_json::Value> = tools
        .iter()
        .map(|t| {
            json!({
                "name": t.name,
                "description": t.description,
                "input_schema": t.parameters,
            })
        })
        .collect();

    let mut body = json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": system_prompt,
        "messages": messages,
        "stream": false
    });

    if !tool_defs.is_empty() {
        body["tools"] = json!(tool_defs);
    }

    body
}

/// Check if the LLM response contains tool calls
pub fn response_wants_tools(response: &serde_json::Value, provider: &str) -> bool {
    match provider {
        "anthropic" => {
            // Anthropic: stop_reason == "tool_use" or content has type: "tool_use"
            if response["stop_reason"].as_str() == Some("tool_use") {
                return true;
            }
            if let Some(content) = response["content"].as_array() {
                return content.iter().any(|c| c["type"].as_str() == Some("tool_use"));
            }
            false
        }
        _ => {
            // OpenAI/llama.cpp: finish_reason == "tool_calls" or message has tool_calls
            if let Some(choices) = response["choices"].as_array() {
                if let Some(choice) = choices.first() {
                    if choice["finish_reason"].as_str() == Some("tool_calls") {
                        return true;
                    }
                    if let Some(tool_calls) = choice["message"]["tool_calls"].as_array() {
                        return !tool_calls.is_empty();
                    }
                }
            }
            false
        }
    }
}

/// Extract the text content from a response (non-tool text)
pub fn extract_text_from_response(response: &serde_json::Value, provider: &str) -> String {
    match provider {
        "anthropic" => {
            if let Some(content) = response["content"].as_array() {
                content
                    .iter()
                    .filter(|c| c["type"].as_str() == Some("text"))
                    .filter_map(|c| c["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("")
            } else {
                String::new()
            }
        }
        _ => {
            response["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("")
                .to_string()
        }
    }
}

/// Parse tool calls from provider response
pub fn parse_tool_calls(response: &serde_json::Value, provider: &str) -> Vec<ParsedToolCall> {
    match provider {
        "anthropic" => parse_anthropic_tool_calls(response),
        _ => parse_openai_tool_calls(response),
    }
}

fn parse_openai_tool_calls(response: &serde_json::Value) -> Vec<ParsedToolCall> {
    let mut calls = Vec::new();
    if let Some(choices) = response["choices"].as_array() {
        if let Some(choice) = choices.first() {
            if let Some(tool_calls) = choice["message"]["tool_calls"].as_array() {
                for tc in tool_calls {
                    let id = tc["id"].as_str().unwrap_or("").to_string();
                    let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
                    let args_str = tc["function"]["arguments"].as_str().unwrap_or("{}");
                    let arguments = serde_json::from_str(args_str).unwrap_or(json!({}));
                    if !name.is_empty() {
                        calls.push(ParsedToolCall { id, name, arguments });
                    }
                }
            }
        }
    }
    calls
}

fn parse_anthropic_tool_calls(response: &serde_json::Value) -> Vec<ParsedToolCall> {
    let mut calls = Vec::new();
    if let Some(content) = response["content"].as_array() {
        for block in content {
            if block["type"].as_str() == Some("tool_use") {
                let id = block["id"].as_str().unwrap_or("").to_string();
                let name = block["name"].as_str().unwrap_or("").to_string();
                let arguments = block["input"].clone();
                if !name.is_empty() {
                    calls.push(ParsedToolCall { id, name, arguments });
                }
            }
        }
    }
    calls
}

/// Build the assistant message in the format expected by the provider for tool call turns
pub fn build_assistant_tool_message(
    response: &serde_json::Value,
    provider: &str,
) -> serde_json::Value {
    match provider {
        "anthropic" => {
            // Return the full content array as the assistant message
            json!({
                "role": "assistant",
                "content": response["content"].clone()
            })
        }
        _ => {
            // OpenAI: return the message as-is (includes tool_calls)
            if let Some(choices) = response["choices"].as_array() {
                if let Some(choice) = choices.first() {
                    return choice["message"].clone();
                }
            }
            json!({"role": "assistant", "content": ""})
        }
    }
}

/// Build tool result messages in the format expected by the provider
pub fn build_tool_result_messages(
    results: &[crate::chat_tools::ToolResult],
    provider: &str,
) -> Vec<serde_json::Value> {
    match provider {
        "anthropic" => {
            // Anthropic: single user message with array of tool_result content blocks
            let blocks: Vec<serde_json::Value> = results
                .iter()
                .map(|r| {
                    json!({
                        "type": "tool_result",
                        "tool_use_id": r.tool_use_id,
                        "content": r.content,
                        "is_error": r.is_error,
                    })
                })
                .collect();
            vec![json!({"role": "user", "content": blocks})]
        }
        _ => {
            // OpenAI: one "tool" role message per result
            results
                .iter()
                .map(|r| {
                    json!({
                        "role": "tool",
                        "tool_call_id": r.tool_use_id,
                        "content": r.content,
                    })
                })
                .collect()
        }
    }
}

/// Parse a token from an OpenAI SSE line: `data: {"choices":[{"delta":{"content":"..."}}]}`
fn parse_openai_sse_token(line: &str) -> Option<String> {
    let data = line.strip_prefix("data: ")?;
    if data == "[DONE]" {
        return None;
    }
    let parsed: serde_json::Value = serde_json::from_str(data).ok()?;
    parsed["choices"][0]["delta"]["content"]
        .as_str()
        .map(|s| s.to_string())
}

/// Parse a token from an Anthropic SSE line
fn parse_anthropic_sse_token(line: &str) -> Option<String> {
    let data = line.strip_prefix("data: ")?;
    let parsed: serde_json::Value = serde_json::from_str(data).ok()?;
    // content_block_delta events have delta.text
    if parsed["type"].as_str() == Some("content_block_delta") {
        return parsed["delta"]["text"].as_str().map(|s| s.to_string());
    }
    None
}

// ============================================================================
// JSON Parsing
// ============================================================================

/// Sanitize a string for JSON parsing by removing/escaping control characters
fn sanitize_json_string(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\r' || *c == '\t')
        .collect()
}

fn parse_analysis_json(content: &str, tokens: i32, cost: f64) -> Result<AnalysisResult, String> {
    // Extract JSON from response (look for first { to last }).
    // If no JSON is found or parsing fails, fall back to treating the entire
    // response as a free-form root cause description.
    if let (Some(json_start), Some(json_end)) = (content.find('{'), content.rfind('}')) {
        let json_str = &content[json_start..=json_end];

        match serde_json::from_str::<serde_json::Value>(json_str) {
            Ok(parsed) => {
                // Check if this is a WHATS'ON enhanced analysis (has "summary" and "rootCause" objects)
                let has_summary = parsed.get("summary").is_some();
                let has_root_cause = parsed.get("rootCause").is_some();
                let has_user_scenario = parsed.get("userScenario").is_some();
                let has_suggested_fix = parsed.get("suggestedFix").is_some();

                log::info!(
                    "JSON structure check: summary={}, rootCause={}, userScenario={}, suggestedFix={}",
                    has_summary,
                    has_root_cause,
                    has_user_scenario,
                    has_suggested_fix
                );

                let is_whatson_format = has_summary && has_root_cause;

                // Quick analysis format: rootCause + solution + workaround
                // These use camelCase keys from the Quick prompt schema.
                let has_solution = parsed.get("solution").is_some();
                let _has_workaround = parsed.get("workaround").is_some();
                let is_quick_format = has_root_cause && has_solution && !has_summary;

                if is_quick_format {
                    log::info!("Detected Quick analysis JSON format — preserving raw JSON");
                    let root_cause_obj = &parsed["rootCause"];
                    let solution_obj = &parsed["solution"];

                    let error_type = parsed["errorType"]
                        .as_str()
                        .unwrap_or("Quick Analysis")
                        .to_string();

                    let root_cause = root_cause_obj["technical"]
                        .as_str()
                        .or_else(|| root_cause_obj["title"].as_str())
                        .unwrap_or("See full analysis")
                        .to_string();

                    let severity = parsed["severity"]
                        .as_str()
                        .unwrap_or("medium")
                        .to_lowercase();

                    let mut fixes: Vec<String> = Vec::new();
                    if let Some(steps) = solution_obj["steps"].as_array() {
                        for step in steps {
                            if let Some(s) = step.as_str() {
                                fixes.push(s.to_string());
                            }
                        }
                    }
                    if fixes.is_empty() {
                        if let Some(s) = solution_obj["summary"].as_str() {
                            fixes.push(s.to_string());
                        }
                    }

                    let component = root_cause_obj["affectedComponent"]
                        .as_str()
                        .map(|s| s.to_string());

                    return Ok(AnalysisResult {
                        error_type,
                        error_message: root_cause_obj["plainEnglish"]
                            .as_str()
                            .map(|s| s.to_string()),
                        severity,
                        root_cause,
                        suggested_fixes: fixes,
                        component,
                        stack_trace: None,
                        confidence: "high".to_string(),
                        tokens_used: tokens,
                        cost,
                        was_truncated: Some(false),
                        analysis_duration_ms: None,
                        // Preserve the raw Quick JSON so the frontend detail view can parse it
                        raw_enhanced_json: Some(json_str.to_string()),
                        analysis_meta: None,
                    });
                }

                if is_whatson_format {
                    // Warn if frontend-required fields are missing
                    if !has_user_scenario || !has_suggested_fix {
                        log::warn!(
                            "WHATS'ON response missing frontend-required fields: userScenario={}, suggestedFix={}",
                            has_user_scenario,
                            has_suggested_fix
                        );
                    }
                    // WHATS'ON Enhanced format - extract fields from the enhanced structure
                    let summary = &parsed["summary"];
                    let root_cause_obj = &parsed["rootCause"];
                    // Accept both "suggestedFix" (standard WHATS'ON) and "suggestedFixes" (RAG variant)
                    let suggested_fix = if parsed.get("suggestedFix").is_some() {
                        &parsed["suggestedFix"]
                    } else {
                        &parsed["suggestedFixes"]
                    };

                    // Extract display-friendly root cause text
                    let root_cause_text = root_cause_obj["plainEnglish"]
                        .as_str()
                        .or_else(|| root_cause_obj["technical"].as_str())
                        .unwrap_or("See detailed analysis");

                    // Extract suggested fixes — handle both formats:
                    // 1. suggestedFix.codeChanges[] (standard WHATS'ON)
                    // 2. suggestedFixes[] array of {title, description} (RAG variant)
                    let suggested_fixes: Vec<String> = if let Some(code_changes) = suggested_fix["codeChanges"].as_array() {
                        // Standard WHATS'ON format: suggestedFix.codeChanges
                        code_changes.iter()
                            .filter_map(|change| {
                                let priority = change["priority"].as_str().unwrap_or("P1");
                                let desc = change["description"].as_str()?;
                                Some(format!("{} - {}", priority, desc))
                            })
                            .collect()
                    } else if let Some(fixes_arr) = suggested_fix.as_array() {
                        // RAG variant: suggestedFixes is an array of fix objects
                        fixes_arr.iter()
                            .filter_map(|fix| {
                                let title = fix["title"].as_str().unwrap_or("");
                                let desc = fix["description"].as_str().unwrap_or("");
                                if title.is_empty() && desc.is_empty() { return None; }
                                Some(if title.is_empty() { desc.to_string() } else { format!("{}: {}", title, desc) })
                            })
                            .collect()
                    } else {
                        // Fallback: use the summary as a single fix
                        suggested_fix["summary"]
                            .as_str()
                            .map(|s| vec![s.to_string()])
                            .unwrap_or_default()
                    };

                    return Ok(AnalysisResult {
                        error_type: summary["title"]
                            .as_str()
                            .unwrap_or("WHATS'ON Crash")
                            .to_string(),
                        error_message: summary["affectedWorkflow"].as_str().map(|s| s.to_string()),
                        severity: summary["severity"]
                            .as_str()
                            .unwrap_or("medium")
                            .to_lowercase(),
                        root_cause: format!(
                            "{}\n\n**Technical:** {}",
                            root_cause_text,
                            root_cause_obj["technical"].as_str().unwrap_or("")
                        ),
                        suggested_fixes,
                        component: root_cause_obj["affectedModule"]
                            .as_str()
                            .map(|s| s.to_string()),
                        stack_trace: parsed["stackTrace"]["errorFrame"]
                            .as_str()
                            .map(|s| s.to_string()),
                        confidence: summary["confidence"]
                            .as_str()
                            .unwrap_or("medium")
                            .to_string(),
                        tokens_used: tokens,
                        cost,
                        was_truncated: Some(false),
                        analysis_duration_ms: None,
                        // Store the raw JSON for frontend parsing
                        raw_enhanced_json: Some(json_str.to_string()),
                        analysis_meta: None,
                    });
                }

                // Standard format (complete/specialized analysis)
                return Ok(AnalysisResult {
                    error_type: parsed["error_type"]
                        .as_str()
                        .unwrap_or("Unknown")
                        .to_string(),
                    error_message: parsed["error_message"].as_str().map(|s| s.to_string()),
                    severity: parsed["severity"]
                        .as_str()
                        .unwrap_or("medium")
                        .to_lowercase(),
                    root_cause: parsed["root_cause"]
                        .as_str()
                        .unwrap_or("Unable to determine root cause")
                        .to_string(),
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
                    confidence: parsed["confidence"]
                        .as_str()
                        .unwrap_or("medium")
                        .to_string(),
                    tokens_used: tokens,
                    cost,
                    was_truncated: Some(false),
                    analysis_duration_ms: None,
                    raw_enhanced_json: None,
                    analysis_meta: None,
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
        raw_enhanced_json: None,
        analysis_meta: None,
    })
}

/// Helper to add analysis metadata to a result
fn add_analysis_meta(
    mut result: AnalysisResult,
    mode: AnalysisMode,
    coverage: AnalysisCoverage,
    budget_analysis: &BudgetAnalysis,
    evidence_summary: Option<String>,
    chunks_analyzed: Option<usize>,
) -> AnalysisResult {
    result.analysis_meta = Some(AnalysisMeta {
        mode,
        coverage,
        token_estimates: TokenEstimates {
            estimated_input_tokens: budget_analysis.estimated_input_tokens,
            budget_input_tokens: budget_analysis.safe_input_budget,
            reserve_output_tokens: 6000, // Standard reserve
            utilization: budget_analysis.utilization,
        },
        evidence_summary,
        chunks_analyzed,
    });
    result
}

// ============================================================================
// Translation (llama.cpp local)
// ============================================================================

/// Translate technical content to plain language using llama.cpp
pub async fn translate_llamacpp(content: &str, model: &str) -> Result<String, String> {
    let system_prompt = "You are a technical translator. Convert complex technical content into clear, plain language that non-technical users can understand. Maintain accuracy while simplifying jargon and explaining concepts.";

    let user_prompt = format!(
        "Translate this technical content to plain language:\n\n{}",
        content
    );

    let request_body = build_openai_request(system_prompt, &user_prompt, model);
    call_provider_raw(ProviderConfig::llamacpp(), request_body, "").await
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

    let (system_prompt, user_prompt) = match analysis_type {
        "complete" => (
            COMPLETE_ANALYSIS_SYSTEM_PROMPT,
            get_complete_analysis_prompt(crash_content),
        ),
        "whatson" | "comprehensive" | "jira" => (
            WHATSON_SYSTEM_PROMPT,
            get_whatson_analysis_prompt(crash_content),
        ),
        "quick" => (
            QUICK_ANALYSIS_SYSTEM_PROMPT,
            get_quick_analysis_prompt(crash_content),
        ),
        "sentry" => (
            crate::sentry_service::SENTRY_ANALYSIS_SYSTEM_PROMPT,
            format!("Analyze this Sentry error event:\n\n{}", crash_content),
        ),
        _ => (
            SPECIALIZED_ANALYSIS_SYSTEM_PROMPT,
            get_specialized_analysis_prompt(crash_content),
        ),
    };

    let mut result = match provider.to_lowercase().as_str() {
        "openai" => call_openai(system_prompt, &user_prompt, api_key, model).await?,
        "anthropic" => call_anthropic(system_prompt, &user_prompt, api_key, model).await?,
        "zai" => call_zai(system_prompt, &user_prompt, api_key, model).await?,
        "llamacpp" => call_llamacpp(system_prompt, &user_prompt, model).await?,
        _ => {
            return Err(format!(
                "Unknown provider: {}. Supported: openai, anthropic, zai, llamacpp",
                provider
            ))
        }
    };

    // Add analysis duration
    result.analysis_duration_ms = Some(i32::try_from(start_time.elapsed().as_millis()).unwrap_or(i32::MAX));

    Ok(result)
}

/// Analyze crash log with RAG context and domain knowledge for enhanced accuracy
///
/// This function uses retrieved similar cases and KB domain knowledge
/// to improve analysis quality.
///
/// # Arguments
/// * `crash_content` - The crash log content
/// * `api_key` - API key for the provider
/// * `model` - Model identifier
/// * `provider` - Provider name
/// * `analysis_type` - Type of analysis
/// * `rag_context` - Optional RAG context with similar cases
/// * `domain_knowledge` - Optional KB domain knowledge
pub async fn analyze_crash_log_with_rag(
    crash_content: &str,
    api_key: &str,
    model: &str,
    provider: &str,
    analysis_type: &str,
    rag_context: Option<RagContext>,
    domain_knowledge: Option<DomainKnowledge>,
) -> Result<AnalysisResult, String> {
    let start_time = std::time::Instant::now();

    let dk_ref = domain_knowledge.as_ref();

    // Build prompt with RAG context and domain knowledge if available
    let (system_prompt, user_prompt) = match analysis_type {
        "whatson" | "comprehensive" | "jira" => {
            if let Some(ref ctx) = rag_context {
                if ctx.has_context() || dk_ref.map_or(false, |dk| dk.has_content()) {
                    log::info!(
                        "Using RAG-enhanced prompt with {} similar cases, {} gold matches, and {} KB docs",
                        ctx.similar_cases.len(),
                        ctx.gold_matches.len(),
                        dk_ref.map_or(0, |dk| dk.kb_results.len() + dk.release_note_results.len())
                    );
                    (
                        WHATSON_SYSTEM_PROMPT,
                        get_whatson_analysis_prompt_with_rag(crash_content, ctx, dk_ref),
                    )
                } else {
                    (WHATSON_SYSTEM_PROMPT, get_whatson_analysis_prompt(crash_content))
                }
            } else if dk_ref.map_or(false, |dk| dk.has_content()) {
                // Domain knowledge only (no historical cases)
                let empty_rag = RagContext::default();
                (
                    WHATSON_SYSTEM_PROMPT,
                    get_whatson_analysis_prompt_with_rag(crash_content, &empty_rag, dk_ref),
                )
            } else {
                (WHATSON_SYSTEM_PROMPT, get_whatson_analysis_prompt(crash_content))
            }
        }
        "complete" => (
            COMPLETE_ANALYSIS_SYSTEM_PROMPT,
            get_complete_analysis_prompt(crash_content),
        ),
        "quick" => (
            QUICK_ANALYSIS_SYSTEM_PROMPT,
            get_quick_analysis_prompt(crash_content),
        ),
        _ => (
            SPECIALIZED_ANALYSIS_SYSTEM_PROMPT,
            get_specialized_analysis_prompt(crash_content),
        ),
    };

    let mut result = match provider.to_lowercase().as_str() {
        "openai" => call_openai(system_prompt, &user_prompt, api_key, model).await?,
        "anthropic" => call_anthropic(system_prompt, &user_prompt, api_key, model).await?,
        "zai" => call_zai(system_prompt, &user_prompt, api_key, model).await?,
        "llamacpp" => call_llamacpp(system_prompt, &user_prompt, model).await?,
        _ => {
            return Err(format!(
                "Unknown provider: {}. Supported: openai, anthropic, zai, llamacpp",
                provider
            ))
        }
    };

    // Add analysis duration
    result.analysis_duration_ms = Some(i32::try_from(start_time.elapsed().as_millis()).unwrap_or(i32::MAX));

    Ok(result)
}

// ============================================================================
// Token-Safe Analysis Entry Point
// ============================================================================

/// Analyze crash log with token budgeting to prevent context_length_exceeded errors.
///
/// This function:
/// 1. Estimates token usage and selects optimal strategy
/// 2. Uses evidence extraction for large inputs
/// 3. Falls back to deep scan (map-reduce) for very large inputs
///
/// # Arguments
/// * `crash_content` - The crash log content (may include raw walkback)
/// * `raw_walkback` - Optional separate raw walkback text
/// * `api_key` - API key for the provider
/// * `model` - Model identifier
/// * `provider` - Provider name (openai, anthropic, zai, llamacpp)
/// * `analysis_type` - Type of analysis (complete, whatson, specialized)
/// * `config` - Optional token-safe configuration
pub async fn analyze_crash_log_safe(
    crash_content: &str,
    raw_walkback: Option<&str>,
    api_key: &str,
    model: &str,
    provider: &str,
    analysis_type: &str,
    config: Option<TokenSafeConfig>,
) -> Result<AnalysisResult, String> {
    let start_time = std::time::Instant::now();
    let config = config.unwrap_or_default();

    // Initialize token budgeter
    let budgeter = TokenBudgeter::new(model);

    // Get system prompt to estimate its tokens
    let system_prompt = match analysis_type {
        "complete" => COMPLETE_ANALYSIS_SYSTEM_PROMPT,
        "whatson" | "comprehensive" | "jira" => WHATSON_SYSTEM_PROMPT,
        "quick" => QUICK_ANALYSIS_SYSTEM_PROMPT,
        "sentry" => crate::sentry_service::SENTRY_ANALYSIS_SYSTEM_PROMPT,
        _ => SPECIALIZED_ANALYSIS_SYSTEM_PROMPT,
    };
    let system_tokens = crate::token_budget::estimate_tokens(system_prompt);

    // Analyze budget
    let budget_analysis = budgeter.analyze(crash_content, raw_walkback, system_tokens);

    log::info!(
        "Token budget analysis: strategy={:?}, utilization={:.1}%, estimated={}, budget={}",
        budget_analysis.strategy,
        budget_analysis.utilization * 100.0,
        budget_analysis.estimated_input_tokens,
        budget_analysis.safe_input_budget
    );

    // Determine actual mode to use based on analysis type and budget
    // - Comprehensive/WhatsOn: Prioritize full coverage (SingleCall or DeepScan, skip extraction)
    // - Quick: Prioritize speed (SingleCall or Extraction, skip deep scan)
    let is_comprehensive = matches!(analysis_type, "comprehensive" | "whatson" | "jira" | "complete" | "specialized");

    let mode = config.force_mode.unwrap_or({
        match budget_analysis.strategy {
            AnalysisStrategy::SingleCall => AnalysisMode::Quick,
            AnalysisStrategy::ExtractionRequired => {
                if is_comprehensive && config.enable_deep_scan {
                    // For comprehensive analysis, prefer deep scan over extraction
                    // to ensure full file coverage
                    log::info!("Comprehensive analysis: using DeepScan instead of extraction for full coverage");
                    AnalysisMode::DeepScan
                } else {
                    AnalysisMode::QuickWithExtraction
                }
            }
            AnalysisStrategy::DeepScanRequired | AnalysisStrategy::InputTooLarge => {
                if is_comprehensive && config.enable_deep_scan {
                    AnalysisMode::DeepScan
                } else {
                    // Quick analysis: use extraction for speed
                    AnalysisMode::QuickWithExtraction
                }
            }
        }
    });

    // Execute based on mode
    let mut result = match mode {
        AnalysisMode::Quick => {
            // Direct analysis - content fits
            analyze_quick(
                crash_content,
                raw_walkback,
                api_key,
                model,
                provider,
                analysis_type,
                &budget_analysis,
            )
            .await?
        }
        AnalysisMode::QuickWithExtraction => {
            // Extract evidence to reduce size
            analyze_with_extraction(
                crash_content,
                raw_walkback,
                api_key,
                model,
                provider,
                analysis_type,
                &budget_analysis,
                &config,
            )
            .await?
        }
        AnalysisMode::DeepScan => {
            // Map-reduce for very large inputs
            // Uses raw_walkback if available, otherwise uses crash_content
            analyze_deep_scan(
                crash_content,
                raw_walkback,
                api_key,
                model,
                provider,
                analysis_type,
                &budget_analysis,
                &config,
            )
            .await?
        }
    };

    // Add analysis duration
    result.analysis_duration_ms = Some(i32::try_from(start_time.elapsed().as_millis()).unwrap_or(i32::MAX));

    Ok(result)
}

/// Quick analysis - content fits within budget
async fn analyze_quick(
    crash_content: &str,
    raw_walkback: Option<&str>,
    api_key: &str,
    model: &str,
    provider: &str,
    analysis_type: &str,
    budget_analysis: &BudgetAnalysis,
) -> Result<AnalysisResult, String> {
    // Combine content if walkback provided
    let full_content = match raw_walkback {
        Some(wb) => format!("{}\n\n--- RAW WALKBACK ---\n{}", crash_content, wb),
        None => crash_content.to_string(),
    };

    // Run standard analysis
    let result = analyze_crash_log(&full_content, api_key, model, provider, analysis_type).await?;

    // Add metadata
    let coverage = AnalysisCoverage {
        structured_included: true,
        walkback_coverage: if raw_walkback.is_some() {
            WalkbackCoverage::Full
        } else {
            WalkbackCoverage::None
        },
        db_sessions_coverage: DataCoverage::Full,
        windows_coverage: DataCoverage::Full,
    };

    Ok(add_analysis_meta(
        result,
        AnalysisMode::Quick,
        coverage,
        budget_analysis,
        None,
        None,
    ))
}

/// Analysis with evidence extraction
#[allow(clippy::too_many_arguments)]
async fn analyze_with_extraction(
    crash_content: &str,
    raw_walkback: Option<&str>,
    api_key: &str,
    model: &str,
    provider: &str,
    analysis_type: &str,
    budget_analysis: &BudgetAnalysis,
    config: &TokenSafeConfig,
) -> Result<AnalysisResult, String> {
    // Extract evidence from walkback if present, otherwise from crash_content itself.
    // This ensures Quick analysis on large files still gets the evidence-extraction assist.
    let extraction_source = raw_walkback.unwrap_or(crash_content);
    let extractor = EvidenceExtractor::with_config(ExtractionConfig::with_caps(
        config
            .max_preview_lines
            .min(budget_analysis.recommended_preview_lines),
        config
            .max_matched_lines
            .min(budget_analysis.recommended_matched_lines),
    ));
    let pack = extractor.extract(extraction_source);
    let evidence_summary = Some(pack.summary());
    let evidence_pack = Some(pack);

    // Build prompt with evidence pack instead of full walkback
    let prompt_content = match &evidence_pack {
        Some(pack) => format!(
            "{}\n\n--- EVIDENCE PACK (extracted from {} lines) ---\n{}",
            crash_content,
            pack.stats.total_lines,
            pack.format_for_prompt()
        ),
        None => crash_content.to_string(),
    };

    // Run analysis
    let result =
        analyze_crash_log(&prompt_content, api_key, model, provider, analysis_type).await?;

    // Add metadata
    let coverage = AnalysisCoverage {
        structured_included: true,
        walkback_coverage: if evidence_pack.is_some() {
            WalkbackCoverage::Preview
        } else {
            WalkbackCoverage::None
        },
        db_sessions_coverage: if budget_analysis.include_full_db_sessions {
            DataCoverage::Full
        } else {
            DataCoverage::Summarized
        },
        windows_coverage: if budget_analysis.include_full_windows {
            DataCoverage::Full
        } else {
            DataCoverage::Summarized
        },
    };

    Ok(add_analysis_meta(
        result,
        AnalysisMode::QuickWithExtraction,
        coverage,
        budget_analysis,
        evidence_summary,
        None,
    ))
}

/// Deep scan analysis with map-reduce
#[allow(clippy::too_many_arguments)]
async fn analyze_deep_scan(
    crash_content: &str,
    raw_walkback: Option<&str>,
    api_key: &str,
    model: &str,
    provider: &str,
    analysis_type: &str,
    budget_analysis: &BudgetAnalysis,
    config: &TokenSafeConfig,
) -> Result<AnalysisResult, String> {
    // Use raw_walkback if available, otherwise use crash_content (which contains the full file)
    let content_to_scan = raw_walkback.unwrap_or(crash_content);

    log::info!(
        "Starting deep scan analysis with map-reduce pattern (content size: {} bytes)",
        content_to_scan.len()
    );

    // Initialize components
    let runner = DeepScanRunner::for_model(model);
    let extractor = EvidenceExtractor::with_config(ExtractionConfig::with_caps(
        config.max_preview_lines,
        config.max_matched_lines,
    ));

    // Extract evidence for context
    let evidence_pack = extractor.extract(content_to_scan);
    let evidence_summary = evidence_pack.summary();

    // Prepare chunks from the full content
    let chunks = runner.prepare_chunks(content_to_scan);
    log::info!("Deep scan: processing {} chunks in parallel", chunks.len());

    // Map phase: analyze chunks in parallel with concurrency limit
    // Use futures::stream to process chunks with bounded parallelism
    use futures::stream::{self, StreamExt};

    const PARALLEL_CHUNK_LIMIT: usize = 4; // Process 4 chunks at a time

    // Use Arc<str> to avoid cloning strings for each chunk future
    // This is O(1) reference counting vs O(n) string copying
    use std::sync::Arc;
    let provider_arc: Arc<str> = provider.to_lowercase().into();
    let api_key_arc: Arc<str> = api_key.into();
    let model_arc: Arc<str> = model.into();

    // Create futures for all chunks
    let chunk_futures: Vec<_> = chunks
        .iter()
        .map(|chunk| {
            let (system_prompt, user_prompt) = runner.get_map_prompt(chunk);
            let provider_ref = Arc::clone(&provider_arc);
            let api_key_ref = Arc::clone(&api_key_arc);
            let model_ref = Arc::clone(&model_arc);
            let chunk_index = chunk.index;

            async move {
                // Call provider with raw response
                // Arc<str> derefs to str, use &* to get &str
                let response: Result<String, String> = match &*provider_ref {
                    "openai" => {
                        call_openai_raw(&system_prompt, &user_prompt, &*api_key_ref, &*model_ref, 1000)
                            .await
                    }
                    "anthropic" => {
                        call_anthropic_raw(&system_prompt, &user_prompt, &*api_key_ref, &*model_ref)
                            .await
                    }
                    "zai" => {
                        call_zai_raw(&system_prompt, &user_prompt, &*api_key_ref, &*model_ref).await
                    }
                    "llamacpp" => {
                        let request_body = build_openai_request_with_options(&system_prompt, &user_prompt, &*model_ref, true, 1000);
                        call_provider_raw(ProviderConfig::llamacpp(), request_body, "").await
                    }
                    _ => Err(format!("Unknown provider: {}", provider_ref)),
                };

                // Process response
                match response {
                    Ok(raw_content) => {
                        let sanitized = sanitize_json_string(&raw_content);

                        let preview_len = floor_char_boundary(&sanitized, sanitized.len().min(200));
                        log::info!(
                            "Chunk {} response: {}...",
                            chunk_index,
                            &sanitized[..preview_len]
                        );

                        match DeepScanRunner::parse_chunk_result(&sanitized, chunk_index) {
                            Ok(analysis) => {
                                log::info!(
                                    "Chunk {} OK: relevance={}, errors={}",
                                    chunk_index,
                                    analysis.relevance_score,
                                    analysis.errors_found.len()
                                );
                                analysis
                            }
                            Err(e) => {
                                log::warn!("Chunk {} parse failed: {}", chunk_index, e);
                                ChunkAnalysis {
                                    chunk_index,
                                    summary: format!("Parse failed: {}", e),
                                    relevance_score: 1,
                                    ..Default::default()
                                }
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("Chunk {} API failed: {}", chunk_index, e);
                        ChunkAnalysis {
                            chunk_index,
                            summary: format!("API failed: {}", e),
                            relevance_score: 0,
                            ..Default::default()
                        }
                    }
                }
            }
        })
        .collect();

    // Process chunks in parallel with concurrency limit
    let chunk_analyses: Vec<ChunkAnalysis> = stream::iter(chunk_futures)
        .buffer_unordered(PARALLEL_CHUNK_LIMIT)
        .collect()
        .await;

    // Filter low-relevance chunks for synthesis
    let relevant_analyses = runner.filter_for_synthesis(chunk_analyses.clone());
    log::info!(
        "Deep scan: {} of {} chunks passed relevance filter",
        relevant_analyses.len(),
        chunk_analyses.len()
    );

    // Reduce phase: synthesize final result
    let (system_prompt, user_prompt) = runner.get_reduce_prompt(
        crash_content,
        &evidence_pack,
        &relevant_analyses,
        analysis_type,
    );

    let result = match provider.to_lowercase().as_str() {
        "openai" => call_openai(&system_prompt, &user_prompt, api_key, model).await?,
        "anthropic" => call_anthropic(&system_prompt, &user_prompt, api_key, model).await?,
        "zai" => call_zai(&system_prompt, &user_prompt, api_key, model).await?,
        "llamacpp" => call_llamacpp(&system_prompt, &user_prompt, model).await?,
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    // Add metadata
    let coverage = AnalysisCoverage {
        structured_included: true,
        walkback_coverage: WalkbackCoverage::DeepScanned,
        db_sessions_coverage: DataCoverage::Summarized,
        windows_coverage: DataCoverage::Excluded,
    };

    Ok(add_analysis_meta(
        result,
        AnalysisMode::DeepScan,
        coverage,
        budget_analysis,
        Some(evidence_summary),
        Some(chunks.len()),
    ))
}
