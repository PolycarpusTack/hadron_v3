-- 008: Vector embeddings for RAG search (pgvector)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embeddings (
    id              BIGSERIAL PRIMARY KEY,
    source_type     TEXT NOT NULL CHECK (source_type IN ('analysis', 'chat', 'document', 'release_note')),
    source_id       BIGINT NOT NULL,
    chunk_index     INT NOT NULL DEFAULT 0,
    content         TEXT NOT NULL,
    embedding       vector(1536),           -- OpenAI text-embedding-3-small dimension
    model           TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- IVFFlat index for approximate nearest neighbor search
-- Create after bulk loading: ALTER INDEX idx_embeddings_vector SET (lists = 100);
CREATE INDEX idx_embeddings_vector ON embeddings
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

CREATE INDEX idx_embeddings_source ON embeddings(source_type, source_id);

-- Unique constraint: one embedding per chunk per source
CREATE UNIQUE INDEX idx_embeddings_unique ON embeddings(source_type, source_id, chunk_index);
