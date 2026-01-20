# CLAUDE CODE INSTRUCTION: Known Crash Patterns Library

## Context

You are implementing a rule-based crash pattern detection system for the WHATS'ON Crash Analyzer. This system identifies known crash types without requiring AI, enabling instant recognition and providing pre-defined fix recommendations.

This complements the AI analysis by:
1. Instantly matching known issues (no API latency/cost)
2. Working offline
3. Providing consistent responses for documented bugs
4. Enabling pattern versioning (fixed in version X)

## Project Structure

Create this structure:
```
src/
├── patterns/
│   ├── mod.rs
│   ├── engine.rs           # Pattern matching engine
│   ├── pattern.rs          # Pattern definition structs
│   ├── matchers/
│   │   ├── mod.rs
│   │   ├── exception.rs    # Exception-based matchers
│   │   ├── stack.rs        # Stack trace matchers
│   │   ├── context.rs      # Context/data matchers
│   │   └── database.rs     # Database error matchers
│   └── library/
│       ├── mod.rs
│       ├── loader.rs       # Load patterns from files
│       └── builtin.rs      # Built-in patterns
├── data/
│   └── patterns/           # Pattern definition files
│       ├── collection_errors.toml
│       ├── database_errors.toml
│       ├── null_errors.toml
│       └── whats_on_specific.toml
```

## Dependencies

Add to `Cargo.toml`:
```toml
[dependencies]
# Existing deps...
toml = "0.8"
glob = "0.3"
semver = "1.0"
```

---

## TASK 1: Define Pattern Data Structures

### File: `src/patterns/pattern.rs`

```rust
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

fn default_priority() -> u32 { 50 }
fn default_enabled() -> bool { true }

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

fn default_pattern_version() -> String { "1.0.0".to_string() }

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
```

---

## TASK 2: Implement Matcher Functions

### File: `src/patterns/matchers/mod.rs`

```rust
mod exception;
mod stack;
mod context;
mod database;

pub use exception::*;
pub use stack::*;
pub use context::*;
pub use database::*;

use crate::models::CrashFile;
use crate::patterns::pattern::{PatternMatchers, StringMatcher};
use regex::Regex;

/// Check if a string matcher matches a value
pub fn check_string_matcher(matcher: &StringMatcher, value: &str) -> bool {
    match matcher {
        StringMatcher::Exact(expected) => value == expected,
        StringMatcher::Contains { contains } => value.contains(contains),
        StringMatcher::Regex { regex } => {
            Regex::new(regex)
                .map(|re| re.is_match(value))
                .unwrap_or(false)
        }
        StringMatcher::OneOf { one_of } => one_of.iter().any(|s| value == s),
    }
}

/// Main matching function - checks all conditions
pub fn matches_pattern(crash: &CrashFile, matchers: &PatternMatchers) -> (bool, Vec<String>, f32) {
    let mut matched = Vec::new();
    let mut failed = Vec::new();
    let mut total_weight = 0.0f32;
    let mut matched_weight = 0.0f32;

    // Exception type (weight: 30%)
    if let Some(ref pattern) = matchers.exception_type {
        total_weight += 0.30;
        if exception::matches_exception_type(crash, pattern) {
            matched.push("exception_type".to_string());
            matched_weight += 0.30;
        } else {
            failed.push("exception_type");
        }
    }

    // Exception message (weight: 10%)
    if let Some(ref matcher) = matchers.exception_message {
        total_weight += 0.10;
        if exception::matches_exception_message(crash, matcher) {
            matched.push("exception_message".to_string());
            matched_weight += 0.10;
        } else {
            failed.push("exception_message");
        }
    }

    // Stack contains (weight: 25%)
    if !matchers.stack_contains.is_empty() {
        total_weight += 0.25;
        if stack::matches_stack_contains(crash, &matchers.stack_contains) {
            matched.push(format!("stack_contains: {:?}", matchers.stack_contains));
            matched_weight += 0.25;
        } else {
            failed.push("stack_contains");
        }
    }

    // Stack contains any (weight: 15%)
    if !matchers.stack_contains_any.is_empty() {
        total_weight += 0.15;
        if stack::matches_stack_contains_any(crash, &matchers.stack_contains_any) {
            matched.push("stack_contains_any".to_string());
            matched_weight += 0.15;
        } else {
            failed.push("stack_contains_any");
        }
    }

    // Stack excludes (weight: 10%)
    if !matchers.stack_excludes.is_empty() {
        total_weight += 0.10;
        if stack::matches_stack_excludes(crash, &matchers.stack_excludes) {
            matched.push("stack_excludes".to_string());
            matched_weight += 0.10;
        } else {
            failed.push("stack_excludes");
        }
    }

    // Stack top N (weight: 20%)
    if let Some(ref top_matcher) = matchers.stack_top_n {
        total_weight += 0.20;
        if stack::matches_stack_top_n(crash, top_matcher) {
            matched.push(format!("stack_top_{}", top_matcher.n));
            matched_weight += 0.20;
        } else {
            failed.push("stack_top_n");
        }
    }

    // Context (weight: 15%)
    if let Some(ref ctx_matcher) = matchers.context {
        total_weight += 0.15;
        if context::matches_context(crash, ctx_matcher) {
            matched.push("context".to_string());
            matched_weight += 0.15;
        } else {
            failed.push("context");
        }
    }

    // Database (weight: 15%)
    if let Some(ref db_matcher) = matchers.database {
        total_weight += 0.15;
        if database::matches_database(crash, db_matcher) {
            matched.push("database".to_string());
            matched_weight += 0.15;
        } else {
            failed.push("database");
        }
    }

    // Calculate confidence
    let confidence = if total_weight > 0.0 {
        matched_weight / total_weight
    } else {
        0.0
    };

    // Pattern matches if no required conditions failed
    // (all specified conditions must pass)
    let matches = failed.is_empty() && !matched.is_empty();

    (matches, matched, confidence)
}
```

