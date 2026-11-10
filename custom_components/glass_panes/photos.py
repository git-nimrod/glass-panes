"""Photos for the slideshow and for image/camera entities: find them in a folder and shrink them to the display's size.

No Home Assistant imports, so it can be tested on its own (Pillow is imported only when a picture is actually resized).

Why it shrinks: a phone photo is 12 to 50 megapixels, which is more than a 1 GB mirror can decode (the page gets killed). So the
mirror never receives the original. Each photo is resized once to the widget's size, kept in a cache folder, and only that small
copy is sent. Everything here is blocking file work: run it in an executor.

Safety: a folder is always a path inside a media folder. `..`, absolute paths and links that point outside it are refused, and a
file is only used when its first bytes say it is a JPEG, PNG or WebP (not by its name).
"""

from __future__ import annotations

import hashlib
import io
import os
import re
from pathlib import Path
from typing import Any

PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_LIST = 500                      # photos listed per folder (a slideshow never needs more, and each one gets a signed link)
MAX_PIXELS = 120_000_000            # refuse to decode anything bigger than this (a decompression bomb)
MIN_SIDE, MAX_SIDE = 128, 2160
QUALITY = 85
CACHE_MAX_BYTES = 300 * 1024 * 1024


_PICTURE_ENTITY = re.compile(r"^(image|camera)\.[a-z0-9_]{1,100}\Z")


def is_picture_entity(entity_id: Any) -> bool:
    """Only image and camera entities can be asked for a picture."""
    return isinstance(entity_id, str) and bool(_PICTURE_ENTITY.match(entity_id))


def bucket(value: Any, default: int = 1080) -> int:
    """A requested side length rounded up to a multiple of 64 and kept in range, so similar sizes share one cached copy."""
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = default
    n = min(max(n, MIN_SIDE), MAX_SIDE)
    return min(((n + 63) // 64) * 64, MAX_SIDE)


def _inside(root: Path, target: Path) -> bool:
    return target == root or root in target.parents


def resolve_folder(root: Path, folder: Any) -> Path | None:
    """The folder `folder` (written relative to `root`, for example "photos/family"), or None when it is not a real folder inside root."""
    text = str(folder or "").replace("\\", "/").strip().strip("/")
    if len(text) > 240 or "\x00" in text:
        return None
    if any(part == ".." for part in text.split("/")):
        return None
    try:
        base = root.resolve()
        target = (base / text).resolve() if text else base
    except OSError:
        return None
    return target if _inside(base, target) and target.is_dir() else None


def looks_like_photo(head: bytes) -> bool:
    return head[:3] == b"\xff\xd8\xff" or head[:8] == b"\x89PNG\r\n\x1a\n" or (head[:4] == b"RIFF" and head[8:12] == b"WEBP")


def list_photos(root: Path, folder: Any, limit: int = MAX_LIST) -> list[str] | None:
    """File names (not paths) of the photos directly inside the folder, sorted; None when the folder does not exist."""
    target = resolve_folder(root, folder)
    if target is None:
        return None
    names: list[str] = []
    try:
        with os.scandir(target) as it:
            for entry in it:
                if entry.name.startswith(".") or Path(entry.name).suffix.lower() not in PHOTO_EXTS:
                    continue
                try:
                    if entry.is_file():
                        names.append(entry.name)
                except OSError:
                    continue
    except OSError:
        return None
    names.sort(key=str.lower)
    return names[:limit]


def resolve_photo(root: Path, folder: Any, name: Any) -> Path | None:
    """One photo inside the folder, or None (a name with a path in it, a link out of root, or a file that is not a photo)."""
    text = str(name or "")
    if not text or "/" in text or "\\" in text or text.startswith(".") or "\x00" in text:
        return None
    if Path(text).suffix.lower() not in PHOTO_EXTS:
        return None
    target = resolve_folder(root, folder)
    if target is None:
        return None
    try:
        path = (target / text).resolve()
        if not _inside(root.resolve(), path) or not path.is_file():
            return None
        with path.open("rb") as handle:
            return path if looks_like_photo(handle.read(16)) else None
    except OSError:
        return None


def cache_name(path: Path, w: int, h: int) -> str:
    """The cache file for this photo at this size. Includes the modified time and size, so an edited photo is made again."""
    st = path.stat()
    key = f"{path}|{st.st_mtime_ns}|{st.st_size}|{w}x{h}"
    return hashlib.sha1(key.encode("utf-8", "surrogatepass")).hexdigest() + ".jpg"


def shrink(data: bytes | Path, w: int, h: int) -> bytes:
    """JPEG bytes of the picture, no bigger than w by h (never enlarged), upright, on a black background if it had transparency.

    JPEGs are decoded at a reduced size straight away (`draft`), which keeps a 50 megapixel photo from ever being held in memory
    whole. Raises ValueError when the file cannot be read as a picture or is absurdly large.
    """
    try:
        from PIL import Image, ImageOps, UnidentifiedImageError
    except ImportError as err:                       # Home Assistant normally ships Pillow; say so plainly if this install does not
        raise ValueError("this Home Assistant has no Pillow, so pictures cannot be resized") from err

    try:
        source = io.BytesIO(data) if isinstance(data, (bytes, bytearray)) else open(data, "rb")      # noqa: SIM115 (closed below)
        with source:
            img = Image.open(source)
            if img.width * img.height > MAX_PIXELS:
                raise ValueError("the picture is too large to resize")
            if img.format == "JPEG":
                img.draft("RGB", (w * 2, h * 2))          # decode at 1/2, 1/4 or 1/8 size when that still leaves enough detail
            img = ImageOps.exif_transpose(img)
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                rgba = img.convert("RGBA")
                flat = Image.new("RGB", rgba.size, (0, 0, 0))
                flat.paste(rgba, mask=rgba.getchannel("A"))
                img = flat
            elif img.mode != "RGB":
                img = img.convert("RGB")
            img.thumbnail((w, h), Image.Resampling.LANCZOS)            # only ever shrinks
            out = io.BytesIO()
            img.save(out, "JPEG", quality=QUALITY, optimize=True, progressive=False)
            return out.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as err:
        raise ValueError(f"that file could not be read as a picture ({err.__class__.__name__})") from err


def resized_file(path: Path, cache_dir: Path, w: int, h: int) -> Path:
    """The cached, shrunk copy of a photo (made now when it is not there yet)."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / cache_name(path, w, h)
    if target.is_file():
        try:
            os.utime(target)                                           # marks it as recently used, for prune()
        except OSError:
            pass
        return target
    partial = target.with_suffix(".part")
    partial.write_bytes(shrink(path, w, h))
    partial.replace(target)
    return target


def prune(cache_dir: Path, max_bytes: int = CACHE_MAX_BYTES) -> int:
    """Delete the least recently used cached copies until the folder is under max_bytes. Returns how many were deleted."""
    try:
        files = [(f.stat().st_mtime, f.stat().st_size, f) for f in cache_dir.iterdir() if f.is_file()]
    except OSError:
        return 0
    total, removed = sum(size for _, size, _ in files), 0
    for _, size, f in sorted(files, key=lambda t: t[0]):
        if total <= max_bytes:
            break
        try:
            f.unlink()
            total -= size
            removed += 1
        except OSError:
            pass
    return removed
