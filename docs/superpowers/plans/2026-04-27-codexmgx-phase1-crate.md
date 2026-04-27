# CodexMgX Integration — Phase 1: `hadron-investigation` Crate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `hadron-investigation` Rust crate — the shared investigation engine used by both desktop and web.

**Architecture:** New crate at `hadron-web/crates/hadron-investigation/`, added as a workspace member and path dependency in desktop. Contains all Atlassian API calls, ADF parsing, attachment extraction, and the 4 investigation orchestrators.

**Tech Stack:** Rust, tokio, reqwest 0.12, serde_json, thiserror, zip 2.x, lopdf 0.32, roxmltree 0.19, futures, base64, log

---

### Task 1: Crate Scaffold

**Files:**
- Create: `hadron-web/crates/hadron-investigation/Cargo.toml`
- Create: `hadron-web/crates/hadron-investigation/src/lib.rs`
- Create: `hadron-web/crates/hadron-investigation/src/atlassian/mod.rs` (stub)
- Create: `hadron-web/crates/hadron-investigation/src/investigation/mod.rs` (stub)
- Create: `hadron-web/crates/hadron-investigation/src/knowledge_base/mod.rs` (stub)
- Modify: `hadron-web/Cargo.toml`
- Modify: `hadron-desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: Create Cargo.toml**

```toml
[package]
name = "hadron-investigation"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { workspace = true }
reqwest = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
thiserror = { workspace = true }
log = "0.4"
base64 = "0.22"
futures = "0.3"
zip = "2.1"
lopdf = "0.32"
roxmltree = "0.19"
regex = "1.10"
```

- [ ] **Step 2: Create src/lib.rs**

```rust
pub mod atlassian;
pub mod investigation;
pub mod knowledge_base;

pub use investigation::evidence::{
    InvestigationDossier, EvidenceClaim, EvidenceCategory,
    RelatedIssue, RelationType, Hypothesis, Confidence,
    AttachmentResult, ExtractionStatus, InvestigationType,
    InvestigationStatus, ConfluenceDoc,
};
pub use atlassian::mod_::{InvestigationConfig, InvestigationError};
pub use investigation::ticket::investigate_ticket;
pub use investigation::regression::investigate_regression_family;
pub use investigation::expected::investigate_expected_behavior;
pub use investigation::customer::investigate_customer_history;
pub use atlassian::confluence::{search_confluence, get_confluence_content};
```

- [ ] **Step 3: Create stub modules**

`src/atlassian/mod.rs`:
```rust
pub mod adf;
pub mod attachments;
pub mod confluence;
pub mod jira;
pub(crate) mod mod_;
pub use mod_::{AtlassianClient, InvestigationConfig, InvestigationError};
```

`src/investigation/mod.rs`:
```rust
pub mod customer;
pub mod evidence;
pub mod expected;
pub mod regression;
pub mod related;
pub mod ticket;
```

`src/knowledge_base/mod.rs`:
```rust
pub async fn search_kb(
    _config: &crate::atlassian::InvestigationConfig,
    _query: &str,
) -> Vec<String> {
    vec![]
}
```

- [ ] **Step 4: Add workspace member**

In `hadron-web/Cargo.toml`, change:
```toml
members = ["crates/hadron-core", "crates/hadron-mcp", "crates/hadron-server"]
```
to:
```toml
members = ["crates/hadron-core", "crates/hadron-mcp", "crates/hadron-server", "crates/hadron-investigation"]
```

- [ ] **Step 5: Add desktop dependency**

In `hadron-desktop/src-tauri/Cargo.toml`, in `[dependencies]`:
```toml
hadron-investigation = { path = "../../hadron-web/crates/hadron-investigation" }
```

- [ ] **Step 6: Verify it compiles (stubs only)**

```bash
cd hadron-web && cargo check -p hadron-investigation
```
Expected: no errors (empty stubs compile).

- [ ] **Step 7: Commit**

```bash
git add hadron-web/Cargo.toml hadron-web/crates/hadron-investigation hadron-desktop/src-tauri/Cargo.toml
git commit -m "feat(investigation): scaffold hadron-investigation crate"
```

---

### Task 2: Core Types

**Files:**
- Create: `hadron-web/crates/hadron-investigation/src/investigation/evidence.rs`

- [ ] **Step 1: Write evidence.rs**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InvestigationDossier {
    pub ticket_key: String,
    pub ticket_summary: String,
    pub ticket_url: String,
    pub status: String,
    pub assignee: Option<String>,
    pub claims: Vec<EvidenceClaim>,
    pub related_issues: Vec<RelatedIssue>,
    pub confluence_docs: Vec<ConfluenceDoc>,
    pub hypotheses: Vec<Hypothesis>,
    pub open_questions: Vec<String>,
    pub next_checks: Vec<String>,
    pub attachments: Vec<AttachmentResult>,
    pub warnings: Vec<String>,
    pub investigation_type: InvestigationType,
    pub investigation_status: InvestigationStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceClaim {
    pub text: String,
    pub category: EvidenceCategory,
    pub entities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceCategory {
    ObservedBehavior,
    LinkedContext,
    HistoricalMatch,
    ExpectedBehavior,
    AttachmentSignal,
    IssueComment,
    CustomerHistory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelatedIssue {
    pub key: String,
    pub summary: String,
    pub status: String,
    pub relation_type: RelationType,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RelationType {
    DirectLink,
    ProjectHistory,
    CrossProjectSibling,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hypothesis {
    pub text: String,
    pub confidence: Confidence,
    pub supporting_claims: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentResult {
    pub filename: String,
    pub extracted_text: Option<String>,
    pub extraction_status: ExtractionStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtractionStatus {
    Success,
    Skipped,
    Failed(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum InvestigationType {
    #[default]
    Ticket,
    RegressionFamily,
    ExpectedBehavior,
    CustomerHistory,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum InvestigationStatus {
    #[default]
    Complete,
    PartialFailure,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfluenceDoc {
    pub id: String,
    pub title: String,
    pub excerpt: String,
    pub url: String,
    pub space_key: Option<String>,
}
```

- [ ] **Step 2: Update investigation/mod.rs to pub use evidence**

Add to `src/investigation/mod.rs`:
```rust
pub use evidence::InvestigationDossier;
```

- [ ] **Step 3: Verify**

```bash
cd hadron-web && cargo check -p hadron-investigation
```

- [ ] **Step 4: Commit**

```bash
git add hadron-web/crates/hadron-investigation/src/investigation/evidence.rs
git commit -m "feat(investigation): add core dossier types"
```

---

### Task 3: AtlassianClient + Config + Errors

**Files:**
- Create: `hadron-web/crates/hadron-investigation/src/atlassian/mod_.rs`

- [ ] **Step 1: Write mod_.rs**

