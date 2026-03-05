//! Performance trace analysis commands
//!
//! Parses VisualWorks Smalltalk performance trace files and provides
//! structured analysis results including header stats, derived metrics,
//! process distribution, top methods, detected patterns, user scenario
//! reconstruction, and recommendations.

use crate::commands::common::{
    DbState, MAX_PERFORMANCE_TRACE_SIZE_BYTES, normalize_severity, validate_file_path,
};
use crate::database::Analysis;
use crate::error::{CommandResult, HadronError};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use std::sync::Arc;
use std::time::Instant;
use tokio::fs as async_fs;

// ============================================================================
// Types
// ============================================================================

/// Performance trace header statistics
#[derive(Serialize, Clone)]
pub struct PerformanceHeader {
    pub samples: i64,
    pub avg_ms_per_sample: f64,
    pub scavenges: i64,
    pub inc_gcs: i64,
    pub stack_spills: i64,
    pub mark_stack_overflows: i64,
    pub weak_list_overflows: i64,
    pub jit_cache_spills: i64,
    pub active_time: f64,
    pub other_processes: f64,
    pub real_time: f64,
    pub profiling_overhead: f64,
}

/// Derived performance metrics
#[derive(Serialize, Clone)]
pub struct DerivedMetrics {
    pub cpu_utilization: f64,
    pub smalltalk_activity_ratio: f64,
    pub sample_density: f64,
    pub gc_pressure: f64,
}

/// Process info from performance trace
#[derive(Serialize, Clone)]
pub struct ProcessInfo {
    pub name: String,
    pub priority: String,
    pub percentage: f64,
    pub status: String,
}

/// Top method info
#[derive(Serialize, Clone)]
pub struct TopMethod {
    pub method: String,
    pub percentage: f64,
    pub category: String,
}

/// Detected performance pattern
#[derive(Serialize, Clone)]
pub struct DetectedPattern {
    pub r#type: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub confidence: i32,
}

/// User scenario reconstruction
#[derive(Serialize, Clone)]
pub struct UserScenario {
    pub trigger: String,
    pub action: String,
    pub context: String,
    pub impact: String,
    pub additional_factors: Vec<String>,
}

/// Performance recommendation
#[derive(Serialize, Clone)]
pub struct PerformanceRecommendation {
    pub r#type: String,
    pub priority: String,
    pub title: String,
    pub description: String,
    pub effort: String,
}

/// Full performance analysis result
#[derive(Serialize, Clone)]
pub struct PerformanceAnalysisResult {
    pub filename: String,
    pub user: String,
    pub timestamp: String,
    pub header: PerformanceHeader,
    pub derived: DerivedMetrics,
    pub processes: Vec<ProcessInfo>,
    pub top_methods: Vec<TopMethod>,
    pub patterns: Vec<DetectedPattern>,
    pub scenario: UserScenario,
    pub recommendations: Vec<PerformanceRecommendation>,
    pub overall_severity: String,
    pub summary: String,
}

// ============================================================================
// Tauri Command
// ============================================================================

