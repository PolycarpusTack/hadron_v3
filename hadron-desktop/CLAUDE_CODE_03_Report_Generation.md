# CLAUDE CODE INSTRUCTION: Report Generation System

## Context

You are implementing a report generation system for the WHATS'ON Crash Analyzer. The system generates professional reports in multiple formats (PDF, Markdown, JSON, HTML) that can be shared with different audiences:

- **Technical reports**: Full details for developers
- **Support reports**: Actionable information for support engineers  
- **Customer reports**: Sanitized, non-technical summaries
- **JSON exports**: Machine-readable for integrations

This is a Rust/Tauri desktop application.

## Project Structure

Create this structure:
```
src/
├── export/
│   ├── mod.rs
│   ├── report.rs           # Report data structures
│   ├── generators/
│   │   ├── mod.rs
│   │   ├── pdf.rs          # PDF generation
│   │   ├── markdown.rs     # Markdown generation
│   │   ├── html.rs         # HTML generation
│   │   └── json.rs         # JSON export
│   ├── templates/
│   │   ├── mod.rs
│   │   └── embedded.rs     # Embedded HTML templates
│   └── sanitizer.rs        # Customer-safe content filtering
```

## Dependencies

Add to `Cargo.toml`:
```toml
[dependencies]
# Existing deps...
printpdf = "0.7"           # PDF generation
minijinja = "2.0"          # Template engine
pulldown-cmark = "0.10"    # Markdown parsing
base64 = "0.21"
chrono = { version = "0.4", features = ["serde"] }
```

---

## TASK 1: Define Report Data Structures

### File: `src/export/report.rs`

