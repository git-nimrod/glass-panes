"""The screen schedule's rules: when a mirror's screen should be on or off. No Home Assistant imports, so it is easy to test.

Every display that has a mirror gets a screen mode and two quiet-hours times (see screen_schedule.py for the Home Assistant side):

- "manual" (the default): the schedule does nothing. The Screen switch, your own automations and the mirror decide.
- "auto": the screen goes off when quiet hours start and on when they end. In between you can still switch it on by hand to have
  a look; the schedule only acts at the two edges (and once when you choose Auto or change a time, so it starts in the right state).
- "on" / "off": the screen is kept on or off. If the mirror restarts or something else changes it, it is put back.

Quiet hours are in Home Assistant's own time zone. A start later than the end crosses midnight (23:00 to 07:00). A start equal to
the end means no quiet hours at all.
"""

from __future__ import annotations

from datetime import time
from typing import Any

MODES = ("manual", "auto", "on", "off")
DEFAULT_START = time(23, 0)
DEFAULT_END = time(7, 0)
SCHEMA_VERSION = 1


def default_settings() -> dict[str, Any]:
    return {"mode": "manual", "quiet_start": DEFAULT_START.strftime("%H:%M"), "quiet_end": DEFAULT_END.strftime("%H:%M")}


def parse_time(value: Any) -> time | None:
    """'23:00' or '23:00:00' -> time(23, 0). Anything else -> None. Seconds are dropped: the schedule works in whole minutes."""
    if isinstance(value, time):
        return value.replace(second=0, microsecond=0, tzinfo=None)
    if not isinstance(value, str):
        return None
    parts = value.strip().split(":")
    if len(parts) not in (2, 3) or not all(p.isdigit() and len(p) <= 2 for p in parts):
        return None
    hour, minute = int(parts[0]), int(parts[1])
    if not (0 <= hour <= 23 and 0 <= minute <= 59) or (len(parts) == 3 and not 0 <= int(parts[2]) <= 59):
        return None
    return time(hour, minute)


def clean_settings(value: Any) -> dict[str, Any]:
    """Stored settings for one display, with anything damaged or missing replaced by the default (never raises)."""
    result = default_settings()
    if not isinstance(value, dict):
        return result
    if value.get("mode") in MODES:
        result["mode"] = value["mode"]
    for field in ("quiet_start", "quiet_end"):
        parsed = parse_time(value.get(field))
        if parsed is not None:
            result[field] = parsed.strftime("%H:%M")
    return result


def in_quiet_hours(now: time, start: time, end: time) -> bool:
    """True when `now` is inside quiet hours. The start minute counts as quiet, the end minute does not."""
    now = now.replace(second=0, microsecond=0, tzinfo=None)
    if start == end:
        return False
    if start < end:
        return start <= now < end
    return now >= start or now < end                 # crosses midnight


def wanted(settings: dict[str, Any], now: time) -> bool | None:
    """Whether the screen should be on (True), off (False), or left alone (None) right now, judged from scratch.

    Auto uses this only when it is chosen or a time is changed (and at the two edges), never to undo a person's own switch."""
    mode = settings.get("mode")
    if mode == "on":
        return True
    if mode == "off":
        return False
    if mode == "auto":
        start, end = parse_time(settings.get("quiet_start")), parse_time(settings.get("quiet_end"))
        if start is None or end is None or start == end:
            return None
        return not in_quiet_hours(now, start, end)
    return None


def needs_putting_back(settings: dict[str, Any], screen_on: Any) -> bool | None:
    """For On and Off only: the value to send when the mirror reports the other state (it restarted, or something switched it)."""
    mode = settings.get("mode")
    if not isinstance(screen_on, bool) or mode not in ("on", "off"):
        return None
    want = mode == "on"
    return want if screen_on != want else None
