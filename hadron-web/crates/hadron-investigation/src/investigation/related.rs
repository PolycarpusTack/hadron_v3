use crate::atlassian::{jira, AtlassianClient};
use crate::investigation::evidence::RelatedIssue;

pub fn extract_tokens(_summary: &str) -> Vec<String> {
    vec![]
}

pub struct RelatedIssueResults {
    pub direct: Vec<RelatedIssue>,
    pub project_history: Vec<RelatedIssue>,
    pub cross_project: Vec<RelatedIssue>,
}

pub async fn find_related_issues(
    _client: &AtlassianClient,
    _issue: &jira::IssueFullContext,
    _base_url: &str,
) -> RelatedIssueResults {
    RelatedIssueResults {
        direct: vec![],
        project_history: vec![],
        cross_project: vec![],
    }
}
