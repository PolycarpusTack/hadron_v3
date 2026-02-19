use crate::export::report::{ReportAudience, ReportData};
use crate::export::sanitizer::simplify_technical_terms;
use rust_xlsxwriter::{Format, Workbook};

/// Generate an XLSX report with multiple sheets (one per section).
/// Returns base64-encoded XLSX content.
pub fn generate_xlsx(data: &ReportData) -> String {
    let mut workbook = Workbook::new();
    let config = &data.config;
    let crash = &data.crash;
    let is_customer = config.audience == ReportAudience::Customer;

    // Shared formats
    let header_fmt = Format::new()
        .set_bold()
        .set_font_size(12)
        .set_font_color("#1e3a5f")
        .set_background_color("#e2e8f0");
    let label_fmt = Format::new().set_bold().set_font_color("#475569");
    let title_fmt = Format::new().set_bold().set_font_size(14);

    // --- Summary sheet ---
    if config.sections.summary {
        let sheet = workbook.add_worksheet();
        sheet.set_name("Summary").ok();
        sheet.set_column_width(0, 18).ok();
        sheet.set_column_width(1, 60).ok();

        let mut row = 0u32;
        sheet.write_with_format(row, 0, "Crash Analysis Report", &title_fmt).ok();
        row += 2;
        sheet.write_with_format(row, 0, "Property", &header_fmt).ok();
        sheet.write_with_format(row, 1, "Value", &header_fmt).ok();
        row += 1;

        sheet.write_with_format(row, 0, "File", &label_fmt).ok();
        sheet.write(row, 1, &*crash.file_name).ok();
        row += 1;

        if let Some(ref ts) = crash.timestamp {
            sheet.write_with_format(row, 0, "Time", &label_fmt).ok();
            sheet.write(row, 1, &**ts).ok();
            row += 1;
        }

        if !is_customer {
            if let Some(ref site) = crash.site {
                sheet.write_with_format(row, 0, "Site", &label_fmt).ok();
                sheet.write(row, 1, &**site).ok();
                row += 1;
            }
            if let Some(ref version) = crash.version {
                sheet.write_with_format(row, 0, "Version", &label_fmt).ok();
                sheet.write(row, 1, &**version).ok();
                row += 1;
            }
        }

        let exception = if is_customer {
            simplify_technical_terms(&crash.exception_type)
        } else {
            crash.exception_type.clone()
        };
        sheet.write_with_format(row, 0, "Error Type", &label_fmt).ok();
        sheet.write(row, 1, &*exception).ok();
        row += 1;

        if let Some(ref pattern) = data.pattern_match {
            sheet.write_with_format(row, 0, "Severity", &label_fmt).ok();
            sheet.write(row, 1, &*pattern.severity).ok();
            row += 1;
        }

        if crash.has_active_transaction && !is_customer {
            sheet.write_with_format(row, 0, "Transaction", &label_fmt).ok();
            sheet.write(row, 1, "Active (uncommitted changes)").ok();
            row += 1;
        }

        sheet.write_with_format(row, 0, "Generated", &label_fmt).ok();
        sheet.write(row, 1, &*data.metadata.generated_at).ok();
        row += 1;
        sheet.write_with_format(row, 0, "Report ID", &label_fmt).ok();
        sheet.write(row, 1, &*data.metadata.report_id).ok();
    }

    // --- Environment sheet ---
    if config.sections.environment && !is_customer {
        let sheet = workbook.add_worksheet();
        sheet.set_name("Environment").ok();
        sheet.set_column_width(0, 15).ok();
        sheet.set_column_width(1, 50).ok();

        let mut row = 0u32;
        sheet.write_with_format(row, 0, "Property", &header_fmt).ok();
        sheet.write_with_format(row, 1, "Value", &header_fmt).ok();
        row += 1;

        let fields: Vec<(&str, Option<&String>)> = vec![
            ("Site", crash.site.as_ref()),
            ("User", crash.user.as_ref()),
            ("Version", crash.version.as_ref()),
            ("Build", crash.build.as_ref()),
            ("Computer", crash.computer.as_ref()),
            ("Database", crash.database_backend.as_ref()),
        ];

        for (label, value) in fields {
            if let Some(val) = value {
                sheet.write_with_format(row, 0, label, &label_fmt).ok();
                sheet.write(row, 1, &**val).ok();
                row += 1;
            }
        }
    }

    // --- Exception Details sheet ---
    if config.sections.exception_details && !is_customer {
        let sheet = workbook.add_worksheet();
        sheet.set_name("Exception").ok();
        sheet.set_column_width(0, 15).ok();
        sheet.set_column_width(1, 80).ok();

        let mut row = 0u32;
        sheet.write_with_format(row, 0, "Field", &header_fmt).ok();
        sheet.write_with_format(row, 1, "Value", &header_fmt).ok();
        row += 1;

        sheet.write_with_format(row, 0, "Type", &label_fmt).ok();
        sheet.write(row, 1, &*crash.exception_type).ok();
        row += 1;

        sheet.write_with_format(row, 0, "Message", &label_fmt).ok();
        sheet.write(row, 1, &*crash.exception_message).ok();
        row += 1;

        if let Some(ref param) = crash.exception_parameter {
            sheet.write_with_format(row, 0, "Parameter", &label_fmt).ok();
            sheet.write(row, 1, &**param).ok();
        }
    }

    // --- Root Cause sheet ---
    if config.sections.root_cause {
        if let Some(ref pattern) = data.pattern_match {
            let sheet = workbook.add_worksheet();
            sheet.set_name("Root Cause").ok();
            sheet.set_column_width(0, 100).ok();

            let mut row = 0u32;
            sheet.write_with_format(row, 0, "Root Cause Analysis", &title_fmt).ok();
            row += 2;

            let root_cause = if is_customer {
                simplify_technical_terms(&pattern.root_cause_plain)
            } else {
                pattern.root_cause_plain.clone()
            };
            sheet.write(row, 0, &*root_cause).ok();
            row += 1;

            if config.audience == ReportAudience::Technical {
                row += 1;
                sheet.write_with_format(row, 0, "Technical Details", &label_fmt).ok();
                row += 1;
                sheet.write(row, 0, &*pattern.root_cause).ok();
            }
        }
    }

    // --- Suggested Fix sheet ---
    if config.sections.suggested_fix {
        if let Some(ref pattern) = data.pattern_match {
            let sheet = workbook.add_worksheet();
            sheet.set_name("Suggested Fix").ok();
            sheet.set_column_width(0, 100).ok();

            let mut row = 0u32;
            sheet.write_with_format(row, 0, "Suggested Fix", &title_fmt).ok();
            row += 2;

            sheet.write(row, 0, &*pattern.fix_summary).ok();
            row += 1;

            if !pattern.workarounds.is_empty() {
                row += 1;
                sheet.write_with_format(row, 0, "Workarounds", &label_fmt).ok();
                row += 1;
                for workaround in &pattern.workarounds {
                    sheet.write(row, 0, &format!("  \u{2192} {}", workaround)).ok();
                    row += 1;
                }
            }
        }
    }

    // --- Stack Trace sheet ---
    if config.sections.stack_trace && !crash.stack_trace.is_empty() && !is_customer {
        let sheet = workbook.add_worksheet();
        sheet.set_name("Stack Trace").ok();
        sheet.set_column_width(0, 8).ok();
        sheet.set_column_width(1, 12).ok();
        sheet.set_column_width(2, 90).ok();
        sheet.set_column_width(3, 12).ok();

        let mut row = 0u32;
        sheet.write_with_format(row, 0, "#", &header_fmt).ok();
        sheet.write_with_format(row, 1, "Type", &header_fmt).ok();
        sheet.write_with_format(row, 2, "Method", &header_fmt).ok();
        sheet.write_with_format(row, 3, "App Code", &header_fmt).ok();
        row += 1;

        let app_fmt = Format::new().set_font_color("#1d4ed8");

        for frame in &crash.stack_trace {
            let fmt = if frame.is_application { &app_fmt } else { &label_fmt };
            sheet.write(row, 0, frame.frame_number).ok();
            sheet.write(row, 1, &*frame.frame_type).ok();
            sheet.write_with_format(row, 2, &*frame.method, fmt).ok();
            sheet.write(row, 3, if frame.is_application { "Yes" } else { "" }).ok();
            row += 1;
        }

        if crash.stack_trace_truncated {
            sheet.write(row, 2, "... (truncated)").ok();
        }
    }

    // --- Pattern Match sheet ---
    if config.sections.pattern_match {
        if let Some(ref pattern) = data.pattern_match {
            let sheet = workbook.add_worksheet();
            sheet.set_name("Pattern Match").ok();
            sheet.set_column_width(0, 18).ok();
            sheet.set_column_width(1, 60).ok();

            let mut row = 0u32;
            sheet.write_with_format(row, 0, "Property", &header_fmt).ok();
            sheet.write_with_format(row, 1, "Value", &header_fmt).ok();
            row += 1;

            sheet.write_with_format(row, 0, "Pattern Name", &label_fmt).ok();
            sheet.write(row, 1, &*pattern.pattern_name).ok();
            row += 1;

            sheet.write_with_format(row, 0, "Pattern ID", &label_fmt).ok();
            sheet.write(row, 1, &*pattern.pattern_id).ok();
            row += 1;

            sheet.write_with_format(row, 0, "Confidence", &label_fmt).ok();
            sheet.write(row, 1, &format!("{:.0}%", pattern.confidence * 100.0)).ok();
            row += 1;

            sheet.write_with_format(row, 0, "Severity", &label_fmt).ok();
            sheet.write(row, 1, &*pattern.severity).ok();
            row += 1;

            if let Some(ref fixed) = pattern.fixed_in_version {
                sheet.write_with_format(row, 0, "Fixed In", &label_fmt).ok();
                sheet.write(row, 1, &**fixed).ok();
                row += 1;
            }

            if !pattern.tickets.is_empty() {
                sheet.write_with_format(row, 0, "Related Tickets", &label_fmt).ok();
                sheet.write(row, 1, &pattern.tickets.join(", ")).ok();
            }
        }
    }

    // Save to buffer and base64 encode
    let buf = workbook
        .save_to_buffer()
        .unwrap_or_else(|e| {
            log::error!("Failed to save XLSX to buffer: {}", e);
            Vec::new()
        });

    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::report::{CrashFileSummary, ReportConfig, ReportMetadata};

    #[test]
    fn test_generate_xlsx() {
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

        let xlsx_b64 = generate_xlsx(&data);

        // Should be valid base64
        assert!(!xlsx_b64.is_empty());
        let decoded = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &xlsx_b64);
        assert!(decoded.is_ok());
        let bytes = decoded.unwrap();
        // XLSX files start with PK (ZIP signature)
        assert!(bytes.len() > 4);
        assert_eq!(&bytes[0..2], b"PK");
    }
}
