from fastapi import APIRouter

router = APIRouter()


@router.get("/healthz")
def healthz() -> dict[str, str]:
    # No DB or dependency details in the body.
    return {"status": "ok"}
