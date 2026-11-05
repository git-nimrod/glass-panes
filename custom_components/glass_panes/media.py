"""Uploaded images and videos for panes (a picture on a pane, a looping video, later backgrounds).

No Home Assistant imports, so it can be tested on its own. The files live in config/glass_panes/media/ and are served only through
the login-protected /api/glass_panes/media/<id> address (or an expiring signed link made from it), never as plain static files.

What is accepted is decided by the file's own first bytes, not its name: a renamed .exe or an SVG (which can carry script) is refused.
"""

from __future__ import annotations

import re
import secrets
import shutil
from pathlib import Path
from typing import Any

IMAGE_MAX = 25 * 1024 * 1024
VIDEO_MAX = 100 * 1024 * 1024               # Home Assistant's own upload limit is also 100 MB
MAX_MEDIA = 200
MIME = {
    "jpg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp",
    "mp4": "video/mp4", "mov": "video/quicktime", "webm": "video/webm",
}
_ID = re.compile(r"^m_[0-9a-f]{12}\Z")


def is_valid_id(value: Any) -> bool:
    return isinstance(value, str) and bool(_ID.match(value))


def new_id(taken: set[str]) -> str:
    while True:
        candidate = "m_" + secrets.token_hex(6)
        if candidate not in taken:
            return candidate


def sniff(head: bytes) -> tuple[str, str] | None:
    """(kind, extension) from a file's first bytes, or None when it is not a supported image or video."""
    if head[:3] == b"\xff\xd8\xff":
        return "image", "jpg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "image", "png"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image", "gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image", "webp"
    if head[4:8] == b"ftyp":
        return "video", ("mov" if head[8:12] == b"qt  " else "mp4")      # an iPhone movie is a QuickTime file
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "video", "webm"
    return None


def size_problem(kind: str, size: int) -> str | None:
    limit = IMAGE_MAX if kind == "image" else VIDEO_MAX
    if size <= 0:
        return "the file is empty"
    if size > limit:
        return f"the {kind} is too big ({size // (1024 * 1024)} MB; the limit is {limit // (1024 * 1024)} MB)"
    return None


def ingest(source: Path, folder: Path, media_id: str) -> dict[str, Any]:
    """Check an uploaded file and copy it into the media folder (blocking: run it in an executor).

    Returns {id, kind, ext, size}. Raises ValueError with a plain-language reason when the file is not acceptable.
    """
    with source.open("rb") as handle:
        head = handle.read(16)
    found = sniff(head)
    if found is None:
        raise ValueError("that is not a supported image (JPEG, PNG, GIF, WebP) or video (MP4, MOV, WebM)")
    kind, ext = found
    size = source.stat().st_size
    problem = size_problem(kind, size)
    if problem:
        raise ValueError(problem)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{media_id}.{ext}"
    partial = folder / f"{media_id}.part"
    shutil.copyfile(source, partial)
    partial.replace(target)
    return {"id": media_id, "kind": kind, "ext": ext, "size": size}


def validate_document(doc: Any) -> list[str]:
    """Check a stored media index."""
    if not isinstance(doc, dict) or doc.get("schema_version") != 1 or not isinstance(doc.get("media"), dict):
        return ["not a media document"]
    errors = []
    for media_id, rec in doc["media"].items():
        if not is_valid_id(media_id) or not isinstance(rec, dict) or rec.get("id") != media_id \
                or rec.get("ext") not in MIME or rec.get("kind") not in ("image", "video"):
            errors.append(f"{media_id}: not a valid media record")
    return errors
