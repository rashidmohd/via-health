"""Speech-to-Text V2, Chirp 3, location `eu`, with speaker diarization.

BatchRecognize only reads audio from GCS, so the decrypted audio is written to a temporary
object `stt-tmp/<job_id>` and deleted in `finally` (plan 0005; bucket lifecycle rule on
`stt-tmp/` as a safety net). Data logging must be off on the project (rule 5)."""

from collections.abc import Iterable
from typing import Any

from google.api_core import exceptions as gexc
from google.api_core.client_options import ClientOptions
from google.cloud import storage  # type: ignore[attr-defined]
from google.cloud.speech_v2 import SpeechClient
from google.cloud.speech_v2.types import cloud_speech

from app.adapters.gcp import gcp_credentials
from app.adapters.stt.base import TEMP_PREFIX, Segment, SttError, Word
from app.domain.transcript import words_to_segments as domain_words_to_segments

TIMEOUT_S = 30 * 60
RETRYABLE = (
    gexc.ServiceUnavailable,
    gexc.DeadlineExceeded,
    gexc.InternalServerError,
    gexc.TooManyRequests,
    gexc.ResourceExhausted,
)


def _ms(offset: Any) -> int:
    return int(offset.total_seconds() * 1000) if offset is not None else 0


def to_words(google_words: Iterable[Any]) -> list[Word]:
    return [
        Word(
            speaker=w.speaker_label or None,
            start_ms=_ms(w.start_offset),
            end_ms=_ms(w.end_offset),
            text=w.word,
        )
        for w in google_words
    ]


def words_to_segments(google_words: Iterable[Any]) -> list[Segment]:
    """Group consecutive words with the same speaker label into segments."""
    return domain_words_to_segments(to_words(google_words))


class GoogleChirp3Provider:
    def __init__(self, *, project: str, location: str, model: str, bucket: str) -> None:
        credentials = gcp_credentials()
        self._recognizer = f"projects/{project}/locations/{location}/recognizers/_"
        self._model = model
        self._speech = SpeechClient(
            credentials=credentials,
            client_options=ClientOptions(api_endpoint=f"{location}-speech.googleapis.com"),
        )
        self._bucket = storage.Client(project=project, credentials=credentials).bucket(bucket)
        self._bucket_name = bucket

    def transcribe(
        self, audio: bytes, *, mime_type: str, language: str, job_id: str
    ) -> list[Segment]:
        return domain_words_to_segments(
            self.diarize_words(audio, mime_type=mime_type, language=language, job_id=job_id)
        )

    def diarize_words(
        self, audio: bytes, *, mime_type: str, language: str, job_id: str
    ) -> list[Word]:
        blob = self._bucket.blob(f"{TEMP_PREFIX}{job_id}")
        try:
            blob.upload_from_string(audio, content_type=mime_type.split(";")[0])
            uri = f"gs://{self._bucket_name}/{blob.name}"
            return self._batch_recognize(uri, language)
        except RETRYABLE as exc:
            raise SttError(type(exc).__name__, retryable=True) from None
        except gexc.GoogleAPICallError as exc:
            raise SttError(type(exc).__name__, retryable=False) from None
        finally:
            try:
                blob.delete()
            except gexc.NotFound:
                pass

    def recognize_window(self, audio_wav: bytes, *, language: str) -> list[Word]:
        try:
            response = self._speech.recognize(
                request=cloud_speech.RecognizeRequest(
                    recognizer=self._recognizer,
                    config=self._config(language),
                    content=audio_wav,
                ),
                timeout=120,
            )
        except RETRYABLE as exc:
            raise SttError(type(exc).__name__, retryable=True) from None
        except gexc.GoogleAPICallError as exc:
            raise SttError(type(exc).__name__, retryable=False) from None
        return to_words(
            word
            for result in response.results
            if result.alternatives
            for word in result.alternatives[0].words
        )

    def _config(self, language: str) -> Any:
        return cloud_speech.RecognitionConfig(
            auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
            language_codes=[language],
            model=self._model,
            features=cloud_speech.RecognitionFeatures(
                enable_word_time_offsets=True,
                enable_automatic_punctuation=True,
                diarization_config=cloud_speech.SpeakerDiarizationConfig(
                    min_speaker_count=2, max_speaker_count=2
                ),
            ),
        )

    def _batch_recognize(self, uri: str, language: str) -> list[Word]:
        request = cloud_speech.BatchRecognizeRequest(
            recognizer=self._recognizer,
            config=self._config(language),
            files=[cloud_speech.BatchRecognizeFileMetadata(uri=uri)],
            recognition_output_config=cloud_speech.RecognitionOutputConfig(
                inline_response_config=cloud_speech.InlineOutputConfig()
            ),
        )
        response = self._speech.batch_recognize(request=request).result(timeout=TIMEOUT_S)
        file_result = response.results[uri]
        if file_result.error and file_result.error.code:
            raise SttError(f"file_error_{file_result.error.code}", retryable=False)
        words = [
            word
            for result in file_result.inline_result.transcript.results
            if result.alternatives
            for word in result.alternatives[0].words
        ]
        return to_words(words)
