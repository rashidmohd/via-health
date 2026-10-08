"""Clients and consent capture (docs/plans/0003-clients-and-consent.md)."""

import base64
import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.api.deps import CurrentUserId, Db
from app.api.errors import ApiError
from app.core.data_crypto import decrypt_json, encrypt_bytes, encrypt_json
from app.db.models import AuditLog, Client, Consent, ConsentText, Session
from app.domain.consent import (
    CONSENT_KINDS,
    ConsentFact,
    ConsentKind,
    ConsentStatus,
    consent_status,
    ready_to_record,
)

router = APIRouter(tags=["clients"])

Language = Literal["de", "en"]
MAX_SIGNATURE_BYTES = 300_000
SIGNATURE_PREFIX = "data:image/png;base64,"


def _identity_aad(client_id: uuid.UUID) -> str:
    return f"client:{client_id}:identity"


def _signature_aad(consent_id: uuid.UUID) -> str:
    return f"consent:{consent_id}:signature"


# --- schemas -----------------------------------------------------------------


class Identity(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    date_of_birth: date | None = None
    email: Annotated[str, Field(max_length=254)] | None = None
    phone: Annotated[str, Field(max_length=50)] | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("empty")
        return value


class ClientCreate(Identity):
    preferred_language: Language = "de"


class ClientUpdate(BaseModel):
    identity: Identity | None = None
    preferred_language: Language | None = None
    status: Literal["active", "archived"] | None = None


class ClientSummary(BaseModel):
    id: uuid.UUID
    name: str
    preferred_language: Language
    status: str
    consent: dict[ConsentKind, ConsentStatus]
    ready_to_record: bool
    last_session_at: datetime | None
    created_at: datetime


class ConsentRecord(BaseModel):
    id: uuid.UUID
    kind: ConsentKind
    text_version: int
    language: Language
    granted_at: datetime
    withdrawn_at: datetime | None
    signed_by: Literal["client", "guardian"]
    method: str


class ClientDetail(ClientSummary):
    identity: Identity
    consents: list[ConsentRecord]


class ConsentTextOut(BaseModel):
    id: uuid.UUID
    kind: ConsentKind
    version: int
    language: Language
    body: str


class ConsentGrant(BaseModel):
    # Each kind is ticked separately in the UI; one row is stored per kind (never bundled).
    kinds: Annotated[list[ConsentKind], Field(min_length=1, max_length=3)]
    language: Language
    signed_by: Literal["client", "guardian"] = "client"
    signature: Annotated[str, Field(max_length=MAX_SIGNATURE_BYTES)]

    @field_validator("kinds")
    @classmethod
    def unique_kinds(cls, value: list[ConsentKind]) -> list[ConsentKind]:
        if len(set(value)) != len(value):
            raise ValueError("duplicate")
        return value

    @field_validator("signature")
    @classmethod
    def png_data_url(cls, value: str) -> str:
        if not value.startswith(SIGNATURE_PREFIX):
            raise ValueError("not a png data url")
        try:
            base64.b64decode(value.removeprefix(SIGNATURE_PREFIX), validate=True)
        except ValueError:
            raise ValueError("invalid base64") from None
        return value


# --- helpers -----------------------------------------------------------------


def _latest_versions(db: DbSession) -> dict[str, int]:
    rows = db.execute(
        select(ConsentText.kind, func.max(ConsentText.version)).group_by(ConsentText.kind)
    ).all()
    return {kind: version for kind, version in rows}


def _consent_rows(db: DbSession, client_ids: list[uuid.UUID]) -> list[Any]:
    if not client_ids:
        return []
    return list(
        db.execute(
            select(Consent, ConsentText.version, ConsentText.language)
            .join(ConsentText, ConsentText.id == Consent.consent_text_id)
            .where(Consent.client_id.in_(client_ids))
            .order_by(Consent.granted_at.desc())
        ).all()
    )


def _summary(
    client: Client,
    consent_rows: list[Any],
    latest: dict[str, int],
    last_session_at: datetime | None,
) -> ClientSummary:
    identity = decrypt_json(client.identity_enc, _identity_aad(client.id))
    status = consent_status(
        (ConsentFact(c.kind, version, c.withdrawn_at) for c, version, _ in consent_rows), latest
    )
    return ClientSummary(
        id=client.id,
        name=identity["name"],
        preferred_language=client.preferred_language,
        status=client.status,
        consent=status,
        ready_to_record=client.status == "active" and ready_to_record(status),
        last_session_at=last_session_at,
        created_at=client.created_at,
    )


def _get_client(db: DbSession, client_id: uuid.UUID) -> Client:
    client = db.get(Client, client_id)  # RLS: other therapists' clients are invisible
    if client is None:
        raise ApiError("client_not_found", 404)
    return client


def _audit(
    db: DbSession, user_id: uuid.UUID, action: str, entity: str, entity_id: uuid.UUID
) -> None:
    db.add(AuditLog(actor_user_id=user_id, action=action, entity=entity, entity_id=str(entity_id)))


def _detail(db: DbSession, client: Client) -> ClientDetail:
    rows = _consent_rows(db, [client.id])
    last = db.scalar(select(func.max(Session.started_at)).where(Session.client_id == client.id))
    summary = _summary(client, rows, _latest_versions(db), last)
    identity = Identity(**decrypt_json(client.identity_enc, _identity_aad(client.id)))
    consents = [
        ConsentRecord(
            id=c.id,
            kind=c.kind,
            text_version=version,
            language=language,
            granted_at=c.granted_at,
            withdrawn_at=c.withdrawn_at,
            signed_by=c.signed_by,
            method=c.method,
        )
        for c, version, language in rows
    ]
    return ClientDetail(**summary.model_dump(), identity=identity, consents=consents)


# --- routes ------------------------------------------------------------------


@router.get("/clients")
def list_clients(user_id: CurrentUserId, db: Db) -> list[ClientSummary]:
    clients = list(db.scalars(select(Client)))
    rows = _consent_rows(db, [c.id for c in clients])
    by_client: dict[uuid.UUID, list[Any]] = {c.id: [] for c in clients}
    for row in rows:
        by_client[row[0].client_id].append(row)
    last_sessions = dict(
        db.execute(
            select(Session.client_id, func.max(Session.started_at)).group_by(Session.client_id)
        ).all()
    )
    latest = _latest_versions(db)
    summaries = [_summary(c, by_client[c.id], latest, last_sessions.get(c.id)) for c in clients]
    # Names are encrypted, so sorting happens here, not in SQL.
    return sorted(summaries, key=lambda s: (s.status != "active", s.name.casefold()))


@router.post("/clients", status_code=201)
def create_client(body: ClientCreate, user_id: CurrentUserId, db: Db) -> ClientDetail:
    client_id = uuid.uuid4()
    identity = Identity(**body.model_dump(exclude={"preferred_language"}))
    client = Client(
        id=client_id,
        user_id=user_id,
        identity_enc=encrypt_json(identity.model_dump(mode="json"), _identity_aad(client_id)),
        preferred_language=body.preferred_language,
    )
    db.add(client)
    _audit(db, user_id, "client_created", "client", client_id)
    db.flush()
    db.refresh(client)
    return _detail(db, client)


@router.get("/clients/{client_id}")
def get_client(client_id: uuid.UUID, user_id: CurrentUserId, db: Db) -> ClientDetail:
    return _detail(db, _get_client(db, client_id))


@router.patch("/clients/{client_id}")
def update_client(
    client_id: uuid.UUID, body: ClientUpdate, user_id: CurrentUserId, db: Db
) -> ClientDetail:
    client = _get_client(db, client_id)
    if client.status == "restricted":
        raise ApiError("client_not_active", 409)
    if body.identity is not None:
        client.identity_enc = encrypt_json(
            body.identity.model_dump(mode="json"), _identity_aad(client.id)
        )
    if body.preferred_language is not None:
        client.preferred_language = body.preferred_language
    if body.status is not None:
        client.status = body.status
    _audit(db, user_id, "client_updated", "client", client.id)
    db.flush()
    return _detail(db, client)


@router.get("/consent-texts")
def consent_texts(language: Language, user_id: CurrentUserId, db: Db) -> list[ConsentTextOut]:
    latest = _latest_versions(db)
    texts = db.scalars(select(ConsentText).where(ConsentText.language == language)).all()
    current = [t for t in texts if latest.get(t.kind) == t.version]
    order: dict[str, int] = {kind: i for i, kind in enumerate(CONSENT_KINDS)}
    return [
        ConsentTextOut(id=t.id, kind=t.kind, version=t.version, language=t.language, body=t.body)
        for t in sorted(current, key=lambda t: order[t.kind])
    ]


@router.post("/clients/{client_id}/consents", status_code=201)
def grant_consents(
    client_id: uuid.UUID, body: ConsentGrant, user_id: CurrentUserId, db: Db
) -> ClientDetail:
    client = _get_client(db, client_id)
    if client.status != "active":
        raise ApiError("client_not_active", 409)
    latest = _latest_versions(db)
    current = _summary(client, _consent_rows(db, [client.id]), latest, None).consent
    if any(current[kind] == "granted" for kind in body.kinds):
        raise ApiError("consent_already_given", 409)

    texts = {
        t.kind: t
        for t in db.scalars(
            select(ConsentText).where(
                ConsentText.language == body.language, ConsentText.kind.in_(body.kinds)
            )
        )
        if latest.get(t.kind) == t.version
    }
    signature = body.signature.encode()
    for kind in body.kinds:
        text = texts.get(kind)
        if text is None:
            raise ApiError("consent_text_missing", 409)
        consent_id = uuid.uuid4()
        db.add(
            Consent(
                id=consent_id,
                client_id=client.id,
                kind=kind,
                consent_text_id=text.id,
                method="tablet_signature",
                signed_by=body.signed_by,
                signature_enc=encrypt_bytes(signature, _signature_aad(consent_id)),
            )
        )
        _audit(db, user_id, "consent_granted", "consent", consent_id)
    db.flush()
    return _detail(db, client)


@router.post("/consents/{consent_id}/withdraw")
def withdraw_consent(consent_id: uuid.UUID, user_id: CurrentUserId, db: Db) -> ClientDetail:
    consent = db.get(Consent, consent_id)
    if consent is None:
        raise ApiError("consent_not_found", 404)
    if consent.withdrawn_at is not None:
        raise ApiError("consent_immutable", 409)
    consent.withdrawn_at = func.now()
    _audit(db, user_id, "consent_withdrawn", "consent", consent.id)
    db.flush()
    client = _get_client(db, consent.client_id)
    db.expire_all()
    return _detail(db, client)
