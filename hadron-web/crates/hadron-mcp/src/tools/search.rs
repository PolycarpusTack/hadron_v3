use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::context::McpContext;
use crate::errors::McpResult;
use crate::schemas::HybridSearchInput;

use super::{clamp_limit, parse, require_non_empty, ToolDescriptor, ToolHandler};

pub struct HybridSearch;

#[async_trait]
impl ToolHandler for HybridSearch {
    async fn call(&self, ctx: &dyn McpContext, args: Value) -> McpResult<Value> {
        let input: HybridSearchInput = parse(args)?;
        require_non_empty(&input.query, "query")?;
        let limit = clamp_limit(input.limit);
        let refs: Vec<&str> = input.sources.iter().map(|s| s.as_str()).collect();
        ctx.hybrid_search(&input.query, &refs, limit).await
    }
}

pub fn descriptors() -> Vec<ToolDescriptor> {
    vec![ToolDescriptor {
        name: "hybrid_search",
        description: "RRF-fused search across Hadron sources (ticket briefs, Sentry analyses, release notes). Sources default to all three; pass `sources: [...]` to narrow.",
        handler: Arc::new(HybridSearch),
    }]
}
