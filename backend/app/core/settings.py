from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    environment: str = "development"
    log_level: str = "INFO"
    # NoDecode stops pydantic-settings from JSON-parsing the env value; the
    # validator below accepts the comma-separated form documented in
    # .env.example (e.g. "http://localhost:5173,https://app.example.com").
    allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, v):
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    # Database
    database_url: str

    # Supabase
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str

    # JWT
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60

    # AWS / S3
    aws_region: str = "us-east-1"
    aws_access_key_id: str
    aws_secret_access_key: str
    s3_bucket_redacted: str = "promptpatrol-redacted"
    s3_bucket_audit: str = "promptpatrol-audit"

    # ML service (internal)
    ml_service_url: str = "http://ml-service:8001"
    ml_service_secret: str


settings = Settings()  # type: ignore[call-arg]