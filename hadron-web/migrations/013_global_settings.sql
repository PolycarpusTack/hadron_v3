-- 013_global_settings.sql
-- Server-side configuration (AI keys, feature flags, etc.)

CREATE TABLE global_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID REFERENCES users(id)
);

-- Seed AI configuration keys with empty defaults
INSERT INTO global_settings (key, value) VALUES
    ('ai_provider', 'openai'),
    ('ai_model_openai', 'gpt-4o'),
    ('ai_model_anthropic', 'claude-sonnet-4-20250514'),
    ('ai_api_key_openai', ''),
    ('ai_api_key_anthropic', '');
