-- 017: Add review workflow columns to release_notes

ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS checklist_state JSONB;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id);
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
