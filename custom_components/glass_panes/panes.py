"""Panes: loading the shipped examples and checking any pane, whether shipped or saved from the builder.

No Home Assistant imports, so all of it is testable on its own. The structure of a pane is described by
schema/pane.schema.json (checked with schema_check.py); this adds what a schema cannot say: widget ids must be unique,
widgets must stay on the canvas, and flow references must point at real widgets and never loop.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .schema_check import SchemaChecker

CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1920
MAX_USER_PANES = 100


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def semantic_errors(pane: dict[str, Any]) -> list[str]:
    """What is wrong with a pane beyond its structure. Assumes the structure already passed the schema."""
    errors: list[str] = []
    widgets = {}
    for widget in pane.get("widgets", []):
        wid = widget.get("id")
        if wid in widgets:
            errors.append(f"duplicate widget id '{wid}'")
        widgets[wid] = widget
        try:
            if widget["x"] + widget["w"] > CANVAS_WIDTH or widget["y"] + widget["h"] > CANVAS_HEIGHT:
                errors.append(f"widget '{wid}' runs off the {CANVAS_WIDTH}x{CANVAS_HEIGHT} canvas")
        except (KeyError, TypeError):
            pass

    edges: dict[str, list[str]] = {}
    for wid, widget in widgets.items():
        flow = widget.get("flow")
        if not isinstance(flow, dict):
            continue
        after = flow.get("after", [])
        after = [after] if isinstance(after, str) else list(after)
        refs = after + ([flow["show_if"]] if flow.get("show_if") else [])
        for ref in refs:
            if ref == wid:
                errors.append(f"widget '{wid}' refers to itself in flow")
            elif ref not in widgets:
                errors.append(f"widget '{wid}' flows after '{ref}', which is not in the pane")
        edges[wid] = [r for r in after if r in widgets and r != wid]

    state: dict[str, int] = {}

    def visit(node: str, trail: list[str]) -> None:
        if state.get(node) == 2:
            return
        if state.get(node) == 1:
            errors.append("flow loop: " + " -> ".join(trail + [node]))
            return
        state[node] = 1
        for nxt in edges.get(node, []):
            visit(nxt, trail + [node])
        state[node] = 2

    for wid in edges:
        visit(wid, [])
    errors.extend(rule_errors(widgets))
    return errors


# ------------------------------------------------------------------ "show when" rules

# which fields each kind of condition uses; anything else on it is a mistake worth naming
_CONDITION_FIELDS = {
    "has_content": {"kind", "widget"},
    "empty": {"kind", "widget"},
    "entity": {"kind", "slot", "test", "value"},
    "time": {"kind", "from", "to"},
    "days": {"kind", "days"},
}


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def rule_errors(widgets: dict[str, dict[str, Any]]) -> list[str]:
    """Check every widget's `show_when` rule (and the older `flow.show_if`) in plain language. Assumes the structure already passed
    the schema. Widget references must exist, each kind must carry the right fields, and rules must not wait on each other in a circle
    (A shown while B has content, B shown while A has content), because such a pane can never settle on an answer."""
    errors: list[str] = []
    waits_on: dict[str, list[str]] = {}
    for wid, widget in widgets.items():
        rule = widget.get("show_when")
        refs: list[str] = []
        flow = widget.get("flow")
        if isinstance(flow, dict) and flow.get("show_if") in widgets and flow["show_if"] != wid:
            refs.append(flow["show_if"])                         # the older show_if is the same thing as a "has content" condition
        if isinstance(rule, dict):
            if widget.get("type") == "video":
                errors.append(f"widget '{wid}' is a looping video, which the display app plays by itself, so a show_when rule cannot switch it off; put the video on its own pane")
            for number, cond in enumerate(rule.get("conditions", []), start=1):
                where = f"widget '{wid}', condition {number}"
                kind = cond.get("kind")
                for extra in sorted(set(cond) - _CONDITION_FIELDS.get(kind, set())):
                    errors.append(f"{where} ({kind}): '{extra}' is not used by this kind of condition")
                if kind in ("has_content", "empty"):
                    target = cond.get("widget")
                    if target == wid:
                        errors.append(f"{where}: a widget cannot wait on itself")
                    elif target not in widgets:
                        errors.append(f"{where}: refers to widget '{target}', which is not in the pane")
                    else:
                        refs.append(target)
                elif kind == "entity":
                    test, value = cond.get("test"), cond.get("value")
                    if test in ("is", "is_not"):
                        texts = value if isinstance(value, list) else [value]
                        if not texts or not all(isinstance(t, str) and t != "" for t in texts):
                            errors.append(f"{where}: '{test}' needs the state to compare with, as text or a list of texts (for example \"on\")")
                    elif test in ("above", "below"):
                        if not _is_number(value):
                            errors.append(f"{where}: '{test}' needs a number as the value")
                    elif "value" in cond:                         # unavailable
                        errors.append(f"{where}: 'unavailable' does not take a value")
                elif kind == "time" and cond.get("from") == cond.get("to"):
                    errors.append(f"{where}: the time window starts and ends at {cond.get('from')}, so it is empty or all day; use two different times, or remove the condition")
        waits_on[wid] = refs

    # circles: report each once, as a path that ends where it began
    state: dict[str, int] = {}
    reported: set[frozenset[str]] = set()

    def walk(node: str, trail: list[str]) -> None:
        if state.get(node) == 2:
            return
        if state.get(node) == 1:
            loop = trail[trail.index(node):]
            key = frozenset(loop)
            if key not in reported:
                reported.add(key)
                errors.append("these rules wait on each other and can never settle: " + " -> ".join(loop + [node]) + "; change one of them")
            return
        state[node] = 1
        for nxt in waits_on.get(node, []):
            walk(nxt, trail + [node])
        state[node] = 2

    for wid in waits_on:
        walk(wid, [])
    return errors


class PaneChecker:
    """Checks a whole pane: structure first, then the rules a schema cannot express."""

    def __init__(self, pane_schema: dict[str, Any]) -> None:
        self._schema = SchemaChecker(pane_schema)

    def check(self, pane: Any) -> list[str]:
        errors = self._schema.check(pane)
        if not errors:
            errors = semantic_errors(pane)
        return errors


def load_shipped(base: Path) -> tuple[dict[str, dict[str, Any]], dict[str, Any], dict[str, Any], list[str]]:
    """Read the shipped panes, the pane schema and the widget registry from disk (blocking: call from an executor).

    Returns (panes by id, pane schema, widget registry, problems). A shipped pane that fails its own checks is left out and
    reported rather than served.
    """
    schema = load_json(base / "schema" / "pane.schema.json")
    registry = load_json(base / "schema" / "widgets.json")["widgets"]
    checker = PaneChecker(schema)
    panes: dict[str, dict[str, Any]] = {}
    problems: list[str] = []
    for path in sorted((base / "panes").glob("*.json")):
        pane = load_json(path)
        errors = checker.check(pane)
        if errors:
            problems.append(f"{path.name}: {'; '.join(errors[:3])}")
        elif pane["id"] != path.stem:
            problems.append(f"{path.name}: pane id '{pane['id']}' does not match the file name")
        else:
            panes[pane["id"]] = pane
    return panes, schema, registry, problems


def summarize(pane: dict[str, Any], source: str, customized: bool) -> dict[str, Any]:
    """The short form used in lists. `source` is 'shipped' or 'user'; `customized` means a saved pane replaces a shipped one."""
    return {
        "id": pane["id"],
        "name": pane["name"],
        "description": pane.get("description", ""),
        "source": source,
        "customized": customized,
        "widgets": len(pane.get("widgets", [])),
    }
