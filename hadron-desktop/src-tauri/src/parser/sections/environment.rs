use crate::models::Environment;
use crate::parser::patterns::*;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

pub fn parse_environment(content: &str) -> Environment {
    let mut env = Environment::default();
    let mut extra = HashMap::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Try key-value extraction
        if let Some(caps) = KEY_VALUE.captures(line) {
            let key = caps.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            let value = caps.get(2).map(|m| m.as_str().trim()).unwrap_or("");

            match key.to_lowercase().as_str() {
                "user" | "username" | "logged in user" => env.user = Some(value.to_string()),
                "site" => env.site = Some(value.to_string()),
                "computer" | "computername" | "machine" => {
                    env.computer_name = Some(value.to_string())
                }
                "os user" | "windows user" => env.os_user = Some(value.to_string()),
                "time zone" | "timezone" => env.time_zone = Some(value.to_string()),
                "frame rate" => env.frame_rate = Some(value.to_string()),
                "frame rate mode" => env.frame_rate_mode = Some(value.to_string()),
                "citrix session" | "citrix" => env.citrix_session = Some(value.to_string()),
                "database server version" => env.oracle_server = Some(value.to_string()),
                "database client version" => env.oracle_client = Some(value.to_string()),
                "db encoding" | "encoding" => env.db_encoding = Some(value.to_string()),
                _ => {
                    if !value.is_empty() {
                        extra.insert(key.to_string(), value.to_string());
                    }
                }
            }
        }

        // Version pattern
        if let Some(caps) = VERSION.captures(line) {
            env.version = caps.get(1).map(|m| m.as_str().to_string());
        }

        // Build pattern
        if let Some(caps) = BUILD.captures(line) {
            env.build = caps.get(1).map(|m| m.as_str().to_string());
        }

        // Smalltalk version
        if let Some(caps) = SMALLTALK_VERSION.captures(line) {
            env.smalltalk_version = caps.get(1).map(|m| m.as_str().to_string());
        }

        // Check for PostgreSQL indicators
        if (line.to_lowercase().contains("postgres") || line.contains("libpq")) && env.postgres_version.is_none() {
            env.postgres_version = Some(extract_version_number(line));
        }
    }

    env.extra = extra;
    env
}

fn extract_version_number(text: &str) -> String {
    // Try to find version-like patterns: X.Y.Z or X.Y
    static VERSION_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"\d+\.\d+(?:\.\d+)?").expect("VERSION_RE is a valid regex pattern")
    });

    VERSION_RE
        .find(text)
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| text.to_string())
}
