"""Rules for talking to a mirror's control server. No Home Assistant imports, so it is easy to test.

The Mirror Kiosk app (see docs/mirror-app/api.md) runs a small web server on the mirror (port 8099). Home Assistant calls it on
the user's behalf; the browser never does. This file holds the parts that need no network:

- what counts as a safe address to call (a plain host and port, nothing else),
- what counts as a safe key,
- the allowed ranges for the presence settings (the same numbers the app enforces),
- cutting the mirror's /status answer down to the fields we know, and a plain-language verdict about its memory,
- working out what presence costs from two readings.

Nothing here invents a number: every figure it reports was read from the mirror.
"""

from __future__ import annotations

import ipaddress
import re
from typing import Any

DEFAULT_PORT = 8099

# The presence settings the app accepts on /presence/tune, with the same ranges it enforces (docs/mirror-app/api.md).
TUNE_RANGES: dict[str, tuple[int, int]] = {
    "scans": (1, 240),     # looks per minute
    "vscans": (1, 240),    # looks per minute while a video plays
    "hold": (5, 600),      # seconds to stay "present" after the last movement
    "thr": (2, 60),        # how big a change counts as movement (lower is more sensitive)
    "fps": (0, 30),        # camera frame rate, 0 = slowest the camera offers
    "report": (10, 3600),  # seconds between "still here" reports
}
BRIGHTNESS_RANGE = (0, 100)

_HOSTNAME = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$")
KEY_MIN = 8
KEY_MAX = 128


# ---------------------------------------------------------------- the address

def parse_endpoint(value: Any) -> tuple[str | None, str | None]:
    """Turn what the owner typed into 'http(s)://host:port', or explain why not. Returns (address, problem).

    Accepted: `host`, `host:port`, `http://host:port`, `https://host:port`, with one optional trailing slash. The port defaults to
    8099. Refused: anything with a login in it (`user:pass@`), a path, a query, a fragment, spaces, or a scheme other than http(s).
    Only a name or an IP address is allowed as the host, and addresses that can never be a mirror (0.0.0.0, link-local such as
    169.254.x.x, multicast) are refused."""
    if not isinstance(value, str) or not value.strip():
        return None, "the address is empty"
    text = value.strip()
    if len(text) > 255 or any(ord(c) < 33 or ord(c) > 126 for c in text) or "\\" in text:
        return None, "the address must be plain text such as mirror.local:8099 (no spaces)"
    scheme = "http"
    lowered = text.lower()
    if lowered.startswith("http://"):
        text = text[7:]
    elif lowered.startswith("https://"):
        scheme, text = "https", text[8:]
    elif "://" in text:
        return None, "only http:// or https:// addresses are allowed"
    if text.endswith("/"):
        text = text[:-1]
    if "@" in text:
        return None, "the address must not contain a user name or password; the key is entered separately"
    if any(c in text for c in "/?#"):
        return None, "give just the host and port, such as mirror.local:8099 (no path, query or #)"
    port_text = ""
    if text.startswith("["):                                   # an IPv6 address in brackets
        end = text.find("]")
        if end < 0:
            return None, "that address is not valid"
        host, rest = text[1:end], text[end + 1:]
        if rest and not rest.startswith(":"):
            return None, "that address is not valid"
        port_text = rest[1:]
        try:
            literal = ipaddress.IPv6Address(host)
        except ValueError:
            return None, "that IPv6 address is not valid"
        host_out = f"[{literal.compressed}]"
        ip = literal
    else:
        host, _, port_text = text.partition(":")
        if ":" in port_text:
            return None, "put an IPv6 address in square brackets, such as [fd00::5]:8099"
        ip = None
        try:
            ip = ipaddress.ip_address(host)
        except ValueError:
            if not host or len(host) > 253 or not _HOSTNAME.match(host):
                return None, "that is not a valid host name or IP address"
        host_out = host.lower() if ip is None else str(ip)
    if ip is not None and (ip.is_unspecified or ip.is_link_local or ip.is_multicast):
        return None, "that address cannot be a mirror"
    if text.rpartition(":")[2] == "" and text.endswith(":"):
        return None, "the port is missing after the colon"
    if port_text:
        if not port_text.isdigit() or not 1 <= int(port_text) <= 65535:
            return None, "the port must be a number from 1 to 65535"
        port = int(port_text)
    else:
        port = DEFAULT_PORT
    return f"{scheme}://{host_out}:{port}", None


