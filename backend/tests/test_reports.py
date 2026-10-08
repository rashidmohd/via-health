"""Session note (plan 0009): name placeholders, output validation, drafting worker, review,
approval and addenda — against a fresh real Postgres, worker as the restricted role."""

import logging
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError, ProgrammingError

from app.adapters.llm import LlmError
from app.adapters.llm.fake import FakeLlmProvider, default_answer
from app.core.data_crypto import encrypt_json
from app.db.session import WORKER_ROLE, make_engine
from app.domain.report_draft import (
    NameList,
    NameMasker,
    Note,
    apply_check,
    parse_draft,
    wording_hits,
)
from app.domain.report_template import AI_FIELDS, THERAPIST_FIELDS, draft_schema
from app.domain.transcript import Segment, Word
from app.workers.report import draft_report, draft_report_unconfigured, find_draft_work
from app.workers.transcribe import TransientFailure, transcript_aad
from tests.api_helpers import PNG, FakeEmailSender, login

# --- names (ADR 0007) -----------------------------------------------------------------


def test_names_are_masked_and_restored() -> None:
    masker = NameMasker(
        NameList(client=["Anna Schmidt"], therapist=["Dr. Tara Berg"], others=["Tom Weber"]),
        "de",
    )
    masked = masker.mask("anna sagt, Toms Chef und Frau Schmidt; Annas Mutter. Berg. Tomate.")
    assert masked == (
        "[Klient:in] sagt, [Person 1] Chef und Frau [Klient:in]; [Klient:in] Mutter. "
        "[Therapeut:in]. Tomate."
    )
    assert masker.restore("[Klient:in] und [Person 1]") == "Anna Schmidt und Tom Weber"


def test_name_particles_and_short_parts_are_not_masked_alone() -> None:
    masker = NameMasker(NameList(client=["Lea von der Au"]), "en")
    assert masker.mask("von der Arbeit, Lea, Au") == "von der Arbeit, [Client], Au"
    assert masker.mask("Lea von der Au kam") == "[Client] kam"


def test_no_names_means_no_change() -> None:
    assert NameMasker(NameList(), "de").mask("Hallo Anna") == "Hallo Anna"


# --- wording and output validation ----------------------------------------------------


def test_wording_hits() -> None:
    assert wording_hits("Klientin wirkte traurig und verweigerte die Aufgabe") == [
        "wirkte",
        "traurig",
        "verweigerte",
    ]
    assert wording_hits("Client seemed anxious") == ["seemed", "anxious"]
    assert wording_hits("Klientin berichtet von der Arbeit") == []


SEGMENTS = [
    Segment("1", 0, 2000, "Wie war die Woche?"),
    Segment("2", 2100, 6000, "Ich habe das Protokoll an vier Tagen geführt."),
]
NOTES = [Note("n-1", "action_item", 5000, "Gedankenprotokoll")]


def test_parse_draft_keeps_only_requested_fields_and_valid_sources() -> None:
    raw = {
        "topics": {
            "status": "content",
            "statements": [
                {
                    "text": "  Protokoll   geführt ",
                    "kind": "reported",
                    "refs": [1, 7, 1, -1],
                    "note_refs": [1, 2],
                },
                {"text": "", "kind": "reported", "refs": [0]},
                {"text": "Neu", "kind": "diagnosis", "refs": "x"},
            ],
        },
        "crisis": {"status": "content", "statements": [{"text": "keine", "refs": [0]}]},
        "mental_status": {"status": "content", "statements": [{"text": "x", "refs": [0]}]},
    }
    fields = parse_draft(
        raw, fields=("topics", "agreements"), segments=SEGMENTS, notes=NOTES, restore=str
    )
    assert set(fields) == {"topics", "agreements"}
    first, second = fields["topics"]["statements"]
    assert first["text"] == "Protokoll geführt"
    assert first["refs"] == [[2100, 6000]]
    assert first["notes"] == ["n-1"]
    assert second["kind"] == "reported" and second["refs"] == []
    assert fields["agreements"] == {"status": "not_discussed", "statements": []}


