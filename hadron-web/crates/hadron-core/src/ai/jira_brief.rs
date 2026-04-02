//! JIRA investigation brief — combines triage + deep analysis.

use serde::{Deserialize, Serialize};

use super::jira_analysis::JiraDeepResult;
use super::jira_triage::JiraTriageResult;

/// Combined result of triage + deep analysis run in parallel.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JiraBriefResult {
    pub triage: JiraTriageResult,
    pub analysis: JiraDeepResult,
}
