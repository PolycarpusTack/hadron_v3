use crate::chunker::{find_crash_line, ChunkConfig, Chunker, TextChunk};
use crate::evidence_extractor::EvidencePack;
use crate::token_budget::TokenBudgeter;
/// Deep Scan Analysis with Map-Reduce Pattern
///
/// Processes large walkbacks by analyzing chunks individually (map)
/// then synthesizing results (reduce) for comprehensive analysis.
use serde::{Deserialize, Serialize};

// ============================================================================
// Data Structures
// ============================================================================

/// Result from analyzing a single chunk (map phase)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkAnalysis {
    /// Chunk index
    pub chunk_index: usize,
    /// Errors/exceptions found in this chunk
    pub errors_found: Vec<ChunkError>,
    /// Key stack frames
    pub key_frames: Vec<String>,
    /// Database issues
    pub database_issues: Vec<String>,
    /// Memory warnings
    pub memory_warnings: Vec<String>,
    /// Notable patterns
    pub patterns: Vec<String>,
    /// Relevance score (0-10)
    pub relevance_score: u8,
    /// Summary of chunk content
    pub summary: String,
}

/// An error found in a chunk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkError {
    /// Error type/code
    pub error_type: String,
    /// Error message
    pub message: String,
    /// Line number in chunk
    pub line: Option<usize>,
    /// Severity (critical, high, medium, low)
    pub severity: String,
}

/// Progress callback for reporting scan status
#[allow(dead_code)]
pub type ProgressCallback = Box<dyn Fn(ScanProgress) + Send + Sync>;

/// Progress information during deep scan
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    /// Current phase
    pub phase: ScanPhase,
    /// Current step within phase
    pub current_step: usize,
    /// Total steps in phase
    pub total_steps: usize,
    /// Human-readable status message
    pub message: String,
}

/// Phases of the deep scan process
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScanPhase {
    /// Extracting evidence
    Extracting,
    /// Chunking content
    Chunking,
    /// Analyzing chunks (map phase)
    Mapping,
    /// Synthesizing results (reduce phase)
    Reducing,
    /// Complete
    Complete,
}

// ============================================================================
// Prompts for Deep Scan
// ============================================================================

/// System prompt for chunk analysis (map phase)
pub const DEEP_SCAN_MAP_SYSTEM: &str = r#"You are an expert VisualWorks Smalltalk crash analyst. Your task is to extract key signals from a CHUNK of a larger crash log.

Focus on:
1. Error types and codes (ORA-, SQLSTATE, MessageNotUnderstood, etc.)
2. Stack frames that indicate the crash origin
3. Database connection/session issues
4. Memory warnings or indicators
5. Any patterns suggesting the root cause

Output ONLY a JSON object - no explanations or markdown."#;

/// Generate the user prompt for a chunk
pub fn get_chunk_analysis_prompt(chunk: &TextChunk, total_chunks: usize) -> String {
    let crash_marker = if chunk.contains_crash_point {
        "[LIKELY CRASH POINT] "
    } else {
        ""
    };
    format!(
        r#"Analyze this chunk ({}/{}) of a crash log. This chunk covers lines {}-{}.
{}Contains crash point: {}

CHUNK CONTENT:
{}"#,
        chunk.index + 1,
        total_chunks,
        chunk.start_line,
        chunk.end_line,
        crash_marker,
        chunk.contains_crash_point,
        chunk.content
    ) + r#"

Return a JSON object with this EXACT structure:
{
  "errors_found": [
    {
      "error_type": "ORA-00060 or MessageNotUnderstood or etc",
      "message": "Brief error description",
      "line": 42,
      "severity": "critical|high|medium|low"
    }
  ],
  "key_frames": ["ClassName>>methodName where issue originates"],
  "database_issues": ["Any DB connection, session, or query issues"],
  "memory_warnings": ["Any memory-related warnings"],
  "patterns": ["Notable patterns suggesting root cause"],
  "relevance_score": 8,
  "summary": "2-3 sentence summary of what this chunk reveals"
}

IMPORTANT:
- relevance_score: 0=nothing useful, 10=contains crash origin
- Only include items actually found in the chunk
- Return ONLY valid JSON"#
}

/// System prompt for synthesis (reduce phase)
pub const DEEP_SCAN_REDUCE_SYSTEM: &str = r#"You are an expert VisualWorks Smalltalk crash analyst. You will receive:
1. Structured crash data (exception, environment, etc.)
2. Evidence extracted from the walkback
3. Summaries from analyzing chunks of a large walkback

