"""Entity bindings: which Home Assistant entity feeds which widget of which pane.

Pane files hold layout only. Bindings live here, kept apart so panes can be shared without sharing anyone's entities.
This module has no Home Assistant imports so the checking can be tested on its own. It mirrors
schema/bindings.schema.json (the schema file is the reference for people and tools; this is the check the integration runs).
"""

from __future__ import annotations

import json
import re
from typing import Any

SCHEMA_VERSION = 1
MAX_BYTES = 262144          # a bindings document is a few KB; anything near this is a mistake
MAX_ITEMS = 40              # per slot, same as the schema

_SLUG = re.compile(r"^[a-z0-9_]{1,64}$")
_ENTITY_ID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
CONDITION_SLOT_PREFIX = "when_"     # slots named when_... hold the entity of a widget's "show when" entity condition
_RULE_KEYS ={"entity", "name", "text", "bad", "ok", "below", "above", "filter"}


def empty() -> dict[str, Any]:
    """A document with nothing bound."""
    return {"schema_version": SCHEMA_VERSION, "bindings": {}}


def wrap(bindings: Any) -> dict[str, Any]:
    """Put a bare pane -> widget -> slot mapping into a full document."""
    return {"schema_version": SCHEMA_VERSION, "bindings": bindings}


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _check_rule(where: str, rule: Any, errors: list[str]) -> None:
    if not isinstance(rule, dict):
        errors.append(f"{where}: expected an entity id or an object with an 'entity'")
        return
    unknown = set(rule) - _RULE_KEYS
    if unknown:
        errors.append(f"{where}: unknown keys {sorted(unknown)}")
    entity = rule.get("entity")
    if not isinstance(entity, str) or not _ENTITY_ID.match(entity):
        errors.append(f"{where}: 'entity' must be an entity id like domain.name")
    for key in ("name", "text"):
        if key in rule and (not isinstance(rule[key], str) or len(rule[key]) > 80):
            errors.append(f"{where}: '{key}' must be text of at most 80 characters")
    for key in ("bad", "ok"):
        if key in rule and (
            not isinstance(rule[key], list) or len(rule[key]) > 20 or not all(isinstance(v, str) for v in rule[key])
        ):
            errors.append(f"{where}: '{key}' must be a list of up to 20 texts")
    for key in ("below", "above"):
        if key in rule and not _is_number(rule[key]):
            errors.append(f"{where}: '{key}' must be a number")
    if "filter" in rule and rule["filter"] not in ("all", "keywords"):
        errors.append(f"{where}: 'filter' must be 'all' or 'keywords'")


def _check_value(where: str, value: Any, errors: list[str]) -> None:
    if isinstance(value, str):
        if not _ENTITY_ID.match(value):
            errors.append(f"{where}: '{value}' is not an entity id like domain.name")
    elif isinstance(value, list):
        if len(value) > MAX_ITEMS:
            errors.append(f"{where}: more than {MAX_ITEMS} items")
            return
        for i, item in enumerate(value):
            if isinstance(item, str):
                if not _ENTITY_ID.match(item):
                    errors.append(f"{where}[{i}]: '{item}' is not an entity id like domain.name")
            else:
                _check_rule(f"{where}[{i}]", item, errors)
    else:
        errors.append(f"{where}: expected an entity id, a list of them, or a list of rules")


def validate(doc: Any) -> list[str]:
    """Return a list of problems with a bindings document; an empty list means it is fine."""
    errors: list[str] = []
    if not isinstance(doc, dict):
        return ["the document must be an object"]
    if set(doc) - {"schema_version", "bindings"}:
        errors.append(f"unknown top-level keys {sorted(set(doc) - {'schema_version', 'bindings'})}")
    if doc.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version must be {SCHEMA_VERSION}")
    bindings = doc.get("bindings")
    if not isinstance(bindings, dict):
        errors.append("'bindings' must be an object of pane ids")
        return errors
    try:
        if len(json.dumps(doc)) > MAX_BYTES:
            errors.append("the document is too large")
            return errors
    except (TypeError, ValueError):
        errors.append("the document must be plain JSON")
        return errors
    for pane_id, widgets in bindings.items():
        if not _SLUG.match(str(pane_id)):
            errors.append(f"pane id '{pane_id}' must be lowercase letters, digits and _")
            continue
        if not isinstance(widgets, dict):
            errors.append(f"{pane_id}: expected an object of widget ids")
            continue
        for widget_id, slots in widgets.items():
            if not _SLUG.match(str(widget_id)):
                errors.append(f"{pane_id}: widget id '{widget_id}' must be lowercase letters, digits and _")
                continue
            if not isinstance(slots, dict):
                errors.append(f"{pane_id}/{widget_id}: expected an object of slots")
                continue
            for slot, value in slots.items():
                if not _SLUG.match(str(slot)):
                    errors.append(f"{pane_id}/{widget_id}: slot name '{slot}' must be lowercase letters, digits and _")
                    continue
                if slot.startswith(CONDITION_SLOT_PREFIX) and not isinstance(value, str):
                    # the entity of a "show when" condition (see panes.py / pane-schema.md): exactly one entity
                    errors.append(f"{pane_id}/{widget_id}/{slot}: a condition slot takes one entity id, not a list")
                    continue
                _check_value(f"{pane_id}/{widget_id}/{slot}", value, errors)
    return errors
