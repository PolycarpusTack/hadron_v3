-- 014_ticket_briefs.sql
-- Stores triage and investigation brief results for JIRA tickets.

CREATE TABLE ticket_briefs (
    jira_key        TEXT PRIMARY KEY,
    title           TEXT NOT NULL DEFAULT '',
    severity        TEXT,
    category        TEXT,
    tags            TEXT,
    triage_json     TEXT,
    brief_json      TEXT,
    posted_to_jira  BOOLEAN NOT NULL DEFAULT FALSE,
    posted_at       TIMESTAMPTZ,
    engineer_rating SMALLINT,
    engineer_notes  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ticket_briefs_severity ON ticket_briefs(severity);
