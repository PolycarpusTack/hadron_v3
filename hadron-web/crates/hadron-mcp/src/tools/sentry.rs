use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::context::{McpContext, Role};
use crate::errors::McpResult;
use crate::schemas::{GetSentryAnalysisInput, SearchSentryInput};

use super::{clamp_limit, parse, require_non_empty, ToolDescriptor, ToolHandler};

pub struct SearchSentryAnalyses;

#[async_trait]
impl ToolHandler for SearchSentryAnalyses {
    async fn call(&self, ctx: &dyn McpContext, args: Value) -> McpResult<Value> {
        let input: SearchSentryInput = parse(args)?;
        require_non_empty(&input.query, "query")?;
        let limit = clamp_limit(input.limit);
        let results = ctx
            .search_sentry_analyses(&input.query, input.pattern.as_deref(), limit)
            .await?;
        let count = results.len();
        Ok(json!({ "results": results, "count": count }))
    }
}

pub struct GetSentryAnalysis;

#[async_trait]
impl ToolHandler for GetSentryAnalysis {
    async fn call(&self, ctx: &dyn McpContext, args: Value) -> McpResult<Value> {
        let input: GetSentryAnalysisInput = parse(args)?;
        let record = ctx.get_sentry_analysis(input.analysis_id).await?;
        match record {
            Some(r) => Ok(serde_json::to_value(r).map_err(crate::McpError::internal)?),
            None => Err(crate::McpError::NotFound),
        }
    }
}

pub fn descriptors() -> Vec<ToolDescriptor> {
    vec![
        ToolDescriptor {
            name: "search_sentry_analyses",
            description: "Search past Sentry deep-analysis records by free text, optionally filtered by a detected pattern (e.g. `deadlock`, `n_plus_one`, `memory_leak`).",
            required_role: Role::Analyst,
            handler: Arc::new(SearchSentryAnalyses),
        },
        ToolDescriptor {
            name: "get_sentry_analysis",
            description: "Fetch a full Sentry analysis by id: normalized event, detected patterns, root cause, recommendations.",
            required_role: Role::Analyst,
            handler: Arc::new(GetSentryAnalysis),
        },
    ]
}
