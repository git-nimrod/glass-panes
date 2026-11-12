"""Reusable widget groups: a set of widgets (with their entity bindings) saved by name, to drop into any pane later.

No Home Assistant imports. A group is {id, name, widgets, bindings, created}. `widgets` are ordinary pane widgets (positions are
relative to the group's top-left corner, set by the builder); `bindings` maps a widget id to its slots, exactly like a pane's bindings.
Groups are your own, kept in Home Assistant's storage: they are never shipped, and unlike a shipped pane they may hold the
your entity ids (in `bindings`, never in `widgets`).
"""

from __future__ import annotations

import re
from typing import Any

MAX_GROUPS = 50
MAX_WIDGETS = 32
PANE_ID = "group"                                   # the stand-in pane the widgets are checked inside
_SLUG = re.compile(r"^[a-z0-9_]{1,64}$")


def validate_request(name: Any, widgets: Any, bindings: Any) -> list[str]:
    """The shape of a save request (the widgets themselves are checked by the pane checker)."""
    errors: list[str] = []
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
        errors.append("name must be 1 to 80 characters")
    if not isinstance(widgets, list) or not widgets:
        errors.append("a group needs at least one widget")
    elif len(widgets) > MAX_WIDGETS:
        errors.append(f"a group can hold at most {MAX_WIDGETS} widgets")
    elif not all(isinstance(w, dict) and isinstance(w.get("id"), str) for w in widgets):
        errors.append("every widget needs an id")
    elif len({w["id"] for w in widgets}) != len(widgets):
        errors.append("widget ids must be different")
    if not isinstance(bindings, dict):
        errors.append("bindings must be an object of widget ids")
    elif isinstance(widgets, list):
        ids = {w.get("id") for w in widgets if isinstance(w, dict)}
        for widget_id in bindings:
            if widget_id not in ids:
                errors.append(f"bindings name widget '{widget_id}', which is not in the group")
    return errors


def stand_in_pane(name: str, widgets: list[dict[str, Any]]) -> dict[str, Any]:
    """A pane around the widgets, so the pane checker can validate them (including rules that point at each other)."""
    return {"schema_version": 1, "id": PANE_ID, "name": name.strip() or "Group", "canvas": {"width": 1080, "height": 1920},
            "background": "#000000", "widgets": widgets}


def unique_id(name: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:40] or "group"
    candidate, n = base, 2
    while candidate in taken:
        candidate = f"{base}_{n}"
        n += 1
    return candidate


def shape(group: dict[str, Any]) -> dict[str, Any]:
    """What the websocket API returns for one group."""
    return {"id": group["id"], "name": group["name"], "widgets": group["widgets"], "bindings": group["bindings"], "created": group.get("created")}


def is_stored_group(group_id: Any, group: Any) -> bool:
    """A group read back from storage must look right; a damaged one is skipped instead of trusted."""
    return (isinstance(group_id, str) and bool(_SLUG.match(group_id)) and isinstance(group, dict) and group.get("id") == group_id
            and isinstance(group.get("name"), str) and isinstance(group.get("widgets"), list) and isinstance(group.get("bindings"), dict))
