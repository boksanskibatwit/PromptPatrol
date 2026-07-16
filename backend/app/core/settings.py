from pathlib import Path
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from app.core.secrets import load_ssm_parameters_into_env


BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    # NoDecode stops pydantic-settings from JSON-parsing the env value; the
    # validator below accepts the comma-separated form documented in
    # .env.example (e.g. "http://localhost:5173,https://app.example.com").
    allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, v):
        if isinstance(v, str):
            v = v.strip().removeprefix("[").removesuffix("]")
            return [o.strip().strip('"').strip("'") for o in v.split(",") if o.strip()]
        return v

    # Supabase
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str

    # AWS / S3
    # Region is auto-provided by Lambda (the reserved AWS_REGION env var) and by
    # backend/.env locally. Access keys are used ONLY for local dev — on Lambda
    # they're absent and boto3 falls back to the function's execution role.
    aws_region: str = "us-east-1"
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    s3_bucket_redacted: str = "prompt-patrol-doc-storage"
    s3_bucket_audit: str = "promptpatrol-audit"


# On Lambda this pulls secrets from SSM into the environment first; locally it's
# a no-op and Settings reads backend/.env as before.
load_ssm_parameters_into_env()
settings = Settings()  # type: ignore[call-arg]
