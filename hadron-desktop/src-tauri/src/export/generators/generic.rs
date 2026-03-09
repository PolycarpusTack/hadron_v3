use std::fmt::Write;

use crate::export::report::GenericReportData;

/// Escape HTML special characters
fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Generate a Markdown report from generic report data
pub fn generate_generic_markdown(data: &GenericReportData) -> String {
    let mut md = String::new();
    writeln!(md, "# {}", data.title).unwrap();
    writeln!(md).unwrap();
    writeln!(md, "**Generated:** {}  ", data.metadata.generated_at).unwrap();
    writeln!(md, "**Report ID:** {}  ", data.metadata.report_id).unwrap();
    writeln!(
        md,
        "**Source:** {} (`{}`)  ",
        data.source_type, data.source_name
    )
    .unwrap();
    writeln!(md).unwrap();

    for section in &data.sections {
        writeln!(md, "## {}", section.label).unwrap();
        writeln!(md).unwrap();
        writeln!(md, "{}", section.content).unwrap();
        writeln!(md).unwrap();
    }

    if let Some(ref footer) = data.footer_text {
        writeln!(md, "---").unwrap();
        writeln!(md, "*{}*", footer).unwrap();
    }
    md
}

/// Generate a static HTML report with dark theme styling
pub fn generate_generic_html(data: &GenericReportData) -> String {
    let mut html = String::new();
    writeln!(html, "<!DOCTYPE html>").unwrap();
    writeln!(html, "<html lang=\"en\">").unwrap();
    writeln!(html, "<head>").unwrap();
    writeln!(html, "<meta charset=\"UTF-8\">").unwrap();
    writeln!(
        html,
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">"
    )
    .unwrap();
    writeln!(html, "<title>{}</title>", escape_html(&data.title)).unwrap();
    writeln!(html, "<style>").unwrap();
    writeln!(
        html,
        "body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; \
         background: #0f172a; color: #e2e8f0; margin: 0; padding: 2rem; line-height: 1.6; }}"
    )
    .unwrap();
    writeln!(
        html,
        ".container {{ max-width: 900px; margin: 0 auto; }}"
    )
    .unwrap();
    writeln!(
        html,
        "h1 {{ color: #60a5fa; border-bottom: 2px solid #334155; padding-bottom: 0.5rem; }}"
    )
    .unwrap();
    writeln!(html, "h2 {{ color: #93c5fd; margin-top: 1.5rem; }}").unwrap();
    writeln!(
        html,
        ".meta {{ color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem; }}"
    )
    .unwrap();
    writeln!(
        html,
        ".section {{ background: #1e293b; border-radius: 8px; padding: 1.25rem; \
         margin-bottom: 1rem; white-space: pre-wrap; word-wrap: break-word; }}"
    )
    .unwrap();
    writeln!(
        html,
        ".footer {{ border-top: 1px solid #334155; margin-top: 2rem; padding-top: 1rem; \
         color: #64748b; font-style: italic; }}"
    )
    .unwrap();
    writeln!(html, "</style>").unwrap();
    writeln!(html, "</head>").unwrap();
    writeln!(html, "<body>").unwrap();
    writeln!(html, "<div class=\"container\">").unwrap();
    writeln!(html, "<h1>{}</h1>", escape_html(&data.title)).unwrap();
    writeln!(html, "<div class=\"meta\">").unwrap();
    writeln!(
        html,
        "<div>Generated: {}</div>",
        escape_html(&data.metadata.generated_at)
    )
    .unwrap();
    writeln!(
        html,
        "<div>Report ID: {}</div>",
        escape_html(&data.metadata.report_id)
    )
    .unwrap();
    writeln!(
        html,
        "<div>Source: {} ({})</div>",
        escape_html(&data.source_type),
        escape_html(&data.source_name)
    )
    .unwrap();
    writeln!(html, "</div>").unwrap();

    for section in &data.sections {
        writeln!(html, "<h2>{}</h2>", escape_html(&section.label)).unwrap();
        writeln!(
            html,
            "<div class=\"section\">{}</div>",
            escape_html(&section.content)
        )
        .unwrap();
    }

    if let Some(ref footer) = data.footer_text {
        writeln!(
            html,
            "<div class=\"footer\">{}</div>",
            escape_html(footer)
        )
        .unwrap();
    }

    writeln!(html, "</div>").unwrap();
    writeln!(html, "</body>").unwrap();
    writeln!(html, "</html>").unwrap();
    html
}

