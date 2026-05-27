from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    environment: str = "development"
    log_level: str = "INFO"
    allowed_origins: list[str] = ["http://localhost:5173"]

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