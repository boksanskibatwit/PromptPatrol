-- Migration 3: Create account_requests table
-- PromptPatrol depends on 002_create_users.sql

CREATE TABLE IF NOT EXISTS account_requests (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_email     VARCHAR(255)    NOT NULL,
    requested_name      VARCHAR(200)    NOT NULL,
    requested_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    status              request_status_t NOT NULL DEFAULT 'pending',
    reviewed_by         UUID            REFERENCES users(id),     -- nullable until an admin reviews it
    reviewed_at         TIMESTAMPTZ,                              -- nullable until reviewed
    decision_note       TEXT                                      -- nullable, admin can optionally explain rejection
);


-- Row Level Security
ALTER TABLE account_requests ENABLE ROW LEVEL SECURITY;

-- No SELECT policy for regular users — a requester has no account yet so auth.uid() won't match anything. They submit and wait for an email.

-- Admins can read all pending and historical requests
DROP POLICY IF EXISTS "admin_select_all_requests" ON account_requests;
CREATE POLICY "admin_select_all_requests"
    ON account_requests
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE id = auth.uid()
            AND role = 'admin'
        )
    );

-- Admins can update requests (approve / reject sets status, reviewed_by, reviewed_at)
DROP POLICY IF EXISTS "admin_update_requests" ON account_requests;
CREATE POLICY "admin_update_requests"
    ON account_requests
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE id = auth.uid()
            AND role = 'admin'
        )
    );

-- INSERT is open to unauthenticated users for new user auth
DROP POLICY IF EXISTS "public_insert_request" ON account_requests;
CREATE POLICY "public_insert_request"
    ON account_requests
    FOR INSERT
    WITH CHECK (true);

-- Indexes

-- Filtering by status = 'pending'
CREATE INDEX IF NOT EXISTS idx_account_requests_status ON account_requests (status);

--Check if an email already has a pending request
CREATE INDEX IF NOT EXISTS idx_account_requests_email ON account_requests (requested_email);
