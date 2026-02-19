use crate::export::report::{ReportAudience, ReportData};
use crate::export::sanitizer::simplify_technical_terms;
use std::fmt::Write;

/// Generate a plain-text report without markdown formatting
pub fn generate_txt(data: &ReportData) -> String {
    let mut out = String::new();
    let config = &data.config;
    let crash = &data.crash;
    let is_customer = config.audience == ReportAudience::Customer;

    // Title
    let title = config.title.as_deref().unwrap_or("Crash Analysis Report");
    writeln!(out, "{}", title).unwrap();
    writeln!(out, "{}", "=".repeat(title.len())).unwrap();
    writeln!(out).unwrap();
    writeln!(out, "Generated: {}", data.metadata.generated_at).unwrap();
    writeln!(out, "Report ID: {}", data.metadata.report_id).unwrap();
    writeln!(out).unwrap();

    // Summary
    if config.sections.summary {
        write_divider(&mut out, "SUMMARY");
        writeln!(out, "File:       {}", crash.file_name).unwrap();
        if let Some(ref ts) = crash.timestamp {
            writeln!(out, "Time:       {}", ts).unwrap();
        }
        if !is_customer {
            if let Some(ref site) = crash.site {
                writeln!(out, "Site:       {}", site).unwrap();
            }
            if let Some(ref version) = crash.version {
                writeln!(out, "Version:    {}", version).unwrap();
            }
        }
        let exception = if is_customer {
            simplify_technical_terms(&crash.exception_type)
        } else {
            crash.exception_type.clone()
        };
        writeln!(out, "Error Type: {}", exception).unwrap();
        if let Some(ref pattern) = data.pattern_match {
            writeln!(out, "Severity:   {}", pattern.severity).unwrap();
        }
        if crash.has_active_transaction && !is_customer {
            writeln!(out, "Transaction: Active (uncommitted changes)").unwrap();
        }
        writeln!(out).unwrap();
    }

    // Environment
    if config.sections.environment && !is_customer {
        write_divider(&mut out, "ENVIRONMENT");
        if let Some(ref site) = crash.site {
            writeln!(out, "Site:     {}", site).unwrap();
        }
        if let Some(ref user) = crash.user {
            writeln!(out, "User:     {}", user).unwrap();
        }
        if let Some(ref version) = crash.version {
            writeln!(out, "Version:  {}", version).unwrap();
        }
        if let Some(ref build) = crash.build {
            writeln!(out, "Build:    {}", build).unwrap();
        }
        if let Some(ref computer) = crash.computer {
            writeln!(out, "Computer: {}", computer).unwrap();
        }
        if let Some(ref db) = crash.database_backend {
            writeln!(out, "Database: {}", db).unwrap();
        }
        writeln!(out).unwrap();
    }

    // Exception Details
    if config.sections.exception_details && !is_customer {
        write_divider(&mut out, "EXCEPTION DETAILS");
        writeln!(out, "Type:      {}", crash.exception_type).unwrap();
        writeln!(out, "Message:   {}", crash.exception_message).unwrap();
        if let Some(ref param) = crash.exception_parameter {
            writeln!(out, "Parameter: {}", param).unwrap();
        }
        writeln!(out).unwrap();
    }

    // Root Cause
    if config.sections.root_cause {
        if let Some(ref pattern) = data.pattern_match {
            write_divider(&mut out, "ROOT CAUSE");
            let root_cause = if is_customer {
                simplify_technical_terms(&pattern.root_cause_plain)
            } else {
                pattern.root_cause_plain.clone()
            };
            writeln!(out, "{}", root_cause).unwrap();
            if config.audience == ReportAudience::Technical {
                writeln!(out).unwrap();
                writeln!(out, "Technical Details:").unwrap();
                writeln!(out, "{}", pattern.root_cause).unwrap();
            }
            writeln!(out).unwrap();
        }
    }

    // Suggested Fix
    if config.sections.suggested_fix {
        if let Some(ref pattern) = data.pattern_match {
            write_divider(&mut out, "SUGGESTED FIX");
            writeln!(out, "{}", pattern.fix_summary).unwrap();
            if !pattern.workarounds.is_empty() {
                writeln!(out).unwrap();
                writeln!(out, "Workarounds:").unwrap();
                for workaround in &pattern.workarounds {
                    writeln!(out, "  - {}", workaround).unwrap();
                }
            }
            writeln!(out).unwrap();
        }
    }

    // Stack Trace
    if config.sections.stack_trace && !crash.stack_trace.is_empty() && !is_customer {
        write_divider(&mut out, "STACK TRACE");
        for frame in &crash.stack_trace {
            let marker = if frame.is_application { ">" } else { " " };
            writeln!(out, "{} [{:>3}] {}", marker, frame.frame_number, frame.method).unwrap();
        }
        if crash.stack_trace_truncated {
            writeln!(out, "... (truncated)").unwrap();
        }
        writeln!(out).unwrap();
    }

    // Pattern Match
    if config.sections.pattern_match {
        if let Some(ref pattern) = data.pattern_match {
            write_divider(&mut out, "PATTERN MATCH");
            writeln!(out, "Pattern:    {} ({})", pattern.pattern_name, pattern.pattern_id).unwrap();
            writeln!(out, "Confidence: {:.0}%", pattern.confidence * 100.0).unwrap();
            if let Some(ref fixed) = pattern.fixed_in_version {
                writeln!(out, "Fixed In:   {}", fixed).unwrap();
            }
            if !pattern.tickets.is_empty() {
                writeln!(out, "Tickets:    {}", pattern.tickets.join(", ")).unwrap();
            }
            writeln!(out).unwrap();
        }
    }

    // Memory Warning
    if let Some(ref warning) = crash.memory_warning {
        write_divider(&mut out, "MEMORY WARNING");
        writeln!(out, "{}", warning).unwrap();
        writeln!(out).unwrap();
    }

    // Footer
    if let Some(ref footer) = config.branding.footer_text {
        writeln!(out, "{}", "-".repeat(60)).unwrap();
        writeln!(out, "{}", footer).unwrap();
    }

    out
}

