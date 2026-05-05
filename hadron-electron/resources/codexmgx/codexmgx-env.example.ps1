# Safe template used by the personal install script.
# The installer writes the per-user config to:
# - $HOME\.codex\plugins\codexmgx-plugin\codexmgx-env.ps1
# - $HOME\.codex\codexmgx-env.ps1
#
# Or point the launcher at a custom file with:
# - $env:ATLASSIAN_PLUGIN_ENV_FILE = "C:\path\to\codexmgx-env.ps1"
# - $env:CODEXMGX_PLUGIN_ENV_FILE = "C:\path\to\codexmgx-env.ps1"
#
# The repo-local path still works for local development:
# - CodexMgX plugin\config\codexmgx-env.ps1

# Default Jira source for this bridge.
$env:JIRA_DEFAULT_SOURCE = "cloud"

# Jira Cloud source.
# Example base URL: https://your-company.atlassian.net
$env:JIRA_CLOUD_BASE_URL = ""
$env:JIRA_CLOUD_EMAIL = ""
$env:JIRA_API_TOKEN = ""

# Create/manage this token at:
# https://id.atlassian.com/manage-profile/security/api-tokens

# Optional Confluence override.
# Leave these commented if Confluence uses the same tenant and token as Jira Cloud.
# $env:CONFLUENCE_CLOUD_BASE_URL = $env:JIRA_CLOUD_BASE_URL
# $env:CONFLUENCE_CLOUD_EMAIL = $env:JIRA_CLOUD_EMAIL
# $env:CONFLUENCE_CLOUD_API_TOKEN = $env:JIRA_API_TOKEN

# Optional MOD documentation override.
# Leave these commented to use the Mediagenix On-Demand defaults.
# $env:MOD_DOCS_HOMEPAGE_ID = "1888060283"
# $env:MOD_DOCS_SPACE_PATH = "modkb"

# Optional WHATS'ON Knowledge Base override.
# Leave this commented to use the default hosted documentation.
# $env:WHATSON_KB_BASE_URL = "https://whatsonknowledgebase.mediagenix.tv/latest_version/"
