use crate::export::report::{ReportAudience, ReportData};
use crate::export::sanitizer::simplify_technical_terms;
use minijinja::{context, Environment};

/// Generate an HTML report using minijinja templates
pub fn generate_html(data: &ReportData) -> String {
    let mut env = Environment::new();

    // Add the main template
    env.add_template("report", HTML_TEMPLATE)
        .expect("HTML_TEMPLATE is a valid constant template");

    let template = env.get_template("report")
        .expect("template was just added above");

    let config = &data.config;
    let crash = &data.crash;
    let is_customer = config.audience == ReportAudience::Customer;

    // Prepare exception type (simplified for customers)
    let exception_display = if is_customer {
        simplify_technical_terms(&crash.exception_type)
    } else {
        crash.exception_type.clone()
    };

    // Prepare root cause texts
    let (root_cause_plain, root_cause_technical) = if let Some(ref pattern) = data.pattern_match {
        let plain = if is_customer {
            simplify_technical_terms(&pattern.root_cause_plain)
        } else {
            pattern.root_cause_plain.clone()
        };
        (Some(plain), Some(pattern.root_cause.clone()))
    } else {
        (None, None)
    };

    let ctx = context! {
        // Metadata
        title => config.title.as_deref().unwrap_or("Crash Analysis Report"),
        generated_at => &data.metadata.generated_at,
        report_id => &data.metadata.report_id,

        // Branding
        company_name => &config.branding.company_name,
        primary_color => &config.branding.primary_color,
        secondary_color => &config.branding.secondary_color,
        footer_text => &config.branding.footer_text,
        logo_base64 => &config.branding.logo_base64,

        // Audience flags
        is_customer => is_customer,
        is_technical => config.audience == ReportAudience::Technical,

        // Section flags
        show_summary => config.sections.summary,
        show_environment => config.sections.environment,
        show_exception => config.sections.exception_details,
        show_root_cause => config.sections.root_cause,
        show_fix => config.sections.suggested_fix,
        show_stack_trace => config.sections.stack_trace,
        show_pattern => config.sections.pattern_match,

        // Crash data
        file_name => &crash.file_name,
        timestamp => &crash.timestamp,
        user => &crash.user,
        site => &crash.site,
        version => &crash.version,
        build => &crash.build,
        computer => &crash.computer,
        exception_type => exception_display,
        exception_message => &crash.exception_message,
        exception_parameter => &crash.exception_parameter,
        has_active_transaction => crash.has_active_transaction,
        memory_warning => &crash.memory_warning,
        database_backend => &crash.database_backend,

        // Stack trace
        stack_trace => &crash.stack_trace,
        stack_trace_truncated => crash.stack_trace_truncated,

        // Pattern match
        pattern => &data.pattern_match,
        root_cause_plain => root_cause_plain,
        root_cause_technical => root_cause_technical,
    };

    template.render(ctx).unwrap_or_else(|e| {
        format!(
            "<html><body><h1>Error rendering report</h1><p>{}</p></body></html>",
            e
        )
    })
}

