-- Migration 11: Populate public.users from Supabase Auth
--
-- The app authenticates with Supabase Auth (auth.users), but the domain tables
-- FK to public.users(id) = auth.uid(). Signup never created public.users rows,
-- so inserts into documents (owner_id -> users.id) fail the foreign key and the
-- whole upload silently aborts before reaching S3.
--
-- public.users was designed for a custom auth scheme (NOT NULL password_hash),
-- but Supabase Auth owns credentials now, so relax those columns and mirror
-- auth.users into public.users via a trigger + one-time backfill.

-- 1. Relax legacy columns Supabase Auth doesn't supply.
ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;

-- 2. Trigger: create a public.users row whenever an auth user is created.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.users (id, email, username, role, status)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        'user',
        'active'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 3. Backfill rows for users who already signed up.
INSERT INTO public.users (id, email, username, role, status)
SELECT
    u.id,
    u.email,
    COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
    'user',
    'active'
FROM auth.users u
ON CONFLICT (id) DO NOTHING;