def test_check_marks_missing_answers_and_sourceless_statements_unsupported() -> None:
    raw = {
        "topics": {
            "status": "content",
            "statements": [
                {"text": "A", "kind": "reported", "refs": [0], "note_refs": []},
                {"text": "B", "kind": "reported", "refs": [1], "note_refs": []},
                {"text": "C", "kind": "reported", "refs": [], "note_refs": []},
            ],
        }
    }
    fields = parse_draft(raw, fields=("topics",), segments=SEGMENTS, notes=[], restore=str)
    a, b, c = fields["topics"]["statements"]
    apply_check(
        fields,
        {
            "results": [
                {"id": a["id"], "support": "supported"},
                {"id": c["id"], "support": "supported"},
            ]
        },
    )
    assert [s["support"] for s in (a, b, c)] == ["supported", "unsupported", "unsupported"]
    assert "lines" not in a


def test_therapist_only_fields_are_never_in_the_schema() -> None:
    schema = draft_schema(AI_FIELDS)
    assert set(schema["properties"]) == set(AI_FIELDS)
    assert not set(schema["properties"]) & set(THERAPIST_FIELDS)
    with pytest.raises(AssertionError):
        draft_schema(("topics", "crisis"))


# --- worker and API -----------------------------------------------------------------


@pytest.fixture
def worker(fresh_db_url: str) -> Iterator[Engine]:
    engine = make_engine(fresh_db_url, role=WORKER_ROLE)
    yield engine
    engine.dispose()


@pytest.fixture
def therapist(client: TestClient, mail: FakeEmailSender) -> dict[str, str]:
    return login(client, mail, "therapist@example.com", display_name="Tara Berg")


TRANSCRIPT = [
    Word("1", 0, 400, "Hallo"),
    Word("1", 400, 900, "Anna,"),
    Word("1", 900, 1500, "wie war die Woche?"),
    Word("2", 2000, 2600, "Tom"),
    Word("2", 2600, 3000, "Weber"),
    Word("2", 3000, 4000, "hat angerufen."),
]


def setup_session(client: TestClient, owner: Engine, *, hidden: list[str] | None = None) -> str:
    client_id = client.post("/clients", json={"name": "Anna Schmidt"}).json()["id"]
    client.post(
        f"/clients/{client_id}/consents",
        json={"kinds": ["recording", "ai_processing"], "language": "de", "signature": PNG},
    )
    if hidden is not None:
        assert (
            client.put(f"/clients/{client_id}/hidden-names", json={"names": hidden}).status_code
            == 200
        )
    session_id = str(uuid.uuid4())
    response = client.post(
        "/sessions",
        json={
            "id": session_id,
            "client_id": client_id,
            "started_at": datetime.now(UTC).isoformat(),
            "mime_type": "audio/webm;codecs=opus",
        },
    )
    assert response.status_code == 201, response.text
    with owner.begin() as c:
        c.execute(
            text(
                "INSERT INTO transcripts (session_id, segments_enc, language, stt_model, "
                "refine_status, speaker_roles) VALUES (:id, :enc, 'de-DE', 'fake', 'done', "
                "CAST(:roles AS jsonb))"
            ),
            {
                "id": session_id,
                "enc": encrypt_json(
                    {"words": [w.to_json() for w in TRANSCRIPT], "segments": []},
                    transcript_aad(uuid.UUID(session_id)),
                ),
                "roles": '{"therapist": "1"}',
            },
        )
    return session_id


def draft(worker: Engine, session_id: str, llm: Any = None, last_attempt: bool = True) -> str:
    return draft_report(
        uuid.UUID(session_id),
        engine=worker,
        llm=llm or FakeLlmProvider(),
        last_attempt=last_attempt,
    )