```rust
use reqwest::Client;
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct InvestigationConfig {
    pub jira_base_url: String,
    pub jira_email: String,
    pub jira_api_token: String,
    /// If None, falls back to jira_* credentials
    pub confluence_base_url: Option<String>,
    pub confluence_email: Option<String>,
    pub confluence_api_token: Option<String>,
    pub whatson_kb_url: Option<String>,
    pub mod_docs_homepage_id: Option<String>,
    pub mod_docs_space_path: Option<String>,
}

impl InvestigationConfig {
    pub fn confluence_base_url(&self) -> &str {
        self.confluence_base_url
            .as_deref()
            .unwrap_or(&self.jira_base_url)
    }
    pub fn confluence_email(&self) -> &str {
        self.confluence_email
            .as_deref()
            .unwrap_or(&self.jira_email)
    }
    pub fn confluence_token(&self) -> &str {
        self.confluence_api_token
            .as_deref()
            .unwrap_or(&self.jira_api_token)
    }
    pub fn whatson_kb_url(&self) -> &str {
        self.whatson_kb_url
            .as_deref()
            .unwrap_or("https://whatsonknowledgebase.mediagenix.tv/latest_version/")
    }
    pub fn mod_docs_homepage_id(&self) -> &str {
        self.mod_docs_homepage_id
            .as_deref()
            .unwrap_or("1888060283")
    }
    pub fn mod_docs_space_path(&self) -> &str {
        self.mod_docs_space_path.as_deref().unwrap_or("modkb")
    }
}

#[derive(Debug, Error)]
pub enum InvestigationError {
    #[error("Jira API error: {0}")]
    JiraApi(String),
    #[error("Confluence API error: {0}")]
    ConfluenceApi(String),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Attachment error: {0}")]
    Attachment(String),
}

#[derive(Clone)]
pub struct AtlassianClient {
    pub client: Client,
    pub config: InvestigationConfig,
}

impl AtlassianClient {
    pub fn new(config: InvestigationConfig) -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("failed to build reqwest client"),
            config,
        }
    }

    fn jira_auth(&self) -> String {
        use base64::Engine;
        let raw = format!("{}:{}", self.config.jira_email, self.config.jira_api_token);
        base64::engine::general_purpose::STANDARD.encode(raw)
    }

    fn confluence_auth(&self) -> String {
        use base64::Engine;
        let raw = format!(
            "{}:{}",
            self.config.confluence_email(),
            self.config.confluence_token()
        );
        base64::engine::general_purpose::STANDARD.encode(raw)
    }

    pub async fn jira_get(&self, path: &str) -> Result<serde_json::Value, InvestigationError> {
        let url = format!("{}{}", self.config.jira_base_url.trim_end_matches('/'), path);
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Basic {}", self.jira_auth()))
            .header("Accept", "application/json")
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(InvestigationError::JiraApi(format!(
                "GET {} returned {}",
                path,
                resp.status()
            )));
        }
        Ok(resp.json().await?)
    }

    pub async fn confluence_get(
        &self,
        path: &str,
    ) -> Result<serde_json::Value, InvestigationError> {
        let base = self.config.confluence_base_url();
        let url = format!("{}{}", base.trim_end_matches('/'), path);
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Basic {}", self.confluence_auth()))
            .header("Accept", "application/json")
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(InvestigationError::ConfluenceApi(format!(
                "GET {} returned {}",
                path,
                resp.status()
            )));
        }
        Ok(resp.json().await?)
    }

    pub async fn jira_get_bytes(&self, url: &str) -> Result<Vec<u8>, InvestigationError> {
        let resp = self
            .client
            .get(url)
            .header("Authorization", format!("Basic {}", self.jira_auth()))
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(InvestigationError::JiraApi(format!(
                "GET {} returned {}",
                url,
                resp.status()
            )));
        }
        Ok(resp.bytes().await?.to_vec())
    }
}
```

- [ ] **Step 2: Update atlassian/mod.rs to re-export from mod_**

`src/atlassian/mod.rs`:
```rust
pub mod adf;
pub mod attachments;
pub mod confluence;
pub mod jira;
mod mod_;
pub use mod_::{AtlassianClient, InvestigationConfig, InvestigationError};
```

- [ ] **Step 3: Add stubs for adf, attachments, confluence, jira**

`src/atlassian/adf.rs`:
```rust
pub fn adf_to_text(node: &serde_json::Value) -> String {
    String::new() // filled in Task 4
}
```

`src/atlassian/attachments.rs`:
```rust
pub async fn extract_attachment(
    _client: &super::AtlassianClient,
    _url: &str,
    _filename: &str,
) -> (Option<String>, super::mod_::ExtractionStatus) {
    (None, super::mod_::ExtractionStatus::Skipped)
}
// ExtractionStatus re-exported from evidence
use crate::investigation::evidence::ExtractionStatus;
```

`src/atlassian/confluence.rs`:
```rust
use crate::investigation::evidence::ConfluenceDoc;
use super::{AtlassianClient, InvestigationError};

pub async fn search_confluence(
    _client: &AtlassianClient,
    _cql: &str,
    _limit: u32,
) -> Result<Vec<ConfluenceDoc>, InvestigationError> {
    Ok(vec![])
}

pub async fn get_confluence_content(
    _client: &AtlassianClient,
    _id: &str,
) -> Result<ConfluenceDoc, InvestigationError> {
    Err(InvestigationError::ConfluenceApi("stub".into()))
}
```

`src/atlassian/jira.rs`:
```rust
use super::{AtlassianClient, InvestigationError};

pub struct IssueFullContext {
    pub key: String,
    pub summary: String,
    pub description: String,
    pub status: String,
    pub assignee: Option<String>,
    pub reporter: Option<String>,
    pub project_key: String,
    pub comments: Vec<String>,
    pub changelog_entries: Vec<String>,
    pub worklogs: Vec<String>,
    pub remote_links: Vec<String>,
    pub issue_links: Vec<(String, String, String)>, // key, summary, rel
    pub attachments: Vec<(String, String)>,          // filename, url
    pub sprint_name: Option<String>,
    pub fix_versions: Vec<String>,
    pub labels: Vec<String>,
    pub components: Vec<String>,
}

pub async fn get_issue_full(
    _client: &AtlassianClient,
    _key: &str,
) -> Result<IssueFullContext, InvestigationError> {
    Err(InvestigationError::JiraApi("stub".into()))
}
```

- [ ] **Step 4: Verify**

```bash
cd hadron-web && cargo check -p hadron-investigation
```

- [ ] **Step 5: Commit**

```bash
git add hadron-web/crates/hadron-investigation/src/atlassian/
git commit -m "feat(investigation): add AtlassianClient, config, and error types"
```

---

### Task 4: ADF Parser

**Files:**
- Modify: `hadron-web/crates/hadron-investigation/src/atlassian/adf.rs`

- [ ] **Step 1: Implement adf_to_text**

Replace the stub with:

```rust
/// Recursively convert Atlassian Document Format JSON to plain text.
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
                .map(|arr| arr.iter().map(|cell| children_to_text(cell).trim().replace('\n', " ").to_string()).collect())
                .unwrap_or_default();
            format!("| {} |\n", cells.join(" | "))
        }
        Some("tableCell") | Some("tableHeader") => children_to_text(node),
        Some("mediaSingle") | Some("media") => String::new(),
        // doc root or unknown container — recurse into content
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
```

- [ ] **Step 2: Verify**

```bash
cd hadron-web && cargo check -p hadron-investigation
```

- [ ] **Step 3: Commit**

```bash
git add hadron-web/crates/hadron-investigation/src/atlassian/adf.rs
git commit -m "feat(investigation): implement ADF to plain-text converter"
```

---

### Task 5: Attachment Extractor

**Files:**
- Modify: `hadron-web/crates/hadron-investigation/src/atlassian/attachments.rs`

- [ ] **Step 1: Replace stub with full extractor**

