"""Signing session notes (plan 0014 steps B and C, rule 7) — real Postgres per test.

The browser signs and encrypts; the server stores the messages and, in the same transaction,
drops its readable copies and the processing key. These tests cover the server side and the
DB guarantees; the cryptography itself is tested in the web app (src/crypto/pgp.test.ts)."""

import base64
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError

from app.core.data_crypto import encrypt_json
from app.db.errors import db_error_code
from app.domain.report_draft import default_content, report_aad
from app.workers.transcribe import find_ready, find_refine_work, window_aad
from tests.api_helpers import (
    RECOVERY_FP,
    SIGNED_BY,
    THERAPIST_FP,
    FakeEmailSender,
    armored,
    login,
    message,
    sign_body,
    sign_note,
)
from tests.test_reports import draft, put_content, setup_session, therapist, worker

__all__ = ["therapist", "worker"]  # fixtures used by name


def prepare(client: TestClient, session_id: str) -> Any:
    return client.post(f"/sessions/{session_id}/report/sign/prepare")


def sign(client: TestClient, session_id: str, body: dict[str, Any]) -> Any:
    return client.post(f"/sessions/{session_id}/report/sign", json=body)


def drafted(client: TestClient, owner: Engine, worker: Engine) -> str:
    session_id = setup_session(client, owner)
    draft(worker, session_id)
    return session_id


def add_processing_state(owner: Engine, session_id: str) -> None:
    """What a real session has before signing: a processing key and a leftover window."""
    with owner.begin() as c:
        c.execute(
            text(
                "INSERT INTO wrapped_keys (session_id, kind, ciphertext) "
                "VALUES (:id, 'processing', '\\x01')"
            ),
            {"id": session_id},
        )
        c.execute(
            text(
                "INSERT INTO transcript_windows (session_id, idx, start_ms, end_ms, words_enc) "
                "VALUES (:id, 0, 0, 60000, :enc)"
            ),
            {
                "id": session_id,
                "enc": encrypt_json({"words": []}, window_aad(uuid.UUID(session_id), 0)),
            },
        )


# --- prepare ------------------------------------------------------------------------


