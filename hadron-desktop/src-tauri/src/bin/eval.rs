//! Crash analysis eval harness — desktop surface.
//!
//! Standalone binary that reads fixtures, calls the AI provider directly
//! with the same prompt structure as analyze_crash_log(), and outputs CSV.
//!
//! Usage:
//!   cargo run --bin eval -- --model gpt-4.1 --provider openai --api-key $KEY
//!   cargo run --bin eval -- --model claude-sonnet-4-20250514 --provider anthropic --api-key $KEY
//!
//! Env: HADRON_EVAL_API_KEY (alternative to --api-key)

use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct Rubric {
    category: String,
    expected_severity: String,
    #[allow(dead_code)]
    expected_root_cause_category: String,
    key_terms: Vec<String>,
    expected_component: Option<String>,
}

struct EvalRow {
    fixture: String,
    category: String,
    model: String,
    provider: String,
    latency_ms: u128,
    severity: String,
    expected_severity: String,
    severity_match: bool,
    key_terms_found: usize,
    key_terms_total: usize,
    component_match: bool,
    schema_valid: bool,
    error: String,
}

const SYSTEM_PROMPT: &str = r#"You are an expert crash analysis engineer specializing in enterprise application crash dumps.

Analyze the provided crash log and return a JSON object with these fields:
- "error_type": the exception or error class
- "severity": one of "critical", "high", "medium", "low"
- "root_cause": detailed root cause explanation (2-4 sentences)
- "component": the application module or component at fault
- "suggested_fixes": array of 2-4 actionable remediation steps
- "confidence": one of "high", "medium", "low"

Respond ONLY with valid JSON. No markdown, no explanation outside the JSON."#;

fn find_fixtures_dir() -> PathBuf {
    for c in ["tests/fixtures/crash-analysis", "../../tests/fixtures/crash-analysis", "../../../tests/fixtures/crash-analysis"] {
        let p = PathBuf::from(c);
        if p.exists() { return p; }
    }
    eprintln!("error: cannot find tests/fixtures/crash-analysis/");
    std::process::exit(1);
}

fn load_fixtures(dir: &Path) -> Vec<(String, String, Rubric)> {
    let mut fixtures = Vec::new();
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .expect("cannot read fixtures dir")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "txt").unwrap_or(false))
        .collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let txt_path = entry.path();
        let name = txt_path.file_stem().unwrap().to_string_lossy().to_string();
        let rubric_path = txt_path.with_extension("rubric.json");
        let content = std::fs::read_to_string(&txt_path).expect("cannot read fixture");
        if !rubric_path.exists() { continue; }
        let rubric: Rubric = serde_json::from_str(
            &std::fs::read_to_string(&rubric_path).expect("cannot read rubric"),
        ).expect("cannot parse rubric");
        fixtures.push((name, content, rubric));
    }
    fixtures
}

async fn call_openai(client: &reqwest::Client, api_key: &str, model: &str, content: &str) -> Result<String, String> {
    let uses_max_completion_tokens = model.starts_with("gpt-5")
        || model.starts_with("o1") || model.starts_with("o3")
        || model.starts_with("o4") || model.starts_with("codex");

    let mut body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": format!("Analyze this crash log:\n\n{content}")}
        ],
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
    });
    if uses_max_completion_tokens {
        body["max_completion_tokens"] = json!(4096);
    } else {
        body["max_tokens"] = json!(4096);
    }

    let resp = client.post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&body)
        .send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("{status}: {text}"));
    }

    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    data["choices"][0]["message"]["content"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "no content in response".into())
}

async fn call_anthropic(client: &reqwest::Client, api_key: &str, model: &str, content: &str) -> Result<String, String> {
    let body = json!({
        "model": model,
        "max_tokens": 4096,
        "system": SYSTEM_PROMPT,
        "messages": [
            {"role": "user", "content": format!("Analyze this crash log:\n\n{content}")}
        ],
    });

    let resp = client.post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("{status}: {text}"));
    }

    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    data["content"][0]["text"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "no content in response".into())
}