/// Parse and analyze a VisualWorks Smalltalk performance trace file
#[tauri::command]
pub async fn analyze_performance_trace(
    file_path: String,
    db: DbState<'_>,
) -> CommandResult<PerformanceAnalysisResult> {
    log::debug!("cmd: analyze_performance_trace");
    log::info!("Analyzing performance trace: {}", file_path);
    let start_time = Instant::now();

    // SECURITY: Validate file path before reading (canonicalization, blocklist, size limit)
    let canonical_path = validate_file_path(&file_path, MAX_PERFORMANCE_TRACE_SIZE_BYTES)
        .await
        .map_err(HadronError::Validation)?;

    // Read the file from validated path
    let content = async_fs::read_to_string(&canonical_path)
        .await
        .map_err(|e| {
            log::error!(
                "Failed to read performance trace '{}': {}",
                canonical_path.display(),
                e
            );
            HadronError::Io(e)
        })?;
    let metadata = async_fs::metadata(&canonical_path).await.map_err(|e| {
        log::error!(
            "Failed to read performance trace metadata '{}': {}",
            canonical_path.display(),
            e
        );
        HadronError::Io(e)
    })?;

    let filename = canonical_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown.log")
        .to_string();

    // Move CPU-bound parsing to blocking thread pool to avoid starving the async executor
    let filename_for_parse = filename.clone();
    let result = tauri::async_runtime::spawn_blocking(move || parse_performance_trace(&content, &filename_for_parse))
        .await?
        .map_err(HadronError::Parse)?;

    let duration_ms = start_time.elapsed().as_millis() as i32;
    let severity = normalize_severity(&result.overall_severity);
    let suggested_fixes: Vec<String> = result
        .recommendations
        .iter()
        .map(|rec| format!("{}: {}", rec.title, rec.description))
        .collect();

    let analysis = Analysis {
        id: 0,
        filename: filename.clone(),
        file_size_kb: metadata.len() as f64 / 1024.0,
        error_type: "PerformanceTrace".to_string(),
        error_message: None,
        severity,
        component: None,
        stack_trace: None,
        root_cause: result.summary.clone(),
        suggested_fixes: serde_json::to_string(&suggested_fixes).unwrap_or_else(|e| {
            log::warn!("Failed to serialize performance suggestions: {}", e);
            "[]".to_string()
        }),
        confidence: None,
        analyzed_at: chrono::Utc::now().to_rfc3339(),
        ai_model: "performance-analyzer".to_string(),
        ai_provider: Some("local".to_string()),
        tokens_used: 0,
        cost: 0.0,
        was_truncated: false,
        full_data: Some(serde_json::to_string(&result).unwrap_or_else(|e| {
            log::warn!("Failed to serialize performance analysis result: {}", e);
            "{}".to_string()
        })),
        is_favorite: false,
        last_viewed_at: None,
        view_count: 0,
        analysis_duration_ms: Some(duration_ms),
        analysis_type: "performance".to_string(),
    };

    let db_clone = Arc::clone(&db);
    let severity_for_log = analysis.severity.clone();
    let id = tauri::async_runtime::spawn_blocking(move || db_clone.insert_analysis(&analysis))
        .await??;

    log::info!(
        "Performance analysis saved: id={}, file={}, severity={}",
        id,
        file_path,
        severity_for_log
    );

    Ok(result)
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Parse performance trace content
fn parse_performance_trace(
    content: &str,
    filename: &str,
) -> Result<PerformanceAnalysisResult, String> {
    let lines: Vec<&str> = content.lines().collect();

    // Extract user and timestamp from filename
    // Format: performanceTrace_username_YYYY-MM-DD_HH-MM-SS.log
    let (user, timestamp) = extract_user_timestamp(filename);

    // Parse header section
    let header = parse_header(&lines)?;

    // Calculate derived metrics
    let derived = calculate_derived_metrics(&header);

    // Parse process distribution
    let processes = parse_processes(&lines);

    // Parse top methods
    let top_methods = parse_top_methods(&lines);

    // Detect patterns
    let patterns = detect_patterns(&header, &derived, &processes, &top_methods, &lines);

    // Reconstruct user scenario
    let scenario = reconstruct_scenario(&patterns, &top_methods, &lines);

    // Generate recommendations
    let recommendations = generate_recommendations(&patterns, &header, &derived);

    // Determine overall severity
    let overall_severity = determine_severity(&patterns);

    // Generate summary
    let summary = generate_summary(&patterns, &header, &derived);

    Ok(PerformanceAnalysisResult {
        filename: filename.to_string(),
        user,
        timestamp,
        header,
        derived,
        processes,
        top_methods,
        patterns,
        scenario,
        recommendations,
        overall_severity,
        summary,
    })
}

fn extract_user_timestamp(filename: &str) -> (String, String) {
    // Try to parse: performanceTrace_username_YYYY-MM-DD_HH-MM-SS.log
    let parts: Vec<&str> = filename
        .trim_start_matches("performanceTrace_")
        .trim_end_matches(".log")
        .splitn(3, '_')
        .collect();

    if parts.len() >= 2 {
        let user = parts[0].replace('_', " ");
        let date_time = if parts.len() >= 3 {
            format!("{} {}", parts[1], parts[2].replace('-', ":"))
        } else {
            parts[1].to_string()
        };
        (user, date_time)
    } else {
        (
            "Unknown".to_string(),
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        )
    }
}

fn parse_header(lines: &[&str]) -> Result<PerformanceHeader, String> {
    let mut header = PerformanceHeader {
        samples: 0,
        avg_ms_per_sample: 0.0,
        scavenges: 0,
        inc_gcs: 0,
        stack_spills: 0,
        mark_stack_overflows: 0,
        weak_list_overflows: 0,
        jit_cache_spills: 0,
        active_time: 0.0,
        other_processes: 0.0,
        real_time: 0.0,
        profiling_overhead: 0.0,
    };

    for line in lines {
        let line = line.trim();

        // Parse various header fields
        if line.starts_with("Samples:") || line.contains("samples") {
            if let Some(num) = extract_number(line) {
                header.samples = num as i64;
            }
        } else if line.contains("ms/sample") || line.contains("msPerSample") {
            if let Some(num) = extract_float(line) {
                header.avg_ms_per_sample = num;
            }
        } else if line.starts_with("Scavenges:") || line.contains("scavenges") {
            if let Some(num) = extract_number(line) {
                header.scavenges = num as i64;
            }
        } else if line.contains("incGC") || line.contains("incremental GC") {
            if let Some(num) = extract_number(line) {
                header.inc_gcs = num as i64;
            }
        } else if line.contains("stackSpill") || line.contains("stack spill") {
            if let Some(num) = extract_number(line) {
                header.stack_spills = num as i64;
            }
        } else if line.contains("markStackOverflow") {
            if let Some(num) = extract_number(line) {
                header.mark_stack_overflows = num as i64;
            }
        } else if line.contains("weakListOverflow") {
            if let Some(num) = extract_number(line) {
                header.weak_list_overflows = num as i64;
            }
        } else if line.contains("jitCacheSpill") {
            if let Some(num) = extract_number(line) {
                header.jit_cache_spills = num as i64;
            }
        } else if line.contains("active time") || line.contains("activeTime") {
            if let Some(num) = extract_float(line) {
                header.active_time = num;
            }
        } else if line.contains("other processes") || line.contains("otherProcesses") {
            if let Some(num) = extract_float(line) {
                header.other_processes = num;
            }
        } else if line.contains("real time") || line.contains("realTime") {
            if let Some(num) = extract_float(line) {
                header.real_time = num;
            }
        } else if line.contains("profiling overhead") {
            if let Some(num) = extract_float(line) {
                header.profiling_overhead = num;
            }
        }
    }

    // Default real time if not found
    if header.real_time == 0.0 && header.active_time > 0.0 {
        header.real_time = header.active_time + header.other_processes;
    }

    Ok(header)
}

fn extract_number(text: &str) -> Option<f64> {
    static NUM_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"[\d,]+(?:\.\d+)?").expect("NUM_RE is a valid regex pattern")
    });

    NUM_RE
        .find(text)
        .and_then(|m| m.as_str().replace(',', "").parse::<f64>().ok())
}

