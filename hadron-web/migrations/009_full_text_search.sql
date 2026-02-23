-- 009: Additional full-text search indexes

-- Chat messages FTS
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

CREATE INDEX idx_chat_messages_fts ON chat_messages USING GIN (search_vector);

-- Release notes FTS
ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || content)) STORED;

CREATE INDEX idx_release_notes_fts ON release_notes USING GIN (search_vector);

-- Global search function across multiple content types
CREATE OR REPLACE FUNCTION global_search(
    search_query TEXT,
    p_user_id UUID,
    p_limit INT DEFAULT 20
)
RETURNS TABLE (
    result_type TEXT,
    result_id BIGINT,
    title TEXT,
    snippet TEXT,
    relevance REAL,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT * FROM (
        -- Analysis results
        SELECT
            'analysis'::TEXT as result_type,
            a.id as result_id,
            a.filename as title,
            left(coalesce(a.root_cause, a.error_message, ''), 200) as snippet,
            ts_rank(a.search_vector, websearch_to_tsquery('english', search_query)) as relevance,
            a.analyzed_at as created_at
        FROM analyses a
        WHERE a.user_id = p_user_id
            AND a.deleted_at IS NULL
            AND a.search_vector @@ websearch_to_tsquery('english', search_query)

        UNION ALL

        -- Chat messages
        SELECT
            'chat'::TEXT,
            cm.id,
            cs.title,
            left(cm.content, 200),
            ts_rank(cm.search_vector, websearch_to_tsquery('english', search_query)),
            cm.created_at
        FROM chat_messages cm
        JOIN chat_sessions cs ON cs.id = cm.session_id
        WHERE cs.user_id = p_user_id
            AND cm.search_vector @@ websearch_to_tsquery('english', search_query)

        UNION ALL

        -- Release notes
        SELECT
            'release_note'::TEXT,
            rn.id,
            rn.title,
            left(rn.content, 200),
            ts_rank(rn.search_vector, websearch_to_tsquery('english', search_query)),
            rn.created_at
        FROM release_notes rn
        WHERE rn.user_id = p_user_id
            AND rn.search_vector @@ websearch_to_tsquery('english', search_query)
    ) combined
    ORDER BY relevance DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;
