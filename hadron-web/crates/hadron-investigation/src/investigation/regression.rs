use crate::atlassian::{jira, AtlassianClient, InvestigationConfig, InvestigationError};
use crate::investigation::{
    evidence::{
        EvidenceClaim, EvidenceCategory, Hypothesis, Confidence,
        InvestigationDossier, InvestigationStatus, InvestigationType,
    },
    related::find_related_issues,
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
            text: format!(
                "Project history match: {} — {} ({})",
                r.key, r.summary, r.status
            ),
            category: EvidenceCategory::HistoricalMatch,
            entities: vec![r.key.clone()],
        });
    }
    for r in &related.cross_project {
        claims.push(EvidenceClaim {
            text: format!(
                "Cross-project sibling: {} — {} ({})",
                r.key, r.summary, r.status
            ),
            category: EvidenceCategory::HistoricalMatch,
            entities: vec![r.key.clone()],
        });
    }
    for entry in &issue.changelog_entries {
        if entry.to_lowercase().contains("status") {
            claims.push(EvidenceClaim {
                text: format!("Changelog: {}", entry),
                category: EvidenceCategory::LinkedContext,
                entities: vec![],
            });
        }
    }

    all_related.extend(related.direct);
    all_related.extend(related.project_history);
    all_related.extend(related.cross_project);

    let total_siblings = all_related.len();
    let hypotheses = vec![Hypothesis {
        text: format!(
            "Regression family analysis: {} related issues found across projects.",
            total_siblings
        ),
        confidence: if total_siblings >= 3 {
            Confidence::High
        } else if total_siblings >= 1 {
            Confidence::Medium
        } else {
            Confidence::Low
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