```rust
use crate::investigation::evidence::ExtractionStatus;
use super::AtlassianClient;

const MAX_BYTES: usize = 8 * 1024; // 8 KB

pub struct AttachmentExtractResult {
    pub text: Option<String>,
    pub status: ExtractionStatus,
}

pub async fn extract_attachment(
    client: &AtlassianClient,
    url: &str,
    filename: &str,
) -> AttachmentExtractResult {
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "tiff" | "webp" => {
            return AttachmentExtractResult {
                text: None,
                status: ExtractionStatus::Skipped,
            };
        }
        _ => {}
    }

    let bytes = match client.jira_get_bytes(url).await {
        Ok(b) => b,
        Err(e) => {
            return AttachmentExtractResult {
                text: None,
                status: ExtractionStatus::Failed(e.to_string()),
            };
        }
    };

    let (text, status) = match ext.as_str() {
        "txt" | "log" | "json" | "xml" | "csv" | "yaml" | "yml" | "md" | "toml" => {
            extract_text_utf8(&bytes)
        }
        "html" | "htm" => extract_html(&bytes),
        "zip" => extract_zip(&bytes),
        "docx" => extract_docx(&bytes),
        "pdf" => extract_pdf(&bytes),
        _ => (
            None,
            ExtractionStatus::Skipped,
        ),
    };

    AttachmentExtractResult { text, status }
}

fn truncate(s: String) -> String {
    if s.len() <= MAX_BYTES {
        s
    } else {
        let boundary = s.floor_char_boundary(MAX_BYTES);
        format!("{}… [truncated]", &s[..boundary])
    }
}

fn extract_text_utf8(bytes: &[u8]) -> (Option<String>, ExtractionStatus) {
    match String::from_utf8(bytes.to_vec())
        .or_else(|_| String::from_utf8_lossy(bytes).parse::<String>())
    {
        Ok(s) => (Some(truncate(s)), ExtractionStatus::Success),
        Err(e) => (None, ExtractionStatus::Failed(e.to_string())),
    }
}

fn extract_html(bytes: &[u8]) -> (Option<String>, ExtractionStatus) {
    let html = String::from_utf8_lossy(bytes);
    // Simple tag stripper — adequate for Jira-rendered HTML
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut in_script = false;
    let mut tag_buf = String::new();
    for ch in html.chars() {
        match ch {
            '<' => {
                in_tag = true;
                tag_buf.clear();
            }
            '>' => {
                let tag_lower = tag_buf.trim().to_lowercase();
                if tag_lower.starts_with("script") {
                    in_script = true;
                } else if tag_lower.starts_with("/script") {
                    in_script = false;
                }
                in_tag = false;
            }
            _ if in_tag => tag_buf.push(ch),
            _ if !in_script => out.push(ch),
            _ => {}
        }
    }
    // Collapse whitespace
    let collapsed: String = out
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (Some(truncate(collapsed)), ExtractionStatus::Success)
}

fn extract_zip(bytes: &[u8]) -> (Option<String>, ExtractionStatus) {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = match zip::ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(e) => return (None, ExtractionStatus::Failed(format!("zip open: {e}"))),
    };
    let mut parts: Vec<String> = Vec::new();
    let mut total = 0usize;
    for i in 0..archive.len() {
        if total >= MAX_BYTES {
            break;
        }
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = entry.name().to_lowercase();
        let is_text = ["txt","log","json","xml","csv","md","yaml","yml"]
            .iter()
            .any(|ext| name.ends_with(ext));
        if !is_text || entry.is_dir() {
            continue;
        }
        use std::io::Read;
        let mut buf = Vec::new();
        if entry.read_to_end(&mut buf).is_ok() {
            let s = String::from_utf8_lossy(&buf).to_string();
            total += s.len();
            parts.push(format!("=== {} ===\n{}", entry.name(), s));
        }
    }
    if parts.is_empty() {
        (None, ExtractionStatus::Skipped)
    } else {
        (Some(truncate(parts.join("\n"))), ExtractionStatus::Success)
    }
}

fn extract_docx(bytes: &[u8]) -> (Option<String>, ExtractionStatus) {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = match zip::ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(e) => return (None, ExtractionStatus::Failed(format!("docx open: {e}"))),
    };
    let mut xml_content = String::new();
    match archive.by_name("word/document.xml") {
        Ok(mut entry) => {
            use std::io::Read;
            if entry.read_to_string(&mut xml_content).is_err() {
                return (None, ExtractionStatus::Failed("docx read failed".into()));
            }
        }
        Err(_) => return (None, ExtractionStatus::Failed("word/document.xml not found".into())),
    }
    // Extract text nodes from XML
    match roxmltree::Document::parse(&xml_content) {
        Ok(doc) => {
            let text: String = doc
                .descendants()
                .filter(|n| n.is_text())
                .map(|n| n.text().unwrap_or(""))
                .collect::<Vec<_>>()
                .join(" ");
            let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
            (Some(truncate(collapsed)), ExtractionStatus::Success)
        }
        Err(e) => (None, ExtractionStatus::Failed(format!("docx xml: {e}"))),
    }
}

fn extract_pdf(bytes: &[u8]) -> (Option<String>, ExtractionStatus) {
    match lopdf::Document::load_mem(bytes) {
        Ok(doc) => {
            let mut parts: Vec<String> = Vec::new();
            let pages: Vec<_> = doc.get_pages().keys().cloned().collect();
            for page_id in pages {
                if let Ok(text) = doc.extract_text(&[page_id]) {
                    parts.push(text);
                }
            }
            if parts.is_empty() {
                (None, ExtractionStatus::Skipped)
            } else {
                (Some(truncate(parts.join("\n"))), ExtractionStatus::Success)
            }
        }
        Err(e) => (None, ExtractionStatus::Failed(format!("pdf: {e}"))),
    }
}
```

Note: `str::floor_char_boundary` is nightly-only. Replace the `truncate` fn with a safe version:

```rust
fn truncate(s: String) -> String {
    if s.len() <= MAX_BYTES {
        return s;
    }
    // Walk back from MAX_BYTES to a char boundary
    let mut boundary = MAX_BYTES;
    while boundary > 0 && !s.is_char_boundary(boundary) {
        boundary -= 1;
    }
    format!("{}… [truncated]", &s[..boundary])
}
```

- [ ] **Step 2: Verify**

```bash
cd hadron-web && cargo check -p hadron-investigation
```
Expected: compiles. If lopdf API differs, run `cargo doc -p lopdf --open` to check `extract_text` signature.

- [ ] **Step 3: Commit**

```bash
git add hadron-web/crates/hadron-investigation/src/atlassian/attachments.rs
git commit -m "feat(investigation): implement attachment text extractor (txt/html/zip/docx/pdf)"
```

---

### Task 6: Extended Jira API

**Files:**
- Modify: `hadron-web/crates/hadron-investigation/src/atlassian/jira.rs`

- [ ] **Step 1: Replace stub with full implementation**

