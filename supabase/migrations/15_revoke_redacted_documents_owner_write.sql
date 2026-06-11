-- Migration 15: Revoke client-side writes to redacted_documents
-- Reverts migration 09.
--
-- Migration 09 let owners insert/update redacted_documents from the browser
-- because there was no backend to do it. The upload/redact flow now runs
-- through the FastAPI backend (app/routers/documents.py), which writes
-- redacted_documents and redaction_candidates with the service role — the
-- access model migrations 06/07 originally intended. Owner SELECT policies
-- are unchanged.

DROP POLICY IF EXISTS "users_insert_own_redacted" ON redacted_documents;
DROP POLICY IF EXISTS "users_update_own_redacted" ON redacted_documents;
