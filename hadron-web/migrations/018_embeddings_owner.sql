-- 018: Tenant-scope analysis embeddings (F1/F2 from 2026-04-20 security audit)
--
-- Adds owner_user_id to the embeddings table so the generic vector_search
-- function can filter analysis results to the calling user. Ticket and
-- release-note sources stay NULL (shared by product design).

ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id);

-- Backfill for existing analysis rows from analyses.user_id.
UPDATE embeddings e
   SET owner_user_id = a.user_id
  FROM analyses a
 WHERE e.source_type = 'analysis'
   AND e.source_id = a.id
   AND e.owner_user_id IS NULL;

-- Composite index matches the filter shape in vector_search.
CREATE INDEX IF NOT EXISTS idx_embeddings_owner
    ON embeddings(source_type, owner_user_id);