```rust
use super::{adf::adf_to_text, AtlassianClient, InvestigationError};

pub struct IssueFullContext {
    pub key: String,
    pub summary: String,
    pub description: String,
    pub status: String,
    pub assignee: Option<String>,
    pub reporter: Option<String>,
    pub project_key: String,
    pub comments: Vec<String>,
    pub changelog_entries: Vec<String>,
    pub worklogs: Vec<String>,
    pub remote_links: Vec<String>,
    pub issue_links: Vec<(String, String, String)>, // (key, summary, relation_name)
    pub attachments: Vec<(String, String)>,           // (filename, url)
    pub sprint_name: Option<String>,
    pub fix_versions: Vec<String>,
    pub labels: Vec<String>,
    pub components: Vec<String>,
}

pub async fn get_issue_full(
    client: &AtlassianClient,
    key: &str,
) -> Result<IssueFullContext, InvestigationError> {
    // Fetch base issue
    let issue = client
        .jira_get(&format!(
            "/rest/api/3/issue/{}?expand=renderedFields",
            key
        ))
        .await?;

    let fields = &issue["fields"];
    let summary = fields["summary"].as_str().unwrap_or("").to_string();
    let status = fields["status"]["name"].as_str().unwrap_or("").to_string();
    let assignee = fields["assignee"]["displayName"]
        .as_str()
        .map(String::from);
    let reporter = fields["reporter"]["displayName"]
        .as_str()
        .map(String::from);
    let project_key = fields["project"]["key"].as_str().unwrap_or("").to_string();

    // Description — ADF or rendered
    let description = if let Some(adf) = fields.get("description") {
        if !adf.is_null() {
            adf_to_text(adf)
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    // Components, labels, fix versions
    let components: Vec<String> = fields["components"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|c| c["name"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let labels: Vec<String> = fields["labels"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|l| l.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let fix_versions: Vec<String> = fields["fixVersions"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v["name"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    // Issue links
    let issue_links: Vec<(String, String, String)> = fields["issuelinks"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|link| {
                    let rel = link["type"]["name"].as_str().unwrap_or("").to_string();
                    if let Some(inward) = link.get("inwardIssue") {
                        let k = inward["key"].as_str().unwrap_or("").to_string();
                        let s = inward["fields"]["summary"].as_str().unwrap_or("").to_string();
                        Some((k, s, rel))
                    } else if let Some(outward) = link.get("outwardIssue") {
                        let k = outward["key"].as_str().unwrap_or("").to_string();
                        let s = outward["fields"]["summary"].as_str().unwrap_or("").to_string();
                        Some((k, s, rel))
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    // Attachments
    let attachments: Vec<(String, String)> = fields["attachment"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    let name = a["filename"].as_str().map(String::from)?;
                    let url = a["content"].as_str().map(String::from)?;
                    Some((name, url))
                })
                .collect()
        })
        .unwrap_or_default();

    // Sprint from customfield_10020
    let sprint_name = fields["customfield_10020"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|s| s["name"].as_str())
        .map(String::from);

    // Changelog (parallel fetch)
    let changelog_fut = client.jira_get(&format!("/rest/api/3/issue/{}/changelog", key));
    // Comments with renderedBody
    let comments_fut = client.jira_get(&format!(
        "/rest/api/3/issue/{}/comment?expand=renderedBody",
        key
    ));
    // Worklogs
    let worklog_fut = client.jira_get(&format!("/rest/api/3/issue/{}/worklog", key));
    // Remote links
    let remote_links_fut = client.jira_get(&format!("/rest/api/3/issue/{}/remotelink", key));

    let (changelog_res, comments_res, worklog_res, remote_links_res) = tokio::join!(
        changelog_fut,
        comments_fut,
        worklog_fut,
        remote_links_fut
    );

    let changelog_entries: Vec<String> = changelog_res
        .ok()
        .and_then(|v| v["values"].as_array().cloned())
        .map(|arr| {
            arr.iter()
                .map(|entry| {
                    let author = entry["author"]["displayName"]
                        .as_str()
                        .unwrap_or("unknown");
                    let created = entry["created"].as_str().unwrap_or("");
                    let items: Vec<String> = entry["items"]
                        .as_array()
                        .map(|items| {
                            items
                                .iter()
                                .map(|item| {
                                    format!(
                                        "{}: {} → {}",
                                        item["field"].as_str().unwrap_or(""),
                                        item["fromString"].as_str().unwrap_or(""),
                                        item["toString"].as_str().unwrap_or("")
                                    )
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    format!("[{}] {} — {}", created, author, items.join("; "))
                })
                .collect()
        })
        .unwrap_or_default();

    let comments: Vec<String> = comments_res
        .ok()
        .and_then(|v| v["comments"].as_array().cloned())
        .map(|arr| {
            arr.iter()
                .map(|c| {
                    let author = c["author"]["displayName"].as_str().unwrap_or("unknown");
                    let created = c["created"].as_str().unwrap_or("");
                    let body = if let Some(adf) = c.get("body") {
                        if !adf.is_null() {
                            adf_to_text(adf)
                        } else {
                            c["renderedBody"].as_str().unwrap_or("").to_string()
                        }
                    } else {
                        String::new()
                    };
                    format!("[{}] {}: {}", created, author, body.trim())
                })
                .collect()
        })
        .unwrap_or_default();

    let worklogs: Vec<String> = worklog_fut_result(worklog_res);

    let remote_links: Vec<String> = remote_links_res
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|arr| {
            arr.iter()
                .filter_map(|rl| {
                    let title = rl["object"]["title"].as_str()?;
                    let url = rl["object"]["url"].as_str().unwrap_or("");
                    Some(format!("{} ({})", title, url))
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(IssueFullContext {
        key: key.to_string(),
        summary,
        description,
        status,
        assignee,
        reporter,
        project_key,
        comments,
        changelog_entries,
        worklogs,
        remote_links,
        issue_links,
        attachments,
        sprint_name,
        fix_versions,
        labels,
        components,
    })
}

fn worklog_fut_result(res: Result<serde_json::Value, InvestigationError>) -> Vec<String> {
    res.ok()
        .and_then(|v| v["worklogs"].as_array().cloned())
        .map(|arr| {
            arr.iter()
                .map(|w| {
                    let author = w["author"]["displayName"].as_str().unwrap_or("unknown");
                    let started = w["started"].as_str().unwrap_or("");
                    let seconds = w["timeSpentSeconds"].as_u64().unwrap_or(0);
                    let hours = seconds / 3600;
                    let comment = if let Some(adf) = w.get("comment") {
                        if !adf.is_null() { adf_to_text(adf) } else { String::new() }
                    } else {
                        String::new()
                    };
                    format!("[{}] {} logged {}h — {}", started, author, hours, comment.trim())
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Search issues by JQL, returns (key, summary, status) triples.
pub async fn search_jql(
    client: &AtlassianClient,
    jql: &str,
    max_results: u32,
) -> Result<Vec<(String, String, String)>, InvestigationError> {
    use serde_json::json;
    let body = json!({
        "jql": jql,
        "maxResults": max_results,
        "fields": ["summary", "status"]
    });
    let url = format!("{}/rest/api/3/search", client.config.jira_base_url.trim_end_matches('/'));
    let resp = client
        .client
        .post(&url)
        .header("Authorization", format!("Basic {}", {
            use base64::Engine;
            let raw = format!("{}:{}", client.config.jira_email, client.config.jira_api_token);
            base64::engine::general_purpose::STANDARD.encode(raw)
        }))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(InvestigationError::JiraApi(format!("JQL search returned {}", resp.status())));
    }
    let data: serde_json::Value = resp.json().await?;
    let issues = data["issues"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|i| {
                    let key = i["key"].as_str().map(String::from)?;
                    let summary = i["fields"]["summary"].as_str().unwrap_or("").to_string();
                    let status = i["fields"]["status"]["name"].as_str().unwrap_or("").to_string();
                    Some((key, summary, status))
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(issues)
}
```

- [ ] **Step 2: Verify**

```bash
cd hadron-web && cargo check -p hadron-investigation
```

- [ ] **Step 3: Commit**

```bash
git add hadron-web/crates/hadron-investigation/src/atlassian/jira.rs
git commit -m "feat(investigation): implement extended Jira API (issue_full, changelog, comments, JQL)"
```

---

### Task 7: Related Issue Finder

**Files:**
- Create: `hadron-web/crates/hadron-investigation/src/investigation/related.rs`

- [ ] **Step 1: Write related.rs**