### File: `src/patterns/matchers/exception.rs`

```rust
use crate::models::CrashFile;
use crate::patterns::pattern::StringMatcher;
use crate::patterns::matchers::check_string_matcher;
use regex::Regex;

/// Check if exception type matches pattern
pub fn matches_exception_type(crash: &CrashFile, pattern: &str) -> bool {
    let exception_type = &crash.exception.exception_type;
    
    // Try regex match first
    if let Ok(re) = Regex::new(pattern) {
        if re.is_match(exception_type) {
            return true;
        }
    }
    
    // Fallback to substring match
    exception_type.contains(pattern)
}

/// Check if exception message matches
pub fn matches_exception_message(crash: &CrashFile, matcher: &StringMatcher) -> bool {
    let message = &crash.exception.message;
    check_string_matcher(matcher, message)
}

/// Check if exception parameter matches
pub fn matches_exception_parameter(crash: &CrashFile, matcher: &StringMatcher) -> bool {
    if let Some(ref param) = crash.exception.parameter {
        check_string_matcher(matcher, param)
    } else {
        false
    }
}

/// Check if parameter is a number exceeding a threshold
pub fn parameter_exceeds(crash: &CrashFile, threshold: usize) -> bool {
    crash.exception.parameter
        .as_ref()
        .and_then(|p| p.parse::<usize>().ok())
        .map(|n| n > threshold)
        .unwrap_or(false)
}
```

### File: `src/patterns/matchers/stack.rs`

```rust
use crate::models::CrashFile;
use crate::patterns::pattern::StackTopMatcher;

/// Check if stack contains all specified methods (in order)
pub fn matches_stack_contains(crash: &CrashFile, methods: &[String]) -> bool {
    if methods.is_empty() {
        return true;
    }

    let stack_text: String = crash.stack_trace
        .iter()
        .map(|f| f.method_signature.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    // All methods must appear, in order
    let mut last_pos = 0;
    for method in methods {
        if let Some(pos) = stack_text[last_pos..].find(method) {
            last_pos += pos + method.len();
        } else {
            return false;
        }
    }

    true
}

/// Check if stack contains at least one of the methods
pub fn matches_stack_contains_any(crash: &CrashFile, methods: &[String]) -> bool {
    if methods.is_empty() {
        return true;
    }

    crash.stack_trace.iter().any(|frame| {
        methods.iter().any(|m| frame.method_signature.contains(m))
    })
}

/// Check that stack does NOT contain any of these methods
pub fn matches_stack_excludes(crash: &CrashFile, methods: &[String]) -> bool {
    if methods.is_empty() {
        return true;
    }

    !crash.stack_trace.iter().any(|frame| {
        methods.iter().any(|m| frame.method_signature.contains(m))
    })
}

/// Check if top N frames contain a specific method
pub fn matches_stack_top_n(crash: &CrashFile, matcher: &StackTopMatcher) -> bool {
    crash.stack_trace
        .iter()
        .take(matcher.n)
        .any(|frame| frame.method_signature.contains(&matcher.contains))
}

/// Get the first application-level frame
pub fn get_first_application_frame(crash: &CrashFile) -> Option<&crate::models::StackFrame> {
    use crate::models::FrameType;
    crash.stack_trace
        .iter()
        .find(|f| matches!(f.frame_type, FrameType::Application))
}

/// Check if a specific class appears in application frames
pub fn application_frame_has_class(crash: &CrashFile, class_pattern: &str) -> bool {
    use crate::models::FrameType;
    crash.stack_trace.iter()
        .filter(|f| matches!(f.frame_type, FrameType::Application))
        .any(|f| {
            f.class_name.as_ref().map(|c| c.contains(class_pattern)).unwrap_or(false) ||
            f.method_signature.contains(class_pattern)
        })
}
```

### File: `src/patterns/matchers/context.rs`

```rust
use crate::models::CrashFile;
use crate::patterns::pattern::{ContextMatcher, SizeCondition, StringMatcher};
use crate::patterns::matchers::check_string_matcher;

/// Check if context matches all conditions
pub fn matches_context(crash: &CrashFile, matcher: &ContextMatcher) -> bool {
    let context = match &crash.context {
        Some(ctx) => ctx,
        None => return false,
    };

    // Check receiver class
    if let Some(ref class_matcher) = matcher.receiver_class {
        let matches = context.receiver
            .as_ref()
            .map(|r| check_string_matcher(class_matcher, &r.class_name))
            .unwrap_or(false);
        if !matches {
            return false;
        }
    }

    // Check if receiver is collection
    if let Some(should_be_collection) = matcher.receiver_is_collection {
        let is_collection = context.receiver
            .as_ref()
            .map(|r| r.is_collection)
            .unwrap_or(false);
        if is_collection != should_be_collection {
            return false;
        }
    }

    // Check collection size
    if let Some(ref size_cond) = matcher.collection_size {
        let size = context.receiver
            .as_ref()
            .and_then(|r| r.collection_size);
        
        let matches = match (size, size_cond) {
            (Some(s), SizeCondition::Equals(n)) => s == *n,
            (Some(s), SizeCondition::LessThan(n)) => s < *n,
            (Some(s), SizeCondition::GreaterThan(n)) => s > *n,
            (Some(s), SizeCondition::Empty) => s == 0,
            (Some(s), SizeCondition::NotEmpty) => s > 0,
            (None, _) => false,
        };
        
        if !matches {
            return false;
        }
    }

    // Check for required business objects
    if !matcher.has_business_objects.is_empty() {
        let has_all = matcher.has_business_objects.iter().all(|required| {
            context.business_objects.iter().any(|obj| {
                obj.class_name.contains(required)
            })
        });
        if !has_all {
            return false;
        }
    }

    true
}

/// Extract collection size mismatch info
pub fn get_collection_mismatch(crash: &CrashFile) -> Option<(usize, usize)> {
    let context = crash.context.as_ref()?;
    let receiver = context.receiver.as_ref()?;
    
    if !receiver.is_collection {
        return None;
    }

    let size = receiver.collection_size?;
    let requested_index = crash.exception.parameter
        .as_ref()
        .and_then(|p| p.parse::<usize>().ok())?;

    if requested_index > size {
        Some((size, requested_index))
    } else {
        None
    }
}
```