const HTML_TEMPLATE: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ title }}</title>
    <style>
        :root {
            --primary: {{ primary_color }};
            --secondary: {{ secondary_color }};
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }

        .container {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }

        header {
            background: var(--primary);
            color: white;
            padding: 30px;
        }

        header h1 {
            font-size: 1.8em;
            margin-bottom: 10px;
        }

        .meta {
            font-size: 0.9em;
            opacity: 0.9;
        }

        .meta span {
            margin-right: 20px;
        }

        main { padding: 30px; }

        section {
            margin-bottom: 30px;
            border-bottom: 1px solid #eee;
            padding-bottom: 20px;
        }

        section:last-child { border-bottom: none; }

        h2 {
            color: var(--primary);
            font-size: 1.3em;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        h2::before {
            content: '';
            display: block;
            width: 4px;
            height: 1.2em;
            background: var(--secondary);
            border-radius: 2px;
        }

        .summary-table {
            width: 100%;
            border-collapse: collapse;
        }

        .summary-table th,
        .summary-table td {
            padding: 10px 15px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }

        .summary-table th {
            width: 150px;
            font-weight: 600;
            color: #555;
            background: #f9f9f9;
        }

        .code-block {
            background: #1e1e1e;
            color: #d4d4d4;
            padding: 15px;
            border-radius: 6px;
            font-family: 'Fira Code', 'Consolas', monospace;
            font-size: 0.9em;
            overflow-x: auto;
        }

        .stack-frame {
            padding: 4px 0;
            border-bottom: 1px solid #333;
        }

        .stack-frame:last-child { border-bottom: none; }

        .stack-frame.app { color: #4fc3f7; }
        .stack-frame.framework { color: #aaa; }

        .frame-number {
            color: #888;
            margin-right: 10px;
            min-width: 30px;
            display: inline-block;
        }

        .severity {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 0.85em;
            font-weight: 600;
        }

        .severity-critical { background: #f44336; color: white; }
        .severity-high { background: #ff9800; color: white; }
        .severity-medium { background: #ffc107; color: #333; }
        .severity-low { background: #4caf50; color: white; }

        .info-box {
            background: #e3f2fd;
            border-left: 4px solid var(--secondary);
            padding: 15px;
            border-radius: 0 6px 6px 0;
            margin: 15px 0;
        }

        .warning-box {
            background: #fff3e0;
            border-left: 4px solid #ff9800;
            padding: 15px;
            border-radius: 0 6px 6px 0;
            margin: 15px 0;
        }

        .pattern-info {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }

        .pattern-item {
            background: #f5f5f5;
            padding: 12px;
            border-radius: 6px;
        }

        .pattern-item label {
            display: block;
            font-size: 0.8em;
            color: #666;
            margin-bottom: 4px;
        }

        .workaround-list {
            list-style: none;
            padding: 0;
        }

        .workaround-list li {
            padding: 8px 0 8px 25px;
            position: relative;
        }

        .workaround-list li::before {
            content: '→';
            position: absolute;
            left: 5px;
            color: var(--secondary);
        }

        footer {
            background: #f5f5f5;
            padding: 20px 30px;
            text-align: center;
            font-size: 0.85em;
            color: #666;
        }

        @media print {
            body { background: white; padding: 0; }
            .container { box-shadow: none; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            {% if logo_base64 %}
            <img src="data:image/png;base64,{{ logo_base64 }}" alt="{{ company_name }}" style="height: 40px; margin-bottom: 15px;">
            {% endif %}
            <h1>{{ title }}</h1>
            <div class="meta">
                <span><strong>Generated:</strong> {{ generated_at }}</span>
                <span><strong>Report ID:</strong> {{ report_id }}</span>
            </div>
        </header>

        <main>
            {% if show_summary %}
            <section>
                <h2>Summary</h2>
                <table class="summary-table">
                    <tr>
                        <th>File</th>
                        <td>{{ file_name }}</td>
                    </tr>
                    {% if timestamp %}
                    <tr>
                        <th>Time</th>
                        <td>{{ timestamp }}</td>
                    </tr>
                    {% endif %}
                    {% if not is_customer %}
                    {% if site %}
                    <tr>
                        <th>Site</th>
                        <td>{{ site }}</td>
                    </tr>
                    {% endif %}
                    {% if version %}
                    <tr>
                        <th>Version</th>
                        <td>{{ version }}</td>
                    </tr>
                    {% endif %}
                    {% endif %}
                    <tr>
                        <th>Error Type</th>
                        <td>{{ exception_type }}</td>
                    </tr>
                    {% if pattern %}
                    <tr>
                        <th>Severity</th>
                        <td>
                            <span class="severity severity-{{ pattern.severity | lower }}">
                                {{ pattern.severity }}
                            </span>
                        </td>
                    </tr>
                    {% endif %}
                    {% if has_active_transaction and not is_customer %}
                    <tr>
                        <th>Transaction</th>
                        <td class="warning-box" style="margin: 0;">Active (uncommitted changes)</td>
                    </tr>
                    {% endif %}
                </table>
            </section>
            {% endif %}

            {% if show_environment and not is_customer %}
            <section>
                <h2>Environment</h2>
                <table class="summary-table">
                    {% if site %}<tr><th>Site</th><td>{{ site }}</td></tr>{% endif %}
                    {% if user %}<tr><th>User</th><td>{{ user }}</td></tr>{% endif %}
                    {% if version %}<tr><th>Version</th><td>{{ version }}</td></tr>{% endif %}
                    {% if build %}<tr><th>Build</th><td>{{ build }}</td></tr>{% endif %}
                    {% if computer %}<tr><th>Computer</th><td>{{ computer }}</td></tr>{% endif %}
                    {% if database_backend %}<tr><th>Database</th><td>{{ database_backend }}</td></tr>{% endif %}
                </table>
            </section>
            {% endif %}

            {% if show_exception and not is_customer %}
            <section>
                <h2>Exception Details</h2>
                <div class="code-block">
                    <div>Type: {{ exception_type }}</div>
                    <div>Message: {{ exception_message }}</div>
                    {% if exception_parameter %}
                    <div>Parameter: {{ exception_parameter }}</div>
                    {% endif %}
                </div>
            </section>
            {% endif %}

            {% if show_root_cause and root_cause_plain %}
            <section>
                <h2>Root Cause</h2>
                <div class="info-box">
                    {{ root_cause_plain }}
                </div>
                {% if is_technical and root_cause_technical %}
                <h3 style="margin-top: 20px; font-size: 1em; color: #666;">Technical Details</h3>
                <p style="margin-top: 10px;">{{ root_cause_technical }}</p>
                {% endif %}
            </section>
            {% endif %}

            {% if show_fix and pattern %}
            <section>
                <h2>Suggested Fix</h2>
                <p>{{ pattern.fix_summary }}</p>
                {% if pattern.workarounds %}
                <h3 style="margin-top: 20px; font-size: 1em; color: #666;">Workarounds</h3>
                <ul class="workaround-list">
                    {% for workaround in pattern.workarounds %}
                    <li>{{ workaround }}</li>
                    {% endfor %}
                </ul>
                {% endif %}
            </section>
            {% endif %}

            {% if show_stack_trace and stack_trace and not is_customer %}
            <section>
                <h2>Stack Trace</h2>
                <div class="code-block">
                    {% for frame in stack_trace %}
                    <div class="stack-frame {% if frame.is_application %}app{% else %}framework{% endif %}">
                        <span class="frame-number">[{{ frame.frame_number }}]</span>
                        {{ frame.method }}
                    </div>
                    {% endfor %}
                    {% if stack_trace_truncated %}
                    <div style="color: #888; margin-top: 10px;">... (truncated)</div>
                    {% endif %}
                </div>
            </section>
            {% endif %}

            {% if show_pattern and pattern %}
            <section>
                <h2>Pattern Match</h2>
                <p style="margin-bottom: 15px;">This crash matches a known pattern:</p>
                <div class="pattern-info">
                    <div class="pattern-item">
                        <label>Pattern</label>
                        <strong>{{ pattern.pattern_name }}</strong>
                        <div style="font-size: 0.85em; color: #666;">{{ pattern.pattern_id }}</div>
                    </div>
                    <div class="pattern-item">
                        <label>Confidence</label>
                        <strong>{{ (pattern.confidence * 100) | round }}%</strong>
                    </div>
                    {% if pattern.fixed_in_version %}
                    <div class="pattern-item">
                        <label>Fixed In</label>
                        <strong>{{ pattern.fixed_in_version }}</strong>
                    </div>
                    {% endif %}
                    {% if pattern.tickets %}
                    <div class="pattern-item">
                        <label>Related Tickets</label>
                        <strong>{{ pattern.tickets | join(", ") }}</strong>
                    </div>
                    {% endif %}
                </div>
            </section>
            {% endif %}

            {% if memory_warning %}
            <section>
                <h2>Memory Warning</h2>
                <div class="warning-box">
                    {{ memory_warning }}
                </div>
            </section>
            {% endif %}
        </main>

        {% if footer_text %}
        <footer>
            {{ footer_text }}
        </footer>
        {% endif %}
    </div>
</body>
</html>"#;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::report::{CrashFileSummary, ReportConfig, ReportMetadata};

    #[test]
    fn test_generate_html() {
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

        let html = generate_html(&data);

        assert!(html.contains("<!DOCTYPE html>"));
        assert!(html.contains("Crash Analysis Report"));
        assert!(html.contains("test.txt"));
        assert!(html.contains("TestError"));
    }
}