```rust
use crate::atlassian::{jira, AtlassianClient};
use crate::investigation::evidence::{RelatedIssue, RelationType};
use std::collections::HashSet;

const STOP_WORDS: &[&str] = &[
    "the","and","for","are","but","not","you","all","can","had","her","was","one",
    "our","out","day","get","has","him","his","how","its","who","did","this","that",
    "with","have","from","they","will","been","when","than","then","what","some",
    "into","your","does","just","more","also","like","over","such","only","both",
    "each","very","most","even","well","back","here","much","need","high","also",
    "issue","error","null","exception","caused","after","before","during","while",
    "using","used","value","object","class","method","field","table","data",
];

/// Extract meaningful tokens from a summary string for JQL matching.
pub fn extract_tokens(summary: &str) -> Vec<String> {
    let lower = summary.to_lowercase();
    // Split on non-alphanumeric, keep tokens with 4+ chars
    lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 4 && !STOP_WORDS.contains(t))
        .map(String::from)
        .collect::<HashSet<_>>() // deduplicate
        .into_iter()
        .take(6) // limit to 6 tokens for JQL
        .collect()
}

pub struct RelatedIssueResults {
    pub direct: Vec<RelatedIssue>,
    pub project_history: Vec<RelatedIssue>,
    pub cross_project: Vec<RelatedIssue>,
}

pub async fn find_related_issues(
    client: &AtlassianClient,
    issue: &jira::IssueFullContext,
    base_url: &str,
) -> RelatedIssueResults {
    let tokens = extract_tokens(&issue.summary);
    let project_key = &issue.project_key;

    // Strategy 1: direct links from issue_links + remote_links (already fetched)
    let direct_fut = async {
        issue
            .issue_links
            .iter()
            .map(|(key, summary, rel)| RelatedIssue {
                key: key.clone(),
                summary: summary.clone(),
                status: String::new(),
                relation_type: RelationType::DirectLink,
                url: format!("{}/browse/{}", base_url.trim_end_matches('/'), key),
            })
            .collect::<Vec<_>>()
    };

    // Strategy 2: same-project, last 90 days
    let project_hist_fut = {
        let client = client.clone();
        let project_key = project_key.clone();
        let tokens = tokens.clone();
        let base_url = base_url.to_string();
        async move {
            if tokens.is_empty() {
                return vec![];
            }
            let token_clause = tokens
                .iter()
                .map(|t| format!("summary ~ \"{}\"", t))
                .collect::<Vec<_>>()
                .join(" OR ");
            let jql = format!(
                "project = {} AND ({}) AND created >= -90d ORDER BY updated DESC",
                project_key, token_clause
            );
            jira::search_jql(&client, &jql, 10)
                .await
                .unwrap_or_default()
                .into_iter()
                .map(|(key, summary, status)| RelatedIssue {
                    url: format!("{}/browse/{}", base_url.trim_end_matches('/'), key),
                    key,
                    summary,
                    status,
                    relation_type: RelationType::ProjectHistory,
                })
                .collect()
        }
    };

    // Strategy 3: cross-project siblings, last 6 months
    let cross_proj_fut = {
        let client = client.clone();
        let tokens = tokens.clone();
        let own_key = issue.key.clone();
        let own_project = project_key.clone();
        let base_url = base_url.to_string();
        async move {
            if tokens.is_empty() {
                return vec![];
            }
            let token_clause = tokens
                .iter()
                .map(|t| format!("summary ~ \"{}\"", t))
                .collect::<Vec<_>>()
                .join(" OR ");
            let jql = format!(
                "project != {} AND ({}) AND created >= -180d ORDER BY updated DESC",
                own_project, token_clause
            );
            jira::search_jql(&client, &jql, 10)
                .await
                .unwrap_or_default()
                .into_iter()
                .filter(|(k, _, _)| k != &own_key)
                .map(|(key, summary, status)| RelatedIssue {
                    url: format!("{}/browse/{}", base_url.trim_end_matches('/'), key),
                    key,
                    summary,
                    status,
                    relation_type: RelationType::CrossProjectSibling,
                })
                .collect()
        }
    };

    let (direct, project_history, cross_project) =
        tokio::join!(direct_fut, project_hist_fut, cross_proj_fut);

    RelatedIssueResults {
        direct,
        project_history,
        cross_project,
    }
}
```

- [ ] **Step 2: Verify**

```bash
cd hadron-web && cargo check -p hadron-investigation
```

- [ ] **Step 3: Commit**

```bash
git add hadron-web/crates/hadron-investigation/src/investigation/related.rs
git commit -m "feat(investigation): implement 3-strategy related issue finder"
```

---

### Task 8: Confluence API

**Files:**
- Modify: `hadron-web/crates/hadron-investigation/src/atlassian/confluence.rs`

- [ ] **Step 1: Replace stub with full Confluence API**

```rust
use crate::investigation::evidence::ConfluenceDoc;
use super::{AtlassianClient, InvestigationError};

pub async fn search_confluence(
    client: &AtlassianClient,
    cql: &str,
    limit: u32,
) -> Result<Vec<ConfluenceDoc>, InvestigationError> {
    let path = format!(
        "/wiki/rest/api/search?cql={}&limit={}",
        urlencoded(cql),
        limit
    );
    let data = client.confluence_get(&path).await?;
    let results = data["results"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|r| {
                    let content = r.get("content")?;
                    let id = content["id"].as_str().map(String::from)?;
                    let title = content["title"].as_str().unwrap_or("").to_string();
                    let excerpt = r["excerpt"].as_str().unwrap_or("").to_string();
                    let space_key = content["space"]["key"].as_str().map(String::from);
                    let base = client.config.confluence_base_url().trim_end_matches('/');
                    let space = space_key.as_deref().unwrap_or("");
                    let url = format!("{}/wiki/spaces/{}/pages/{}", base, space, id);
                    Some(ConfluenceDoc { id, title, excerpt, url, space_key })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(results)
}

pub async fn get_confluence_content(
    client: &AtlassianClient,
    id: &str,
) -> Result<ConfluenceDoc, InvestigationError> {
    let path = format!("/wiki/rest/api/content/{}?expand=body.storage,space", id);
    let data = client.confluence_get(&path).await?;
    let title = data["title"].as_str().unwrap_or("").to_string();
    let space_key = data["space"]["key"].as_str().map(String::from);
    // Extract text from storage format (simplified XML strip)
    let body_html = data["body"]["storage"]["value"]
        .as_str()
        .unwrap_or("");
    let excerpt = strip_xml_tags(body_html)
        .split_whitespace()
        .take(80)
        .collect::<Vec<_>>()
        .join(" ");
    let base = client.config.confluence_base_url().trim_end_matches('/');
    let space = space_key.as_deref().unwrap_or("");
    let url = format!("{}/wiki/spaces/{}/pages/{}", base, space, id);
    Ok(ConfluenceDoc {
        id: id.to_string(),
        title,
        excerpt,
        url,
        space_key,
    })
}

pub async fn get_related_content(
    client: &AtlassianClient,
    entities: &[String],
    limit: u32,
) -> Vec<ConfluenceDoc> {
    if entities.is_empty() {
        return vec![];
    }
    let terms: Vec<String> = entities.iter().take(4).map(|e| format!("\"{}\"", e)).collect();
    let cql = format!("text ~ ({})", terms.join(" OR "));
    search_confluence(client, &cql, limit).await.unwrap_or_default()
}

pub async fn search_mod_docs(
    client: &AtlassianClient,
    query: &str,
    limit: u32,
) -> Vec<ConfluenceDoc> {
    let homepage_id = client.config.mod_docs_homepage_id().to_string();
    let cql = format!(
        "ancestor = {} AND text ~ \"{}\"",
        homepage_id,
        query.replace('"', "'")
    );
    search_confluence(client, &cql, limit).await.unwrap_or_default()
}

pub async fn get_mod_page(
    client: &AtlassianClient,
    id: &str,
) -> Result<ConfluenceDoc, InvestigationError> {
    let resolved_id = if id.is_empty() {
        client.config.mod_docs_homepage_id()
    } else {
        id
    };
    get_confluence_content(client, resolved_id).await
}

fn urlencoded(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            ' ' => '+'.to_string(),
            '"' => "%22".to_string(),
            '&' => "%26".to_string(),
            '=' => "%3D".to_string(),
            '+' => "%2B".to_string(),
            _ => c.to_string(),
        })
        .collect()
}

fn strip_xml_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}
```

