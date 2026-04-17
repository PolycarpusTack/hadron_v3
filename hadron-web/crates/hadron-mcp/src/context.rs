use async_trait::async_trait;
use uuid::Uuid;

use crate::errors::McpResult;
use crate::schemas::{
    ReleaseNoteRecord, SentryAnalysisRecord, SimilarTicketRecord, TicketBriefRecord,
};

/// User role — matches `hadron-core` semantics (analyst < lead < admin).
/// Desktop contexts always return `Admin`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Analyst,
    Lead,
    Admin,
}

/// Context passed to every MCP tool invocation.
///
/// Implementations:
///   - `hadron-server` → `WebMcpContext` (Postgres + JWT claims)
///   - `hadron-desktop` → `DesktopMcpContext` (SQLite + local identity)
#[async_trait]
pub trait McpContext: Send + Sync {
    fn user_id(&self) -> Option<Uuid>;
    fn role(&self) -> Role;

    // --- Ticket briefs / embeddings ---

    async fn get_ticket_brief(&self, jira_key: &str) -> McpResult<Option<TicketBriefRecord>>;

    async fn search_ticket_briefs(
        &self,
        query: &str,
        severity: Option<&str>,
        category: Option<&str>,
        limit: usize,
    ) -> McpResult<Vec<TicketBriefRecord>>;

    async fn find_similar_tickets(
        &self,
        jira_key: Option<&str>,
        text: Option<&str>,
        threshold: f32,
        limit: usize,
    ) -> McpResult<Vec<SimilarTicketRecord>>;

    // --- Sentry ---

    async fn search_sentry_analyses(
        &self,
        query: &str,
        pattern: Option<&str>,
        limit: usize,
    ) -> McpResult<Vec<SentryAnalysisRecord>>;

    async fn get_sentry_analysis(&self, id: i64) -> McpResult<Option<SentryAnalysisRecord>>;

    // --- Release notes ---

    async fn list_fix_versions(&self, project_key: &str) -> McpResult<Vec<String>>;

    async fn get_release_notes(
        &self,
        fix_version: Option<&str>,
        note_id: Option<i64>,
    ) -> McpResult<Option<ReleaseNoteRecord>>;

    // --- Hybrid search ---

    async fn hybrid_search(
        &self,
        query: &str,
        sources: &[&str],
        limit: usize,
    ) -> McpResult<serde_json::Value>;
}
