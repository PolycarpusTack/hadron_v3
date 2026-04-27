/// Convert Atlassian Document Format JSON to plain text.
pub fn adf_to_text(node: &serde_json::Value) -> String {
    match node.get("type").and_then(|t| t.as_str()) {
        Some("text") => node
            .get("text")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string(),
        Some("hardBreak") | Some("rule") => "\n".to_string(),
        Some("emoji") => node
            .get("attrs")
            .and_then(|a| a.get("text"))
            .and_then(|t| t.as_str())
            .map(|s| format!("{} ", s))
            .unwrap_or_default(),
        Some("mention") => node
            .get("attrs")
            .and_then(|a| a.get("text"))
            .and_then(|t| t.as_str())
            .map(|s| format!("@{}", s))
            .unwrap_or_default(),
        Some("inlineCard") => node
            .get("attrs")
            .and_then(|a| a.get("url"))
            .and_then(|u| u.as_str())
            .map(|u| format!("[{}]", u))
            .unwrap_or_default(),
        Some("paragraph") | Some("heading") | Some("blockquote") => {
            let inner = children_to_text(node);
            format!("{}\n", inner)
        }
        Some("codeBlock") => {
            let code = children_to_text(node);
            format!("```\n{}\n```\n", code)
        }
        Some("panel") => {
            let inner = children_to_text(node);
            format!("[{}]\n", inner.trim())
        }
        Some("bulletList") => list_to_text(node, false),
        Some("orderedList") => list_to_text(node, true),
        Some("listItem") => children_to_text(node),
        Some("table") => table_to_text(node),
        Some("tableRow") => {
            let cells: Vec<String> = node
                .get("content")
                .and_then(|c| c.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|cell| children_to_text(cell).trim().replace('\n', " ").to_string())
                        .collect()
                })
                .unwrap_or_default();
            format!("| {} |\n", cells.join(" | "))
        }
        Some("tableCell") | Some("tableHeader") => children_to_text(node),
        Some("mediaSingle") | Some("media") => String::new(),
        _ => children_to_text(node),
    }
}

fn children_to_text(node: &serde_json::Value) -> String {
    node.get("content")
        .and_then(|c| c.as_array())
        .map(|arr| arr.iter().map(adf_to_text).collect::<Vec<_>>().join(""))
        .unwrap_or_default()
}

fn list_to_text(node: &serde_json::Value, ordered: bool) -> String {
    let items = node
        .get("content")
        .and_then(|c| c.as_array())
        .map(|arr| arr.iter().collect::<Vec<_>>())
        .unwrap_or_default();
    items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let text = adf_to_text(item);
            let prefix = if ordered {
                format!("{}. ", i + 1)
            } else {
                "- ".to_string()
            };
            format!("{}{}", prefix, text.trim_start())
        })
        .collect::<Vec<_>>()
        .join("")
}

fn table_to_text(node: &serde_json::Value) -> String {
    node.get("content")
        .and_then(|c| c.as_array())
        .map(|arr| arr.iter().map(adf_to_text).collect::<Vec<_>>().join(""))
        .unwrap_or_default()
}
