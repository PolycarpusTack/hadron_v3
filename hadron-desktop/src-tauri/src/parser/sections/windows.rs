use crate::models::OpenWindow;
use crate::parser::patterns::WINDOW_ENTRY;

pub fn parse_windows(content: &str) -> Vec<OpenWindow> {
    let mut windows = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(caps) = WINDOW_ENTRY.captures(line) {
            let id: u32 = caps
                .get(1)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(0);

            // Title might be in group 2 (single quotes) or group 3 (double quotes)
            let title = caps
                .get(2)
                .or_else(|| caps.get(3))
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();

            let model = caps
                .get(4)
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();

            // Extract label from title if present
            let label = if title.contains(':') {
                title.split(':').next_back().unwrap_or(&title).trim().to_string()
            } else {
                title.clone()
            };

            windows.push(OpenWindow {
                id,
                label,
                title,
                model,
            });
        } else {
            // Fallback: try simple space-separated parsing
            let parts: Vec<&str> = line.splitn(3, ' ').collect();
            if parts.len() >= 2 {
                if let Ok(id) = parts[0].trim_end_matches(':').parse::<u32>() {
                    windows.push(OpenWindow {
                        id,
                        label: parts.get(1).unwrap_or(&"").to_string(),
                        title: parts.get(1).unwrap_or(&"").to_string(),
                        model: parts.get(2).unwrap_or(&"").to_string(),
                    });
                }
            }
        }
    }

    windows
}
