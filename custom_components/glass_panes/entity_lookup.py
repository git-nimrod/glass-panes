"""Finding entities for an agent (the `find_entities` tool): which of the person's entities exist, and which widget slots each one fits.

No Home Assistant imports: the caller hands in plain rows ({entity_id, name, area, device_class}) and the widget catalogue
(schema/widgets.json). An agent is told never to invent an entity id; this is how it looks one up instead. No states are returned:
only names and where they could go, so the answer is small and says nothing about what is happening in the house.
"""

from __future__ import annotations

from typing import Any

DEFAULT_LIMIT, MAX_LIMIT = 50, 200


def slots_for(domain: str, registry: dict[str, Any]) -> list[dict[str, str]]:
    """The widget slots made for this kind of entity (a slot listing the domain). Widgets that take any entity (a value, a table row,
    a progress ring) are not listed per entity: get_schema says which ones they are."""
    fits = []
    for widget_type, spec in sorted(registry.items()):
        for slot, slot_spec in (spec.get("slots") or {}).items():
            if domain in (slot_spec.get("domains") or []):
                fits.append({"widget": widget_type, "slot": slot})
    return fits


def any_entity_widgets(registry: dict[str, Any]) -> list[dict[str, str]]:
    """Widget slots that take an entity of any kind."""
    out = []
    for widget_type, spec in sorted(registry.items()):
        for slot, slot_spec in (spec.get("slots") or {}).items():
            if not slot_spec.get("domains") and not slot.startswith("when_"):
                out.append({"widget": widget_type, "slot": slot})
    return out


def find(rows: list[dict[str, Any]], registry: dict[str, Any], *, domain: Any = None, area: Any = None, text: Any = None,
         widget: Any = None, limit: Any = None) -> dict[str, Any]:
    """Filter the rows and say what each fits. All filters are optional and case-insensitive; `widget` keeps only entities made for
    that widget type. Returns {"entities": [...], "total": n, "shown": m, "any_entity_widgets": [...]}."""
    try:
        cap = min(max(int(limit), 1), MAX_LIMIT) if limit is not None else DEFAULT_LIMIT
    except (TypeError, ValueError):
        cap = DEFAULT_LIMIT
    want_domain = str(domain).strip().lower().rstrip(".") if domain else None
    want_area = str(area).strip().lower() if area else None
    words = [w for w in str(text).lower().split() if w] if text else []
    want_widget = str(widget).strip() if widget else None
    if want_widget and want_widget not in registry:
        raise ValueError(f"there is no widget type '{want_widget}'; get_schema lists them")
    found = []
    for row in rows:
        entity_id = str(row.get("entity_id") or "")
        if "." not in entity_id:
            continue
        row_domain = entity_id.split(".", 1)[0]
        if want_domain and row_domain != want_domain:
            continue
        name = str(row.get("name") or "")
        area_name = str(row.get("area") or "")
        if want_area and want_area not in (area_name.lower(), str(row.get("area_id") or "").lower()):
            continue
        haystack = (entity_id + " " + name + " " + area_name).lower()
        if words and not all(w in haystack for w in words):
            continue
        fits = slots_for(row_domain, registry)
        if want_widget and not any(f["widget"] == want_widget for f in fits):
            continue
        item = {"entity_id": entity_id, "name": name, "domain": row_domain, "area": area_name or None, "fits": fits}
        if row.get("device_class"):
            item["device_class"] = str(row["device_class"])
        found.append(item)
    found.sort(key=lambda r: (r["area"] or "~", r["domain"], r["name"].lower(), r["entity_id"]))
    return {"entities": found[:cap], "total": len(found), "shown": min(len(found), cap), "any_entity_widgets": any_entity_widgets(registry)}