def key_problem(value: Any, new: bool = False) -> str | None:
    """Check a key without ever repeating it. The key travels as a URL query value, so it must be plain visible characters.
    A NEW key must be at least KEY_MIN long; a key already stored is only held to the old rule, so an existing record never turns invalid."""
    shortest = KEY_MIN if new else 1
    if not isinstance(value, str) or not shortest <= len(value) <= KEY_MAX:
        return f"the key must be text of {shortest} to {KEY_MAX} characters (a long random one is best)"
    if any(ord(c) < 33 or ord(c) > 126 for c in value):
        return "the key may only use visible characters with no spaces"
    return None


# ---------------------------------------------------------------- values to send

def _whole_number(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def validate_tune(values: Any) -> tuple[dict[str, int], list[str]]:
    """Check presence settings against the app's own ranges. Returns (clean values, problems); give at least one setting."""
    if not isinstance(values, dict):
        return {}, ["settings must be an object"]
    clean: dict[str, int] = {}
    problems: list[str] = []
    for name, value in values.items():
        if name not in TUNE_RANGES:
            problems.append(f"unknown setting '{name}'")
            continue
        low, high = TUNE_RANGES[name]
        number = _whole_number(value)
        if number is None or not low <= number <= high:
            problems.append(f"{name} must be a whole number from {low} to {high}")
        else:
            clean[name] = number
    if not values:
        problems.append("give at least one setting to change")
    return clean, problems


def validate_brightness(value: Any) -> tuple[int | None, str | None]:
    number = _whole_number(value)
    low, high = BRIGHTNESS_RANGE
    if number is None or not low <= number <= high:
        return None, f"brightness must be a whole number from {low} to {high}"
    return number, None


# ---------------------------------------------------------------- reading what the mirror says

def clean_text(value: Any, limit: int = 200) -> str | None:
    """Text from the mirror, made safe to show: plain visible characters only, cut short."""
    if not isinstance(value, str):
        return None
    return "".join(c if 32 <= ord(c) < 127 or ord(c) > 160 else " " for c in value)[:limit]


def _num(value: Any) -> float | int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def _bool(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


_MEMORY_NUMBERS = ("total_mb", "available_mb", "threshold_mb", "free_mb", "cached_mb", "app_pss_mb", "engine_pss_mb", "app_total_pss_mb")
_SETTINGS_NUMBERS = ("scans_per_min", "video_scans_per_min", "hold_s", "threshold", "preview_w", "preview_fps", "report_interval_s")


def shape_status(raw: Any) -> dict[str, Any] | None:
    """Keep only the fields of the mirror's /status that we know, with the right types. None if it does not look like the app.

    Anything else the mirror sent is dropped, so a changed or odd answer can never smuggle unexpected text through Home Assistant."""
    if not isinstance(raw, dict) or not any(k in raw for k in ("memory", "presence", "page_ok")):
        return None
    memory_raw = raw.get("memory") if isinstance(raw.get("memory"), dict) else {}
    presence_raw = raw.get("presence") if isinstance(raw.get("presence"), dict) else {}
    settings_raw = presence_raw.get("settings") if isinstance(presence_raw.get("settings"), dict) else {}
    processes = []
    for item in (memory_raw.get("processes") if isinstance(memory_raw.get("processes"), list) else [])[:12]:
        if isinstance(item, dict) and _num(item.get("pss_mb")) is not None:
            processes.append({"name": clean_text(item.get("name"), 80) or "?", "pss_mb": item["pss_mb"]})
    memory = {k: _num(memory_raw.get(k)) for k in _MEMORY_NUMBERS}
    memory.update({"low_memory": _bool(memory_raw.get("low_memory")), "presence_enabled": _bool(memory_raw.get("presence_enabled")), "processes": processes})
    settings = {k: _num(settings_raw.get(k)) for k in _SETTINGS_NUMBERS}
    settings.update({"enabled": _bool(settings_raw.get("enabled")), "webhook_set": _bool(settings_raw.get("webhook_set"))})
    return {
        "version": clean_text(raw.get("version"), 40),
        "page_ok": _bool(raw.get("page_ok")),
        "seconds_since_page_load": _num(raw.get("seconds_since_page_load")),
        "brightness": _num(raw.get("brightness")),
        "uptime_s": _num(raw.get("uptime_s")),
        "presence": {
            "present": _bool(presence_raw.get("present")),
            "state": clean_text(presence_raw.get("state"), 80),
            "last_report": clean_text(presence_raw.get("last_report"), 120),
            "settings": settings,
        },
        "memory": memory,
    }


AUDIO_STATES = ("idle", "buffering", "playing", "paused", "error")


def shape_audio(raw: Any) -> dict[str, Any] | None:
    """The audio player's answer from the mirror (GET /audio), keeping only the fields we know. None when it is not that."""
    if not isinstance(raw, dict) or raw.get("state") not in AUDIO_STATES:
        return None
    volume = _whole_number(raw.get("volume"))

    def seconds(value: Any) -> int | None:
        n = _whole_number(value)
        return n if n is not None and n >= 0 else None

    return {
        "state": raw["state"],
        "volume": min(max(volume, 0), 100) if volume is not None else None,
        "title": clean_text(raw.get("title"), 120) or None,
        "artist": clean_text(raw.get("artist"), 120) or None,
        "position_s": seconds(raw.get("position_s")),
        "duration_s": seconds(raw.get("duration_s")),
        "error": clean_text(raw.get("error"), 160) or None,
    }


def presence_is_on(status: dict[str, Any]) -> bool | None:
    """Whether the mirror says presence is on (the memory block and the settings block both say; either will do)."""
    for value in (status["memory"].get("presence_enabled"), status["presence"]["settings"].get("enabled")):
        if value is not None:
            return value
    return None


def verdict(memory: dict[str, Any]) -> dict[str, str]:
    """A plain-language reading of ONE memory reading. Uses only what the mirror reported.

    The rule: Android itself says when memory is low (low_memory) and at what level (threshold_mb). We call it 'tight' when the
    room above that level is smaller than the level itself, and 'ok' otherwise. This is a reading of right now, not a promise."""
    available, threshold, total = memory.get("available_mb"), memory.get("threshold_mb"), memory.get("total_mb")
    if memory.get("low_memory") is None and available is None:
        return {"level": "unknown", "text": "The mirror did not report its memory. Update the mirror app to a version that does (see mirror-app/README.md)."}
    shown = f"{available:g} MB of {total:g} MB" if available is not None and total is not None else "an unknown amount"
    if memory.get("low_memory"):
        return {"level": "low", "text": f"Android says this mirror is low on memory right now ({shown} available). Anything extra, such as presence or a large video, risks the page being restarted."}
    if available is not None and threshold is not None:
        room = available - threshold
        if room < threshold:
            return {"level": "tight", "text": f"Memory is tight: {shown} available, only {room:g} MB above the level where Android calls it low ({threshold:g} MB)."}
        return {"level": "ok", "text": f"Memory looks comfortable right now: {shown} available, {room:g} MB above the level where Android calls it low ({threshold:g} MB)."}
    return {"level": "ok", "text": f"Android does not report low memory right now ({shown} available)."}


def presence_cost(before: dict[str, Any], after: dict[str, Any], wait_s: int) -> dict[str, Any]:
    """Compare a reading taken with presence ON (before) and one taken with it OFF (after). Both are shape_status() results
    with a `measured_at` added. Returns the figures and a sentence; None where the mirror did not report a number."""
    b, a = before["memory"], after["memory"]

    def diff(x: Any, y: Any) -> float | None:
        return None if x is None or y is None else round(x - y, 1)

    app_cost = diff(b.get("app_total_pss_mb"), a.get("app_total_pss_mb"))        # app memory held with presence on minus off
    free_gain = diff(a.get("available_mb"), b.get("available_mb"))               # memory Android had available off minus on
    if app_cost is None and free_gain is None:
        text = "The mirror did not report the numbers needed to compare. Update the mirror app (see mirror-app/README.md)."
    else:
        parts = []
        if app_cost is not None:
            parts.append(f"the app held {b['app_total_pss_mb']:g} MB with presence on and {a['app_total_pss_mb']:g} MB with it off, so presence accounted for about {app_cost:g} MB")
        if free_gain is not None:
            parts.append(f"Android had {b['available_mb']:g} MB available with presence on and {a['available_mb']:g} MB with it off ({free_gain:+g} MB)")
        text = "Measured on this mirror: " + "; ".join(parts) + f". Two readings {wait_s} seconds apart; memory moves around, so repeat it to see how steady the answer is."
    return {"app_total_mb": app_cost, "available_mb": free_gain, "wait_s": wait_s, "text": text}


def scrub(value: Any, secret: str | None) -> Any:
    """Replace the secret with *** wherever it appears in text anywhere inside `value` (a last line of defence: the key should
    never be in a result in the first place)."""
    if not secret:
        return value
    if isinstance(value, str):
        return value.replace(secret, "***")
    if isinstance(value, dict):
        return {(scrub(k, secret) if isinstance(k, str) else k): scrub(v, secret) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [scrub(v, secret) for v in value]
    return value
