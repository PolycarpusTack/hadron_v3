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
    let _ = writeln!(md, "# {}", data.title);
    let _ = writeln!(md);
    let _ = writeln!(md, "**Generated:** {}  ", data.metadata.generated_at);
    let _ = writeln!(md, "**Report ID:** {}  ", data.metadata.report_id);
    let _ = writeln!(
        md,
        "**Source:** {} (`{}`)  ",
        data.source_type, data.source_name
    );
    let _ = writeln!(md);

    for section in &data.sections {
        let _ = writeln!(md, "## {}", section.label);
        let _ = writeln!(md);
        let _ = writeln!(md, "{}", section.content);
        let _ = writeln!(md);
    }

    if let Some(ref footer) = data.footer_text {
        let _ = writeln!(md, "---");
        let _ = writeln!(md, "*{}*", footer);
    }
    md
}

/// Generate a static HTML report with dark theme styling
pub fn generate_generic_html(data: &GenericReportData) -> String {
    let mut html = String::new();
    let _ = writeln!(html, "<!DOCTYPE html>");
    let _ = writeln!(html, "<html lang=\"en\">");
    let _ = writeln!(html, "<head>");
    let _ = writeln!(html, "<meta charset=\"UTF-8\">");
    let _ = writeln!(
        html,
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">"
    );
    let _ = writeln!(html, "<title>{}</title>", escape_html(&data.title));
    let _ = writeln!(html, "<style>");
    let _ = writeln!(
        html,
        "body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; \
         background: #0f172a; color: #e2e8f0; margin: 0; padding: 2rem; line-height: 1.6; }}"
    );
    let _ = writeln!(
        html,
        ".container {{ max-width: 900px; margin: 0 auto; }}"
    );
    let _ = writeln!(
        html,
        "h1 {{ color: #60a5fa; border-bottom: 2px solid #334155; padding-bottom: 0.5rem; }}"
    );
    let _ = writeln!(html, "h2 {{ color: #93c5fd; margin-top: 1.5rem; }}");
    let _ = writeln!(
        html,
        ".meta {{ color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem; }}"
    );
    let _ = writeln!(
        html,
        ".section {{ background: #1e293b; border-radius: 8px; padding: 1.25rem; \
         margin-bottom: 1rem; white-space: pre-wrap; word-wrap: break-word; }}"
    );
    let _ = writeln!(
        html,
        ".footer {{ border-top: 1px solid #334155; margin-top: 2rem; padding-top: 1rem; \
         color: #64748b; font-style: italic; }}"
    );
    let _ = writeln!(html, "</style>");
    let _ = writeln!(html, "</head>");
    let _ = writeln!(html, "<body>");
    let _ = writeln!(html, "<div class=\"container\">");
    let _ = writeln!(html, "<h1>{}</h1>", escape_html(&data.title));
    let _ = writeln!(html, "<div class=\"meta\">");
    let _ = writeln!(
        html,
        "<div>Generated: {}</div>",
        escape_html(&data.metadata.generated_at)
    );
    let _ = writeln!(
        html,
        "<div>Report ID: {}</div>",
        escape_html(&data.metadata.report_id)
    );
    let _ = writeln!(
        html,
        "<div>Source: {} ({})</div>",
        escape_html(&data.source_type),
        escape_html(&data.source_name)
    );
    let _ = writeln!(html, "</div>");

    for section in &data.sections {
        let _ = writeln!(html, "<h2>{}</h2>", escape_html(&section.label));
        let _ = writeln!(
            html,
            "<div class=\"section\">{}</div>",
            escape_html(&section.content)
        );
    }

    if let Some(ref footer) = data.footer_text {
        let _ = writeln!(
            html,
            "<div class=\"footer\">{}</div>",
            escape_html(footer)
        );
    }

    let _ = writeln!(html, "</div>");
    let _ = writeln!(html, "</body>");
    let _ = writeln!(html, "</html>");
    html
}