```rust
use serde::{Deserialize, Serialize};
use crate::models::{CrashFile, AnalysisResult};
use crate::patterns::PatternMatchResult;

/// Configuration for report generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportConfig {
    /// Report title
    pub title: Option<String>,
    
    /// Target audience
    pub audience: ReportAudience,
    
    /// Sections to include
    pub sections: ReportSections,
    
    /// Branding/styling options
    pub branding: ReportBranding,
    
    /// Whether to include raw data
    pub include_raw_data: bool,
    
    /// Date format string
    pub date_format: String,
}

impl Default for ReportConfig {
    fn default() -> Self {
        Self {
            title: None,
            audience: ReportAudience::Technical,
            sections: ReportSections::all(),
            branding: ReportBranding::default(),
            include_raw_data: false,
            date_format: "%Y-%m-%d %H:%M:%S".to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReportAudience {
    /// Full technical details for developers
    Technical,
    /// Actionable info for support engineers
    Support,
    /// Sanitized summary for customers
    Customer,
    /// Executive summary
    Executive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportSections {
    pub summary: bool,
    pub environment: bool,
    pub exception_details: bool,
    pub root_cause: bool,
    pub reproduction_steps: bool,
    pub suggested_fix: bool,
    pub stack_trace: bool,
    pub context_arguments: bool,
    pub database_state: bool,
    pub memory_report: bool,
    pub system_warnings: bool,
    pub impact_analysis: bool,
    pub test_scenarios: bool,
    pub investigation_queries: bool,
    pub pattern_match: bool,
}

impl ReportSections {
    pub fn all() -> Self {
        Self {
            summary: true,
            environment: true,
            exception_details: true,
            root_cause: true,
            reproduction_steps: true,
            suggested_fix: true,
            stack_trace: true,
            context_arguments: true,
            database_state: true,
            memory_report: true,
            system_warnings: true,
            impact_analysis: true,
            test_scenarios: true,
            investigation_queries: true,
            pattern_match: true,
        }
    }

    pub fn summary_only() -> Self {
        Self {
            summary: true,
            environment: true,
            exception_details: true,
            root_cause: true,
            reproduction_steps: false,
            suggested_fix: true,
            stack_trace: false,
            context_arguments: false,
            database_state: false,
            memory_report: false,
            system_warnings: true,
            impact_analysis: false,
            test_scenarios: false,
            investigation_queries: false,
            pattern_match: false,
        }
    }

    pub fn customer_safe() -> Self {
        Self {
            summary: true,
            environment: false,  // May contain sensitive info
            exception_details: false,
            root_cause: true,  // Plain English only
            reproduction_steps: true,
            suggested_fix: false,  // Internal only
            stack_trace: false,
            context_arguments: false,
            database_state: false,
            memory_report: false,
            system_warnings: false,
            impact_analysis: true,
            test_scenarios: false,
            investigation_queries: false,
            pattern_match: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportBranding {
    /// Company/product name
    pub company_name: String,
    /// Logo (base64 encoded PNG)
    pub logo_base64: Option<String>,
    /// Primary color (hex)
    pub primary_color: String,
    /// Secondary color (hex)
    pub secondary_color: String,
    /// Footer text
    pub footer_text: Option<String>,
}

impl Default for ReportBranding {
    fn default() -> Self {
        Self {
            company_name: "WHATS'ON Crash Analyzer".to_string(),
            logo_base64: None,
            primary_color: "#1e3a5f".to_string(),
            secondary_color: "#3b82f6".to_string(),
            footer_text: None,
        }
    }
}

/// Complete data for report generation
#[derive(Debug, Clone, Serialize)]
pub struct ReportData {
    /// Report metadata
    pub metadata: ReportMetadata,
    
    /// Crash file data
    pub crash: CrashFileSummary,
    
    /// Analysis results
    pub analysis: Option<AnalysisSummary>,
    
    /// Pattern match results
    pub pattern_match: Option<PatternMatchSummary>,
    
    /// Configuration used
    pub config: ReportConfig,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReportMetadata {
    pub generated_at: String,
    pub generator_version: String,
    pub report_id: String,
}

/// Summarized crash data for reports
#[derive(Debug, Clone, Serialize)]
pub struct CrashFileSummary {
    pub file_name: String,
    pub timestamp: Option<String>,
    pub user: Option<String>,
    pub site: Option<String>,
    pub version: Option<String>,
    pub build: Option<String>,
    pub computer: Option<String>,
    pub exception_type: String,
    pub exception_message: String,
    pub exception_parameter: Option<String>,
    pub stack_trace: Vec<StackFrameSummary>,
    pub stack_trace_truncated: bool,
    pub open_windows: Vec<WindowSummary>,
    pub has_active_transaction: bool,
    pub memory_warning: Option<String>,
    pub database_backend: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StackFrameSummary {
    pub frame_number: u32,
    pub method: String,
    pub frame_type: String,
    pub is_application: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct WindowSummary {
    pub title: String,
    pub model: String,
}

/// Summarized analysis for reports
#[derive(Debug, Clone, Serialize)]
pub struct AnalysisSummary {
    pub root_cause: String,
    pub root_cause_plain: String,
    pub severity: String,
    pub category: String,
    pub affected_method: Option<String>,
    pub affected_module: Option<String>,
    pub data_at_risk: bool,
    pub fix_summary: String,
    pub fix_details: Option<String>,
    pub fix_code_hints: Vec<String>,
    pub workarounds: Vec<String>,
    pub reproduction_steps: Vec<ReproductionStep>,
    pub expected_result: Option<String>,
    pub actual_result: Option<String>,
    pub system_warnings: Vec<SystemWarning>,
    pub affected_features: Vec<AffectedFeature>,
    pub test_scenarios: Vec<TestScenario>,
    pub investigation_queries: Vec<InvestigationQuery>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReproductionStep {
    pub step_number: u32,
    pub action: String,
    pub details: Option<String>,
    pub is_crash_point: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemWarning {
    pub source: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub recommendation: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AffectedFeature {
    pub feature: String,
    pub module: String,
    pub impact: String,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestScenario {
    pub id: String,
    pub name: String,
    pub priority: String,
    pub steps: Vec<String>,
    pub expected_result: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct InvestigationQuery {
    pub name: String,
    pub description: String,
    pub sql: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PatternMatchSummary {
    pub pattern_id: String,
    pub pattern_name: String,
    pub confidence: f32,
    pub is_known_issue: bool,
    pub fixed_in_version: Option<String>,
    pub tickets: Vec<String>,
}

impl ReportData {
    /// Create report data from crash file and optional analysis
    pub fn from_crash(
        crash: &CrashFile,
        analysis: Option<&AnalysisResult>,
        pattern: Option<&PatternMatchResult>,
        config: ReportConfig,
    ) -> Self {
        Self {
            metadata: ReportMetadata {
                generated_at: chrono::Utc::now().format(&config.date_format).to_string(),
                generator_version: env!("CARGO_PKG_VERSION").to_string(),
                report_id: uuid::Uuid::new_v4().to_string(),
            },
            crash: Self::summarize_crash(crash, &config),
            analysis: analysis.map(|a| Self::summarize_analysis(a, &config)),
            pattern_match: pattern.map(Self::summarize_pattern),
            config,
        }
    }

    fn summarize_crash(crash: &CrashFile, config: &ReportConfig) -> CrashFileSummary {
        let max_frames = match config.audience {
            ReportAudience::Technical => 50,
            ReportAudience::Support => 20,
            ReportAudience::Customer => 0,
            ReportAudience::Executive => 5,
        };

        let stack_trace: Vec<_> = crash.stack_trace
            .iter()
            .take(max_frames)
            .map(|f| StackFrameSummary {
                frame_number: f.frame_number,
                method: f.method_signature.clone(),
                frame_type: format!("{:?}", f.frame_type),
                is_application: matches!(f.frame_type, crate::models::FrameType::Application),
            })
            .collect();

        let stack_trace_truncated = crash.stack_trace.len() > max_frames;

        // Check for memory warnings
        let memory_warning = crash.memory.old.as_ref()
            .filter(|m| m.percent_used > 90.0)
            .map(|m| format!("Old space at {:.1}% capacity", m.percent_used))
            .or_else(|| crash.memory.perm.as_ref()
                .filter(|m| m.percent_used >= 100.0)
                .map(|_| "Permanent space at 100% (expected for running system)".to_string()));

        // Detect database backend
        let database_backend = if crash.environment.oracle_server.is_some() {
            Some("Oracle".to_string())
        } else if crash.environment.postgres_version.is_some() {
            Some("PostgreSQL".to_string())
        } else {
            None
        };

        CrashFileSummary {
            file_name: crash.header.file_name.clone(),
            timestamp: crash.header.timestamp.map(|t| t.format(&config.date_format).to_string()),
            user: crash.environment.user.clone(),
            site: crash.environment.site.clone(),
            version: crash.environment.version.clone(),
            build: crash.environment.build.clone(),
            computer: crash.environment.computer_name.clone(),
            exception_type: crash.exception.exception_type.clone(),
            exception_message: crash.exception.message.clone(),
            exception_parameter: crash.exception.parameter.clone(),
            stack_trace,
            stack_trace_truncated,
            open_windows: crash.windows.iter().map(|w| WindowSummary {
                title: w.title.clone(),
                model: w.model.clone(),
            }).collect(),
            has_active_transaction: crash.database.has_active_transaction,
            memory_warning,
            database_backend,
        }
    }

    fn summarize_analysis(analysis: &AnalysisResult, _config: &ReportConfig) -> AnalysisSummary {
        // This would map from your AnalysisResult structure
        // Placeholder implementation:
        AnalysisSummary {
            root_cause: analysis.root_cause.technical.clone(),
            root_cause_plain: analysis.root_cause.plain_english.clone(),
            severity: format!("{:?}", analysis.summary.severity),
            category: format!("{:?}", analysis.summary.category),
            affected_method: analysis.root_cause.affected_method.clone(),
            affected_module: analysis.root_cause.affected_module.clone(),
            data_at_risk: analysis.impact_analysis.data_at_risk,
            fix_summary: analysis.suggested_fix.summary.clone(),
            fix_details: analysis.suggested_fix.explanation.clone(),
            fix_code_hints: analysis.suggested_fix.code_hints.clone(),
            workarounds: analysis.suggested_fix.workarounds.clone(),
            reproduction_steps: analysis.user_scenario.steps.iter().enumerate().map(|(i, s)| {
                ReproductionStep {
                    step_number: i as u32 + 1,
                    action: s.action.clone(),
                    details: s.details.clone(),
                    is_crash_point: s.is_crash_point,
                }
            }).collect(),
            expected_result: Some(analysis.user_scenario.expected_result.clone()),
            actual_result: Some(analysis.user_scenario.actual_result.clone()),
            system_warnings: analysis.system_warnings.iter().map(|w| SystemWarning {
                source: w.source.clone(),
                severity: format!("{:?}", w.severity),
                title: w.title.clone(),
                description: w.description.clone(),
                recommendation: w.recommendation.clone(),
            }).collect(),
            affected_features: analysis.impact_analysis.directly_affected.iter().map(|f| {
                AffectedFeature {
                    feature: f.feature.clone(),
                    module: f.module.clone(),
                    impact: "Direct".to_string(),
                    severity: format!("{:?}", f.severity),
                }
            }).collect(),
            test_scenarios: analysis.test_scenarios.iter().map(|t| TestScenario {
                id: t.id.clone(),
                name: t.name.clone(),
                priority: t.priority.clone(),
                steps: t.steps.clone(),
                expected_result: t.expected_result.clone(),
            }).collect(),
            investigation_queries: vec![],  // Map from analysis if available
        }
    }

    fn summarize_pattern(pattern: &PatternMatchResult) -> PatternMatchSummary {
        PatternMatchSummary {
            pattern_id: pattern.pattern.id.clone(),
            pattern_name: pattern.pattern.name.clone(),
            confidence: pattern.confidence,
            is_known_issue: pattern.pattern.versioning.tickets.len() > 0,
            fixed_in_version: pattern.fixed_in_version.clone(),
            tickets: pattern.pattern.versioning.tickets.clone(),
        }
    }
}
```

---

## TASK 2: Content Sanitizer

### File: `src/export/sanitizer.rs`

