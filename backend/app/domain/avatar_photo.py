"""Profile photo checks (plan 0012). The browser crops and re-encodes the photo (which drops
EXIF/GPS); the server double-checks: WebP or JPEG only, small, and no metadata blocks."""

import struct

MAX_PHOTO_BYTES = 300_000

# JPEG markers that carry metadata: APP1 (EXIF, XMP) and APP13 (IPTC / Photoshop).
_JPEG_METADATA = {0xE1, 0xED}
# WebP chunks that carry metadata.
_WEBP_METADATA = {b"EXIF", b"XMP "}


class PhotoInvalid(Exception):
    """Not an accepted image, or it still carries metadata. Carries no data."""


def photo_type(data: bytes) -> str:
    """Return the media type of a clean photo, or raise PhotoInvalid."""
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        _check_webp(data)
        return "image/webp"
    if data[:3] == b"\xff\xd8\xff":
        _check_jpeg(data)
        return "image/jpeg"
    raise PhotoInvalid("unsupported type")


def _check_webp(data: bytes) -> None:
    offset = 12
    if data[offset : offset + 4] not in (b"VP8 ", b"VP8L", b"VP8X"):
        raise PhotoInvalid("not a WebP image")
    while offset + 8 <= len(data):
        fourcc = data[offset : offset + 4]
        (size,) = struct.unpack("<I", data[offset + 4 : offset + 8])
        if fourcc in _WEBP_METADATA:
            raise PhotoInvalid("metadata")
        offset += 8 + size + (size & 1)


def _check_jpeg(data: bytes) -> None:
    offset = 2
    while offset + 4 <= len(data):
        if data[offset] != 0xFF:
            raise PhotoInvalid("broken JPEG")
        marker = data[offset + 1]
        if marker == 0xDA:  # start of scan: image data follows, no more headers
            return
        if 0xD0 <= marker <= 0xD9 or marker == 0x01:
            offset += 2
            continue
        if marker in _JPEG_METADATA:
            raise PhotoInvalid("metadata")
        (length,) = struct.unpack(">H", data[offset + 2 : offset + 4])
        offset += 2 + length
    raise PhotoInvalid("no image data")
