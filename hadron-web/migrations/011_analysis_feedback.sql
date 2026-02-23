-- 011: Analysis feedback — thumbs up/down, corrections, star ratings

CREATE TABLE analysis_feedback (
    id              BIGSERIAL PRIMARY KEY,
    analysis_id     BIGINT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feedback_type   TEXT NOT NULL CHECK (feedback_type IN ('thumbs_up','thumbs_down','correction','rating')),
    field_name      TEXT,
    original_value  TEXT,
    corrected_value TEXT,
    rating          SMALLINT CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
    comment         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_analysis ON analysis_feedback(analysis_id);
CREATE UNIQUE INDEX idx_feedback_unique_thumbs
    ON analysis_feedback(analysis_id, user_id, feedback_type)
    WHERE feedback_type IN ('thumbs_up', 'thumbs_down');