fn write_divider(out: &mut String, section_name: &str) {
    writeln!(out, "--- {} {}", section_name, "-".repeat(60 - 5 - section_name.len())).unwrap();
    writeln!(out).unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::report::{CrashFileSummary, ReportConfig, ReportMetadata};

    #[test]
    fn test_generate_txt() {
        let data = ReportData {
            metadata: ReportMetadata {
                generated_at: "2024-01-15 10:30:00".to_string(),
                generator_version: "1.0.0".to_string(),
                report_id: "test-123".to_string(),
            },
            crash: CrashFileSummary {
                file_name: "test.txt".to_string(),
                timestamp: Some("2024-01-15 10:00:00".to_string()),
                user: Some("testuser".to_string()),
                site: Some("TestSite".to_string()),
                version: Some("1.0.0".to_string()),
                build: Some("12345".to_string()),
                computer: Some("TESTPC".to_string()),
                exception_type: "TestError".to_string(),
                exception_message: "Test message".to_string(),
                exception_parameter: None,
                stack_trace: vec![],
                stack_trace_truncated: false,
                open_windows: vec![],
                has_active_transaction: false,
                memory_warning: None,
                database_backend: Some("PostgreSQL".to_string()),
            },
            pattern_match: None,
            config: ReportConfig::default(),
        };

        let txt = generate_txt(&data);

        assert!(txt.contains("Crash Analysis Report"));
        assert!(txt.contains("test.txt"));
        assert!(txt.contains("TestError"));
        assert!(!txt.contains("#")); // No markdown
        assert!(!txt.contains("**")); // No markdown bold
    }
}
