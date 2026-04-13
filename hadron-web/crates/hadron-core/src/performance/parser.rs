use std::sync::OnceLock;

use regex::Regex;

use crate::error::{HadronError, HadronResult};

use super::metrics::compute_derived;
use super::patterns::{detect_patterns, generate_recommendations};
use super::scenario::reconstruct_scenario;
use super::types::{
    PerformanceHeader, PerformanceTraceResult, ProcessInfo, TopMethod,
};

/// Maximum accepted file size (10 MB).
const MAX_FILE_SIZE: usize = 10 * 1024 * 1024;

// ============================================================================
// Compiled regex helpers (OnceLock for lazy static init)
// ============================================================================

fn num_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[\d,]+(?:\.\d+)?").unwrap())
}

fn float_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\d+\.?\d*").unwrap())
}

fn process_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)([A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(?:@\s*)?(\d+|-)\s+(\d+\.?\d*)%?")
            .unwrap()
    })
}

fn method_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(\d+\.?\d*)%?\s+(.+)").unwrap())
}

// ============================================================================
// Public API
// ============================================================================

/// Parse a VisualWorks Smalltalk performance trace file and return a structured result.
pub fn parse_trace(content: &str, filename: &str) -> HadronResult<PerformanceTraceResult> {
    if content.len() > MAX_FILE_SIZE {
        return Err(HadronError::Validation(format!(
            "Performance trace file exceeds maximum size of {} bytes (got {} bytes)",
            MAX_FILE_SIZE,
            content.len()
        )));
    }

    let lines: Vec<&str> = content.lines().collect();

    let (user, timestamp) = extract_metadata(filename);
    let header = parse_header(&lines);
    let derived = compute_derived(&header);
    let processes = parse_processes(&lines);
    let top_methods = parse_top_methods(&lines);
    let patterns = detect_patterns(&header, &derived, &processes, &top_methods, content);
    let scenario = reconstruct_scenario(&patterns, &top_methods, content);
    let recommendations = generate_recommendations(&patterns, &derived);
    let overall_severity = determine_severity(&patterns);
    let summary = generate_summary(&patterns, &header, &derived);

    Ok(PerformanceTraceResult {
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

// ============================================================================
// Internal helpers
// ============================================================================

/// Parse header statistics from trace lines.
fn parse_header(lines: &[&str]) -> PerformanceHeader {
    let mut header = PerformanceHeader::default();

    for line in lines {
        let line = line.trim();

        if line.starts_with("Samples:") || line.contains("samples") {
            if let Some(num) = extract_number(line) {
                header.samples = num as u64;
            }
        } else if line.contains("ms/sample") || line.contains("msPerSample") {
            if let Some(num) = extract_float(line) {
                header.avg_ms_per_sample = num;
            }
        } else if line.starts_with("Scavenges:") || line.contains("scavenges") {
            if let Some(num) = extract_number(line) {
                header.scavenges = num as u64;
            }
        } else if line.contains("incGC") || line.contains("incremental GC") {
            if let Some(num) = extract_number(line) {
                header.inc_gcs = num as u64;
            }
        } else if line.contains("stackSpill") || line.contains("stack spill") {
            if let Some(num) = extract_number(line) {
                header.stack_spills = num as u64;
            }
        } else if line.contains("markStackOverflow") {
            if let Some(num) = extract_number(line) {
                header.mark_stack_overflows = num as u64;
            }
        } else if line.contains("weakListOverflow") {
            if let Some(num) = extract_number(line) {
                header.weak_list_overflows = num as u64;
            }
        } else if line.contains("jitCacheSpill") {
            if let Some(num) = extract_number(line) {
                header.jit_cache_spills = num as u64;
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

    // Default real_time if not found
    if header.real_time == 0.0 && header.active_time > 0.0 {
        header.real_time = header.active_time + header.other_processes;
    }

    header
}

/// Parse the process distribution section.
fn parse_processes(lines: &[&str]) -> Vec<ProcessInfo> {
    let mut processes = Vec::new();
    let mut in_section = false;

    for line in lines {
        let line = line.trim();

        if line.contains("Process") && (line.contains("Priority") || line.contains("Samples")) {
            in_section = true;
            continue;
        }

        if in_section && line.is_empty() {
            in_section = false;
            continue;
        }

        if in_section {
            if let Some(caps) = process_regex().captures(line) {
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

/// Parse the top methods section (first 8 methods above 0%).
fn parse_top_methods(lines: &[&str]) -> Vec<TopMethod> {
    let mut methods = Vec::new();
    let mut in_section = false;

    for line in lines {
        let line = line.trim();

        if line.contains("Totals") || line.contains("Self-Time") || line.contains("self time") {
            in_section = true;
            continue;
        }

        if in_section && (line.is_empty() || line.starts_with("===")) {
            if methods.len() >= 8 {
                break;
            }
            continue;
        }

        if in_section && !line.is_empty() {
            if let Some(caps) = method_regex().captures(line) {
                let percentage: f64 = caps
                    .get(1)
                    .and_then(|m| m.as_str().parse().ok())
                    .unwrap_or(0.0);
                let method = caps.get(2).map_or("", |m| m.as_str()).trim().to_string();

                if percentage > 0.0 && !method.is_empty() && methods.len() < 8 {
                    let category = categorize_method(&method);
                    methods.push(TopMethod {
                        method,
                        category,
                        percentage,
                    });
                }
            }
        }
    }

    methods
}

/// Categorize a method name into a performance category.
fn categorize_method(method: &str) -> String {
    let lower = method.to_lowercase();

    if lower.contains("primcallc") || lower.contains("external") || lower.contains("ffi") {
        "FFI/External"
    } else if lower.contains("graphicscontext") || lower.contains("paint") || lower.contains("display") {
        "Graphics"
    } else if lower.contains("gc") || lower.contains("scavenge") || lower.contains("memory") || lower.contains("weakarray") {
        "GC"
    } else if lower.contains("postgres") || lower.contains("oracle") || lower.contains("database") || lower.contains("sql") || lower.contains("session") {
        "Database"
    } else if lower.contains("maf") || lower.contains("widget") || lower.contains("column") || lower.contains("label") || lower.contains("button") {
        "UI Rendering"
    } else if lower.contains("collection") || lower.contains("array") || lower.contains("do:") || lower.contains("select:") || lower.contains("orderedcollection") {
        "Collection"
    } else if lower.contains("t3session") {
        "Session"
    } else {
        "Other"
    }
    .to_string()
}

/// Extract username and timestamp from a filename like `performanceTrace_user_YYYY-MM-DD_HH-MM-SS.log`.
fn extract_metadata(filename: &str) -> (Option<String>, Option<String>) {
    let base = filename
        .trim_start_matches("performanceTrace_")
        .trim_end_matches(".log");

    let parts: Vec<&str> = base.splitn(3, '_').collect();

    if parts.len() >= 2 {
        let user = parts[0].replace('_', " ");
        let date_time = if parts.len() >= 3 {
            Some(format!("{} {}", parts[1], parts[2].replace('-', ":")))
        } else {
            Some(parts[1].to_string())
        };
        (Some(user), date_time)
    } else {
        (None, None)
    }
}

/// Return the highest severity level found among patterns.
fn determine_severity(patterns: &[super::types::DetectedPattern]) -> String {
    if patterns.iter().any(|p| p.severity == "critical") {
        "critical"
    } else if patterns.iter().any(|p| p.severity == "high") {
        "high"
    } else if patterns.iter().any(|p| p.severity == "medium") {
        "medium"
    } else if patterns.iter().any(|p| p.severity == "low") {
        "low"
    } else {
        "info"
    }
    .to_string()
}

/// Generate a one-line text summary based on patterns and derived metrics.
fn generate_summary(
    patterns: &[super::types::DetectedPattern],
    header: &PerformanceHeader,
    derived: &super::types::DerivedMetrics,
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
            "Moderate performance overhead detected with {} patterns. CPU utilization at {:.1}%, activity ratio at {:.1}%.",
            medium_count, derived.cpu_utilization, derived.activity_ratio
        )
    } else {
        format!(
            "Normal operation detected. {} samples collected over {:.1} seconds with {:.1}% CPU utilization.",
            header.samples, header.real_time, derived.cpu_utilization
        )
    }
}

/// Extract a number (with optional comma separators) from text.
fn extract_number(text: &str) -> Option<f64> {
    num_regex()
        .find(text)
        .and_then(|m| m.as_str().replace(',', "").parse::<f64>().ok())
}

/// Extract the first float value from text.
fn extract_float(text: &str) -> Option<f64> {
    float_regex()
        .find(text)
        .and_then(|m| m.as_str().parse::<f64>().ok())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Sample trace matching the spec test data.
    const SAMPLE_TRACE: &str = "\
Samples: 1500
avg ms/sample: 2.5
Scavenges: 3000
incGC: 50
stackSpills: 2
markStackOverflows: 0
weakListOverflows: 0
jitCacheSpills: 1
active time: 3.75
other processes: 0.5
real time: 5.0
profiling overhead: 0.1

Process              Priority  Samples
LauncherProcess      @ 50      85.5%
IdleLoopProcess      @ 10      10.2%
BackgroundProcess    @ 20      4.3%

Totals
25.3% ExternalMethodRef>>primCallC:
15.1% GraphicsContext>>paint
8.2% PostgresSession>>execute
5.0% OrderedCollection>>do:
";

    #[test]
    fn test_parse_header_stats() {
        let lines: Vec<&str> = SAMPLE_TRACE.lines().collect();
        let header = parse_header(&lines);

        assert_eq!(header.samples, 1500);
        assert_eq!(header.avg_ms_per_sample, 2.5);
        assert_eq!(header.scavenges, 3000);
        assert_eq!(header.inc_gcs, 50);
        assert_eq!(header.stack_spills, 2);
        assert_eq!(header.mark_stack_overflows, 0);
        assert_eq!(header.weak_list_overflows, 0);
        assert_eq!(header.jit_cache_spills, 1);
        assert_eq!(header.active_time, 3.75);
        assert_eq!(header.other_processes, 0.5);
        assert_eq!(header.real_time, 5.0);
        assert_eq!(header.profiling_overhead, 0.1);
    }

    #[test]
    fn test_parse_processes() {
        let lines: Vec<&str> = SAMPLE_TRACE.lines().collect();
        let processes = parse_processes(&lines);

        assert!(processes.len() >= 2, "expected at least 2 processes");

        let launcher = processes.iter().find(|p| p.name.contains("Launcher"));
        assert!(launcher.is_some(), "LauncherProcess should be parsed");
        assert!((launcher.unwrap().percentage - 85.5).abs() < 0.1);

        let idle = processes.iter().find(|p| p.name.contains("Idle"));
        assert!(idle.is_some(), "IdleLoopProcess should be parsed");
        // 10.2% > 8.0 → warning status
        assert_eq!(idle.unwrap().status, "warning");
    }

    #[test]
    fn test_parse_top_methods() {
        let lines: Vec<&str> = SAMPLE_TRACE.lines().collect();
        let methods = parse_top_methods(&lines);

        assert!(methods.len() >= 3, "expected at least 3 methods");

        let external = methods.iter().find(|m| m.method.contains("primCallC"));
        assert!(external.is_some());
        assert_eq!(external.unwrap().category, "FFI/External");

        let graphics = methods.iter().find(|m| m.method.contains("GraphicsContext"));
        assert!(graphics.is_some());
        assert_eq!(graphics.unwrap().category, "Graphics");

        let db = methods.iter().find(|m| m.method.contains("Postgres"));
        assert!(db.is_some());
        assert_eq!(db.unwrap().category, "Database");
    }

    #[test]
    fn test_parse_empty_file() {
        // Must not panic
        let result = parse_trace("", "empty.log");
        assert!(result.is_ok());
        let r = result.unwrap();
        assert_eq!(r.header.samples, 0);
        assert!(r.processes.is_empty());
        assert!(r.top_methods.is_empty());
    }

    #[test]
    fn test_parse_full_trace() {
        let result = parse_trace(SAMPLE_TRACE, "performanceTrace_john_2026-03-25_14-30-00.log");
        assert!(result.is_ok());
        let r = result.unwrap();
        assert_eq!(r.filename, "performanceTrace_john_2026-03-25_14-30-00.log");
        assert_eq!(r.user, Some("john".to_string()));
        assert!(!r.overall_severity.is_empty());
        assert!(!r.summary.is_empty());
    }

    #[test]
    fn test_file_size_limit() {
        // Content just over 10 MB
        let big = "x".repeat(MAX_FILE_SIZE + 1);
        let result = parse_trace(&big, "large.log");
        assert!(result.is_err());
        let err = format!("{}", result.unwrap_err());
        assert!(err.contains("exceeds maximum size"));
    }

    #[test]
    fn test_extract_metadata_full() {
        let (user, ts) = extract_metadata("performanceTrace_jdoe_2026-03-25_14-30-00.log");
        assert_eq!(user, Some("jdoe".to_string()));
        assert!(ts.is_some());
    }

    #[test]
    fn test_extract_metadata_unknown() {
        let (user, ts) = extract_metadata("unknown.log");
        assert!(user.is_none());
        assert!(ts.is_none());
    }
}
