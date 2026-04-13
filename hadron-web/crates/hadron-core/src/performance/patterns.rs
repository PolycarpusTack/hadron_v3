use super::types::{
    DerivedMetrics, DetectedPattern, PerformanceHeader, ProcessInfo, Recommendation, TopMethod,
};

/// Detect performance patterns from parsed trace data.
pub fn detect_patterns(
    header: &PerformanceHeader,
    derived: &DerivedMetrics,
    processes: &[ProcessInfo],
    methods: &[TopMethod],
    content: &str,
) -> Vec<DetectedPattern> {
    let mut patterns = Vec::new();

    // 1. GC Pressure
    if derived.gc_pressure > 1.0 || header.scavenges > 5000 {
        patterns.push(DetectedPattern {
            pattern_type: "gc_pressure".to_string(),
            severity: if derived.gc_pressure > 2.0 {
                "high".to_string()
            } else {
                "medium".to_string()
            },
            title: "Elevated GC Activity".to_string(),
            description: format!(
                "GC pressure at {:.2} with {} scavenges indicates memory pressure",
                derived.gc_pressure, header.scavenges
            ),
            confidence: 90.0,
        });
    }

    // 2. UI Rendering overhead
    let ui_percentage: f64 = methods
        .iter()
        .filter(|m| m.category == "Graphics" || m.category == "UI Rendering")
        .map(|m| m.percentage)
        .sum();

    if ui_percentage > 10.0 {
        patterns.push(DetectedPattern {
            pattern_type: "ui_rendering".to_string(),
            severity: if ui_percentage > 20.0 {
                "high".to_string()
            } else {
                "medium".to_string()
            },
            title: "UI Rendering Overhead".to_string(),
            description: format!(
                "Graphics and UI operations consuming {:.1}% of CPU time",
                ui_percentage
            ),
            confidence: 85.0,
        });
    }

    // 3. Database activity
    let db_percentage: f64 = methods
        .iter()
        .filter(|m| m.category == "Database")
        .map(|m| m.percentage)
        .sum();

    if db_percentage > 5.0 {
        let severity = if db_percentage > 15.0 {
            "high"
        } else if db_percentage > 8.0 {
            "medium"
        } else {
            "low"
        };
        patterns.push(DetectedPattern {
            pattern_type: "database".to_string(),
            severity: severity.to_string(),
            title: "Database Activity".to_string(),
            description: format!(
                "Database operations consuming {:.1}% of CPU time",
                db_percentage
            ),
            confidence: 90.0,
        });
    }

    // 4. Changelog sync
    if content.contains("ChangeLogSynchronizer") || content.contains("changelog") {
        patterns.push(DetectedPattern {
            pattern_type: "changelog_sync".to_string(),
            severity: "high".to_string(),
            title: "Change Log Synchronization".to_string(),
            description:
                "Multi-user synchronization activity detected - processing changes from other users"
                    .to_string(),
            confidence: 95.0,
        });
    }

    // 5. Widget update cascade
    if content.contains("updateWidgetsInApplications") || content.contains("widgetUpdate") {
        patterns.push(DetectedPattern {
            pattern_type: "widget_update".to_string(),
            severity: "medium".to_string(),
            title: "Widget Update Cascade".to_string(),
            description: "Cascading widget updates detected - all open windows being refreshed"
                .to_string(),
            confidence: 92.0,
        });
    }

    // 6. Low activity ratio
    if derived.activity_ratio < 25.0 && derived.activity_ratio > 0.0 {
        patterns.push(DetectedPattern {
            pattern_type: "low_activity".to_string(),
            severity: "info".to_string(),
            title: "Low Smalltalk Activity Ratio".to_string(),
            description: format!(
                "Only {:.1}% of time in Smalltalk code - system may be waiting on external resources",
                derived.activity_ratio
            ),
            confidence: 85.0,
        });
    }

    // 7. User interaction
    if content.contains("YellowButtonPressedEvent") || content.contains("right-click") {
        patterns.push(DetectedPattern {
            pattern_type: "user_interaction".to_string(),
            severity: "info".to_string(),
            title: "Right-Click List Selection".to_string(),
            description: "User performed right-click selection in a list widget".to_string(),
            confidence: 95.0,
        });
    }

    // 8. Idle process
    for process in processes {
        if process.name.contains("Idle") && process.percentage > 8.0 {
            patterns.push(DetectedPattern {
                pattern_type: "idle_process".to_string(),
                severity: "warning".to_string(),
                title: "Elevated Idle Process".to_string(),
                description: format!(
                    "IdleLoopProcess at {:.1}% indicates system waiting or GC activity",
                    process.percentage
                ),
                confidence: 88.0,
            });
            break;
        }
    }

    patterns
}