### File: `src/patterns/matchers/database.rs`

```rust
use crate::models::CrashFile;
use crate::patterns::pattern::{DatabaseMatcher, StringMatcher};
use crate::patterns::matchers::check_string_matcher;

/// Check if database state matches conditions
pub fn matches_database(crash: &CrashFile, matcher: &DatabaseMatcher) -> bool {
    let db = &crash.database;

    // Check active transaction
    if let Some(should_have) = matcher.has_active_transaction {
        if db.has_active_transaction != should_have {
            return false;
        }
    }

    // Check backend
    if let Some(ref expected_backend) = matcher.backend {
        let detected_backend = detect_backend(crash);
        if !detected_backend.eq_ignore_ascii_case(expected_backend) {
            return false;
        }
    }

    // Check error contains
    if let Some(ref error_pattern) = matcher.error_contains {
        let error_text = format!("{} {}", crash.exception.exception_type, crash.exception.message);
        if !error_text.to_lowercase().contains(&error_pattern.to_lowercase()) {
            return false;
        }
    }

    // Check prepared statement
    if let Some(ref stmt_matcher) = matcher.prepared_statement {
        let has_match = db.sessions.iter().any(|s| {
            s.prepared_statement
                .as_ref()
                .map(|ps| check_string_matcher(stmt_matcher, ps))
                .unwrap_or(false)
        });
        if !has_match {
            return false;
        }
    }

    true
}

/// Detect database backend from crash data
pub fn detect_backend(crash: &CrashFile) -> String {
    // Check environment
    if crash.environment.oracle_server.is_some() {
        return "oracle".to_string();
    }
    if crash.environment.postgres_version.is_some() {
        return "postgresql".to_string();
    }

    // Check error message
    let error_text = format!(
        "{} {}",
        crash.exception.exception_type,
        crash.exception.message
    ).to_lowercase();

    if error_text.contains("postgres") || error_text.contains("libpq") {
        return "postgresql".to_string();
    }
    if error_text.contains("oracle") || error_text.contains("ora-") {
        return "oracle".to_string();
    }

    // Check stack
    for frame in &crash.stack_trace {
        let sig = frame.method_signature.to_lowercase();
        if sig.contains("postgres") {
            return "postgresql".to_string();
        }
        if sig.contains("oracle") || sig.contains("exdi") {
            return "oracle".to_string();
        }
    }

    "unknown".to_string()
}

/// Check if crash is a prepared statement error
pub fn is_prepared_statement_error(crash: &CrashFile) -> bool {
    let error_text = format!("{} {}", crash.exception.exception_type, crash.exception.message);
    error_text.contains("prepared statement") && error_text.contains("does not exist")
}

/// Extract prepared statement name from error
pub fn extract_prepared_statement_name(crash: &CrashFile) -> Option<String> {
    let re = regex::Regex::new(r#"prepared statement\s+['"]([\w\d]+)['"]"#).ok()?;
    let error_text = format!("{} {}", crash.exception.exception_type, crash.exception.message);
    re.captures(&error_text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}
```

---

## TASK 3: Implement Pattern Engine

### File: `src/patterns/engine.rs`

