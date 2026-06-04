-- Migration 10: Fix "infinite recursion in policy for relation users"
--
-- The admin policies check role with:
--     EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
-- On the users table itself (migration 02) this makes the policy query users,
-- which re-triggers the same policy → infinite recursion. Any query against a
-- table whose admin policy references users (documents, sessions, etc.) hits it
-- too — e.g. the dashboard's `select * from documents`.
--
-- Fix: a SECURITY DEFINER helper that runs as the function owner (bypassing RLS
-- on the inner users lookup), so the admin check no longer recurses. Then
-- rewrite every admin policy to call it.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'admin'
    );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon, service_role;

-- ── users ──────────────────────────────────────────
DROP POLICY IF EXISTS "admin_select_all_users" ON users;
CREATE POLICY "admin_select_all_users" ON users
    FOR SELECT USING ( public.is_admin() );

-- A normal user could not read their own users row before; add it.
DROP POLICY IF EXISTS "users_select_own_user" ON users;
CREATE POLICY "users_select_own_user" ON users
    FOR SELECT USING ( id = auth.uid() );

-- ── documents ──────────────────────────────────────
DROP POLICY IF EXISTS "admin_select_all_documents" ON documents;
CREATE POLICY "admin_select_all_documents" ON documents
    FOR SELECT USING ( public.is_admin() );

-- ── account_requests ───────────────────────────────
DROP POLICY IF EXISTS "admin_select_all_requests" ON account_requests;
CREATE POLICY "admin_select_all_requests" ON account_requests
    FOR SELECT USING ( public.is_admin() );

DROP POLICY IF EXISTS "admin_update_requests" ON account_requests;
CREATE POLICY "admin_update_requests" ON account_requests
    FOR UPDATE USING ( public.is_admin() );

-- ── sessions ───────────────────────────────────────
DROP POLICY IF EXISTS "admin_select_all_sessions" ON sessions;
CREATE POLICY "admin_select_all_sessions" ON sessions
    FOR SELECT USING ( public.is_admin() );

DROP POLICY IF EXISTS "admin_delete_any_session" ON sessions;
CREATE POLICY "admin_delete_any_session" ON sessions
    FOR DELETE USING ( public.is_admin() );

-- ── redaction_candidates ───────────────────────────
DROP POLICY IF EXISTS "admin_select_all_candidates" ON redaction_candidates;
CREATE POLICY "admin_select_all_candidates" ON redaction_candidates
    FOR SELECT USING ( public.is_admin() );

-- ── redacted_documents ─────────────────────────────
DROP POLICY IF EXISTS "admin_select_all_redacted" ON redacted_documents;
CREATE POLICY "admin_select_all_redacted" ON redacted_documents
    FOR SELECT USING ( public.is_admin() );

-- ── audit_log_entries ──────────────────────────────
DROP POLICY IF EXISTS "admin_select_audit_log" ON audit_log_entries;
CREATE POLICY "admin_select_audit_log" ON audit_log_entries
    FOR SELECT USING ( public.is_admin() );
