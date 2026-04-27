use crate::atlassian::{jira, AtlassianClient};
use crate::investigation::evidence::{RelatedIssue, RelationType};
use std::collections::HashSet;

const STOP_WORDS: &[&str] = &[
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was", "one",
    "our", "out", "day", "get", "has", "him", "his", "how", "its", "who", "did", "this", "that",
    "with", "have", "from", "they", "will", "been", "when", "than", "then", "what", "some",
    "into", "your", "does", "just", "more", "also", "like", "over", "such", "only", "both",
    "each", "very", "most", "even", "well", "back", "here", "much", "need", "high", "also",
    "issue", "error", "null", "exception", "caused", "after", "before", "during", "while",
    "using", "used", "value", "object", "class", "method", "field", "table", "data",
];

/// Extract meaningful tokens from a summary for JQL matching.
pub fn extract_tokens(summary: &str) -> Vec<String> {
    let lower = summary.to_lowercase();
    lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 4 && !STOP_WORDS.contains(t))
        .map(String::from)
        .collect::<HashSet<_>>()
        .into_iter()
        .take(6)
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
    let project_key = issue.project_key.clone();
    let own_key = issue.key.clone();

    // Strategy 1: direct links (no network call needed — already in issue data)
    let direct: Vec<RelatedIssue> = issue
        .issue_links
        .iter()
        .filter(|(k, _, _)| !k.is_empty())
        .map(|(key, summary, _rel)| RelatedIssue {
            key: key.clone(),
            summary: summary.clone(),
            status: String::new(),
            relation_type: RelationType::DirectLink,
            url: format!("{}/browse/{}", base_url.trim_end_matches('/'), key),
        })
        .collect();

    // Strategy 2: same-project history (90 days) + Strategy 3: cross-project (180 days)
    // Run in parallel
    let project_hist_fut = {
        let client = client.clone();
        let project_key = project_key.clone();
        let tokens = tokens.clone();
        let base_url = base_url.to_string();
        let own_key = own_key.clone();
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
                "project = \"{}\" AND ({}) AND created >= -90d ORDER BY updated DESC",
                project_key, token_clause
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
                    relation_type: RelationType::ProjectHistory,
                })
                .collect()
        }
    };

    let cross_proj_fut = {
        let client = client.clone();
        let tokens = tokens.clone();
        let own_key = own_key.clone();
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
                "project != \"{}\" AND ({}) AND created >= -180d ORDER BY updated DESC",
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

    let (project_history, cross_project) = tokio::join!(project_hist_fut, cross_proj_fut);

    RelatedIssueResults {
        direct,
        project_history,
        cross_project,
    }
}