fn extract_float(text: &str) -> Option<f64> {
    static FLOAT_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"\d+\.?\d*").expect("FLOAT_RE is a valid regex pattern")
    });

    FLOAT_RE
        .find(text)
        .and_then(|m| m.as_str().parse::<f64>().ok())
}

fn calculate_derived_metrics(header: &PerformanceHeader) -> DerivedMetrics {
    let total_time = header.active_time + header.other_processes;
    let cpu_utilization = if total_time > 0.0 {
        (total_time / header.real_time.max(total_time)) * 100.0
    } else {
        0.0
    };

    let smalltalk_activity_ratio = if header.real_time > 0.0 {
        (header.active_time / header.real_time) * 100.0
    } else {
        0.0
    };

    let sample_density = if header.active_time > 0.0 {
        header.samples as f64 / header.active_time
    } else {
        0.0
    };

    let gc_pressure = if header.samples > 0 {
        (header.scavenges + header.inc_gcs) as f64 / header.samples as f64
    } else {
        0.0
    };

    DerivedMetrics {
        cpu_utilization: (cpu_utilization * 10.0).round() / 10.0,
        smalltalk_activity_ratio: (smalltalk_activity_ratio * 10.0).round() / 10.0,
        sample_density: (sample_density * 10.0).round() / 10.0,
        gc_pressure: (gc_pressure * 100.0).round() / 100.0,
    }
}

