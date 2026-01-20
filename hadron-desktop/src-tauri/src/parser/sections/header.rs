use crate::models::CrashHeader;
use crate::parser::patterns::DUMP_STATUS;
use chrono::{DateTime, NaiveDateTime, Utc};

pub fn parse_header(content: &str, file_name: &str, file_size: u64) -> CrashHeader {
    let mut timestamp = None;
    let mut dump_complete = true;
    let mut dump_status = None;

    for line in content.lines().take(20) {
        // Look for timestamp patterns
        if timestamp.is_none() {
            if let Some(ts) = try_parse_timestamp(line) {
                timestamp = Some(ts);
            }
        }

        // Check dump status
        if let Some(caps) = DUMP_STATUS.captures(line) {
            let status = caps.get(1).map(|m| m.as_str()).unwrap_or("unknown");
            dump_status = Some(status.to_string());
            dump_complete = status == "completed";
        }
    }

    CrashHeader {
        file_name: file_name.to_string(),
        file_size,
        timestamp,
        dump_complete,
        dump_status,
    }
}

fn try_parse_timestamp(line: &str) -> Option<DateTime<Utc>> {
    // Common formats in WCR files:
    // "2026-01-15 14:23:45"
    // "15/01/2026 14:23:45"
    // "Jan 15, 2026 2:23:45 PM"

    let formats = [
        "%Y-%m-%d %H:%M:%S",
        "%d/%m/%Y %H:%M:%S",
        "%m/%d/%Y %H:%M:%S",
        "%b %d, %Y %I:%M:%S %p",
    ];

    for fmt in formats {
        if let Ok(naive) = NaiveDateTime::parse_from_str(line.trim(), fmt) {
            return Some(DateTime::from_naive_utc_and_offset(naive, Utc));
        }
    }

    // Try to find timestamp substring in longer lines
    // Pattern: look for YYYY-MM-DD or DD/MM/YYYY
    let date_patterns = [
        r"\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}",
        r"\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2}",
    ];

    for pattern in date_patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            if let Some(m) = re.find(line) {
                for fmt in &formats[..2] {
                    if let Ok(naive) = NaiveDateTime::parse_from_str(m.as_str(), fmt) {
                        return Some(DateTime::from_naive_utc_and_offset(naive, Utc));
                    }
                }
            }
        }
    }

    None
}