def test_prepare_returns_the_record_to_sign(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = drafted(client, owner, worker)
    prepared = prepare(client, session_id).json()
    assert prepared["note"]["session"]["client_name"] == "Anna Schmidt"
    assert prepared["note"]["session"]["id"] == session_id
    assert prepared["note"]["ai_assisted"] is True
    assert prepared["note"]["content"]["header"]["session_no"] == "1"
    assert prepared["note"]["approved_by"] == therapist["id"]
    assert prepared["index"]["session_no"] == "1"
    # The transcript as the therapist sees it, speaker roles applied.
    assert prepared["transcript"]["therapist_speaker"] == "1"
    assert prepared["transcript"]["segments"][0]["text"].startswith("Hallo")
    assert (prepared["therapist_fingerprint"], prepared["recovery_fingerprint"]) == (
        THERAPIST_FP,
        RECOVERY_FP,
    )
    assert prepared["addenda"] == []
    # Preparing changes nothing.
    assert client.get(f"/sessions/{session_id}/report").json()["status"] == "draft"


def test_prepare_needs_keys(
    client: TestClient, mail: FakeEmailSender, owner: Engine, worker: Engine
) -> None:
    login(client, mail, "nokeys@example.com", display_name="N")
    session_id = drafted(client, owner, worker)
    assert prepare(client, session_id).json() == {"code": "keys_missing"}


def test_prepare_needs_a_draft(
    client: TestClient, therapist: dict[str, str], owner: Engine
) -> None:
    session_id = setup_session(client, owner)
    assert prepare(client, session_id).json() == {"code": "report_not_drafted"}


# --- sign ---------------------------------------------------------------------------


def test_sign_stores_messages_and_clears_readable_copies(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = drafted(client, owner, worker)
    add_processing_state(owner, session_id)
    signed = sign_note(client, session_id)

    assert signed["status"] == "signed"
    assert signed["signed"]["note"] == message("note")
    assert signed["signed"]["transcript"] == message("transcript")
    assert signed["signed"]["index"] == message("index")
    assert signed["signed"]["signer_fingerprint"] == THERAPIST_FP
    assert signed["signed"]["encrypted_to"] == sorted([THERAPIST_FP, RECOVERY_FP])
    assert signed["approved_at"] and signed["ai_assisted"] is True
    # The server returns no readable content any more.
    assert all(not f["statements"] for f in signed["content"]["ai"].values())

    with owner.connect() as c:
        report = c.execute(text("SELECT content_enc, draft_enc, signed_at FROM reports")).one()
        version = c.execute(
            text("SELECT content_enc, pgp_message, transcript_pgp FROM report_versions")
        ).one()
        transcript = c.execute(text("SELECT segments_enc, refine_status FROM transcripts")).one()
        keys = c.execute(text("SELECT kind FROM wrapped_keys")).scalars().all()
        windows = c.execute(text("SELECT count(*) FROM transcript_windows")).scalar_one()
        session = c.execute(text("SELECT status, audio_state FROM sessions")).one()
        actions = c.execute(text("SELECT action FROM audit_log")).scalars().all()
    assert report.content_enc is None and report.draft_enc is None and report.signed_at
    assert version.content_enc is None and version.pgp_message == message("note")
    assert version.transcript_pgp == message("transcript")
    assert transcript.segments_enc is None
    assert keys == [] and windows == 0  # processing key destroyed (crypto-shred)
    assert (session.status, session.audio_state) == ("signed", "shred_pending")
    assert "report_signed" in actions

    # Session card: status only, the server cannot read topics any more.
    card = client.get(f"/sessions/{session_id}").json()
    assert (card["report_status"], card["report_topics"]) == ("signed", [])


def test_sign_twice_is_refused(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = drafted(client, owner, worker)
    prepared = prepare(client, session_id).json()
    assert sign(client, session_id, sign_body(prepared)).status_code == 200
    assert sign(client, session_id, sign_body(prepared)).json() == {"code": "report_signed"}
    assert prepare(client, session_id).json() == {"code": "report_signed"}


def test_sign_in_wrong_state_is_refused(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = drafted(client, owner, worker)
    prepared = prepare(client, session_id).json()
    client.post(f"/sessions/{session_id}/report/draft", json={"field": None})  # now pending
    assert sign(client, session_id, sign_body(prepared)).json() == {"code": "report_not_drafted"}


def test_sign_refuses_a_note_changed_after_prepare(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = drafted(client, owner, worker)
    prepared = prepare(client, session_id).json()
    report = client.get(f"/sessions/{session_id}/report").json()
    body = put_content(report, therapist={**report["content"]["therapist"], "notable": "neu"})
    client.put(f"/sessions/{session_id}/report", json=body)  # e.g. in another tab
    assert sign(client, session_id, sign_body(prepared)).json() == {"code": "report_changed"}

    fresh = prepare(client, session_id).json()
    old = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    assert sign(client, session_id, sign_body(fresh, approved_at=old)).json() == {
        "code": "report_changed"
    }
    assert sign(client, session_id, sign_body(fresh)).status_code == 200


@pytest.mark.parametrize(
    "changes",
    [
        {"signer_fingerprint": RECOVERY_FP},  # signed with the wrong key
        {"encrypted_to": [THERAPIST_FP, THERAPIST_FP]},  # recovery key missing
        {"encrypted_to": [THERAPIST_FP, "c" * 64]},  # someone else's key
    ],
)
def test_sign_needs_therapist_signature_and_both_recipients(
    client: TestClient,
    therapist: dict[str, str],
    owner: Engine,
    worker: Engine,
    changes: dict[str, Any],
) -> None:
    session_id = drafted(client, owner, worker)
    prepared = prepare(client, session_id).json()
    assert sign(client, session_id, sign_body(prepared, **changes)).json() == {
        "code": "key_mismatch"
    }
    assert client.get(f"/sessions/{session_id}/report").json()["status"] == "draft"


@pytest.mark.parametrize(
    "changes",
    [
        {"note": "plain text, not a PGP message"},
        {"index": armored("PUBLIC KEY BLOCK")},
        {"transcript": None},  # the transcript is part of the record (ADR 0006)
        {"encrypted_to": [THERAPIST_FP]},
    ],
)
def test_sign_rejects_incomplete_input(
    client: TestClient,
    therapist: dict[str, str],
    owner: Engine,
    worker: Engine,
    changes: dict[str, Any],
) -> None:
    session_id = drafted(client, owner, worker)
    prepared = prepare(client, session_id).json()
    assert sign(client, session_id, sign_body(prepared, **changes)).status_code == 422


def test_unresolved_statements_block_signing(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = drafted(client, owner, worker)
    prepared = prepare(client, session_id).json()
    with owner.begin() as c:  # a flagged AI statement appears after prepare
        report_id = c.execute(text("SELECT id FROM reports")).scalar_one()
        content = default_content()
        content["ai"]["topics"] = {
            "status": "content",
            "statements": [
                {"id": "0123456789ab", "text": "x", "origin": "ai", "support": "unsupported"}
            ],
        }
        c.execute(
            text("UPDATE reports SET content_enc = :enc, updated_at = :at"),
            {
                "enc": encrypt_json(content, report_aad(report_id, "content")),
                "at": prepared["report_updated_at"],
            },
        )
    assert sign(client, session_id, sign_body(prepared)).json() == {"code": "report_unresolved"}


def test_manual_note_without_transcript_can_be_signed(
    client: TestClient, therapist: dict[str, str], owner: Engine
) -> None:
    session_id = setup_session(client, owner)
    with owner.begin() as c:
        c.execute(text("DELETE FROM transcripts"))
    report = client.get(f"/sessions/{session_id}/report").json()
    client.put(f"/sessions/{session_id}/report", json=put_content(report))
    prepared = prepare(client, session_id).json()
    assert prepared["transcript"] is None
    assert sign(client, session_id, sign_body(prepared)).json()["signed"]["transcript"] is None


# --- after signing ------------------------------------------------------------------


def test_signed_transcript_is_unreadable_and_stays_so(
    client: TestClient,
    therapist: dict[str, str],
    owner: Engine,
    worker: Engine,
) -> None:
    session_id = drafted(client, owner, worker)
    sign_note(client, session_id)
    base = f"/sessions/{session_id}/transcript"
    assert client.get(base).json() == {"code": "record_signed"}
    assert client.patch(base, json={"therapist_speaker": "2"}).json() == {"code": "record_signed"}
    assert client.post(f"{base}/speakers/undo").json() == {"code": "record_signed"}
    assert client.post(f"/sessions/{session_id}/report/draft", json={}).json() == {
        "code": "report_approved"
    }

    # Nothing puts a readable copy back: not the worker, not even the owner.
    for engine in (worker, owner):
        with engine.begin() as c, pytest.raises(DBAPIError) as caught:
            c.execute(text("UPDATE transcripts SET segments_enc = '\\x00'"))
        assert db_error_code(caught.value) == "record_signed"


def test_processing_after_signing_stops_cleanly(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = drafted(client, owner, worker)
    with owner.begin() as c:
        c.execute(text("UPDATE transcripts SET refine_status = 'pending'"))
    sign_note(client, session_id)
    assert find_refine_work(worker) == [] and find_ready(worker) == []
    with owner.connect() as c:
        assert c.execute(text("SELECT refine_status FROM transcripts")).scalar_one() == "skipped"
    key = {"key": base64.b64encode(os.urandom(32)).decode()}
    assert client.post(f"/sessions/{session_id}/key", json=key).json() == {
        "code": "audio_not_accepted"
    }
    assert client.post(f"/sessions/{session_id}/retry").json() == {"code": "session_not_failed"}


def test_other_therapist_cannot_prepare_or_sign(
    client: TestClient,
    therapist: dict[str, str],
    mail: FakeEmailSender,
    owner: Engine,
    worker: Engine,
) -> None:
    session_id = drafted(client, owner, worker)
    prepared = prepare(client, session_id).json()
    sign_note(client, session_id)
    client.cookies.clear()
    login(client, mail, "other@example.com", display_name="O")
    assert prepare(client, session_id).status_code == 404
    assert sign(client, session_id, sign_body(prepared)).status_code == 404
    assert client.get(f"/sessions/{session_id}/report").status_code == 404
    assert client.get("/reports").json() == []


def test_addenda_need_a_signed_note_and_the_therapist_key(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = drafted(client, owner, worker)
    url = f"/sessions/{session_id}/report/addenda"
    body = {"message": message("a"), **SIGNED_BY}
    assert client.post(url, json=body).json() == {"code": "report_not_approved"}
    sign_note(client, session_id)
    wrong = {**body, "signer_fingerprint": RECOVERY_FP}
    assert client.post(url, json=wrong).json() == {"code": "key_mismatch"}
    added = client.post(url, json=body).json()
    assert [(v["version"], v["message"]) for v in added["versions"][1:]] == [(2, message("a"))]


# --- notes approved before signing existed ----------------------------------------------


def approve_the_old_way(owner: Engine, user_id: str) -> None:
    """Version 1 and an addendum, server-encrypted, as plan 0009 stored them."""
    with owner.begin() as c:
        report_id = c.execute(text("SELECT id FROM reports")).scalar_one()
        snapshot = {"content": default_content(), "approved_by": user_id, "ai_assisted": True}
        for version, kind, data in ((1, "approval", snapshot), (2, "addendum", {"text": "Alt"})):
            c.execute(
                text(
                    "INSERT INTO report_versions (report_id, version, kind, content_enc, "
                    "created_by) VALUES (:r, :v, :k, :enc, :u)"
                ),
                {
                    "r": report_id,
                    "v": version,
                    "k": kind,
                    "enc": encrypt_json(data, report_aad(report_id, f"version:{version}")),
                    "u": user_id,
                },
            )
        c.execute(
            text("UPDATE reports SET status = 'approved', approved_at = now(), approved_by = :u"),
            {"u": user_id},
        )


def test_note_approved_before_signing_is_sealed_with_its_addenda(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = drafted(client, owner, worker)
    approve_the_old_way(owner, therapist["id"])
    approved = client.get(f"/sessions/{session_id}/report").json()
    assert approved["status"] == "approved"
    assert approved["versions"][1]["text"] == "Alt"
    assert client.post(
        f"/sessions/{session_id}/report/addenda", json={"message": message("a"), **SIGNED_BY}
    ).json() == {"code": "report_not_signed"}

    prepared = prepare(client, session_id).json()
    assert [(a["version"], a["text"]) for a in prepared["addenda"]] == [(2, "Alt")]
    assert prepared["approved_at"] == approved["approved_at"]
    assert prepared["note"]["session"]["id"] == session_id
    assert sign(client, session_id, sign_body(prepared, addenda=[])).json() == {
        "code": "report_changed"
    }

    signed = sign(client, session_id, sign_body(prepared)).json()
    assert signed["status"] == "signed"
    assert signed["approved_at"] == approved["approved_at"]  # approval date unchanged
    assert [(v["version"], v["text"], v["message"]) for v in signed["versions"]] == [
        (1, None, None),
        (2, None, message("addendum-2")),
    ]
    with owner.connect() as c:
        rows = c.execute(
            text("SELECT content_enc, pgp_message FROM report_versions ORDER BY version")
        ).all()
    assert [(r.content_enc, r.pgp_message) for r in rows] == [
        (None, message("note")),
        (None, message("addendum-2")),
    ]


def test_sealing_is_the_only_change_to_an_approved_note(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    drafted(client, owner, worker)
    approve_the_old_way(owner, therapist["id"])
    with owner.begin() as c:
        for statement in (
            "UPDATE reports SET status = 'draft'",
            "UPDATE reports SET approved_at = now() - interval '1 day', status = 'signed'",
            "UPDATE report_versions SET kind = 'addendum', content_enc = NULL, pgp_message = 'x', "
            "signer_fingerprint = 'a', encrypted_to = '[]' WHERE version = 1",
            "UPDATE report_versions SET content_enc = '\\x00' WHERE version = 2",
        ):
            with pytest.raises(DBAPIError), c.begin_nested():
                c.execute(text(statement))


# --- step C: session key wrapped to the therapist ---------------------------------------


def test_therapist_wrapped_session_key_is_stored_once(
    client: TestClient, therapist: dict[str, str], owner: Engine
) -> None:
    session_id = setup_session(client, owner)
    raw = base64.b64encode(os.urandom(32)).decode()
    body = {"key": raw, "therapist_key": message("session-key")}
    url = f"/sessions/{session_id}/key"
    assert client.post(url, json=body).status_code == 204
    assert client.post(url, json=body).status_code == 204  # retry
    other = {"key": raw, "therapist_key": message("another")}
    assert client.post(url, json=other).json() == {"code": "key_conflict"}
    assert client.post(url, json={"key": raw, "therapist_key": "x"}).status_code == 422

    with owner.connect() as c:
        rows = {k: v for k, v in c.execute(text("SELECT kind, ciphertext FROM wrapped_keys"))}
    assert bytes(rows["therapist"]).decode() == message("session-key")
    assert "processing" in rows

    # Signing destroys only the processing key; the therapist copy keeps the audio readable
    # for the therapist until the shred job deletes it.
    with owner.begin() as c:
        c.execute(text("DELETE FROM transcripts"))
    report = client.get(f"/sessions/{session_id}/report").json()
    client.put(f"/sessions/{session_id}/report", json=put_content(report))
    sign_note(client, session_id)
    with owner.connect() as c:
        assert c.execute(text("SELECT kind FROM wrapped_keys")).scalars().all() == ["therapist"]


def test_confirmed_chips_go_into_the_record_and_all_chips_leave_the_server(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = drafted(client, owner, worker)
    url = f"/sessions/{session_id}/captures"
    kept = str(uuid.uuid4())
    for capture_id, status, text_ in (
        (kept, "confirmed", "Termin am Montag"),
        (str(uuid.uuid4()), "dismissed", "x"),
    ):
        response = client.post(
            url,
            json={
                "id": capture_id,
                "kind": "date",
                "key": f"date:{status}",
                "at_ms": 1000,
                "text": text_,
                "status": status,
            },
        )
        assert response.status_code == 200, response.text

    prepared = prepare(client, session_id).json()
    assert prepared["note"]["captures"] == [
        {"id": kept, "kind": "date", "at_ms": 1000, "text": "Termin am Montag"}
    ]
    assert sign(client, session_id, sign_body(prepared)).status_code == 200
    with owner.connect() as c:
        assert c.execute(text("SELECT count(*) FROM captures")).scalar_one() == 0
    assert client.get(url).json() == []
