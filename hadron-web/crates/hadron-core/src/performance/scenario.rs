use super::types::{DetectedPattern, TopMethod, UserScenario};

/// Reconstruct the most likely user scenario from detected patterns, methods, and raw content.
pub fn reconstruct_scenario(
    patterns: &[DetectedPattern],
    methods: &[TopMethod],
    content: &str,
) -> UserScenario {
    // Determine trigger
    let trigger = if patterns.iter().any(|p| p.pattern_type == "changelog_sync") {
        "Change Log Polling (automatic)".to_string()
    } else if patterns.iter().any(|p| p.pattern_type == "user_interaction") {
        "User interaction (mouse/keyboard)".to_string()
    } else if patterns.iter().any(|p| p.pattern_type == "database") {
        "Database query or transaction".to_string()
    } else {
        "Application activity".to_string()
    };

    // Determine action
    let action = if content.contains("ChangeLogSynchronizer") {
        "Background synchronization processing changes from concurrent users".to_string()
    } else if content.contains("YellowButtonPressedEvent") {
        "User performed a right-click selection operation in a list component".to_string()
    } else {
        "Normal application processing".to_string()
    };

    // Determine context
    let context = if patterns.iter().any(|p| p.pattern_type == "widget_update") {
        "The system processed changes and propagated updates to all open application windows"
            .to_string()
    } else if patterns.iter().any(|p| p.pattern_type == "ui_rendering") {
        "UI rendering operations were active during the trace period".to_string()
    } else {
        "Standard application operation".to_string()
    };

    // Calculate impact percentage (high/medium patterns × 15%, capped at 75%)
    let impact_percentage = (patterns
        .iter()
        .filter(|p| p.severity == "high" || p.severity == "medium")
        .count() as f64
        * 15.0)
        .min(75.0);

    // Contributing factors
    let mut contributing_factors = Vec::new();
    if patterns.iter().any(|p| p.pattern_type == "gc_pressure") {
        contributing_factors
            .push("Memory pressure requiring frequent garbage collection".to_string());
    }
    if patterns.iter().any(|p| p.pattern_type == "ui_rendering") {
        contributing_factors.push("Complex UI rendering with multiple components".to_string());
    }
    if methods.iter().any(|m| m.category == "FFI/External") {
        contributing_factors
            .push("External function calls (FFI) contributing to overhead".to_string());
    }

    UserScenario {
        trigger,
        action,
        context,
        impact_percentage,
        contributing_factors,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::performance::types::{DetectedPattern, TopMethod};

    fn changelog_pattern() -> DetectedPattern {
        DetectedPattern {
            pattern_type: "changelog_sync".to_string(),
            severity: "high".to_string(),
            title: "Change Log Synchronization".to_string(),
            description: "Multi-user sync".to_string(),
            confidence: 95.0,
        }
    }

    fn widget_pattern() -> DetectedPattern {
        DetectedPattern {
            pattern_type: "widget_update".to_string(),
            severity: "medium".to_string(),
            title: "Widget Update Cascade".to_string(),
            description: "Widget cascade".to_string(),
            confidence: 92.0,
        }
    }

    #[test]
    fn test_scenario_with_changelog() {
        let patterns = vec![changelog_pattern(), widget_pattern()];
        let content = "ChangeLogSynchronizer processChanges updateWidgetsInApplications";
        let scenario = reconstruct_scenario(&patterns, &[], content);

        assert_eq!(scenario.trigger, "Change Log Polling (automatic)");
        assert!(scenario.action.contains("synchronization"));
        // widget_update context
        assert!(scenario.context.contains("propagated updates"));
        // 2 patterns (high + medium) → 2 × 15 = 30%
        assert_eq!(scenario.impact_percentage, 30.0);
    }

    #[test]
    fn test_scenario_default() {
        // No patterns, no special content
        let scenario = reconstruct_scenario(&[], &[], "normal log content");

        assert_eq!(scenario.trigger, "Application activity");
        assert_eq!(scenario.action, "Normal application processing");
        assert_eq!(scenario.context, "Standard application operation");
        assert_eq!(scenario.impact_percentage, 0.0);
        assert!(scenario.contributing_factors.is_empty());
    }

    #[test]
    fn test_scenario_ffi_contributing_factor() {
        let methods = vec![TopMethod {
            method: "ExternalMethodRef>>primCallC:".to_string(),
            category: "FFI/External".to_string(),
            percentage: 25.3,
        }];
        let scenario = reconstruct_scenario(&[], &methods, "");
        assert!(scenario
            .contributing_factors
            .iter()
            .any(|f| f.contains("FFI")));
    }

    #[test]
    fn test_scenario_impact_capped_at_75() {
        // 6 high-severity patterns → 6 × 15 = 90, should cap at 75
        let patterns: Vec<DetectedPattern> = (0..6)
            .map(|i| DetectedPattern {
                pattern_type: format!("pattern_{}", i),
                severity: "high".to_string(),
                title: "Test".to_string(),
                description: "test".to_string(),
                confidence: 90.0,
            })
            .collect();
        let scenario = reconstruct_scenario(&patterns, &[], "");
        assert_eq!(scenario.impact_percentage, 75.0);
    }
}
