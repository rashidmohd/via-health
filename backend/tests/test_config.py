import pytest
from pydantic import ValidationError

from app.core.config import Settings

SA_JSON = '{"type": "service_account", "client_email": "a@b", "private_key": "k"}'


def test_default_region_is_eu() -> None:
    assert Settings().gcp_region == "europe-west4"


@pytest.mark.parametrize("region", ["us-central1", "asia-east1", "global"])
def test_non_eu_region_rejected(region: str) -> None:
    with pytest.raises(ValidationError):
        Settings(gcp_region=region)


@pytest.mark.parametrize(
    "url",
    ["postgres://u:p@host:5432/db", "postgresql://u:p@host:5432/db"],
)
def test_railway_database_url_uses_psycopg(url: str) -> None:
    assert Settings(database_url=url).database_url == "postgresql+psycopg://u:p@host:5432/db"


def test_prod_requires_real_auth_secret_and_resend() -> None:
    with pytest.raises(ValidationError):
        Settings(app_env="prod")
    with pytest.raises(ValidationError):
        Settings(app_env="prod", auth_secret="x" * 40, email_sender="console")
    ok = Settings(
        app_env="prod",
        auth_secret="x" * 40,
        email_sender="resend",
        resend_api_key="k",
        client_data_key="ab" * 32,
        object_store="gcs",
        kms_provider="gcp",
        stt_provider="google",
        gcs_bucket="b",
        kms_key_name="projects/p/locations/europe-west4/keyRings/r/cryptoKeys/k",
        gcp_project_id="p",
        google_application_credentials_json=SA_JSON,
        llm_provider="vertex",
    )
    assert ok.secure_cookies


def test_prod_refuses_gemini_developer_api() -> None:
    with pytest.raises(ValidationError, match="ADR 0005"):
        Settings(
            app_env="prod",
            auth_secret="x" * 40,
            email_sender="resend",
            resend_api_key="k",
            client_data_key="ab" * 32,
            object_store="gcs",
            kms_provider="gcp",
            stt_provider="google",
            gcs_bucket="b",
            kms_key_name="projects/p/locations/europe-west4/keyRings/r/cryptoKeys/k",
            gcp_project_id="p",
            google_application_credentials_json=SA_JSON,
            llm_provider="gemini_api",
        )


def test_staging_is_strict_but_allows_gemini_api() -> None:
    with pytest.raises(ValidationError):
        Settings(app_env="staging")
    staging = Settings(
        app_env="staging",
        auth_secret="x" * 40,
        email_sender="resend",
        resend_api_key="k",
        client_data_key="ab" * 32,
        object_store="gcs",
        kms_provider="gcp",
        stt_provider="google",
        gcs_bucket="b",
        kms_key_name="projects/p/locations/europe-west4/keyRings/r/cryptoKeys/k",
        gcp_project_id="p",
        google_application_credentials_json=SA_JSON,
        llm_provider="gemini_api",
    )
    assert staging.secure_cookies


def test_staging_requires_google_backends() -> None:
    with pytest.raises(ValidationError, match="OBJECT_STORE=gcs"):
        Settings(
            app_env="staging",
            auth_secret="x" * 40,
            email_sender="resend",
            resend_api_key="k",
            client_data_key="ab" * 32,
        )


@pytest.mark.parametrize(
    "field,value",
    [
        ("stt_location", "us"),
        ("kms_key_name", "projects/p/locations/us-east1/keyRings/r/cryptoKeys/k"),
    ],
)
def test_google_locations_must_be_eu(field: str, value: str) -> None:
    with pytest.raises(ValidationError):
        Settings(**{field: value})  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "raw,message",
    [
        ("", "missing"),
        ('{"type": "service_account", "private', "not valid JSON"),
        ('{"type": "authorized_user"}', "not a service-account key"),
    ],
)
def test_staging_checks_credentials_json(raw: str, message: str) -> None:
    with pytest.raises(ValidationError, match=message) as info:
        Settings(
            app_env="staging",
            auth_secret="x" * 40,
            email_sender="resend",
            resend_api_key="k",
            client_data_key="ab" * 32,
            object_store="gcs",
            kms_provider="gcp",
            stt_provider="google",
            gcs_bucket="b",
            gcp_project_id="p",
            kms_key_name="projects/p/locations/europe-west4/keyRings/r/cryptoKeys/k",
            google_application_credentials_json=raw,
        )
    assert (
        "private" not in str(info.value).split("input_value")[0].lower()
        or message != "not valid JSON"
    )
