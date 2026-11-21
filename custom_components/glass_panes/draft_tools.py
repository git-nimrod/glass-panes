"""The agent tools for building a pane, widget by widget, in a draft.

One table (TOOLS) describes every tool once: its name, what it does, its fields and what it calls. The same table is used for the
Home Assistant services (services.py) and for the tool set that Home Assistant's Assist and MCP Server can offer (llm_api.py), so
the two can never drift apart. services.yaml and translations/en.json are generated from it, and a
test checks they are up to date.

How an agent works: start_draft, then add_widget / place_widget / bind_widget and so on, then finish_draft. A draft is not shown on
any display and not in the pane list. Every step is checked like saving a pane, so a draft is always valid. finish_draft saves it as a
real pane that a person can open in the builder and edit by hand.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:                      # only for the type hints, so the table above can be read without Home Assistant (see scripts/)
    from .manager import Manager


class ToolProblem(Exception):
    """A request that cannot be done, with plain-language reasons. Nothing was changed."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


@dataclass(frozen=True)
class Field:
    name: str
    kind: str                       # text | number | boolean | texts (a list of texts) | object | any
    description: str
    required: bool = False
    example: Any = None
    minimum: int | None = None
    maximum: int | None = None
    options: tuple[str, ...] = ()


@dataclass(frozen=True)
class Tool:
    name: str
    title: str
    description: str
    fields: tuple[Field, ...] = ()
    read_only: bool = False
    destructive: bool = False
    extra: dict[str, Any] = field(default_factory=dict)


DRAFT = Field("draft", "text", "The draft's id, as start_draft or list_drafts gave it.", True, "d_1a2b3c4d")
WIDGET = Field("widget", "text", "The id of a widget in the draft.", True, "clock")
PLACE = (
    Field("x", "number", "Distance from the left edge, in pixels (0 to 1080).", minimum=0, maximum=1080),
    Field("y", "number", "Distance from the top edge, in pixels (0 to 1920).", minimum=0, maximum=1920),
    Field("w", "number", "Width in pixels.", minimum=40, maximum=1080),
    Field("h", "number", "Height in pixels. Setting it makes the height fixed.", minimum=40, maximum=1920),
    Field("below", "text", "Put the widget directly under this widget (its id) instead of giving y.", example="clock"),
    Field("gap", "number", "Space in pixels between the two when using below (default 20).", minimum=0, maximum=400),
)

