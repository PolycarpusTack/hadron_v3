use crate::investigation::evidence::ConfluenceDoc;
use super::{AtlassianClient, InvestigationError};

pub async fn search_confluence(
    _client: &AtlassianClient,
    _cql: &str,
    _limit: u32,
) -> Result<Vec<ConfluenceDoc>, InvestigationError> {
    Ok(vec![])
}

pub async fn get_confluence_content(
    _client: &AtlassianClient,
    _id: &str,
) -> Result<ConfluenceDoc, InvestigationError> {
    Err(InvestigationError::ConfluenceApi("stub".into()))
}