Your task is to synthesize all this information into a comprehensive analysis.

Key expertise areas:
- Smalltalk message-passing and doesNotUnderstand: handling
- VisualWorks-specific patterns (Collections, Streams, etc.)
- Oracle/PostgreSQL database issues
- Memory management (oldSpace, newSpace, perm)
- WHATS'ON broadcast management system domains (PSI.*, BM.*, PL.*, WOn.*)"#;

/// Generate the synthesis prompt
pub fn get_synthesis_prompt(
    structured_data: &str,
    evidence_pack: &EvidencePack,
    chunk_analyses: &[ChunkAnalysis],
    analysis_type: &str,
) -> String {
    // Build chunk summaries section
    let mut chunk_section = String::from("## Chunk Analysis Summaries\n\n");
    for (i, analysis) in chunk_analyses.iter().enumerate() {
        chunk_section.push_str(&format!(
            "### Chunk {} (relevance: {}/10)\n",
            i + 1,
            analysis.relevance_score
        ));
        chunk_section.push_str(&format!("**Summary:** {}\n", analysis.summary));

        if !analysis.errors_found.is_empty() {
            chunk_section.push_str("**Errors:** ");
            let errors: Vec<String> = analysis
                .errors_found
                .iter()
                .map(|e| format!("{}: {}", e.error_type, e.message))
                .collect();
            chunk_section.push_str(&errors.join(", "));
            chunk_section.push('\n');
        }

        if !analysis.key_frames.is_empty() {
            chunk_section.push_str(&format!(
                "**Key Frames:** {}\n",
                analysis.key_frames.join(", ")
            ));
        }

        if !analysis.database_issues.is_empty() {
            chunk_section.push_str(&format!(
                "**DB Issues:** {}\n",
                analysis.database_issues.join(", ")
            ));
        }

        chunk_section.push('\n');
    }

    // Determine output format based on analysis type
    // "comprehensive" and "whatson" use the enhanced WHATS'ON format
    let output_format = match analysis_type {
        "comprehensive" | "whatson" => get_whatson_output_format(),
        "complete" => get_complete_output_format(),
        _ => get_specialized_output_format(),
    };

    format!(
        r#"Synthesize a comprehensive crash analysis from the following sources.

## Structured Crash Data
{}

## Extracted Evidence
{}

{}
## Analysis Task
Create a complete analysis based on ALL the information above. Prioritize information from chunks with higher relevance scores.

{}

IMPORTANT: Return ONLY valid JSON matching the schema above."#,
        structured_data,
        evidence_pack.format_for_prompt(),
        chunk_section,
        output_format
    )
}

fn get_whatson_output_format() -> &'static str {
    r##"OUTPUT FORMAT (WHATS'ON Enhanced JSON):
