use crate::models::CrashFile;
use crate::patterns::matchers;
use crate::patterns::pattern::{CrashPattern, PatternCategory, PatternMatchResult};
use log::debug;
use std::collections::HashMap;

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
    #[allow(dead_code)]
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

        // Sort by confidence descending (use total_cmp for safe f64 comparison)
        results.sort_by(|a, b| b.confidence.total_cmp(&a.confidence));

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
    fn extract_match_context(
        &self,
        crash: &CrashFile,
        pattern: &CrashPattern,
    ) -> HashMap<String, String> {
        let mut context = HashMap::new();

        // Add relevant extracted values based on pattern category
        match pattern.category {
            PatternCategory::CollectionError => {
                if let Some((size, index)) = matchers::context::get_collection_mismatch(crash) {
                    context.insert("collection_size".to_string(), size.to_string());
                    context.insert("requested_index".to_string(), index.to_string());
                }
            }
            PatternCategory::DatabaseError => {
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
            context.insert(
                "first_app_frame".to_string(),
                frame.method_signature.clone(),
            );
        }

        context
    }

    /// Get pattern by ID
    pub fn get_pattern(&self, id: &str) -> Option<&CrashPattern> {
        self.patterns.iter().find(|p| p.id == id)
    }

    /// Get patterns by category
    #[allow(dead_code)]
    pub fn get_by_category(&self, category: &PatternCategory) -> Vec<&CrashPattern> {
        self.patterns
            .iter()
            .filter(|p| &p.category == category)
            .collect()
    }

    /// Get patterns by tag
    #[allow(dead_code)]
    pub fn get_by_tag(&self, tag: &str) -> Vec<&CrashPattern> {
        self.patterns
            .iter()
            .filter(|p| p.tags.contains(&tag.to_string()))
            .collect()
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