TOOLS: tuple[Tool, ...] = (
    Tool(
        "start_draft", "Start a draft",
        "Start building a pane in a draft. Nothing is shown on a display and nothing appears in the pane list until finish_draft. Start blank (give a name), "
        "from a copy of a pane (copy_from), or with a working copy of a pane you want to change (edit). Returns the draft's id.",
        (
            Field("name", "text", "The new pane's name (needed unless you give edit).", example="Morning at a glance"),
            Field("description", "text", "A short description of the pane."),
            Field("copy_from", "text", "Start from a copy of this pane (its id).", example="mirror"),
            Field("edit", "text", "Start a working copy of this pane to change it. finish_draft with replace saves over it.", example="mirror"),
        ),
    ),
    Tool("list_drafts", "List drafts", "List your drafts: id, name and the widgets in each.", read_only=True),
    Tool("get_draft", "Get a draft", "Return a whole draft: its pane (every widget) and the entities bound to it.", (DRAFT,), read_only=True),
    Tool(
        "add_widget", "Add a widget",
        "Add a widget to a draft. Call get_schema first to learn the widget types and their options. A widget goes at x and y if given, "
        "else directly under another widget (below), else the first free spot. Entities are never part of the pane: give them in `entities` "
        "(slot name -> entity id, or a list for a slot that takes several) or bind them later with bind_widget. Returns the widget with its id.",
        (
            DRAFT,
            Field("type", "text", "The widget type, for example clock, weather or calendar_agenda.", True, "weather"),
            Field("name", "text", "A label for the widget in the builder. Also used to make its id.", example="Weather"),
            *PLACE,
            Field("options", "object", "The widget's options (see get_schema), merged over its defaults."),
            Field("style", "object", "Style: font, size, weight, color, opacity, align, italic, uppercase, letter_spacing, line_height."),
            Field("auto_height", "boolean", "Let the height follow the content."),
            Field("entities", "object", "Entities for this widget: an object of slot name to an entity id or a list of them.", example='{"weather": "weather.home"}'),
            Field("style_rules", "any", "Conditional formatting for a widget with an `entity` slot: a list of up to 8 rules, the first that holds wins. Each rule has test (above, below, between, is, is_not), value, to (between only), attribute (optional) and style (color, size, weight, opacity, icon).",
                  example='[{"test": "above", "value": 30, "style": {"color": "bad"}}]'),
        ),
    ),
    Tool(
        "update_widget", "Change a widget",
        "Change a widget's name, options, style or show-when rule. Options and style are merged over what is there; set a key to null to remove it. "
        "Where it is and how big it is are changed with place_widget.",
        (
            DRAFT, WIDGET,
            Field("name", "text", "A new label."),
            Field("options", "object", "Options to change (merged). A key set to null is removed."),
            Field("style", "object", "Style to change (merged). A key set to null is removed."),
            Field("auto_height", "boolean", "Let the height follow the content, or not."),
            Field("when_hidden", "text", "What an off or empty widget does to the layout: collapse (default) or keep.", options=("collapse", "keep")),
            Field("show_when", "object", "A rule that switches the widget on and off: match (all or any) and a list of conditions. See get_schema for the condition kinds.",
                  example='{"conditions": [{"kind": "empty", "widget": "sports"}]}'),
            Field("clear_show_when", "boolean", "Remove the widget's show-when rule."),
            Field("style_rules", "any", "Replace the widget's conditional formatting (see add_widget).", example='[{"test": "below", "value": 20, "style": {"color": "warn"}}]'),
            Field("clear_style_rules", "boolean", "Remove the widget's conditional formatting."),
        ),
    ),
    Tool(
        "add_group", "Add a saved group",
        "Add a widget group the person saved in the builder (a set of widgets with their look and entities, such as a table with its title) to the draft. "
        "Give the group's id. If it is not known, the error lists the saved groups. The widgets get new ids and land in the first free spot.",
        (DRAFT, Field("group", "text", "The group's id.", True, "trips_table")),
    ),
    Tool(
        "place_widget", "Move or resize a widget",
        "Move and/or resize a widget. Give x and y, or below to sit directly under another widget. Everything stays inside the 1080 x 1920 canvas. "
        "The widget is pinned to these numbers (it stops flowing after another widget).",
        (DRAFT, WIDGET, *PLACE, Field("snap", "boolean", "Round x, y, w and h to the 40 px grid.")),
    ),
    Tool("remove_widget", "Remove a widget", "Remove a widget. Whatever flowed after it closes up, and its entities are forgotten.", (DRAFT, WIDGET), destructive=True),
    Tool(
        "bind_widget", "Bind an entity to a widget",
        "Bind an entity (or a list) to one of a widget's slots, or clear the slot. Slot names come from get_schema (for example weather has `weather`, "
        "calendar_agenda has `calendars`). A slot starting with when_ belongs to a show-when condition.",
        (
            DRAFT, WIDGET,
            Field("slot", "text", "The slot name.", True, "weather"),
            Field("entity", "any", "An entity id like weather.home, or a list of them for a slot that takes several. A status summary's checks and a news widget's feeds also accept rules.", example="weather.home"),
            Field("clear", "boolean", "Clear this slot instead of binding."),
        ),
    ),
    Tool(
        "align_widgets", "Align widgets",
        "Line up two or more widgets: left, center, right, top, middle, bottom, same-width, same-height, or (three or more) distribute-h and distribute-v.",
        (
            DRAFT,
            Field("widgets", "texts", "The ids of the widgets to align.", True, '["clock", "date"]'),
            Field("mode", "text", "How to line them up.", True, "left",
                  options=("left", "center", "right", "top", "middle", "bottom", "distribute-h", "distribute-v", "same-width", "same-height")),
        ),
    ),
    Tool(
        "set_pane", "Change the pane itself",
        "Change the draft's name, description, theme, background colour, photo background, brightness or fade. Themes: moss, cream, creamnight, midnight, paper, slate, or original to remove it.",
        (
            DRAFT,
            Field("name", "text", "The pane's name."),
            Field("description", "text", "A short description."),
            Field("theme", "text", "A colour theme, or original to remove it.", options=("moss", "cream", "creamnight", "midnight", "paper", "slate", "original")),
            Field("background", "text", "A background colour like #000000 (black is see-through on a two-way mirror). A theme replaces it.", example="#000000"),
            Field("brightness", "number", "Backlight percent to ask for while this pane shows (0 to 100).", minimum=0, maximum=100),
            Field("fade", "boolean", "Fade widgets in and out when their show-when rule switches them (new panes start with this on)."),
            Field("burn_in_saver", "boolean", "Drift the whole pane a few pixels very slowly, against burn-in on screens left on for hours."),
            Field("photo_background", "object",
                  "Photos behind the widgets from a Home Assistant media folder, with folder, photo (one file name; leave out for a slideshow of the "
                  "folder), interval_s, shuffle, fade and dim (0 to 0.8, a dark veil so text stays readable). An empty object removes it. "
                  "Not see-through on a mirror.",
                  example={"folder": "photos/family", "dim": 0.4}),
        ),
    ),
    Tool(
        "finish_draft", "Finish a draft",
        "Save the draft as a real pane. The person can then open it in the Glass Panes builder and edit it by hand, or show it on a display. "
        "It becomes a new pane by default. A draft started with `edit` can instead replace that pane, but only when you ask with replace.",
        (DRAFT, Field("replace", "boolean", "Overwrite the pane this draft was started from (only for a draft started with edit).")),
    ),
    Tool("discard_draft", "Discard a draft", "Throw a draft away. Nothing else is changed.", (DRAFT,), destructive=True),
    Tool(
        "find_entities", "Find entities",
        "Look up the person's entities before binding one (never invent an entity id). Filter by domain, area, words in the name, or the widget "
        "you want to fill. Each result says which widget slots it fits. Names and places only, no states.",
        (
            Field("domain", "text", "Only this kind of entity, like weather, calendar, sensor or media_player.", example="calendar"),
            Field("area", "text", "Only entities in this area (its name).", example="Kitchen"),
            Field("text", "text", "Words that must all appear in the entity id, name or area.", example="family"),
            Field("widget", "text", "Only entities made for this widget type (see get_schema).", example="calendar_agenda"),
            Field("limit", "number", "At most this many results (default 50).", minimum=1, maximum=200),
        ),
        read_only=True,
    ),
    Tool(
        "get_widget", "Get one widget's rules",
        "Everything about one widget type: its entity slots, every option with its allowed values and default, and its named looks. "
        "Use it after get_schema, for the widgets you are about to add.",
        (Field("type", "text", "The widget type, as get_schema lists it.", True, "clock"),),
        read_only=True,
    ),
    Tool(
        "preview_draft", "Show a draft on a display",
        "Show a draft on a display for a short while (default 2 minutes), then the display goes back to its own pane by itself. "
        "Nothing is saved. Ask the person first: it takes over a screen in their home.",
        (DRAFT, Field("display", "text", "The display's id (as list_panes' displays or the builder show it).", True, "mirror"),
         Field("seconds", "number", "How long to show it (10 to 600, default 120).", minimum=10, maximum=600)),
    ),
)
BY_NAME = {tool.name: tool for tool in TOOLS}


