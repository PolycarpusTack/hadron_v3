use thiserror::Error;

#[derive(Debug, Clone)]
pub struct InvestigationConfig {
    pub jira_base_url: String,
    pub jira_email: String,
    pub jira_api_token: String,
}

#[derive(Debug, Error)]
pub enum InvestigationError {
    #[error("error: {0}")]
    Other(String),
}

#[derive(Clone)]
pub struct AtlassianClient {
    pub config: InvestigationConfig,
}

impl AtlassianClient {
    pub fn new(config: InvestigationConfig) -> Self {
        Self { config }
    }
}
