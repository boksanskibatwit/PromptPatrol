-- Migration 7: Create redacted_documents table
-- PromptPatrol depends on 005_create_documents.sql

CREATE TABLE redacted_documents (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    source_document_id      UUID            NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    s3_bucket               VARCHAR(100)    NOT NULL,       -- 'promptpatrol-redacted' per deployment diagram
    s3_object_key           VARCHAR(500)    NOT NULL,       -- full S3 path to the redacted file
    file_type               file_type_t     NOT NULL,       -- matches source document file type
    size_bytes              BIGINT          NOT NULL,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    written_to_s3_at        TIMESTAMPTZ                     -- nullable, confirmed once S3 write succeeds
);

-- Row Level Security

ALTER TABLE redacted_documents ENABLE ROW LEVEL SECURITY;

-- Users can only see redacted documents belonging to their own source documents
CREATE POLICY "users_select_own_redacted"
    ON redacted_documents
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM documents
            WHERE id = source_document_id
            AND owner_id = auth.uid()
        )
    );

-- Admins can read all redacted documents
CREATE POLICY "admin_select_all_redacted"
    ON redacted_documents
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE id = auth.uid()
            AND role = 'admin'
        )
    );

-- INSERT and UPDATE only via backend service role
-- Row is created at step 13 (putObject) in the sequence diagram after applyRedactions() completes and the file lands in S3
-- written_to_s3_at is updated once S3 confirms 200 OK

-- Indexes

-- Primary lookup — backend fetches this row to generate presigned URL
CREATE INDEX idx_redacted_source_document_id ON redacted_documents (source_document_id);

-- Used to identify rows where S3 write is pending confirmation
CREATE INDEX idx_redacted_written_to_s3_at ON redacted_documents (written_to_s3_at);