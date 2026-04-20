//! Tool registry and shared helpers.

use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::context::{McpContext, Role};
use crate::errors::{McpError, McpResult};
use crate::schemas::MAX_LIMIT;

pub mod release_notes;
pub mod search;
pub mod sentry;
pub mod tickets;

/// Deserialize JSON args into a typed input struct.
pub(crate) fn parse<T: for<'de> serde::Deserialize<'de>>(args: Value) -> McpResult<T> {
    serde_json::from_value(args).map_err(|e| McpError::InvalidArguments(e.to_string()))
}

/// Clamp a caller-supplied limit to MAX_LIMIT.
pub(crate) fn clamp_limit(limit: usize) -> usize {
    limit.min(MAX_LIMIT)
}

/// Validate a string is non-empty after trimming.
pub(crate) fn require_non_empty(value: &str, field: &str) -> McpResult<()> {
    if value.trim().is_empty() {
        Err(McpError::InvalidArguments(format!(
            "`{field}` must not be empty"
        )))
    } else {
        Ok(())
    }
}

/// Validate threshold is in [0.0, 1.0] and not NaN.
pub(crate) fn validate_threshold(t: f32) -> McpResult<()> {
    if t.is_nan() || !(0.0..=1.0).contains(&t) {
        Err(McpError::InvalidArguments(
            "`threshold` must be between 0.0 and 1.0".into(),
        ))
    } else {
        Ok(())
    }
}

#[async_trait]
pub trait ToolHandler: Send + Sync {
    async fn call(&self, ctx: &dyn McpContext, args: Value) -> McpResult<Value>;
}

pub struct ToolDescriptor {
    pub name: &'static str,
    pub description: &'static str,
    /// Minimum role required to call this tool.
    ///
    /// Compared with `ctx.role()` using `>=` (Admin > Lead > Analyst).
    /// Today every tool is read-only at Analyst, but any future write or
    /// privileged tool must raise this to `Lead` or `Admin` so the
    /// authorization decision lives next to the tool, not in a distant
    /// handler.
    pub required_role: Role,
    pub handler: Arc<dyn ToolHandler>,
}

#[derive(Default)]
pub struct ToolRegistry {
    tools: BTreeMap<&'static str, ToolDescriptor>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, descriptor: ToolDescriptor) {
        self.tools.insert(descriptor.name, descriptor);
    }

    pub fn names(&self) -> impl Iterator<Item = &'static str> + '_ {
        self.tools.keys().copied()
    }

    pub fn get(&self, name: &str) -> Option<&ToolDescriptor> {
        self.tools.get(name)
    }

    pub async fn call(
        &self,
        name: &str,
        ctx: &dyn McpContext,
        args: Value,
    ) -> McpResult<Value> {
        let desc = self
            .get(name)
            .ok_or_else(|| McpError::ToolNotFound(name.to_string()))?;
        // F5 (2026-04-20 audit): enforce the tool's declared minimum role
        // before dispatching. Prior to this the only gate was "valid JWT",
        // so any analyst could call every tool regardless of the tool's
        // sensitivity. Keeping the check here (not in each handler) means
        // a new tool with the wrong role declared still lands behind a
        // gate — fail-closed.
        if ctx.role() < desc.required_role {
            return Err(McpError::Forbidden);
        }
        desc.handler.call(ctx, args).await
    }
}

