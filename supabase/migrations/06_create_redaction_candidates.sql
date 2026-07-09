-- Migration 006: Create redaction_candidates table
-- PromptPatrol depends on 005_create_documents.sql

CREATE TABLE IF NOT EXISTS redaction_candidates (
    id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID                NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    entity_type     entity_type_t       NOT NULL,
    detection_source detection_source_t NOT NULL,
    matched_text    TEXT                NOT NULL,           -- the actual PII text that was flagged
    start_offset    INTEGER             NOT NULL,           -- character position in document where match starts
    end_offset      INTEGER             NOT NULL,           -- character position in document where match ends
    confidence      DECIMAL             NOT NULL,           -- ML confidence score, 0.0 to 1.0
    page_number     INTEGER,                                -- nullable, not all file types have pages
    review_status   review_status_t     NOT NULL DEFAULT 'pending',
    reviewed_at     TIMESTAMPTZ                             -- nullable until analyst makes a decision
);

-- Row Level Security

ALTER TABLE redaction_candidates ENABLE ROW LEVEL SECURITY;

-- Users can only see candidates belonging to their own documents
-- Joins back to documents table to verify ownership
DROP POLICY IF EXISTS "users_select_own_candidates" ON redaction_candidates;
CREATE POLICY "users_select_own_candidates"
    ON redaction_candidates
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM documents
            WHERE id = document_id
            AND owner_id = auth.uid()
        )
    );

-- Users can update candidates on their own documents
DROP POLICY IF EXISTS "users_update_own_candidates" ON redaction_candidates;
CREATE POLICY "users_update_own_candidates"
    ON redaction_candidates
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM documents
            WHERE id = document_id
            AND owner_id = auth.uid()
        )
    );

-- INSERT only via backend service role — candidates are created by the ML pipeline, never directly by the client

-- Admins can read all candidates
DROP POLICY IF EXISTS "admin_select_all_candidates" ON redaction_candidates;
CREATE POLICY "admin_select_all_candidates"
    ON redaction_candidates
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE id = auth.uid()
            AND role = 'admin'
        )
    );

-- Indexes

-- Primary lookup: every candidate query filters by document
CREATE INDEX IF NOT EXISTS idx_candidates_document_id ON redaction_candidates (document_id);

-- Used to filter candidates still awaiting analyst review
CREATE INDEX IF NOT EXISTS idx_candidates_review_status ON redaction_candidates (review_status);

-- Useful for filtering by entity type in the review UI
CREATE INDEX IF NOT EXISTS idx_candidates_entity_type ON redaction_candidates (entity_type);
