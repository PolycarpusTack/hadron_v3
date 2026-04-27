pub mod atlassian;
pub mod investigation;
pub mod knowledge_base;

pub use investigation::evidence::{
    InvestigationDossier, EvidenceClaim, EvidenceCategory,
    RelatedIssue, RelationType, Hypothesis, Confidence,
    AttachmentResult, ExtractionStatus, InvestigationType,
    InvestigationStatus, ConfluenceDoc,
};
pub use atlassian::{InvestigationConfig, InvestigationError, AtlassianClient};
pub use investigation::ticket::investigate_ticket;
pub use investigation::regression::investigate_regression_family;
pub use investigation::expected::investigate_expected_behavior;
pub use investigation::customer::investigate_customer_history;
pub use atlassian::confluence::{search_confluence, get_confluence_content};
