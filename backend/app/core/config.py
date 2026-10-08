from functools import lru_cache
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Rule 4: every cloud resource lives in an EU region.
EU_REGION_PREFIXES = ("europe-",)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", ".env.local"), extra="ignore")

    app_env: Literal["dev", "prod", "test"] = "dev"
    database_url: str = "postgresql+psycopg://localhost/sessio"
    redis_url: str = "redis://localhost:6379"
    web_origin: str = "http://localhost:5173"

    gcp_project_id: str = ""
    gcp_region: str = "europe-west4"
    object_store: Literal["gcs", "r2"] = "gcs"
    stt_model: str = "chirp_3"
    llm_model: str = ""

    audio_max_retention_days: int = 30

    # Login (ADR 0003). AUTH_SECRET keys the HMACs for codes, emails and session tokens.
    auth_secret: str = "dev-only-insecure-auth-secret-change-me"  # noqa: S105 (rejected in prod)
    email_sender: Literal["console", "resend"] = "console"
    resend_api_key: str = ""
    email_from: str = "Sessio <login@example.com>"

    @property
    def secure_cookies(self) -> bool:
        return self.app_env == "prod"

    @field_validator("database_url")
    @classmethod
    def use_psycopg_driver(cls, value: str) -> str:
        # Railway provides postgres:// or postgresql://; we use psycopg 3.
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value.removeprefix(prefix)
        return value

    @field_validator("gcp_region")
    @classmethod
    def region_must_be_eu(cls, value: str) -> str:
        if not value.startswith(EU_REGION_PREFIXES):
            raise ValueError("GCP_REGION must be an EU region")
        return value

    @model_validator(mode="after")
    def prod_requires_real_secrets(self) -> "Settings":
        if self.app_env == "prod":
            if self.auth_secret.startswith("dev-only") or len(self.auth_secret) < 32:
                raise ValueError("AUTH_SECRET must be set (32+ characters) in prod")
            if self.email_sender != "resend" or not self.resend_api_key:
                raise ValueError("EMAIL_SENDER=resend and RESEND_API_KEY are required in prod")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
