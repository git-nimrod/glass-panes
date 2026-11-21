"""Services: glass_panes.show_pane, set_pane_bindings, get_schema, list_panes, get_pane, create_pane, save_pane, delete_pane, set_bindings, get_bindings,
save_display, delete_display,
get_mirror_status, set_mirror_presence, tune_mirror_presence, set_mirror_brightness, measure_presence_cost.

show_pane is the friendly way to switch a display from an automation; it does the same as select.select_option on the
display's select entity. The rest manage panes, bindings and displays and need an administrator (reading panes does not).
The pane services return data, so an automation, a script or an AI agent (for example through an MCP server for Home Assistant)
can build and edit panes the same way the sidebar builder does, with the same checks.
"""

from __future__ import annotations

import json
from pathlib import Path

from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError, Unauthorized, UnknownUser

from . import bindings as bindings_lib
from . import draft_tools
from .const import DOMAIN
from .manager import Manager

SERVICE_SHOW_PANE = "show_pane"
SERVICE_SET_BINDINGS = "set_bindings"
SERVICE_GET_BINDINGS = "get_bindings"
SERVICE_SAVE_DISPLAY = "save_display"
SERVICE_DELETE_DISPLAY = "delete_display"
SERVICE_SET_PANE_BINDINGS = "set_pane_bindings"
SERVICE_LIST_MEDIA = "list_media"
SERVICE_GET_SCHEMA = "get_schema"
SERVICE_LIST_PANES = "list_panes"
SERVICE_GET_PANE = "get_pane"
SERVICE_CREATE_PANE = "create_pane"
SERVICE_SAVE_PANE = "save_pane"
SERVICE_DELETE_PANE = "delete_pane"
SERVICE_GET_MIRROR_STATUS = "get_mirror_status"
SERVICE_SET_MIRROR_PRESENCE = "set_mirror_presence"
SERVICE_TUNE_MIRROR_PRESENCE = "tune_mirror_presence"
SERVICE_SET_MIRROR_BRIGHTNESS = "set_mirror_brightness"
SERVICE_MEASURE_PRESENCE_COST = "measure_presence_cost"
MIRROR_SERVICES = (SERVICE_GET_MIRROR_STATUS, SERVICE_SET_MIRROR_PRESENCE, SERVICE_TUNE_MIRROR_PRESENCE, SERVICE_SET_MIRROR_BRIGHTNESS, SERVICE_MEASURE_PRESENCE_COST)
ALL = MIRROR_SERVICES + tuple(t.name for t in draft_tools.TOOLS) + (SERVICE_SET_PANE_BINDINGS, SERVICE_LIST_MEDIA, SERVICE_GET_SCHEMA, SERVICE_LIST_PANES, SERVICE_GET_PANE, SERVICE_CREATE_PANE, SERVICE_SAVE_PANE, SERVICE_DELETE_PANE, SERVICE_SHOW_PANE, SERVICE_SET_BINDINGS, SERVICE_GET_BINDINGS, SERVICE_SAVE_DISPLAY, SERVICE_DELETE_DISPLAY)