```rust
use crate::models::CrashFile;
use crate::patterns::pattern::{CrashPattern, PatternMatchResult};
use crate::patterns::matchers;
use std::collections::HashMap;
use tracing::{debug, info};

/// Pattern matching engine
pub struct PatternEngine {
    /// All loaded patterns
    patterns: Vec<CrashPattern>,
}

impl PatternEngine {
    pub fn new() -> Self {
        Self {
            patterns: Vec::new(),
        }
    }

    /// Load patterns from a vector
    pub fn with_patterns(mut self, patterns: Vec<CrashPattern>) -> Self {
        self.patterns = patterns;
        self.sort_patterns();
        self
    }

    /// Add a single pattern
    pub fn add_pattern(&mut self, pattern: CrashPattern) {
        self.patterns.push(pattern);
        self.sort_patterns();
    }

    /// Sort patterns by priority (descending)
    fn sort_patterns(&mut self) {
        self.patterns.sort_by(|a, b| b.priority.cmp(&a.priority));
    }

    /// Get all enabled patterns
    pub fn patterns(&self) -> &[CrashPattern] {
        &self.patterns
    }

    /// Find all matching patterns for a crash
    pub fn find_matches(&self, crash: &CrashFile) -> Vec<PatternMatchResult> {
        let mut results = Vec::new();

        for pattern in &self.patterns {
            if !pattern.enabled {
                continue;
            }

            let (matches, matched_conditions, confidence) = 
                matchers::matches_pattern(crash, &pattern.matchers);

            if matches {
                debug!(
                    "Pattern '{}' matched with confidence {:.2}",
                    pattern.id, confidence
                );

                let is_applicable = self.check_version_applicability(crash, pattern);
                
                results.push(PatternMatchResult {
                    pattern: pattern.clone(),
                    confidence,
                    matched_conditions,
                    match_context: self.extract_match_context(crash, pattern),
                    is_applicable,
                    fixed_in_version: pattern.versioning.fixed_in.clone(),
                });
            }
        }

        // Sort by confidence descending
        results.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap());

        results
    }

    /// Find the best matching pattern (highest confidence)
    pub fn find_best_match(&self, crash: &CrashFile) -> Option<PatternMatchResult> {
        self.find_matches(crash).into_iter().next()
    }

    /// Check if crash version means this pattern is still applicable
    fn check_version_applicability(&self, crash: &CrashFile, pattern: &CrashPattern) -> bool {
        let fixed_in = match &pattern.versioning.fixed_in {
            Some(v) => v,
            None => return true, // No fix version = always applicable
        };

        let crash_version = match &crash.environment.version {
            Some(v) => v,
            None => return true, // Can't determine, assume applicable
        };

        // Parse versions and compare
        match (
            semver::Version::parse(fixed_in),
            parse_whatson_version(crash_version),
        ) {
            (Ok(fixed), Some(current)) => {
                // Pattern is applicable if current version is BEFORE the fix
                current < fixed
            }
            _ => true, // Can't parse, assume applicable
        }
    }

    /// Extract additional context from the match
    fn extract_match_context(&self, crash: &CrashFile, pattern: &CrashPattern) -> HashMap<String, String> {
        let mut context = HashMap::new();

        // Add relevant extracted values based on pattern category
        match pattern.category {
            crate::patterns::pattern::PatternCategory::CollectionError => {
                if let Some((size, index)) = matchers::context::get_collection_mismatch(crash) {
                    context.insert("collection_size".to_string(), size.to_string());
                    context.insert("requested_index".to_string(), index.to_string());
                }
            }
            crate::patterns::pattern::PatternCategory::DatabaseError => {
                let backend = matchers::database::detect_backend(crash);
                context.insert("database_backend".to_string(), backend);
                
                if let Some(stmt) = matchers::database::extract_prepared_statement_name(crash) {
                    context.insert("prepared_statement".to_string(), stmt);
                }
            }
            _ => {}
        }

        // Add first application frame
        if let Some(frame) = matchers::stack::get_first_application_frame(crash) {
            context.insert("first_app_frame".to_string(), frame.method_signature.clone());
        }

        context
    }

    /// Get pattern by ID
    pub fn get_pattern(&self, id: &str) -> Option<&CrashPattern> {
        self.patterns.iter().find(|p| p.id == id)
    }

    /// Get patterns by category
    pub fn get_by_category(&self, category: &crate::patterns::pattern::PatternCategory) -> Vec<&CrashPattern> {
        self.patterns.iter().filter(|p| &p.category == category).collect()
    }

    /// Get patterns by tag
    pub fn get_by_tag(&self, tag: &str) -> Vec<&CrashPattern> {
        self.patterns.iter().filter(|p| p.tags.contains(&tag.to_string())).collect()
    }
}

impl Default for PatternEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse WHATS'ON version string (e.g., "2024r3.000.064") to semver
fn parse_whatson_version(version: &str) -> Option<semver::Version> {
    // Format: YYYYrN.XXX.YYY -> N.XXX.YYY (ignoring year for comparison)
    let re = regex::Regex::new(r"(\d{4})r(\d+)\.(\d+)\.(\d+)").ok()?;
    let caps = re.captures(version)?;
    
    let major: u64 = caps.get(2)?.as_str().parse().ok()?;
    let minor: u64 = caps.get(3)?.as_str().parse().ok()?;
    let patch: u64 = caps.get(4)?.as_str().parse().ok()?;
    
    Some(semver::Version::new(major, minor, patch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_whatson_version() {
        let v = parse_whatson_version("2024r3.000.064").unwrap();
        assert_eq!(v.major, 3);
        assert_eq!(v.minor, 0);
        assert_eq!(v.patch, 64);
    }

    #[test]
    fn test_version_comparison() {
        let v1 = parse_whatson_version("2024r3.000.064").unwrap();
        let v2 = parse_whatson_version("2024r3.000.065").unwrap();
        assert!(v1 < v2);
    }
}
```

---

## TASK 4: Pattern Library Loader

### File: `src/patterns/library/loader.rs`

```rust
use crate::patterns::pattern::CrashPattern;
use std::path::Path;
use anyhow::Result;
use tracing::{info, warn};

/// Load patterns from TOML files
pub fn load_patterns_from_directory(dir: &Path) -> Result<Vec<CrashPattern>> {
    let mut patterns = Vec::new();

    if !dir.exists() {
        warn!("Pattern directory does not exist: {:?}", dir);
        return Ok(patterns);
    }

    let toml_files = glob::glob(dir.join("*.toml").to_str().unwrap())?;

    for entry in toml_files.flatten() {
        match load_patterns_from_file(&entry) {
            Ok(file_patterns) => {
                info!("Loaded {} patterns from {:?}", file_patterns.len(), entry);
                patterns.extend(file_patterns);
            }
            Err(e) => {
                warn!("Failed to load patterns from {:?}: {}", entry, e);
            }
        }
    }

    Ok(patterns)
}

/// Load patterns from a single TOML file
pub fn load_patterns_from_file(path: &Path) -> Result<Vec<CrashPattern>> {
    let content = std::fs::read_to_string(path)?;
    let parsed: PatternFile = toml::from_str(&content)?;
    Ok(parsed.patterns)
}

/// Load patterns from a TOML string
pub fn load_patterns_from_string(content: &str) -> Result<Vec<CrashPattern>> {
    let parsed: PatternFile = toml::from_str(content)?;
    Ok(parsed.patterns)
}

#[derive(Debug, serde::Deserialize)]
struct PatternFile {
    #[serde(rename = "pattern")]
    patterns: Vec<CrashPattern>,
}
```

### File: `src/patterns/library/builtin.rs`

