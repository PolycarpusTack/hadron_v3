use crate::export::report::{ReportAudience, ReportData};
use crate::export::sanitizer::simplify_technical_terms;
use minijinja::{context, Environment};

/// Generate an interactive HTML report with tabbed navigation
pub fn generate_html_interactive(data: &ReportData) -> String {
    let mut env = Environment::new();

    env.add_template("report_interactive", HTML_INTERACTIVE_TEMPLATE)
        .expect("HTML_INTERACTIVE_TEMPLATE is a valid constant template");

    let template = env
        .get_template("report_interactive")
        .expect("template was just added above");

    let config = &data.config;
    let crash = &data.crash;
    let is_customer = config.audience == ReportAudience::Customer;

    let exception_display = if is_customer {
        simplify_technical_terms(&crash.exception_type)
    } else {
        crash.exception_type.clone()
    };

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

    // Build the list of visible tabs based on config
    let mut tabs = Vec::new();
    if config.sections.summary {
        tabs.push(("summary", "Summary"));
    }
    if config.sections.environment && !is_customer {
        tabs.push(("environment", "Environment"));
    }
    if config.sections.exception_details && !is_customer {
        tabs.push(("exception", "Exception"));
    }
    if config.sections.root_cause && data.pattern_match.is_some() {
        tabs.push(("root_cause", "Root Cause"));
    }
    if config.sections.suggested_fix && data.pattern_match.is_some() {
        tabs.push(("fix", "Suggested Fix"));
    }
    if config.sections.stack_trace && !crash.stack_trace.is_empty() && !is_customer {
        tabs.push(("stack_trace", "Stack Trace"));
    }
    if config.sections.pattern_match && data.pattern_match.is_some() {
        tabs.push(("pattern", "Pattern Match"));
    }

    let tab_ids: Vec<&str> = tabs.iter().map(|(id, _)| *id).collect();
    let tab_labels: Vec<&str> = tabs.iter().map(|(_, label)| *label).collect();

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
        show_environment => config.sections.environment && !is_customer,
        show_exception => config.sections.exception_details && !is_customer,
        show_root_cause => config.sections.root_cause && data.pattern_match.is_some(),
        show_fix => config.sections.suggested_fix && data.pattern_match.is_some(),
        show_stack_trace => config.sections.stack_trace && !crash.stack_trace.is_empty() && !is_customer,
        show_pattern => config.sections.pattern_match && data.pattern_match.is_some(),

        // Tab data
        tab_ids => tab_ids,
        tab_labels => tab_labels,

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

const HTML_INTERACTIVE_TEMPLATE: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ title }}</title>
    <style>
        :root {
            --primary: {{ primary_color }};
            --secondary: {{ secondary_color }};
            --bg-dark: #0f172a;
            --bg-card: #1e293b;
            --bg-hover: #334155;
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --border: #334155;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6;
            color: var(--text-primary);
            background: var(--bg-dark);
            min-height: 100vh;
        }

        .container {
            max-width: 1100px;
            margin: 0 auto;
            padding: 20px;
        }

        /* Header */
        .report-header {
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            padding: 30px;
            border-radius: 12px;
            margin-bottom: 20px;
        }

        .report-header h1 {
            font-size: 1.8em;
            margin-bottom: 8px;
        }

        .report-header .meta {
            font-size: 0.9em;
            opacity: 0.85;
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
        }

        /* Tab Navigation */
        .tab-nav {
            display: flex;
            gap: 4px;
            background: var(--bg-card);
            padding: 6px;
            border-radius: 10px;
            margin-bottom: 20px;
            overflow-x: auto;
        }

        .tab-btn {
            padding: 10px 20px;
            border: none;
            background: transparent;
            color: var(--text-secondary);
            font-size: 0.9em;
            font-weight: 500;
            cursor: pointer;
            border-radius: 8px;
            transition: all 0.2s ease;
            white-space: nowrap;
        }

        .tab-btn:hover {
            background: var(--bg-hover);
            color: var(--text-primary);
        }

        .tab-btn.active {
            background: var(--secondary);
            color: white;
            font-weight: 600;
        }

        /* Tab Panels */
        .tab-panel {
            display: none;
            animation: fadeIn 0.3s ease;
        }

        .tab-panel.active {
            display: block;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(5px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* Cards */
        .card {
            background: var(--bg-card);
            border-radius: 10px;
            padding: 24px;
            margin-bottom: 16px;
            border: 1px solid var(--border);
        }

        .card h2 {
            font-size: 1.2em;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .card h2::before {
            content: '';
            display: block;
            width: 4px;
            height: 1.2em;
            background: var(--secondary);
            border-radius: 2px;
        }

        /* Tables */
        .data-table {
            width: 100%;
            border-collapse: collapse;
        }

        .data-table th,
        .data-table td {
            padding: 10px 15px;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }

        .data-table th {
            width: 150px;
            font-weight: 600;
            color: var(--text-secondary);
        }

        /* Code blocks */
        .code-block {
            background: #0d1117;
            color: #c9d1d9;
            padding: 16px;
            border-radius: 8px;
            font-family: 'Fira Code', 'Consolas', monospace;
            font-size: 0.88em;
            overflow-x: auto;
        }

        .stack-frame {
            padding: 4px 0;
            border-bottom: 1px solid #1e293b;
        }

        .stack-frame:last-child { border-bottom: none; }
        .stack-frame.app { color: #58a6ff; }
        .stack-frame.framework { color: #6e7681; }

        .frame-number {
            color: #6e7681;
            margin-right: 10px;
            min-width: 35px;
            display: inline-block;
        }

        /* Badges */
        .severity {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 6px;
            font-size: 0.85em;
            font-weight: 600;
        }

        .severity-critical { background: #dc2626; color: white; }
        .severity-high { background: #ea580c; color: white; }
        .severity-medium { background: #d97706; color: #1e1e1e; }
        .severity-low { background: #16a34a; color: white; }

        /* Info / Warning boxes */
        .info-box {
            background: rgba(59, 130, 246, 0.1);
            border-left: 4px solid var(--secondary);
            padding: 16px;
            border-radius: 0 8px 8px 0;
            margin: 12px 0;
        }

        .warning-box {
            background: rgba(234, 179, 8, 0.1);
            border-left: 4px solid #eab308;
            padding: 16px;
            border-radius: 0 8px 8px 0;
            margin: 12px 0;
        }

        /* Grid layout for pattern info */
        .pattern-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 12px;
        }

        .pattern-item {
            background: var(--bg-hover);
            padding: 14px;
            border-radius: 8px;
        }

        .pattern-item label {
            display: block;
            font-size: 0.8em;
            color: var(--text-secondary);
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
            content: '\2192';
            position: absolute;
            left: 5px;
            color: var(--secondary);
        }

        /* Footer */
        .report-footer {
            text-align: center;
            padding: 20px;
            color: var(--text-secondary);
            font-size: 0.85em;
        }

        /* Print styles */
        @media print {
            body { background: white; color: #333; }
            .container { max-width: 100%; }
            .report-header { background: var(--primary); }
            .tab-nav { display: none; }
            .tab-panel { display: block !important; page-break-inside: avoid; }
            .card { border: 1px solid #ddd; background: white; }
            .code-block { background: #f5f5f5; color: #333; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="report-header">
            {% if logo_base64 %}
            <img src="data:image/png;base64,{{ logo_base64 }}" alt="{{ company_name }}" style="height: 40px; margin-bottom: 15px;">
            {% endif %}
            <h1>{{ title }}</h1>
            <div class="meta">
                <span><strong>Generated:</strong> {{ generated_at }}</span>
                <span><strong>Report ID:</strong> {{ report_id }}</span>
                <span><strong>File:</strong> {{ file_name }}</span>
            </div>
        </div>

        <!-- Tab Navigation -->
        <div class="tab-nav" role="tablist">
            {% for i in range(tab_ids | length) %}
            <button class="tab-btn{% if loop.first %} active{% endif %}"
                    role="tab"
                    aria-selected="{% if loop.first %}true{% else %}false{% endif %}"
                    aria-controls="panel-{{ tab_ids[i] }}"
                    data-tab="{{ tab_ids[i] }}"
                    onclick="switchTab('{{ tab_ids[i] }}')">
                {{ tab_labels[i] }}
            </button>
            {% endfor %}
        </div>

        <!-- Tab Panels -->

        {% if show_summary %}
        <div id="panel-summary" class="tab-panel active" role="tabpanel">
            <div class="card">
                <h2>Summary</h2>
                <table class="data-table">
                    <tr><th>File</th><td>{{ file_name }}</td></tr>
                    {% if timestamp %}<tr><th>Time</th><td>{{ timestamp }}</td></tr>{% endif %}
                    {% if not is_customer %}
                        {% if site %}<tr><th>Site</th><td>{{ site }}</td></tr>{% endif %}
                        {% if version %}<tr><th>Version</th><td>{{ version }}</td></tr>{% endif %}
                    {% endif %}
                    <tr><th>Error Type</th><td>{{ exception_type }}</td></tr>
                    {% if pattern %}
                    <tr>
                        <th>Severity</th>
                        <td><span class="severity severity-{{ pattern.severity | lower }}">{{ pattern.severity }}</span></td>
                    </tr>
                    {% endif %}
                    {% if has_active_transaction and not is_customer %}
                    <tr><th>Transaction</th><td class="warning-box" style="margin:0;">Active (uncommitted changes)</td></tr>
                    {% endif %}
                </table>
                {% if memory_warning %}
                <div class="warning-box" style="margin-top: 16px;">{{ memory_warning }}</div>
                {% endif %}
            </div>
        </div>
        {% endif %}

        {% if show_environment %}
        <div id="panel-environment" class="tab-panel" role="tabpanel">
            <div class="card">
                <h2>Environment</h2>
                <table class="data-table">
                    {% if site %}<tr><th>Site</th><td>{{ site }}</td></tr>{% endif %}
                    {% if user %}<tr><th>User</th><td>{{ user }}</td></tr>{% endif %}
                    {% if version %}<tr><th>Version</th><td>{{ version }}</td></tr>{% endif %}
                    {% if build %}<tr><th>Build</th><td>{{ build }}</td></tr>{% endif %}
                    {% if computer %}<tr><th>Computer</th><td>{{ computer }}</td></tr>{% endif %}
                    {% if database_backend %}<tr><th>Database</th><td>{{ database_backend }}</td></tr>{% endif %}
                </table>
            </div>
        </div>
        {% endif %}

        {% if show_exception %}
        <div id="panel-exception" class="tab-panel" role="tabpanel">
            <div class="card">
                <h2>Exception Details</h2>
                <div class="code-block">
                    <div>Type: {{ exception_type }}</div>
                    <div>Message: {{ exception_message }}</div>
                    {% if exception_parameter %}
                    <div>Parameter: {{ exception_parameter }}</div>
                    {% endif %}
                </div>
            </div>
        </div>
        {% endif %}

        {% if show_root_cause %}
        <div id="panel-root_cause" class="tab-panel" role="tabpanel">
            <div class="card">
                <h2>Root Cause</h2>
                <div class="info-box">{{ root_cause_plain }}</div>
                {% if is_technical and root_cause_technical %}
                <h3 style="margin-top: 20px; font-size: 1em; color: var(--text-secondary);">Technical Details</h3>
                <p style="margin-top: 10px;">{{ root_cause_technical }}</p>
                {% endif %}
            </div>
        </div>
        {% endif %}

        {% if show_fix %}
        <div id="panel-fix" class="tab-panel" role="tabpanel">
            <div class="card">
                <h2>Suggested Fix</h2>
                <p>{{ pattern.fix_summary }}</p>
                {% if pattern.workarounds %}
                <h3 style="margin-top: 20px; font-size: 1em; color: var(--text-secondary);">Workarounds</h3>
                <ul class="workaround-list">
                    {% for workaround in pattern.workarounds %}
                    <li>{{ workaround }}</li>
                    {% endfor %}
                </ul>
                {% endif %}
            </div>
        </div>
        {% endif %}

        {% if show_stack_trace %}
        <div id="panel-stack_trace" class="tab-panel" role="tabpanel">
            <div class="card">
                <h2>Stack Trace</h2>
                <div class="code-block">
                    {% for frame in stack_trace %}
                    <div class="stack-frame {% if frame.is_application %}app{% else %}framework{% endif %}">
                        <span class="frame-number">[{{ frame.frame_number }}]</span>
                        {{ frame.method }}
                    </div>
                    {% endfor %}
                    {% if stack_trace_truncated %}
                    <div style="color: #6e7681; margin-top: 10px;">... (truncated)</div>
                    {% endif %}
                </div>
            </div>
        </div>
        {% endif %}

        {% if show_pattern %}
        <div id="panel-pattern" class="tab-panel" role="tabpanel">
            <div class="card">
                <h2>Pattern Match</h2>
                <p style="margin-bottom: 15px;">This crash matches a known pattern:</p>
                <div class="pattern-grid">
                    <div class="pattern-item">
                        <label>Pattern</label>
                        <strong>{{ pattern.pattern_name }}</strong>
                        <div style="font-size: 0.85em; color: var(--text-secondary);">{{ pattern.pattern_id }}</div>
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
            </div>
        </div>
        {% endif %}

        {% if footer_text %}
        <div class="report-footer">{{ footer_text }}</div>
        {% endif %}
    </div>

    <script>
    function switchTab(tabId) {
        // Deactivate all tabs and panels
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.remove('active');
            btn.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.tab-panel').forEach(function(panel) {
            panel.classList.remove('active');
        });

        // Activate the selected tab and panel
        var btn = document.querySelector('[data-tab="' + tabId + '"]');
        if (btn) {
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
        }
        var panel = document.getElementById('panel-' + tabId);
        if (panel) {
            panel.classList.add('active');
        }
    }

    // Keyboard navigation for tabs
    document.querySelector('.tab-nav').addEventListener('keydown', function(e) {
        var tabs = Array.from(document.querySelectorAll('.tab-btn'));
        var current = tabs.findIndex(function(t) { return t.classList.contains('active'); });
        var next = current;

        if (e.key === 'ArrowRight') { next = (current + 1) % tabs.length; }
        else if (e.key === 'ArrowLeft') { next = (current - 1 + tabs.length) % tabs.length; }
        else { return; }

        e.preventDefault();
        tabs[next].focus();
        switchTab(tabs[next].dataset.tab);
    });
    </script>
</body>
</html>"#;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::report::{CrashFileSummary, ReportConfig, ReportMetadata};

    #[test]
    fn test_generate_html_interactive() {
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

        let html = generate_html_interactive(&data);

        assert!(html.contains("<!DOCTYPE html>"));
        assert!(html.contains("switchTab"));
        assert!(html.contains("tab-nav"));
        assert!(html.contains("test.txt"));
    }
}
