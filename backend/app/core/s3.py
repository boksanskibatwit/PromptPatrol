"""
S3 access for redacted documents.

All object I/O goes through the backend with these helpers — the browser never
talks to the bucket (the old API Gateway proxy path is retired). Object keys
follow the existing convention: "<documentId>.<ext>".
"""

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
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
    )


def object_key(document_id: str, file_type: str) -> str:
    return f"{document_id}.{file_type}"


def put_redacted(key: str, body: bytes, file_type: str) -> None:
    _client().put_object(
        Bucket=settings.s3_bucket_redacted,
        Key=key,
        Body=body,
        ContentType=CONTENT_TYPES.get(file_type, "application/octet-stream"),
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