```rust
use crate::patterns::pattern::*;

/// Get all built-in patterns
pub fn get_builtin_patterns() -> Vec<CrashPattern> {
    vec![
        subscript_out_of_bounds_collection(),
        message_not_understood_nil(),
        postgres_prepared_statement_not_found(),
        oracle_connection_lost(),
        txblock_segment_duration_mismatch(),
    ]
}

fn subscript_out_of_bounds_collection() -> CrashPattern {
    CrashPattern {
        id: "BUILTIN-001".to_string(),
        name: "Collection Index Out of Bounds".to_string(),
        description: "Attempting to access a collection at an index that doesn't exist".to_string(),
        category: PatternCategory::CollectionError,
        matchers: PatternMatchers {
            exception_type: Some("SubscriptOutOfBounds".to_string()),
            stack_contains_any: vec![
                "OrderedCollection>>at:".to_string(),
                "Array>>at:".to_string(),
            ],
            context: Some(ContextMatcher {
                receiver_is_collection: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        },
        analysis: PatternAnalysis {
            root_cause: "Code attempted to access a collection element at an index greater than the collection size".to_string(),
            root_cause_plain: "The system tried to get item #X from a list that only has Y items".to_string(),
            severity: Severity::High,
            data_at_risk: false,
            fix_summary: "Add bounds checking before accessing collection elements".to_string(),
            fix_details: Some("Verify the index is within range (1 to collection size) before accessing. Consider why the collection has fewer items than expected.".to_string()),
            fix_code_hints: vec![
                "Check: index <= collection size".to_string(),
                "Use #at:ifAbsent: for safe access".to_string(),
            ],
            workarounds: vec![],
            affected_features: vec![],
            test_scenarios: vec![
                TestScenario {
                    id: "TC-001".to_string(),
                    name: "Verify bounds checking".to_string(),
                    priority: "P1".to_string(),
                    steps: vec![
                        "Create scenario with mismatched data counts".to_string(),
                        "Trigger the operation".to_string(),
                        "Verify graceful error handling".to_string(),
                    ],
                    expected_result: "Application should handle gracefully without crash".to_string(),
                },
            ],
            documentation_links: vec![],
            investigation_queries: vec![],
        },
        versioning: PatternVersioning::default(),
        priority: 50,
        enabled: true,
        tags: vec!["collection".to_string(), "index".to_string()],
    }
}

fn message_not_understood_nil() -> CrashPattern {
    CrashPattern {
        id: "BUILTIN-002".to_string(),
        name: "Message Sent to Nil".to_string(),
        description: "A message was sent to nil (UndefinedObject)".to_string(),
        category: PatternCategory::NullReference,
        matchers: PatternMatchers {
            exception_type: Some("MessageNotUnderstood".to_string()),
            context: Some(ContextMatcher {
                receiver_class: Some(StringMatcher::Exact("UndefinedObject".to_string())),
                ..Default::default()
            }),
            ..Default::default()
        },
        analysis: PatternAnalysis {
            root_cause: "A message was sent to nil - an object that should exist is missing".to_string(),
            root_cause_plain: "The system tried to use something that doesn't exist (nil/null value)".to_string(),
            severity: Severity::High,
            data_at_risk: false,
            fix_summary: "Add nil check or ensure object is properly initialized".to_string(),
            fix_details: Some("Trace back to find where the nil value originated. Common causes: failed lookups, uninitialized variables, deleted objects.".to_string()),
            fix_code_hints: vec![
                "Add: object ifNil: [^self] before sending messages".to_string(),
                "Use #ifNotNil: for conditional execution".to_string(),
            ],
            workarounds: vec![],
            affected_features: vec![],
            test_scenarios: vec![],
            documentation_links: vec![],
            investigation_queries: vec![],
        },
        versioning: PatternVersioning::default(),
        priority: 50,
        enabled: true,
        tags: vec!["nil".to_string(), "null".to_string()],
    }
}

fn postgres_prepared_statement_not_found() -> CrashPattern {
    CrashPattern {
        id: "BUILTIN-003".to_string(),
        name: "PostgreSQL Prepared Statement Not Found".to_string(),
        description: "A prepared statement was deallocated before use, often due to connection pooling".to_string(),
        category: PatternCategory::DatabaseError,
        matchers: PatternMatchers {
            exception_message: Some(StringMatcher::Contains {
                contains: "prepared statement".to_string(),
            }),
            database: Some(DatabaseMatcher {
                backend: Some("postgresql".to_string()),
                error_contains: Some("does not exist".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        },
        analysis: PatternAnalysis {
            root_cause: "Prepared statement was deallocated by connection pooling (e.g., PgBouncer) or connection reuse".to_string(),
            root_cause_plain: "The database forgot a query that the application thought was saved, usually due to connection sharing settings".to_string(),
            severity: Severity::High,
            data_at_risk: false,
            fix_summary: "Review connection pooling configuration; use session mode or handle statement lifecycle".to_string(),
            fix_details: Some("If using PgBouncer in transaction mode, prepared statements are lost between transactions. Either switch to session mode, disable prepared statements, or recreate statements on demand.".to_string()),
            fix_code_hints: vec![
                "PgBouncer: Set pool_mode = session".to_string(),
                "Or: Handle 26000 error by recreating statement".to_string(),
            ],
            workarounds: vec![
                "Restart the application to clear statement cache".to_string(),
            ],
            affected_features: vec!["All database operations".to_string()],
            test_scenarios: vec![],
            documentation_links: vec![],
            investigation_queries: vec![],
        },
        versioning: PatternVersioning::default(),
        priority: 70,
        enabled: true,
        tags: vec!["database".to_string(), "postgresql".to_string(), "connection".to_string()],
    }
}

fn oracle_connection_lost() -> CrashPattern {
    CrashPattern {
        id: "BUILTIN-004".to_string(),
        name: "Oracle Connection Lost".to_string(),
        description: "The Oracle database connection was unexpectedly closed".to_string(),
        category: PatternCategory::DatabaseError,
        matchers: PatternMatchers {
            exception_message: Some(StringMatcher::Regex {
                regex: r"ORA-(03113|03114|03135|12541)".to_string(),
            }),
            database: Some(DatabaseMatcher {
                backend: Some("oracle".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        },
        analysis: PatternAnalysis {
            root_cause: "Oracle database connection was terminated unexpectedly".to_string(),
            root_cause_plain: "The connection to the database was lost, possibly due to network issues, server restart, or timeout".to_string(),
            severity: Severity::High,
            data_at_risk: true,
            fix_summary: "Check network connectivity, database server status, and connection timeout settings".to_string(),
            fix_details: Some("ORA-03113/03114 typically indicate end-of-file on communication channel. Check for database server restarts, network interruptions, or firewall timeouts.".to_string()),
            fix_code_hints: vec![],
            workarounds: vec![
                "Restart the application".to_string(),
                "Check database server is running".to_string(),
            ],
            affected_features: vec!["All database operations".to_string()],
            test_scenarios: vec![],
            documentation_links: vec![],
            investigation_queries: vec![],
        },
        versioning: PatternVersioning::default(),
        priority: 80,
        enabled: true,
        tags: vec!["database".to_string(), "oracle".to_string(), "connection".to_string()],
    }
}

fn txblock_segment_duration_mismatch() -> CrashPattern {
    CrashPattern {
        id: "WHATSON-001".to_string(),
        name: "TxBlock Segment/Duration Count Mismatch".to_string(),
        description: "The number of TimeAllocations doesn't match the number of SegmentDurations".to_string(),
        category: PatternCategory::WhatsOnSpecific,
        matchers: PatternMatchers {
            exception_type: Some("SubscriptOutOfBounds".to_string()),
            stack_contains: vec![
                "PSITxBlock".to_string(),
            ],
            stack_contains_any: vec![
                "removeTimeAllocationsAndUpdateDesiredSegmentation".to_string(),
                "Segmentation".to_string(),
                "MakeContinuous".to_string(),
            ],
            context: Some(ContextMatcher {
                has_business_objects: vec![
                    "BMProgramSegmentDurations".to_string(),
                ],
                ..Default::default()
            }),
            ..Default::default()
        },
        analysis: PatternAnalysis {
            root_cause: "TxBlock has mismatched segment and duration counts - data integrity violation".to_string(),
            root_cause_plain: "A transmission block has 4 time segments but only 2 duration records, causing a crash when trying to process them together".to_string(),
            severity: Severity::Critical,
            data_at_risk: true,
            fix_summary: "Add bounds checking in segmentation code; investigate source of data mismatch".to_string(),
            fix_details: Some("The code iterates over TimeAllocations and accesses BMProgramSegmentDurations by index, assuming they match. When they don't (e.g., after import or manual editing), it crashes.".to_string()),
            fix_code_hints: vec![
                "Add: durations size >= allocations size check".to_string(),
                "Use: durations at: index ifAbsent: [nil]".to_string(),
                "Log warning when mismatch detected".to_string(),
            ],
            workarounds: vec![
                "Avoid using 'Make Continuous' on affected TxBlocks".to_string(),
                "Manually fix segment count in database".to_string(),
            ],
            affected_features: vec![
                "Continuity Planner - Make Continuous".to_string(),
                "Continuity Planner - Remove Empty Time Allocations".to_string(),
                "Schedule Import (data source)".to_string(),
            ],
            test_scenarios: vec![
                TestScenario {
                    id: "TC-WHATSON-001-1".to_string(),
                    name: "Make Continuous with matched segments".to_string(),
                    priority: "P1".to_string(),
                    steps: vec![
                        "Open Continuity Planner".to_string(),
                        "Select a TxBlock with equal segment/duration counts".to_string(),
                        "Click Make Continuous".to_string(),
                    ],
                    expected_result: "Operation completes successfully".to_string(),
                },
                TestScenario {
                    id: "TC-WHATSON-001-2".to_string(),
                    name: "Make Continuous with mismatched segments".to_string(),
                    priority: "P1".to_string(),
                    steps: vec![
                        "Create TxBlock with segment/duration mismatch".to_string(),
                        "Open Continuity Planner".to_string(),
                        "Select the affected TxBlock".to_string(),
                        "Click Make Continuous".to_string(),
                    ],
                    expected_result: "Graceful error message, no crash".to_string(),
                },
            ],
            documentation_links: vec![],
            investigation_queries: vec![
                InvestigationQuery {
                    name: "Find mismatched TxBlocks".to_string(),
                    description: "Find all TxBlocks where segment count != duration count".to_string(),
                    sql: r#"
SELECT 
    tb.OID as txblock_oid,
    c.NAME as channel,
    tb.STARTDATETIME as start_time,
    (SELECT COUNT(*) FROM PSI.BMTIMEALLOCATION ta WHERE ta.TXBLOCK_ID = tb.OID AND ta.ALLOCATIONTYPE = 'Segment of program') as segment_count,
    (SELECT COUNT(*) FROM PSI.BMPROGRAMSEGMENTDURATIONS psd WHERE psd.TXBLOCK_ID = tb.OID) as duration_count
FROM PSI.PSITXBLOCK tb
JOIN PSI.PSICHANNEL c ON tb.CHANNEL_ID = c.OID
WHERE (SELECT COUNT(*) FROM PSI.BMTIMEALLOCATION ta WHERE ta.TXBLOCK_ID = tb.OID AND ta.ALLOCATIONTYPE = 'Segment of program')
   != (SELECT COUNT(*) FROM PSI.BMPROGRAMSEGMENTDURATIONS psd WHERE psd.TXBLOCK_ID = tb.OID)
ORDER BY tb.STARTDATETIME DESC
"#.to_string(),
                },
            ],
        },
        versioning: PatternVersioning {
            introduced_in: None,
            fixed_in: None,  // Not yet fixed
            tickets: vec!["MTVNL-4521".to_string(), "MTVNL-4523".to_string()],
            pattern_version: "1.0.0".to_string(),
            last_updated: Some("2026-01-19".to_string()),
        },
        priority: 90,
        enabled: true,
        tags: vec![
            "whatson".to_string(),
            "txblock".to_string(),
            "segmentation".to_string(),
            "continuity".to_string(),
            "data-integrity".to_string(),
        ],
    }
}
```

