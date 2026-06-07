-- Migration 13: Re-create auth user trigger to respect raw_user_meta_data.role
--
-- Migration 11's trigger always inserted role = 'user'. Updated to read the
-- role from raw_user_meta_data so that any auth user created with
-- { "role": "admin" } in their metadata gets admin status automatically.
--
-- To promote an existing user to admin, update their row directly:
--     UPDATE public.users SET role = 'admin' WHERE email = '...';
-- Or set raw_user_meta_data->>'role' = 'admin' in the Supabase Auth dashboard
-- before creating the user.

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
        COALESCE(NEW.raw_user_meta_data->>'role', 'user'),
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
