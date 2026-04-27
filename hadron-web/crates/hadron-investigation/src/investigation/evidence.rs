use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InvestigationDossier {
    pub ticket_key: String,
    pub ticket_summary: String,
    pub ticket_url: String,
    pub status: String,
    pub assignee: Option<String>,
    pub claims: Vec<EvidenceClaim>,
    pub related_issues: Vec<RelatedIssue>,
    pub confluence_docs: Vec<ConfluenceDoc>,
    pub hypotheses: Vec<Hypothesis>,
    pub open_questions: Vec<String>,
    pub next_checks: Vec<String>,
    pub attachments: Vec<AttachmentResult>,
    pub warnings: Vec<String>,
    pub investigation_type: InvestigationType,
    pub investigation_status: InvestigationStatus,
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
    LinkedContext,
    HistoricalMatch,
    ExpectedBehavior,
    AttachmentSignal,
    IssueComment,
    CustomerHistory,
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
    ProjectHistory,
    CrossProjectSibling,
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
    Medium,
    Low,
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

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum InvestigationType {
    #[default]
    Ticket,
    RegressionFamily,
    ExpectedBehavior,
    CustomerHistory,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum InvestigationStatus {
    #[default]
    Complete,
    PartialFailure,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfluenceDoc {
    pub id: String,
    pub title: String,
    pub excerpt: String,
    pub url: String,
    pub space_key: Option<String>,
}
