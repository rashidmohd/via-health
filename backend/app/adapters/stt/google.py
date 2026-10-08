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
from app.adapters.stt.base import Segment, SttError

TEMP_PREFIX = "stt-tmp/"
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


def words_to_segments(words: Iterable[Any]) -> list[Segment]:
    """Group consecutive words with the same speaker label into segments."""
    segments: list[Segment] = []
    current: list[Any] = []

    def flush() -> None:
        if current:
            segments.append(
                Segment(
                    speaker=current[0].speaker_label or None,
                    start_ms=_ms(current[0].start_offset),
                    end_ms=_ms(current[-1].end_offset),
                    text=" ".join(w.word for w in current).strip(),
                )
            )
            current.clear()

    for word in words:
        if current and word.speaker_label != current[0].speaker_label:
            flush()
        current.append(word)
    flush()
    return segments


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

    def _batch_recognize(self, uri: str, language: str) -> list[Segment]:
        config = cloud_speech.RecognitionConfig(
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
        request = cloud_speech.BatchRecognizeRequest(
            recognizer=self._recognizer,
            config=config,
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
        return words_to_segments(words)
