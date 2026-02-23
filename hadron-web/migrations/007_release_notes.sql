-- 007: Release notes generation and storage

CREATE TABLE release_notes (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    version         TEXT,
    content         TEXT NOT NULL,
    format          TEXT NOT NULL DEFAULT 'markdown' CHECK (format IN ('markdown', 'html', 'plain')),
    source_data     JSONB,                  -- Input data used to generate notes
    ai_model        TEXT,
    is_published    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_release_notes_updated_at
    BEFORE UPDATE ON release_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_release_notes_user ON release_notes(user_id);
CREATE INDEX idx_release_notes_version ON release_notes(version) WHERE version IS NOT NULL;
