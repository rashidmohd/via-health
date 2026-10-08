import json
from functools import lru_cache
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Rule 4: every cloud resource lives in an EU region.
EU_REGION_PREFIXES = ("europe-",)

DEV_CLIENT_DATA_KEY = "00" * 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", ".env.local"), extra="ignore")

    # staging: hosted like prod (real secrets, secure cookies) but test data only.
    app_env: Literal["dev", "staging", "prod", "test"] = "dev"
    database_url: str = "postgresql+psycopg://localhost/sessio"
    redis_url: str = "redis://localhost:6379"
    web_origin: str = "http://localhost:5173"

    gcp_project_id: str = ""
    gcp_region: str = "europe-west4"
    # Service-account key as JSON text (Railway). Locally GOOGLE_APPLICATION_CREDENTIALS
    # (a file path) is used by the Google libraries instead.
    google_application_credentials_json: str = ""

    # Interim implementations (postgres / local / fake) are for local dev and tests only.
    object_store: Literal["postgres", "gcs"] = "postgres"
    gcs_bucket: str = ""
    kms_provider: Literal["local", "gcp"] = "local"
    kms_key_name: str = ""
    stt_provider: Literal["fake", "google"] = "fake"
    stt_model: str = "chirp_3"
    stt_location: str = "eu"  # Chirp 3 is not available in europe-west4 (verified 2026-10-08)
    llm_model: str = ""
    # ADR 0005: the Gemini Developer API is not EU-pinned; dev with test data only.
    llm_provider: Literal["gemini_api", "vertex"] = "gemini_api"

    audio_max_retention_days: int = 30

    # Login (ADR 0003). AUTH_SECRET keys the HMACs for codes, emails and session tokens.
    auth_secret: str = "dev-only-insecure-auth-secret-change-me"  # noqa: S105 (rejected in prod)
    email_sender: Literal["console", "resend"] = "console"
    resend_api_key: str = ""
    email_from: str = "Sessio <login@example.com>"

    # ADR 0004: interim server key for client identity and signatures (64 hex chars).
    client_data_key: str = DEV_CLIENT_DATA_KEY

    @property
    def secure_cookies(self) -> bool:
        return self.app_env in ("staging", "prod")

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

    @field_validator("stt_location")
    @classmethod
    def stt_location_must_be_eu(cls, value: str) -> str:
        if value != "eu" and not value.startswith(EU_REGION_PREFIXES):
            raise ValueError("STT_LOCATION must be in the EU")
        return value

    @field_validator("kms_key_name")
    @classmethod
    def kms_key_must_be_eu(cls, value: str) -> str:
        if value and "/locations/europe-" not in value:
            raise ValueError("KMS_KEY_NAME must be in an EU location")
        return value

    @model_validator(mode="after")
    def prod_requires_real_secrets(self) -> "Settings":
        if self.app_env in ("staging", "prod"):
            if self.auth_secret.startswith("dev-only") or len(self.auth_secret) < 32:
                raise ValueError("AUTH_SECRET must be set (32+ characters) in staging/prod")
            if self.email_sender != "resend":
                raise ValueError(
                    f"EMAIL_SENDER must be 'resend' in staging/prod (it is '{self.email_sender}')"
                )
            if not self.resend_api_key.strip():
                raise ValueError("RESEND_API_KEY is empty or missing in staging/prod")
            if self.client_data_key == DEV_CLIENT_DATA_KEY:
                raise ValueError("CLIENT_DATA_KEY must be set in staging/prod")
            if (self.object_store, self.kms_provider, self.stt_provider) != (
                "gcs",
                "gcp",
                "google",
            ):
                raise ValueError(
                    "OBJECT_STORE=gcs, KMS_PROVIDER=gcp and STT_PROVIDER=google are required "
                    "in staging/prod"
                )
            if not (self.gcs_bucket and self.kms_key_name and self.gcp_project_id):
                raise ValueError("GCS_BUCKET, KMS_KEY_NAME and GCP_PROJECT_ID are required")
            _check_service_account_json(self.google_application_credentials_json)
            if self.app_env == "prod" and self.llm_provider != "vertex":
                raise ValueError("LLM_PROVIDER=vertex (EU) is required in prod (ADR 0005)")
        return self

    @field_validator("client_data_key")
    @classmethod
    def key_is_32_bytes_hex(cls, value: str) -> str:
        try:
            if len(bytes.fromhex(value)) == 32:
                return value
        except ValueError:
            pass
        raise ValueError("CLIENT_DATA_KEY must be 64 hex characters (32 bytes)")


def _check_service_account_json(raw: str) -> None:
    """Fail at startup with a clear message; never include the key in the message."""
    if not raw.strip():
        raise ValueError("GOOGLE_APPLICATION_CREDENTIALS_JSON is missing in staging/prod")
    try:
        info = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON (position {exc.pos}); "
            "paste the whole key file again"
        ) from None
    missing = [k for k in ("type", "client_email", "private_key") if not info.get(k)]
    if info.get("type") != "service_account" or missing:
        raise ValueError(
            "GOOGLE_APPLICATION_CREDENTIALS_JSON is not a service-account key "
            f"(missing: {', '.join(missing) or 'type=service_account'})"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
