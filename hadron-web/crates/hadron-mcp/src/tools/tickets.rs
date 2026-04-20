use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::context::{McpContext, Role};
use crate::errors::McpResult;
use crate::schemas::{FindSimilarTicketsInput, GetTicketBriefInput, SearchTicketBriefsInput};

use super::{clamp_limit, parse, require_non_empty, validate_threshold, ToolDescriptor, ToolHandler};

pub struct GetTicketBrief;

#[async_trait]
impl ToolHandler for GetTicketBrief {
    async fn call(&self, ctx: &dyn McpContext, args: Value) -> McpResult<Value> {
        let input: GetTicketBriefInput = parse(args)?;
        require_non_empty(&input.jira_key, "jira_key")?;
        let brief = ctx.get_ticket_brief(input.jira_key.trim()).await?;
        match brief {
            Some(b) => Ok(serde_json::to_value(b).map_err(crate::McpError::internal)?),
            None => Err(crate::McpError::NotFound),
        }
    }
}

pub struct SearchTicketBriefs;

#[async_trait]
impl ToolHandler for SearchTicketBriefs {
    async fn call(&self, ctx: &dyn McpContext, args: Value) -> McpResult<Value> {
        let input: SearchTicketBriefsInput = parse(args)?;
        require_non_empty(&input.query, "query")?;
        let limit = clamp_limit(input.limit);
        let results = ctx
            .search_ticket_briefs(
                &input.query,
                input.severity.as_deref(),
                input.category.as_deref(),
                limit,
            )
            .await?;
        let count = results.len();
        Ok(json!({ "results": results, "count": count }))
    }
}

pub struct FindSimilarTickets;

#[async_trait]
impl ToolHandler for FindSimilarTickets {
    async fn call(&self, ctx: &dyn McpContext, args: Value) -> McpResult<Value> {
        let input: FindSimilarTicketsInput = parse(args)?;
        if input.jira_key.is_none() && input.text.is_none() {
            return Err(crate::McpError::InvalidArguments(
                "one of `jira_key` or `text` is required".into(),
            ));
        }
        validate_threshold(input.threshold)?;
        let limit = clamp_limit(input.limit);
        let results = ctx
            .find_similar_tickets(
                input.jira_key.as_deref(),
                input.text.as_deref(),
                input.threshold,
                limit,
            )
            .await?;
        let count = results.len();
        Ok(json!({ "results": results, "count": count }))
    }
}

pub fn descriptors() -> Vec<ToolDescriptor> {
    vec![
        ToolDescriptor {
            name: "get_ticket_brief",
            description: "Fetch the full investigation brief for a JIRA key (triage, root cause, actions, similar tickets, posted-to-jira status).",
            required_role: Role::Analyst,
            handler: Arc::new(GetTicketBrief),
        },
        ToolDescriptor {
            name: "search_ticket_briefs",
            description: "Semantic search over Hadron ticket briefs. Optional filters: severity, category. Returns ranked matches with triage metadata.",
            required_role: Role::Analyst,
            handler: Arc::new(SearchTicketBriefs),
        },
        ToolDescriptor {
            name: "find_similar_tickets",
            description: "Duplicate/neighbour detection via cosine similarity over ticket embeddings. Supply either `jira_key` (use that ticket's embedding) or `text` (embed on the fly).",
            required_role: Role::Analyst,
            handler: Arc::new(FindSimilarTickets),
        },
    ]
}
