"""Therapist and recovery keys (docs/plans/0014-therapist-keys-and-signing.md, step A).

The browser creates both OpenPGP keys. The server keeps the two public keys and the therapist
private key exactly as the browser sent it: passphrase-encrypted and armored. It never sees a
passphrase or the recovery private key, and it does not parse PGP data. Keys are stored once
(DB trigger); rotation is a later plan.
"""

from typing import Annotated

from fastapi import APIRouter
from pydantic import AfterValidator, BaseModel, Field, model_validator

from app.api.deps import CurrentUserId, Db
from app.api.errors import ApiError
from app.db.models import AuditLog, User

router = APIRouter(prefix="/keys", tags=["keys"])

# Armored v6 Ed25519/X25519 keys are ~1 KB; this leaves room for user ids and subkeys.
MAX_KEY_CHARS = 16_000
PUBLIC_HEADER = "-----BEGIN PGP PUBLIC KEY BLOCK-----"
PRIVATE_HEADER = "-----BEGIN PGP PRIVATE KEY BLOCK-----"


def _armored(header: str, *, public: bool) -> AfterValidator:
    def check(value: str) -> str:
        if not value.lstrip().startswith(header):
            raise ValueError("not an armored key of this kind")
        # A private key (e.g. the recovery key) must never be stored as a "public" key.
        if public and "PRIVATE KEY" in value:
            raise ValueError("private key sent as public key")
        return value

    return AfterValidator(check)


PublicKey = Annotated[str, Field(max_length=MAX_KEY_CHARS), _armored(PUBLIC_HEADER, public=True)]
PrivateKey = Annotated[str, Field(max_length=MAX_KEY_CHARS), _armored(PRIVATE_HEADER, public=False)]
# v6 fingerprints: SHA-256, lower-case hex.
Fingerprint = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class KeysIn(BaseModel):
    therapist_public_key: PublicKey
    therapist_private_key: PrivateKey
    recovery_public_key: PublicKey
    therapist_fingerprint: Fingerprint
    recovery_fingerprint: Fingerprint

    @model_validator(mode="after")
    def _two_keys(self) -> "KeysIn":
        if self.therapist_fingerprint == self.recovery_fingerprint:
            raise ValueError("therapist and recovery key must differ")
        return self


class KeysOut(BaseModel):
    therapist_public_key: str
    therapist_private_key: str
    recovery_public_key: str
    therapist_fingerprint: str
    recovery_fingerprint: str


def _out(user: User) -> KeysOut:
    assert user.pgp_private_key_enc is not None and user.recovery_public_key is not None
    assert user.key_fingerprints is not None  # CHECK keys_complete
    return KeysOut(
        therapist_public_key=user.pgp_public_key or "",
        therapist_private_key=user.pgp_private_key_enc.decode(),
        recovery_public_key=user.recovery_public_key,
        therapist_fingerprint=user.key_fingerprints["therapist"],
        recovery_fingerprint=user.key_fingerprints["recovery"],
    )


def _user(db: Db, user_id: CurrentUserId) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise ApiError("not_authenticated", 401)
    return user


@router.get("")
def get_keys(user_id: CurrentUserId, db: Db) -> KeysOut:
    """The keys, so another device can unlock with the passphrase."""
    user = _user(db, user_id)
    if user.pgp_public_key is None:
        raise ApiError("keys_missing", 404)
    return _out(user)


@router.put("", status_code=201)
def set_keys(body: KeysIn, user_id: CurrentUserId, db: Db) -> KeysOut:
    user = _user(db, user_id)
    if user.pgp_public_key is not None:
        raise ApiError("keys_exist", 409)
    user.pgp_public_key = body.therapist_public_key
    user.pgp_private_key_enc = body.therapist_private_key.encode()
    user.recovery_public_key = body.recovery_public_key
    user.key_fingerprints = {
        "therapist": body.therapist_fingerprint,
        "recovery": body.recovery_fingerprint,
    }
    db.add(
        AuditLog(
            actor_user_id=user_id, action="keys_created", entity="user", entity_id=str(user_id)
        )
    )
    db.flush()
    return _out(user)
