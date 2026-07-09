-- Migration 005: Create documents table
-- PromptPatrol depends on 002_create_users.sql
-- This table stores only metadata

CREATE TABLE IF NOT EXISTS documents (
    id                  UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            UUID                NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_filename   VARCHAR(500)        NOT NULL,
    file_type           file_type_t         NOT NULL,
    size_bytes          BIGINT              NOT NULL,
    status              document_status_t   NOT NULL DEFAULT 'scanning',
    sha256_input        CHAR(64),                           -- hash of original file, set on upload
    sha256_output       CHAR(64),                           -- hash of redacted file, set after redaction
    uploaded_at         TIMESTAMPTZ         NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ                         -- nullable until redaction is complete
);

-- Row Level Security

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Users can only see their own documents
DROP POLICY IF EXISTS "users_select_own_documents" ON documents;
CREATE POLICY "users_select_own_documents"
    ON documents
    FOR SELECT
    USING (owner_id = auth.uid());

-- Users can insert their own documents
DROP POLICY IF EXISTS "users_insert_own_documents" ON documents;
CREATE POLICY "users_insert_own_documents"
    ON documents
    FOR INSERT
    WITH CHECK (owner_id = auth.uid());

-- Users can update their own documents
DROP POLICY IF EXISTS "users_update_own_documents" ON documents;
CREATE POLICY "users_update_own_documents"
    ON documents
    FOR UPDATE
    USING (owner_id = auth.uid());

-- Users can delete their own documents
DROP POLICY IF EXISTS "users_delete_own_documents" ON documents;
CREATE POLICY "users_delete_own_documents"
    ON documents
    FOR DELETE
    USING (owner_id = auth.uid());

-- Admins can read all documents
DROP POLICY IF EXISTS "admin_select_all_documents" ON documents;
CREATE POLICY "admin_select_all_documents"
    ON documents
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE id = auth.uid()
            AND role = 'admin'
        )
    );

-- Indexes

-- Primary lookup every document query filters by owner
CREATE INDEX IF NOT EXISTS idx_documents_owner_id ON documents (owner_id);

-- Status index: used to filter scanning/review/stored/failed views
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents (status);

-- Useful for audit queries filtering by upload time
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_at ON documents (uploaded_at);
