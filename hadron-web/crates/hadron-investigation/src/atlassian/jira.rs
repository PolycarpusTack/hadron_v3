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
    pub issue_links: Vec<(String, String, String)>,
    pub attachments: Vec<(String, String)>,
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

pub async fn search_jql(
    _client: &AtlassianClient,
    _jql: &str,
    _max_results: u32,
) -> Result<Vec<(String, String, String)>, InvestigationError> {
    Ok(vec![])
}