/// Generate an interactive HTML report with tabbed sections
pub fn generate_generic_html_interactive(data: &GenericReportData) -> String {
    let mut html = String::new();
    let _ = writeln!(html, "<!DOCTYPE html>");
    let _ = writeln!(html, "<html lang=\"en\">");
    let _ = writeln!(html, "<head>");
    let _ = writeln!(html, "<meta charset=\"UTF-8\">");
    let _ = writeln!(
        html,
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">"
    );
    let _ = writeln!(html, "<title>{}</title>", escape_html(&data.title));
    let _ = writeln!(html, "<style>");
    let _ = writeln!(
        html,
        "body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; \
         background: #0f172a; color: #e2e8f0; margin: 0; padding: 2rem; line-height: 1.6; }}"
    );
    let _ = writeln!(
        html,
        ".container {{ max-width: 900px; margin: 0 auto; }}"
    );
    let _ = writeln!(
        html,
        "h1 {{ color: #60a5fa; border-bottom: 2px solid #334155; padding-bottom: 0.5rem; }}"
    );
    let _ = writeln!(
        html,
        ".meta {{ color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem; }}"
    );
    let _ = writeln!(
        html,
        ".tabs {{ display: flex; gap: 0; border-bottom: 2px solid #334155; margin-bottom: 1rem; }}"
    );
    let _ = writeln!(
        html,
        ".tab-btn {{ background: none; border: none; color: #94a3b8; padding: 0.75rem 1.25rem; \
         cursor: pointer; font-size: 0.95rem; border-bottom: 2px solid transparent; \
         margin-bottom: -2px; transition: color 0.2s, border-color 0.2s; }}"
    );
    let _ = writeln!(
        html,
        ".tab-btn:hover {{ color: #e2e8f0; }}"
    );
    let _ = writeln!(
        html,
        ".tab-btn.active {{ color: #60a5fa; border-bottom-color: #60a5fa; }}"
    );
    let _ = writeln!(
        html,
        ".panel {{ display: none; background: #1e293b; border-radius: 8px; padding: 1.25rem; \
         white-space: pre-wrap; word-wrap: break-word; }}"
    );
    let _ = writeln!(html, ".panel.active {{ display: block; }}");
    let _ = writeln!(
        html,
        ".footer {{ border-top: 1px solid #334155; margin-top: 2rem; padding-top: 1rem; \
         color: #64748b; font-style: italic; }}"
    );
    let _ = writeln!(html, "</style>");
    let _ = writeln!(html, "</head>");
    let _ = writeln!(html, "<body>");
    let _ = writeln!(html, "<div class=\"container\">");
    let _ = writeln!(html, "<h1>{}</h1>", escape_html(&data.title));
    let _ = writeln!(html, "<div class=\"meta\">");
    let _ = writeln!(
        html,
        "<div>Generated: {}</div>",
        escape_html(&data.metadata.generated_at)
    );
    let _ = writeln!(
        html,
        "<div>Report ID: {}</div>",
        escape_html(&data.metadata.report_id)
    );
    let _ = writeln!(
        html,
        "<div>Source: {} ({})</div>",
        escape_html(&data.source_type),
        escape_html(&data.source_name)
    );
    let _ = writeln!(html, "</div>");

    // Tab buttons
    let _ = writeln!(html, "<div class=\"tabs\">");
    for (i, section) in data.sections.iter().enumerate() {
        let active = if i == 0 { " active" } else { "" };
        let _ = writeln!(
            html,
            "<button class=\"tab-btn{}\" onclick=\"switchTab('{}', this)\">{}</button>",
            active,
            escape_html(&section.id),
            escape_html(&section.label)
        );
    }
    let _ = writeln!(html, "</div>");

    // Tab panels
    for (i, section) in data.sections.iter().enumerate() {
        let active = if i == 0 { " active" } else { "" };
        let _ = writeln!(
            html,
            "<div id=\"panel-{}\" class=\"panel{}\">{}</div>",
            escape_html(&section.id),
            active,
            escape_html(&section.content)
        );
    }

    if let Some(ref footer) = data.footer_text {
        let _ = writeln!(
            html,
            "<div class=\"footer\">{}</div>",
            escape_html(footer)
        );
    }

    let _ = writeln!(html, "</div>");
    let _ = writeln!(html, "<script>");
    let _ = writeln!(
        html,
        "function switchTab(id, btn) {{\
         document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));\
         document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));\
         document.getElementById('panel-' + id).classList.add('active');\
         btn.classList.add('active');\
         }}"
    );
    let _ = writeln!(html, "</script>");
    let _ = writeln!(html, "</body>");
    let _ = writeln!(html, "</html>");
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
    let _ = writeln!(txt, "{}", title);
    let _ = writeln!(txt, "{}", "=".repeat(title.len()));
    let _ = writeln!(txt);
    let _ = writeln!(txt, "Generated: {}", data.metadata.generated_at);
    let _ = writeln!(txt, "Report ID: {}", data.metadata.report_id);
    let _ = writeln!(
        txt,
        "Source:    {} ({})",
        data.source_type, data.source_name
    );
    let _ = writeln!(txt);

    for section in &data.sections {
        let label = section.label.to_uppercase();
        let _ = writeln!(txt, "{}", label);
        let _ = writeln!(txt, "{}", "-".repeat(label.len()));
        let _ = writeln!(txt, "{}", section.content);
        let _ = writeln!(txt);
    }

    if let Some(ref footer) = data.footer_text {
        let _ = writeln!(txt, "{}", "-".repeat(40));
        let _ = writeln!(txt, "{}", footer);
    }
    txt
}

/// Generate an XLSX report (falls back to markdown for now)
pub fn generate_generic_xlsx(data: &GenericReportData) -> String {
    // XLSX binary generation can be added later; fall back to markdown
    generate_generic_markdown(data)
}
