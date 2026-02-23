-- 002: Analyses table — core analysis history with user scoping

CREATE TABLE analyses (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename            TEXT NOT NULL,
    file_size_kb        DOUBLE PRECISION,

    -- AI analysis results
    error_type          TEXT,
    error_message       TEXT,
    severity            TEXT CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    component           TEXT,
    stack_trace         TEXT,
    root_cause          TEXT,
    suggested_fixes     JSONB,
    confidence          TEXT CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),

    -- AI metadata
    ai_model            TEXT,
    ai_provider         TEXT,
    tokens_used         BIGINT,
    cost                DOUBLE PRECISION,
    was_truncated       BOOLEAN DEFAULT false,
    analysis_duration_ms BIGINT,
    analysis_type       TEXT DEFAULT 'complete',

    -- Full JSON data (for flexible extension)
    full_data           JSONB,

    -- Signature
    error_signature     TEXT,

    -- User interaction
    is_favorite         BOOLEAN NOT NULL DEFAULT false,
    view_count          INTEGER NOT NULL DEFAULT 0,
    last_viewed_at      TIMESTAMPTZ,

    -- Soft delete
    deleted_at          TIMESTAMPTZ,

    -- Timestamps
    analyzed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_analyses_user_id ON analyses(user_id);
CREATE INDEX idx_analyses_analyzed_at ON analyses(analyzed_at DESC);
CREATE INDEX idx_analyses_severity ON analyses(severity);
CREATE INDEX idx_analyses_component ON analyses(component);
CREATE INDEX idx_analyses_is_favorite ON analyses(user_id, is_favorite) WHERE is_favorite = true;
CREATE INDEX idx_analyses_error_signature ON analyses(error_signature) WHERE error_signature IS NOT NULL;
CREATE INDEX idx_analyses_not_deleted ON analyses(user_id, analyzed_at DESC) WHERE deleted_at IS NULL;

-- Full-text search
ALTER TABLE analyses ADD COLUMN search_vector tsvector;

CREATE INDEX idx_analyses_fts ON analyses USING GIN(search_vector);

CREATE OR REPLACE FUNCTION analyses_search_trigger()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('english',
        coalesce(NEW.error_type, '') || ' ' ||
        coalesce(NEW.error_message, '') || ' ' ||
        coalesce(NEW.root_cause, '') || ' ' ||
        coalesce(NEW.component, '') || ' ' ||
        coalesce(NEW.filename, '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_analyses_search
    BEFORE INSERT OR UPDATE ON analyses
    FOR EACH ROW EXECUTE FUNCTION analyses_search_trigger();

CREATE TRIGGER trg_analyses_updated_at
    BEFORE UPDATE ON analyses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Tags
CREATE TABLE tags (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    color       TEXT,
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE analysis_tags (
    analysis_id BIGINT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (analysis_id, tag_id)
);

-- Notes
CREATE TABLE analysis_notes (
    id          BIGSERIAL PRIMARY KEY,
    analysis_id BIGINT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_analysis_notes_analysis_id ON analysis_notes(analysis_id);

CREATE TRIGGER trg_analysis_notes_updated_at
    BEFORE UPDATE ON analysis_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Crash signatures
CREATE TABLE crash_signatures (
    hash                TEXT PRIMARY KEY,
    canonical           TEXT NOT NULL,
    components_json     JSONB NOT NULL,
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    occurrence_count    INTEGER NOT NULL DEFAULT 1,
    linked_ticket_id    TEXT,
    linked_ticket_url   TEXT,
    status              TEXT NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new', 'investigating', 'fix_in_progress', 'fixed', 'wont_fix', 'duplicate')),
    status_metadata     JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_crash_signatures_status ON crash_signatures(status);
CREATE INDEX idx_crash_signatures_occurrence ON crash_signatures(occurrence_count DESC);

CREATE TABLE analysis_signatures (
    analysis_id     BIGINT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    signature_hash  TEXT NOT NULL REFERENCES crash_signatures(hash) ON DELETE CASCADE,
    matched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (analysis_id, signature_hash)
);