- [ ] **Step 2: Verify**

```bash
cd hadron-web && cargo check -p hadron-investigation
```

- [ ] **Step 3: Commit**

```bash
git add hadron-web/crates/hadron-investigation/src/atlassian/confluence.rs
git commit -m "feat(investigation): implement Confluence search, content, MOD docs"
```

---

### Task 9: WHATS'ON Knowledge Base

**Files:**
- Modify: `hadron-web/crates/hadron-investigation/src/knowledge_base/mod.rs`

- [ ] **Step 1: Implement KB search**

The WHATS'ON KB serves a JSON index manifest. We fetch it, score chunks by token overlap with the query, and return the top matches.

```rust
use reqwest::Client;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct KbIndex {
    topics: Vec<KbTopic>,
}

#[derive(Debug, Deserialize)]
struct KbTopic {
    title: String,
    slug: String,
    chunks: Vec<String>,
}

pub async fn search_kb(
    config: &crate::atlassian::InvestigationConfig,
    query: &str,
) -> Vec<String> {
    let base_url = config.whatson_kb_url();
    let index_url = format!("{}/index.json", base_url.trim_end_matches('/'));

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let index: KbIndex = match client.get(&index_url).send().await {
        Ok(resp) => match resp.json().await {
            Ok(idx) => idx,
            Err(_) => return vec![],
        },
        Err(_) => return vec![],
    };

    let query_tokens: Vec<String> = query
        .to_lowercase()
        .split_whitespace()
        .filter(|t| t.len() >= 3)
        .map(String::from)
        .collect();

    if query_tokens.is_empty() {
        return vec![];
    }

    let mut scored: Vec<(usize, String)> = index
        .topics
        .iter()
        .filter_map(|topic| {
            let title_lower = topic.title.to_lowercase();
            let score = query_tokens
                .iter()
                .filter(|t| title_lower.contains(t.as_str()))
                .count();

            if score == 0 {
                // Try chunks
                let chunk_score: usize = topic
                    .chunks
                    .iter()
                    .map(|c| {
                        let cl = c.to_lowercase();
                        query_tokens.iter().filter(|t| cl.contains(t.as_str())).count()
                    })
                    .sum();
                if chunk_score > 0 {
                    let excerpt = topic.chunks.first().map(|c| c.as_str()).unwrap_or("").to_string();
                    Some((chunk_score, format!("{}: {}", topic.title, excerpt)))
                } else {
                    None
                }
            } else {
                let excerpt = topic.chunks.first().map(|c| c.as_str()).unwrap_or("").to_string();
                Some((score * 2, format!("{}: {}", topic.title, excerpt)))
            }
        })
        .collect();

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter().take(5).map(|(_, s)| s).collect()
}
```

Note: If `index.json` structure differs from what the real KB serves, this may need adjustment. Check the actual URL at `https://whatsonknowledgebase.mediagenix.tv/latest_version/` during testing and adapt the struct.

- [ ] **Step 2: Verify**

```bash
cd hadron-web && cargo check -p hadron-investigation
```

- [ ] **Step 3: Commit**

```bash
git add hadron-web/crates/hadron-investigation/src/knowledge_base/mod.rs
git commit -m "feat(investigation): implement WHATS'ON KB search"
```

---

### Task 10: Evidence Builder + Hypothesis Engine

**Files:**
- Create: `hadron-web/crates/hadron-investigation/src/investigation/evidence_builder.rs`
- Modify: `hadron-web/crates/hadron-investigation/src/investigation/mod.rs`

- [ ] **Step 1: Create evidence_builder.rs**

```rust
use crate::atlassian::jira::IssueFullContext;
use crate::investigation::evidence::{
    Confidence, EvidenceClaim, EvidenceCategory, Hypothesis,
};

pub fn build_claims_from_issue(issue: &IssueFullContext) -> Vec<EvidenceClaim> {
    let mut claims = Vec::new();

    if !issue.description.is_empty() {
        claims.push(EvidenceClaim {
            text: format!("Description: {}", truncate_claim(&issue.description, 400)),
            category: EvidenceCategory::ObservedBehavior,
            entities: extract_entities(&issue.description),
        });
    }

    for (key, summary, rel) in &issue.issue_links {
        claims.push(EvidenceClaim {
            text: format!("Linked issue {}: {} ({})", key, summary, rel),
            category: EvidenceCategory::LinkedContext,
            entities: vec![key.clone()],
        });
    }

    for link in &issue.remote_links {
        claims.push(EvidenceClaim {
            text: format!("Remote link: {}", link),
            category: EvidenceCategory::LinkedContext,
            entities: vec![],
        });
    }

    for comment in &issue.comments {
        claims.push(EvidenceClaim {
            text: truncate_claim(comment, 300),
            category: EvidenceCategory::IssueComment,
            entities: extract_entities(comment),
        });
    }

    for entry in &issue.changelog_entries {
        claims.push(EvidenceClaim {
            text: entry.clone(),
            category: EvidenceCategory::LinkedContext,
            entities: vec![],
        });
    }

    claims
}

pub fn build_hypotheses(
    issue: &IssueFullContext,
    claims: &[EvidenceClaim],
    related_count: usize,
) -> (Vec<Hypothesis>, Vec<String>, Vec<String>) {
    let mut hypotheses = Vec::new();
    let mut open_questions = Vec::new();
    let mut next_checks = Vec::new();

    // Regression hypothesis: if related issues exist
    if related_count > 0 {
        let supporting: Vec<String> = claims
            .iter()
            .filter(|c| c.category == EvidenceCategory::HistoricalMatch)
            .take(3)
            .map(|c| truncate_claim(&c.text, 80))
            .collect();
        hypotheses.push(Hypothesis {
            text: format!(
                "This may be a regression of a previously seen issue ({} related found).",
                related_count
            ),
            confidence: if related_count >= 3 { Confidence::High } else { Confidence::Medium },
            supporting_claims: supporting,
        });
    }

    // Null / NPE hypothesis
    let all_text = format!(
        "{} {} {}",
        issue.description,
        issue.summary,
        issue.comments.join(" ")
    )
    .to_lowercase();

    if all_text.contains("null")
        || all_text.contains("nullpointer")
        || all_text.contains("npe")
    {
        hypotheses.push(Hypothesis {
            text: "A null pointer / uninitialized reference may be the root cause.".into(),
            confidence: Confidence::Medium,
            supporting_claims: vec!["Null/NPE keyword found in issue text".into()],
        });
        next_checks.push("Review stack trace for null dereference location.".into());
    }

    if all_text.contains("timeout") || all_text.contains("timed out") {
        hypotheses.push(Hypothesis {
            text: "A timeout may be causing the failure — check network or DB latency.".into(),
            confidence: Confidence::Medium,
            supporting_claims: vec!["Timeout keyword found in issue text".into()],
        });
        next_checks.push("Check infrastructure metrics around the reported time.".into());
    }

    // Open questions
    if issue.assignee.is_none() {
        open_questions.push("Who is responsible for investigating this issue?".into());
    }
    if issue.fix_versions.is_empty() {
        open_questions.push("Which release version is targeted for the fix?".into());
    }
    if issue.components.is_empty() {
        open_questions.push("Which component or module is affected?".into());
    }
    if !issue.attachments.is_empty() {
        next_checks.push(format!(
            "Review {} attachment(s) for additional signals.",
            issue.attachments.len()
        ));
    }
    next_checks.push("Verify the fix in the test environment with the exact steps to reproduce.".into());

    (hypotheses, open_questions, next_checks)
}

fn truncate_claim(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.len() <= max {
        s.to_string()
    } else {
        let mut boundary = max;
        while boundary > 0 && !s.is_char_boundary(boundary) {
            boundary -= 1;
        }
        format!("{}…", &s[..boundary])
    }
}

fn extract_entities(text: &str) -> Vec<String> {
    // Extract uppercase tokens (e.g. PROJ-123, CLASS_NAME) as entities
    let re = regex::Regex::new(r"\b([A-Z][A-Z0-9_]+-\d+|[A-Z]{2,}[A-Z0-9_]+)\b").unwrap();
    re.find_iter(text)
        .map(|m| m.as_str().to_string())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .take(10)
        .collect()
}
```

