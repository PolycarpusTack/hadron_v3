-- 015_jira_poller.sql
-- Background JIRA poller configuration and user project subscriptions.

CREATE TABLE jira_poller_config (
    id              SERIAL PRIMARY KEY,
    enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    jql_filter      TEXT NOT NULL DEFAULT '',
    interval_mins   INT NOT NULL DEFAULT 30,
    last_polled_at  TIMESTAMPTZ,
    jira_base_url   TEXT NOT NULL DEFAULT '',
    jira_email      TEXT NOT NULL DEFAULT '',
    jira_api_token  TEXT NOT NULL DEFAULT '',
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed single config row
INSERT INTO jira_poller_config (id) VALUES (1);

CREATE TABLE user_project_subscriptions (
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    project_key     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, project_key)
);
