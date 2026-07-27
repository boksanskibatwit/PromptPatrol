-- Migration 18: Allow hard-deleting documents without FK violations
--
-- audit_log_entries.document_id references documents(id) with no ON DELETE
-- action (defaults to NO ACTION / RESTRICT). Every redacted document gets an
-- audit row, so deleting one always failed with:
--     violates foreign key constraint "audit_log_entries_document_id_fkey"
--
-- SET NULL, not CASCADE: audit entries are immutable by design (migration 08)
-- and are linked into a hash chain via prev_id, so deleting them would both
-- destroy the compliance record and break chain verification. Nothing is lost
-- by nulling the column — audit_log_entries.metadata already stores the
-- document_id, original_filename, and both SHA-256 hashes, and the same payload
-- is mirrored to the S3 audit bucket.
--
-- This mirrors migration 14, which applied the same reasoning to user_id.

ALTER TABLE audit_log_entries
    DROP CONSTRAINT IF EXISTS audit_log_entries_document_id_fkey;
ALTER TABLE audit_log_entries
    ADD CONSTRAINT audit_log_entries_document_id_fkey
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;