### File: `src/patterns/library/mod.rs`

```rust
mod loader;
mod builtin;

pub use loader::*;
pub use builtin::*;
```

---

## TASK 5: Pattern Definition Files (TOML)

### File: `data/patterns/collection_errors.toml`

```toml
# Collection-related crash patterns

[[pattern]]
id = "COLL-001"
name = "OrderedCollection Index Out of Bounds"
description = "Accessing an OrderedCollection at an invalid index"
category = "collection_error"
priority = 60
enabled = true
tags = ["collection", "ordered_collection", "index"]

[pattern.matchers]
exception_type = "SubscriptOutOfBounds"
stack_contains_any = ["OrderedCollection>>at:", "OrderedCollection>>at:put:"]

[pattern.matchers.context]
receiver_class = { contains = "OrderedCollection" }
receiver_is_collection = true

[pattern.analysis]
root_cause = "Code accessed OrderedCollection at index beyond lastIndex"
root_cause_plain = "The system tried to access an item in a list at a position that doesn't exist"
severity = "high"
data_at_risk = false
fix_summary = "Validate index before access or use #at:ifAbsent:"
fix_code_hints = [
    "Replace: collection at: index",
    "With: collection at: index ifAbsent: [defaultValue]"
]
workarounds = []
affected_features = []

[pattern.versioning]
pattern_version = "1.0.0"


[[pattern]]
id = "COLL-002"
name = "Dictionary Key Not Found"
description = "Accessing a Dictionary with a key that doesn't exist"
category = "collection_error"
priority = 55
enabled = true
tags = ["collection", "dictionary", "key"]

[pattern.matchers]
exception_type = "KeyNotFound"
stack_contains_any = ["Dictionary>>at:", "IdentityDictionary>>at:"]

[pattern.analysis]
root_cause = "Dictionary lookup with non-existent key"
root_cause_plain = "The system tried to look up a value using a key that isn't in the dictionary"
severity = "medium"
data_at_risk = false
fix_summary = "Use #at:ifAbsent: or check #includesKey: first"
fix_code_hints = [
    "Replace: dict at: key",
    "With: dict at: key ifAbsent: [nil]"
]
workarounds = []
affected_features = []

[pattern.versioning]
pattern_version = "1.0.0"
```

