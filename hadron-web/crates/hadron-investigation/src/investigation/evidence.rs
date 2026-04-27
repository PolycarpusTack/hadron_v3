use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InvestigationDossier {
    pub ticket_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceClaim {
    pub text: String,
    pub category: EvidenceCategory,
    pub entities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceCategory {
    ObservedBehavior,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelatedIssue {
    pub key: String,
    pub summary: String,
    pub status: String,
    pub relation_type: RelationType,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RelationType {
    DirectLink,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hypothesis {
    pub text: String,
    pub confidence: Confidence,
    pub supporting_claims: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentResult {
    pub filename: String,
    pub extracted_text: Option<String>,
    pub extraction_status: ExtractionStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtractionStatus {
    Success,
    Skipped,
    Failed(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum InvestigationType {
    #[default]
    Ticket,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum InvestigationStatus {
    #[default]
    Complete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfluenceDoc {
    pub id: String,
    pub title: String,
    pub excerpt: String,
    pub url: String,
    pub space_key: Option<String>,
}
