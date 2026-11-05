"""Displays: the screens that show panes (a mirror, a tablet, a wall panel).

No Home Assistant imports. A display has an id (used in its entity and its player address), a name, an optional timezone
for the times it shows, and the pane it is showing now. A display can also have a mirror `endpoint` (the address of its
Mirror Kiosk app's control server) and a `key` for it. The key is write-only: it is stored but never returned by anything.
"""

from __future__ import annotations

import re
from typing import Any

from . import mirror_lib

SCHEMA_VERSION = 1
MAX_DISPLAYS = 20
_SLUG = re.compile(r"^[a-z0-9_]{1,64}\Z")
_FIELDS = {"id", "name", "timezone", "pane", "endpoint", "key"}


def empty() -> dict[str, Any]:
    return {"schema_version": SCHEMA_VERSION, "displays": {}}


def slugify(name: str, fallback: str = "display") -> str:
    """'Living Room Mirror' -> 'living_room_mirror'."""
    slug = re.sub(r"[^a-z0-9]+", "_", str(name).lower()).strip("_")[:64].strip("_")
    return slug or fallback


def unique_id(name: str, taken: set[str], fallback: str = "display") -> str:
    base = slugify(name, fallback)
    candidate, n = base, 2
    while candidate in taken:
        suffix = f"_{n}"
        candidate = base[: 64 - len(suffix)] + suffix
        n += 1
    return candidate


def validate_fields(display: Any) -> list[str]:
    """Check the fields of one display (not whether its pane exists; the manager does that)."""
    if not isinstance(display, dict):
        return ["a display must be an object"]
    errors: list[str] = []
    unknown = set(display) - _FIELDS
    if unknown:
        errors.append(f"unknown fields {sorted(unknown)}")
    if "id" in display and (not isinstance(display["id"], str) or not _SLUG.match(display["id"])):
        errors.append("id must be lowercase letters, digits and _ (at most 64)")
    if "name" in display and (not isinstance(display["name"], str) or not 1 <= len(display["name"].strip()) <= 80):
        errors.append("name must be 1 to 80 characters")
    if display.get("timezone") is not None and (not isinstance(display["timezone"], str) or len(display["timezone"]) > 64):
        errors.append("timezone must be text such as America/Chicago, or empty")
    if "pane" in display and (not isinstance(display["pane"], str) or not _SLUG.match(display["pane"])):
        errors.append("pane must be a pane id")
    if display.get("endpoint") not in (None, ""):
        problem = mirror_lib.parse_endpoint(display["endpoint"])[1]
        if problem:
            errors.append(f"endpoint: {problem}")
    if display.get("key") not in (None, ""):
        problem = mirror_lib.key_problem(display["key"])      # the problem text never repeats the key
        if problem:
            errors.append(problem)
    return errors


def validate_document(doc: Any) -> list[str]:
    """Check a whole stored displays document."""
    if not isinstance(doc, dict) or doc.get("schema_version") != SCHEMA_VERSION or not isinstance(doc.get("displays"), dict):
        return ["not a displays document"]
    errors: list[str] = []
    if len(doc["displays"]) > MAX_DISPLAYS:
        errors.append(f"more than {MAX_DISPLAYS} displays")
    for display_id, display in doc["displays"].items():
        shown = {k: v for k, v in display.items() if k != "login_user_id"} if isinstance(display, dict) else display
        problems = validate_fields({"id": display_id, **shown}) if isinstance(display, dict) else ["not an object"]
        if isinstance(display, dict) and "login_user_id" in display and not isinstance(display["login_user_id"], str):
            problems.append("login_user_id must be text")
        errors += [f"{display_id}: {p}" for p in problems]
        if isinstance(display, dict) and not {"name", "pane"} <= set(display):
            errors.append(f"{display_id}: needs a name and a pane")
    return errors
