"""
PromptPatrol audit logging helpers.

Purpose:
    - Build a sanitized audit event for completed document redactions.
    - Preserve the existing audit_log_entries hash-chain design.
    - Insert audit rows using the Supabase service-role client.
    - Store a JSON copy of each audit event in the configured S3 audit bucket.

Important privacy rule:
    Do not store raw matched PII in the audit log payload. The redaction index
    records entity type, page, offsets, confidence, source, and decision only.
"""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence

from app.core import s3
from app.core.settings import settings
from app.db.supabase import get_service_client


AUDIT_ACTION_REDACT = "REDACT"
DEFAULT_AUDIT_PREFIX = "audit-logs"


@dataclass(frozen=True)
class AuditWriteResult:
    """Return value after an audit row is appended."""

    audit_event_id: str
    audit_row_id: int | None
    action: str
    document_id: str
    s3_audit_bucket: str | None
    s3_audit_key: str
    s3_uploaded: bool
    row_hash: str
    prev_id: int | None
    prev_hash: str | None


def append_redaction_audit_log(
    *,
    user_id: str,
    document: Mapping[str, Any],
    decisions: Sequence[Any],
    redacted_s3_bucket: str | None = None,
    redacted_s3_key: str | None = None,
    ip_address: str | None = None,
    occurred_at: datetime | str | None = None,
    service_client: Any | None = None,
) -> AuditWriteResult:
    """
    Append one immutable audit entry for a successful redaction.

    Intended caller:
        backend/app/routers/documents.py inside POST /documents/redact,
        after the document row, redacted_documents row, and redaction_candidates
        rows have been written successfully.

    Args:
        user_id:
            Authenticated Supabase user id.
        document:
            The inserted documents row from Supabase. Expected keys include:
            id, original_filename, file_type, size_bytes, sha256_input,
            sha256_output, completed_at.
        decisions:
            CandidateDecision objects from documents.py. Raw matched text is
            intentionally omitted from the audit payload.
        redacted_s3_bucket:
            Bucket containing the redacted artifact. Usually
            settings.s3_bucket_redacted.
        redacted_s3_key:
            Object key for the redacted artifact, e.g. "<document_id>.pdf".
        ip_address:
            Optional requester IP address from the FastAPI Request object.
        occurred_at:
            Optional event timestamp. Defaults to now in UTC.
        service_client:
            Optional Supabase service-role client. If omitted, this function
            calls get_service_client().

    Returns:
        AuditWriteResult containing row/hash/S3 upload details.
    """

    svc = service_client or get_service_client()
    event_time = _normalize_timestamp(occurred_at)

    document_id = _required_str(document, "id")
    audit_event_id = str(uuid.uuid4())

    redaction_index = build_redaction_index(decisions)
    entities_flagged = len(redaction_index)
    entities_redacted = sum(1 for item in redaction_index if item.get("review_status") == "confirmed")

    audit_s3_key = build_audit_s3_key(
        occurred_at=event_time,
        user_id=user_id,
        document_id=document_id,
        audit_event_id=audit_event_id,
    )

    audit_payload = build_redaction_audit_payload(
        audit_event_id=audit_event_id,
        user_id=user_id,
        document=document,
        redaction_index=redaction_index,
        redacted_s3_bucket=redacted_s3_bucket,
        redacted_s3_key=redacted_s3_key,
        audit_s3_key=audit_s3_key,
        occurred_at=event_time,
    )

    s3_result = upload_audit_json_to_s3(
        audit_payload=audit_payload,
        audit_s3_key=audit_s3_key,
    )

    prev = get_previous_audit_row(svc)
    prev_id = prev.get("id") if prev else None
    prev_hash = prev.get("row_hash") if prev else None

    row_without_hash = {
        "user_id": user_id,
        "document_id": document_id,
        "action": AUDIT_ACTION_REDACT,
        "ip_address": ip_address,
        "metadata": audit_payload,
        "entities_flagged": entities_flagged,
        "entities_redacted": entities_redacted,
        "prev_id": prev_id,
        "prev_hash": prev_hash,
        "occurred_at": event_time,
    }

    row_hash = sha256_json(row_without_hash)

    row_to_insert = {
        **row_without_hash,
        "row_hash": row_hash,
    }

    result = svc.table("audit_log_entries").insert(row_to_insert).execute()
    inserted = getattr(result, "data", None) or []
    audit_row_id = inserted[0].get("id") if inserted else None

    return AuditWriteResult(
        audit_event_id=audit_event_id,
        audit_row_id=audit_row_id,
        action=AUDIT_ACTION_REDACT,
        document_id=document_id,
        s3_audit_bucket=s3_result["bucket"],
        s3_audit_key=audit_s3_key,
        s3_uploaded=s3_result["uploaded"],
        row_hash=row_hash,
        prev_id=prev_id,
        prev_hash=prev_hash,
    )


