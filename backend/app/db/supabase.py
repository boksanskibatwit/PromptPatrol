"""
Supabase client helpers.

  get_service_client  -> singleton using the service role key. BYPASSES RLS.
  _client_for_token   -> per-request client carrying the caller's JWT (RLS applies).
"""
from functools import lru_cache

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