```rust
use regex::Regex;
use lazy_static::lazy_static;

lazy_static! {
    // Patterns to redact
    static ref USERNAME_PATTERN: Regex = Regex::new(r"(?i)(user|username|login):\s*\S+").unwrap();
    static ref PASSWORD_PATTERN: Regex = Regex::new(r"(?i)(password|pwd|pass):\s*\S+").unwrap();
    static ref IP_PATTERN: Regex = Regex::new(r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}").unwrap();
    static ref EMAIL_PATTERN: Regex = Regex::new(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}").unwrap();
    static ref PATH_PATTERN: Regex = Regex::new(r"[A-Z]:\\[^\s]+|/(?:home|users|var|tmp)/[^\s]+").unwrap();
    static ref OID_PATTERN: Regex = Regex::new(r"oid\s*[=:]\s*\d+").unwrap();
    static ref HASH_PATTERN: Regex = Regex::new(r"#[0-9a-fA-F]{6,}").unwrap();
}

/// Sanitize content for customer-facing reports
pub fn sanitize_for_customer(text: &str) -> String {
    let mut result = text.to_string();
    
    // Redact potentially sensitive information
    result = USERNAME_PATTERN.replace_all(&result, "$1: [REDACTED]").to_string();
    result = PASSWORD_PATTERN.replace_all(&result, "$1: [REDACTED]").to_string();
    result = IP_PATTERN.replace_all(&result, "[IP_REDACTED]").to_string();
    result = EMAIL_PATTERN.replace_all(&result, "[EMAIL_REDACTED]").to_string();
    result = PATH_PATTERN.replace_all(&result, "[PATH_REDACTED]").to_string();
    result = OID_PATTERN.replace_all(&result, "oid: [REDACTED]").to_string();
    result = HASH_PATTERN.replace_all(&result, "#[HASH]").to_string();
    
    result
}

/// Remove technical jargon for non-technical audiences
pub fn simplify_technical_terms(text: &str) -> String {
    let replacements = [
        ("SubscriptOutOfBoundsError", "list access error"),
        ("MessageNotUnderstood", "operation error"),
        ("OrderedCollection", "list"),
        ("Dictionary", "lookup table"),
        ("nil", "empty value"),
        ("UndefinedObject", "missing value"),
        ("transaction", "pending changes"),
        ("rollback", "undo changes"),
        ("deadlock", "operation conflict"),
        ("stack trace", "error location"),
    ];
    
    let mut result = text.to_string();
    for (from, to) in replacements {
        result = result.replace(from, to);
    }
    result
}

/// Sanitize SQL queries (remove table names, values)
pub fn sanitize_sql(sql: &str) -> String {
    let result = Regex::new(r"'[^']*'")
        .unwrap()
        .replace_all(sql, "'[VALUE]'");
    
    // Keep structure but hide specific values
    result.to_string()
}

/// Check if content contains potentially sensitive data
pub fn has_sensitive_content(text: &str) -> bool {
    USERNAME_PATTERN.is_match(text) ||
    PASSWORD_PATTERN.is_match(text) ||
    EMAIL_PATTERN.is_match(text) ||
    IP_PATTERN.is_match(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_username() {
        let input = "User: john.doe logged in";
        let result = sanitize_for_customer(input);
        assert!(!result.contains("john.doe"));
        assert!(result.contains("[REDACTED]"));
    }

    #[test]
    fn test_sanitize_ip() {
        let input = "Connected to 192.168.1.100";
        let result = sanitize_for_customer(input);
        assert!(!result.contains("192.168.1.100"));
    }

    #[test]
    fn test_simplify_terms() {
        let input = "SubscriptOutOfBoundsError in OrderedCollection";
        let result = simplify_technical_terms(input);
        assert_eq!(result, "list access error in list");
    }
}
```

---

## TASK 3: Markdown Generator

### File: `src/export/generators/markdown.rs`

```rust
use crate::export::report::{ReportData, ReportAudience, ReportConfig};
use crate::export::sanitizer::{sanitize_for_customer, simplify_technical_terms};
use std::fmt::Write;

/// Generate a Markdown report
pub fn generate_markdown(data: &ReportData) -> String {
    let mut md = String::new();
    let config = &data.config;
    
    // Title
    let title = config.title.as_deref()
        .unwrap_or("Crash Analysis Report");
    writeln!(md, "# {}", title).unwrap();
    writeln!(md).unwrap();
    
    // Metadata
    writeln!(md, "**Generated:** {}  ", data.metadata.generated_at).unwrap();
    writeln!(md, "**Report ID:** {}  ", data.metadata.report_id).unwrap();
    writeln!(md).unwrap();
    
    // Sections based on config
    if config.sections.summary {
        write_summary_section(&mut md, data);
    }
    
    if config.sections.environment {
        write_environment_section(&mut md, data);
    }
    
    if config.sections.exception_details {
        write_exception_section(&mut md, data);
    }
    
    if config.sections.root_cause {
        write_root_cause_section(&mut md, data);
    }
    
    if config.sections.reproduction_steps {
        write_reproduction_section(&mut md, data);
    }
    
    if config.sections.suggested_fix {
        write_fix_section(&mut md, data);
    }
    
    if config.sections.system_warnings {
        write_warnings_section(&mut md, data);
    }
    
    if config.sections.stack_trace {
        write_stack_trace_section(&mut md, data);
    }
    
    if config.sections.impact_analysis {
        write_impact_section(&mut md, data);
    }
    
    if config.sections.test_scenarios {
        write_test_section(&mut md, data);
    }
    
    if config.sections.investigation_queries {
        write_queries_section(&mut md, data);
    }
    
    if config.sections.pattern_match {
        write_pattern_section(&mut md, data);
    }
    
    // Footer
    if let Some(ref footer) = config.branding.footer_text {
        writeln!(md).unwrap();
        writeln!(md, "---").unwrap();
        writeln!(md, "*{}*", footer).unwrap();
    }
    
    md
}

fn write_summary_section(md: &mut String, data: &ReportData) {
    writeln!(md, "## Summary").unwrap();
    writeln!(md).unwrap();
    
    let crash = &data.crash;
    let is_customer = data.config.audience == ReportAudience::Customer;
    
    writeln!(md, "| Property | Value |").unwrap();
    writeln!(md, "|----------|-------|").unwrap();
    writeln!(md, "| **File** | {} |", crash.file_name).unwrap();
    
    if let Some(ref ts) = crash.timestamp {
        writeln!(md, "| **Time** | {} |", ts).unwrap();
    }
    
    if !is_customer {
        if let Some(ref site) = crash.site {
            writeln!(md, "| **Site** | {} |", site).unwrap();
        }
        if let Some(ref version) = crash.version {
            writeln!(md, "| **Version** | {} |", version).unwrap();
        }
    }
    
    let exception = if is_customer {
        simplify_technical_terms(&crash.exception_type)
    } else {
        crash.exception_type.clone()
    };
    writeln!(md, "| **Error Type** | {} |", exception).unwrap();
    
    if let Some(ref analysis) = data.analysis {
        writeln!(md, "| **Severity** | {} |", analysis.severity).unwrap();
        if analysis.data_at_risk {
            writeln!(md, "| **Data Risk** | ⚠️ Yes |").unwrap();
        }
    }
    
    if crash.has_active_transaction && !is_customer {
        writeln!(md, "| **Transaction** | ⚠️ Active (uncommitted changes) |").unwrap();
    }
    
    writeln!(md).unwrap();
}

fn write_environment_section(md: &mut String, data: &ReportData) {
    let crash = &data.crash;
    
    writeln!(md, "## Environment").unwrap();
    writeln!(md).unwrap();
    
    if let Some(ref site) = crash.site {
        writeln!(md, "- **Site:** {}", site).unwrap();
    }
    if let Some(ref user) = crash.user {
        let user_display = if data.config.audience == ReportAudience::Customer {
            "[User]".to_string()
        } else {
            user.clone()
        };
        writeln!(md, "- **User:** {}", user_display).unwrap();
    }
    if let Some(ref version) = crash.version {
        writeln!(md, "- **Version:** {}", version).unwrap();
    }
    if let Some(ref build) = crash.build {
        writeln!(md, "- **Build:** {}", build).unwrap();
    }
    if let Some(ref computer) = crash.computer {
        writeln!(md, "- **Computer:** {}", computer).unwrap();
    }
    if let Some(ref db) = crash.database_backend {
        writeln!(md, "- **Database:** {}", db).unwrap();
    }
    
    writeln!(md).unwrap();
}

fn write_exception_section(md: &mut String, data: &ReportData) {
    let crash = &data.crash;
    
    writeln!(md, "## Exception Details").unwrap();
    writeln!(md).unwrap();
    writeln!(md, "```").unwrap();
    writeln!(md, "Type: {}", crash.exception_type).unwrap();
    writeln!(md, "Message: {}", crash.exception_message).unwrap();
    if let Some(ref param) = crash.exception_parameter {
        writeln!(md, "Parameter: {}", param).unwrap();
    }
    writeln!(md, "```").unwrap();
    writeln!(md).unwrap();
}

