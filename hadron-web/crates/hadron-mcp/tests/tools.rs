//! Integration tests for the MCP tool registry + MockContext.

use async_trait::async_trait;
use chrono::Utc;
use serde_json::{json, Value};
use uuid::Uuid;

use hadron_mcp::{
    context::Role,
    errors::{McpError, McpResult},
    schemas::{
        ReleaseNoteRecord, SentryAnalysisRecord, SimilarTicketRecord, TicketBriefRecord,
    },
    tools::default_registry,
    McpContext,
};

#[derive(Default)]
struct MockContext {
    user: Option<Uuid>,
}

#[async_trait]
impl McpContext for MockContext {
    fn user_id(&self) -> Option<Uuid> {
        self.user
    }
    fn role(&self) -> Role {
        Role::Admin
    }

    async fn get_ticket_brief(&self, jira_key: &str) -> McpResult<Option<TicketBriefRecord>> {
        if jira_key == "PROJ-404" {
            return Ok(None);
        }
        Ok(Some(TicketBriefRecord {
            jira_key: jira_key.into(),
            summary: Some("mock summary".into()),
            severity: Some("high".into()),
            category: Some("bug".into()),
            tags: vec!["mock".into()],
            customer_impact: None,
            brief_json: Some(json!({"root_cause": "mock"})),
            posted_to_jira_at: None,
            updated_at: Utc::now(),
        }))
    }

    async fn search_ticket_briefs(
        &self,
        _q: &str,
        sev: Option<&str>,
        cat: Option<&str>,
        limit: usize,
    ) -> McpResult<Vec<TicketBriefRecord>> {
        let mut results: Vec<TicketBriefRecord> = (0..limit.min(3))
            .map(|i| TicketBriefRecord {
                jira_key: format!("PROJ-{}", i),
                summary: Some(format!("result {}", i)),
                severity: Some("medium".into()),
                category: Some("bug".into()),
                tags: vec![],
                customer_impact: None,
                brief_json: None,
                posted_to_jira_at: None,
                updated_at: Utc::now(),
            })
            .collect();
        // Honor severity/category filters in mock
        if let Some(s) = sev {
            results.retain(|r| r.severity.as_deref() == Some(s));
        }
        if let Some(c) = cat {
            results.retain(|r| r.category.as_deref() == Some(c));
        }
        Ok(results)
    }

    async fn find_similar_tickets(
        &self,
        jira_key: Option<&str>,
        text: Option<&str>,
        _threshold: f32,
        limit: usize,
    ) -> McpResult<Vec<SimilarTicketRecord>> {
        assert!(jira_key.is_some() || text.is_some());
        Ok((0..limit.min(1))
            .map(|_| SimilarTicketRecord {
                jira_key: "PROJ-999".into(),
                summary: Some("similar".into()),
                severity: Some("low".into()),
                category: None,
                similarity: 0.87,
            })
            .collect())
    }

    async fn search_sentry_analyses(
        &self,
        _q: &str,
        _p: Option<&str>,
        limit: usize,
    ) -> McpResult<Vec<SentryAnalysisRecord>> {
        Ok((0..limit.min(1))
            .map(|_| SentryAnalysisRecord {
                id: 42,
                issue_id: Some("issue-1".into()),
                title: Some("Deadlock".into()),
                patterns: vec!["deadlock".into()],
                summary: Some("mock".into()),
                created_at: Utc::now(),
                payload: None,
            })
            .collect())
    }

    async fn get_sentry_analysis(&self, id: i64) -> McpResult<Option<SentryAnalysisRecord>> {
        if id == 0 {
            return Ok(None);
        }
        Ok(Some(SentryAnalysisRecord {
            id,
            issue_id: Some("issue-1".into()),
            title: Some("Deadlock".into()),
            patterns: vec!["deadlock".into()],
            summary: Some("mock".into()),
            created_at: Utc::now(),
            payload: Some(json!({"recommendations": []})),
        }))
    }

    async fn list_fix_versions(&self, _p: &str) -> McpResult<Vec<String>> {
        Ok(vec!["4.4.0".into(), "4.4.1".into()])
    }

