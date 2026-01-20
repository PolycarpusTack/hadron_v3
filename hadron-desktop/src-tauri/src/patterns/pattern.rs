use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A crash pattern definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrashPattern {
    /// Unique identifier for this pattern
    pub id: String,

    /// Human-readable name
    pub name: String,

    /// Detailed description of the crash
    pub description: String,

    /// Category for grouping
    pub category: PatternCategory,

    /// Conditions that must match for this pattern
    pub matchers: PatternMatchers,

    /// Pre-defined analysis results
    pub analysis: PatternAnalysis,

    /// Version information
    pub versioning: PatternVersioning,

    /// Priority for matching (higher = checked first)
    #[serde(default = "default_priority")]
    pub priority: u32,

    /// Is this pattern enabled?
    #[serde(default = "default_enabled")]
    pub enabled: bool,

    /// Tags for filtering
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_priority() -> u32 {
    50
}
fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PatternCategory {
    /// Collection/array access errors
    CollectionError,
    /// Null/nil reference errors
    NullReference,
    /// Database connectivity/query errors
    DatabaseError,
    /// Type mismatch/casting errors
    TypeError,
    /// Memory/resource errors
    MemoryError,
    /// Concurrency/threading errors
    ConcurrencyError,
    /// Business logic errors
    BusinessLogic,
    /// Configuration/environment errors
    Configuration,
    /// WHATS'ON specific patterns
    WhatsOnSpecific,
    /// Other/uncategorized
    Other,
}

/// Conditions for matching a crash
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PatternMatchers {
    /// Exception type must match (regex)
    #[serde(default)]
    pub exception_type: Option<String>,

    /// Exception message must contain (substring or regex)
    #[serde(default)]
    pub exception_message: Option<StringMatcher>,

    /// Exception parameter must match
    #[serde(default)]
    pub exception_parameter: Option<StringMatcher>,

    /// Stack trace must contain these methods (in order)
    #[serde(default)]
    pub stack_contains: Vec<String>,

    /// Stack trace must contain at least one of these
    #[serde(default)]
    pub stack_contains_any: Vec<String>,

    /// Stack trace must NOT contain these
    #[serde(default)]
    pub stack_excludes: Vec<String>,

    /// Top N frames must include this method
    #[serde(default)]
    pub stack_top_n: Option<StackTopMatcher>,

    /// Context/receiver conditions
    #[serde(default)]
    pub context: Option<ContextMatcher>,

    /// Database state conditions
    #[serde(default)]
    pub database: Option<DatabaseMatcher>,

    /// Environment conditions
    #[serde(default)]
    pub environment: Option<EnvironmentMatcher>,

    /// Custom matcher expressions
    #[serde(default)]
    pub custom: Vec<CustomMatcher>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StringMatcher {
    /// Exact match
    Exact(String),
    /// Contains substring
    Contains { contains: String },
    /// Regex match
    Regex { regex: String },
    /// One of these values
    OneOf { one_of: Vec<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackTopMatcher {
    /// How many frames from top to check
    pub n: usize,
    /// Method pattern to find
    pub contains: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContextMatcher {
    /// Receiver class must match
    #[serde(default)]
    pub receiver_class: Option<StringMatcher>,

    /// Receiver must be a collection
    #[serde(default)]
    pub receiver_is_collection: Option<bool>,

    /// Collection size condition
    #[serde(default)]
    pub collection_size: Option<SizeCondition>,

    /// Must have these business objects
    #[serde(default)]
    pub has_business_objects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SizeCondition {
    Equals(usize),
    LessThan(usize),
    GreaterThan(usize),
    Empty,
    NotEmpty,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DatabaseMatcher {
    /// Must have active transaction
    #[serde(default)]
    pub has_active_transaction: Option<bool>,

    /// Database backend must match
    #[serde(default)]
    pub backend: Option<String>,

    /// Error message pattern
    #[serde(default)]
    pub error_contains: Option<String>,

    /// Prepared statement pattern
    #[serde(default)]
    pub prepared_statement: Option<StringMatcher>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EnvironmentMatcher {
    /// Site must match
    #[serde(default)]
    pub site: Option<StringMatcher>,

    /// Version must match (semver range)
    #[serde(default)]
    pub version_range: Option<String>,

    /// Must be on Citrix
    #[serde(default)]
    pub is_citrix: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomMatcher {
    /// Field path (e.g., "context.receiver.collection_size")
    pub field: String,
    /// Condition to check
    pub condition: CustomCondition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CustomCondition {
    Equals(serde_json::Value),
    NotEquals(serde_json::Value),
    Contains(String),
    Matches(String),
    Exists,
    NotExists,
    GreaterThan(f64),
    LessThan(f64),
}

/// Pre-computed analysis for matched patterns
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatternAnalysis {
    /// Root cause explanation (technical)
    pub root_cause: String,

    /// Plain English explanation
    pub root_cause_plain: String,

    /// Severity level
    pub severity: Severity,

    /// Is data at risk?
    #[serde(default)]
    pub data_at_risk: bool,

    /// Suggested fix summary
    pub fix_summary: String,

    /// Detailed fix explanation
    #[serde(default)]
    pub fix_details: Option<String>,

    /// Code-level fix hints
    #[serde(default)]
    pub fix_code_hints: Vec<String>,

    /// Workarounds users can try
    #[serde(default)]
    pub workarounds: Vec<String>,

    /// Affected features/modules
    #[serde(default)]
    pub affected_features: Vec<String>,

    /// Recommended test scenarios
    #[serde(default)]
    pub test_scenarios: Vec<TestScenario>,

    /// Related documentation links
    #[serde(default)]
    pub documentation_links: Vec<String>,

    /// SQL queries to investigate
    #[serde(default)]
    pub investigation_queries: Vec<InvestigationQuery>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestScenario {
    pub id: String,
    pub name: String,
    pub priority: String,
    pub steps: Vec<String>,
    pub expected_result: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvestigationQuery {
    pub name: String,
    pub description: String,
    pub sql: String,
}

/// Version tracking for patterns
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PatternVersioning {
    /// First version where this bug appeared (if known)
    #[serde(default)]
    pub introduced_in: Option<String>,

    /// Version where this was fixed (if fixed)
    #[serde(default)]
    pub fixed_in: Option<String>,

    /// Related Jira tickets
    #[serde(default)]
    pub tickets: Vec<String>,

    /// Pattern definition version (for updates)
    #[serde(default = "default_pattern_version")]
    pub pattern_version: String,

    /// When this pattern was last updated
    #[serde(default)]
    pub last_updated: Option<String>,
}

fn default_pattern_version() -> String {
    "1.0.0".to_string()
}

/// Result of pattern matching
#[derive(Debug, Clone, Serialize)]
pub struct PatternMatchResult {
    /// The matched pattern
    pub pattern: CrashPattern,

    /// Confidence score (0.0 - 1.0)
    pub confidence: f32,

    /// Which matchers succeeded
    pub matched_conditions: Vec<String>,

    /// Additional context from matching
    pub match_context: HashMap<String, String>,

    /// Is this pattern still applicable (not fixed)?
    pub is_applicable: bool,

    /// If fixed, in which version
    pub fixed_in_version: Option<String>,
}
