-- 006: Jira integration configuration and ticket tracking

CREATE TABLE jira_configs (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    base_url        TEXT NOT NULL,
    project_key     TEXT NOT NULL,
    auth_type       TEXT NOT NULL DEFAULT 'basic' CHECK (auth_type IN ('basic', 'pat', 'oauth')),
    credentials     JSONB NOT NULL DEFAULT '{}',
    default_issue_type  TEXT NOT NULL DEFAULT 'Bug',
    custom_fields   JSONB NOT NULL DEFAULT '{}',
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_jira_configs_updated_at
    BEFORE UPDATE ON jira_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Track tickets created from analyses
CREATE TABLE jira_tickets (
    id              SERIAL PRIMARY KEY,
    analysis_id     BIGINT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    config_id       INT NOT NULL REFERENCES jira_configs(id),
    jira_key        TEXT NOT NULL,          -- e.g. "PROJ-1234"
    jira_url        TEXT NOT NULL,
    status          TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jira_tickets_analysis ON jira_tickets(analysis_id);
CREATE INDEX idx_jira_tickets_key ON jira_tickets(jira_key);