def _load_scorebugs() -> list[dict]:
    """The broadcast scorebug catalogue (schema/scorebugs.json): id, label, era and sports of each, for sports widgets with layout bug.
    Read once when the module is imported (Home Assistant imports integrations outside its event loop)."""
    try:
        data = json.loads((Path(__file__).parent / "schema" / "scorebugs.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [{k: b.get(k) for k in ("id", "label", "era", "sports", "default_for", "tv")} for b in data.get("bugs", [])]


SCOREBUGS = _load_scorebugs()


def _load_fonts() -> list[dict]:
    """The lookalike fonts (schema/fonts.json): id, name, group and what each looks like, for style.font."""
    try:
        data = json.loads((Path(__file__).parent / "schema" / "fonts.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [{k: f.get(k) for k in ("id", "label", "group", "looks_like")} for f in data.get("fonts", [])]


LOOK_FONTS = _load_fonts()


def schema_for_agents(manager: Manager) -> dict:
    """Everything an agent needs to write a valid pane: the schema, the widget catalogue and the layout rules."""
    return {
        "canvas": {"width": 1080, "height": 1920},
        "grid": 40,
        "safe_zone": 40,
        "pane_schema": manager.pane_schema,
        "widgets": manager.registry,
        "scorebugs": SCOREBUGS,
        "fonts": LOOK_FONTS,
        "notes": [
            "To build a pane widget by widget, use a draft: start_draft, then add_widget, place_widget, bind_widget, update_widget, align_widgets, set_pane and remove_widget as needed, then finish_draft. A draft is private (not shown on any display, not in the pane list) and every step is checked, so a refused step changes nothing and says why. finish_draft saves a normal pane that a person can open in the builder and edit by hand, and never overwrites an existing pane unless you ask with replace. save_pane remains for sending a whole finished pane in one go.",
            "Positions and sizes are pixels on a 1080x1920 canvas. The builder snaps to a 40 px grid, but any whole number inside the canvas is valid.",
            "Keep important things 40 px or more from the edge (the safe zone): a mirror's frame can hide the outer strip.",
            "A pane holds layout only. Entities are bound separately: in a draft with bind_widget (or `entities` on add_widget), and on a saved pane with set_pane_bindings {widget id: {slot: entity id or list}}, using the slot names in `widgets`. Find real entity ids with find_entities first. (set_bindings replaces EVERY pane's bindings at once: only for restoring a backup.)",
            "A widget with auto_height sizes itself; flow {after: widget id} places it below another widget instead of at a fixed y.",
            "Never put entity ids inside a pane.",
            "An entity_value can be drawn as a tile (`options.look: tile`: a rounded card with the entity's icon in a tinted circle, the name over the value) or a chip (`look: chip`: a small pill with the icon and value); a style rule's colour tints the icon.",
            "Icons: the `icon` widget (or `options.icon` on an entity_value) shows a Material Design Icons name such as thermometer or door-open (no mdi: prefix); `auto` means the bound entity's own icon.",
            "A `table` widget binds several entities to its `rows` slot (one row each); `options.columns` (up to 8) say what each column shows: {source: name|state|attribute|text, attribute, text, header, format: auto|time|date|datetime|relative|duration|number|raw, decimals, unit, duration_unit, align, style_rules}.",
            "style_rules (conditional formatting) on a widget with an `entity` slot, or on a table column: [{test: above|below|between|is|is_not, value, to, attribute, style: {color, size, weight, opacity, icon}}]; the first rule that holds wins, and a number test never matches a state that is not a number.",
            "A divider is a line (`options.style`: solid, dashed, dotted, double, fade) or, with `options.look: box`, a rounded outline (`radius`, `fill`, `fill_opacity`) that frames a group of widgets and is always shown.",
            "A status_summary's `checks` slot takes entity ids or rules {entity, name, text, bad: [states] | ok: [states] | below | above}: bad warns when the state is one of those, ok warns when it is anything else, below/above warn on a number. Add from and to (HH:MM, the display's timezone) to warn only in that part of the day, e.g. {entity: 'light.porch', bad: ['on'], from: '01:00', to: '04:00'}; a from later than to runs through midnight.",
            "Some widget types in `widgets` list `looks` (named presets such as a clock's Digital, Thin, Clock face and Alarm clock): to use one, set its `options` and `style` with update_widget, and remove style keys another look set. `basics` names the options the builder shows first; every other option is still yours to set.",
            "Decorations need no entity: `sparkles` (twinkles and stars, a new scatter each day; options count, palette, stars, twinkle, whole_screen to cover the whole pane behind everything, keep_middle to leave the face area clear). A widget type's `group` in `widgets` is where the builder files it (decorations).",
            "A weather radar is the `radar` widget (not image): source us_composite (the US colour radar composite; region conus, lot or a 3-letter NWS office; layers counties, roads, places, temps, warnings), source url (any https radar picture), or bind a radar camera.* or image.* entity to its entity slot. Options frame, dim, grayscale, anchor, show_updated, label, refresh_s.",
            "ascii_art: show art (art: one of the library names in the schema, or custom with your own text), clock or weather (bind its optional weather slot); look green, amber or plain; scanlines, cursor. The text sizes itself to the box.",
            "Anime-inspired looks (our own drawings): petals (falling cherry-blossom petals; palette, motion fall|still, speed), sparkles shape kira, message look bubble|thought (tail, bubble_color), weather icon chibi.",
            "flights (Planes overhead) shows planes near home from a flight-tracking integration the person installed from HACS: bind slots.entities to FlightRadar24's sensor.flightradar24_current_in_area, or to Flights Above's Flights overhead sensor plus its Flight 1..n sensors; options look overhead|radar|board, units km|mi, max_flights, labels, radius_km, empty_text.",
            "moon (Moon phase) draws tonight's moon with its real shadow, worked out from the date (no entity needed); options look realistic|line|glow, layout stacked|side|moon, show_name, show_percent, show_next, hemisphere north|south; bind slots.entity to the Moon integration's sensor to use its phase names.",
            "art_pond (Lily pond) arranges cut-outs from Monet's Water Lilies (built in, set monet_lilies, the default) like a pond strip, anew each day; set own uses the person's uploads instead: options.pieces [{media id from list_media, role: base|accent|edge}]. Also clusters, per_cluster, accents, edge, size, depth.",
            "sports layout bug draws broadcast-style scorebugs: options.bug is an id from `scorebugs` in this reply (or auto), bug_by_league maps a league (NFL, NHL, MLB, NBA, MLS, NCAAF, NCAAM ...) to an id; bug_tv auto|clean|soft|vhs sets an old-TV picture (bugs with tv in the catalogue default to it); bug_marks both|league|ha|none puts the league's logo where the broadcast had it and the Home Assistant logo where the network's mark was; bug_logos default|dark picks the team logo version.",
            "news: rotate_minutes shows the next group of max_stories headlines every that many minutes; same_size draws every headline at the widget's size.",
            "A digital clock can stand up: options.orientation stacked (hours over minutes) or sideways (reads top to bottom along a narrow strip); the box sizes the digits, so give it a tall, narrow box. style.font galactic is an alien alphabet for fun looks; a clock in it can add options.plain_line (a small line in ordinary digits).",
            "A display's time zone is empty to follow Home Assistant's own. `add_group` drops a widget group the person saved in the builder into a draft.",
            "A pane may set `theme` (moss, cream, creamnight, midnight, paper or slate) to restyle its colours and background in one go; leave it out for the original look. Set `own_background: true` with a dark theme to keep the pane's own background (true black, see-through on a mirror) behind the theme's colours; a light theme needs its own background. When a theme is set it replaces `background`.",
            "show_when switches a widget on and off: {match: all|any, conditions: [...]}, up to 8 conditions. Kinds: {kind: has_content, widget: id} (that widget is showing something), {kind: empty, widget: id} (that widget is showing nothing: use it for a fallback that takes the place of another widget), {kind: entity, slot: when_x, test: is|is_not|above|below|unavailable, value: ...}, {kind: time, from: 'HH:MM', to: 'HH:MM'} (display timezone; from later than to runs through midnight), {kind: days, days: [mon..sun]}.",
            "An entity condition names a slot (when_ plus a name), never an entity id. Bind the entity with set_pane_bindings: {widget id: {when_x: 'binary_sensor.xyz'}}. A slot with no entity bound never holds, so the widget stays off.",
            "when_hidden: collapse (default) makes an off or empty widget take no space so widgets flowing below it move up; keep makes it hold its box height (h) so they stay put. Rules that wait on each other (A shown while B has content, B shown while A has content) are refused, as are references to widgets that are not in the pane.",
        ],
        "show_when_example": {
            "sports": {"id": "sports", "type": "sports", "x": 40, "y": 800, "w": 1000, "h": 300, "auto_height": True},
            "photo": {"id": "photo", "type": "image", "x": 40, "y": 800, "w": 1000, "h": 300, "show_when": {"conditions": [{"kind": "empty", "widget": "sports"}]}},
        },
    }


def schema_summary(manager: Manager) -> dict:
    """The short version of the rules for agents (the MCP get_schema tool): every widget in a line or two, the pane's own fields and the
    notes. About a quarter of the full document; get_widget gives one widget's options in full when they are needed."""
    full = schema_for_agents(manager)
    defs = (manager.pane_schema or {}).get("$defs") or {}
    widgets = {}
    for widget_type, spec in sorted((manager.registry or {}).items()):
        options = (defs.get(f"opt_{widget_type}") or {}).get("properties") or {}
        widgets[widget_type] = {
            "label": spec.get("label"), "description": spec.get("description"),
            "slots": {slot: {"domains": s.get("domains") or "any", "required": bool(s.get("required"))} for slot, s in (spec.get("slots") or {}).items()},
            "options": sorted(options),
            **({"looks": [look.get("label") or look.get("id") for look in spec["looks"]]} if spec.get("looks") else {}),
        }
    pane_fields = {k: (v.get("description") or "")[:160] for k, v in ((manager.pane_schema or {}).get("properties") or {}).items() if k != "widgets"}
    return {"canvas": full["canvas"], "grid": full["grid"], "safe_zone": full["safe_zone"], "pane_fields": pane_fields, "widgets": widgets,
            "notes": full["notes"], "next": "get_widget(type) for one widget's full options; find_entities before binding anything"}


async def _require_admin(hass: HomeAssistant, call: ServiceCall) -> None:
    """Same rule Home Assistant's own admin services use: a call made by a known non-admin user is refused."""
    if call.context.user_id:
        user = await hass.auth.async_get_user(call.context.user_id)
        if user is None:
            raise UnknownUser(context=call.context)
        if not user.is_admin:
            raise Unauthorized(context=call.context)


def async_register_services(hass: HomeAssistant, manager: Manager) -> None:
    async def show_pane(call: ServiceCall) -> None:
        problem = await manager.set_display_pane(str(call.data.get("display", "")), str(call.data.get("pane", "")))
        if problem:
            raise ServiceValidationError(problem)

    async def set_bindings(call: ServiceCall) -> None:
        await _require_admin(hass, call)
        problems = await manager.bindings.async_set(bindings_lib.wrap(call.data.get("bindings")))
        if problems:
            raise ServiceValidationError("The bindings are not valid: " + "; ".join(problems[:10]))

    async def get_bindings(call: ServiceCall) -> dict:
        return manager.bindings.data

    async def save_display(call: ServiceCall) -> dict:
        await _require_admin(hass, call)
        problems, display = await manager.save_display(dict(call.data))
        if problems:
            raise ServiceValidationError("The display is not valid: " + "; ".join(problems[:10]))
        return display or {}

    async def delete_display(call: ServiceCall) -> None:
        await _require_admin(hass, call)
        if not await manager.delete_display(str(call.data.get("display", ""))):
            raise ServiceValidationError("There is no such display")

    async def get_schema(call: ServiceCall) -> dict:
        return schema_for_agents(manager)

    async def set_pane_bindings(call: ServiceCall) -> None:
        await _require_admin(hass, call)
        problems = await manager.set_pane_bindings(call.data.get("pane"), call.data.get("bindings"))
        if problems:
            raise ServiceValidationError("The bindings are not valid: " + "; ".join(problems[:10]))

    async def list_media(call: ServiceCall) -> dict:
        return {"media": [{k: v for k, v in m.items() if k != "url"} for m in manager.list_media()]}

    async def list_panes(call: ServiceCall) -> dict:
        return {"panes": manager.list_panes()}

    async def get_pane(call: ServiceCall) -> dict:
        found = manager.get_pane(str(call.data.get("pane", "")))
        if found is None:
            raise ServiceValidationError("There is no such pane")
        return {"pane": found[0], "source": found[1], "bindings": manager.bindings.data["bindings"].get(found[0]["id"], {})}

    async def create_pane(call: ServiceCall) -> dict:
        await _require_admin(hass, call)
        problems, pane = await manager.create_pane(call.data.get("name"), call.data.get("description", ""), call.data.get("copy_from"))
        if problems:
            raise ServiceValidationError("The pane is not valid: " + "; ".join(problems[:10]))
        return {"pane": pane}

    async def save_pane(call: ServiceCall) -> dict:
        await _require_admin(hass, call)
        problems = await manager.save_pane(call.data.get("pane"))
        if problems:
            raise ServiceValidationError("The pane is not valid: " + "; ".join(problems[:10]))
        return {"panes": manager.list_panes()}

    async def delete_pane(call: ServiceCall) -> dict:
        await _require_admin(hass, call)
        problem = await manager.delete_pane(str(call.data.get("pane", "")))
        if problem:
            raise ServiceValidationError(problem)
        return {"panes": manager.list_panes()}

    def _mirror_outcome(problem, result) -> dict:
        """A request that cannot be done is a validation error; a mirror that cannot be reached or says no fails the call with its
        plain-language reason. A successful answer never holds the key."""
        if problem:
            raise ServiceValidationError(problem)
        if not result.get("ok"):
            raise HomeAssistantError(result.get("error") or "The mirror did not accept the request")
        return {k: v for k, v in result.items() if k != "endpoint"}      # the address stays out of automations' traces and agents' answers

    async def get_mirror_status(call: ServiceCall) -> dict:
        await _require_admin(hass, call)
        return _mirror_outcome(*await manager.mirror_status(call.data.get("display")))

    async def set_mirror_presence(call: ServiceCall) -> dict:
        await _require_admin(hass, call)
        return _mirror_outcome(*await manager.mirror_set_presence(call.data.get("display"), call.data.get("enabled")))

    async def tune_mirror_presence(call: ServiceCall) -> dict:
        await _require_admin(hass, call)
        values = {k: v for k, v in call.data.items() if k != "display"}
        return _mirror_outcome(*await manager.mirror_tune(call.data.get("display"), values))

    async def set_mirror_brightness(call: ServiceCall) -> dict:
        await _require_admin(hass, call)
        return _mirror_outcome(*await manager.mirror_set_brightness(call.data.get("display"), call.data.get("brightness")))

    async def measure_presence_cost(call: ServiceCall) -> dict:
        await _require_admin(hass, call)
        return _mirror_outcome(*await manager.mirror_measure(call.data.get("display"), call.data.get("confirm")))

    def _draft_service(tool: draft_tools.Tool):
        async def handler(call: ServiceCall) -> dict:
            await _require_admin(hass, call)
            try:
                return await draft_tools.call(manager, tool.name, dict(call.data))
            except draft_tools.ToolProblem as problem:
                raise ServiceValidationError("; ".join(problem.problems[:10])) from None

        return handler

    reg = hass.services.async_register
    for tool in draft_tools.TOOLS:
        reg(DOMAIN, tool.name, _draft_service(tool), supports_response=SupportsResponse.ONLY if tool.read_only else SupportsResponse.OPTIONAL)
    reg(DOMAIN, SERVICE_GET_MIRROR_STATUS, get_mirror_status, supports_response=SupportsResponse.ONLY)
    reg(DOMAIN, SERVICE_SET_MIRROR_PRESENCE, set_mirror_presence, supports_response=SupportsResponse.OPTIONAL)
    reg(DOMAIN, SERVICE_TUNE_MIRROR_PRESENCE, tune_mirror_presence, supports_response=SupportsResponse.OPTIONAL)
    reg(DOMAIN, SERVICE_SET_MIRROR_BRIGHTNESS, set_mirror_brightness, supports_response=SupportsResponse.OPTIONAL)
    reg(DOMAIN, SERVICE_MEASURE_PRESENCE_COST, measure_presence_cost, supports_response=SupportsResponse.OPTIONAL)
    reg(DOMAIN, SERVICE_SET_PANE_BINDINGS, set_pane_bindings)
    reg(DOMAIN, SERVICE_LIST_MEDIA, list_media, supports_response=SupportsResponse.ONLY)
    reg(DOMAIN, SERVICE_GET_SCHEMA, get_schema, supports_response=SupportsResponse.ONLY)
    reg(DOMAIN, SERVICE_LIST_PANES, list_panes, supports_response=SupportsResponse.ONLY)
    reg(DOMAIN, SERVICE_GET_PANE, get_pane, supports_response=SupportsResponse.ONLY)
    reg(DOMAIN, SERVICE_CREATE_PANE, create_pane, supports_response=SupportsResponse.OPTIONAL)
    reg(DOMAIN, SERVICE_SAVE_PANE, save_pane, supports_response=SupportsResponse.OPTIONAL)
    reg(DOMAIN, SERVICE_DELETE_PANE, delete_pane, supports_response=SupportsResponse.OPTIONAL)
    reg(DOMAIN, SERVICE_SHOW_PANE, show_pane)
    reg(DOMAIN, SERVICE_SET_BINDINGS, set_bindings)
    reg(DOMAIN, SERVICE_GET_BINDINGS, get_bindings, supports_response=SupportsResponse.ONLY)
    reg(DOMAIN, SERVICE_SAVE_DISPLAY, save_display, supports_response=SupportsResponse.OPTIONAL)
    reg(DOMAIN, SERVICE_DELETE_DISPLAY, delete_display)


def async_remove_services(hass: HomeAssistant) -> None:
    for name in ALL:
        hass.services.async_remove(DOMAIN, name)
