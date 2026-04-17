# Hadron MCP Server

Hadron exposes an [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) server so external AI agents can query your ticket briefs, Sentry analyses, release notes, and more.

Both **hadron-web** (HTTP) and **hadron-desktop** (stdio) are supported from the same shared tool surface.

## Tools

| Tool | Inputs | Description |
|------|--------|-------------|
| `get_ticket_brief` | `jira_key` | Full investigation brief: triage, root cause, actions, posted-to-JIRA status |
| `search_ticket_briefs` | `query`, `severity?`, `category?`, `limit?` | Text search over ticket briefs with optional severity/category filters |
| `find_similar_tickets` | `jira_key` or `text`, `threshold?`, `limit?` | Cosine-similarity duplicate detection over ticket embeddings |
| `search_sentry_analyses` | `query`, `pattern?`, `limit?` | Search past Sentry deep-analysis records |
| `get_sentry_analysis` | `analysis_id` | Full Sentry analysis: patterns, root cause, recommendations |
| `list_fix_versions` | `project_key` | JIRA fix versions available for a project |
| `get_release_notes` | `fix_version` or `note_id` | Published/approved release notes content |
| `hybrid_search` | `query`, `sources?`, `limit?` | RRF-fused search across briefs, Sentry, and release notes |

All tools are **read-only** (v1). Write tools are planned for v2.

## Hadron Web (HTTP transport)

### Enable

Set the environment variable before starting the server:

```bash
HADRON_MCP_ENABLED=true
```

The endpoint is mounted at `POST /api/mcp` and uses the same JWT authentication as all other API routes.

### Protocol

JSON-RPC 2.0. Supported methods:

- `initialize` — returns server info and capabilities
- `tools/list` — returns all available tools with descriptions
- `tools/call` — invoke a tool by name with arguments

### Example

```bash
curl -X POST https://your-hadron-instance/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_ticket_brief",
      "arguments": { "jira_key": "PROJ-1234" }
    }
  }'
```

### Response format

Tool results follow the MCP content format:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      { "type": "text", "text": "{ ... tool output as pretty JSON ... }" }
    ]
  }
}
```

## Hadron Desktop (stdio transport)

### Binary

The MCP server ships as a separate binary: `hadron-mcp`. It reads from the same SQLite database as the desktop app.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hadron": {
      "command": "C:/Program Files/Hadron/hadron-mcp.exe"
    }
  }
}
```

On macOS/Linux:

```json
{
  "mcpServers": {
    "hadron": {
      "command": "/usr/local/bin/hadron-mcp"
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "hadron": {
      "command": "hadron-mcp"
    }
  }
}
```

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "hadron": {
      "command": "hadron-mcp"
    }
  }
}
```

### Manual testing

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | hadron-mcp
```

## Architecture

```
hadron-mcp (shared crate)
├── McpContext trait          # DB abstraction
├── 8 tool handlers          # Pure logic, no transport
├── schemas.rs               # Input/output types
└── errors.rs                # McpError enum

hadron-server (web)
└── routes/mcp.rs
    ├── WebMcpContext         # PgPool + JWT claims
    └── POST /api/mcp        # JSON-RPC over HTTP

hadron-desktop (desktop)
└── bin/mcp.rs
    ├── DesktopMcpContext     # SQLite (rusqlite)
    └── stdin/stdout          # JSON-RPC over stdio
```

## Limitations (v1)

- **Read-only** — no write tools (post comment, create brief, publish notes). Planned for v2.
- **Desktop Sentry** — returns empty results (desktop stores Sentry data differently than web).
- **Desktop list_fix_versions** — requires JIRA credentials from Tauri store, not available in the standalone MCP binary.
- **No streaming** — tool responses are returned in full, not streamed.
- **Web rate limiting** — inherits the global tower rate limiter; no per-tool limits.

## Environment variables

| Variable | Surface | Default | Description |
|----------|---------|---------|-------------|
| `HADRON_MCP_ENABLED` | Web | `false` | Set to `true` to enable the `/api/mcp` endpoint |
