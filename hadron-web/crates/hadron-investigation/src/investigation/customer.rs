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

    if let Some(reporter) = &issue.reporter {
        let jql = format!("reporter = \"{}\" ORDER BY created DESC", reporter);
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
