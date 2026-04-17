//! Hadron MCP — Model Context Protocol tool surface.
//!
//! Design: `docs/plans/2026-04-15-mcp-server-design.md`.

pub mod context;
pub mod errors;
pub mod schemas;
pub mod tools;

pub use context::{McpContext, Role};
pub use errors::{McpError, McpResult};
pub use tools::{ToolDescriptor, ToolRegistry};
