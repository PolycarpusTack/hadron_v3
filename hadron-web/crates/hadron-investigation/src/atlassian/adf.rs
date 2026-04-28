/// Convert Atlassian Document Format JSON to plain text.
///
/// Hard depth limit guards against attacker-supplied deeply-nested ADF,
/// which would otherwise overflow the stack on a recursive walk.
const MAX_DEPTH: usize = 64;

pub fn adf_to_text(node: &serde_json::Value) -> String {
    adf_depth(node, 0)
}

fn adf_depth(node: &serde_json::Value, depth: usize) -> String {
    if depth >= MAX_DEPTH {
        return "[adf truncated: max depth reached]".to_string();
    }
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
            let inner = children(node, depth + 1);
            format!("{}\n", inner)
        }
        Some("codeBlock") => {
            let code = children(node, depth + 1);
            format!("```\n{}\n```\n", code)
        }
        Some("panel") => {
            let inner = children(node, depth + 1);
            format!("[{}]\n", inner.trim())
        }
        Some("bulletList") => list(node, false, depth + 1),
        Some("orderedList") => list(node, true, depth + 1),
        Some("listItem") => children(node, depth + 1),
        Some("table") => table(node, depth + 1),
        Some("tableRow") => {
            let cells: Vec<String> = node
                .get("content")
                .and_then(|c| c.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|cell| children(cell, depth + 1).trim().replace('\n', " ").to_string())
                        .collect()
                })
                .unwrap_or_default();
            format!("| {} |\n", cells.join(" | "))
        }
        Some("tableCell") | Some("tableHeader") => children(node, depth + 1),
        Some("mediaSingle") => children(node, depth + 1),
        Some("media") => node
            .get("attrs")
            .and_then(|a| a.get("alt"))
            .and_then(|a| a.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| format!("[{}]", s))
            .unwrap_or_default(),
        _ => children(node, depth + 1),
    }
}

fn children(node: &serde_json::Value, depth: usize) -> String {
    node.get("content")
        .and_then(|c| c.as_array())
        .map(|arr| arr.iter().map(|n| adf_depth(n, depth)).collect::<Vec<_>>().join(""))
        .unwrap_or_default()
}

fn list(node: &serde_json::Value, ordered: bool, depth: usize) -> String {
    let items = node
        .get("content")
        .and_then(|c| c.as_array())
        .map(|arr| arr.iter().collect::<Vec<_>>())
        .unwrap_or_default();
    items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let text = adf_depth(item, depth);
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

fn table(node: &serde_json::Value, depth: usize) -> String {
    node.get("content")
        .and_then(|c| c.as_array())
        .map(|arr| arr.iter().map(|n| adf_depth(n, depth)).collect::<Vec<_>>().join(""))
        .unwrap_or_default()
}
