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
    if resp.status_code == 404:
        # The stored auth_user_id points to no real auth user — typically an
        # orphan request from a duplicate-email signup (Supabase returned a fake
        # user id). It can never be approved; the admin should reject it instead.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This request's auth user no longer exists — it's likely a "
                "duplicate signup for an email that already has an account. "
                "Reject this request instead of approving it."
            ),
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

    # Reject a signup whose email belongs to a LIVE account. Careful: the
    # on_auth_user_created trigger inserts a public.users row for THIS signup
    # (id == body.auth_user_id) before we run, so we must only reject when a
    # users row holds this email under a DIFFERENT id. That row is guaranteed
    # to be a live account: the trigger reclaims orphaned rows (auth user
    # deleted) for this email before inserting, so stale rows can't false-
    # positive here — which is what makes a deleted account's email reusable.
    existing = (
        svc.table("users")
        .select("id")
        .eq("email", body.email)
        .neq("id", body.auth_user_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists. Try logging in or resetting your password.",
        )

    # Clear stale request rows left by prior (since-deleted or superseded)
    # accounts on this email, so the admin queue never shows ghosts and the
    # upsert below can't create a duplicate-email second row.
    svc.table("account_requests").delete().eq("requested_email", body.email).neq(
        "auth_user_id", body.auth_user_id
    ).execute()

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


@router.post("/users/{user_id}/reset-mfa", status_code=status.HTTP_200_OK)
async def reset_mfa(
    user_id: str,
    authorization: str | None = Header(default=None),
):
    """Remove all MFA factors for a user and clear their mfa_secret. Requires admin JWT."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    token = authorization.split(" ", 1)[1].strip()
    _assert_admin(token)

    factors_url = f"{settings.supabase_url}/auth/v1/admin/users/{user_id}/factors"

    async with httpx.AsyncClient() as client:
        # Fetch all enrolled MFA factors.
        list_resp = await client.get(factors_url, headers=AUTH_HEADERS)
        if list_resp.status_code not in (200, 204):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to list MFA factors: {list_resp.text}",
            )
        factors = list_resp.json() if list_resp.content else []

        # Delete each factor.
        for factor in factors:
            factor_id = factor.get("id")
            if not factor_id:
                continue
            del_resp = await client.delete(
                f"{factors_url}/{factor_id}",
                headers=AUTH_HEADERS,
            )
            if del_resp.status_code not in (200, 204):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Failed to delete MFA factor {factor_id}: {del_resp.text}",
                )

    # Clear the stored MFA secret in the public users table.
    get_service_client().table("users").update({"mfa_secret": None}).eq("id", user_id).execute()

    return {"detail": "MFA reset successfully."}


@router.post("/users/{user_id}/reset-password", status_code=status.HTTP_200_OK)
async def reset_password(
    user_id: str,
    authorization: str | None = Header(default=None),
):
    """Generate a password reset link and email it to the user. Requires admin JWT."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    token = authorization.split(" ", 1)[1].strip()
    _assert_admin(token)

    async with httpx.AsyncClient() as client:
        user_resp = await client.get(
            f"{SUPABASE_ADMIN_URL}/{user_id}",
            headers=AUTH_HEADERS,
        )
        if user_resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to fetch user: {user_resp.text}",
            )
        user_email = user_resp.json().get("email")
        if not user_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User has no email address.",
            )

    async with httpx.AsyncClient() as client:
        link_resp = await client.post(
            f"{settings.supabase_url}/auth/v1/admin/generate_link",
            headers=AUTH_HEADERS,
            json={
                "type": "recovery",
                "email": user_email,
            },
        )
        if link_resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to generate reset link: {link_resp.text}",
            )

    return {"detail": "Password reset email sent."}


@router.delete("/users/{user_id}", status_code=status.HTTP_200_OK)
async def delete_user(
    user_id: str,
    authorization: str | None = Header(default=None),
):
    """Permanently delete a user. Requires admin JWT. Admins cannot delete themselves."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    token = authorization.split(" ", 1)[1].strip()
    _assert_admin(token)

    admin_id = _jwt_sub(token)
    if admin_id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Admins cannot delete themselves.")

    svc = get_service_client()

    # Delete public.users row first (cascades sessions and documents).
    result = svc.table("users").delete().eq("id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found.")

    # Remove their account_requests row too — a leftover row would show a ghost
    # entry in the admin queue and (before the signup guard was fixed) blocked
    # the email from ever being registered again.
    svc.table("account_requests").delete().eq("auth_user_id", user_id).execute()

    # Delete from Supabase Auth so the account is fully removed.
    async with httpx.AsyncClient() as client:
        resp = await client.delete(
            f"{SUPABASE_ADMIN_URL}/{user_id}",
            headers=AUTH_HEADERS,
        )
    if resp.status_code not in (200, 204):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"User removed from app but auth deletion failed: {resp.text}",
        )

    return {"detail": "User deleted."}
