"""Widget-level editing of a pane, for agents: add, change, place, remove and align widgets.

These are the same rules the sidebar builder uses (panel/ops.js): a 40 px grid, everything stays on the 1080x1920 canvas, widget ids
are unique, and deleting a widget closes up whatever flowed after it. No Home Assistant imports, so all of it is testable on its own.

Every function takes a pane and returns a changed COPY; the original is never touched. A request that cannot be done raises
`OpError` with plain-language reasons, and nothing changes. The caller still runs the full pane checks afterwards (see manager.py),
so a pane built from these steps can never be saved invalid.

Unlike the builder, an agent has no rendered preview, so it places widgets by the numbers in the pane (x, y, w, h), not by where
the player happens to draw them. A widget that was placed by `flow` is pinned to those numbers as soon as it is moved by hand,
exactly as in the builder.
"""

from __future__ import annotations

import copy
import math
import re
from typing import Any

CANVAS_W = 1080
CANVAS_H = 1920
GRID = 40
MIN_SIZE = 40
MAX_WIDGETS = 64

# the size and look a new widget starts with (x and y are chosen separately). Kept in step with DEFAULTS in panel/ops.js; a test checks it.
DEFAULTS: dict[str, dict[str, Any]] = {
    "clock": {"w": 560, "h": 120, "style": {"size": 110, "weight": 200}},
    "date": {"w": 560, "h": 40, "style": {"size": 30, "color": "dim"}},
    "text": {"w": 560, "h": 60, "style": {"size": 40}, "options": {"text": "Your text"}},
    "image": {"w": 400, "h": 400, "options": {}},
    "slideshow": {"w": 1000, "h": 750, "options": {}},
    "video": {"w": 1080, "h": 1920, "options": {}},
    "divider": {"w": 400, "h": 40, "style": {"color": "faint"}, "options": {"thickness": 2}},
    "message": {"w": 760, "h": 44, "style": {"size": 32, "italic": True, "color": "accent"}, "options": {"lines": ["Have a good day", "Looking good"]}},
    "entity_value": {"w": 360, "h": 120, "style": {"size": 64, "weight": 200}, "options": {}},
    "weather": {"w": 560, "h": 60, "style": {"size": 36}, "options": {"layout": "line"}},
    "calendar_agenda": {"w": 560, "h": 200, "auto_height": True, "style": {"size": 28}, "options": {"max_items": 5, "hide_when_empty": True}},
    "todo_list": {"w": 560, "h": 160, "auto_height": True, "style": {"size": 28}, "options": {"max_items": 5, "hide_when_empty": True}},
    "now_playing": {"w": 960, "h": 200, "auto_height": True, "style": {"size": 40}, "options": {"show_art": True, "style": "card"}},
    "people": {"w": 560, "h": 100, "auto_height": True, "style": {"size": 32}, "options": {"show_avatar": True, "avatar_size": 60}},
    "lights_summary": {"w": 560, "h": 100, "auto_height": True, "style": {"size": 56, "weight": 200}, "options": {"show_dots": True}},
    "progress_ring": {"w": 160, "h": 160, "style": {"size": 39, "weight": 300}, "options": {}},
    "sports": {"w": 960, "h": 260, "auto_height": True, "style": {"size": 28}, "options": {"layout": "rows", "max_games": 3}},
    "news": {"w": 760, "h": 160, "auto_height": True, "style": {"size": 26}, "options": {"max_stories": 2}},
}
FALLBACK_DEFAULT = {"w": 560, "h": 120}                     # a widget type the builder's palette does not offer (for example status_summary)

ALIGN_MODES = ("left", "center", "right", "top", "middle", "bottom", "distribute-h", "distribute-v", "same-width", "same-height")

_ENTITY_ID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")


class OpError(Exception):
    """A request that cannot be done. `problems` are plain-language reasons."""

    def __init__(self, *problems: str) -> None:
        super().__init__("; ".join(problems))
        self.problems = list(problems)


def snap(value: float, grid: int = GRID) -> int:
    """Round to the nearest grid line, halves up (like the builder's Math.round, not Python's banker's rounding)."""
    return int(math.floor(value / grid + 0.5)) * grid


def _clamp(value: float, low: float, high: float) -> float:
    return min(max(value, low), max(low, high))


