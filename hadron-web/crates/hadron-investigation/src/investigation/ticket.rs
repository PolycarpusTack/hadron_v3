use crate::atlassian::{InvestigationConfig, InvestigationError};
use crate::investigation::evidence::InvestigationDossier;

pub async fn investigate_ticket(
    _config: InvestigationConfig,
    ticket_key: &str,
) -> Result<InvestigationDossier, InvestigationError> {
    Ok(InvestigationDossier {
        ticket_key: ticket_key.to_string(),
        ..Default::default()
    })
}
