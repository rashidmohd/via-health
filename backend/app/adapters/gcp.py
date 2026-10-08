"""Google credentials. On Railway the service-account key comes from an env var and is
parsed in memory (never written to disk); locally the Google libraries read the file named
by GOOGLE_APPLICATION_CREDENTIALS."""

import json
from functools import lru_cache
from typing import Any

from google.oauth2 import service_account

from app.core.config import get_settings


@lru_cache
def gcp_credentials() -> Any | None:
    raw = get_settings().google_application_credentials_json
    if not raw:
        return None  # application default credentials
    return service_account.Credentials.from_service_account_info(json.loads(raw))
