use crate::models::{BusinessObject, ContextArguments, NamedValue, ObjectSnapshot};
use crate::parser::patterns::*;
use std::collections::HashMap;
use std::collections::HashSet;

pub fn parse_context(content: &str) -> ContextArguments {
    let mut ctx = ContextArguments::default();
    let mut current_section = "";
    let mut current_lines: Vec<&str> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();

        // Detect subsections
        if trimmed.starts_with("Receiver:") || trimmed == "Receiver" {
            flush_section(&mut ctx, current_section, &current_lines);
            current_section = "receiver";
            current_lines.clear();
            if trimmed.starts_with("Receiver:") {
                current_lines.push(trimmed);
            }
        } else if trimmed.starts_with("Arguments:") || trimmed == "Arguments" {
            flush_section(&mut ctx, current_section, &current_lines);
            current_section = "arguments";
            current_lines.clear();
        } else if trimmed.starts_with("Temporaries:") || trimmed == "Temporaries" {
            flush_section(&mut ctx, current_section, &current_lines);
            current_section = "temporaries";
            current_lines.clear();
        } else if trimmed.starts_with("Instance Variables:") {
            flush_section(&mut ctx, current_section, &current_lines);
            current_section = "instance_vars";
            current_lines.clear();
        } else if !trimmed.is_empty() {
            current_lines.push(trimmed);
        }
    }

    // Flush final section
    flush_section(&mut ctx, current_section, &current_lines);

    // Extract business objects from all parsed data
    ctx.business_objects = extract_business_objects(&ctx);

    ctx
}

fn flush_section(ctx: &mut ContextArguments, section: &str, lines: &[&str]) {
    match section {
        "receiver" => {
            ctx.receiver = Some(parse_receiver(lines));
        }
        "arguments" => {
            ctx.arguments = parse_named_values(lines);
        }
        "temporaries" => {
            ctx.temporaries = parse_named_values(lines);
        }
        "instance_vars" => {
            ctx.instance_variables = parse_named_values(lines);
        }
        _ => {}
    }
}

fn parse_receiver(lines: &[&str]) -> ObjectSnapshot {
    let mut snapshot = ObjectSnapshot {
        class_name: "Unknown".to_string(),
        print_string: None,
        oid: None,
        is_collection: false,
        collection_size: None,
        first_index: None,
        last_index: None,
        collection_contents: None,
    };

    let combined = lines.join(" ");

    // Extract class name
    if let Some(caps) = RECEIVER.captures(&combined) {
        snapshot.class_name = caps
            .get(1)
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();
    }

    // Check if it's a collection
    let is_collection = snapshot.class_name.contains("Collection")
        || snapshot.class_name.contains("Array")
        || snapshot.class_name.contains("Set")
        || snapshot.class_name.contains("Dictionary");
    snapshot.is_collection = is_collection;

    // Extract collection info
    if let Some(caps) = COLLECTION_INFO.captures(&combined) {
        snapshot.first_index = caps.get(1).and_then(|m| m.as_str().parse().ok());
        snapshot.last_index = caps.get(2).and_then(|m| m.as_str().parse().ok());

        if let (Some(first), Some(last)) = (snapshot.first_index, snapshot.last_index) {
            snapshot.collection_size = Some(last - first + 1);
        }
    }

    // Extract OID
    if let Some(caps) = OID.captures(&combined) {
        snapshot.oid = caps.get(1).map(|m| m.as_str().to_string());
    }

    // Look for print string (often in quotes or after class name)
    if combined.contains('\'') {
        let parts: Vec<&str> = combined.split('\'').collect();
        if parts.len() >= 2 {
            snapshot.print_string = Some(parts[1].to_string());
        }
    }

    // Try to extract collection contents if present
    if is_collection {
        let mut contents = Vec::new();
        for line in lines {
            // Look for indexed entries: "1: value" or "[1] value"
            if let Some(idx) = line.find(':') {
                let prefix = &line[..idx];
                if prefix.trim().parse::<usize>().is_ok() {
                    contents.push(line[idx + 1..].trim().to_string());
                }
            }
        }
        if !contents.is_empty() {
            snapshot.collection_contents = Some(contents);
        }
    }

    snapshot
}

fn parse_named_values(lines: &[&str]) -> Vec<NamedValue> {
    let mut values = Vec::new();

    for line in lines {
        if let Some(caps) = ARGUMENT.captures(line) {
            let name = caps
                .get(1)
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();
            let value = caps
                .get(2)
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();

            // Try to extract class name from value
            let class_name = if value.starts_with("a ") || value.starts_with("an ") {
                value.split_whitespace().nth(1).map(|s| s.to_string())
            } else {
                None
            };

            values.push(NamedValue {
                name,
                value,
                class_name,
            });
        }
    }

    values
}

fn extract_business_objects(ctx: &ContextArguments) -> Vec<BusinessObject> {
    let mut objects = Vec::new();
    let mut seen_oids: HashSet<String> = HashSet::new();

    // Helper to extract business object from a named value
    let mut extract_from_value = |nv: &NamedValue| {
        // Check if it's a MediaGeniX object
        if let Some(ref class) = nv.class_name {
            if class.starts_with("PSI")
                || class.starts_with("BM")
                || class.starts_with("PL")
                || class.starts_with("WOn")
                || MEDIAGENIIX_CLASS.is_match(&nv.value)
            {
                let mut props = HashMap::new();

                // Extract OID if present
                let oid = OID
                    .captures(&nv.value)
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().to_string());

                if let Some(ref oid) = oid {
                    if seen_oids.contains(oid) {
                        return;
                    }
                    seen_oids.insert(oid.clone());
                    props.insert("oid".to_string(), serde_json::Value::String(oid.clone()));
                }

                // Extract channel if present
                if let Some(caps) = CHANNEL.captures(&nv.value) {
                    if let Some(m) = caps.get(1) {
                        props.insert(
                            "channel".to_string(),
                            serde_json::Value::String(m.as_str().to_string()),
                        );
                    }
                }

                // Extract date if present
                if let Some(caps) = SCHEDULE_DATE.captures(&nv.value) {
                    if let Some(m) = caps.get(1) {
                        props.insert(
                            "date".to_string(),
                            serde_json::Value::String(m.as_str().to_string()),
                        );
                    }
                }

                objects.push(BusinessObject {
                    class_name: class.clone(),
                    oid,
                    properties: props,
                });
            }
        }
    };

    // Process all sources
    for nv in &ctx.arguments {
        extract_from_value(nv);
    }
    for nv in &ctx.temporaries {
        extract_from_value(nv);
    }
    for nv in &ctx.instance_variables {
        extract_from_value(nv);
    }

    // Also check receiver
    if let Some(ref recv) = ctx.receiver {
        if recv.class_name.starts_with("PSI")
            || recv.class_name.starts_with("BM")
            || recv.class_name.starts_with("PL")
        {
            if let Some(ref oid) = recv.oid {
                if !seen_oids.contains(oid) {
                    objects.push(BusinessObject {
                        class_name: recv.class_name.clone(),
                        oid: Some(oid.clone()),
                        properties: HashMap::new(),
                    });
                }
            }
        }
    }

    objects
}
