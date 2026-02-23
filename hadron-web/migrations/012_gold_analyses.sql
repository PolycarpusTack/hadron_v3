-- 012: Gold standard analyses — curated high-quality examples

CREATE TABLE gold_analyses (
    id                  BIGSERIAL PRIMARY KEY,
    analysis_id         BIGINT NOT NULL UNIQUE REFERENCES analyses(id) ON DELETE CASCADE,
    promoted_by         UUID NOT NULL REFERENCES users(id),
    verified_by         UUID REFERENCES users(id),
    verification_status TEXT NOT NULL DEFAULT 'pending'
                        CHECK (verification_status IN ('pending','verified','rejected')),
    verification_notes  TEXT,
    quality_score       SMALLINT CHECK (quality_score IS NULL OR (quality_score >= 1 AND quality_score <= 5)),
    promoted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_at         TIMESTAMPTZ
);

CREATE INDEX idx_gold_status ON gold_analyses(verification_status);