Return a JSON object with this EXACT structure matching the WhatsOnEnhancedAnalysis interface:
{
  "summary": {
    "title": "Short descriptive title of the crash",
    "severity": "critical|high|medium|low",
    "category": "scheduling|playout|database|memory|integration|ui|rights|timing|other",
    "confidence": "high|medium|low",
    "affectedWorkflow": "Optional: user workflow affected (e.g., EPG Publication, Schedule Import)"
  },
  "rootCause": {
    "technical": "Technical explanation of what caused the crash",
    "plainEnglish": "Simple explanation a non-developer can understand",
    "affectedMethod": "ClassName>>methodName where crash occurred",
    "affectedModule": "PSI|BM|PL|WOn|EX|Core module name",
    "triggerCondition": "Optional: specific condition that triggers this crash"
  },
  "userScenario": {
    "description": "What the user was trying to do",
    "workflow": "Optional: the workflow being executed",
    "steps": [
      {"step": 1, "action": "First action", "details": "Detailed instructions", "isCrashPoint": false},
      {"step": 5, "action": "Final action that crashes", "details": "This triggers the crash", "isCrashPoint": true}
    ],
    "expectedResult": "What should have happened",
    "actualResult": "What actually happened (crash)",
    "reproductionLikelihood": "always|often|sometimes|rarely|unknown"
  },
  "suggestedFix": {
    "summary": "One-line summary of the fix",
    "reasoning": "Why this fix works",
    "explanation": "Optional: detailed explanation",
    "codeChanges": [
      {"file": "ClassName>>methodName", "description": "What to change", "before": "original code", "after": "fixed code", "priority": "P0|P1|P2"}
    ],
    "complexity": "simple|moderate|complex",
    "estimatedEffort": "hours|days|weeks",
    "riskLevel": "low|medium|high"
  },
  "systemWarnings": [
    {"source": "memory|database|process|network|configuration|other", "severity": "critical|warning|info", "title": "Warning title", "description": "What was detected", "recommendation": "What to do", "contributedToCrash": true}
  ],
  "impactAnalysis": {
    "dataAtRisk": "none|low|moderate|high|critical",
    "dataRiskDescription": "Optional: description of data risk",
    "directlyAffected": [
      {"feature": "Feature name", "module": "Module.Name", "description": "How it is affected", "severity": "critical|high|medium|low"}
    ],
    "potentiallyAffected": [
      {"feature": "Feature name", "module": "Module.Name", "description": "May be affected", "severity": "high|medium|low"}
    ]
  },
  "testScenarios": [
    {"id": "TC001", "name": "Test name", "priority": "P0|P1|P2", "type": "regression|smoke|integration|unit", "description": "Test description", "steps": "Test steps", "expectedResult": "Expected outcome", "dataRequirements": "Data needed"}
  ],
  "environment": {
    "application": {"version": "2024r3.000.064", "build": "build string", "configuration": "config"},
    "platform": {"os": "Windows/Linux", "memory": "16GB", "user": "username"},
    "database": {"type": "Oracle/PostgreSQL", "connectionInfo": "connection details", "sessionState": "state"}
  },
  "context": {
    "receiver": {"class": "UndefinedObject", "state": "nil", "description": "What this object represents"},
    "arguments": [{"name": "selector", "value": "asSeconds", "type": "Symbol"}],
    "relatedObjects": [{"name": "segment", "class": "BMProgramSegment", "relationship": "parent object"}]
  },
  "memoryAnalysis": {
    "oldSpace": {"used": "1,170,866 KB", "total": "2,000,000 KB", "percentUsed": 58.5},
    "newSpace": {"used": "225 KB", "total": "1,500 KB", "percentUsed": 15.0},
    "permSpace": {"used": "200,000 KB", "total": "200,000 KB", "percentUsed": 100.0},
    "warnings": ["Perm space at 100%", "Any memory warnings"]
  },
  "databaseAnalysis": {
    "connections": [{"name": "Connection 99", "status": "xactYes", "database": "WONP11"}],
    "activeSessions": [{"id": "session1", "status": "prepared", "lastOperation": "UPDATE PSI.PSITXBLOCK"}],
    "warnings": ["Active transaction may need rollback"],
    "transactionState": "open|committed|rolled_back|unknown"
  },
  "stackTrace": {
    "frames": [
      {"index": 0, "method": "UndefinedObject(Object)>>doesNotUnderstand:", "type": "error", "isErrorOrigin": true, "context": "nil received asSeconds"},
      {"index": 1, "method": "BMProgramSegmentDurations>>calculateTotalDuration", "type": "application", "isErrorOrigin": false}
    ],
    "totalFrames": 50,
    "errorFrame": "UndefinedObject(Object)>>doesNotUnderstand:"
  }
}

IMPORTANT: Return ONLY valid JSON. Include all sections you have evidence for. Omit sections with no data rather than using empty values."##
}

fn get_complete_output_format() -> &'static str {
    r#"OUTPUT FORMAT (Complete Analysis):
{{
  "error_type": "MessageNotUnderstood",
  "error_message": "Receiver does not understand selector",
  "severity": "critical",
  "root_cause": "COMPREHENSIVE 10-part analysis with all sections: ERROR CLASSIFICATION, USER ACTION RECONSTRUCTION, ROOT CAUSE (TECHNICAL), ROOT CAUSE (FUNCTIONAL), DEVELOPER REMEDIATION, USER REMEDIATION, REPRODUCTION STEPS, MONITORING, SIMILAR ISSUES, VALIDATION STRATEGY",
  "suggested_fixes": ["P0 fix", "P1 fix", "P2 fix"],
  "component": "AffectedClass",
  "stack_trace": "Key stack frames",
  "confidence": "high"
}}"#
}