def widget_rules(manager: Manager, widget_type: Any) -> dict[str, Any] | None:
    """One widget type in full: its catalogue entry (slots, looks, basics) and its options from the pane schema."""
    spec = manager.registry.get(widget_type) if isinstance(widget_type, str) else None
    if spec is None:
        return None
    options = ((manager.pane_schema or {}).get("$defs") or {}).get(f"opt_{widget_type}", {}).get("properties", {})
    return {"type": widget_type, **spec, "options": options}


def _present(data: dict[str, Any], *names: str) -> dict[str, Any]:
    return {n: data[n] for n in names if data.get(n) is not None}


async def call(manager: Manager, name: str, data: dict[str, Any]) -> dict[str, Any]:
    """Run one tool. Returns the answer, or raises ToolProblem with the reasons. Callers check administrator rights first."""
    if name not in BY_NAME:
        raise ToolProblem([f"there is no tool '{name}'"])
    if name == "start_draft":
        problems, draft = await manager.start_draft(data.get("name"), data.get("description") or "", data.get("copy_from"), data.get("edit"))
        if problems:
            raise ToolProblem(problems)
        return {"draft": draft["draft"], "name": draft["name"], "widgets": draft["widgets"], "next": "add_widget, place_widget, bind_widget ... then finish_draft"}
    if name == "list_drafts":
        return {"drafts": manager.list_drafts()}
    if name == "find_entities":
        from . import entity_lookup          # here, so this tool table can be read without Home Assistant

        try:
            return entity_lookup.find(manager.entity_rows(), manager.registry, domain=data.get("domain"), area=data.get("area"),
                                      text=data.get("text"), widget=data.get("widget"), limit=data.get("limit"))
        except ValueError as err:
            raise ToolProblem([str(err)]) from None
    if name == "get_widget":
        found = widget_rules(manager, data.get("type"))
        if found is None:
            raise ToolProblem([f"there is no widget type '{data.get('type')}'; get_schema lists them"])
        return found
    if name == "preview_draft":
        draft = manager.get_draft(data.get("draft"))
        if draft is None:
            raise ToolProblem([f"there is no draft '{data.get('draft')}' (list_drafts shows yours)"])
        problem = await manager.start_preview(str(data.get("display") or ""), draft["pane"], draft["bindings"], data.get("seconds", 120))
        if problem:
            raise ToolProblem([problem])
        return {"ok": True, "display": data.get("display"), "seconds": data.get("seconds", 120), "note": "the display goes back to its own pane by itself"}
    if name == "get_draft":
        draft = manager.get_draft(data.get("draft"))
        if draft is None:
            raise ToolProblem([f"there is no draft '{data.get('draft')}' (list_drafts shows yours)"])
        return draft
    if name == "finish_draft":
        problems, result = await manager.finish_draft(data.get("draft"), bool(data.get("replace")))
        if problems:
            raise ToolProblem(problems)
        return result or {}
    if name == "discard_draft":
        if not await manager.discard_draft(data.get("draft")):
            raise ToolProblem([f"there is no draft '{data.get('draft')}'"])
        return {"discarded": data.get("draft")}

    draft_id = data.get("draft")
    if name == "add_widget":
        args = _present(data, "name", "x", "y", "w", "h", "below", "gap", "options", "style", "auto_height", "entities", "style_rules")
        problems, result = await manager.edit_draft(draft_id, "add_widget", type=data.get("type"), **args)
    elif name == "update_widget":
        args = _present(data, "name", "options", "style", "auto_height", "when_hidden")
        if data.get("clear_show_when"):
            args["show_when"] = None
        elif data.get("show_when") is not None:
            args["show_when"] = data["show_when"]
        if data.get("clear_style_rules"):
            args["style_rules"] = None
        elif data.get("style_rules") is not None:
            args["style_rules"] = data["style_rules"]
        problems, result = await manager.edit_draft(draft_id, "update_widget", widget=data.get("widget"), **args)
    elif name == "place_widget":
        args = _present(data, "x", "y", "w", "h", "below", "gap")
        problems, result = await manager.edit_draft(draft_id, "place_widget", widget=data.get("widget"), snap_to_grid=bool(data.get("snap")), **args)
    elif name == "add_group":
        problems, result = await manager.edit_draft(draft_id, "add_group", group=data.get("group"))
    elif name == "remove_widget":
        problems, result = await manager.edit_draft(draft_id, "remove_widget", widget=data.get("widget"))
    elif name == "bind_widget":
        entity = None if data.get("clear") else data.get("entity")
        problems, result = await manager.edit_draft(draft_id, "bind_widget", widget=data.get("widget"), slot=data.get("slot"), entity=entity)
    elif name == "align_widgets":
        problems, result = await manager.edit_draft(draft_id, "align_widgets", widgets=data.get("widgets"), mode=data.get("mode"))
    else:  # set_pane
        args = _present(data, "name", "description", "background", "brightness", "fade", "burn_in_saver", "photo_background")
        if "theme" in data and data["theme"] is not None:
            args["theme"] = None if data["theme"] == "original" else data["theme"]
        problems, result = await manager.edit_draft(draft_id, "set_pane", **args)
    if problems:
        raise ToolProblem(problems)
    return result or {}