fn parse_processes(lines: &[&str]) -> Vec<ProcessInfo> {
    let mut processes = Vec::new();
    let mut in_process_section = false;

    static PROCESS_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)([A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(?:@\s*)?(\d+|-)\s+(\d+\.?\d*)%?")
            .expect("PROCESS_RE is a valid regex pattern")
    });

    for line in lines {
        let line = line.trim();

        // Look for process section markers
        if line.contains("Process") && (line.contains("Priority") || line.contains("Samples")) {
            in_process_section = true;
            continue;
        }

        // End of section
        if in_process_section && line.is_empty() {
            in_process_section = false;
            continue;
        }

        if in_process_section {
            if let Some(caps) = PROCESS_RE.captures(line) {
                let name = caps.get(1).map_or("", |m| m.as_str()).to_string();
                let priority = caps.get(2).map_or("-", |m| m.as_str()).to_string();
                let percentage: f64 = caps
                    .get(3)
                    .and_then(|m| m.as_str().parse().ok())
                    .unwrap_or(0.0);

                let status = if (name.contains("Idle") && percentage > 8.0)
                    || (percentage > 90.0 && !name.contains("Launcher"))
                {
                    "warning"
                } else {
                    "normal"
                };

                processes.push(ProcessInfo {
                    name,
                    priority,
                    percentage,
                    status: status.to_string(),
                });
            }
        }
    }

    processes
}

fn parse_top_methods(lines: &[&str]) -> Vec<TopMethod> {
    let mut methods = Vec::new();
    let mut in_methods_section = false;

    static METHOD_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(\d+\.?\d*)%?\s+(.+)").expect("METHOD_RE is a valid regex pattern")
    });

    for line in lines {
        let line = line.trim();

        // Look for method section markers
        if line.contains("Totals") || line.contains("Self-Time") || line.contains("self time") {
            in_methods_section = true;
            continue;
        }

        // End of section marker
        if in_methods_section && (line.is_empty() || line.starts_with("===")) {
            if methods.len() >= 8 {
                break;
            }
            continue;
        }

        if in_methods_section && !line.is_empty() {
            if let Some(caps) = METHOD_RE.captures(line) {
                let percentage: f64 = caps
                    .get(1)
                    .and_then(|m| m.as_str().parse().ok())
                    .unwrap_or(0.0);
                let method = caps.get(2).map_or("", |m| m.as_str()).trim().to_string();

                if percentage > 0.0 && !method.is_empty() && methods.len() < 8 {
                    let category = categorize_method(&method);
                    methods.push(TopMethod {
                        method,
                        percentage,
                        category,
                    });
                }
            }
        }
    }

    methods
}

