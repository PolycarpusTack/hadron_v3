use super::types::GenericReportData;

// ============================================================================
// HTML helper
// ============================================================================

/// Escapes `&`, `<`, `>`, and `"` for safe HTML embedding.
pub fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            other => out.push(other),
        }
    }
    out
}

// ============================================================================
// Generators
// ============================================================================

/// Generates a Markdown document from `data`.
pub fn generate_markdown(data: &GenericReportData) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {}\n\n", data.title));

    for section in &data.sections {
        out.push_str(&format!("## {}\n\n", section.label));
        out.push_str(&section.content);
        out.push_str("\n\n");
    }

    if let Some(footer) = &data.footer {
        out.push_str("---\n\n");
        out.push_str(footer);
        out.push('\n');
    }

    out
}

/// Generates a static HTML document with a dark theme from `data`.
pub fn generate_html(data: &GenericReportData) -> String {
    let mut sections_html = String::new();
    for section in &data.sections {
        sections_html.push_str(&format!(
            r#"<div class="card">
  <h2>{}</h2>
  <div class="content">{}</div>
</div>
"#,
            escape_html(&section.label),
            escape_html(&section.content)
        ));
    }

    let footer_html = match &data.footer {
        Some(f) => format!(r#"<footer><p>{}</p></footer>"#, escape_html(f)),
        None => String::new(),
    };

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background: #1e293b;
      color: #e2e8f0;
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1.6;
      padding: 2rem;
    }}
    h1 {{ font-size: 1.75rem; margin-bottom: 1.5rem; color: #f1f5f9; }}
    h2 {{ font-size: 1.125rem; margin-bottom: 0.75rem; color: #cbd5e1; }}
    .card {{
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 0.5rem;
      padding: 1.25rem 1.5rem;
      margin-bottom: 1.25rem;
    }}
    .content {{ white-space: pre-wrap; font-size: 0.9rem; color: #94a3b8; }}
    footer {{
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid #334155;
      font-size: 0.8rem;
      color: #64748b;
    }}
  </style>
</head>
<body>
  <h1>{title_escaped}</h1>
  {sections}
  {footer}
</body>
</html>"#,
        title = escape_html(&data.title),
        title_escaped = escape_html(&data.title),
        sections = sections_html,
        footer = footer_html
    )
}

/// Generates an interactive HTML document with a tab bar from `data`.
pub fn generate_interactive_html(data: &GenericReportData) -> String {
    if data.sections.is_empty() {
        return generate_html(data);
    }

    // Build tab buttons
    let mut tabs_html = String::new();
    for (i, section) in data.sections.iter().enumerate() {
        let active = if i == 0 { " active" } else { "" };
        tabs_html.push_str(&format!(
            r#"<button class="tab{active}" onclick="switchTab('{id}')">{label}</button>"#,
            active = active,
            id = escape_html(&section.id),
            label = escape_html(&section.label)
        ));
    }

    // Build panel divs
    let mut panels_html = String::new();
    for (i, section) in data.sections.iter().enumerate() {
        let display = if i == 0 { "block" } else { "none" };
        panels_html.push_str(&format!(
            r#"<div id="panel-{id}" class="panel" style="display:{display}">
  <div class="content">{content}</div>
</div>
"#,
            id = escape_html(&section.id),
            display = display,
            content = escape_html(&section.content)
        ));
    }

    // Collect section IDs for JS
    let ids_js: String = data
        .sections
        .iter()
        .map(|s| format!(r#""{}""#, escape_html(&s.id)))
        .collect::<Vec<_>>()
        .join(", ");

    let footer_html = match &data.footer {
        Some(f) => format!(r#"<footer><p>{}</p></footer>"#, escape_html(f)),
        None => String::new(),
    };

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background: #1e293b;
      color: #e2e8f0;
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1.6;
      padding: 2rem;
    }}
    h1 {{ font-size: 1.75rem; margin-bottom: 1.25rem; color: #f1f5f9; }}
    .tab-bar {{
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid #334155;
      padding-bottom: 0.75rem;
    }}
    .tab {{
      background: #1e293b;
      color: #94a3b8;
      border: 1px solid #334155;
      border-radius: 0.375rem;
      padding: 0.4rem 1rem;
      cursor: pointer;
      font-size: 0.875rem;
      transition: background 0.15s;
    }}
    .tab:hover {{ background: #334155; color: #e2e8f0; }}
    .tab.active {{ background: #3b82f6; color: #fff; border-color: #3b82f6; }}
    .panel {{ background: #0f172a; border: 1px solid #334155; border-radius: 0.5rem; padding: 1.25rem 1.5rem; }}
    .content {{ white-space: pre-wrap; font-size: 0.9rem; color: #94a3b8; }}
    footer {{
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid #334155;
      font-size: 0.8rem;
      color: #64748b;
    }}
  </style>
</head>
<body>
  <h1>{title_escaped}</h1>
  <div class="tab-bar">
    {tabs}
  </div>
  {panels}
  {footer}
  <script>
    var _ids = [{ids_js}];
    function switchTab(id) {{
      _ids.forEach(function(sid) {{
        var panel = document.getElementById('panel-' + sid);
        if (panel) panel.style.display = (sid === id) ? 'block' : 'none';
      }});
      document.querySelectorAll('.tab').forEach(function(btn) {{
        btn.classList.toggle('active', btn.getAttribute('onclick') === "switchTab('" + id + "')");
      }});
    }}
  </script>
</body>
</html>"#,
        title = escape_html(&data.title),
        title_escaped = escape_html(&data.title),
        tabs = tabs_html,
        panels = panels_html,
        footer = footer_html,
        ids_js = ids_js
    )
}

/// Generates a pretty-printed JSON representation of `data`.
pub fn generate_json(data: &GenericReportData) -> String {
    serde_json::to_string_pretty(data).unwrap_or_else(|e| format!("{{\"error\": \"{e}\"}}"))
}

/// Generates a plain-text document with ASCII separators from `data`.
pub fn generate_txt(data: &GenericReportData) -> String {
    let sep = "=".repeat(60);
    let thin = "-".repeat(60);
    let mut out = String::new();

    out.push_str(&sep);
    out.push('\n');
    out.push_str(&data.title.to_uppercase());
    out.push('\n');
    out.push_str(&sep);
    out.push_str("\n\n");

    for section in &data.sections {
        out.push_str(&section.label.to_uppercase());
        out.push('\n');
        out.push_str(&thin);
        out.push('\n');
        out.push_str(&section.content);
        out.push_str("\n\n");
    }

    if let Some(footer) = &data.footer {
        out.push_str(&sep);
        out.push('\n');
        out.push_str(footer);
        out.push('\n');
    }

    out
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::types::{GenericReportData, ReportSection};

    fn sample_report() -> GenericReportData {
        GenericReportData {
            title: "Test Report".into(),
            source_type: "unit-test".into(),
            audience: Some("Engineers".into()),
            sections: vec![
                ReportSection {
                    id: "overview".into(),
                    label: "Overview".into(),
                    content: "This is the overview content.".into(),
                },
                ReportSection {
                    id: "details".into(),
                    label: "Details".into(),
                    content: "These are the details.".into(),
                },
            ],
            footer: Some("Generated by Hadron".into()),
        }
    }

    #[test]
    fn test_generate_markdown() {
        let report = sample_report();
        let md = generate_markdown(&report);

        assert!(md.starts_with("# Test Report\n"));
        assert!(md.contains("## Overview\n"));
        assert!(md.contains("This is the overview content."));
        assert!(md.contains("## Details\n"));
        assert!(md.contains("---\n"));
        assert!(md.contains("Generated by Hadron"));
    }

    #[test]
    fn test_generate_html() {
        let report = sample_report();
        let html = generate_html(&report);

        assert!(html.contains("<!DOCTYPE html>"));
        assert!(html.contains("background: #1e293b"));
        assert!(html.contains("color: #e2e8f0"));
        assert!(html.contains("Test Report"));
        assert!(html.contains("Overview"));
        assert!(html.contains("This is the overview content."));
        assert!(html.contains("Generated by Hadron"));
    }

    #[test]
    fn test_generate_interactive_html() {
        let report = sample_report();
        let html = generate_interactive_html(&report);

        assert!(html.contains("<!DOCTYPE html>"));
        assert!(html.contains("switchTab("));
        assert!(html.contains("tab-bar"));
        assert!(html.contains(r#"id="panel-overview""#));
        assert!(html.contains(r#"id="panel-details""#));
        // First panel visible, second hidden
        assert!(html.contains(r#"style="display:block""#));
        assert!(html.contains(r#"style="display:none""#));
        assert!(html.contains("Generated by Hadron"));
    }

    #[test]
    fn test_generate_json() {
        let report = sample_report();
        let json = generate_json(&report);

        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
        assert_eq!(parsed["title"], "Test Report");
        assert_eq!(parsed["sourceType"], "unit-test");
        assert_eq!(parsed["sections"][0]["id"], "overview");
        assert_eq!(parsed["footer"], "Generated by Hadron");
    }

    #[test]
    fn test_generate_txt() {
        let report = sample_report();
        let txt = generate_txt(&report);

        assert!(txt.contains("TEST REPORT"));
        assert!(txt.contains("OVERVIEW"));
        assert!(txt.contains("DETAILS"));
        assert!(txt.contains("This is the overview content."));
        assert!(txt.contains("===="));
        assert!(txt.contains("----"));
        assert!(txt.contains("Generated by Hadron"));
    }

    #[test]
    fn test_empty_sections() {
        let report = GenericReportData {
            title: "Empty".into(),
            source_type: "test".into(),
            audience: None,
            sections: vec![],
            footer: None,
        };

        let md = generate_markdown(&report);
        assert!(md.starts_with("# Empty\n"));
        assert!(!md.contains("---"));

        let txt = generate_txt(&report);
        assert!(txt.contains("EMPTY"));

        let json = generate_json(&report);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["sections"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn test_xss_escaping() {
        let report = GenericReportData {
            title: "<script>alert('xss')</script>".into(),
            source_type: "test".into(),
            audience: None,
            sections: vec![ReportSection {
                id: "sec1".into(),
                label: "Section & \"Label\"".into(),
                content: "<b>Bold</b> & more".into(),
            }],
            footer: Some("<footer>".into()),
        };

        let html = generate_html(&report);
        // Raw angle brackets must not appear in output (except DOCTYPE/tags)
        assert!(html.contains("&lt;script&gt;"));
        assert!(html.contains("&lt;b&gt;Bold&lt;/b&gt;"));
        assert!(html.contains("Section &amp; &quot;Label&quot;"));
        assert!(html.contains("&lt;footer&gt;"));
        // Should NOT contain unescaped <script>
        assert!(!html.contains("<script>"));
    }
}