fn get_specialized_output_format() -> &'static str {
    r#"OUTPUT FORMAT (Specialized Analysis):
{{
  "error_type": "MessageNotUnderstood",
  "error_message": "Receiver does not understand selector",
  "severity": "critical",
  "root_cause": "8-part specialized analysis: PATTERN ANALYSIS, RECOMMENDATIONS, MEMORY ANALYSIS, DATABASE ANALYSIS, PERFORMANCE ANALYSIS, ROOT CAUSE ANALYSIS, GENERAL ANALYSIS, BASIC ANALYSIS",
  "suggested_fixes": ["P0 fix", "P1 fix", "P2 fix"],
  "component": "AffectedClass",
  "stack_trace": "Key stack frames",
  "confidence": "high"
}}"#
}

// ============================================================================
// Deep Scan Configuration
// ============================================================================

/// Configuration for deep scan
#[derive(Debug, Clone)]
pub struct DeepScanConfig {
    /// Maximum concurrent chunk analyses (if using async)
    #[allow(dead_code)]
    pub max_concurrency: usize,
    /// Chunk configuration
    pub chunk_config: ChunkConfig,
    /// Whether to skip low-relevance chunks in synthesis
    pub skip_low_relevance: bool,
    /// Minimum relevance score to include in synthesis
    pub min_relevance_score: u8,
}

impl Default for DeepScanConfig {
    fn default() -> Self {
        Self {
            max_concurrency: 3,
            chunk_config: ChunkConfig::default(),
            skip_low_relevance: true,
            min_relevance_score: 2,
        }
    }
}

// ============================================================================
// Deep Scan Runner
// ============================================================================

/// Orchestrates the deep scan map-reduce process
pub struct DeepScanRunner {
    config: DeepScanConfig,
}

impl DeepScanRunner {
    /// Create a new runner with default config
    pub fn new() -> Self {
        Self {
            config: DeepScanConfig::default(),
        }
    }

    /// Create with custom configuration
    #[allow(dead_code)]
    pub fn with_config(config: DeepScanConfig) -> Self {
        Self { config }
    }

    /// Configure based on model's token budget
    pub fn for_model(model: &str) -> Self {
        let budgeter = TokenBudgeter::new(model);
        let safe_budget = budgeter.safe_input_budget();
        let chunk_config = ChunkConfig::for_model_budget(safe_budget);

        log::info!(
            "DeepScan configured for model '{}': safe_budget={}, chunk_target={}, chunk_max={}",
            model,
            safe_budget,
            chunk_config.target_tokens_per_chunk,
            chunk_config.max_tokens_per_chunk
        );

        Self {
            config: DeepScanConfig {
                chunk_config,
                ..Default::default()
            },
        }
    }

    /// Prepare chunks for analysis
    pub fn prepare_chunks(&self, raw_walkback: &str) -> Vec<TextChunk> {
        let crash_line = find_crash_line(raw_walkback);
        let chunker = Chunker::with_config(self.config.chunk_config.clone());
        let chunks = chunker.chunk(raw_walkback, crash_line);

        log::info!(
            "DeepScan prepared {} chunks from {} bytes of content (crash line: {:?})",
            chunks.len(),
            raw_walkback.len(),
            crash_line
        );

        if !chunks.is_empty() {
            let total_tokens: u32 = chunks.iter().map(|c| c.estimated_tokens).sum();
            log::info!(
                "Chunk token distribution: total={}, avg={}, first={}, last={}",
                total_tokens,
                total_tokens / chunks.len() as u32,
                chunks.first().map(|c| c.estimated_tokens).unwrap_or(0),
                chunks.last().map(|c| c.estimated_tokens).unwrap_or(0)
            );
        }

        chunks
    }

    /// Filter analyses for synthesis based on relevance
    pub fn filter_for_synthesis(&self, analyses: Vec<ChunkAnalysis>) -> Vec<ChunkAnalysis> {
        if !self.config.skip_low_relevance {
            return analyses;
        }

        analyses
            .into_iter()
            .filter(|a| a.relevance_score >= self.config.min_relevance_score)
            .collect()
    }

    /// Get the chunk analysis prompt for a specific chunk
    pub fn get_map_prompt(&self, chunk: &TextChunk) -> (String, String) {
        (
            DEEP_SCAN_MAP_SYSTEM.to_string(),
            get_chunk_analysis_prompt(chunk, chunk.total),
        )
    }

    /// Get the synthesis prompt
    pub fn get_reduce_prompt(
        &self,
        structured_data: &str,
        evidence_pack: &EvidencePack,
        chunk_analyses: &[ChunkAnalysis],
        analysis_type: &str,
    ) -> (String, String) {
        (
            DEEP_SCAN_REDUCE_SYSTEM.to_string(),
            get_synthesis_prompt(
                structured_data,
                evidence_pack,
                chunk_analyses,
                analysis_type,
            ),
        )
    }

