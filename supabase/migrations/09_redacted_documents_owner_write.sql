-- Migration 9: Allow owners to write their own redacted_documents rows
-- PromptPatrol depends on 005_create_documents.sql, 007_create_redacted_documents.sql
--
-- The original design reserved redacted_documents writes for the backend
-- service role. PromptPatrol currently uploads the redacted file to S3 directly
-- from the client (the API Gateway proxy is the only storage path wired up), so
-- the client also needs to record the resulting S3 location. These policies let
-- a user insert/update a redacted_documents row only when it points back to a
-- document they own. DELETE is intentionally omitted: redacted_documents has
-- ON DELETE CASCADE from documents, so deleting the owning document removes the
-- redacted row automatically (documents already has an owner DELETE policy).

CREATE POLICY "users_insert_own_redacted"
    ON redacted_documents
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM documents
            WHERE id = source_document_id
            AND owner_id = auth.uid()
        )
    );

CREATE POLICY "users_update_own_redacted"
    ON redacted_documents
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM documents
            WHERE id = source_document_id
            AND owner_id = auth.uid()
        )
    );
