use crate::atlassian::{InvestigationConfig, InvestigationError};
use crate::investigation::evidence::InvestigationDossier;

pub async fn investigate_expected_behavior(
    _config: InvestigationConfig,
    ticket_key: &str,
    _query: &str,
) -> Result<InvestigationDossier, InvestigationError> {
    Ok(InvestigationDossier {
        ticket_key: ticket_key.to_string(),
        ..Default::default()
    })
}
