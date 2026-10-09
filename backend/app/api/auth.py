"""Signup and login with a one-time email code (docs/plans/0002-login.md)."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, func, select, text, update

from app.adapters.email import EmailSender, EmailSendError, get_email_sender
from app.api.deps import AUTH_COOKIE, CurrentUserId, Db, session_token_hash
from app.api.errors import ApiError
from app.core.config import get_settings
from app.core.data_crypto import decrypt_bytes, encrypt_bytes
from app.core.security import (
    hashes_equal,
    keyed_hash,
    new_code,
    new_session_token,
    normalize_email,
)
from app.db.models import AuditLog, AuthSession, LoginCode, User
from app.domain.avatar_photo import MAX_PHOTO_BYTES, PhotoInvalid, photo_type
from app.domain.login_email import login_code_email

router = APIRouter(prefix="/auth", tags=["auth"])

CODE_TTL = timedelta(minutes=10)
MAX_CODE_ATTEMPTS = 5
MAX_CODES_PER_EMAIL_PER_HOUR = 5
MAX_CODES_PER_IP_PER_HOUR = 30
SESSION_TTL = timedelta(hours=12)

Language = Literal["de", "en"]
AvatarKind = Literal["illustrated", "initials", "photo"]
AvatarCharacter = Annotated[int, Field(ge=0, le=2)]
Email = Annotated[
    str, Field(min_length=3, max_length=254, pattern=r"^\s*[^@\s]+@[^@\s]+\.[^@\s]+\s*$")
]


class StartRequest(BaseModel):
    email: Email
    language: Language = "de"


class VerifyRequest(BaseModel):
    email: Email
    code: Annotated[str, Field(pattern=r"^\d{6}$")]
    # Sent by the signup form; ignored if the account already exists.
    display_name: Annotated[str, Field(max_length=100)] = ""
    language: Language = "de"


class MeResponse(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str
    ui_language: Language
    avatar_kind: AvatarKind
    avatar_reactions: bool
    avatar_tilt: bool
    avatar_character: int
    has_photo: bool


class UpdateMeRequest(BaseModel):
    display_name: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    ui_language: Language | None = None
    avatar_kind: AvatarKind | None = None
    avatar_reactions: bool | None = None
    avatar_tilt: bool | None = None
    avatar_character: AvatarCharacter | None = None


def _me(user: User) -> MeResponse:
    return MeResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        ui_language=user.ui_language,
        avatar_kind=user.avatar_kind,
        avatar_reactions=user.avatar_reactions,
        avatar_tilt=user.avatar_tilt,
        avatar_character=user.avatar_character,
        has_photo=user.avatar_photo_enc is not None,
    )


def _photo_aad(user_id: uuid.UUID) -> str:
    return f"user:{user_id}:avatar-photo"


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/email/start", status_code=202)
def start(
    body: StartRequest,
    request: Request,
    db: Db,
    sender: Annotated[EmailSender, Depends(get_email_sender)],
) -> dict[str, str]:
    """Send a code. Same answer whether or not the email has an account."""
    email_hash = keyed_hash("email", normalize_email(body.email))
    ip_hash = keyed_hash("ip", _client_ip(request))
    since = datetime.now(UTC) - timedelta(hours=1)

    def recent(condition: ColumnElement[bool]) -> int:
        return db.scalar(select(func.count()).where(condition, LoginCode.created_at > since)) or 0

    if (
        recent(LoginCode.email_hash == email_hash) >= MAX_CODES_PER_EMAIL_PER_HOUR
        or recent(LoginCode.ip_hash == ip_hash) >= MAX_CODES_PER_IP_PER_HOUR
    ):
        raise ApiError("too_many_requests", 429)

    code = new_code()
    db.add(
        LoginCode(
            email_hash=email_hash,
            code_hash=keyed_hash("code", code),
            ip_hash=ip_hash,
            expires_at=func.now() + CODE_TTL,
        )
    )
    db.flush()
    content = login_code_email(code, body.language)
    try:
        sender.send(to=normalize_email(body.email), subject=content.subject, text=content.text)
    except EmailSendError:
        # 503, not 502: Cloudflare replaces origin 502s with its own page, which drops the
        # CORS headers and the error code.
        raise ApiError("email_failed", 503) from None
    return {"status": "sent"}


@router.post("/email/verify")
def verify(body: VerifyRequest, response: Response, db: Db) -> MeResponse:
    email = normalize_email(body.email)
    email_hash = keyed_hash("email", email)
    login_code = db.scalars(
        select(LoginCode)
        .where(
            LoginCode.email_hash == email_hash,
            LoginCode.consumed_at.is_(None),
            LoginCode.expires_at > func.now(),
        )
        .order_by(LoginCode.created_at.desc())
        .limit(1)
        .with_for_update()
    ).first()
    if login_code is None or login_code.attempts >= MAX_CODE_ATTEMPTS:
        raise ApiError("code_invalid", 400)
    if not hashes_equal(login_code.code_hash, keyed_hash("code", body.code)):
        login_code.attempts += 1
        db.commit()  # keep the attempt count although the request fails
        raise ApiError("code_invalid", 400)

    db.execute(
        update(LoginCode)
        .where(LoginCode.email_hash == email_hash, LoginCode.consumed_at.is_(None))
        .values(consumed_at=func.now())
    )

    existing = db.execute(text("SELECT auth_user_id_by_email(:e)"), {"e": email}).scalar_one()
    user_id = uuid.UUID(str(existing)) if existing else uuid.uuid4()
    db.execute(text("SELECT set_config('app.user_id', :uid, true)"), {"uid": str(user_id)})
    if existing is None:
        db.add(
            User(
                id=user_id,
                email=email,
                display_name=body.display_name.strip(),
                ui_language=body.language,
            )
        )
        db.flush()
        action = "signup"
    else:
        action = "login"

    token = new_session_token()
    db.add(
        AuthSession(
            user_id=user_id,
            token_hash=session_token_hash(token),
            expires_at=func.now() + SESSION_TTL,
        )
    )
    db.add(AuditLog(actor_user_id=user_id, action=action, entity="user", entity_id=str(user_id)))
    db.flush()

    response.set_cookie(
        AUTH_COOKIE,
        token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        secure=get_settings().secure_cookies,
        samesite="lax",
        path="/",
    )
    user = db.get(User, user_id)
    assert user is not None
    return _me(user)


@router.get("/me")
def me(user_id: CurrentUserId, db: Db) -> MeResponse:
    user = db.get(User, user_id)
    if user is None:
        raise ApiError("not_authenticated", 401)
    return _me(user)


@router.patch("/me")
def update_me(body: UpdateMeRequest, user_id: CurrentUserId, db: Db) -> MeResponse:
    user = db.get(User, user_id)
    if user is None:
        raise ApiError("not_authenticated", 401)
    if body.display_name is not None:
        user.display_name = body.display_name.strip()
    if body.ui_language is not None:
        user.ui_language = body.ui_language
    if body.avatar_kind is not None:
        if body.avatar_kind == "photo" and user.avatar_photo_enc is None:
            raise ApiError("photo_missing", 409)
        user.avatar_kind = body.avatar_kind
    if body.avatar_reactions is not None:
        user.avatar_reactions = body.avatar_reactions
    if body.avatar_tilt is not None:
        user.avatar_tilt = body.avatar_tilt
    if body.avatar_character is not None:
        user.avatar_character = body.avatar_character
    db.flush()
    return _me(user)


# --- profile photo (plan 0012, ADR 0011) ----------------------------------------


async def photo_body(request: Request) -> bytes:
    """Read the photo with a size limit and check it is a clean WebP/JPEG."""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_PHOTO_BYTES:
        raise ApiError("photo_too_large", 413)
    body = bytearray()
    async for part in request.stream():
        body += part
        if len(body) > MAX_PHOTO_BYTES:
            raise ApiError("photo_too_large", 413)
    data = bytes(body)
    try:
        photo_type(data)
    except PhotoInvalid:
        raise ApiError("photo_invalid", 400) from None
    return data


@router.put("/me/avatar")
def set_photo(
    data: Annotated[bytes, Depends(photo_body)], user_id: CurrentUserId, db: Db
) -> MeResponse:
    """Store the photo and use it as the profile picture."""
    user = db.get(User, user_id)
    if user is None:
        raise ApiError("not_authenticated", 401)
    user.avatar_photo_enc = encrypt_bytes(data, _photo_aad(user.id))
    user.avatar_kind = "photo"
    db.add(
        AuditLog(
            actor_user_id=user_id, action="avatar_photo_set", entity="user", entity_id=str(user_id)
        )
    )
    db.flush()
    return _me(user)


@router.get("/me/avatar")
def get_photo(user_id: CurrentUserId, db: Db) -> Response:
    user = db.get(User, user_id)
    if user is None:
        raise ApiError("not_authenticated", 401)
    if user.avatar_photo_enc is None:
        raise ApiError("photo_missing", 404)
    data = decrypt_bytes(user.avatar_photo_enc, _photo_aad(user.id))
    return Response(
        content=data, media_type=photo_type(data), headers={"Cache-Control": "private, no-store"}
    )


@router.delete("/me/avatar")
def delete_photo(user_id: CurrentUserId, db: Db) -> MeResponse:
    """Remove the photo; the profile picture falls back to the illustrated avatar."""
    user = db.get(User, user_id)
    if user is None:
        raise ApiError("not_authenticated", 401)
    user.avatar_photo_enc = None
    if user.avatar_kind == "photo":
        user.avatar_kind = "illustrated"
    db.add(
        AuditLog(
            actor_user_id=user_id,
            action="avatar_photo_removed",
            entity="user",
            entity_id=str(user_id),
        )
    )
    db.flush()
    return _me(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, user_id: CurrentUserId, db: Db) -> None:
    token = request.cookies.get(AUTH_COOKIE, "")
    db.execute(
        update(AuthSession)
        .where(AuthSession.token_hash == session_token_hash(token))
        .values(revoked_at=func.now())
    )
    db.add(AuditLog(actor_user_id=user_id, action="logout", entity="user", entity_id=str(user_id)))
    response.delete_cookie(AUTH_COOKIE, path="/")
