use crate::export::report::{ReportAudience, ReportData};
use crate::export::sanitizer::simplify_technical_terms;
use std::fmt::Write;

/// Generate a Markdown report
pub fn generate_markdown(data: &ReportData) -> String {
    let mut md = String::new();
    let config = &data.config;

    // Title
    let title = config.title.as_deref().unwrap_or("Crash Analysis Report");
    writeln!(md, "# {}", title).unwrap();
    writeln!(md).unwrap();

    // Metadata
    writeln!(md, "**Generated:** {}  ", data.metadata.generated_at).unwrap();
    writeln!(md, "**Report ID:** {}  ", data.metadata.report_id).unwrap();
    writeln!(md).unwrap();

    // Sections based on config
    if config.sections.summary {
        write_summary_section(&mut md, data);
    }

    if config.sections.environment {
        write_environment_section(&mut md, data);
    }

    if config.sections.exception_details {
        write_exception_section(&mut md, data);
    }

    if config.sections.root_cause {
        write_root_cause_section(&mut md, data);
    }

    if config.sections.suggested_fix {
        write_fix_section(&mut md, data);
    }

    if config.sections.stack_trace {
        write_stack_trace_section(&mut md, data);
    }

    if config.sections.pattern_match {
        write_pattern_section(&mut md, data);
    }

    // Footer
    if let Some(ref footer) = config.branding.footer_text {
        writeln!(md).unwrap();
        writeln!(md, "---").unwrap();
        writeln!(md, "*{}*", footer).unwrap();
    }

    md
}

fn write_summary_section(md: &mut String, data: &ReportData) {
    writeln!(md, "## Summary").unwrap();
    writeln!(md).unwrap();

    let crash = &data.crash;
    let is_customer = data.config.audience == ReportAudience::Customer;

    writeln!(md, "| Property | Value |").unwrap();
    writeln!(md, "|----------|-------|").unwrap();
    writeln!(md, "| **File** | {} |", crash.file_name).unwrap();

    if let Some(ref ts) = crash.timestamp {
        writeln!(md, "| **Time** | {} |", ts).unwrap();
    }

    if !is_customer {
        if let Some(ref site) = crash.site {
            writeln!(md, "| **Site** | {} |", site).unwrap();
        }
        if let Some(ref version) = crash.version {
            writeln!(md, "| **Version** | {} |", version).unwrap();
        }
    }

    let exception = if is_customer {
        simplify_technical_terms(&crash.exception_type)
    } else {
        crash.exception_type.clone()
    };
    writeln!(md, "| **Error Type** | {} |", exception).unwrap();

    if let Some(ref pattern) = data.pattern_match {
        writeln!(md, "| **Severity** | {} |", pattern.severity).unwrap();
    }

    if crash.has_active_transaction && !is_customer {
        writeln!(md, "| **Transaction** | Active (uncommitted changes) |").unwrap();
    }

    writeln!(md).unwrap();
}

fn write_environment_section(md: &mut String, data: &ReportData) {
    let crash = &data.crash;

    writeln!(md, "## Environment").unwrap();
    writeln!(md).unwrap();

    if let Some(ref site) = crash.site {
        writeln!(md, "- **Site:** {}", site).unwrap();
    }
    if let Some(ref user) = crash.user {
        let user_display = if data.config.audience == ReportAudience::Customer {
            "[User]".to_string()
        } else {
            user.clone()
        };
        writeln!(md, "- **User:** {}", user_display).unwrap();
    }
    if let Some(ref version) = crash.version {
        writeln!(md, "- **Version:** {}", version).unwrap();
    }
    if let Some(ref build) = crash.build {
        writeln!(md, "- **Build:** {}", build).unwrap();
    }
    if let Some(ref computer) = crash.computer {
        writeln!(md, "- **Computer:** {}", computer).unwrap();
    }
    if let Some(ref db) = crash.database_backend {
        writeln!(md, "- **Database:** {}", db).unwrap();
    }

    writeln!(md).unwrap();
}

fn write_exception_section(md: &mut String, data: &ReportData) {
    let crash = &data.crash;

    writeln!(md, "## Exception Details").unwrap();
    writeln!(md).unwrap();
    writeln!(md, "```").unwrap();
    writeln!(md, "Type: {}", crash.exception_type).unwrap();
    writeln!(md, "Message: {}", crash.exception_message).unwrap();
    if let Some(ref param) = crash.exception_parameter {
        writeln!(md, "Parameter: {}", param).unwrap();
    }
    writeln!(md, "```").unwrap();
    writeln!(md).unwrap();
}

fn write_root_cause_section(md: &mut String, data: &ReportData) {
    if let Some(ref pattern) = data.pattern_match {
        writeln!(md, "## Root Cause").unwrap();
        writeln!(md).unwrap();

        let root_cause = if data.config.audience == ReportAudience::Customer {
            simplify_technical_terms(&pattern.root_cause_plain)
        } else {
            pattern.root_cause_plain.clone()
        };

        writeln!(md, "{}", root_cause).unwrap();
        writeln!(md).unwrap();

        if data.config.audience == ReportAudience::Technical {
            writeln!(md, "### Technical Details").unwrap();
            writeln!(md).unwrap();
            writeln!(md, "{}", pattern.root_cause).unwrap();
            writeln!(md).unwrap();
        }
    }
}

fn write_fix_section(md: &mut String, data: &ReportData) {
    if let Some(ref pattern) = data.pattern_match {
        writeln!(md, "## Suggested Fix").unwrap();
        writeln!(md).unwrap();
        writeln!(md, "{}", pattern.fix_summary).unwrap();
        writeln!(md).unwrap();

        if !pattern.workarounds.is_empty() {
            writeln!(md, "### Workarounds").unwrap();
            writeln!(md).unwrap();
            for workaround in &pattern.workarounds {
                writeln!(md, "- {}", workaround).unwrap();
            }
            writeln!(md).unwrap();
        }
    }
}

fn write_stack_trace_section(md: &mut String, data: &ReportData) {
    let crash = &data.crash;

    if crash.stack_trace.is_empty() {
        return;
    }

    writeln!(md, "## Stack Trace").unwrap();
    writeln!(md).unwrap();
    writeln!(md, "```").unwrap();

    for frame in &crash.stack_trace {
        let marker = if frame.is_application { ">" } else { " " };
        writeln!(md, "{} [{}] {}", marker, frame.frame_number, frame.method).unwrap();
    }

    if crash.stack_trace_truncated {
        writeln!(md, "... (truncated)").unwrap();
    }

    writeln!(md, "```").unwrap();
    writeln!(md).unwrap();
}

fn write_pattern_section(md: &mut String, data: &ReportData) {
    if let Some(ref pattern) = data.pattern_match {
        writeln!(md, "## Pattern Match").unwrap();
        writeln!(md).unwrap();

        writeln!(md, "This crash matches a known pattern:").unwrap();
        writeln!(md).unwrap();
        writeln!(
            md,
            "- **Pattern:** {} ({})",
            pattern.pattern_name, pattern.pattern_id
        )
        .unwrap();
        writeln!(md, "- **Confidence:** {:.0}%", pattern.confidence * 100.0).unwrap();

        if let Some(ref fixed) = pattern.fixed_in_version {
            writeln!(md, "- **Fixed In:** {}", fixed).unwrap();
        }

        if !pattern.tickets.is_empty() {
            writeln!(md, "- **Related Tickets:** {}", pattern.tickets.join(", ")).unwrap();
        }

        writeln!(md).unwrap();
    }
}
