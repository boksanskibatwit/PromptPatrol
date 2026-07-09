-- Migration 8: Create audit_log_entries table
-- PromptPatrol depends on 002_create_users.sql, 005_create_documents.sql

CREATE TABLE IF NOT EXISTS audit_log_entries (
    id                  BIGSERIAL       PRIMARY KEY,                        -- sequential integer, critical for hash chain ordering
    user_id             UUID            REFERENCES users(id),               -- nullable, some actions may be unauthenticated (LOGIN_ATTEMPT)
    document_id         UUID            REFERENCES documents(id),           -- nullable, not all actions are document-related
    action              audit_action_t  NOT NULL,
    ip_address          INET,                                               -- nullable, captured from request context
    metadata            JSONB,                                              -- nullable, flexible payload for action-specific detail
    entities_flagged    INTEGER,                                            -- nullable, populated on UPLOAD / RESCAN actions
    entities_redacted   INTEGER,                                            -- nullable, populated on REDACT action
    prev_id             BIGINT          REFERENCES audit_log_entries(id),   -- self reference for hash chain
    prev_hash           CHAR(64),                                           -- SHA-256 hash of the previous row
    row_hash            CHAR(64)        NOT NULL,                           -- SHA-256 hash of this row's content
    occurred_at         TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Row Level Security

ALTER TABLE audit_log_entries ENABLE ROW LEVEL SECURITY;

-- NO user-facing SELECT policy  analysts cannot read the audit log directly
-- All audit log access goes through the admin API endpoints
-- This is intentional the lockout is the security feature

-- Admins can read all entries
DROP POLICY IF EXISTS "admin_select_audit_log" ON audit_log_entries;
CREATE POLICY "admin_select_audit_log"
    ON audit_log_entries
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE id = auth.uid()
            AND role = 'admin'
        )
    );

-- NO INSERT policy for any client or admin only the backend service role can write to this table via POST /internal/audit/append (section 8, internal endpoints)
-- This prevents any tampering with the audit record from the client layer

-- NO UPDATE or DELETE policy for anyone
-- Audit entries are immutable by design
-- The hash chain (prev_hash -> row_hash) detects any tampering
-- POST /admin/audit/verify-chain recomputes the chain to verify integrity

-- Indexes

-- Hash chain traversal verify-chain walks entries in order
CREATE INDEX IF NOT EXISTS idx_audit_occurred_at ON audit_log_entries (occurred_at);

-- Most admin audit queries will filter by user
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_log_entries (user_id);

-- Filter by action type
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log_entries (action);

-- Document scoped audit trail
CREATE INDEX IF NOT EXISTS idx_audit_document_id ON audit_log_entries (document_id);

-- Hash chain integrity prev_id lookups during verify-chain
CREATE INDEX IF NOT EXISTS idx_audit_prev_id ON audit_log_entries (prev_id);
