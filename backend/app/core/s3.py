"""
S3 access for redacted documents and audit records.

All object I/O goes through the backend with these helpers — the browser never
talks to the bucket (the old API Gateway proxy path is retired). Object keys
follow the existing convention: "<documentId>.<ext>".
"""

import os
from functools import lru_cache

import boto3

from app.core.settings import settings

CONTENT_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
    "rtf": "application/rtf",
}

PRESIGNED_URL_TTL_SECONDS = 300


@lru_cache
def _client():
    # Local dev: pass the explicit long-lived keys from backend/.env.
    # On Lambda: the runtime injects the execution role's TEMPORARY credentials
    # (access key + secret + *session token*) as env vars. Passing only the
    # key+secret drops the session token and fails with InvalidAccessKeyId, so
    # we let boto3's default credential chain assemble all three itself.
    kwargs = {"region_name": settings.aws_region}
    on_lambda = bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))
    if not on_lambda and settings.aws_access_key_id and settings.aws_secret_access_key:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    return boto3.client("s3", **kwargs)


def client():
    """Return the shared S3 client for other backend-owned buckets."""
    return _client()


def object_key(document_id: str, file_type: str) -> str:
    return f"{document_id}.{file_type}"


def put_redacted(key: str, body: bytes, file_type: str) -> None:
    _client().put_object(
        Bucket=settings.s3_bucket_redacted,
        Key=key,
        Body=body,
        ContentType=CONTENT_TYPES.get(file_type, "application/octet-stream"),
    )


def put_audit_log(key: str, body: bytes) -> None:
    """Write an immutable JSON audit artifact to the configured audit bucket."""
    _client().put_object(
        Bucket=settings.s3_bucket_audit,
        Key=key,
        Body=body,
        ContentType="application/json",
        ServerSideEncryption="AES256",
    )


def delete_redacted(key: str) -> None:
    _client().delete_object(Bucket=settings.s3_bucket_redacted, Key=key)


def presigned_get(key: str, filename: str, attachment: bool) -> str:
    """Short-lived GET URL; Content-Disposition controls view vs download."""
    disposition = "attachment" if attachment else "inline"
    return _client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": settings.s3_bucket_redacted,
            "Key": key,
            "ResponseContentDisposition": f'{disposition}; filename="{filename}"',
        },
        ExpiresIn=PRESIGNED_URL_TTL_SECONDS,
    )
