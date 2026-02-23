-- 004: Per-user and global settings

CREATE TABLE user_settings (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings    JSONB NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_user_settings_updated_at
    BEFORE UPDATE ON user_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Global settings (admin-managed, shared across all users)
CREATE TABLE global_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    description TEXT,
    updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default global settings
INSERT INTO global_settings (key, value, description) VALUES
    ('default_ai_model', '"gpt-4o"', 'Default AI model for new analyses'),
    ('default_ai_provider', '"openai"', 'Default AI provider'),
    ('max_file_size_kb', '10240', 'Maximum upload file size in KB'),
    ('rag_enabled', 'true', 'Whether RAG retrieval is enabled globally');
