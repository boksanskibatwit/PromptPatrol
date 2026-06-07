-- Migration 12: Add auth_user_id and description to account_requests
--
-- auth_user_id links the request row to the Supabase Auth user so the backend
-- can ban/unban the correct account when an admin approves or rejects the request.
-- description stores the applicant's free-text justification from the signup form.

ALTER TABLE account_requests
    ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE,
    ADD COLUMN IF NOT EXISTS description  TEXT;
