from fastapi.testclient import TestClient

from app.main import app


def test_healthz_returns_ok_without_details() -> None:
    response = TestClient(app).get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
