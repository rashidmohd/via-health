"""Gemini via the google-genai SDK: Vertex AI in the EU (prod) or the Gemini Developer API
(dev/staging, test data only, ADR 0005).

Rule 5: no grounding and no tools are ever configured. Vertex's 24 h in-memory cache is a
project setting and must be disabled in the console (docs/google-cloud-setup.md)."""

import json
from typing import Any

from google import genai
from google.genai import errors as gerrors
from google.genai import types

from app.adapters.gcp import gcp_credentials
from app.adapters.llm.base import LlmError

RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}
SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]


class GeminiProvider:
    def __init__(
        self, *, model: str, api_key: str = "", project: str = "", location: str = ""
    ) -> None:
        if not model:
            raise LlmError("model_not_configured", retryable=False)
        self.model = model
        if api_key:
            self._client = genai.Client(api_key=api_key)
        else:
            credentials = gcp_credentials()
            if credentials is not None and getattr(credentials, "requires_scopes", False):
                credentials = credentials.with_scopes(SCOPES)
            self._client = genai.Client(
                vertexai=True, project=project, location=location, credentials=credentials
            )

    def generate_json(self, *, system: str, prompt: str, schema: dict[str, Any]) -> dict[str, Any]:
        return self._json(system, [prompt], schema)

    def describe_image_json(
        self, *, system: str, prompt: str, image: bytes, mime_type: str, schema: dict[str, Any]
    ) -> dict[str, Any]:
        return self._json(
            system, [types.Part.from_bytes(data=image, mime_type=mime_type), prompt], schema
        )

    def _json(self, system: str, contents: list[Any], schema: dict[str, Any]) -> dict[str, Any]:
        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=0.2,
            response_mime_type="application/json",
            response_json_schema=schema,
        )
        try:
            response = self._client.models.generate_content(
                model=self.model, contents=contents, config=config
            )
        except gerrors.APIError as error:
            raise LlmError(
                f"api_error_{error.code}", retryable=error.code in RETRYABLE_STATUS
            ) from None
        if not response.text:
            raise LlmError("empty_response", retryable=True)
        try:
            value = json.loads(response.text)
        except json.JSONDecodeError:
            raise LlmError("invalid_json", retryable=True) from None
        if not isinstance(value, dict):
            raise LlmError("invalid_json", retryable=True)
        return value
