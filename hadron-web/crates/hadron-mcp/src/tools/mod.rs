//! Tool registry and shared helpers.

use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::context::McpContext;
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
}
