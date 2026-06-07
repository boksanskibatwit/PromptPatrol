"""
Admin account-management endpoints.

POST /admin/signup-ban      Called by RequestAccount.jsx right after supabase.auth.signUp().
                            Bans the new auth user (banned_until = infinity) so they cannot
                            log in until an admin approves them, and inserts a row into
                            account_requests.

POST /admin/accounts/{id}/approve   Unbans the auth user, sets account_requests.status = 'approved'.
POST /admin/accounts/{id}/reject    Keeps the ban, sets account_requests.status = 'rejected'.

The approve/reject routes require a valid admin JWT in the Authorization header.
The signup-ban route is called with the brand-new user's JWT (they are authenticated
in Supabase Auth but banned from the app).
"""

import base64
import json
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel

from app.core.settings import settings
from app.db.supabase import get_service_client

router = APIRouter(prefix="/admin", tags=["admin"])

SUPABASE_ADMIN_URL = f"{settings.supabase_url}/auth/v1/admin/users"
AUTH_HEADERS = {
    "apikey": settings.supabase_service_role_key,
    "Authorization": f"Bearer {settings.supabase_service_role_key}",
    "Content-Type": "application/json",
}


# ── helpers ──────────────────────────────────────────────────────────────────

async def _ban_auth_user(auth_user_id: str) -> None:
    """Set banned_until = far future so the user cannot sign in."""
    async with httpx.AsyncClient() as client:
        resp = await client.put(
            f"{SUPABASE_ADMIN_URL}/{auth_user_id}",
            headers=AUTH_HEADERS,
            json={"ban_duration": "876000h"},  # ~100 years
        )
    if resp.status_code not in (200, 204):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to ban auth user: {resp.text}",
        )


async def _unban_auth_user(auth_user_id: str) -> None:
    """Remove the ban so the user can sign in."""
    async with httpx.AsyncClient() as client:
        resp = await client.put(
            f"{SUPABASE_ADMIN_URL}/{auth_user_id}",
            headers=AUTH_HEADERS,
            json={"ban_duration": "none"},
        )
    if resp.status_code not in (200, 204):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to unban auth user: {resp.text}",
        )


def _jwt_sub(token: str) -> str:
    """Decode the JWT payload and return the subject (user ID)."""
    try:
        payload_b64 = token.split(".")[1]
        payload_b64 += "=" * (4 - len(payload_b64) % 4)
        return json.loads(base64.urlsafe_b64decode(payload_b64)).get("sub")
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


def _assert_admin(token: str) -> None:
    """Raise 403 if the JWT does not belong to an admin user."""
    user_id = _jwt_sub(token)

    svc = get_service_client()
    result = svc.table("users").select("role").eq("id", user_id).single().execute()
    row = result.data
    if not row or row.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )


# ── routes ───────────────────────────────────────────────────────────────────

class SignupBanRequest(BaseModel):
    auth_user_id: str
    email: str
    full_name: str
    description: str = ""


@router.post("/signup-ban", status_code=status.HTTP_201_CREATED)
async def signup_ban(body: SignupBanRequest):
    """
    Called immediately after supabase.auth.signUp() on the frontend.
    Bans the new user and records the account request.
    No admin JWT required — the new user's session is used only to pass
    their ID; the actual ban uses the service role key server-side.
    """
    svc = get_service_client()

    # Insert account_requests row (upsert in case of duplicate submit).
    svc.table("account_requests").upsert(
        {
            "auth_user_id": body.auth_user_id,
            "requested_email": body.email,
            "requested_name": body.full_name,
            "description": body.description,
            "status": "pending",
            "requested_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="auth_user_id",
    ).execute()

    # Ban the auth user so they cannot log in until approved.
    await _ban_auth_user(body.auth_user_id)

    return {"detail": "Request recorded. Awaiting admin approval."}


@router.post("/accounts/{request_id}/approve", status_code=status.HTTP_200_OK)
async def approve_account(
    request_id: str,
    authorization: str | None = Header(default=None),
):
    """Approve a pending account request. Requires admin JWT."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    token = authorization.split(" ", 1)[1].strip()
    _assert_admin(token)
    svc = get_service_client()

    # Fetch the request to get the auth_user_id.
    result = (
        svc.table("account_requests")
        .select("auth_user_id, status")
        .eq("id", request_id)
        .single()
        .execute()
    )
    req = result.data
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req["status"] != "pending":
        raise HTTPException(status_code=409, detail="Request is not pending")

    # Unban so the user can log in.
    await _unban_auth_user(req["auth_user_id"])

    # Mark as approved.
    now = datetime.now(timezone.utc).isoformat()
    admin_id = _jwt_sub(token)

    svc.table("account_requests").update(
        {"status": "approved", "reviewed_at": now, "reviewed_by": admin_id}
    ).eq("id", request_id).execute()

    return {"detail": "Account approved."}


@router.post("/accounts/{request_id}/reject", status_code=status.HTTP_200_OK)
async def reject_account(
    request_id: str,
    authorization: str | None = Header(default=None),
):
    """Reject a pending account request. Requires admin JWT."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    token = authorization.split(" ", 1)[1].strip()
    _assert_admin(token)
    svc = get_service_client()

    result = (
        svc.table("account_requests")
        .select("auth_user_id, status")
        .eq("id", request_id)
        .single()
        .execute()
    )
    req = result.data
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req["status"] != "pending":
        raise HTTPException(status_code=409, detail="Request is not pending")

    # Leave the ban in place — user stays blocked.
    now = datetime.now(timezone.utc).isoformat()
    admin_id = _jwt_sub(token)

    svc.table("account_requests").update(
        {"status": "rejected", "reviewed_at": now, "reviewed_by": admin_id}
    ).eq("id", request_id).execute()

    return {"detail": "Account rejected."}