fn write_root_cause_section(md: &mut String, data: &ReportData) {
    if let Some(ref analysis) = data.analysis {
        writeln!(md, "## Root Cause").unwrap();
        writeln!(md).unwrap();
        
        let root_cause = if data.config.audience == ReportAudience::Customer {
            simplify_technical_terms(&analysis.root_cause_plain)
        } else {
            analysis.root_cause_plain.clone()
        };
        
        writeln!(md, "{}", root_cause).unwrap();
        writeln!(md).unwrap();
        
        if data.config.audience == ReportAudience::Technical {
            writeln!(md, "### Technical Details").unwrap();
            writeln!(md).unwrap();
            writeln!(md, "{}", analysis.root_cause).unwrap();
            
            if let Some(ref method) = analysis.affected_method {
                writeln!(md).unwrap();
                writeln!(md, "**Affected Method:** `{}`", method).unwrap();
            }
            
            if let Some(ref module) = analysis.affected_module {
                writeln!(md, "**Module:** {}", module).unwrap();
            }
            
            writeln!(md).unwrap();
        }
    }
}

fn write_reproduction_section(md: &mut String, data: &ReportData) {
    if let Some(ref analysis) = data.analysis {
        if analysis.reproduction_steps.is_empty() {
            return;
        }
        
        writeln!(md, "## Reproduction Steps").unwrap();
        writeln!(md).unwrap();
        
        for step in &analysis.reproduction_steps {
            let marker = if step.is_crash_point { "🔴" } else { "" };
            writeln!(md, "{}. {} {}", step.step_number, step.action, marker).unwrap();
            if let Some(ref details) = step.details {
                writeln!(md, "   - {}", details).unwrap();
            }
        }
        
        writeln!(md).unwrap();
        
        if let Some(ref expected) = analysis.expected_result {
            writeln!(md, "**Expected:** {}", expected).unwrap();
        }
        if let Some(ref actual) = analysis.actual_result {
            writeln!(md, "**Actual:** {}", actual).unwrap();
        }
        
        writeln!(md).unwrap();
    }
}

fn write_fix_section(md: &mut String, data: &ReportData) {
    if let Some(ref analysis) = data.analysis {
        writeln!(md, "## Suggested Fix").unwrap();
        writeln!(md).unwrap();
        writeln!(md, "{}", analysis.fix_summary).unwrap();
        writeln!(md).unwrap();
        
        if let Some(ref details) = analysis.fix_details {
            if data.config.audience == ReportAudience::Technical {
                writeln!(md, "### Details").unwrap();
                writeln!(md).unwrap();
                writeln!(md, "{}", details).unwrap();
                writeln!(md).unwrap();
            }
        }
        
        if !analysis.fix_code_hints.is_empty() && data.config.audience == ReportAudience::Technical {
            writeln!(md, "### Code Changes").unwrap();
            writeln!(md).unwrap();
            for hint in &analysis.fix_code_hints {
                writeln!(md, "- {}", hint).unwrap();
            }
            writeln!(md).unwrap();
        }
        
        if !analysis.workarounds.is_empty() {
            writeln!(md, "### Workarounds").unwrap();
            writeln!(md).unwrap();
            for workaround in &analysis.workarounds {
                writeln!(md, "- {}", workaround).unwrap();
            }
            writeln!(md).unwrap();
        }
    }
}

fn write_warnings_section(md: &mut String, data: &ReportData) {
    if let Some(ref analysis) = data.analysis {
        if analysis.system_warnings.is_empty() {
            return;
        }
        
        writeln!(md, "## System Warnings").unwrap();
        writeln!(md).unwrap();
        
        for warning in &analysis.system_warnings {
            let icon = match warning.severity.as_str() {
                "Critical" | "Error" => "🔴",
                "Warning" => "🟡",
                _ => "🔵",
            };
            
            writeln!(md, "### {} {} ({})", icon, warning.title, warning.source).unwrap();
            writeln!(md).unwrap();
            writeln!(md, "{}", warning.description).unwrap();
            
            if let Some(ref rec) = warning.recommendation {
                writeln!(md).unwrap();
                writeln!(md, "**Recommendation:** {}", rec).unwrap();
            }
            
            writeln!(md).unwrap();
        }
    }
}

fn write_stack_trace_section(md: &mut String, data: &ReportData) {
    let crash = &data.crash;
    
    if crash.stack_trace.is_empty() {
        return;
    }
    
    writeln!(md, "## Stack Trace").unwrap();
    writeln!(md).unwrap();
    writeln!(md, "```").unwrap();
    
    for frame in &crash.stack_trace {
        let marker = if frame.is_application { "→" } else { " " };
        writeln!(md, "{} [{}] {}", marker, frame.frame_number, frame.method).unwrap();
    }
    
    if crash.stack_trace_truncated {
        writeln!(md, "... (truncated)").unwrap();
    }
    
    writeln!(md, "```").unwrap();
    writeln!(md).unwrap();
}

