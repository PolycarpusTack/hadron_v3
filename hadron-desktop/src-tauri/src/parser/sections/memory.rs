use crate::models::{MemoryReport, MemorySpace};
use crate::parser::patterns::*;

pub fn parse_memory(content: &str) -> MemoryReport {
    let mut report = MemoryReport::default();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Parse memory space line
        if let Some(caps) = MEMORY_SPACE.captures(line) {
            let name = caps
                .get(1)
                .map(|m| m.as_str().to_lowercase())
                .unwrap_or_default();
            let size_str = caps.get(2).map(|m| m.as_str()).unwrap_or("0");
            let unit = caps.get(3).map(|m| m.as_str()).unwrap_or("");
            let percent: f32 = caps
                .get(4)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(0.0);

            let size_display = format!("{}{}", size_str.replace(',', ""), unit);
            let size_bytes = parse_size_to_bytes(size_str, unit);

            let space = MemorySpace {
                name: name.clone(),
                size_bytes,
                size_display,
                percent_used: percent,
            };

            match name.as_str() {
                "eden" => report.eden = Some(space),
                "survivor" => report.survivor = Some(space),
                "old" => report.old = Some(space),
                "large" => report.large = Some(space),
                "perm" | "permanent" => report.perm = Some(space),
                _ => {}
            }
        }

        // Parse total/limit lines
        if line.to_lowercase().contains("total") {
            if let Some(caps) = MEMORY_LIMIT.captures(line) {
                report.total_used = caps.get(1).map(|m| m.as_str().to_string());
            } else {
                // Try simple extraction
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() >= 2 {
                    report.total_used = Some(parts[1].trim().to_string());
                }
            }
        }

        if line.to_lowercase().contains("config") && line.to_lowercase().contains("limit") {
            if let Some(caps) = MEMORY_LIMIT.captures(line) {
                report.config_limit = caps.get(1).map(|m| m.as_str().to_string());
            }
        }

        if line.to_lowercase().contains("growth") && line.to_lowercase().contains("limit") {
            if let Some(caps) = MEMORY_LIMIT.captures(line) {
                report.growth_limit = caps.get(1).map(|m| m.as_str().to_string());
            }
        }
    }

    report
}

fn parse_size_to_bytes(size_str: &str, unit: &str) -> Option<u64> {
    let size: u64 = size_str.replace(',', "").parse().ok()?;

    let multiplier = match unit.to_uppercase().as_str() {
        "K" | "KB" => 1024,
        "M" | "MB" => 1024 * 1024,
        "G" | "GB" => 1024 * 1024 * 1024,
        "B" | "" => 1,
        _ => 1,
    };

    Some(size * multiplier)
}
