-- 016: Add AI generation columns to release_notes table

ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS fix_version TEXT;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'both';
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS markdown_content TEXT;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS original_ai_content TEXT;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS ticket_keys JSONB DEFAULT '[]';
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS ticket_count INTEGER DEFAULT 0;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS jql_filter TEXT;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS module_filter JSONB;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS ai_provider TEXT;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS tokens_used BIGINT DEFAULT 0;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS cost DOUBLE PRECISION DEFAULT 0.0;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS generation_duration_ms BIGINT;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS ai_insights JSONB;
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_release_notes_fix_version ON release_notes(fix_version) WHERE fix_version IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_release_notes_status ON release_notes(status) WHERE status IS NOT NULL;
