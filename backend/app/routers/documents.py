"""
Document upload / redaction / retrieval endpoints.

The original (un-redacted) file is NEVER persisted: it arrives in the request
body, passes through the redaction engine in memory, and only the redacted
artifact is written to S3. DB writes follow the RLS design from the migrations:
per-user rows go through the caller's JWT (get_user_client), while
redacted_documents and redaction_candidates inserts use the service role, as
migrations 06/07 reserve them for the backend.

POST   /documents/analyze          file -> findings for the review screen
POST   /documents/redact           file + decisions -> S3 object + DB rows
GET    /documents/{id}/download    -> short-lived presigned URL (view/download)
DELETE /documents/{id}             -> removes the S3 object and the DB rows
"""

import hashlib
import json
import logging
from datetime import datetime, timezone

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.core.audit import append_redaction_audit_log
from app.core import s3
from app.db.supabase import get_service_client, _client_for_token
from app.ml import engine

router = APIRouter(prefix="/documents", tags=["documents"])
logger = logging.getLogger(__name__)

SUPPORTED_EXTS = {"pdf", "docx", "txt", "rtf"}
PERSISTABLE_ENTITY_TYPES = {
    "person_name",
    "company_name",
    "location",
    "date_of_birth",
    "ssn",
    "account_number",
    "credit_card",
    "routing_number",
    "date",
    "email",
    "phone_number",
}


# ── auth helpers ─────────────────────────────────────────────────────────────

def _bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    return authorization.split(" ", 1)[1].strip()


def _authenticated_user(token: str):
    """Validate the JWT against Supabase Auth and return the user."""
    try:
        res = get_service_client().auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if not res or not res.user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return res.user


def _validated_ext(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in SUPPORTED_EXTS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f'Unsupported file type ".{ext}". Allowed: {", ".join(sorted(SUPPORTED_EXTS))}.',
        )
    return ext


# ── routes ───────────────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze_document(
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """Run the detection engine and return findings for the review screen."""
    _authenticated_user(_bearer_token(authorization))
    ext = _validated_ext(file.filename or "")
    data = await file.read()
    try:
        pages = engine.analyze(data, ext)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    return {"pages": [p.model_dump() for p in pages]}


class CandidateDecision(engine.Candidate):
    decision: str  # 'confirmed' | 'rejected'


@router.post("/redact", status_code=status.HTTP_201_CREATED)
async def redact_document(
    file: UploadFile = File(...),
    candidates: str = Form("[]"),  # JSON array of CandidateDecision
    authorization: str | None = Header(default=None),
):
    """Apply redactions, store the artifact in S3, and record all DB rows."""
    token = _bearer_token(authorization)
    user = _authenticated_user(token)
    ext = _validated_ext(file.filename or "")

    try:
        decisions = [CandidateDecision(**c) for c in json.loads(candidates)]
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Malformed candidates payload")

    data = await file.read()
    accepted = [c for c in decisions if c.decision == "confirmed"]
    try:
        redacted = engine.apply(data, ext, accepted)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    now = datetime.now(timezone.utc).isoformat()

    # 1. Metadata row as the caller, so RLS owner checks apply.
    user_db = _client_for_token(token)
    doc_result = (
        user_db.table("documents")
        .insert(
            {
                "owner_id": user.id,
                "original_filename": file.filename,
                "file_type": ext,
                "size_bytes": len(data),
                "status": "stored",
                "sha256_input": hashlib.sha256(data).hexdigest(),
                "sha256_output": hashlib.sha256(redacted).hexdigest(),
                "completed_at": now,
            }
        )
        .execute()
    )
    if not doc_result.data:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to create document row")
    doc = doc_result.data[0]
    key = s3.object_key(doc["id"], ext)

    def _rollback_doc():
        user_db.table("documents").delete().eq("id", doc["id"]).execute()

    # 2. Store ONLY the redacted artifact.
    try:
        s3.put_redacted(key, redacted, ext)
    except (BotoCoreError, ClientError) as exc:
        logger.exception("S3 upload failed for document %s", doc["id"])
        _rollback_doc()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"S3 upload failed: {exc}")

    # 3. Service-role rows (reserved for the backend by migrations 06/07).
    svc = get_service_client()
    try:
        svc.table("redacted_documents").insert(
            {
                "source_document_id": doc["id"],
                "s3_bucket": s3.settings.s3_bucket_redacted,
                "s3_object_key": key,
                "file_type": ext,
                "size_bytes": len(redacted),
                "written_to_s3_at": now,
            }
        ).execute()
        persisted_decisions = [
            c for c in decisions if c.entity in PERSISTABLE_ENTITY_TYPES
        ]
        if persisted_decisions:
            svc.table("redaction_candidates").insert(
                [
                    {
                        "document_id": doc["id"],
                        "entity_type": c.entity,
                        "detection_source": c.source,
                        "matched_text": c.text,
                        "start_offset": c.start_offset,
                        "end_offset": c.end_offset,
                        "confidence": c.confidence,
                        "page_number": c.page,
                        "review_status": c.decision,
                        "reviewed_at": now,
                    }
                    for c in persisted_decisions
                ]
            ).execute()
    except Exception as exc:
        logger.exception("Failed to record redaction rows for document %s", doc["id"])
        try:
            s3.delete_redacted(key)
        except (BotoCoreError, ClientError):
            pass  # best effort — the doc row removal below unlinks it regardless
        _rollback_doc()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to record redaction: {exc}")

    return {"document_id": doc["id"], "s3_object_key": key}


@router.get("/{document_id}/download")
async def download_document(
    document_id: str,
    attachment: bool = False,
    authorization: str | None = Header(default=None),
):
    """Return a short-lived presigned URL. RLS guarantees ownership."""
    token = _bearer_token(authorization)
    _authenticated_user(token)

    user_db = _client_for_token(token)
    result = (
        user_db.table("documents")
        .select("id, original_filename, file_type")
        .eq("id", document_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    doc = result.data[0]

    url = s3.presigned_get(
        s3.object_key(doc["id"], doc["file_type"]),
        doc["original_filename"],
        attachment,
    )
    return {"url": url}


@router.delete("/{document_id}")
async def delete_document(
    document_id: str,
    authorization: str | None = Header(default=None),
):
    """Delete the S3 object, then the DB rows (cascade covers the rest)."""
    token = _bearer_token(authorization)
    _authenticated_user(token)

    user_db = _client_for_token(token)
    result = (
        user_db.table("documents")
        .select("id, file_type")
        .eq("id", document_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    doc = result.data[0]

    try:
        s3.delete_redacted(s3.object_key(doc["id"], doc["file_type"]))
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"S3 delete failed: {exc}")

    user_db.table("documents").delete().eq("id", document_id).execute()
    return {"detail": "Document deleted."}
