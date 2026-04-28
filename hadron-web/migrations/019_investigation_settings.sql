-- 019_investigation_settings.sql
-- Adds Confluence override credentials and investigation KB settings
-- to the existing jira_poller_config row.

ALTER TABLE jira_poller_config
    ADD COLUMN IF NOT EXISTS confluence_override_url   TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS confluence_override_email TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS confluence_override_token TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS whatson_kb_url            TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS mod_docs_homepage_id      TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS mod_docs_space_path       TEXT NOT NULL DEFAULT '';