fn count_key_terms(text: &str, terms: &[String]) -> usize {
    let lower = text.to_lowercase();
    terms.iter().filter(|t| lower.contains(&t.to_lowercase())).count()
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut model = "gpt-4.1".to_string();
    let mut provider = "openai".to_string();
    let mut api_key = std::env::var("HADRON_EVAL_API_KEY").unwrap_or_default();
    let mut fixtures_dir: Option<PathBuf> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--model" => { i += 1; model = args[i].clone(); }
            "--provider" => { i += 1; provider = args[i].clone(); }
            "--api-key" => { i += 1; api_key = args[i].clone(); }
            "--fixtures-dir" => { i += 1; fixtures_dir = Some(PathBuf::from(&args[i])); }
            "-h" | "--help" => {
                eprintln!("Usage: eval [--model M] [--provider P] [--api-key K] [--fixtures-dir D]");
                std::process::exit(0);
            }
            other => { eprintln!("unknown: {other}"); std::process::exit(1); }
        }
        i += 1;
    }

    if api_key.is_empty() {
        eprintln!("error: set HADRON_EVAL_API_KEY or pass --api-key");
        std::process::exit(1);
    }

    let dir = fixtures_dir.unwrap_or_else(find_fixtures_dir);
    let fixtures = load_fixtures(&dir);
    eprintln!("Loaded {} fixtures from {}", fixtures.len(), dir.display());
    eprintln!("Model: {model}, Provider: {provider}\n");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build().unwrap();

    println!("fixture,category,model,provider,latency_ms,severity,expected_severity,severity_match,key_terms_found,key_terms_total,component_match,schema_valid,error");

    for (name, content, rubric) in &fixtures {
        eprint!("  {name}... ");
        let start = Instant::now();

        let response = match provider.as_str() {
            "openai" => call_openai(&client, &api_key, &model, content).await,
            "anthropic" => call_anthropic(&client, &api_key, &model, content).await,
            other => Err(format!("unsupported provider: {other}")),
        };

        let latency = start.elapsed().as_millis();

        let row = match response {
            Ok(text) => {
                // Try to parse as JSON
                match serde_json::from_str::<serde_json::Value>(&text) {
                    Ok(parsed) => {
                        let severity = parsed["severity"].as_str().unwrap_or("").to_string();
                        let root_cause = parsed["root_cause"].as_str().unwrap_or("").to_string();
                        let component = parsed["component"].as_str().unwrap_or("").to_string();
                        let fixes: Vec<String> = parsed["suggested_fixes"]
                            .as_array()
                            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                            .unwrap_or_default();

                        let full_text = format!("{root_cause} {component} {}", fixes.join(" "));
                        let terms_found = count_key_terms(&full_text, &rubric.key_terms);
                        let comp_match = rubric.expected_component.as_ref()
                            .map(|ec| component.to_lowercase().contains(&ec.to_lowercase()))
                            .unwrap_or(true);

                        let sev_match = severity.to_lowercase() == rubric.expected_severity;
                        eprintln!("{}ms sev={} terms={}/{}", latency, severity, terms_found, rubric.key_terms.len());

                        EvalRow {
                            fixture: name.clone(), category: rubric.category.clone(),
                            model: model.clone(), provider: provider.clone(),
                            latency_ms: latency,
                            severity: severity.clone(),
                            expected_severity: rubric.expected_severity.clone(),
                            severity_match: sev_match,
                            key_terms_found: terms_found,
                            key_terms_total: rubric.key_terms.len(),
                            component_match: comp_match,
                            schema_valid: true,
                            error: String::new(),
                        }
                    }
                    Err(e) => {
                        eprintln!("{}ms PARSE ERROR: {e}", latency);
                        EvalRow {
                            fixture: name.clone(), category: rubric.category.clone(),
                            model: model.clone(), provider: provider.clone(),
                            latency_ms: latency,
                            severity: String::new(), expected_severity: rubric.expected_severity.clone(),
                            severity_match: false, key_terms_found: 0, key_terms_total: rubric.key_terms.len(),
                            component_match: false, schema_valid: false,
                            error: format!("parse: {e}"),
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("{}ms ERROR: {e}", latency);
                EvalRow {
                    fixture: name.clone(), category: rubric.category.clone(),
                    model: model.clone(), provider: provider.clone(),
                    latency_ms: latency,
                    severity: String::new(), expected_severity: rubric.expected_severity.clone(),
                    severity_match: false, key_terms_found: 0, key_terms_total: rubric.key_terms.len(),
                    component_match: false, schema_valid: false,
                    error: e.chars().take(200).collect(),
                }
            }
        };

        println!(
            "{},{},{},{},{},{},{},{},{},{},{},{},{}",
            row.fixture, row.category, row.model, row.provider, row.latency_ms,
            row.severity, row.expected_severity, row.severity_match,
            row.key_terms_found, row.key_terms_total, row.component_match,
            row.schema_valid, row.error,
        );
    }

    eprintln!("\nDone.");
}