### File: `data/patterns/database_errors.toml`

```toml
# Database-related crash patterns

[[pattern]]
id = "DB-PG-001"
name = "PostgreSQL Prepared Statement Cache Miss"
description = "Connection pooler invalidated prepared statement"
category = "database_error"
priority = 75
enabled = true
tags = ["database", "postgresql", "pgbouncer", "prepared_statement"]

[pattern.matchers]
exception_type = ".*Error.*"

[pattern.matchers.exception_message]
contains = "prepared statement"

[pattern.matchers.database]
backend = "postgresql"
error_contains = "does not exist"

[pattern.analysis]
root_cause = "Prepared statement was invalidated by connection pooling (PgBouncer/pgpool)"
root_cause_plain = "The database connection was reused and the saved query was lost"
severity = "high"
data_at_risk = false
fix_summary = "Configure connection pooler for session mode or handle statement recreation"
fix_details = """
When using PgBouncer in 'transaction' mode, prepared statements are not preserved 
between transactions. Solutions:
1. Use 'session' mode in PgBouncer
2. Disable prepared statements in the application
3. Handle ERROR 26000 by recreating the statement
"""
fix_code_hints = [
    "PgBouncer: pool_mode = session",
    "Application: Catch 26000 and retry with fresh statement"
]
workarounds = ["Restart application to clear statement cache"]
affected_features = ["All database operations"]

[pattern.versioning]
pattern_version = "1.0.0"


[[pattern]]
id = "DB-ORA-001"
name = "Oracle Deadlock Detected"
description = "Database deadlock between concurrent operations"
category = "database_error"
priority = 80
enabled = true
tags = ["database", "oracle", "deadlock", "concurrency"]

[pattern.matchers]
[pattern.matchers.exception_message]
regex = "ORA-00060"

[pattern.matchers.database]
backend = "oracle"

[pattern.analysis]
root_cause = "Two or more transactions waiting for each other's locks"
root_cause_plain = "Two operations are stuck waiting for each other, causing a deadlock"
severity = "high"
data_at_risk = true
fix_summary = "Review transaction isolation and locking patterns"
fix_details = """
ORA-00060 indicates a deadlock between sessions. The database automatically 
rolls back one transaction. Investigate:
1. Which tables are involved
2. Lock ordering consistency
3. Transaction scope (can it be smaller?)
"""
fix_code_hints = [
    "Ensure consistent lock ordering across operations",
    "Reduce transaction duration",
    "Consider using SELECT FOR UPDATE NOWAIT"
]
workarounds = ["Retry the operation"]
affected_features = ["Concurrent editing operations"]

[pattern.versioning]
pattern_version = "1.0.0"
```

### File: `data/patterns/whatson_specific.toml`