/// Generate recommendations based on detected patterns and derived metrics.
pub fn generate_recommendations(
    patterns: &[DetectedPattern],
    derived: &DerivedMetrics,
) -> Vec<Recommendation> {
    let mut recommendations = Vec::new();

    if patterns.iter().any(|p| p.pattern_type == "gc_pressure") {
        recommendations.push(Recommendation {
            rec_type: "optimization".to_string(),
            priority: "medium".to_string(),
            title: "Review Memory Allocation".to_string(),
            description: "Consider reviewing code for excessive object creation or retention"
                .to_string(),
            effort: "Medium".to_string(),
        });
    }

    if patterns.iter().any(|p| p.pattern_type == "ui_rendering") {
        recommendations.push(Recommendation {
            rec_type: "optimization".to_string(),
            priority: "medium".to_string(),
            title: "Review List Rendering".to_string(),
            description: "Consider implementing virtual scrolling for lists with many items"
                .to_string(),
            effort: "Medium".to_string(),
        });
    }

    if patterns.iter().any(|p| p.pattern_type == "changelog_sync") {
        recommendations.push(Recommendation {
            rec_type: "documentation".to_string(),
            priority: "high".to_string(),
            title: "Expected Multi-User Behavior".to_string(),
            description:
                "This is normal behavior when other users commit changes. Document for user awareness."
                    .to_string(),
            effort: "None".to_string(),
        });
        recommendations.push(Recommendation {
            rec_type: "workaround".to_string(),
            priority: "medium".to_string(),
            title: "Close Unused Windows".to_string(),
            description:
                "Users can close windows they are not actively using to reduce sync overhead"
                    .to_string(),
            effort: "None".to_string(),
        });
    }

    if patterns.iter().any(|p| p.pattern_type == "widget_update") {
        recommendations.push(Recommendation {
            rec_type: "optimization".to_string(),
            priority: "low".to_string(),
            title: "Incremental Widget Updates".to_string(),
            description: "Investigate selective widget refresh instead of full hierarchy update"
                .to_string(),
            effort: "High".to_string(),
        });
    }

    if derived.activity_ratio < 25.0 && derived.activity_ratio > 0.0 {
        recommendations.push(Recommendation {
            rec_type: "investigation".to_string(),
            priority: "medium".to_string(),
            title: "Investigate External Waits".to_string(),
            description: "Low Smalltalk activity suggests waiting on I/O or external services"
                .to_string(),
            effort: "Medium".to_string(),
        });
    }

    if recommendations.is_empty() {
        recommendations.push(Recommendation {
            rec_type: "documentation".to_string(),
            priority: "low".to_string(),
            title: "Normal Operation".to_string(),
            description: "No significant performance issues detected. Continue monitoring."
                .to_string(),
            effort: "None".to_string(),
        });
    }

    recommendations
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::performance::types::{DerivedMetrics, PerformanceHeader, ProcessInfo, TopMethod};

    fn default_header() -> PerformanceHeader {
        PerformanceHeader {
            samples: 1500,
            scavenges: 3000,
            inc_gcs: 50,
            active_time: 3.75,
            other_processes: 0.5,
            real_time: 5.0,
            ..Default::default()
        }
    }

    fn default_derived() -> DerivedMetrics {
        DerivedMetrics {
            cpu_utilization: 85.0,
            activity_ratio: 75.0,
            sample_density: 400.0,
            gc_pressure: 2.03,
        }
    }


    #[test]
    fn test_detect_gc_pressure() {
        let mut header = default_header();
        header.scavenges = 6000; // > 5000 threshold
        let derived = DerivedMetrics {
            gc_pressure: 2.5, // > 2.0 → high
            ..default_derived()
        };
        let patterns = detect_patterns(&header, &derived, &[], &[], "");
        let gc = patterns.iter().find(|p| p.pattern_type == "gc_pressure");
        assert!(gc.is_some(), "GC pressure pattern should be detected");
        assert_eq!(gc.unwrap().severity, "high");
    }

    #[test]
    fn test_detect_database_activity() {
        let header = default_header();
        let derived = DerivedMetrics {
            gc_pressure: 0.1, // no GC pressure
            ..default_derived()
        };
        let methods = vec![TopMethod {
            method: "PostgresSession>>execute".to_string(),
            category: "Database".to_string(),
            percentage: 10.0, // > 5% threshold
        }];
        let patterns = detect_patterns(&header, &derived, &[], &methods, "");
        let db = patterns.iter().find(|p| p.pattern_type == "database");
        assert!(db.is_some(), "Database pattern should be detected");
        assert_eq!(db.unwrap().severity, "medium"); // 10% → between 8 and 15 → medium
    }

    #[test]
    fn test_detect_changelog_sync() {
        let header = default_header();
        let derived = default_derived();
        let content = "ChangeLogSynchronizer processChanges";
        let patterns = detect_patterns(&header, &derived, &[], &[], content);
        let cl = patterns.iter().find(|p| p.pattern_type == "changelog_sync");
        assert!(cl.is_some(), "Changelog sync pattern should be detected");
        assert_eq!(cl.unwrap().severity, "high");
        assert!((cl.unwrap().confidence - 95.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_no_false_positives() {
        // Clean header: low scavenges, no bad content, moderate activity
        let header = PerformanceHeader {
            samples: 500,
            scavenges: 10,
            inc_gcs: 2,
            active_time: 4.0,
            real_time: 5.0,
            other_processes: 0.2,
            ..Default::default()
        };
        let derived = DerivedMetrics {
            cpu_utilization: 84.0,
            activity_ratio: 80.0,
            sample_density: 125.0,
            gc_pressure: 0.024, // very low: 12/500
        };
        let methods = vec![TopMethod {
            method: "SomeApplication>>doSomething".to_string(),
            category: "Other".to_string(),
            percentage: 3.0,
        }];
        let processes = vec![ProcessInfo {
            name: "LauncherProcess".to_string(),
            priority: "50".to_string(),
            percentage: 90.0,
            status: "normal".to_string(),
        }];
        let patterns = detect_patterns(&header, &derived, &processes, &methods, "normal content");

        // gc_pressure check: 0.024 < 1.0 and scavenges 10 < 5000 → no GC pattern
        assert!(patterns.iter().all(|p| p.pattern_type != "gc_pressure"));
        // No changelog
        assert!(patterns.iter().all(|p| p.pattern_type != "changelog_sync"));
        // No DB (3% < 5%)
        assert!(patterns.iter().all(|p| p.pattern_type != "database"));
    }

    #[test]
    fn test_recommendations_for_gc() {
        let patterns = vec![DetectedPattern {
            pattern_type: "gc_pressure".to_string(),
            severity: "high".to_string(),
            title: "Elevated GC Activity".to_string(),
            description: "test".to_string(),
            confidence: 90.0,
        }];
        let derived = default_derived();
        let recs = generate_recommendations(&patterns, &derived);
        assert!(recs.iter().any(|r| r.title == "Review Memory Allocation"));
    }

    #[test]
    fn test_recommendations_empty_patterns() {
        let derived = DerivedMetrics {
            activity_ratio: 75.0, // > 25% so no low_activity rec
            ..default_derived()
        };
        let recs = generate_recommendations(&[], &derived);
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].title, "Normal Operation");
    }
}