- [ ] **Step 2: Add pub mod to investigation/mod.rs**

```rust
pub mod customer;
pub mod evidence;
pub mod evidence_builder;
pub mod expected;
pub mod regression;
pub mod related;
pub mod ticket;
```

- [ ] **Step 3: Verify**

```bash
cd hadron-web && cargo check -p hadron-investigation
```

- [ ] **Step 4: Commit**

```bash
git add hadron-web/crates/hadron-investigation/src/investigation/evidence_builder.rs hadron-web/crates/hadron-investigation/src/investigation/mod.rs
git commit -m "feat(investigation): add evidence builder and hypothesis engine"
```

---

### Task 11: `investigate_ticket` Orchestrator

**Files:**
- Create: `hadron-web/crates/hadron-investigation/src/investigation/ticket.rs`

- [ ] **Step 1: Write ticket.rs**

```rust
use crate::atlassian::{
    attachments::{extract_attachment, AttachmentExtractResult},
    confluence,
    jira,
    AtlassianClient, InvestigationConfig, InvestigationError,
};
use crate::investigation::{
    evidence::{
        AttachmentResult, EvidenceClaim, EvidenceCategory, InvestigationDossier,
        InvestigationStatus, InvestigationType, RelatedIssue,
    },
    evidence_builder::{build_claims_from_issue, build_hypotheses},
    related::find_related_issues,
};
use crate::knowledge_base;

pub async fn investigate_ticket(
    config: InvestigationConfig,
    ticket_key: &str,
) -> Result<InvestigationDossier, InvestigationError> {
    let client = AtlassianClient::new(config);
    let base_url = client.config.jira_base_url.clone();
    let mut warnings: Vec<String> = Vec::new();

    // Core ticket fetch (hard failure if unreachable)
    let issue = jira::get_issue_full(&client, ticket_key).await?;

    let ticket_url = format!("{}/browse/{}", base_url.trim_end_matches('/'), ticket_key);

    // Build evidence claims from issue data
    let mut claims = build_claims_from_issue(&issue);

    // Related issues (parallel, non-fatal)
    let related = find_related_issues(&client, &issue, &base_url).await;
    let mut all_related: Vec<RelatedIssue> = Vec::new();
    all_related.extend(related.direct);
    let historical_count = related.project_history.len() + related.cross_project.len();
    for r in &related.project_history {
        claims.push(EvidenceClaim {
            text: format!("Historical match: {} — {}", r.key, r.summary),
            category: EvidenceCategory::HistoricalMatch,
            entities: vec![r.key.clone()],
        });
    }
    all_related.extend(related.project_history);
    all_related.extend(related.cross_project);

    // Confluence (non-fatal)
    let entities: Vec<String> = claims
        .iter()
        .flat_map(|c| c.entities.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .take(4)
        .collect();

    let confluence_docs = match confluence::get_related_content(&client, &entities, 5).await {
        docs => {
            for doc in &docs {
                claims.push(EvidenceClaim {
                    text: format!("Confluence: {} — {}", doc.title, doc.excerpt),
                    category: EvidenceCategory::ExpectedBehavior,
                    entities: vec![],
                });
            }
            docs
        }
    };

    // KB search (non-fatal)
    let kb_results = knowledge_base::search_kb(&client.config, &issue.summary).await;
    for kb in &kb_results {
        claims.push(EvidenceClaim {
            text: format!("WHATS'ON KB: {}", kb),
            category: EvidenceCategory::ExpectedBehavior,
            entities: vec![],
        });
    }

    // Attachments (non-fatal, parallel)
    let attachment_futs: Vec<_> = issue
        .attachments
        .iter()
        .map(|(filename, url)| {
            let client = client.clone();
            let filename = filename.clone();
            let url = url.clone();
            async move {
                let result = extract_attachment(&client, &url, &filename).await;
                (filename, result)
            }
        })
        .collect();

    let attachment_results_raw = futures::future::join_all(attachment_futs).await;
    let mut attachment_results: Vec<AttachmentResult> = Vec::new();
    for (filename, AttachmentExtractResult { text, status }) in attachment_results_raw {
        if let Some(ref t) = text {
            claims.push(EvidenceClaim {
                text: format!("Attachment {}: {}", filename, &t[..t.len().min(200)]),
                category: EvidenceCategory::AttachmentSignal,
                entities: vec![],
            });
        }
        attachment_results.push(AttachmentResult {
            filename,
            extracted_text: text,
            extraction_status: status,
        });
    }

    // Hypotheses
    let (hypotheses, open_questions, next_checks) =
        build_hypotheses(&issue, &claims, historical_count);

    let investigation_status = if warnings.is_empty() {
        InvestigationStatus::Complete
    } else {
        InvestigationStatus::PartialFailure
    };

    Ok(InvestigationDossier {
        ticket_key: ticket_key.to_string(),
        ticket_summary: issue.summary,
        ticket_url,
        status: issue.status,
        assignee: issue.assignee,
        claims,
        related_issues: all_related,
        confluence_docs,
        hypotheses,
        open_questions,
        next_checks,
        attachments: attachment_results,
        warnings,
        investigation_type: InvestigationType::Ticket,
        investigation_status,
    })
}
```

- [ ] **Step 2: Add `impl Clone` to `AtlassianClient`**

In `src/atlassian/mod_.rs`, the `#[derive(Clone)]` on `AtlassianClient` already requires `reqwest::Client: Clone` — this is fine since `reqwest::Client` implements `Clone`.

- [ ] **Step 3: Verify**

```bash
cd hadron-web && cargo check -p hadron-investigation
```

- [ ] **Step 4: Commit**

```bash
git add hadron-web/crates/hadron-investigation/src/investigation/ticket.rs
git commit -m "feat(investigation): implement investigate_ticket orchestrator"
```

---

### Task 12: Remaining Investigation Functions

**Files:**
- Create: `hadron-web/crates/hadron-investigation/src/investigation/regression.rs`
- Create: `hadron-web/crates/hadron-investigation/src/investigation/expected.rs`
- Create: `hadron-web/crates/hadron-investigation/src/investigation/customer.rs`

- [ ] **Step 1: Write regression.rs**