    async fn get_release_notes(
        &self,
        fix_version: Option<&str>,
        note_id: Option<i64>,
    ) -> McpResult<Option<ReleaseNoteRecord>> {
        assert!(fix_version.is_some() || note_id.is_some());
        Ok(Some(ReleaseNoteRecord {
            id: note_id.unwrap_or(1),
            fix_version: fix_version.map(str::to_string),
            title: Some("Release 4.4.0".into()),
            status: "published".into(),
            content_markdown: Some("# 4.4.0".into()),
            published_at: Some(Utc::now()),
            updated_at: Utc::now(),
        }))
    }

    async fn hybrid_search(
        &self,
        query: &str,
        sources: &[&str],
        limit: usize,
    ) -> McpResult<Value> {
        Ok(json!({
            "query": query,
            "sources": sources,
            "limit": limit,
            "results": [],
        }))
    }
}

// ============================================================================
// Registry
// ============================================================================

#[tokio::test]
async fn registry_exposes_exactly_eight_tools() {
    let reg = default_registry();
    assert_eq!(reg.names().count(), 8);
}

// ============================================================================
// Ticket briefs
// ============================================================================

#[tokio::test]
async fn get_ticket_brief_returns_record() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let out = reg
        .call("get_ticket_brief", &ctx, json!({ "jira_key": "PROJ-1" }))
        .await
        .unwrap();
    assert_eq!(out["jira_key"], "PROJ-1");
    assert_eq!(out["severity"], "high");
}

#[tokio::test]
async fn get_ticket_brief_missing_is_not_found() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let err = reg
        .call("get_ticket_brief", &ctx, json!({ "jira_key": "PROJ-404" }))
        .await
        .unwrap_err();
    assert!(matches!(err, McpError::NotFound));
}

#[tokio::test]
async fn get_ticket_brief_empty_key_rejected() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let err = reg
        .call("get_ticket_brief", &ctx, json!({ "jira_key": "" }))
        .await
        .unwrap_err();
    assert!(matches!(err, McpError::InvalidArguments(_)));
}

#[tokio::test]
async fn search_ticket_briefs_returns_count_and_results() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let out = reg
        .call(
            "search_ticket_briefs",
            &ctx,
            json!({ "query": "crash", "limit": 5 }),
        )
        .await
        .unwrap();
    assert_eq!(out["count"], 3);
    assert!(out["results"].is_array());
}

#[tokio::test]
async fn search_ticket_briefs_with_filters() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let out = reg
        .call(
            "search_ticket_briefs",
            &ctx,
            json!({ "query": "crash", "severity": "medium", "category": "bug" }),
        )
        .await
        .unwrap();
    assert!(out["count"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn search_ticket_briefs_empty_query_rejected() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let err = reg
        .call("search_ticket_briefs", &ctx, json!({ "query": "" }))
        .await
        .unwrap_err();
    assert!(matches!(err, McpError::InvalidArguments(_)));
}

#[tokio::test]
async fn search_ticket_briefs_limit_clamped() {
    let reg = default_registry();
    let ctx = MockContext::default();
    // limit=999 should be clamped to MAX_LIMIT (100), mock returns min(limit, 3) = 3
    let out = reg
        .call(
            "search_ticket_briefs",
            &ctx,
            json!({ "query": "x", "limit": 999 }),
        )
        .await
        .unwrap();
    assert!(out["count"].as_u64().unwrap() <= 100);
}

// ============================================================================
// Similar tickets
// ============================================================================

#[tokio::test]
async fn find_similar_requires_key_or_text() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let err = reg
        .call("find_similar_tickets", &ctx, json!({}))
        .await
        .unwrap_err();
    assert!(matches!(err, McpError::InvalidArguments(_)));
}

#[tokio::test]
async fn find_similar_by_text_works() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let out = reg
        .call(
            "find_similar_tickets",
            &ctx,
            json!({ "text": "null pointer on login", "limit": 3 }),
        )
        .await
        .unwrap();
    assert_eq!(out["count"], 1);
}