fn write_impact_section(md: &mut String, data: &ReportData) {
    if let Some(ref analysis) = data.analysis {
        if analysis.affected_features.is_empty() {
            return;
        }
        
        writeln!(md, "## Impact Analysis").unwrap();
        writeln!(md).unwrap();
        
        writeln!(md, "| Feature | Module | Impact | Severity |").unwrap();
        writeln!(md, "|---------|--------|--------|----------|").unwrap();
        
        for feature in &analysis.affected_features {
            writeln!(md, "| {} | {} | {} | {} |", 
                feature.feature, feature.module, feature.impact, feature.severity).unwrap();
        }
        
        writeln!(md).unwrap();
    }
}

fn write_test_section(md: &mut String, data: &ReportData) {
    if let Some(ref analysis) = data.analysis {
        if analysis.test_scenarios.is_empty() {
            return;
        }
        
        writeln!(md, "## Test Scenarios").unwrap();
        writeln!(md).unwrap();
        
        for scenario in &analysis.test_scenarios {
            writeln!(md, "### {} - {} ({})", scenario.id, scenario.name, scenario.priority).unwrap();
            writeln!(md).unwrap();
            
            writeln!(md, "**Steps:**").unwrap();
            for (i, step) in scenario.steps.iter().enumerate() {
                writeln!(md, "{}. {}", i + 1, step).unwrap();
            }
            
            writeln!(md).unwrap();
            writeln!(md, "**Expected:** {}", scenario.expected_result).unwrap();
            writeln!(md).unwrap();
        }
    }
}

fn write_queries_section(md: &mut String, data: &ReportData) {
    if let Some(ref analysis) = data.analysis {
        if analysis.investigation_queries.is_empty() {
            return;
        }
        
        writeln!(md, "## Investigation Queries").unwrap();
        writeln!(md).unwrap();
        
        for query in &analysis.investigation_queries {
            writeln!(md, "### {}", query.name).unwrap();
            writeln!(md).unwrap();
            writeln!(md, "{}", query.description).unwrap();
            writeln!(md).unwrap();
            writeln!(md, "```sql").unwrap();
            writeln!(md, "{}", query.sql.trim()).unwrap();
            writeln!(md, "```").unwrap();
            writeln!(md).unwrap();
        }
    }
}

fn write_pattern_section(md: &mut String, data: &ReportData) {
    if let Some(ref pattern) = data.pattern_match {
        writeln!(md, "## Pattern Match").unwrap();
        writeln!(md).unwrap();
        
        writeln!(md, "This crash matches a known pattern:").unwrap();
        writeln!(md).unwrap();
        writeln!(md, "- **Pattern:** {} ({})", pattern.pattern_name, pattern.pattern_id).unwrap();
        writeln!(md, "- **Confidence:** {:.0}%", pattern.confidence * 100.0).unwrap();
        
        if let Some(ref fixed) = pattern.fixed_in_version {
            writeln!(md, "- **Fixed In:** {}", fixed).unwrap();
        }
        
        if !pattern.tickets.is_empty() {
            writeln!(md, "- **Related Tickets:** {}", pattern.tickets.join(", ")).unwrap();
        }
        
        writeln!(md).unwrap();
    }
}
```

### File: `src/export/generators/mod.rs`

```rust
mod markdown;
mod json;
mod html;
mod pdf;

pub use markdown::generate_markdown;
pub use json::generate_json;
pub use html::generate_html;
pub use pdf::generate_pdf;
```

---

## TASK 4: JSON Generator

### File: `src/export/generators/json.rs`

```rust
use crate::export::report::ReportData;
use serde_json;

/// Generate a JSON export
pub fn generate_json(data: &ReportData, pretty: bool) -> Result<String, serde_json::Error> {
    if pretty {
        serde_json::to_string_pretty(data)
    } else {
        serde_json::to_string(data)
    }
}

/// Generate a minimal JSON export (just the essentials)
pub fn generate_json_minimal(data: &ReportData) -> Result<String, serde_json::Error> {
    #[derive(serde::Serialize)]
    struct MinimalReport {
        report_id: String,
        generated_at: String,
        file_name: String,
        timestamp: Option<String>,
        exception_type: String,
        severity: Option<String>,
        root_cause: Option<String>,
        pattern_id: Option<String>,
        pattern_confidence: Option<f32>,
    }

    let minimal = MinimalReport {
        report_id: data.metadata.report_id.clone(),
        generated_at: data.metadata.generated_at.clone(),
        file_name: data.crash.file_name.clone(),
        timestamp: data.crash.timestamp.clone(),
        exception_type: data.crash.exception_type.clone(),
        severity: data.analysis.as_ref().map(|a| a.severity.clone()),
        root_cause: data.analysis.as_ref().map(|a| a.root_cause_plain.clone()),
        pattern_id: data.pattern_match.as_ref().map(|p| p.pattern_id.clone()),
        pattern_confidence: data.pattern_match.as_ref().map(|p| p.confidence),
    };

    serde_json::to_string_pretty(&minimal)
}
```

---

## TASK 5: HTML Generator

### File: `src/export/generators/html.rs`

```rust
use crate::export::report::{ReportData, ReportAudience};
use minijinja::{Environment, context};

/// Generate an HTML report
pub fn generate_html(data: &ReportData) -> Result<String, minijinja::Error> {
    let mut env = Environment::new();
    env.add_template("report", HTML_TEMPLATE)?;
    
    let template = env.get_template("report")?;
    
    template.render(context! {
        data => data,
        is_technical => data.config.audience == ReportAudience::Technical,
        is_customer => data.config.audience == ReportAudience::Customer,
        branding => &data.config.branding,
    })
}

