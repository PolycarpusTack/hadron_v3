use futures::StreamExt;
use reqwest::Client;
use thiserror::Error;

/// Hard cap on attachment downloads. Prevents memory exhaustion from
/// adversarially large attachments hosted on the configured JIRA instance.
const ATTACHMENT_MAX_BYTES: usize = 32 * 1024 * 1024; // 32 MB

#[derive(Debug, Clone)]
pub struct InvestigationConfig {
    pub jira_base_url: String,
    pub jira_email: String,
    pub jira_api_token: String,
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
        // SECURITY: validate the attachment URL host matches the configured JIRA
        // host before sending Basic Auth credentials. The URL comes from
        // JIRA's attachment[].content field, which is attacker-controllable.
        let parsed = reqwest::Url::parse(url).map_err(|_| {
            InvestigationError::JiraApi("Invalid attachment URL".into())
        })?;
        if parsed.scheme() != "https" {
            return Err(InvestigationError::JiraApi(
                "Attachment URL must use https".into(),
            ));
        }
        let configured = reqwest::Url::parse(&self.config.jira_base_url).map_err(|_| {
            InvestigationError::JiraApi("Invalid configured JIRA base URL".into())
        })?;
        let same_host = parsed
            .host_str()
            .zip(configured.host_str())
            .map(|(a, b)| a.eq_ignore_ascii_case(b))
            .unwrap_or(false);
        let same_port = parsed.port_or_known_default() == configured.port_or_known_default();
        if !same_host || !same_port {
            return Err(InvestigationError::JiraApi(
                "Attachment host does not match configured JIRA host".into(),
            ));
        }

        let resp = self
            .client
            .get(parsed.clone())
            .header("Authorization", format!("Basic {}", self.jira_auth()))
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(InvestigationError::JiraApi(format!(
                "GET {} returned {}",
                parsed.path(),
                resp.status()
            )));
        }

        // Reject early if Content-Length already exceeds the cap.
        if let Some(len) = resp.content_length() {
            if len as usize > ATTACHMENT_MAX_BYTES {
                return Err(InvestigationError::Attachment(format!(
                    "Attachment too large: {} bytes (max {} MB)",
                    len,
                    ATTACHMENT_MAX_BYTES / (1024 * 1024)
                )));
            }
        }

        // Stream body and enforce the cap incrementally so we never buffer
        // more than ATTACHMENT_MAX_BYTES regardless of Content-Length.
        let mut buf = Vec::with_capacity(
            resp.content_length().unwrap_or(0).min(ATTACHMENT_MAX_BYTES as u64) as usize
        );
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            if buf.len() + chunk.len() > ATTACHMENT_MAX_BYTES {
                return Err(InvestigationError::Attachment(format!(
                    "Attachment exceeds {} MB limit",
                    ATTACHMENT_MAX_BYTES / (1024 * 1024)
                )));
            }
            buf.extend_from_slice(&chunk);
        }
        Ok(buf)
    }
}
