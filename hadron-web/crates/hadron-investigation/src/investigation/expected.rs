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
    let mut all_confluence_docs: Vec<ConfluenceDoc> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    // CQL full-text search
    let cql = format!("text ~ {}", crate::atlassian::jira::quote_jql_literal(query));
    match confluence::search_confluence(&client, &cql, 8).await {
        Ok(docs) => {
            for doc in &docs {
                claims.push(EvidenceClaim {
                    text: format!("Confluence: {} — {}", doc.title, doc.excerpt),
                    category: EvidenceCategory::ExpectedBehavior,
                    entities: vec![],
                });
            }
            all_confluence_docs.extend(docs);
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
    all_confluence_docs.extend(mod_docs);

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
        confluence_docs: all_confluence_docs,
        hypotheses: vec![],
        open_questions: vec![],
        next_checks: vec![],
        attachments: vec![],
        warnings,
        investigation_type: InvestigationType::ExpectedBehavior,
        investigation_status: status,
    })
}
