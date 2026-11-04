"""A small JSON Schema checker, just big enough for this integration's own schema files.

Home Assistant does not ship a JSON Schema library, and downloading one at startup would put the whole integration at risk
if that ever failed. The pane schema (schema/pane.schema.json) is the single description of what a pane may contain, so this
reads that file directly instead of repeating its rules in Python. It has no Home Assistant imports.

It supports only the keywords the schema files use. A schema that uses any other keyword is refused when it is loaded
(unsupported_keywords), so adding a keyword to a schema file can never be silently ignored. tests compare it with the real
`jsonschema` library on every example pane and on many deliberately broken ones.
"""

from __future__ import annotations

import re
from typing import Any

# keywords this checker evaluates
_APPLIED = {
    "type", "const", "enum", "required", "properties", "additionalProperties", "propertyNames", "items", "minItems",
    "maxItems", "uniqueItems", "minLength", "maxLength", "pattern", "minimum", "maximum", "multipleOf", "oneOf", "allOf",
    "if", "then", "$ref",
}
# keywords that carry no rule (notes, defaults, the container for shared definitions)
_IGNORED = {"$schema", "$defs", "title", "description", "default"}

MAX_ERRORS = 50


def unsupported_keywords(schema: Any, _is_schema: bool = True) -> set[str]:
    """Return any schema keyword this checker does not know (empty means the schema is fully supported)."""
    found: set[str] = set()
    if isinstance(schema, dict) and _is_schema:
        for key, value in schema.items():
            if key not in _APPLIED and key not in _IGNORED:
                found.add(key)
            if key in ("properties", "$defs"):
                for sub in value.values():            # the names here are field names, not keywords
                    found |= unsupported_keywords(sub)
            elif key in ("additionalProperties", "items", "propertyNames", "if", "then"):
                found |= unsupported_keywords(value)
            elif key in ("oneOf", "allOf"):
                for sub in value:
                    found |= unsupported_keywords(sub)
    return found


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


_TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: _is_int(v) or (isinstance(v, float) and v.is_integer()),
    "number": _is_number,
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def _same(a: Any, b: Any) -> bool:
    """JSON equality: True is not 1, and containers compare element by element."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b))
    if _is_number(a) and _is_number(b):
        return a == b
    return type(a) is type(b) and a == b


def _short(value: Any) -> str:
    text = repr(value)
    return text if len(text) <= 40 else text[:37] + "..."


class SchemaChecker:
    """Check data against one schema document."""

    def __init__(self, schema: dict[str, Any]) -> None:
        bad = unsupported_keywords(schema)
        if bad:
            raise ValueError(f"schema uses keywords this checker does not support: {sorted(bad)}")
        self._root = schema

    def check(self, instance: Any) -> list[str]:
        """Return what is wrong with `instance`, as 'where: what' lines. Empty means it is valid."""
        errors: list[str] = []
        self._walk(instance, self._root, "", errors)
        return errors

    # ------------------------------------------------------------------ internals

    def _ref(self, ref: str) -> dict[str, Any]:
        if not ref.startswith("#/"):
            raise ValueError(f"only local references are supported, got {ref}")
        node: Any = self._root
        for part in ref[2:].split("/"):
            node = node[part]
        return node

    def _valid(self, instance: Any, schema: dict[str, Any]) -> bool:
        errors: list[str] = []
        self._walk(instance, schema, "", errors)
        return not errors

    def _walk(self, instance: Any, schema: Any, path: str, errors: list[str]) -> None:
        if len(errors) >= MAX_ERRORS or schema is True:
            return
        if schema is False:
            errors.append(f"{path or '(root)'}: not allowed")
            return
        where = path or "(root)"

        if "$ref" in schema:
            self._walk(instance, self._ref(schema["$ref"]), path, errors)

        if "type" in schema:
            wanted = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
            if not any(_TYPES[t](instance) for t in wanted):
                errors.append(f"{where}: expected {' or '.join(wanted)}, got {_short(instance)}")
                return                       # the rules below assume the right kind of value
        if "const" in schema and not _same(instance, schema["const"]):
            errors.append(f"{where}: must be {_short(schema['const'])}, got {_short(instance)}")
        if "enum" in schema and not any(_same(instance, option) for option in schema["enum"]):
            errors.append(f"{where}: {_short(instance)} is not one of {schema['enum']}")

        if isinstance(instance, str):
            if "minLength" in schema and len(instance) < schema["minLength"]:
                errors.append(f"{where}: shorter than {schema['minLength']} characters")
            if "maxLength" in schema and len(instance) > schema["maxLength"]:
                errors.append(f"{where}: longer than {schema['maxLength']} characters")
            if "pattern" in schema and not re.search(schema["pattern"], instance):
                errors.append(f"{where}: {_short(instance)} does not match {schema['pattern']}")

        if _is_number(instance):
            if "minimum" in schema and instance < schema["minimum"]:
                errors.append(f"{where}: {instance} is less than the minimum of {schema['minimum']}")
            if "maximum" in schema and instance > schema["maximum"]:
                errors.append(f"{where}: {instance} is more than the maximum of {schema['maximum']}")
            if "multipleOf" in schema:
                step = schema["multipleOf"]
                quotient = instance / step
                if int(quotient) != quotient:
                    errors.append(f"{where}: {instance} is not a multiple of {step}")

        if isinstance(instance, list):
            if "minItems" in schema and len(instance) < schema["minItems"]:
                errors.append(f"{where}: fewer than {schema['minItems']} items")
            if "maxItems" in schema and len(instance) > schema["maxItems"]:
                errors.append(f"{where}: more than {schema['maxItems']} items")
            if schema.get("uniqueItems") and any(
                _same(a, b) for i, a in enumerate(instance) for b in instance[i + 1:]
            ):
                errors.append(f"{where}: items must all be different")
            if "items" in schema:
                for i, item in enumerate(instance):
                    self._walk(item, schema["items"], f"{path}/{i}", errors)

        if isinstance(instance, dict):
            for name in schema.get("required", []):
                if name not in instance:
                    errors.append(f"{where}: missing '{name}'")
            props = schema.get("properties", {})
            for name, value in instance.items():
                if name in props:
                    self._walk(value, props[name], f"{path}/{name}", errors)
                elif "additionalProperties" in schema:
                    extra = schema["additionalProperties"]
                    if extra is False:
                        errors.append(f"{where}: '{name}' is not allowed here")
                    else:
                        self._walk(value, extra, f"{path}/{name}", errors)
            if "propertyNames" in schema:
                for name in instance:
                    self._walk(name, schema["propertyNames"], f"{path}/{name} (name)", errors)

        if "allOf" in schema:
            for sub in schema["allOf"]:
                self._walk(instance, sub, path, errors)
        if "oneOf" in schema:
            matching = sum(1 for sub in schema["oneOf"] if self._valid(instance, sub))
            if matching != 1:
                errors.append(f"{where}: {_short(instance)} must match exactly one of the allowed forms (matched {matching})")
        if "if" in schema and self._valid(instance, schema["if"]) and "then" in schema:
            self._walk(instance, schema["then"], path, errors)
