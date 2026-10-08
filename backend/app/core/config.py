from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Rule 4: every cloud resource lives in an EU region.
EU_REGION_PREFIXES = ("europe-",)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