#[tokio::test]
async fn find_similar_by_key_works() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let out = reg
        .call(
            "find_similar_tickets",
            &ctx,
            json!({ "jira_key": "PROJ-1" }),
        )
        .await
        .unwrap();
    assert_eq!(out["count"], 1);
}

#[tokio::test]
async fn find_similar_invalid_threshold_rejected() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let err = reg
        .call(
            "find_similar_tickets",
            &ctx,
            json!({ "jira_key": "PROJ-1", "threshold": -0.5 }),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, McpError::InvalidArguments(_)));
}

// ============================================================================
// Sentry
// ============================================================================

#[tokio::test]
async fn sentry_search_works() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let list = reg
        .call(
            "search_sentry_analyses",
            &ctx,
            json!({ "query": "deadlock", "limit": 5 }),
        )
        .await
        .unwrap();
    assert_eq!(list["count"], 1);
}

#[tokio::test]
async fn sentry_get_returns_matching_id() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let get = reg
        .call("get_sentry_analysis", &ctx, json!({ "analysis_id": 42 }))
        .await
        .unwrap();
    assert_eq!(get["id"], 42);
}

#[tokio::test]
async fn sentry_get_zero_id_not_found() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let err = reg
        .call("get_sentry_analysis", &ctx, json!({ "analysis_id": 0 }))
        .await
        .unwrap_err();
    assert!(matches!(err, McpError::NotFound));
}

// ============================================================================
// Release notes
// ============================================================================

#[tokio::test]
async fn release_notes_by_version() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let notes = reg
        .call(
            "get_release_notes",
            &ctx,
            json!({ "fix_version": "4.4.0" }),
        )
        .await
        .unwrap();
    assert_eq!(notes["fix_version"], "4.4.0");
}

#[tokio::test]
async fn release_notes_by_id() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let notes = reg
        .call("get_release_notes", &ctx, json!({ "note_id": 7 }))
        .await
        .unwrap();
    assert_eq!(notes["id"], 7);
}

#[tokio::test]
async fn release_notes_requires_version_or_id() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let err = reg
        .call("get_release_notes", &ctx, json!({}))
        .await
        .unwrap_err();
    assert!(matches!(err, McpError::InvalidArguments(_)));
}

#[tokio::test]
async fn list_fix_versions_works() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let versions = reg
        .call("list_fix_versions", &ctx, json!({ "project_key": "PROJ" }))
        .await
        .unwrap();
    assert_eq!(versions["versions"].as_array().unwrap().len(), 2);
}

// ============================================================================
// Hybrid search
// ============================================================================

#[tokio::test]
async fn hybrid_search_defaults_all_sources() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let out = reg
        .call("hybrid_search", &ctx, json!({ "query": "timeout" }))
        .await
        .unwrap();
    assert_eq!(out["sources"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn hybrid_search_empty_query_rejected() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let err = reg
        .call("hybrid_search", &ctx, json!({ "query": "  " }))
        .await
        .unwrap_err();
    assert!(matches!(err, McpError::InvalidArguments(_)));
}

// ============================================================================
// Error paths
// ============================================================================

#[tokio::test]
async fn unknown_tool_errors() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let err = reg.call("no_such_tool", &ctx, json!({})).await.unwrap_err();
    assert!(matches!(err, McpError::ToolNotFound(_)));
}

#[tokio::test]
async fn invalid_args_rejected() {
    let reg = default_registry();
    let ctx = MockContext::default();
    let err = reg
        .call("get_ticket_brief", &ctx, json!({ "wrong": "shape" }))
        .await
        .unwrap_err();
    assert!(matches!(err, McpError::InvalidArguments(_)));
}

// ============================================================================
// McpError methods
// ============================================================================

#[tokio::test]
async fn error_client_message_sanitizes() {
    let err = McpError::Internal("SELECT * FROM secret_table".into());
    assert_eq!(err.client_message(), "Internal server error");
    assert_eq!(err.jsonrpc_code(), -32603);
}