/// Generate an interactive HTML report with tabbed sections
pub fn generate_generic_html_interactive(data: &GenericReportData) -> String {
    let mut html = String::new();
    writeln!(html, "<!DOCTYPE html>").unwrap();
    writeln!(html, "<html lang=\"en\">").unwrap();
    writeln!(html, "<head>").unwrap();
    writeln!(html, "<meta charset=\"UTF-8\">").unwrap();
    writeln!(
        html,
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">"
    )
    .unwrap();
    writeln!(html, "<title>{}</title>", escape_html(&data.title)).unwrap();
    writeln!(html, "<style>").unwrap();
    writeln!(
        html,
        "body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; \
         background: #0f172a; color: #e2e8f0; margin: 0; padding: 2rem; line-height: 1.6; }}"
    )
    .unwrap();
    writeln!(
        html,
        ".container {{ max-width: 900px; margin: 0 auto; }}"
    )
    .unwrap();
    writeln!(
        html,
        "h1 {{ color: #60a5fa; border-bottom: 2px solid #334155; padding-bottom: 0.5rem; }}"
    )
    .unwrap();
    writeln!(
        html,
        ".meta {{ color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem; }}"
    )
    .unwrap();
    writeln!(
        html,
        ".tabs {{ display: flex; gap: 0; border-bottom: 2px solid #334155; margin-bottom: 1rem; }}"
    )
    .unwrap();
    writeln!(
        html,
        ".tab-btn {{ background: none; border: none; color: #94a3b8; padding: 0.75rem 1.25rem; \
         cursor: pointer; font-size: 0.95rem; border-bottom: 2px solid transparent; \
         margin-bottom: -2px; transition: color 0.2s, border-color 0.2s; }}"
    )
    .unwrap();
    writeln!(
        html,
        ".tab-btn:hover {{ color: #e2e8f0; }}"
    )
    .unwrap();
    writeln!(
        html,
        ".tab-btn.active {{ color: #60a5fa; border-bottom-color: #60a5fa; }}"
    )
    .unwrap();
    writeln!(
        html,
        ".panel {{ display: none; background: #1e293b; border-radius: 8px; padding: 1.25rem; \
         white-space: pre-wrap; word-wrap: break-word; }}"
    )
    .unwrap();
    writeln!(html, ".panel.active {{ display: block; }}").unwrap();
    writeln!(
        html,
        ".footer {{ border-top: 1px solid #334155; margin-top: 2rem; padding-top: 1rem; \
         color: #64748b; font-style: italic; }}"
    )
    .unwrap();
    writeln!(html, "</style>").unwrap();
    writeln!(html, "</head>").unwrap();
    writeln!(html, "<body>").unwrap();
    writeln!(html, "<div class=\"container\">").unwrap();
    writeln!(html, "<h1>{}</h1>", escape_html(&data.title)).unwrap();
    writeln!(html, "<div class=\"meta\">").unwrap();
    writeln!(
        html,
        "<div>Generated: {}</div>",
        escape_html(&data.metadata.generated_at)
    )
    .unwrap();
    writeln!(
        html,
        "<div>Report ID: {}</div>",
        escape_html(&data.metadata.report_id)
    )
    .unwrap();
    writeln!(
        html,
        "<div>Source: {} ({})</div>",
        escape_html(&data.source_type),
        escape_html(&data.source_name)
    )
    .unwrap();
    writeln!(html, "</div>").unwrap();

    // Tab buttons
    writeln!(html, "<div class=\"tabs\">").unwrap();
    for (i, section) in data.sections.iter().enumerate() {
        let active = if i == 0 { " active" } else { "" };
        writeln!(
            html,
            "<button class=\"tab-btn{}\" onclick=\"switchTab('{}', this)\">{}</button>",
            active,
            escape_html(&section.id),
            escape_html(&section.label)
        )
        .unwrap();
    }
    writeln!(html, "</div>").unwrap();

    // Tab panels
    for (i, section) in data.sections.iter().enumerate() {
        let active = if i == 0 { " active" } else { "" };
        writeln!(
            html,
            "<div id=\"panel-{}\" class=\"panel{}\">{}</div>",
            escape_html(&section.id),
            active,
            escape_html(&section.content)
        )
        .unwrap();
    }

    if let Some(ref footer) = data.footer_text {
        writeln!(
            html,
            "<div class=\"footer\">{}</div>",
            escape_html(footer)
        )
        .unwrap();
    }

    writeln!(html, "</div>").unwrap();
    writeln!(html, "<script>").unwrap();
    writeln!(
        html,
        "function switchTab(id, btn) {{\
         document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));\
         document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));\
         document.getElementById('panel-' + id).classList.add('active');\
         btn.classList.add('active');\
         }}"
    )
    .unwrap();
    writeln!(html, "</script>").unwrap();
    writeln!(html, "</body>").unwrap();
    writeln!(html, "</html>").unwrap();
    html
}

/// Generate a JSON report from generic report data
pub fn generate_generic_json(data: &GenericReportData) -> String {
    serde_json::to_string_pretty(data).unwrap_or_else(|e| format!("{{\"error\": \"{}\"}}", e))
}

/// Generate a plain text report from generic report data
pub fn generate_generic_txt(data: &GenericReportData) -> String {
    let mut txt = String::new();
    let title = data.title.to_uppercase();
    writeln!(txt, "{}", title).unwrap();
    writeln!(txt, "{}", "=".repeat(title.len())).unwrap();
    writeln!(txt).unwrap();
    writeln!(txt, "Generated: {}", data.metadata.generated_at).unwrap();
    writeln!(txt, "Report ID: {}", data.metadata.report_id).unwrap();
    writeln!(
        txt,
        "Source:    {} ({})",
        data.source_type, data.source_name
    )
    .unwrap();
    writeln!(txt).unwrap();

    for section in &data.sections {
        let label = section.label.to_uppercase();
        writeln!(txt, "{}", label).unwrap();
        writeln!(txt, "{}", "-".repeat(label.len())).unwrap();
        writeln!(txt, "{}", section.content).unwrap();
        writeln!(txt).unwrap();
    }

    if let Some(ref footer) = data.footer_text {
        writeln!(txt, "{}", "-".repeat(40)).unwrap();
        writeln!(txt, "{}", footer).unwrap();
    }
    txt
}

/// Generate an XLSX report (falls back to markdown for now)
pub fn generate_generic_xlsx(data: &GenericReportData) -> String {
    // XLSX binary generation can be added later; fall back to markdown
    generate_generic_markdown(data)
}
