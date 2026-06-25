-- Migration 16: Fix "Database error saving new user" on signup + harden trigger
--
-- Two problems are fixed here, both of which surfaced as the Supabase Auth
-- error "Database error saving new user" (the trigger throwing aborts the
-- auth.users insert):
--
-- 1. ENUM CAST (the regression). Migration 13 changed the role value from the
--    bare literal 'user' to COALESCE(NEW.raw_user_meta_data->>'role', 'user').
--    ->> returns text, and Postgres has no implicit cast from text to the
--    role_t enum, so every signup failed with:
--        column "role" is of type role_t but expression is of type text
--    Fix: cast role/status explicitly to their enum types.
--
-- 2. EMAIL COLLISION (defensive). public.users.email is UNIQUE, but the insert
--    only guarded ON CONFLICT (id). A leftover public.users row whose auth.users
--    row was deleted (e.g. via the dashboard) keeps the email and makes the next
--    signup with that email fail the email unique constraint. Because auth.users
--    enforces email uniqueness, any public.users row sharing NEW.email must be
--    orphaned, so we reclaim it before inserting. A unique_violation handler is
--    kept as a final safety net so a stale row can never block auth signup.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Reclaim any orphaned public.users row holding this email (no auth user
    -- backs it, so it cannot belong to a live account).
    DELETE FROM public.users u
    WHERE u.email = NEW.email
      AND NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = u.id);

    INSERT INTO public.users (id, email, username, role, status)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'role', 'user')::role_t,
        'active'::user_status_t
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
EXCEPTION WHEN unique_violation THEN
    -- Never let a stale public.users row block Supabase Auth signup.
    RAISE WARNING 'handle_new_auth_user: skipped insert for % (%)', NEW.email, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
