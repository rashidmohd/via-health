from google.cloud import kms

from app.adapters.gcp import gcp_credentials


class GoogleKmsProvider:
    """Cloud KMS key in europe-west4. The plaintext key never leaves KMS."""

    def __init__(self, key_name: str) -> None:
        self._key_name = key_name
        self._client = kms.KeyManagementServiceClient(credentials=gcp_credentials())

    def wrap(self, plaintext_key: bytes, *, aad: str) -> bytes:
        response = self._client.encrypt(
            request={
                "name": self._key_name,
                "plaintext": plaintext_key,
                "additional_authenticated_data": aad.encode(),
            }
        )
        return bytes(response.ciphertext)

    def unwrap(self, wrapped_key: bytes, *, aad: str) -> bytes:
        response = self._client.decrypt(
            request={
                "name": self._key_name,
                "ciphertext": wrapped_key,
                "additional_authenticated_data": aad.encode(),
            }
        )
        return bytes(response.plaintext)
