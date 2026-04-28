use futures::future::join_all;

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
    evidence_builder::{build_claims_from_issue, build_hypotheses, sanitize_for_prompt},
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

    // Core ticket fetch — hard failure if unreachable
    let issue = jira::get_issue_full(&client, ticket_key).await?;

    let ticket_url = format!("{}/browse/{}", base_url.trim_end_matches('/'), ticket_key);

    // Build evidence claims from issue data
    let mut claims = build_claims_from_issue(&issue);

    // Related issues — non-fatal, parallel internally
    let related = find_related_issues(&client, &issue, &base_url).await;
    let historical_count = related.project_history.len() + related.cross_project.len();
    let mut all_related: Vec<RelatedIssue> = Vec::new();

    all_related.extend(related.direct);

    for r in &related.project_history {
        claims.push(EvidenceClaim {
            text: format!("Historical match: {} — {}", r.key, r.summary),
            category: EvidenceCategory::HistoricalMatch,
            entities: vec![r.key.clone()],
        });
    }
    all_related.extend(related.project_history);
    all_related.extend(related.cross_project);

    // Collect entities for Confluence search
    let entities: Vec<String> = claims
        .iter()
        .flat_map(|c| c.entities.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .take(4)
        .collect();

    // Confluence + KB search — non-fatal, parallel
    let confluence_fut = confluence::get_related_content(&client, &entities, 5);
    let kb_fut = knowledge_base::search_kb(&client.config, &issue.summary);

    let (confluence_docs, kb_results) = tokio::join!(confluence_fut, kb_fut);

    for doc in &confluence_docs {
        claims.push(EvidenceClaim {
            text: format!("Confluence: {} — {}", doc.title, doc.excerpt),
            category: EvidenceCategory::ExpectedBehavior,
            entities: vec![],
        });
    }
    for kb in &kb_results {
        claims.push(EvidenceClaim {
            text: format!("WHATS'ON KB: {}", kb),
            category: EvidenceCategory::ExpectedBehavior,
            entities: vec![],
        });
    }

    // Attachment extraction — non-fatal, parallel
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

    let attachment_results_raw = join_all(attachment_futs).await;
    let mut attachment_results: Vec<AttachmentResult> = Vec::new();

    for (filename, AttachmentExtractResult { text, status }) in attachment_results_raw {
        if let Some(ref t) = text {
            let clean = sanitize_for_prompt(t);
            let preview_len = {
                let mut l = clean.len().min(200);
                while l > 0 && !clean.is_char_boundary(l) {
                    l -= 1;
                }
                l
            };
            claims.push(EvidenceClaim {
                text: format!("Attachment {}: {}", filename, &clean[..preview_len]),
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