/// Build the default registry for the v1 tool surface — 8 read-only tools.
pub fn default_registry() -> ToolRegistry {
    let mut reg = ToolRegistry::new();
    for d in tickets::descriptors() {
        reg.register(d);
    }
    for d in sentry::descriptors() {
        reg.register(d);
    }
    for d in release_notes::descriptors() {
        reg.register(d);
    }
    for d in search::descriptors() {
        reg.register(d);
    }
    reg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_registry_has_v1_tools() {
        let reg = default_registry();
        let names: Vec<_> = reg.names().collect();
        for expected in [
            "get_ticket_brief",
            "search_ticket_briefs",
            "find_similar_tickets",
            "search_sentry_analyses",
            "get_sentry_analysis",
            "list_fix_versions",
            "get_release_notes",
            "hybrid_search",
        ] {
            assert!(names.contains(&expected), "missing tool: {expected}");
        }
        assert_eq!(names.len(), 8);
    }

    #[test]
    fn clamp_limit_caps_at_max() {
        assert_eq!(clamp_limit(5), 5);
        assert_eq!(clamp_limit(100), 100);
        assert_eq!(clamp_limit(999), MAX_LIMIT);
    }

    #[test]
    fn require_non_empty_rejects_blanks() {
        assert!(require_non_empty("ok", "x").is_ok());
        assert!(require_non_empty("", "x").is_err());
        assert!(require_non_empty("  ", "x").is_err());
    }

    #[test]
    fn validate_threshold_rejects_invalid() {
        assert!(validate_threshold(0.5).is_ok());
        assert!(validate_threshold(0.0).is_ok());
        assert!(validate_threshold(1.0).is_ok());
        assert!(validate_threshold(-0.1).is_err());
        assert!(validate_threshold(1.1).is_err());
        assert!(validate_threshold(f32::NAN).is_err());
    }

    #[test]
    fn role_ordering_matches_privilege() {
        assert!(Role::Analyst < Role::Lead);
        assert!(Role::Lead < Role::Admin);
        assert!(Role::Admin >= Role::Analyst);
    }

    /// Minimal context that returns a fixed role. Used below to verify the
    /// registry enforces required_role before dispatching to the handler.
    struct StubCtx {
        role: Role,
    }

    #[async_trait]
    impl McpContext for StubCtx {
        fn user_id(&self) -> Option<uuid::Uuid> {
            None
        }
        fn role(&self) -> Role {
            self.role
        }
        async fn get_ticket_brief(
            &self,
            _jira_key: &str,
        ) -> McpResult<Option<crate::schemas::TicketBriefRecord>> {
            Ok(None)
        }
        async fn search_ticket_briefs(
            &self,
            _query: &str,
            _severity: Option<&str>,
            _category: Option<&str>,
            _limit: usize,
        ) -> McpResult<Vec<crate::schemas::TicketBriefRecord>> {
            Ok(vec![])
        }
        async fn find_similar_tickets(
            &self,
            _jira_key: Option<&str>,
            _text: Option<&str>,
            _threshold: f32,
            _limit: usize,
        ) -> McpResult<Vec<crate::schemas::SimilarTicketRecord>> {
            Ok(vec![])
        }
        async fn search_sentry_analyses(
            &self,
            _query: &str,
            _pattern: Option<&str>,
            _limit: usize,
        ) -> McpResult<Vec<crate::schemas::SentryAnalysisRecord>> {
            Ok(vec![])
        }
        async fn get_sentry_analysis(
            &self,
            _id: i64,
        ) -> McpResult<Option<crate::schemas::SentryAnalysisRecord>> {
            Ok(None)
        }
        async fn list_fix_versions(&self, _project_key: &str) -> McpResult<Vec<String>> {
            Ok(vec![])
        }
        async fn get_release_notes(
            &self,
            _fix_version: Option<&str>,
            _note_id: Option<i64>,
        ) -> McpResult<Option<crate::schemas::ReleaseNoteRecord>> {
            Ok(None)
        }
        async fn hybrid_search(
            &self,
            _query: &str,
            _sources: &[&str],
            _limit: usize,
        ) -> McpResult<Value> {
            Ok(Value::Null)
        }
    }

    struct SensitiveHandler;
    #[async_trait]
    impl ToolHandler for SensitiveHandler {
        async fn call(&self, _ctx: &dyn McpContext, _args: Value) -> McpResult<Value> {
            // If registry.call reaches this, enforcement failed.
            Ok(serde_json::json!({ "ran": true }))
        }
    }

    fn registry_with_admin_tool() -> ToolRegistry {
        let mut reg = ToolRegistry::new();
        reg.register(ToolDescriptor {
            name: "privileged_tool",
            description: "test-only",
            required_role: Role::Admin,
            handler: Arc::new(SensitiveHandler),
        });
        reg
    }

    #[tokio::test]
    async fn registry_rejects_when_role_below_required() {
        let reg = registry_with_admin_tool();
        let ctx = StubCtx { role: Role::Analyst };
        let res = reg.call("privileged_tool", &ctx, serde_json::json!({})).await;
        assert!(matches!(res, Err(McpError::Forbidden)));
    }

    #[tokio::test]
    async fn registry_allows_when_role_meets_required() {
        let reg = registry_with_admin_tool();
        let ctx = StubCtx { role: Role::Admin };
        let res = reg.call("privileged_tool", &ctx, serde_json::json!({})).await;
        assert!(res.is_ok());
    }
}
