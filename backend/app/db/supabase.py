"""
Two clients, by design, matching the RLS policies written into the migrations:

  get_user_client    -> request scoped. Carries the caller's Supabase Auth JWT
                        so PostgREST runs as the `authenticated` role and RLS
                        evaluates auth.uid() as that user. Use for ALL normal
                        per-user reads/writes (e.g. a user's own documents,
                        which migration 05 scopes with owner_id = auth.uid()).

  get_service_client -> singleton using the service role key. BYPASSES RLS.
                        Use ONLY for the privileged backend operations the
                        migrations reserved for the service role:
                          * inserting into audit_log_entries (migration 08 has
                            no INSERT policy for any client service role only)
                          * admin-wide queries
                        Never hand this to a route acting on behalf of a user.

Requires the `supabase` package (add `supabase` to requirements.txt).
"""
from functools import lru_cache

from fastapi import Header, HTTPException, status
from supabase import Client, create_client

from app.core.settings import settings


# Service role client  (singleton, bypasses RLS)

@lru_cache
def get_service_client() -> Client:
    """Privileged client. Bypasses RLS. Audit-log writes + admin reads only."""
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
    )


# Peruser client  (request-scoped, RLS applies as the caller)

def _client_for_token(access_token: str) -> Client:
    """Build an anon client and attach the user's JWT so RLS sees auth.uid()."""
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    client.postgrest.auth(access_token)
    return client


async def get_user_client(
    authorization: str | None = Header(default=None),
) -> Client:
    """
    FastAPI dependency. Pulls the Bearer token off the Authorization header and
    returns a Supabase client scoped to that user, so RLS enforces peruser
    access at the database layer.

    Inject into any user-facing route:

        @router.get("/documents")
        async def list_documents(sb: Client = Depends(get_user_client)):
            return sb.table("documents").select("*").execute().data
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header",
        )
    access_token = authorization.split(" ", 1)[1].strip()
    return _client_for_token(access_token)