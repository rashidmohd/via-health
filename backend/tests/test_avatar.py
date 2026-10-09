"""Profile picture settings and photo (plan 0012, ADR 0011)."""

import struct

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.domain.avatar_photo import MAX_PHOTO_BYTES, PhotoInvalid, photo_type
from tests.api_helpers import FakeEmailSender, login


def _chunk(fourcc: bytes, payload: bytes) -> bytes:
    pad = b"\x00" if len(payload) % 2 else b""
    return fourcc + struct.pack("<I", len(payload)) + payload + pad


def webp(*chunks: bytes) -> bytes:
    body = b"WEBP" + b"".join(chunks or (_chunk(b"VP8L", b"\x2f" + b"\x00" * 20),))
    return b"RIFF" + struct.pack("<I", len(body)) + body


def jpeg(*segments: bytes) -> bytes:
    jfif = (
        b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00" + b"\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    )
    scan = b"\xff\xda" + struct.pack(">H", 8) + b"\x01\x01\x00\x00\x3f\x00" + b"\x12\x34\xff\xd9"
    return b"\xff\xd8" + jfif + b"".join(segments) + scan


def segment(marker: int, payload: bytes) -> bytes:
    return bytes([0xFF, marker]) + struct.pack(">H", len(payload) + 2) + payload


GPS_EXIF = b"Exif\x00\x00MM\x00*GPS 52.52N 13.40E"
CLEAN_WEBP = webp()


# --- format checks ---------------------------------------------------------------


def test_clean_photos_accepted() -> None:
    assert photo_type(CLEAN_WEBP) == "image/webp"
    assert photo_type(jpeg()) == "image/jpeg"


@pytest.mark.parametrize(
    "data",
    [
        webp(_chunk(b"VP8X", b"\x08" + b"\x00" * 9), _chunk(b"EXIF", GPS_EXIF)),
        webp(_chunk(b"VP8X", b"\x04" + b"\x00" * 9), _chunk(b"XMP ", b"<x:xmpmeta/>")),
        jpeg(segment(0xE1, GPS_EXIF)),
        jpeg(segment(0xED, b"Photoshop 3.0\x00")),
        b"\x89PNG\r\n\x1a\n" + b"\x00" * 40,
        b"<svg xmlns='http://www.w3.org/2000/svg'/>",
        b"",
    ],
    ids=["webp-exif", "webp-xmp", "jpeg-exif", "jpeg-iptc", "png", "svg", "empty"],
)
def test_metadata_and_other_types_rejected(data: bytes) -> None:
    with pytest.raises(PhotoInvalid):
        photo_type(data)


# --- API -------------------------------------------------------------------------


def test_defaults(client: TestClient, mail: FakeEmailSender) -> None:
    me = login(client, mail, "anna@example.com")
    assert me["avatar_kind"] == "illustrated"
    assert me["avatar_reactions"] is False
    assert me["avatar_tilt"] is False
    assert me["has_photo"] is False


def test_settings_saved(client: TestClient, mail: FakeEmailSender) -> None:
    login(client, mail, "anna@example.com")
    response = client.patch(
        "/auth/me", json={"avatar_kind": "initials", "avatar_reactions": True, "avatar_tilt": True}
    )
    assert response.status_code == 200
    me = client.get("/auth/me").json()
    assert (me["avatar_kind"], me["avatar_reactions"], me["avatar_tilt"]) == (
        "initials",
        True,
        True,
    )


def test_photo_kind_needs_a_photo(client: TestClient, mail: FakeEmailSender) -> None:
    login(client, mail, "anna@example.com")
    response = client.patch("/auth/me", json={"avatar_kind": "photo"})
    assert response.status_code == 409
    assert response.json() == {"code": "photo_missing"}
    assert client.get("/auth/me/avatar").status_code == 404


def test_photo_upload_read_and_remove(
    client: TestClient, mail: FakeEmailSender, owner: Engine
) -> None:
    me = login(client, mail, "anna@example.com")
    response = client.put("/auth/me/avatar", content=CLEAN_WEBP)
    assert response.status_code == 200
    assert response.json()["avatar_kind"] == "photo"
    assert response.json()["has_photo"] is True

    photo = client.get("/auth/me/avatar")
    assert photo.content == CLEAN_WEBP
    assert photo.headers["content-type"] == "image/webp"
    assert photo.headers["cache-control"] == "private, no-store"

    with owner.connect() as c:
        stored = c.execute(
            text("SELECT avatar_photo_enc FROM users WHERE id = :id"), {"id": me["id"]}
        ).scalar_one()
        actions = c.execute(text("SELECT action FROM audit_log ORDER BY id")).scalars().all()
    assert CLEAN_WEBP not in bytes(stored)  # encrypted at rest
    assert "avatar_photo_set" in actions

    response = client.delete("/auth/me/avatar")
    assert response.json()["avatar_kind"] == "illustrated"
    assert response.json()["has_photo"] is False
    assert client.get("/auth/me/avatar").status_code == 404


def test_photo_with_metadata_rejected(client: TestClient, mail: FakeEmailSender) -> None:
    login(client, mail, "anna@example.com")
    response = client.put("/auth/me/avatar", content=jpeg(segment(0xE1, GPS_EXIF)))
    assert response.status_code == 400
    assert response.json() == {"code": "photo_invalid"}
    assert client.get("/auth/me").json()["has_photo"] is False


def test_photo_too_large_rejected(client: TestClient, mail: FakeEmailSender) -> None:
    login(client, mail, "anna@example.com")
    big = webp(_chunk(b"VP8L", b"\x2f" + b"\x00" * MAX_PHOTO_BYTES))
    response = client.put("/auth/me/avatar", content=big)
    assert response.status_code == 413
    assert response.json() == {"code": "photo_too_large"}


