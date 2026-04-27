use crate::atlassian::jira::IssueFullContext;
use crate::investigation::evidence::{EvidenceClaim, Hypothesis};

pub fn build_claims_from_issue(_issue: &IssueFullContext) -> Vec<EvidenceClaim> {
    vec![]
}

pub fn build_hypotheses(
    _issue: &IssueFullContext,
    _claims: &[EvidenceClaim],
    _related_count: usize,
) -> (Vec<Hypothesis>, Vec<String>, Vec<String>) {
    (vec![], vec![], vec![])
}
