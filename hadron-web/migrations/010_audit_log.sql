-- 010: Audit log — tracks who did what, when

CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id),
    action          TEXT NOT NULL,          -- e.g. 'analysis.create', 'user.role_change', 'settings.update'
    resource_type   TEXT NOT NULL,          -- e.g. 'analysis', 'user', 'chat_session', 'settings'
    resource_id     TEXT,                   -- ID of the affected resource
    details         JSONB NOT NULL DEFAULT '{}',  -- Action-specific metadata
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partition-friendly index (queries typically filter by time range)
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_log_action ON audit_log(action, created_at DESC);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);
