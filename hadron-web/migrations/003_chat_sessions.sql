-- 003: Chat sessions and messages with user scoping

CREATE TABLE chat_sessions (
    id          TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT 'New Chat',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_sessions_user_id ON chat_sessions(user_id, updated_at DESC);

CREATE TABLE chat_messages (
    id          BIGSERIAL PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content     TEXT NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id, created_at);

-- Gold answers (Ask Hadron 2.0)
CREATE TABLE gold_answers (
    id              BIGSERIAL PRIMARY KEY,
    question        TEXT NOT NULL,
    answer          TEXT NOT NULL,
    session_id      TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
    message_id      BIGINT,
    won_version     TEXT,
    source_type     TEXT,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    validation_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (validation_status IN ('pending', 'verified', 'rejected')),
    times_referenced INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gold_answers_status ON gold_answers(validation_status);

CREATE TRIGGER trg_chat_sessions_updated_at
    BEFORE UPDATE ON chat_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_gold_answers_updated_at
    BEFORE UPDATE ON gold_answers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
