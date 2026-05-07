# API Reference

All backend functionality is exposed as Tauri commands, invoked from the frontend via `invoke("command_name", { params })`.

---

## Analysis & CRUD

| Command | Inputs | Returns |
|---------|--------|---------|
| `analyze_crash_log` | file_path, api_key, model, provider, analysis_type, verbosity, redact_pii | `Analysis` |
| `analyze_jira_ticket` | JiraTicketAnalyzeRequest | `Analysis` |
| `save_external_analysis` | ExternalAnalysisRequest | `Analysis` |
| `get_all_analyses` | — | `Vec<Analysis>` |
| `get_analyses_paginated` | limit?, offset? | `Vec<Analysis>` |
| `get_analysis_by_id` | id | `Analysis` |
| `get_analyses_count` | — | `i64` |
| `delete_analysis` | id | `()` |
| `toggle_favorite` | id | `bool` |
| `get_favorites` | — | `Vec<Analysis>` |
| `get_recent` | limit | `Vec<Analysis>` |
| `search_analyses` | query, severity_filter? | `Vec<Analysis>` |
| `get_analyses_filtered` | query, date_from?, date_to?, severity?, type?, component? | `Vec<Analysis>` |
| `get_database_statistics` | — | `DatabaseStatistics` |

---

## Tags

| Command | Inputs | Returns |
|---------|--------|---------|
| `create_tag` | name, color | `Tag` |
| `update_tag` | id, name?, color? | `Tag` |
| `delete_tag` | id | `()` |
| `get_all_tags` | — | `Vec<Tag>` |
| `add_tag_to_analysis` | analysis_id, tag_id | `()` |
| `remove_tag_from_analysis` | analysis_id, tag_id | `()` |
| `auto_tag_analyses` | — | `{ tagged, skipped }` |

---

## Ask Hadron (Chat)

| Command | Inputs | Returns |
|---------|--------|---------|
| `chat_send` | messages, options (useRag, useKb, requestId, verbosity) | `String` |
| `chat_save_session` | ChatSession | `i64` |
| `chat_list_sessions` | — | `Vec<ChatSession>` |
| `chat_get_messages` | session_id | `Vec<ChatMessage>` |
| `chat_delete_session` | session_id | `()` |
| `chat_submit_feedback` | session_id, message_id, type, reason? | `()` |

### Chat Tools (22)

The AI agent can invoke these tools during conversation:

| Tool | Purpose |
|------|---------|
| `search_analyses` | Full-text search past crash analyses |
| `search_kb` | Semantic search the knowledge base |
| `search_jira` | JQL search for JIRA issues |
| `create_jira_ticket` | Create a new JIRA issue |
| `find_similar_crashes` | Find analyses with similar error signatures |
| `get_analysis_detail` | Load full analysis by ID |
| `get_trend_data` | Error trends over a time period |
| `get_top_error_patterns` | Most frequent crash patterns |
| `get_crash_signatures` | Signature deduplication data |
| `search_release_notes` | Search generated release notes |
| `get_gold_answers` | Retrieve verified Q&A pairs |
| `search_sentry_issues` | Search Sentry issues |
| `get_database_stats` | Database statistics |
| `calculate` | Evaluate math expressions |
| `get_current_date` | Return current date/time |
| `investigate_jira_ticket` | Deep-investigate a ticket: full changelog, comments, worklogs, related issues, Confluence docs, attachment text, hypotheses, and open questions |
| `investigate_regression_family` | Find historical sibling and predecessor issues — same project (90 days) and cross-project (6 months) |
| `investigate_expected_behavior` | Search Confluence and MOD documentation to establish what the correct behavior should be |
| `investigate_customer_history` | Profile the reporting customer by pulling their full issue history and surfacing patterns |
| `search_confluence` | Full-text search across Confluence spaces |
| `get_confluence_page` | Fetch a Confluence page by ID |

---

## JIRA Integration

