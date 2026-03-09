use crate::models::CrashFile;
use crate::patterns::PatternMatchResult;
use serde::{Deserialize, Serialize};

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
            environment: false, // May contain sensitive info
            exception_details: false,
            root_cause: true, // Plain English only
            reproduction_steps: true,
            suggested_fix: false, // Internal only
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

#[derive(Debug, Clone, Serialize)]
pub struct PatternMatchSummary {
    pub pattern_id: String,
    pub pattern_name: String,
    pub confidence: f32,
    pub is_known_issue: bool,
    pub fixed_in_version: Option<String>,
    pub tickets: Vec<String>,
    pub root_cause: String,
    pub root_cause_plain: String,
    pub severity: String,
    pub fix_summary: String,
    pub workarounds: Vec<String>,
}

impl ReportData {
    /// Create report data from crash file and optional pattern match
    pub fn from_crash(
        crash: &CrashFile,
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

        let stack_trace: Vec<_> = crash
            .stack_trace
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
        let memory_warning = crash
            .memory
            .old
            .as_ref()
            .filter(|m| m.percent_used > 90.0)
            .map(|m| format!("Old space at {:.1}% capacity", m.percent_used))
            .or_else(|| {
                crash
                    .memory
                    .perm
                    .as_ref()
                    .filter(|m| m.percent_used >= 100.0)
                    .map(|_| "Permanent space at 100% (expected for running system)".to_string())
            });

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
            timestamp: crash
                .header
                .timestamp
                .map(|t| t.format(&config.date_format).to_string()),
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
            open_windows: crash
                .windows
                .iter()
                .map(|w| WindowSummary {
                    title: w.title.clone(),
                    model: w.model.clone(),
                })
                .collect(),
            has_active_transaction: crash.database.has_active_transaction,
            memory_warning,
            database_backend,
        }
    }

    fn summarize_pattern(pattern: &PatternMatchResult) -> PatternMatchSummary {
        PatternMatchSummary {
            pattern_id: pattern.pattern.id.clone(),
            pattern_name: pattern.pattern.name.clone(),
            confidence: pattern.confidence,
            is_known_issue: !pattern.pattern.versioning.tickets.is_empty(),
            fixed_in_version: pattern.fixed_in_version.clone(),
            tickets: pattern.pattern.versioning.tickets.clone(),
            root_cause: pattern.pattern.analysis.root_cause.clone(),
            root_cause_plain: pattern.pattern.analysis.root_cause_plain.clone(),
            severity: format!("{:?}", pattern.pattern.analysis.severity),
            fix_summary: pattern.pattern.analysis.fix_summary.clone(),
            workarounds: pattern.pattern.analysis.workarounds.clone(),
        }
    }
}

/// A named section for generic (non-crash) reports
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenericSection {
    pub id: String,
    pub label: String,
    pub content: String,
}

/// Report data for non-crash exports (code, sentry, jira)
#[derive(Debug, Clone, Serialize)]
pub struct GenericReportData {
    pub metadata: ReportMetadata,
    pub source_type: String,
    pub source_name: String,
    pub title: String,
    pub sections: Vec<GenericSection>,
    pub audience: ReportAudience,
    pub footer_text: Option<String>,
}

impl GenericReportData {
    pub fn new(
        source_type: String,
        source_name: String,
        title: String,
        sections: Vec<GenericSection>,
        audience: ReportAudience,
        footer_text: Option<String>,
    ) -> Self {
        Self {
            metadata: ReportMetadata {
                generated_at: chrono::Utc::now()
                    .format("%Y-%m-%d %H:%M:%S")
                    .to_string(),
                generator_version: env!("CARGO_PKG_VERSION").to_string(),
                report_id: uuid::Uuid::new_v4().to_string(),
            },
            source_type,
            source_name,
            title,
            sections,
            audience,
            footer_text,
        }
    }
}
