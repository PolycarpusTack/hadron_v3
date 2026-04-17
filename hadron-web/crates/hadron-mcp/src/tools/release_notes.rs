use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::context::McpContext;
use crate::errors::McpResult;
use crate::schemas::{GetReleaseNotesInput, ListFixVersionsInput};

use super::{parse, require_non_empty, ToolDescriptor, ToolHandler};

pub struct ListFixVersions;

#[async_trait]
impl ToolHandler for ListFixVersions {
    async fn call(&self, ctx: &dyn McpContext, args: Value) -> McpResult<Value> {
        let input: ListFixVersionsInput = parse(args)?;
        require_non_empty(&input.project_key, "project_key")?;
        let versions = ctx.list_fix_versions(input.project_key.trim()).await?;
        Ok(json!({ "project_key": input.project_key, "versions": versions }))
    }
}

pub struct GetReleaseNotes;

#[async_trait]
impl ToolHandler for GetReleaseNotes {
    async fn call(&self, ctx: &dyn McpContext, args: Value) -> McpResult<Value> {
        let input: GetReleaseNotesInput = parse(args)?;
        if input.fix_version.is_none() && input.note_id.is_none() {
            return Err(crate::McpError::InvalidArguments(
                "one of `fix_version` or `note_id` is required".into(),
            ));
        }
        let record = ctx
            .get_release_notes(input.fix_version.as_deref(), input.note_id)
            .await?;
        match record {
            Some(r) => Ok(serde_json::to_value(r).map_err(crate::McpError::internal)?),
            None => Err(crate::McpError::NotFound),
        }
    }
}

pub fn descriptors() -> Vec<ToolDescriptor> {
    vec![
        ToolDescriptor {
            name: "list_fix_versions",
            description: "List JIRA fix versions available for release-note generation in the given project.",
            handler: Arc::new(ListFixVersions),
        },
        ToolDescriptor {
            name: "get_release_notes",
            description: "Fetch release notes by fix_version (preferred) or note_id. Returns status, content markdown, publication metadata.",
            handler: Arc::new(GetReleaseNotes),
        },
    ]
}