```toml
# WHATS'ON specific crash patterns

[[pattern]]
id = "WHATSON-002"
name = "Continuity Planner Active Transaction Warning"
description = "Database transaction left open during UI operation"
category = "whats_on_specific"
priority = 65
enabled = true
tags = ["whatson", "continuity", "transaction", "data_integrity"]

[pattern.matchers]
stack_contains_any = ["ContinuityPlanner", "PLContinuityPlan"]

[pattern.matchers.database]
has_active_transaction = true

[pattern.analysis]
root_cause = "Crash occurred with active database transaction - uncommitted changes may be lost"
root_cause_plain = "The system crashed while saving changes, so some edits may not have been saved"
severity = "critical"
data_at_risk = true
fix_summary = "Verify data integrity; uncommitted changes are lost on crash"
fix_details = """
An active transaction (xactYes) was present at crash time. This means:
1. Some database changes may not have been committed
2. Locks may still be held (until session timeout)
3. Data may be in an inconsistent state
"""
fix_code_hints = []
workarounds = [
    "Check the affected schedule for missing changes",
    "Verify schedule integrity before approval"
]
affected_features = ["Schedule editing", "Data integrity"]

[pattern.analysis.investigation_queries]
[[pattern.analysis.investigation_queries]]
name = "Check for locked records"
description = "Find any records still locked by the crashed session"
sql = """
SELECT * FROM V$LOCKED_OBJECT 
WHERE SESSION_ID IN (SELECT SID FROM V$SESSION WHERE USERNAME = 'WHATSON')
"""

[pattern.versioning]
pattern_version = "1.0.0"


[[pattern]]
id = "WHATSON-003"
name = "Schedule Import Segment Mismatch"
description = "Imported schedule has inconsistent segment data"
category = "whats_on_specific"
priority = 70
enabled = true
tags = ["whatson", "import", "segments", "data_integrity"]

[pattern.matchers]
exception_type = "SubscriptOutOfBounds"
stack_contains_any = ["Import", "Schedule"]
stack_contains = ["Segment"]

[pattern.matchers.context]
has_business_objects = ["BMProgramSegmentDurations", "TimeAllocation"]

[pattern.analysis]
root_cause = "Schedule import created TxBlocks with mismatched segment/duration counts"
root_cause_plain = "The schedule import didn't properly create matching segment data, causing later crashes"
severity = "high"
data_at_risk = true
fix_summary = "Investigate import source; add validation during import"
fix_details = """
The import process should validate that:
1. Each segment has a corresponding duration record
2. Segment counts match between source and destination
3. All required business objects are created together
"""
fix_code_hints = [
    "Add import validation step",
    "Create segments and durations in same transaction"
]
workarounds = [
    "Re-import the schedule",
    "Manually correct segment data"
]
affected_features = ["Schedule Import", "Continuity Planner"]

[pattern.versioning]
pattern_version = "1.0.0"
tickets = ["IMPORT-1234"]
```

---

## TASK 6: Module Integration

### File: `src/patterns/mod.rs`

```rust
mod pattern;
mod engine;
mod matchers;
mod library;

pub use pattern::*;
pub use engine::PatternEngine;
pub use library::{load_patterns_from_directory, load_patterns_from_file, get_builtin_patterns};

use crate::models::CrashFile;
use std::path::Path;

/// Create a pattern engine with all available patterns
pub fn create_pattern_engine(custom_patterns_dir: Option<&Path>) -> PatternEngine {
    let mut patterns = get_builtin_patterns();
    
    // Load custom patterns if directory provided
    if let Some(dir) = custom_patterns_dir {
        if let Ok(custom) = load_patterns_from_directory(dir) {
            patterns.extend(custom);
        }
    }
    
    PatternEngine::new().with_patterns(patterns)
}

/// Quick match function for simple use cases
pub fn quick_match(crash: &CrashFile) -> Option<PatternMatchResult> {
    let engine = PatternEngine::new().with_patterns(get_builtin_patterns());
    engine.find_best_match(crash)
}
```

---

## TASK 7: Tauri Command Integration

### File: `src/commands/pattern_commands.rs`

```rust
use crate::patterns::{
    PatternEngine, CrashPattern, PatternMatchResult,
    create_pattern_engine, get_builtin_patterns,
};
use crate::models::CrashFile;
use tauri::State;
use std::sync::RwLock;

/// Managed state for pattern engine
pub struct PatternEngineState(pub RwLock<PatternEngine>);

#[tauri::command]
pub fn match_patterns(
    crash: CrashFile,
    engine: State<'_, PatternEngineState>,
) -> Vec<PatternMatchResult> {
    let engine = engine.0.read().unwrap();
    engine.find_matches(&crash)
}

#[tauri::command]
pub fn get_best_pattern_match(
    crash: CrashFile,
    engine: State<'_, PatternEngineState>,
) -> Option<PatternMatchResult> {
    let engine = engine.0.read().unwrap();
    engine.find_best_match(&crash)
}

#[tauri::command]
pub fn list_patterns(
    engine: State<'_, PatternEngineState>,
) -> Vec<PatternSummary> {
    let engine = engine.0.read().unwrap();
    engine.patterns()
        .iter()
        .map(|p| PatternSummary {
            id: p.id.clone(),
            name: p.name.clone(),
            category: format!("{:?}", p.category),
            enabled: p.enabled,
            priority: p.priority,
        })
        .collect()
}

#[tauri::command]
pub fn get_pattern_by_id(
    id: String,
    engine: State<'_, PatternEngineState>,
) -> Option<CrashPattern> {
    let engine = engine.0.read().unwrap();
    engine.get_pattern(&id).cloned()
}

#[tauri::command]
pub fn reload_patterns(
    custom_dir: Option<String>,
    engine: State<'_, PatternEngineState>,
) -> Result<usize, String> {
    let new_engine = create_pattern_engine(
        custom_dir.as_ref().map(|s| std::path::Path::new(s.as_str()))
    );
    let count = new_engine.patterns().len();
    
    let mut state = engine.0.write().unwrap();
    *state = new_engine;
    
    Ok(count)
}

#[derive(serde::Serialize)]
pub struct PatternSummary {
    pub id: String,
    pub name: String,
    pub category: String,
    pub enabled: bool,
    pub priority: u32,
}
```

---

## Verification Checklist

After implementing, verify:

- [ ] `cargo build` succeeds
- [ ] `cargo test` passes
- [ ] Built-in patterns load correctly
- [ ] TOML patterns parse without errors
- [ ] Pattern matching returns expected results
- [ ] Version comparison works correctly
- [ ] Confidence scores are reasonable (0.0-1.0)
- [ ] Pattern categories are assigned correctly

---

## Notes for Claude Code

1. **Pattern files are data** - TOML files go in `data/patterns/`, not `src/`
2. **Built-in patterns are fallback** - Always available even without TOML files
3. **Priority matters** - Higher priority patterns are checked first
4. **Version comparison** - Use semver for fix version tracking
5. **Extensibility** - New patterns can be added without code changes
6. **Test with real crashes** - Use the sample crash files to validate patterns
