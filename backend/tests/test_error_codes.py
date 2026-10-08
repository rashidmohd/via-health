import json
from pathlib import Path

from app.db.errors import DB_ERROR_CODES

I18N_DIR = Path(__file__).resolve().parents[2] / "apps" / "web" / "src" / "i18n"


def test_every_db_error_code_is_translated_in_de_and_en() -> None:
    for language in ("de", "en"):
        messages = json.loads((I18N_DIR / f"{language}.json").read_text())["errors"]
        assert DB_ERROR_CODES <= messages.keys(), language