| Command | Inputs | Returns |
|---------|--------|---------|
| `test_jira_connection` | base_url, email, api_token | `JiraTestResponse` |
| `list_jira_projects` | base_url, email, api_token | `Vec<JiraProjectInfo>` |
| `create_jira_ticket` | JiraCreateRequest | `JiraCreateResponse` |
| `search_jira_issues` | base_url, email, api_token, jql | `Vec<JiraIssue>` |
| `link_jira_to_analysis` | analysis_id, jira_link | `i64` |
| `unlink_jira_from_analysis` | analysis_id, jira_key | `()` |
| `post_jira_comment` | base_url, email, api_token, issue_key, comment | `()` |

---

## Sentry Integration

| Command | Inputs | Returns |
|---------|--------|---------|
| `test_sentry_connection` | org_slug, auth_token | `SentryTestResponse` |
| `list_sentry_projects` | org_slug, auth_token | `Vec<SentryProject>` |
| `list_sentry_issues` | project_id, auth_token | `Vec<SentryIssue>` |
| `fetch_sentry_issue` | project_id, issue_id, auth_token | `SentryIssueDetail` |
| `analyze_sentry_issue` | SentryAnalyzeRequest | `Analysis` |

---

## Export & Reports

| Command | Inputs | Returns |
|---------|--------|---------|
| `generate_report` | analysis_id, format, audience?, sections? | `ReportResult` |
| `generate_report_multi` | analysis_id, formats[] | `Vec<ReportResult>` |
| `preview_report` | analysis_id | `String (HTML)` |
| `check_sensitive_content` | content | `SensitiveContentResult` |
| `sanitize_content` | content, audience | `String` |
| `get_export_formats` | — | `Vec<ExportFormat>` |

**Supported formats:** HTML, Interactive HTML, Markdown, JSON, TXT, XLSX

---

## Widget

| Command | Inputs | Returns |
|---------|--------|---------|
| `toggle_widget` | — | `()` |
| `show_widget` | — | `()` |
| `hide_widget` | — | `()` |
| `resize_widget` | width, height | `()` |
| `move_widget` | x, y | `()` |
| `get_widget_position` | — | `WidgetPosition { x, y }` |
| `focus_main_window` | — | `()` |
| `is_main_window_visible` | — | `bool` |

---

## Intelligence Platform

| Command | Inputs | Returns |
|---------|--------|---------|
| `submit_analysis_feedback` | analysis_id, type, field_name?, values?, rating?, reason? | `()` |
| `promote_to_gold` | analysis_id | `()` |
| `verify_gold_analysis` | gold_id | `()` |
| `reject_gold_analysis` | gold_id, reason | `()` |
| `export_gold_jsonl` | — | `String (JSONL)` |
| `save_gold_answer` | question, answer, component?, severity? | `i64` |
| `search_gold_answers_cmd` | query | `Vec<GoldAnswer>` |

---

## Release Notes

| Command | Inputs | Returns |
|---------|--------|---------|
| `generate_release_notes` | jira_version, config | `ReleaseNotes` |
| `list_release_notes` | — | `Vec<ReleaseNotes>` |
| `get_release_notes` | id | `ReleaseNotes` |
| `update_release_notes_status` | id, status | `()` |
| `export_release_notes` | id, format | `String` |

---

## Database Maintenance

| Command | Inputs | Returns |
|---------|--------|---------|
| `optimize_fts_index` | — | `()` |
| `check_database_integrity` | — | `bool` |
| `compact_database` | — | `()` |
| `checkpoint_wal` | — | `()` |
| `get_database_info` | — | `DatabaseInfo` |

---

## Pattern Matching

| Command | Inputs | Returns |
|---------|--------|---------|
| `parse_crash_file` | path | `CrashFile` |
| `parse_crash_content` | content, filename | `CrashFile` |
| `match_patterns` | crash_file | `Vec<PatternMatchResult>` |
| `get_best_pattern_match` | crash_file | `PatternMatchResult?` |
| `list_patterns` | — | `Vec<CrashPattern>` |
| `reload_patterns` | — | `()` |

---

## Crash Signatures

| Command | Inputs | Returns |
|---------|--------|---------|
| `compute_crash_signature` | crash_file | `String (hash)` |
| `register_crash_signature` | CrashSignature | `()` |
| `get_signature_occurrences` | hash | `i32` |
| `get_top_signatures` | limit | `Vec<CrashSignature>` |
| `update_signature_status` | hash, status | `()` |
| `link_ticket_to_signature` | hash, ticket_system, ticket_id, url | `()` |