def _whole(name: str, value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
        raise OpError(f"{name} must be a number of pixels")
    return int(round(value))


def widget_index(pane: dict[str, Any], widget_id: Any) -> int:
    for index, widget in enumerate(pane.get("widgets", [])):
        if widget.get("id") == widget_id:
            return index
    raise OpError(f"there is no widget '{widget_id}' in this pane (its widgets: {', '.join(w['id'] for w in pane.get('widgets', [])) or 'none yet'})")


def unique_widget_id(base: str, widgets: list[dict[str, Any]]) -> str:
    taken = {w.get("id") for w in widgets}
    slug = re.sub(r"[^a-z0-9]+", "_", str(base).lower()).strip("_")[:40] or "widget"
    candidate, n = slug, 2
    while candidate in taken:
        candidate = f"{slug}_{n}"
        n += 1
    return candidate


def free_spot(widgets: list[dict[str, Any]], w: int, h: int) -> tuple[int, int]:
    """The first free grid spot from the top, so a new widget never lands exactly on another one."""
    boxes = [(o["x"], o["y"], o["w"], o["h"]) for o in widgets]
    for y in range(80, CANVAS_H - h + 1, GRID):
        for x in range(40, CANVAS_W - w + 1, GRID):
            if not any(x < bx + bw and x + w > bx and y < by + bh and y + h > by for bx, by, bw, bh in boxes):
                return x, y
    return 40, 80


def _merge(base: dict[str, Any] | None, changes: Any, what: str) -> dict[str, Any]:
    """Merge `changes` over `base`. A key set to null is removed."""
    if changes is None:
        return dict(base or {})
    if not isinstance(changes, dict):
        raise OpError(f"{what} must be an object")
    merged = dict(base or {})
    for key, value in changes.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return merged


def _below(pane: dict[str, Any], reference: Any, gap: Any) -> tuple[int, int]:
    """Where a widget goes to sit directly under another one (using the numbers saved in the pane)."""
    above = pane["widgets"][widget_index(pane, reference)]
    spacing = 20 if gap is None else _whole("gap", gap)
    return above["x"], above["y"] + above["h"] + spacing


def _pinned(widget: dict[str, Any]) -> dict[str, Any]:
    """The widget as it is once placed by hand: `flow` goes away (a rule that hung on it survives as an ordinary one)."""
    pinned = copy.deepcopy(widget)
    flow = pinned.pop("flow", None)
    if isinstance(flow, dict) and flow.get("show_if"):
        rule = pinned.get("show_when") or {"match": "all", "conditions": []}
        rule["conditions"] = [{"kind": "has_content", "widget": flow["show_if"]}, *rule.get("conditions", [])]
        pinned["show_when"] = rule
    return pinned


def _fit(widget: dict[str, Any]) -> dict[str, Any]:
    """Keep a widget inside the canvas."""
    widget["w"] = int(_clamp(widget["w"], MIN_SIZE, CANVAS_W))
    widget["h"] = int(_clamp(widget["h"], MIN_SIZE, CANVAS_H))
    widget["x"] = int(_clamp(widget["x"], 0, CANVAS_W - widget["w"]))
    widget["y"] = int(_clamp(widget["y"], 0, CANVAS_H - widget["h"]))
    return widget


# ---------------------------------------------------------------- adding


def add_widget(
    pane: dict[str, Any],
    widget_type: Any,
    registry: dict[str, Any],
    *,
    name: Any = None,
    x: Any = None,
    y: Any = None,
    w: Any = None,
    h: Any = None,
    below: Any = None,
    gap: Any = None,
    options: Any = None,
    style: Any = None,
    auto_height: Any = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Add a widget. Returns (new pane, the widget). Where it goes: `x`/`y` if given, else directly under `below`, else the first free spot."""
    if not isinstance(widget_type, str) or widget_type not in registry:
        raise OpError(f"'{widget_type}' is not a widget type. The types are: {', '.join(sorted(registry))}")
    out = copy.deepcopy(pane)
    widgets = out.setdefault("widgets", [])
    if len(widgets) >= MAX_WIDGETS:
        raise OpError(f"a pane can hold at most {MAX_WIDGETS} widgets")
    start = DEFAULTS.get(widget_type, FALLBACK_DEFAULT)
    width = _whole("w", w) if w is not None else start["w"]
    height = _whole("h", h) if h is not None else start["h"]
    label = name if isinstance(name, str) and name.strip() else registry[widget_type].get("label", widget_type)
    if x is None and y is None and below is None:
        px, py = free_spot(widgets, min(width, CANVAS_W), min(height, CANVAS_H))
    elif below is not None:
        px, py = _below(out, below, gap)
        px = _whole("x", x) if x is not None else px
        py = _whole("y", y) if y is not None else py
    else:
        px = _whole("x", x) if x is not None else 40
        py = _whole("y", y) if y is not None else 80
    widget: dict[str, Any] = {"id": unique_widget_id(label, widgets), "name": str(label)[:80], "type": widget_type, "x": px, "y": py, "w": width, "h": height}
    if (auto_height if auto_height is not None else start.get("auto_height")):
        widget["auto_height"] = True
    if start.get("style") or style:
        widget["style"] = _merge(copy.deepcopy(start.get("style")), style, "style")
    if start.get("options") or options:
        widget["options"] = _merge(copy.deepcopy(start.get("options")), options, "options")
    widgets.append(_fit(widget))
    return out, widget


# ---------------------------------------------------------------- changing


def update_widget(
    pane: dict[str, Any],
    widget_id: Any,
    *,
    name: Any = None,
    options: Any = None,
    style: Any = None,
    auto_height: Any = None,
    when_hidden: Any = None,
    show_when: Any = "unchanged",
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Change a widget's name, options, style or rules. `options` and `style` are merged over what is there (a key set to null is removed).
    `show_when` replaces the rule; pass null to remove it. Where the widget is and how big it is are changed with `place_widget`."""
    out = copy.deepcopy(pane)
    widget = out["widgets"][widget_index(out, widget_id)]
    if name is not None:
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
            raise OpError("name must be 1 to 80 characters")
        widget["name"] = name.strip()
    if options is not None:
        merged = _merge(widget.get("options"), options, "options")
        if merged:
            widget["options"] = merged
        else:
            widget.pop("options", None)
    if style is not None:
        merged = _merge(widget.get("style"), style, "style")
        if merged:
            widget["style"] = merged
        else:
            widget.pop("style", None)
    if auto_height is not None:
        if not isinstance(auto_height, bool):
            raise OpError("auto_height must be true or false")
        if auto_height:
            widget["auto_height"] = True
        else:
            widget.pop("auto_height", None)
    if when_hidden is not None:
        if when_hidden not in ("collapse", "keep"):
            raise OpError("when_hidden must be 'collapse' or 'keep'")
        widget["when_hidden"] = when_hidden
    if show_when != "unchanged":
        if show_when is None:
            widget.pop("show_when", None)
        else:
            widget["show_when"] = show_when
    return out, widget


def place_widget(
    pane: dict[str, Any],
    widget_id: Any,
    *,
    x: Any = None,
    y: Any = None,
    w: Any = None,
    h: Any = None,
    below: Any = None,
    gap: Any = None,
    snap_to_grid: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Move and/or resize a widget. `below` puts it directly under another widget. The widget is pinned to these numbers (its `flow` goes)."""
    out = copy.deepcopy(pane)
    index = widget_index(out, widget_id)
    widget = _pinned(out["widgets"][index])
    if below is not None:
        if below == widget_id:
            raise OpError("a widget cannot be placed below itself")
        bx, by = _below(out, below, gap)
        widget["x"], widget["y"] = (_whole("x", x) if x is not None else bx), (_whole("y", y) if y is not None else by)
    else:
        if x is not None:
            widget["x"] = _whole("x", x)
        if y is not None:
            widget["y"] = _whole("y", y)
    if w is not None:
        widget["w"] = _whole("w", w)
    if h is not None:
        widget["h"] = _whole("h", h)
        widget.pop("auto_height", None)                    # a height set by hand is a fixed height
    if snap_to_grid:
        for key in ("x", "y", "w", "h"):
            widget[key] = snap(widget[key])
    out["widgets"][index] = _fit(widget)
    return out, out["widgets"][index]


def remove_widget(pane: dict[str, Any], widget_id: Any) -> dict[str, Any]:
    """Remove a widget. Whatever flowed after it now flows after what it followed, and rules that looked at it stop looking."""
    out = copy.deepcopy(pane)
    index = widget_index(out, widget_id)
    gone = out["widgets"].pop(index)
    gone_after = gone.get("flow", {}).get("after", []) if isinstance(gone.get("flow"), dict) else []
    gone_after = [gone_after] if isinstance(gone_after, str) else list(gone_after)
    rest = []
    for widget in out["widgets"]:
        widget = copy.deepcopy(widget)
        rule = widget.get("show_when")
        if isinstance(rule, dict):
            kept = [c for c in rule.get("conditions", []) if c.get("widget") != widget_id]
            if len(kept) != len(rule.get("conditions", [])):
                if kept:
                    widget["show_when"] = {**rule, "conditions": kept}
                else:
                    widget.pop("show_when", None)
        flow = widget.get("flow")
        if isinstance(flow, dict):
            flow = dict(flow)
            after = [flow["after"]] if isinstance(flow.get("after"), str) else list(flow.get("after", []))
            if widget_id in after:
                after = list(dict.fromkeys([a for a in after if a != widget_id] + gone_after))
            if flow.get("show_if") == widget_id:
                flow.pop("show_if")
            if not after:
                widget.pop("flow", None)
            else:
                flow["after"] = after[0] if len(after) == 1 else after
                widget["flow"] = flow
        rest.append(widget)
    out["widgets"] = rest
    return out


def align_widgets(pane: dict[str, Any], widget_ids: Any, mode: Any) -> dict[str, Any]:
    """Line widgets up, using the numbers saved in the pane. Modes: left, center, right, top, middle, bottom, distribute-h, distribute-v,
    same-width, same-height. The widgets involved are pinned (their `flow` goes)."""
    if mode not in ALIGN_MODES:
        raise OpError(f"mode must be one of: {', '.join(ALIGN_MODES)}")
    if not isinstance(widget_ids, list) or len(widget_ids) < 2 or not all(isinstance(i, str) for i in widget_ids):
        raise OpError("pick at least two widgets (a list of widget ids)")
    if mode.startswith("distribute") and len(widget_ids) < 3:
        raise OpError("distributing needs at least three widgets")
    out = copy.deepcopy(pane)
    chosen = [out["widgets"][widget_index(out, i)] for i in dict.fromkeys(widget_ids)]
    left = min(c["x"] for c in chosen)
    top = min(c["y"] for c in chosen)
    right = max(c["x"] + c["w"] for c in chosen)
    bottom = max(c["y"] + c["h"] for c in chosen)
    boxes = {c["id"]: {"x": c["x"], "y": c["y"], "w": c["w"], "h": c["h"]} for c in chosen}
    new: dict[str, dict[str, int]] = {c["id"]: {} for c in chosen}
    by_hand = False
    for c in chosen:
        b = boxes[c["id"]]
        if mode == "left":
            new[c["id"]]["x"] = left
        elif mode == "right":
            new[c["id"]]["x"] = right - b["w"]
        elif mode == "center":
            new[c["id"]]["x"] = round((left + right) / 2 - b["w"] / 2)
        elif mode == "top":
            new[c["id"]]["y"] = top
        elif mode == "bottom":
            new[c["id"]]["y"] = bottom - b["h"]
        elif mode == "middle":
            new[c["id"]]["y"] = round((top + bottom) / 2 - b["h"] / 2)
        elif mode == "same-width":
            new[c["id"]]["w"] = boxes[chosen[0]["id"]]["w"]
        elif mode == "same-height":
            new[c["id"]]["h"] = boxes[chosen[0]["id"]]["h"]
            by_hand = True
    if mode in ("distribute-h", "distribute-v"):
        horizontal = mode == "distribute-h"
        key, size = ("x", "w") if horizontal else ("y", "h")
        ordered = sorted(chosen, key=lambda c: boxes[c["id"]][key])
        total = sum(boxes[c["id"]][size] for c in ordered)
        span = (right - left) if horizontal else (bottom - top)
        gap = (span - total) / (len(ordered) - 1)
        at = float(left if horizontal else top)
        for c in ordered:
            new[c["id"]][key] = round(at)
            at += boxes[c["id"]][size] + gap
    for position, widget in enumerate(out["widgets"]):
        if widget["id"] in new:
            pinned = _pinned(widget)
            pinned.update(new[widget["id"]])
            if by_hand:
                pinned.pop("auto_height", None)
            out["widgets"][position] = _fit(pinned)
    return out


# ---------------------------------------------------------------- the pane itself


def set_pane_fields(
    pane: dict[str, Any], *, name: Any = None, description: Any = None, theme: Any = "unchanged", background: Any = None, brightness: Any = "unchanged",
    fade: Any = None, burn_in_saver: Any = None,
) -> dict[str, Any]:
    """Change the pane's name, description, theme, background, brightness or fade. `theme` and `brightness` accept null to remove them.
    `fade` true makes show-when widgets fade in and out; false removes it."""
    out = copy.deepcopy(pane)
    if name is not None:
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
            raise OpError("name must be 1 to 80 characters")
        out["name"] = name.strip()
    if description is not None:
        if not isinstance(description, str) or len(description) > 400:
            raise OpError("description must be text of at most 400 characters")
        out["description"] = description.strip()
    if theme != "unchanged":
        if theme is None:
            out.pop("theme", None)
        else:
            out["theme"] = theme
    if background is not None:
        out["background"] = background
    if brightness != "unchanged":
        if brightness is None:
            out.pop("brightness", None)
        else:
            out["brightness"] = brightness
    if fade is not None:
        if not isinstance(fade, bool):
            raise OpError("fade must be true or false")
        if fade:
            out["motion"] = {**(out.get("motion") or {}), "widgets": "fade"}
        else:
            out.pop("motion", None)
    if burn_in_saver is not None:
        if not isinstance(burn_in_saver, bool):
            raise OpError("burn_in_saver must be true or false")
        if burn_in_saver:
            out["burn_in_saver"] = True
        else:
            out.pop("burn_in_saver", None)
    return out


# ---------------------------------------------------------------- binding entities to a draft's widgets


def bind(
    pane: dict[str, Any], bindings: dict[str, Any], registry: dict[str, Any], widget_id: Any, slot: Any, entity: Any
) -> dict[str, Any]:
    """Bind an entity (or a list of them) to one of a widget's slots, or clear the slot with null. Returns the new bindings for the pane.
    Slot names come from the widget catalogue; a slot starting with `when_` belongs to a "show when" condition and takes one entity."""
    out = copy.deepcopy(bindings)
    widget = pane["widgets"][widget_index(pane, widget_id)]
    spec = (registry.get(widget["type"]) or {}).get("slots", {})
    if not isinstance(slot, str) or not slot:
        raise OpError("name the slot to bind (see the widget catalogue)")
    definition = spec.get(slot)
    is_condition_slot = slot.startswith("when_")
    if definition is None and not is_condition_slot:
        available = ", ".join(spec) or "none (this widget takes no entity)"
        raise OpError(f"a {widget['type']} widget has no slot '{slot}'. Its slots: {available}")
    if entity is None:
        out.get(widget_id, {}).pop(slot, None)
        if not out.get(widget_id):
            out.pop(widget_id, None)
        return out
    kind = "entity" if is_condition_slot else definition.get("kind")
    items = [entity] if isinstance(entity, (str, dict)) else entity
    if not isinstance(items, list) or not items:
        raise OpError("give an entity like 'sensor.living_room_temperature', or a list of them")
    if kind in ("checks", "feeds"):
        # a status summary's checks and a news widget's feeds may be plain entities or rules ({entity, name, text, bad, ok, below, above, filter})
        if not all((isinstance(i, str) and _ENTITY_ID.match(i)) or isinstance(i, dict) for i in items):
            raise OpError(f"slot '{slot}' takes entity ids, or rules like {{\"entity\": \"sensor.x\", \"bad\": [\"on\"]}}")
        out.setdefault(widget_id, {})[slot] = items
        return out
    if not all(isinstance(i, str) and _ENTITY_ID.match(i) for i in items):
        raise OpError("an entity is written like 'sensor.living_room_temperature' (lower case, one dot); a slot that takes several accepts a list")
    if kind == "entity":
        if len(items) != 1:
            raise OpError(f"slot '{slot}' takes exactly one entity")
        value: Any = items[0]
    else:
        value = items
    domains = [] if is_condition_slot else definition.get("domains", [])
    if domains:
        wrong = [e for e in items if e.split(".")[0] not in domains]
        if wrong:
            raise OpError(f"slot '{slot}' takes {', '.join(domains)} entities, not {', '.join(wrong)}")
    out.setdefault(widget_id, {})[slot] = value
    return out