fn categorize_method(method: &str) -> String {
    let method_lower = method.to_lowercase();

    if method_lower.contains("primcallc")
        || method_lower.contains("external")
        || method_lower.contains("ffi")
    {
        "FFI/External".to_string()
    } else if method_lower.contains("graphicscontext")
        || method_lower.contains("paint")
        || method_lower.contains("display")
    {
        "Graphics".to_string()
    } else if method_lower.contains("gc")
        || method_lower.contains("scavenge")
        || method_lower.contains("memory")
        || method_lower.contains("weakarray")
    {
        "GC".to_string()
    } else if method_lower.contains("postgres")
        || method_lower.contains("oracle")
        || method_lower.contains("database")
        || method_lower.contains("sql")
        || method_lower.contains("session")
    {
        "Database".to_string()
    } else if method_lower.contains("maf")
        || method_lower.contains("widget")
        || method_lower.contains("column")
        || method_lower.contains("label")
        || method_lower.contains("button")
    {
        "UI Rendering".to_string()
    } else if method_lower.contains("collection")
        || method_lower.contains("array")
        || method_lower.contains("do:")
        || method_lower.contains("select:")
        || method_lower.contains("orderedcollection")
    {
        "Collection".to_string()
    } else if method_lower.contains("session") || method_lower.contains("t3session") {
        "Session".to_string()
    } else {
        "Other".to_string()
    }
}

fn detect_patterns(
    header: &PerformanceHeader,
    derived: &DerivedMetrics,
    processes: &[ProcessInfo],
    top_methods: &[TopMethod],
    lines: &[&str],
) -> Vec<DetectedPattern> {
    let mut patterns = Vec::new();
    let content = lines.join("\n");

    // Check for GC pressure
    if derived.gc_pressure > 1.0 || header.scavenges > 5000 {
        patterns.push(DetectedPattern {
            r#type: "gc_pressure".to_string(),
            severity: if derived.gc_pressure > 2.0 {
                "high"
            } else {
                "medium"
            }
            .to_string(),
            title: "Elevated GC Activity".to_string(),
            description: format!(
                "GC pressure at {:.2} with {} scavenges indicates memory pressure",
                derived.gc_pressure, header.scavenges
            ),
            confidence: 90,
        });
    }

    // Check for UI rendering overhead
    let ui_percentage: f64 = top_methods
        .iter()
        .filter(|m| m.category == "Graphics" || m.category == "UI Rendering")
        .map(|m| m.percentage)
        .sum();

    if ui_percentage > 10.0 {
        patterns.push(DetectedPattern {
            r#type: "ui_rendering".to_string(),
            severity: if ui_percentage > 20.0 {
                "high"
            } else {
                "medium"
            }
            .to_string(),
            title: "UI Rendering Overhead".to_string(),
            description: format!(
                "Graphics and UI operations consuming {:.1}% of CPU time",
                ui_percentage
            ),
            confidence: 85,
        });
    }

    // Check for database activity
    let db_percentage: f64 = top_methods
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
            r#type: "database".to_string(),
            severity: severity.to_string(),
            title: "Database Activity".to_string(),
            description: format!(
                "Database operations consuming {:.1}% of CPU time",
                db_percentage
            ),
            confidence: 90,
        });
    }

    // Check for changelog sync (WHATS'ON specific)
    if content.contains("ChangeLogSynchronizer") || content.contains("changelog") {
        patterns.push(DetectedPattern {
            r#type: "changelog_sync".to_string(),
            severity: "high".to_string(),
            title: "Change Log Synchronization".to_string(),
            description:
                "Multi-user synchronization activity detected - processing changes from other users"
                    .to_string(),
            confidence: 95,
        });
    }

    // Check for widget update cascade
    if content.contains("updateWidgetsInApplications") || content.contains("widgetUpdate") {
        patterns.push(DetectedPattern {
            r#type: "widget_update".to_string(),
            severity: "medium".to_string(),
            title: "Widget Update Cascade".to_string(),
            description: "Cascading widget updates detected - all open windows being refreshed"
                .to_string(),
            confidence: 92,
        });
    }

    // Check for low activity ratio
    if derived.smalltalk_activity_ratio < 25.0 && derived.smalltalk_activity_ratio > 0.0 {
        patterns.push(DetectedPattern {
            r#type: "low_activity".to_string(),
            severity: "info".to_string(),
            title: "Low Smalltalk Activity Ratio".to_string(),
            description: format!(
                "Only {:.1}% of time in Smalltalk code - system may be waiting on external resources",
                derived.smalltalk_activity_ratio
            ),
            confidence: 85,
        });
    }

    // Check for user interaction patterns
    if content.contains("YellowButtonPressedEvent") || content.contains("right-click") {
        patterns.push(DetectedPattern {
            r#type: "user_interaction".to_string(),
            severity: "info".to_string(),
            title: "Right-Click List Selection".to_string(),
            description: "User performed right-click selection in a list widget".to_string(),
            confidence: 95,
        });
    }

    // Check for high idle process
    for process in processes {
        if process.name.contains("Idle") && process.percentage > 8.0 {
            patterns.push(DetectedPattern {
                r#type: "idle_process".to_string(),
                severity: "warning".to_string(),
                title: "Elevated Idle Process".to_string(),
                description: format!(
                    "IdleLoopProcess at {:.1}% indicates system waiting or GC activity",
                    process.percentage
                ),
                confidence: 88,
            });
            break;
        }
    }

    patterns
}