def test_photo_needs_login(client: TestClient) -> None:
    assert client.get("/auth/me/avatar").status_code == 401
    assert client.put("/auth/me/avatar", content=CLEAN_WEBP).status_code == 401


def test_other_users_cannot_read_the_photo(
    client: TestClient, mail: FakeEmailSender, owner: Engine
) -> None:
    a = login(client, mail, "a@example.com")
    client.put("/auth/me/avatar", content=CLEAN_WEBP)
    client.cookies.clear()
    login(client, mail, "b@example.com")
    assert client.get("/auth/me/avatar").status_code == 404

    with owner.connect() as c, c.begin():
        c.execute(text("SET LOCAL ROLE sessio_app"))
        c.execute(text("SELECT set_config('app.user_id', :u, true)"), {"u": a["id"]})
        rows = c.execute(text("SELECT count(*) FROM users WHERE avatar_photo_enc IS NOT NULL"))
        assert rows.scalar_one() == 1
        c.execute(text("SELECT set_config('app.user_id', gen_random_uuid()::text, true)"))
        rows = c.execute(text("SELECT count(*) FROM users WHERE avatar_photo_enc IS NOT NULL"))
        assert rows.scalar_one() == 0


def test_character_choice(client: TestClient, mail: FakeEmailSender) -> None:
    me = login(client, mail, "anna@example.com")
    assert me["avatar_character"] == 0
    response = client.patch("/auth/me", json={"avatar_character": 2})
    assert response.status_code == 200
    assert client.get("/auth/me").json()["avatar_character"] == 2


@pytest.mark.parametrize("value", [-1, 3, "two"])
def test_character_out_of_range_rejected(
    client: TestClient, mail: FakeEmailSender, value: object
) -> None:
    login(client, mail, "anna@example.com")
    response = client.patch("/auth/me", json={"avatar_character": value})
    assert response.status_code == 422
    assert client.get("/auth/me").json()["avatar_character"] == 0


# --- drawn avatar from a photo (ADR 0013) ------------------------------------------

APPEARANCE = {
    "hair_style": "bun",
    "hair_color": "#a0522d",
    "skin_color": "#f2d3b8",
    "eye_color": "#3a6b5a",
    "glasses": "round",
    "beard": "none",
}


def test_describe_suggests_appearance_and_keeps_no_photo(
    client: TestClient, mail: FakeEmailSender, owner: Engine
) -> None:
    from app.adapters.llm import get_llm
    from app.adapters.llm.fake import FAKE_APPEARANCE, FakeLlmProvider
    from app.main import app

    fake = FakeLlmProvider()
    app.dependency_overrides[get_llm] = lambda: fake
    try:
        me = login(client, mail, "anna@example.com")
        response = client.post("/auth/me/avatar/describe", content=CLEAN_WEBP)
    finally:
        app.dependency_overrides.pop(get_llm)
    assert response.status_code == 200
    assert response.json() == FAKE_APPEARANCE
    assert fake.calls[-1]["image"] == CLEAN_WEBP
    with owner.connect() as c:
        row = c.execute(
            text("SELECT avatar_photo_enc, avatar_appearance FROM users WHERE id = :id"),
            {"id": me["id"]},
        ).one()
    assert row == (None, None)  # a suggestion only: nothing stored until the user saves


def test_describe_rejects_photos_with_metadata(client: TestClient, mail: FakeEmailSender) -> None:
    login(client, mail, "anna@example.com")
    response = client.post("/auth/me/avatar/describe", content=jpeg(segment(0xE1, GPS_EXIF)))
    assert response.status_code == 400


@pytest.mark.parametrize(
    "answer", [{**APPEARANCE, "hair_style": "mohawk"}, {**APPEARANCE, "skin_color": "pink"}, {}]
)
def test_describe_reports_unusable_answers(
    client: TestClient, mail: FakeEmailSender, answer: dict[str, str]
) -> None:
    from app.adapters.llm import get_llm
    from app.adapters.llm.fake import FakeLlmProvider
    from app.main import app

    app.dependency_overrides[get_llm] = lambda: FakeLlmProvider(lambda *_: answer)
    try:
        login(client, mail, "anna@example.com")
        response = client.post("/auth/me/avatar/describe", content=CLEAN_WEBP)
    finally:
        app.dependency_overrides.pop(get_llm)
    assert response.status_code == 503
    assert response.json() == {"code": "appearance_failed"}


def test_drawn_avatar_saved_after_review(client: TestClient, mail: FakeEmailSender) -> None:
    login(client, mail, "anna@example.com")
    assert client.patch("/auth/me", json={"avatar_kind": "drawn"}).json() == {
        "code": "appearance_missing"
    }
    response = client.patch(
        "/auth/me", json={"avatar_kind": "drawn", "avatar_appearance": APPEARANCE}
    )
    assert response.status_code == 200
    me = client.get("/auth/me").json()
    assert (me["avatar_kind"], me["avatar_appearance"]) == ("drawn", APPEARANCE)


@pytest.mark.parametrize(
    "change",
    [{"hair_style": "mohawk"}, {"skin_color": "#FFF"}, {"glasses": "monocle"}, {"age": 40}],
)
def test_invalid_appearance_rejected(
    client: TestClient, mail: FakeEmailSender, change: dict[str, object]
) -> None:
    login(client, mail, "anna@example.com")
    response = client.patch("/auth/me", json={"avatar_appearance": {**APPEARANCE, **change}})
    assert response.status_code == 422
    assert client.get("/auth/me").json()["avatar_appearance"] is None
