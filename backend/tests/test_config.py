import pytest
from pydantic import ValidationError

from app.core.config import Settings


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
    )
    assert ok.secure_cookies
