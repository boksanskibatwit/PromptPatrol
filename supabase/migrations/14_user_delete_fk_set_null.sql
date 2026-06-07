-- Migration 14: Allow hard-deleting users without FK violations
--
-- account_requests.reviewed_by and audit_log_entries.user_id both reference
-- users(id) with no ON DELETE action (defaults to NO ACTION / RESTRICT).
-- Deleting a user who reviewed a request or has audit entries fails.
-- Change both to ON DELETE SET NULL so user rows can be removed cleanly.

ALTER TABLE account_requests
    DROP CONSTRAINT IF EXISTS account_requests_reviewed_by_fkey;
ALTER TABLE account_requests
    ADD CONSTRAINT account_requests_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE audit_log_entries
    DROP CONSTRAINT IF EXISTS audit_log_entries_user_id_fkey;
ALTER TABLE audit_log_entries
    ADD CONSTRAINT audit_log_entries_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