    /// Parse a chunk analysis result from JSON
    pub fn parse_chunk_result(json_str: &str, chunk_index: usize) -> Result<ChunkAnalysis, String> {
        // Extract JSON from response
        let json_start = json_str
            .find('{')
            .ok_or("No JSON found in chunk response")?;
        let json_end = json_str
            .rfind('}')
            .ok_or("Malformed JSON in chunk response")?;

        if json_start > json_end {
            return Err("Invalid JSON bounds in chunk response".to_string());
        }

        let json_content = &json_str[json_start..=json_end];

        let parsed: serde_json::Value = serde_json::from_str(json_content)
            .map_err(|e| format!("Failed to parse chunk JSON: {}", e))?;

        // Extract fields with defaults
        let errors_found = parsed["errors_found"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|e| {
                        Some(ChunkError {
                            error_type: e["error_type"].as_str()?.to_string(),
                            message: e["message"].as_str().unwrap_or("").to_string(),
                            line: e["line"].as_u64().map(|n| n as usize),
                            severity: e["severity"].as_str().unwrap_or("medium").to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let key_frames = Self::extract_string_array(&parsed["key_frames"]);
        let database_issues = Self::extract_string_array(&parsed["database_issues"]);
        let memory_warnings = Self::extract_string_array(&parsed["memory_warnings"]);
        let patterns = Self::extract_string_array(&parsed["patterns"]);

        let relevance_score = parsed["relevance_score"].as_u64().unwrap_or(5) as u8;
        let summary = parsed["summary"]
            .as_str()
            .unwrap_or("No summary provided")
            .to_string();

        Ok(ChunkAnalysis {
            chunk_index,
            errors_found,
            key_frames,
            database_issues,
            memory_warnings,
            patterns,
            relevance_score,
            summary,
        })
    }

    fn extract_string_array(value: &serde_json::Value) -> Vec<String> {
        value
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get configuration
    #[allow(dead_code)]
    pub fn config(&self) -> &DeepScanConfig {
        &self.config
    }
}

impl Default for DeepScanRunner {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_analysis_parsing() {
        let json = r#"
        {
            "errors_found": [
                {"error_type": "ORA-00060", "message": "Deadlock", "line": 42, "severity": "critical"}
            ],
            "key_frames": ["MyClass>>processData"],
            "database_issues": ["Connection timeout"],
            "memory_warnings": [],
            "patterns": ["Concurrent access pattern"],
            "relevance_score": 8,
            "summary": "Deadlock detected in data processing"
        }
        "#;

        let result = DeepScanRunner::parse_chunk_result(json, 0).unwrap();

        assert_eq!(result.errors_found.len(), 1);
        assert_eq!(result.errors_found[0].error_type, "ORA-00060");
        assert_eq!(result.relevance_score, 8);
        assert!(result.summary.contains("Deadlock"));
    }

    #[test]
    fn test_relevance_filtering() {
        let runner = DeepScanRunner::with_config(DeepScanConfig {
            skip_low_relevance: true,
            min_relevance_score: 5,
            ..Default::default()
        });

        let analyses = vec![
            ChunkAnalysis {
                chunk_index: 0,
                relevance_score: 2,
                summary: "Low relevance".to_string(),
                ..Default::default()
            },
            ChunkAnalysis {
                chunk_index: 1,
                relevance_score: 8,
                summary: "High relevance".to_string(),
                ..Default::default()
            },
        ];

        let filtered = runner.filter_for_synthesis(analyses);

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].relevance_score, 8);
    }

    #[test]
    fn test_prompt_generation() {
        let chunk = TextChunk {
            index: 0,
            total: 3,
            content: "Test content".to_string(),
            start_line: 1,
            end_line: 100,
            estimated_tokens: 50,
            contains_crash_point: true,
        };

        let prompt = get_chunk_analysis_prompt(&chunk, 3);

        assert!(prompt.contains("1/3"));
        assert!(prompt.contains("LIKELY CRASH POINT"));
        assert!(prompt.contains("Test content"));
    }
}

impl Default for ChunkAnalysis {
    fn default() -> Self {
        Self {
            chunk_index: 0,
            errors_found: Vec::new(),
            key_frames: Vec::new(),
            database_issues: Vec::new(),
            memory_warnings: Vec::new(),
            patterns: Vec::new(),
            relevance_score: 5,
            summary: String::new(),
        }
    }
}
