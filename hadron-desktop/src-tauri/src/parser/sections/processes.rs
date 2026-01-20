use crate::models::ProcessInfo;

pub fn parse_quiescent_processes(content: &str) -> Vec<ProcessInfo> {
    parse_process_list(content)
}

pub fn parse_suspended_processes(content: &str) -> Vec<ProcessInfo> {
    parse_process_list(content)
}

fn parse_process_list(content: &str) -> Vec<ProcessInfo> {
    let mut processes = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Parse process entry: 'Name' priority #hash
        // Or: Name priority hash
        let (name, rest) = if let Some(stripped) = line.strip_prefix('\'') {
            // Quoted name
            if let Some(end_quote) = stripped.find('\'') {
                let name = stripped[..end_quote].to_string();
                let rest = &stripped[end_quote + 1..];
                (name, rest.trim())
            } else {
                (line.to_string(), "")
            }
        } else {
            // Unquoted - first word is name
            let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
            (
                parts.first().unwrap_or(&"").to_string(),
                parts.get(1).unwrap_or(&"").trim(),
            )
        };

        if name.is_empty() {
            continue;
        }

        // Parse remaining parts: priority and hash
        let parts: Vec<&str> = rest.split_whitespace().collect();
        let priority = parts
            .first()
            .filter(|s| !s.starts_with('#'))
            .map(|s| s.to_string());

        let hash = parts
            .iter()
            .find(|s| s.starts_with('#'))
            .map(|s| s.to_string());

        processes.push(ProcessInfo {
            name,
            priority,
            hash,
            state: None,
        });
    }

    processes
}