const HTML_TEMPLATE: &str = r#"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ data.config.title | default("Crash Analysis Report") }}</title>
    <style>
        :root {
            --primary: {{ branding.primary_color }};
            --secondary: {{ branding.secondary_color }};
        }
        
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #1f2937;
            max-width: 1000px;
            margin: 0 auto;
            padding: 2rem;
            background: #f9fafb;
        }
        
        .header {
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: white;
            padding: 2rem;
            border-radius: 12px;
            margin-bottom: 2rem;
        }
        
        .header h1 {
            font-size: 1.75rem;
            margin-bottom: 0.5rem;
        }
        
        .header .meta {
            opacity: 0.9;
            font-size: 0.875rem;
        }
        
        .section {
            background: white;
            border-radius: 8px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .section h2 {
            color: var(--primary);
            font-size: 1.25rem;
            margin-bottom: 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 2px solid #e5e7eb;
        }
        
        .severity-critical { color: #dc2626; }
        .severity-high { color: #ea580c; }
        .severity-medium { color: #ca8a04; }
        .severity-low { color: #16a34a; }
        
        .badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .badge-critical { background: #fef2f2; color: #dc2626; }
        .badge-high { background: #fff7ed; color: #ea580c; }
        .badge-medium { background: #fefce8; color: #ca8a04; }
        .badge-low { background: #f0fdf4; color: #16a34a; }
        
        .warning-box {
            background: #fef3c7;
            border-left: 4px solid #f59e0b;
            padding: 1rem;
            margin: 1rem 0;
            border-radius: 0 8px 8px 0;
        }
        
        .error-box {
            background: #fef2f2;
            border-left: 4px solid #dc2626;
            padding: 1rem;
            margin: 1rem 0;
            border-radius: 0 8px 8px 0;
        }
        
        .info-box {
            background: #eff6ff;
            border-left: 4px solid #3b82f6;
            padding: 1rem;
            margin: 1rem 0;
            border-radius: 0 8px 8px 0;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 1rem 0;
        }
        
        th, td {
            text-align: left;
            padding: 0.75rem;
            border-bottom: 1px solid #e5e7eb;
        }
        
        th {
            background: #f9fafb;
            font-weight: 600;
        }
        
        code {
            background: #f3f4f6;
            padding: 0.125rem 0.375rem;
            border-radius: 4px;
            font-size: 0.875rem;
        }
        
        pre {
            background: #1f2937;
            color: #e5e7eb;
            padding: 1rem;
            border-radius: 8px;
            overflow-x: auto;
            font-size: 0.875rem;
            line-height: 1.5;
        }
        
        pre code {
            background: none;
            padding: 0;
            color: inherit;
        }
        
        .steps {
            counter-reset: step;
        }
        
        .step {
            display: flex;
            gap: 1rem;
            padding: 1rem 0;
            border-bottom: 1px solid #e5e7eb;
        }
        
        .step:last-child {
            border-bottom: none;
        }
        
        .step-number {
            counter-increment: step;
            width: 2rem;
            height: 2rem;
            background: var(--secondary);
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            flex-shrink: 0;
        }
        
        .step.crash-point .step-number {
            background: #dc2626;
        }
        
        .footer {
            text-align: center;
            color: #6b7280;
            font-size: 0.875rem;
            margin-top: 2rem;
            padding-top: 1rem;
            border-top: 1px solid #e5e7eb;
        }
        
        @media print {
            body {
                background: white;
                padding: 0;
            }
            .section {
                box-shadow: none;
                border: 1px solid #e5e7eb;
                break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>{{ data.config.title | default("Crash Analysis Report") }}</h1>
        <div class="meta">
            Generated: {{ data.metadata.generated_at }} | 
            Report ID: {{ data.metadata.report_id }}
        </div>
    </div>

    {% if data.config.sections.summary %}
    <div class="section">
        <h2>Summary</h2>
        <table>
            <tr>
                <th>File</th>
                <td>{{ data.crash.file_name }}</td>
            </tr>
            {% if data.crash.timestamp %}
            <tr>
                <th>Time</th>
                <td>{{ data.crash.timestamp }}</td>
            </tr>
            {% endif %}
            {% if not is_customer and data.crash.site %}
            <tr>
                <th>Site</th>
                <td>{{ data.crash.site }}</td>
            </tr>
            {% endif %}
            {% if data.crash.version %}
            <tr>
                <th>Version</th>
                <td>{{ data.crash.version }}</td>
            </tr>
            {% endif %}
            <tr>
                <th>Error Type</th>
                <td><code>{{ data.crash.exception_type }}</code></td>
            </tr>
            {% if data.analysis %}
            <tr>
                <th>Severity</th>
                <td><span class="badge badge-{{ data.analysis.severity | lower }}">{{ data.analysis.severity }}</span></td>
            </tr>
            {% endif %}
        </table>
        
        {% if data.crash.has_active_transaction %}
        <div class="warning-box">
            ⚠️ <strong>Active Transaction:</strong> Uncommitted changes may have been lost.
        </div>
        {% endif %}
        
        {% if data.analysis and data.analysis.data_at_risk %}
        <div class="error-box">
            🔴 <strong>Data at Risk:</strong> Data integrity may be compromised.
        </div>
        {% endif %}
    </div>
    {% endif %}

    {% if data.config.sections.root_cause and data.analysis %}
    <div class="section">
        <h2>Root Cause</h2>
        <div class="info-box">
            {{ data.analysis.root_cause_plain }}
        </div>
        
        {% if is_technical %}
        <h3 style="margin-top: 1rem; font-size: 1rem;">Technical Details</h3>
        <p>{{ data.analysis.root_cause }}</p>
        
        {% if data.analysis.affected_method %}
        <p><strong>Affected Method:</strong> <code>{{ data.analysis.affected_method }}</code></p>
        {% endif %}
        {% endif %}
    </div>
    {% endif %}

    {% if data.config.sections.reproduction_steps and data.analysis and data.analysis.reproduction_steps %}
    <div class="section">
        <h2>Reproduction Steps</h2>
        <div class="steps">
            {% for step in data.analysis.reproduction_steps %}
            <div class="step {% if step.is_crash_point %}crash-point{% endif %}">
                <div class="step-number">{{ step.step_number }}</div>
                <div>
                    <strong>{{ step.action }}</strong>
                    {% if step.details %}
                    <p style="color: #6b7280; margin-top: 0.25rem;">{{ step.details }}</p>
                    {% endif %}
                    {% if step.is_crash_point %}
                    <span class="badge badge-critical" style="margin-top: 0.5rem;">CRASH POINT</span>
                    {% endif %}
                </div>
            </div>
            {% endfor %}
        </div>
        
        {% if data.analysis.expected_result %}
        <div style="margin-top: 1rem; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div style="background: #f0fdf4; padding: 1rem; border-radius: 8px;">
                <strong style="color: #16a34a;">Expected Result</strong>
                <p>{{ data.analysis.expected_result }}</p>
            </div>
            <div style="background: #fef2f2; padding: 1rem; border-radius: 8px;">
                <strong style="color: #dc2626;">Actual Result</strong>
                <p>{{ data.analysis.actual_result }}</p>
            </div>
        </div>
        {% endif %}
    </div>
    {% endif %}

    {% if data.config.sections.suggested_fix and data.analysis %}
    <div class="section">
        <h2>Suggested Fix</h2>
        <p><strong>{{ data.analysis.fix_summary }}</strong></p>
        
        {% if is_technical and data.analysis.fix_details %}
        <p style="margin-top: 1rem;">{{ data.analysis.fix_details }}</p>
        {% endif %}
        
        {% if is_technical and data.analysis.fix_code_hints %}
        <h3 style="margin-top: 1rem; font-size: 1rem;">Code Changes</h3>
        <ul>
            {% for hint in data.analysis.fix_code_hints %}
            <li><code>{{ hint }}</code></li>
            {% endfor %}
        </ul>
        {% endif %}
        
        {% if data.analysis.workarounds %}
        <h3 style="margin-top: 1rem; font-size: 1rem;">Workarounds</h3>
        <ul>
            {% for workaround in data.analysis.workarounds %}
            <li>{{ workaround }}</li>
            {% endfor %}
        </ul>
        {% endif %}
    </div>
    {% endif %}

    {% if data.config.sections.stack_trace and data.crash.stack_trace %}
    <div class="section">
        <h2>Stack Trace</h2>
        <pre><code>{% for frame in data.crash.stack_trace %}
[{{ frame.frame_number }}] {{ frame.method }}{% endfor %}
{% if data.crash.stack_trace_truncated %}... (truncated){% endif %}</code></pre>
    </div>
    {% endif %}

    {% if data.config.sections.pattern_match and data.pattern_match %}
    <div class="section">
        <h2>Pattern Match</h2>
        <div class="info-box">
            <strong>Known Issue:</strong> {{ data.pattern_match.pattern_name }}
            <br>
            <small>Pattern ID: {{ data.pattern_match.pattern_id }} | Confidence: {{ (data.pattern_match.confidence * 100) | round }}%</small>
        </div>
        
        {% if data.pattern_match.fixed_in_version %}
        <p><strong>Fixed in version:</strong> {{ data.pattern_match.fixed_in_version }}</p>
        {% endif %}
        
        {% if data.pattern_match.tickets %}
        <p><strong>Related tickets:</strong> {{ data.pattern_match.tickets | join(", ") }}</p>
        {% endif %}
    </div>
    {% endif %}

    {% if branding.footer_text %}
    <div class="footer">
        {{ branding.footer_text }}
    </div>
    {% endif %}
</body>
</html>
"#;
```

---

## TASK 6: PDF Generator

### File: `src/export/generators/pdf.rs`

```rust
use crate::export::report::ReportData;
use crate::export::generators::html::generate_html;
use printpdf::*;
use std::io::BufWriter;
use std::fs::File;

/// Generate a PDF report
/// 
/// This uses a simple approach: generate HTML first, then convert key sections to PDF.
/// For full HTML-to-PDF, consider using a headless browser or wkhtmltopdf.
pub fn generate_pdf(data: &ReportData, output_path: &str) -> Result<(), PdfError> {
    let (doc, page1, layer1) = PdfDocument::new(
        data.config.title.as_deref().unwrap_or("Crash Analysis Report"),
        Mm(210.0),  // A4 width
        Mm(297.0),  // A4 height
        "Layer 1"
    );
    
    let font = doc.add_builtin_font(BuiltinFont::Helvetica)?;
    let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold)?;
    
    let current_layer = doc.get_page(page1).get_layer(layer1);
    
    let mut y_position = Mm(280.0);
    let margin_left = Mm(20.0);
    let line_height = Mm(5.0);
    
    // Title
    current_layer.use_text(
        data.config.title.as_deref().unwrap_or("Crash Analysis Report"),
        18.0,
        margin_left,
        y_position,
        &font_bold
    );
    y_position -= Mm(10.0);
    
    // Metadata
    current_layer.use_text(
        &format!("Generated: {} | Report ID: {}", 
            data.metadata.generated_at, 
            data.metadata.report_id),
        9.0,
        margin_left,
        y_position,
        &font
    );
    y_position -= Mm(15.0);
    
    // Summary section
    current_layer.use_text("Summary", 14.0, margin_left, y_position, &font_bold);
    y_position -= Mm(8.0);
    
    let summary_lines = vec![
        format!("File: {}", data.crash.file_name),
        format!("Exception: {}", data.crash.exception_type),
        format!("Site: {}", data.crash.site.as_deref().unwrap_or("N/A")),
        format!("Version: {}", data.crash.version.as_deref().unwrap_or("N/A")),
    ];
    
    for line in summary_lines {
        current_layer.use_text(&line, 10.0, margin_left, y_position, &font);
        y_position -= line_height;
    }
    
    y_position -= Mm(10.0);
    
    // Root Cause section
    if let Some(ref analysis) = data.analysis {
        current_layer.use_text("Root Cause", 14.0, margin_left, y_position, &font_bold);
        y_position -= Mm(8.0);
        
        // Wrap long text
        let root_cause = &analysis.root_cause_plain;
        for line in wrap_text(root_cause, 80) {
            current_layer.use_text(&line, 10.0, margin_left, y_position, &font);
            y_position -= line_height;
        }
        
        y_position -= Mm(10.0);
        
        // Severity
        current_layer.use_text(
            &format!("Severity: {}", analysis.severity),
            10.0,
            margin_left,
            y_position,
            &font_bold
        );
        y_position -= Mm(10.0);
        
        // Fix Summary
        current_layer.use_text("Suggested Fix", 14.0, margin_left, y_position, &font_bold);
        y_position -= Mm(8.0);
        
        for line in wrap_text(&analysis.fix_summary, 80) {
            current_layer.use_text(&line, 10.0, margin_left, y_position, &font);
            y_position -= line_height;
        }
    }
    
    // Pattern match
    if let Some(ref pattern) = data.pattern_match {
        y_position -= Mm(10.0);
        current_layer.use_text("Pattern Match", 14.0, margin_left, y_position, &font_bold);
        y_position -= Mm(8.0);
        
        current_layer.use_text(
            &format!("{} ({}% confidence)", 
                pattern.pattern_name, 
                (pattern.confidence * 100.0) as i32),
            10.0,
            margin_left,
            y_position,
            &font
        );
    }
    
    // Save PDF
    let file = File::create(output_path)
        .map_err(|e| PdfError::Io(e))?;
    doc.save(&mut BufWriter::new(file))?;
    
    Ok(())
}

/// Simple text wrapping
fn wrap_text(text: &str, max_chars: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current_line = String::new();
    
    for word in text.split_whitespace() {
        if current_line.len() + word.len() + 1 > max_chars {
            if !current_line.is_empty() {
                lines.push(current_line);
                current_line = String::new();
            }
        }
        if !current_line.is_empty() {
            current_line.push(' ');
        }
        current_line.push_str(word);
    }
    
    if !current_line.is_empty() {
        lines.push(current_line);
    }
    
    lines
}

#[derive(Debug)]
pub enum PdfError {
    Io(std::io::Error),
    PrintPdf(printpdf::Error),
}

impl From<printpdf::Error> for PdfError {
    fn from(e: printpdf::Error) -> Self {
        PdfError::PrintPdf(e)
    }
}

impl std::fmt::Display for PdfError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PdfError::Io(e) => write!(f, "IO error: {}", e),
            PdfError::PrintPdf(e) => write!(f, "PDF error: {:?}", e),
        }
    }
}

impl std::error::Error for PdfError {}
```

---

## TASK 7: Module Integration

### File: `src/export/mod.rs`

```rust
mod report;
mod generators;
mod sanitizer;

pub use report::*;
pub use generators::*;
pub use sanitizer::*;

use crate::models::{CrashFile, AnalysisResult};
use crate::patterns::PatternMatchResult;
use std::path::Path;

/// High-level export function
pub fn export_report(
    crash: &CrashFile,
    analysis: Option<&AnalysisResult>,
    pattern: Option<&PatternMatchResult>,
    config: ReportConfig,
    format: ExportFormat,
    output_path: &Path,
) -> Result<(), ExportError> {
    let data = ReportData::from_crash(crash, analysis, pattern, config);
    
    match format {
        ExportFormat::Markdown => {
            let content = generate_markdown(&data);
            std::fs::write(output_path, content)?;
        }
        ExportFormat::Html => {
            let content = generate_html(&data)?;
            std::fs::write(output_path, content)?;
        }
        ExportFormat::Json => {
            let content = generate_json(&data, true)?;
            std::fs::write(output_path, content)?;
        }
        ExportFormat::JsonMinimal => {
            let content = generate_json_minimal(&data)?;
            std::fs::write(output_path, content)?;
        }
        ExportFormat::Pdf => {
            generate_pdf(&data, output_path.to_str().unwrap())?;
        }
    }
    
    Ok(())
}

#[derive(Debug, Clone, Copy)]
pub enum ExportFormat {
    Markdown,
    Html,
    Json,
    JsonMinimal,
    Pdf,
}

#[derive(Debug)]
pub enum ExportError {
    Io(std::io::Error),
    Template(minijinja::Error),
    Json(serde_json::Error),
    Pdf(generators::pdf::PdfError),
}

impl From<std::io::Error> for ExportError {
    fn from(e: std::io::Error) -> Self {
        ExportError::Io(e)
    }
}

impl From<minijinja::Error> for ExportError {
    fn from(e: minijinja::Error) -> Self {
        ExportError::Template(e)
    }
}

impl From<serde_json::Error> for ExportError {
    fn from(e: serde_json::Error) -> Self {
        ExportError::Json(e)
    }
}

impl From<generators::pdf::PdfError> for ExportError {
    fn from(e: generators::pdf::PdfError) -> Self {
        ExportError::Pdf(e)
    }
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExportError::Io(e) => write!(f, "IO error: {}", e),
            ExportError::Template(e) => write!(f, "Template error: {}", e),
            ExportError::Json(e) => write!(f, "JSON error: {}", e),
            ExportError::Pdf(e) => write!(f, "PDF error: {}", e),
        }
    }
}

impl std::error::Error for ExportError {}
```

---

## TASK 8: Tauri Commands

### File: `src/commands/export_commands.rs`

```rust
use crate::export::{
    ReportConfig, ReportData, ReportAudience, ReportSections, ExportFormat,
    export_report, generate_markdown, generate_html, generate_json,
};
use crate::models::{CrashFile, AnalysisResult};
use crate::patterns::PatternMatchResult;
use tauri::api::dialog;

#[tauri::command]
pub async fn export_crash_report(
    crash: CrashFile,
    analysis: Option<AnalysisResult>,
    pattern: Option<PatternMatchResult>,
    format: String,
    audience: String,
    output_path: String,
) -> Result<(), String> {
    let format = match format.as_str() {
        "markdown" | "md" => ExportFormat::Markdown,
        "html" => ExportFormat::Html,
        "json" => ExportFormat::Json,
        "json_minimal" => ExportFormat::JsonMinimal,
        "pdf" => ExportFormat::Pdf,
        _ => return Err(format!("Unknown format: {}", format)),
    };
    
    let audience = match audience.as_str() {
        "technical" => ReportAudience::Technical,
        "support" => ReportAudience::Support,
        "customer" => ReportAudience::Customer,
        "executive" => ReportAudience::Executive,
        _ => ReportAudience::Technical,
    };
    
    let config = ReportConfig {
        audience,
        sections: match audience {
            ReportAudience::Customer => ReportSections::customer_safe(),
            ReportAudience::Executive => ReportSections::summary_only(),
            _ => ReportSections::all(),
        },
        ..Default::default()
    };
    
    export_report(
        &crash,
        analysis.as_ref(),
        pattern.as_ref(),
        config,
        format,
        std::path::Path::new(&output_path),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn generate_markdown_preview(
    crash: CrashFile,
    analysis: Option<AnalysisResult>,
    pattern: Option<PatternMatchResult>,
    audience: String,
) -> Result<String, String> {
    let audience = match audience.as_str() {
        "technical" => ReportAudience::Technical,
        "support" => ReportAudience::Support,
        "customer" => ReportAudience::Customer,
        "executive" => ReportAudience::Executive,
        _ => ReportAudience::Technical,
    };
    
    let config = ReportConfig {
        audience,
        sections: match audience {
            ReportAudience::Customer => ReportSections::customer_safe(),
            ReportAudience::Executive => ReportSections::summary_only(),
            _ => ReportSections::all(),
        },
        ..Default::default()
    };
    
    let data = ReportData::from_crash(&crash, analysis.as_ref(), pattern.as_ref(), config);
    Ok(generate_markdown(&data))
}

#[tauri::command]
pub fn generate_html_preview(
    crash: CrashFile,
    analysis: Option<AnalysisResult>,
    pattern: Option<PatternMatchResult>,
    audience: String,
) -> Result<String, String> {
    let audience = match audience.as_str() {
        "technical" => ReportAudience::Technical,
        "support" => ReportAudience::Support,
        "customer" => ReportAudience::Customer,
        "executive" => ReportAudience::Executive,
        _ => ReportAudience::Technical,
    };
    
    let config = ReportConfig {
        audience,
        sections: match audience {
            ReportAudience::Customer => ReportSections::customer_safe(),
            ReportAudience::Executive => ReportSections::summary_only(),
            _ => ReportSections::all(),
        },
        ..Default::default()
    };
    
    let data = ReportData::from_crash(&crash, analysis.as_ref(), pattern.as_ref(), config);
    generate_html(&data).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_with_dialog(
    crash: CrashFile,
    analysis: Option<AnalysisResult>,
    pattern: Option<PatternMatchResult>,
    format: String,
    audience: String,
    window: tauri::Window,
) -> Result<Option<String>, String> {
    let extension = match format.as_str() {
        "markdown" | "md" => "md",
        "html" => "html",
        "json" | "json_minimal" => "json",
        "pdf" => "pdf",
        _ => "txt",
    };
    
    let default_name = format!(
        "crash_report_{}.{}",
        chrono::Utc::now().format("%Y%m%d_%H%M%S"),
        extension
    );
    
    // Use Tauri's save dialog
    let file_path = dialog::blocking::FileDialogBuilder::new()
        .set_file_name(&default_name)
        .add_filter("Report", &[extension])
        .save_file();
    
    match file_path {
        Some(path) => {
            let path_str = path.to_string_lossy().to_string();
            export_crash_report(crash, analysis, pattern, format, audience, path_str.clone())
                .await?;
            Ok(Some(path_str))
        }
        None => Ok(None),
    }
}
```

---

## Verification Checklist

After implementing, verify:

- [ ] `cargo build` succeeds
- [ ] Markdown generation produces valid Markdown
- [ ] HTML generation produces valid, styled HTML
- [ ] JSON export includes all expected fields
- [ ] PDF generation creates readable documents
- [ ] Customer reports don't contain sensitive data
- [ ] Technical reports include all details
- [ ] Sanitizer correctly redacts sensitive info

---

## Notes for Claude Code

1. **Template engine** - minijinja is similar to Jinja2, lightweight
2. **PDF is basic** - For production, consider wkhtmltopdf or headless Chrome
3. **Audience matters** - Customer reports must be sanitized
4. **HTML is self-contained** - CSS is embedded, no external dependencies
5. **Export is async** - File operations should not block UI
6. **Preview vs Export** - Preview returns string, export writes to file