def put_content(report: dict[str, Any], **changes: Any) -> dict[str, Any]:
    content = report["content"]
    body = {
        "header": content["header"],
        "ai": {
            code: {
                "statements": [
                    {"id": s["id"], "text": s["text"], "resolved": s["resolved"]}
                    for s in field["statements"]
                ]
            }
            for code, field in content["ai"].items()
        },
        "therapist": content["therapist"],
    }
    body.update(changes)
    return body


def test_transcript_is_drafted_automatically_with_names_hidden(
    client: TestClient,
    therapist: dict[str, str],
    owner: Engine,
    worker: Engine,
    caplog: pytest.LogCaptureFixture,
) -> None:
    session_id = setup_session(client, owner, hidden=["Tom Weber"])
    assert client.get(f"/sessions/{session_id}/report").json()["status"] == "none"
    assert find_draft_work(worker) == [uuid.UUID(session_id)]
    llm = FakeLlmProvider()

    with caplog.at_level(logging.INFO):
        assert draft(worker, session_id, llm) == "draft"

    sent = " ".join(call["system"] + call["prompt"] for call in llm.calls)
    for name in ("Anna", "Schmidt", "Tom", "Weber", "Tara", "Berg"):
        assert name not in sent
    assert "[Klient:in]" in sent and "[Person 1]" in sent
    assert "Anna" not in caplog.text and "Woche" not in caplog.text

    report = client.get(f"/sessions/{session_id}/report").json()
    assert report["status"] == "draft"
    assert report["ai_assisted"] is True and report["llm_model"] == "fake"
    topics = report["content"]["ai"]["topics"]["statements"]
    assert topics[0]["text"] == "Hallo Anna Schmidt, wie war die Woche?"  # names restored
    assert topics[0]["refs"] == [[0, 1500]]
    assert topics[0]["support"] == "supported" and topics[0]["blocking"] is False
    assert report["content"]["therapist"] == dict.fromkeys(THERAPIST_FIELDS, "")
    assert find_draft_work(worker) == []


