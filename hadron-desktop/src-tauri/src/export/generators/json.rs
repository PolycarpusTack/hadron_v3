use crate::export::report::ReportData;
use serde_json::{json, Value};

/// Generate a JSON report
pub fn generate_json(data: &ReportData) -> String {
    let config = &data.config;

    let mut output = json!({
        "metadata": {
            "generated_at": data.metadata.generated_at,
            "generator_version": data.metadata.generator_version,
            "report_id": data.metadata.report_id,
            "audience": format!("{:?}", config.audience),
        }
    });

    let obj = output.as_object_mut().unwrap();

    // Add sections based on config
    if config.sections.summary {
        obj.insert("summary".to_string(), build_summary(data));
    }

    if config.sections.environment {
        obj.insert("environment".to_string(), build_environment(data));
    }

    if config.sections.exception_details {
        obj.insert("exception".to_string(), build_exception(data));
    }

    if config.sections.root_cause {
        if let Some(ref pattern) = data.pattern_match {
            obj.insert(
                "root_cause".to_string(),
                json!({
                    "technical": pattern.root_cause,
                    "plain_english": pattern.root_cause_plain,
                }),
            );
        }
    }

    if config.sections.suggested_fix {
        if let Some(ref pattern) = data.pattern_match {
            obj.insert(
                "suggested_fix".to_string(),
                json!({
                    "summary": pattern.fix_summary,
                    "workarounds": pattern.workarounds,
                }),
            );
        }
    }

    if config.sections.stack_trace {
        obj.insert("stack_trace".to_string(), build_stack_trace(data));
    }

    if config.sections.pattern_match {
        if let Some(ref pattern) = data.pattern_match {
            obj.insert(
                "pattern_match".to_string(),
                json!({
                    "pattern_id": pattern.pattern_id,
                    "pattern_name": pattern.pattern_name,
                    "confidence": pattern.confidence,
                    "confidence_percent": (pattern.confidence * 100.0).round(),
                    "is_known_issue": pattern.is_known_issue,
                    "fixed_in_version": pattern.fixed_in_version,
                    "tickets": pattern.tickets,
                    "severity": pattern.severity,
                }),
            );
        }
    }

    // Branding info (if needed for API consumers)
    if config.branding.footer_text.is_some() {
        obj.insert(
            "branding".to_string(),
            json!({
                "company": config.branding.company_name,
                "footer": config.branding.footer_text,
            }),
        );
    }

    serde_json::to_string_pretty(&output).unwrap_or_else(|_| "{}".to_string())
}

fn build_summary(data: &ReportData) -> Value {
    let crash = &data.crash;

    let mut summary = json!({
        "file_name": crash.file_name,
        "exception_type": crash.exception_type,
    });

    let obj = summary.as_object_mut().unwrap();

    if let Some(ref ts) = crash.timestamp {
        obj.insert("timestamp".to_string(), json!(ts));
    }

    if let Some(ref site) = crash.site {
        obj.insert("site".to_string(), json!(site));
    }

    if let Some(ref version) = crash.version {
        obj.insert("version".to_string(), json!(version));
    }

    if let Some(ref pattern) = data.pattern_match {
        obj.insert("severity".to_string(), json!(pattern.severity));
    }

    if crash.has_active_transaction {
        obj.insert("has_active_transaction".to_string(), json!(true));
    }

    summary
}

fn build_environment(data: &ReportData) -> Value {
    let crash = &data.crash;

    json!({
        "site": crash.site,
        "user": crash.user,
        "version": crash.version,
        "build": crash.build,
        "computer": crash.computer,
        "database_backend": crash.database_backend,
    })
}

fn build_exception(data: &ReportData) -> Value {
    let crash = &data.crash;

    json!({
        "type": crash.exception_type,
        "message": crash.exception_message,
        "parameter": crash.exception_parameter,
    })
}

fn build_stack_trace(data: &ReportData) -> Value {
    let crash = &data.crash;

    let frames: Vec<Value> = crash
        .stack_trace
        .iter()
        .map(|f| {
            json!({
                "frame_number": f.frame_number,
                "method": f.method,
                "type": f.frame_type,
                "is_application": f.is_application,
            })
        })
        .collect();

    json!({
        "frames": frames,
        "truncated": crash.stack_trace_truncated,
        "total_frames": crash.stack_trace.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::report::{CrashFileSummary, ReportAudience, ReportConfig, ReportMetadata};

    fn create_test_data() -> ReportData {
        ReportData {
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
        }
    }

    #[test]
    fn test_generate_json() {
        let data = create_test_data();
        let json = generate_json(&data);

        assert!(json.contains("\"report_id\""));
        assert!(json.contains("test-123"));
        assert!(json.contains("TestError"));
    }

    #[test]
    fn test_json_has_metadata() {
        let data = create_test_data();
        let json = generate_json(&data);
        let parsed: Value = serde_json::from_str(&json).unwrap();

        assert!(parsed["metadata"]["generated_at"].is_string());
        assert!(parsed["metadata"]["report_id"].is_string());
    }
}