def build_redaction_index(decisions: Sequence[Any]) -> list[dict[str, Any]]:
    """
    Convert CandidateDecision objects into a safe JSON redaction index.

    This intentionally excludes candidate.text / matched_text because that may
    contain PII. Store offsets, page number, entity type, confidence, source,
    and decision instead.
    """

    redaction_index: list[dict[str, Any]] = []

    for number, candidate in enumerate(decisions, start=1):
        entity = _candidate_value(candidate, "entity")
        decision = _candidate_value(candidate, "decision", default="pending")
        start_offset = _candidate_value(candidate, "start_offset", default=None)
        end_offset = _candidate_value(candidate, "end_offset", default=None)

        redaction_index.append(
            {
                "redaction_number": number,
                "candidate_id": _candidate_value(candidate, "id", default=None),
                "entity_type": entity,
                "detection_source": _candidate_value(candidate, "source", default=None),
                "page_number": _candidate_value(candidate, "page", default=1),
                "start_offset": start_offset,
                "end_offset": end_offset,
                "span_length": _span_length(start_offset, end_offset),
                "confidence": _candidate_value(candidate, "confidence", default=None),
                "review_status": decision,
            }
        )

    return redaction_index


def build_redaction_audit_payload(
    *,
    audit_event_id: str,
    user_id: str,
    document: Mapping[str, Any],
    redaction_index: Sequence[Mapping[str, Any]],
    redacted_s3_bucket: str | None,
    redacted_s3_key: str | None,
    audit_s3_key: str,
    occurred_at: str,
) -> dict[str, Any]:
    """Build the JSON payload stored in audit_log_entries.metadata and S3."""

    redaction_index_list = [dict(item) for item in redaction_index]

    return {
        "audit_event_id": audit_event_id,
        "action": AUDIT_ACTION_REDACT,
        "occurred_at": occurred_at,
        "app_version": os.environ.get("APP_VERSION", "development"),
        "privacy_note": "Raw matched PII is intentionally excluded from this audit payload.",
        "user": {
            "user_id": user_id,
        },
        "document": {
            "document_id": _required_str(document, "id"),
            "original_filename": document.get("original_filename"),
            "file_type": document.get("file_type"),
            "original_size_bytes": document.get("size_bytes"),
            "original_sha256": document.get("sha256_input"),
            "redacted_sha256": document.get("sha256_output"),
            "completed_at": document.get("completed_at"),
        },
        "redacted_artifact": {
            "s3_bucket": redacted_s3_bucket,
            "s3_key": redacted_s3_key,
        },
        "audit_artifact": {
            "s3_bucket": settings.s3_bucket_audit,
            "s3_key": audit_s3_key,
            "upload_status": "uploaded",
        },
        "redaction_summary": {
            "entities_flagged": len(redaction_index_list),
            "entities_redacted": sum(
                1 for item in redaction_index_list if item.get("review_status") == "confirmed"
            ),
            "entities_rejected": sum(
                1 for item in redaction_index_list if item.get("review_status") == "rejected"
            ),
            "redaction_index_sha256": sha256_json(redaction_index_list),
        },
        "redaction_index": redaction_index_list,
    }


def build_audit_s3_key(
    *,
    occurred_at: datetime | str,
    user_id: str,
    document_id: str,
    audit_event_id: str,
    prefix: str = DEFAULT_AUDIT_PREFIX,
) -> str:
    """Create the intended S3 key for the audit JSON object."""

    dt = _parse_timestamp(occurred_at)
    safe_user_id = _safe_path_part(user_id)
    safe_document_id = _safe_path_part(document_id)

    return (
        f"{prefix}/"
        f"year={dt.year:04d}/"
        f"month={dt.month:02d}/"
        f"day={dt.day:02d}/"
        f"user_id={safe_user_id}/"
        f"document_id={safe_document_id}/"
        f"{audit_event_id}.json"
    )


def upload_audit_json_to_s3(
    *,
    audit_payload: Mapping[str, Any],
    audit_s3_key: str,
) -> dict[str, Any]:
    """Serialize and upload an audit event to the configured S3 bucket."""

    body = json.dumps(
        audit_payload,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    s3.put_audit_log(audit_s3_key, body)

    return {
        "uploaded": True,
        "bucket": settings.s3_bucket_audit,
        "key": audit_s3_key,
        "status": "uploaded",
    }


def get_previous_audit_row(service_client: Any) -> dict[str, Any] | None:
    """Fetch the latest audit row to continue the hash chain."""

    result = (
        service_client.table("audit_log_entries")
        .select("id,row_hash")
        .order("id", desc=True)
        .limit(1)
        .execute()
    )

    rows = getattr(result, "data", None) or []
    return rows[0] if rows else None


def sha256_json(value: Any) -> str:
    """Stable SHA-256 hash for JSON-compatible objects."""

    canonical = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _candidate_value(candidate: Any, name: str, default: Any = None) -> Any:
    """Read a field from either a Pydantic model, dataclass, or dict."""

    if isinstance(candidate, Mapping):
        return candidate.get(name, default)
    return getattr(candidate, name, default)


def _span_length(start_offset: Any, end_offset: Any) -> int | None:
    try:
        if start_offset is None or end_offset is None:
            return None
        return max(0, int(end_offset) - int(start_offset))
    except (TypeError, ValueError):
        return None


def _required_str(mapping: Mapping[str, Any], key: str) -> str:
    value = mapping.get(key)
    if value is None or value == "":
        raise ValueError(f"Missing required audit field: {key}")
    return str(value)


def _normalize_timestamp(value: datetime | str | None) -> str:
    if value is None:
        return datetime.now(timezone.utc).isoformat()
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()
    return value


def _parse_timestamp(value: datetime | str) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _safe_path_part(value: str) -> str:
    """Keep S3 key path sections predictable."""

    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in str(value))
