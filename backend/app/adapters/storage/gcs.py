from google.api_core import exceptions as gexc
from google.cloud import storage  # type: ignore[attr-defined]

from app.adapters.gcp import gcp_credentials


class GcsObjectStore:
    """Encrypted objects in the EU bucket (ADR 0001)."""

    def __init__(self, bucket: str, project: str) -> None:
        client = storage.Client(project=project, credentials=gcp_credentials())
        self._bucket = client.bucket(bucket)

    def put(self, key: str, data: bytes) -> None:
        self._bucket.blob(key).upload_from_string(data, content_type="application/octet-stream")

    def get(self, key: str) -> bytes:
        try:
            data: bytes = self._bucket.blob(key).download_as_bytes()
        except gexc.NotFound:
            raise KeyError("object not found") from None
        return data

    def delete_prefix(self, prefix: str) -> int:
        blobs = list(self._bucket.list_blobs(prefix=prefix))
        for blob in blobs:
            blob.delete()
        return len(blobs)
