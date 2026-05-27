-- Migration 004: Create sessions table
-- PromptPatrol depends on 002_create_users.sql


CREATE TABLE sessions (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    jwt_hash        VARCHAR(255)    NOT NULL,               -- hashed JWT, never store raw token
    ip_address      INET,                                   -- nullable, captured at login
    user_agent      VARCHAR(500),                           -- nullable, browser/client info
    mfa_verified    BOOLEAN         NOT NULL DEFAULT false,
    expires_at      TIMESTAMPTZ     NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Row Level Security

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own sessions
CREATE POLICY "users_select_own_sessions"
    ON sessions
    FOR SELECT
    USING (user_id = auth.uid());

-- Admins can see all sessions
CREATE POLICY "admin_select_all_sessions"
    ON sessions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE id = auth.uid()
            AND role = 'admin'
        )
    );

-- Users can delete their own sessions (logout: POST /auth/logout)
CREATE POLICY "users_delete_own_sessions"
    ON sessions
    FOR DELETE
    USING (user_id = auth.uid());

-- Admins can delete any session
CREATE POLICY "admin_delete_any_session"
    ON sessions
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE id = auth.uid()
            AND role = 'admin'
        )
    );

-- INSERT only via backend service role session is created serverside after MFA verification (POST /auth/mfa/verify)
-- No client INSERT policy defined intentionally

-- Indexes

-- Primary lookup: backend validates incoming JWTs against this
CREATE INDEX idx_sessions_jwt_hash ON sessions (jwt_hash);

-- Used for listing a user's active sessions and force revoke by admin
CREATE INDEX idx_sessions_user_id ON sessions (user_id);

-- Useful for expiry cleanup jobs. Expired sessions can be purged periodically
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);