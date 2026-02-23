-- 005: OpenSearch integration configuration (shared, managed by leads+)

CREATE TABLE opensearch_configs (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    url         TEXT NOT NULL,
    index_pattern TEXT NOT NULL DEFAULT '*',
    auth_type   TEXT NOT NULL DEFAULT 'basic' CHECK (auth_type IN ('basic', 'api_key', 'none')),
    -- Credentials stored encrypted; keys stored separately from values
    credentials JSONB NOT NULL DEFAULT '{}',
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    created_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_opensearch_configs_updated_at
    BEFORE UPDATE ON opensearch_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Saved search queries
CREATE TABLE saved_searches (
    id              SERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    config_id       INT NOT NULL REFERENCES opensearch_configs(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    query           JSONB NOT NULL,
    is_shared       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_searches_user ON saved_searches(user_id);
CREATE INDEX idx_saved_searches_shared ON saved_searches(is_shared) WHERE is_shared = TRUE;
