import pytest

from app.core import data_crypto
from app.core.config import Settings
from app.core.data_crypto import DecryptionError, decrypt_json, encrypt_json


def test_round_trip() -> None:
    blob = encrypt_json({"name": "Anna"}, "client:1:identity")
    assert b"Anna" not in blob
    assert decrypt_json(blob, "client:1:identity") == {"name": "Anna"}


def test_same_value_encrypts_differently() -> None:
    assert encrypt_json({"a": 1}, "x") != encrypt_json({"a": 1}, "x")


def test_ciphertext_cannot_move_to_another_row() -> None:
    blob = encrypt_json({"name": "Anna"}, "client:1:identity")
    with pytest.raises(DecryptionError):
        decrypt_json(blob, "client:2:identity")


def test_tampered_ciphertext_rejected() -> None:
    blob = bytearray(encrypt_json({"name": "Anna"}, "a"))
    blob[-1] ^= 1
    with pytest.raises(DecryptionError):
        decrypt_json(bytes(blob), "a")


def test_wrong_key_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    blob = encrypt_json({"name": "Anna"}, "a")
    other = Settings(client_data_key="11" * 32)
    monkeypatch.setattr(data_crypto, "get_settings", lambda: other)
    with pytest.raises(DecryptionError):
        decrypt_json(blob, "a")


def test_unknown_format_rejected() -> None:
    with pytest.raises(DecryptionError):
        decrypt_json(b"\x02" + b"\x00" * 40, "a")


@pytest.mark.parametrize("key", ["abc", "zz" * 32, "00" * 16])
def test_key_must_be_32_bytes_hex(key: str) -> None:
    with pytest.raises(ValueError):
        Settings(client_data_key=key)


def test_prod_requires_client_data_key() -> None:
    base = {
        "app_env": "prod",
        "auth_secret": "x" * 40,
        "email_sender": "resend",
        "resend_api_key": "k",
        "llm_provider": "vertex",
        "object_store": "gcs",
        "kms_provider": "gcp",
        "stt_provider": "google",
        "gcs_bucket": "b",
        "kms_key_name": "projects/p/locations/europe-west4/keyRings/r/cryptoKeys/k",
        "gcp_project_id": "p",
    }
    with pytest.raises(ValueError):
        Settings(**base)  # type: ignore[arg-type]
    Settings(**base, client_data_key="ab" * 32)  # type: ignore[arg-type]
