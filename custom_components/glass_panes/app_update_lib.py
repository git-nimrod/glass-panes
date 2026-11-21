"""Rules for updating the Mirror Kiosk app from Home Assistant (no Home Assistant imports here, so it is tested on its own).

How an update travels: Home Assistant asks GitHub for the project's releases, picks the newest `app-vX.Y.Z` (they are pre-releases on
purpose, so HACS never takes them for the integration), downloads its APK, checks the SHA-256 that GitHub publishes for that file and
that the APK carries the project's release certificate, and then sends the file to the mirror over the home network. The mirror checks
it again (same hash, same app, newer, signed with the same key as the installed app) and installs it itself. The mirror never fetches
anything from the internet: Android 6's own certificate store is too old for much of it.

What the certificate check here is and is not: it reads the signing certificate stored in the APK (its v1 signature block) and compares
its SHA-256 with the project's published one. That catches the wrong file (another app, a debug build, someone else's build) before
90 MB cross the network. It does not verify the signature itself; the mirror's Android does that in full when it installs, and refuses
anything not signed by the same key as the app already on it.
"""

from __future__ import annotations

import hashlib
import re
import zipfile
from typing import Any

RELEASE_REPO = "git-nimrod/glass-panes"                     # the public repository; app releases are tagged app-vX.Y.Z
RELEASES_API = f"https://api.github.com/repos/{RELEASE_REPO}/releases?per_page=30"
DOWNLOAD_PREFIX = f"https://github.com/{RELEASE_REPO}/releases/download/"
# SHA-256 of the project's release signing certificate (printed by the Mirror app workflow's "Show who signed it" step; public).
RELEASE_CERT_SHA256 = "f01c1695256290f39fb5d552538aed723434157ffd4714ac6a19bf169af58dba"
MAX_APK_BYTES = 200 * 1024 * 1024
MIN_APK_BYTES = 1024

_TAG = re.compile(r"^app-v(\d{1,4})\.(\d{1,4})\.(\d{1,4})\Z")
_DIGEST = re.compile(r"^sha256:([0-9a-f]{64})\Z")
_HEX64 = re.compile(r"^[0-9a-f]{64}\Z")
_SIG_BLOCK = re.compile(r"^META-INF/[^/]+\.(RSA|DSA|EC)\Z", re.IGNORECASE)


def version_tuple(value: Any) -> tuple[int, int, int] | None:
    """(0, 13, 0) from "0.13.0" (or "app-v0.13.0"); None for anything else."""
    if not isinstance(value, str):
        return None
    match = re.match(r"^(?:app-v)?(\d{1,4})\.(\d{1,4})\.(\d{1,4})\Z", value.strip())
    return tuple(int(x) for x in match.groups()) if match else None  # type: ignore[return-value]


def is_newer(latest: Any, installed: Any) -> bool:
    """True when `latest` is a higher version than `installed`. Unreadable versions are never "newer"."""
    a, b = version_tuple(latest), version_tuple(installed)
    return a is not None and b is not None and a > b


def pick_release(releases: Any) -> dict[str, Any] | None:
    """The newest usable app release from GitHub's release list, or None.

    Usable: tag app-vX.Y.Z, not a draft, with exactly the asset mirror-kiosk-vX.Y.Z.apk, downloaded from this repository's release
    address, of a sane size, with a SHA-256 published by GitHub. Pre-releases count (app releases always are)."""
    best: dict[str, Any] | None = None
    for rel in releases if isinstance(releases, list) else []:
        if not isinstance(rel, dict) or rel.get("draft"):
            continue
        tag = rel.get("tag_name")
        match = _TAG.match(tag) if isinstance(tag, str) else None
        if not match:
            continue
        version = ".".join(match.groups())
        name = f"mirror-kiosk-v{version}.apk"
        asset = next((a for a in rel.get("assets") or [] if isinstance(a, dict) and a.get("name") == name), None)
        if asset is None:
            continue                                      # CI attaches the APK a few minutes after the release is made
        url = asset.get("browser_download_url")
        size = asset.get("size")
        digest = _DIGEST.match(asset.get("digest") or "") if isinstance(asset.get("digest"), str) else None
        if not isinstance(url, str) or url != f"{DOWNLOAD_PREFIX}{tag}/{name}":
            continue
        if not isinstance(size, int) or isinstance(size, bool) or not MIN_APK_BYTES <= size <= MAX_APK_BYTES or digest is None:
            continue
        if best is None or version_tuple(version) > version_tuple(best["version"]):  # type: ignore[operator]
            html = rel.get("html_url")
            best = {
                "version": version,
                "tag": tag,
                "url": url,
                "size": size,
                "sha256": digest.group(1),
                "notes_url": html if isinstance(html, str) and html.startswith(f"https://github.com/{RELEASE_REPO}/") else None,
                "title": (rel.get("name") or tag)[:120] if isinstance(rel.get("name") or tag, str) else tag,
            }
    return best


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def apk_cert_sha256(path: str) -> set[str]:
    """SHA-256 of each certificate in the APK's v1 signature block(s) (META-INF/*.RSA|DSA|EC). Empty when there is none or it cannot be
    read. Raises nothing for a bad file: an unreadable APK simply has no certificate we accept."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.serialization import pkcs7

    found: set[str] = set()
    try:
        with zipfile.ZipFile(path) as apk:
            for name in apk.namelist():
                if not _SIG_BLOCK.match(name):
                    continue
                info = apk.getinfo(name)
                if info.file_size > 64 * 1024:
                    continue                              # a signature block is a few KB
                for cert in pkcs7.load_der_pkcs7_certificates(apk.read(name)):
                    found.add(hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest())
    except (zipfile.BadZipFile, ValueError, OSError, KeyError):
        return set()
    return found


def apk_problem(path: str, expected_sha256: str, expected_size: int | None = None, cert: str | None = None) -> str | None:
    """Checks a downloaded APK before it is sent to a mirror. None when it is good, otherwise a plain reason. Blocking: run in an executor.
    `cert` defaults to the project's release certificate (read at call time, so tests can swap it)."""
    cert = cert or RELEASE_CERT_SHA256
    if not _HEX64.match(expected_sha256 or ""):
        return "the release does not publish a usable SHA-256 for its app file"
    try:
        import os

        size = os.path.getsize(path)
    except OSError:
        return "the downloaded app file is missing"
    if expected_size is not None and size != expected_size:
        return "the downloaded app file has the wrong size (the download was cut off)"
    if sha256_file(path) != expected_sha256:
        return "the downloaded app file does not match the SHA-256 GitHub publishes for it"
    certs = apk_cert_sha256(path)
    if not certs:
        return "the app file has no signing certificate Home Assistant can read"
    if cert not in certs:
        return "the app file is not signed with the Glass Panes release key"
    return None


def release_summary(can_install: bool, installed: Any, latest: dict[str, Any] | None) -> str | None:
    """The short text under the update in Home Assistant (at most 255 characters)."""
    if latest is None:
        return None
    if not can_install:
        return ("This mirror cannot install updates by itself yet: that needs the app built into the mirror's Android image "
                "(mirror-android-3 or later). Until then install this version with adb.")[:255]
    return f"Home Assistant downloads {latest['tag']}, checks it and sends it to the mirror, which installs it and restarts (about a minute)."[:255]
