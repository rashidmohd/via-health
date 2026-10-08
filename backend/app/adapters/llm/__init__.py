from functools import lru_cache

from app.adapters.llm.base import LlmError, LlmProvider
from app.core.config import get_settings


@lru_cache
def get_llm() -> LlmProvider:
    settings = get_settings()
    if settings.llm_provider == "fake":
        from app.adapters.llm.fake import FakeLlmProvider

        return FakeLlmProvider()
    from app.adapters.llm.gemini import GeminiProvider

    if settings.llm_provider == "gemini_api":
        if not settings.llm_api_key:
            raise LlmError("api_key_missing", retryable=False)
        return GeminiProvider(model=settings.llm_model, api_key=settings.llm_api_key)
    return GeminiProvider(
        model=settings.llm_model, project=settings.gcp_project_id, location=settings.gcp_region
    )


__all__ = ["LlmError", "LlmProvider", "get_llm"]
