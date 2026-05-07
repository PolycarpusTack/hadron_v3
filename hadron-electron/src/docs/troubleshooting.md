# Help & Troubleshooting

Quick solutions to common problems in Hadron __VERSION__.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New analysis |
| `Ctrl+H` | Open History |
| `Ctrl+,` | Open Settings |
| `Ctrl+Y` | Open Console Viewer |
| `Alt+H` | Toggle Widget |
| `Esc` | Close current panel/modal |

---

## "All AI providers failed"

**Cause:** Missing or invalid API key, or provider is unreachable.

1. Press `Ctrl+,` to open Settings
2. Re-enter your API key from your provider's dashboard:
   - OpenAI: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   - Anthropic: [console.anthropic.com](https://console.anthropic.com)
3. Select a valid model (e.g., `gpt-4o`, `claude-sonnet-4-5-20250929`)
4. Save and retry

For **llama.cpp**: ensure `llama-server` is running on port 8080.

---

## Comprehensive (WHATS'ON) Analysis Shows Empty Data

1. Wait for the progress bar to reach 100%
2. Check Console (`Ctrl+Y`) for specific errors
3. Retry — AI responses can vary between calls
4. Try a different provider or model

---

## "Python script not found in bundle"

Core features (parsing, AI analysis, JIRA, Sentry) work without Python. Python is only needed for Translation and RAG features. Reinstall if you need those features.

---

## Application Doesn't Start

1. **Check requirements:** Windows 10/11, macOS 10.15+, 4GB RAM
2. **Reset configuration:**
   - Windows: Delete `%APPDATA%/com.hadron.desktop/`
   - macOS: Delete `~/Library/Application Support/com.hadron.desktop/`
   - Linux: Delete `~/.local/share/com.hadron.desktop/`
3. Restart Hadron

---

## History Not Loading

1. Go to Settings > Database Administration
2. Click **Verify Database**
3. If errors found, click **Repair Database**

---

## JIRA Integration Not Working

1. Verify Settings > JIRA Integration:
   - **URL**: Must include `https://` (e.g., `https://yourcompany.atlassian.net`)
   - **Email**: Your Atlassian account email
   - **API Token**: From [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Test Connection** — should show "Connected successfully"

---

## Sentry Integration Not Working

1. Verify Settings > Sentry Integration:
   - **Base URL**: `https://sentry.io` or your self-hosted instance
   - **Auth Token**: Must have `project:read` and `event:read` scopes
   - **Organization** and **Project** slugs must match exactly
2. Click **Test Connection**

---

## Keeper Integration Not Working

1. Verify Settings > Keeper Integration:
   - **One-Time Access Token**: Must include region prefix (e.g., `US:xxxx`)
   - Token is single-use — generate a new one if it fails
2. Click **Test Connection**

---

## Ask Hadron Not Responding

1. Ensure an AI provider is configured and working (test with a crash analysis first)
2. Check Console (`Ctrl+Y`) for error details
3. The agent runs up to 8 tool-calling iterations — complex queries take longer
4. If stuck, start a **New Chat** and rephrase the question

---

## Widget Not Appearing

1. Check Settings > Hover Button is **enabled**
2. The widget may be off-screen — reset position: close Hadron, delete localStorage, reopen
3. Try the `Alt+H` hotkey to toggle visibility

---

## Slow Performance

1. **Reduce History Size** — Settings > Cleanup Old Records
2. **Use Quick Analysis** for initial triage
3. Large crash logs (>1MB) are automatically truncated
4. Run **Settings > Database Administration > Compact Database** periodically

---

## Export Issues

| Format | Use Case |
|--------|----------|
| **Markdown** | Documentation, wikis, GitHub issues |
| **HTML** | Browser viewing, email sharing |
| **Interactive HTML** | Collapsible sections, self-contained reports |
| **JSON** | Integrations, automation pipelines |
| **TXT** | Plain text for email/chat |
| **XLSX** | Spreadsheets, management reporting |

---

## Console Viewer

Press `Ctrl+Y` to see detailed logs:
- API requests and responses
- Parsing progress and errors
- AI token usage and cost estimates
- Tool execution details (Ask Hadron)
- Retrieval diagnostics (RAG + KB)

---

## Database & Log Locations

| Data | Windows | macOS | Linux |
|------|---------|-------|-------|
| Database | `%APPDATA%/com.hadron.desktop/analysis.db` | `~/Library/Application Support/com.hadron.desktop/analysis.db` | `~/.local/share/com.hadron.desktop/analysis.db` |
| Logs | `%APPDATA%/com.hadron.desktop/logs/` | `~/Library/Logs/com.hadron.desktop/` | `~/.local/share/com.hadron.desktop/logs/` |

---

## Report a Bug

Include: Hadron version (shown in header), OS, steps to reproduce, and Console logs (`Ctrl+Y`).
