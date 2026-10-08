from google.api_core import exceptions as gexc
from google.cloud import kms

from app.adapters.gcp import gcp_credentials
from app.adapters.kms.base import KmsUnavailable


class GoogleKmsProvider:
    """Cloud KMS key in europe-west4. The plaintext key never leaves KMS."""

    def __init__(self, key_name: str) -> None:
        self._key_name = key_name
        self._client = kms.KeyManagementServiceClient(credentials=gcp_credentials())

    def wrap(self, plaintext_key: bytes, *, aad: str) -> bytes:
        try:
            response = self._client.encrypt(
                request={
                    "name": self._key_name,
                    "plaintext": plaintext_key,
                    "additional_authenticated_data": aad.encode(),
                }
            )
        except gexc.GoogleAPICallError as exc:
            raise KmsUnavailable(type(exc).__name__) from None
        return bytes(response.ciphertext)

    def unwrap(self, wrapped_key: bytes, *, aad: str) -> bytes:
        try:
            response = self._client.decrypt(
                request={
                    "name": self._key_name,
                    "ciphertext": wrapped_key,
                    "additional_authenticated_data": aad.encode(),
                }
            )
        except gexc.GoogleAPICallError as exc:
            raise KmsUnavailable(type(exc).__name__) from None
        return bytes(response.plaintext)