```rust
use crate::atlassian::{confluence, jira, AtlassianClient, InvestigationConfig, InvestigationError};
use crate::investigation::{
    evidence::{
        EvidenceClaim, EvidenceCategory, InvestigationDossier,
        InvestigationStatus, InvestigationType,
    },
    related::{extract_tokens, find_related_issues},
};

pub async fn investigate_regression_family(
    config: InvestigationConfig,
    ticket_key: &str,
) -> Result<InvestigationDossier, InvestigationError> {
    let client = AtlassianClient::new(config);
    let base_url = client.config.jira_base_url.clone();

    let issue = jira::get_issue_full(&client, ticket_key).await?;
    let ticket_url = format!("{}/browse/{}", base_url.trim_end_matches('/'), ticket_key);

    let related = find_related_issues(&client, &issue, &base_url).await;
    let mut claims: Vec<EvidenceClaim> = Vec::new();
    let mut all_related = Vec::new();

    for r in &related.project_history {
        claims.push(EvidenceClaim {
            text: format!("Project history match: {} — {} ({})", r.key, r.summary, r.status),
            category: EvidenceCategory::HistoricalMatch,
            entities: vec![r.key.clone()],
        });
    }
    for r in &related.cross_project {
        claims.push(EvidenceClaim {
            text: format!("Cross-project sibling: {} — {} ({})", r.key, r.summary, r.status),
            category: EvidenceCategory::HistoricalMatch,
            entities: vec![r.key.clone()],
        });
    }
    all_related.extend(related.direct);
    all_related.extend(related.project_history);
    all_related.extend(related.cross_project);

    // Changelog-based regression signal
    for entry in &issue.changelog_entries {
        if entry.to_lowercase().contains("status") {
            claims.push(EvidenceClaim {
                text: format!("Changelog: {}", entry),
                category: EvidenceCategory::LinkedContext,
                entities: vec![],
            });
        }
    }

    let total_siblings = all_related.len();
    let hypotheses = vec![crate::investigation::evidence::Hypothesis {
        text: format!(
            "Regression family analysis: {} related issues found across projects.",
            total_siblings
        ),
        confidence: if total_siblings >= 3 {
            crate::investigation::evidence::Confidence::High
        } else if total_siblings >= 1 {
            crate::investigation::evidence::Confidence::Medium
        } else {
            crate::investigation::evidence::Confidence::Low
        },
        supporting_claims: claims.iter().take(3).map(|c| c.text.clone()).collect(),
    }];

    Ok(InvestigationDossier {
        ticket_key: ticket_key.to_string(),
        ticket_summary: issue.summary,
        ticket_url,
        status: issue.status,
        assignee: issue.assignee,
        claims,
        related_issues: all_related,
        confluence_docs: vec![],
        hypotheses,
        open_questions: vec![],
        next_checks: vec!["Review all sibling tickets for common fix patterns.".into()],
        attachments: vec![],
        warnings: vec![],
        investigation_type: InvestigationType::RegressionFamily,
        investigation_status: InvestigationStatus::Complete,
    })
}
```

- [ ] **Step 2: Write expected.rs**

```rust
use crate::atlassian::{confluence, AtlassianClient, InvestigationConfig, InvestigationError};
use crate::investigation::evidence::{
    ConfluenceDoc, EvidenceClaim, EvidenceCategory, InvestigationDossier,
    InvestigationStatus, InvestigationType,
};
use crate::knowledge_base;

pub async fn investigate_expected_behavior(
    config: InvestigationConfig,
    ticket_key: &str,
    query: &str,
) -> Result<InvestigationDossier, InvestigationError> {
    let client = AtlassianClient::new(config);
    let base_url = client.config.jira_base_url.clone();

    let mut claims: Vec<EvidenceClaim> = Vec::new();
    let mut confluence_docs: Vec<ConfluenceDoc> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    // Confluence CQL search
    let cql = format!("text ~ \"{}\"", query.replace('"', "'"));
    match confluence::search_confluence(&client, &cql, 8).await {
        Ok(docs) => {
            for doc in &docs {
                claims.push(EvidenceClaim {
                    text: format!("Confluence: {} — {}", doc.title, doc.excerpt),
                    category: EvidenceCategory::ExpectedBehavior,
                    entities: vec![],
                });
            }
            confluence_docs = docs;
        }
        Err(e) => warnings.push(format!("Confluence search failed: {}", e)),
    }

    // MOD docs
    let mod_docs = confluence::search_mod_docs(&client, query, 4).await;
    for doc in &mod_docs {
        claims.push(EvidenceClaim {
            text: format!("MOD docs: {} — {}", doc.title, doc.excerpt),
            category: EvidenceCategory::ExpectedBehavior,
            entities: vec![],
        });
    }
    confluence_docs.extend(mod_docs);

    // WHATS'ON KB
    let kb = knowledge_base::search_kb(&client.config, query).await;
    for entry in &kb {
        claims.push(EvidenceClaim {
            text: format!("WHATS'ON KB: {}", entry),
            category: EvidenceCategory::ExpectedBehavior,
            entities: vec![],
        });
    }

    let status = if warnings.is_empty() {
        InvestigationStatus::Complete
    } else {
        InvestigationStatus::PartialFailure
    };

    Ok(InvestigationDossier {
        ticket_key: ticket_key.to_string(),
        ticket_summary: query.to_string(),
        ticket_url: format!("{}/browse/{}", base_url.trim_end_matches('/'), ticket_key),
        status: String::new(),
        assignee: None,
        claims,
        related_issues: vec![],
        confluence_docs,
        hypotheses: vec![],
        open_questions: vec![],
        next_checks: vec![],
        attachments: vec![],
        warnings,
        investigation_type: InvestigationType::ExpectedBehavior,
        investigation_status: status,
    })
}
```

- [ ] **Step 3: Write customer.rs**

```rust
use crate::atlassian::{jira, AtlassianClient, InvestigationConfig, InvestigationError};
use crate::investigation::evidence::{
    EvidenceClaim, EvidenceCategory, InvestigationDossier,
    InvestigationStatus, InvestigationType, RelatedIssue, RelationType,
};

pub async fn investigate_customer_history(
    config: InvestigationConfig,
    ticket_key: &str,
) -> Result<InvestigationDossier, InvestigationError> {
    let client = AtlassianClient::new(config);
    let base_url = client.config.jira_base_url.clone();

    let issue = jira::get_issue_full(&client, ticket_key).await?;
    let ticket_url = format!("{}/browse/{}", base_url.trim_end_matches('/'), ticket_key);

    let mut claims: Vec<EvidenceClaim> = Vec::new();
    let mut related_issues: Vec<RelatedIssue> = Vec::new();

    // Search by reporter if available
    if let Some(reporter) = &issue.reporter {
        let jql = format!(
            "reporter = \"{}\" ORDER BY created DESC",
            reporter
        );
        if let Ok(results) = jira::search_jql(&client, &jql, 15).await {
            for (key, summary, status) in results {
                if key != ticket_key {
                    claims.push(EvidenceClaim {
                        text: format!("Customer history: {} — {} ({})", key, summary, status),
                        category: EvidenceCategory::CustomerHistory,
                        entities: vec![key.clone()],
                    });
                    related_issues.push(RelatedIssue {
                        url: format!("{}/browse/{}", base_url.trim_end_matches('/'), key),
                        key,
                        summary,
                        status,
                        relation_type: RelationType::ProjectHistory,
                    });
                }
            }
        }
    }

    Ok(InvestigationDossier {
        ticket_key: ticket_key.to_string(),
        ticket_summary: issue.summary,
        ticket_url,
        status: issue.status,
        assignee: issue.assignee,
        claims,
        related_issues,
        confluence_docs: vec![],
        hypotheses: vec![],
        open_questions: vec![],
        next_checks: vec![],
        attachments: vec![],
        warnings: vec![],
        investigation_type: InvestigationType::CustomerHistory,
        investigation_status: InvestigationStatus::Complete,
    })
}
```

- [ ] **Step 4: Update lib.rs re-exports**

In `src/lib.rs`:
```rust
pub use investigation::ticket::investigate_ticket;
pub use investigation::regression::investigate_regression_family;
pub use investigation::expected::investigate_expected_behavior;
pub use investigation::customer::investigate_customer_history;
pub use atlassian::confluence::{search_confluence, get_confluence_content};
```

- [ ] **Step 5: Final Phase 1 verify**

```bash
cd hadron-web && cargo check -p hadron-investigation
```
Expected: clean compile, zero errors.

- [ ] **Step 6: Commit**

```bash
git add hadron-web/crates/hadron-investigation/src/investigation/
git commit -m "feat(investigation): implement regression_family, expected_behavior, customer_history orchestrators"
```
