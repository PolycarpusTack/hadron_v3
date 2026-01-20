mod engine;
mod library;
mod matchers;
mod pattern;

pub use engine::PatternEngine;
pub use library::{get_builtin_patterns, load_patterns_from_directory};
pub use pattern::*;

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
#[allow(dead_code)]
pub fn quick_match(crash: &CrashFile) -> Option<PatternMatchResult> {
    let engine = PatternEngine::new().with_patterns(get_builtin_patterns());
    engine.find_best_match(crash)
}