def test_model_output_for_therapist_fields_is_dropped(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = setup_session(client, owner)

    def answer(system: str, prompt: str, schema: dict[str, Any]) -> dict[str, Any]:
        out = default_answer(prompt, schema)
        if "results" not in schema["properties"]:
            assert not set(schema["properties"]) & set(THERAPIST_FIELDS)
            out["crisis"] = {"status": "content", "statements": [{"text": "verneint", "refs": [0]}]}
        return out

    draft(worker, session_id, FakeLlmProvider(answer))
    report = client.get(f"/sessions/{session_id}/report").json()
    assert report["content"]["therapist"]["crisis"] == ""


def test_flagged_statements_block_approval_until_resolved(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = setup_session(client, owner)

    def answer(system: str, prompt: str, schema: dict[str, Any]) -> dict[str, Any]:
        if "results" in schema["properties"]:
            return {"results": []}  # nothing confirmed
        out = {code: {"status": "not_discussed", "statements": []} for code in schema["properties"]}
        out["topics"] = {
            "status": "content",
            "statements": [
                {
                    "text": "Klientin wirkte traurig",
                    "kind": "reported",
                    "refs": [1],
                    "note_refs": [],
                }
            ],
        }
        return out

    draft(worker, session_id, FakeLlmProvider(answer))
    report = client.get(f"/sessions/{session_id}/report").json()
    statement = report["content"]["ai"]["topics"]["statements"][0]
    assert statement["support"] == "unsupported"
    assert statement["ai_wording"] == ["wirkte", "traurig"]
    assert report["blocking"] == 1
    assert client.post(f"/sessions/{session_id}/report/approve").json() == {
        "code": "report_unresolved"
    }

    body = put_content(report)
    body["ai"]["topics"]["statements"][0].update(
        text="Klientin berichtet: „Ich bin traurig.“", resolved=True
    )
    saved = client.put(f"/sessions/{session_id}/report", json=body).json()
    kept = saved["content"]["ai"]["topics"]["statements"][0]
    # Sources and check results come from the stored draft, not from the browser.
    assert kept["refs"] == [[2000, 4000]] and kept["support"] == "unsupported"
    assert kept["origin"] == "ai" and kept["wording"] == ["traurig"]
    assert saved["blocking"] == 0

    approved = client.post(f"/sessions/{session_id}/report/approve").json()
    assert approved["status"] == "approved"
    assert approved["content"]["header"]["session_no"] == "1"
    assert [v["kind"] for v in approved["versions"]] == ["approval"]


def test_approved_note_is_read_only_and_takes_addenda(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = setup_session(client, owner)
    draft(worker, session_id)
    report = client.get(f"/sessions/{session_id}/report").json()
    body = put_content(
        report, therapist={**report["content"]["therapist"], "progress": "Fortschritt"}
    )
    client.put(f"/sessions/{session_id}/report", json=body)
    client.post(f"/sessions/{session_id}/report/approve")

    assert client.put(f"/sessions/{session_id}/report", json=body).json() == {
        "code": "report_approved"
    }
    assert client.post(f"/sessions/{session_id}/report/draft", json={}).json() == {
        "code": "report_approved"
    }
    added = client.post(
        f"/sessions/{session_id}/report/addenda", json={"text": "Nachtrag: Termin verschoben"}
    ).json()
    assert [(v["version"], v["kind"], v["text"]) for v in added["versions"]] == [
        (1, "approval", None),
        (2, "addendum", "Nachtrag: Termin verschoben"),
    ]
    assert added["content"]["therapist"]["progress"] == "Fortschritt"

    with owner.begin() as c:  # even the owner cannot change approved records
        with pytest.raises(DBAPIError), c.begin_nested():
            c.execute(text("UPDATE reports SET content_enc = '\\x00'"))
        with pytest.raises(DBAPIError), c.begin_nested():
            c.execute(text("UPDATE report_versions SET content_enc = '\\x00'"))
        with pytest.raises(DBAPIError), c.begin_nested():
            c.execute(text("DELETE FROM report_versions"))


def test_regenerate_one_field_keeps_the_rest(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = setup_session(client, owner)
    draft(worker, session_id)
    report = client.get(f"/sessions/{session_id}/report").json()
    agreements_before = report["content"]["ai"]["agreements"]
    body = put_content(report, therapist={**report["content"]["therapist"], "notable": "x"})
    client.put(f"/sessions/{session_id}/report", json=body)

    requested = client.post(f"/sessions/{session_id}/report/draft", json={"field": "topics"})
    assert requested.json()["status"] == "pending"
    assert requested.json()["pending_field"] == "topics"
    llm = FakeLlmProvider()
    assert draft(worker, session_id, llm) == "draft"

    assert list(llm.calls[0]["schema"]["properties"]) == ["topics"]
    after = client.get(f"/sessions/{session_id}/report").json()
    assert after["content"]["therapist"]["notable"] == "x"
    assert after["content"]["ai"]["agreements"] == agreements_before
    assert (
        after["content"]["ai"]["topics"]["statements"][0]["id"]
        != (report["content"]["ai"]["topics"]["statements"][0]["id"])
    )


def test_manual_note_without_ai(
    client: TestClient, therapist: dict[str, str], owner: Engine
) -> None:
    session_id = setup_session(client, owner)
    report = client.get(f"/sessions/{session_id}/report").json()
    body = put_content(report)
    body["ai"]["topics"] = {"statements": [{"id": "0123456789ab", "text": "Arbeit"}]}
    saved = client.put(f"/sessions/{session_id}/report", json=body).json()
    assert saved["status"] == "draft" and saved["ai_assisted"] is False
    assert saved["content"]["ai"]["topics"]["statements"][0]["origin"] == "therapist"
    assert client.post(f"/sessions/{session_id}/report/approve").json()["status"] == "approved"


def test_withdrawn_consent_means_no_draft(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = setup_session(client, owner)
    client_id = client.get(f"/sessions/{session_id}").json()["client_id"]
    consent = next(
        c
        for c in client.get(f"/clients/{client_id}").json()["consents"]
        if c["kind"] == "ai_processing"
    )
    client.post(f"/consents/{consent['id']}/withdraw")
    llm = FakeLlmProvider()
    assert draft(worker, session_id, llm) == "no_consent"
    assert llm.calls == []
    assert client.get(f"/sessions/{session_id}/report").json()["status"] == "no_consent"


def test_transient_llm_error_retries_then_fails(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = setup_session(client, owner)

    def down(system: str, prompt: str, schema: dict[str, Any]) -> dict[str, Any]:
        raise LlmError("api_error_503", retryable=True)

    with pytest.raises(TransientFailure):
        draft(worker, session_id, FakeLlmProvider(down), last_attempt=False)
    assert client.get(f"/sessions/{session_id}/report").json()["status"] == "pending"
    assert draft(worker, session_id, FakeLlmProvider(down)) == "failed"
    report = client.get(f"/sessions/{session_id}/report").json()
    assert (report["status"], report["failure_reason"]) == ("failed", "drafting_failed")
    # The therapist can ask again.
    assert client.post(f"/sessions/{session_id}/report/draft", json={}).json()["status"] == (
        "pending"
    )


def test_missing_llm_settings_fail_without_retry(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = setup_session(client, owner)
    assert draft_report_unconfigured(worker, uuid.UUID(session_id)) == "failed"
    report = client.get(f"/sessions/{session_id}/report").json()
    assert report["failure_reason"] == "llm_not_configured"


def test_draft_request_needs_a_transcript(
    client: TestClient, therapist: dict[str, str], owner: Engine
) -> None:
    session_id = setup_session(client, owner)
    with owner.begin() as c:
        c.execute(text("DELETE FROM transcripts"))
    assert client.post(f"/sessions/{session_id}/report/draft", json={}).json() == {
        "code": "transcript_not_ready"
    }


def test_other_therapist_cannot_read_report(
    client: TestClient,
    mail: FakeEmailSender,
    therapist: dict[str, str],
    owner: Engine,
    worker: Engine,
) -> None:
    session_id = setup_session(client, owner)
    draft(worker, session_id)
    client.cookies.clear()
    login(client, mail, "other@example.com", display_name="O")
    assert client.get(f"/sessions/{session_id}/report").json() == {"code": "session_not_found"}


def test_worker_cannot_read_hidden_names_or_approved_versions(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    setup_session(client, owner, hidden=["Tom"])
    with worker.connect() as c:
        for query in ("SELECT hidden_names_enc FROM clients", "SELECT * FROM report_versions"):
            with pytest.raises(ProgrammingError), c.begin_nested():
                c.execute(text(query))


def test_hidden_names_are_cleaned(client: TestClient, therapist: dict[str, str]) -> None:
    client_id = client.post("/clients", json={"name": "Anna"}).json()["id"]
    saved = client.put(
        f"/clients/{client_id}/hidden-names", json={"names": [" Tom  Weber ", "Tom Weber", "Ida"]}
    ).json()
    assert saved == {"names": ["Tom Weber", "Ida"]}
    assert client.get(f"/clients/{client_id}/hidden-names").json() == saved


def test_session_card_shows_the_note_topics(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = setup_session(client, owner)
    card = client.get(f"/sessions/{session_id}").json()
    assert (card["report_status"], card["report_topics"]) == (None, [])

    draft(worker, session_id)
    report = client.get(f"/sessions/{session_id}/report").json()
    body = put_content(report)
    body["ai"]["topics"] = {
        "statements": [
            {"id": "0123456789ab", "text": "Konflikt am Arbeitsplatz"},
            {"id": "0123456789ac", "text": "x" * 200},
        ]
    }
    client.put(f"/sessions/{session_id}/report", json=body)

    listed = client.get("/sessions").json()[0]
    assert listed["report_status"] == "draft"
    assert listed["report_topics"][0] == "Konflikt am Arbeitsplatz"
    assert len(listed["report_topics"][1]) == 80 and listed["report_topics"][1].endswith("…")