fn reconstruct_scenario(
    patterns: &[DetectedPattern],
    top_methods: &[TopMethod],
    lines: &[&str],
) -> UserScenario {
    let content = lines.join("\n");

    // Determine trigger based on patterns
    let trigger = if patterns.iter().any(|p| p.r#type == "changelog_sync") {
        "Change Log Polling (automatic)".to_string()
    } else if patterns.iter().any(|p| p.r#type == "user_interaction") {
        "User interaction (mouse/keyboard)".to_string()
    } else if patterns.iter().any(|p| p.r#type == "database") {
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
    let context = if patterns.iter().any(|p| p.r#type == "widget_update") {
        "The system processed changes and propagated updates to all open application windows"
            .to_string()
    } else if patterns.iter().any(|p| p.r#type == "ui_rendering") {
        "UI rendering operations were active during the trace period".to_string()
    } else {
        "Standard application operation".to_string()
    };

    // Calculate impact
    let total_impact: f64 = patterns
        .iter()
        .filter(|p| p.severity == "high" || p.severity == "medium")
        .count() as f64
        * 15.0;
    let impact = format!(
        "Detected patterns consumed approximately {:.0}% of active processing time",
        total_impact.min(75.0)
    );

    // Additional factors
    let mut factors = Vec::new();
    if patterns.iter().any(|p| p.r#type == "gc_pressure") {
        factors.push("Memory pressure requiring frequent garbage collection".to_string());
    }
    if patterns.iter().any(|p| p.r#type == "ui_rendering") {
        factors.push("Complex UI rendering with multiple components".to_string());
    }
    if top_methods.iter().any(|m| m.category == "FFI/External") {
        factors.push("External function calls (FFI) contributing to overhead".to_string());
    }

    UserScenario {
        trigger,
        action,
        context,
        impact,
        additional_factors: factors,
    }
}

fn generate_recommendations(
    patterns: &[DetectedPattern],
    _header: &PerformanceHeader,
    derived: &DerivedMetrics,
) -> Vec<PerformanceRecommendation> {
    let mut recommendations = Vec::new();

    // GC-related recommendations
    if patterns.iter().any(|p| p.r#type == "gc_pressure") {
        recommendations.push(PerformanceRecommendation {
            r#type: "optimization".to_string(),
            priority: "medium".to_string(),
            title: "Review Memory Allocation".to_string(),
            description: "Consider reviewing code for excessive object creation or retention"
                .to_string(),
            effort: "Medium".to_string(),
        });
    }

    // UI rendering recommendations
    if patterns.iter().any(|p| p.r#type == "ui_rendering") {
        recommendations.push(PerformanceRecommendation {
            r#type: "optimization".to_string(),
            priority: "medium".to_string(),
            title: "Review List Rendering".to_string(),
            description: "Consider implementing virtual scrolling for lists with many items"
                .to_string(),
            effort: "Medium".to_string(),
        });
    }

    // Changelog sync recommendations
    if patterns.iter().any(|p| p.r#type == "changelog_sync") {
        recommendations.push(PerformanceRecommendation {
            r#type: "documentation".to_string(),
            priority: "high".to_string(),
            title: "Expected Multi-User Behavior".to_string(),
            description: "This is normal behavior when other users commit changes. Document for user awareness.".to_string(),
            effort: "None".to_string(),
        });
        recommendations.push(PerformanceRecommendation {
            r#type: "workaround".to_string(),
            priority: "medium".to_string(),
            title: "Close Unused Windows".to_string(),
            description:
                "Users can close windows they are not actively using to reduce sync overhead"
                    .to_string(),
            effort: "None".to_string(),
        });
    }

    // Widget update recommendations
    if patterns.iter().any(|p| p.r#type == "widget_update") {
        recommendations.push(PerformanceRecommendation {
            r#type: "optimization".to_string(),
            priority: "low".to_string(),
            title: "Incremental Widget Updates".to_string(),
            description: "Investigate selective widget refresh instead of full hierarchy update"
                .to_string(),
            effort: "High".to_string(),
        });
    }

    // Low activity recommendations
    if derived.smalltalk_activity_ratio < 25.0 {
        recommendations.push(PerformanceRecommendation {
            r#type: "investigation".to_string(),
            priority: "medium".to_string(),
            title: "Investigate External Waits".to_string(),
            description: "Low Smalltalk activity suggests waiting on I/O or external services"
                .to_string(),
            effort: "Medium".to_string(),
        });
    }

    // Default recommendations if none generated
    if recommendations.is_empty() {
        recommendations.push(PerformanceRecommendation {
            r#type: "documentation".to_string(),
            priority: "low".to_string(),
            title: "Normal Operation".to_string(),
            description: "No significant performance issues detected. Continue monitoring."
                .to_string(),
            effort: "None".to_string(),
        });
    }

    recommendations
}

fn determine_severity(patterns: &[DetectedPattern]) -> String {
    if patterns.iter().any(|p| p.severity == "critical") {
        "critical".to_string()
    } else if patterns.iter().any(|p| p.severity == "high") {
        "high".to_string()
    } else if patterns.iter().any(|p| p.severity == "medium") {
        "medium".to_string()
    } else if patterns.iter().any(|p| p.severity == "low") {
        "low".to_string()
    } else {
        "info".to_string()
    }
}

fn generate_summary(
    patterns: &[DetectedPattern],
    header: &PerformanceHeader,
    derived: &DerivedMetrics,
) -> String {
    let high_count = patterns.iter().filter(|p| p.severity == "high").count();
    let medium_count = patterns.iter().filter(|p| p.severity == "medium").count();

    if high_count > 0 {
        let main_issue = patterns
            .iter()
            .find(|p| p.severity == "high")
            .map(|p| p.title.clone())
            .unwrap_or_else(|| "Performance issues".to_string());
        format!(
            "Significant performance impact detected. Primary issue: {}. {} high and {} medium severity patterns found.",
            main_issue, high_count, medium_count
        )
    } else if medium_count > 0 {
        format!(
            "Moderate performance overhead detected with {} patterns. CPU utilization at {:.1}%, Smalltalk activity at {:.1}%.",
            medium_count, derived.cpu_utilization, derived.smalltalk_activity_ratio
        )
    } else {
        format!(
            "Normal operation detected. {} samples collected over {:.1} seconds with {:.1}% CPU utilization.",
            header.samples, header.real_time, derived.cpu_utilization
        )
    }
}
