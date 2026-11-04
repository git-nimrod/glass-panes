"""Glass Panes as a tool set for Home Assistant's Assist and MCP Server.

Home Assistant keeps a registry of "LLM APIs" (homeassistant.helpers.llm). Registering one makes its tools available to Assist
conversation agents and, through Home Assistant's built-in MCP Server integration, to any MCP client (an AI agent or a coding
assistant). The tools are the ones in draft_tools.py, the same ones the services offer, plus a few read-only ones to look around.

Every tool needs a signed-in administrator: the tools change what a mirror can show. A request with no known user is refused.
"""

from __future__ import annotations

from typing import Any

try:
    import probatio as schema_lib
except ImportError:  # an older Home Assistant
    import voluptuous as schema_lib

from homeassistant.core import HomeAssistant
from homeassistant.helpers import llm

from . import draft_tools
from .const import DOMAIN
from .manager import Manager

PREFIX = "glass_panes_"

API_PROMPT = (
    "Glass Panes designs the screens (\"panes\") a Lululemon Studio mirror shows. A pane is a 1080 x 1920 portrait canvas of positioned "
    "widgets. To build one: call glass_panes_get_schema to learn the widget types, their options and the layout rules; glass_panes_start_draft; "
    "then add widgets one at a time (glass_panes_add_widget, glass_panes_place_widget, glass_panes_bind_widget, ...); then glass_panes_finish_draft. "
    "A draft is private until you finish it, and every step is checked, so a step that would make an invalid pane is refused with the reasons. "
    "Finishing saves a normal pane that the person can open in the Glass Panes builder and edit by hand. Never invent entity ids: look them up "
    "first, or leave a widget unbound. Keep important things 40 px or more from the canvas edge. Black is see-through on a two-way mirror."
)


def _type_for(field: draft_tools.Field) -> Any:
    if field.options:
        return schema_lib.In(list(field.options))
    if field.kind == "number":
        if field.minimum is not None and field.maximum is not None:
            return schema_lib.All(int, schema_lib.Range(min=field.minimum, max=field.maximum))
        return int
    if field.kind == "boolean":
        return bool
    if field.kind == "texts":
        return [str]
    if field.kind == "object":
        return dict
    if field.kind == "any":
        return schema_lib.Any(str, [schema_lib.Any(str, dict)], dict)
    return str


def _schema(fields: tuple[draft_tools.Field, ...]) -> Any:
    shape: dict[Any, Any] = {}
    for field in fields:
        marker = schema_lib.Required if field.required else schema_lib.Optional
        shape[marker(field.name, description=field.description)] = _type_for(field)
    return schema_lib.Schema(shape)


async def _is_admin(hass: HomeAssistant, llm_context: llm.LLMContext) -> bool:
    user_id = llm_context.context.user_id if llm_context.context else None
    if not user_id:
        return False
    user = await hass.auth.async_get_user(user_id)
    return bool(user and user.is_admin and user.is_active)


def _refusal() -> llm.ToolResult:
    return llm.ToolResult(data={"error": "The Glass Panes tools need a signed-in Home Assistant administrator."}, error=True)


class _DraftTool(llm.Tool):
    integration = DOMAIN

    def __init__(self, spec: draft_tools.Tool) -> None:
        self._spec = spec
        self.name = PREFIX + spec.name
        self.title = spec.title
        self.description = spec.description
        self.parameters = _schema(spec.fields)
        self.annotations = llm.ToolAnnotations(read_only=spec.read_only, destructive=spec.destructive, idempotent=spec.read_only, open_world=False)

    async def async_call(self, hass: HomeAssistant, tool_input: llm.ToolInput, llm_context: llm.LLMContext) -> llm.ToolResult:
        if not await _is_admin(hass, llm_context):
            return _refusal()
        try:
            data = self.parameters(tool_input.tool_args)
        except Exception as err:  # probatio and voluptuous both raise their own Invalid types
            return llm.ToolResult(data={"error": f"The request is not valid: {err}"}, error=True)
        try:
            return llm.ToolResult(data=await draft_tools.call(hass.data[DOMAIN]["manager"], self._spec.name, dict(data)))
        except draft_tools.ToolProblem as problem:
            return llm.ToolResult(data={"error": "Nothing was changed.", "problems": problem.problems[:10]}, error=True)


class _ReadTool(llm.Tool):
    """A read-only look around: the rules, the panes, the uploaded files."""

    integration = DOMAIN
    annotations = llm.ToolAnnotations(read_only=True, destructive=False, idempotent=True, open_world=False)

    def __init__(self, name: str, title: str, description: str, fields: tuple[draft_tools.Field, ...] = ()) -> None:
        self._short = name
        self.name = PREFIX + name
        self.title = title
        self.description = description
        self.parameters = _schema(fields)

    async def async_call(self, hass: HomeAssistant, tool_input: llm.ToolInput, llm_context: llm.LLMContext) -> llm.ToolResult:
        if not await _is_admin(hass, llm_context):
            return _refusal()
        try:
            data = self.parameters(tool_input.tool_args)
        except Exception as err:
            return llm.ToolResult(data={"error": f"The request is not valid: {err}"}, error=True)
        manager: Manager = hass.data[DOMAIN]["manager"]
        if self._short == "get_schema":
            return llm.ToolResult(data=schema_document(manager))
        if self._short == "list_panes":
            return llm.ToolResult(data={"panes": manager.list_panes()})
        if self._short == "list_media":
            return llm.ToolResult(data={"media": [{k: v for k, v in m.items() if k != "url"} for m in manager.list_media()]})
        found = manager.get_pane(str(data.get("pane", "")))                                   # get_pane
        if found is None:
            return llm.ToolResult(data={"error": f"There is no pane '{data.get('pane')}'."}, error=True)
        return llm.ToolResult(data={"pane": found[0], "source": found[1], "bindings": manager.bindings.data["bindings"].get(found[0]["id"], {})})


def schema_document(manager: Manager) -> dict[str, Any]:
    """The same document the glass_panes.get_schema service returns."""
    from .services import schema_for_agents      # imported here: services.py imports this module's neighbours

    return schema_for_agents(manager)


READ_TOOLS = (
    ("get_schema", "Get the rules", "Everything you need to write a valid pane: the pane schema, every widget type with its options and entity slots, the canvas and grid sizes, and the layout notes. Call this first.", ()),
    ("list_panes", "List panes", "List the panes that exist (id, name, description, widget count).", ()),
    ("get_pane", "Get a pane", "Return one pane and the entities bound to it, as an example or to start from.", (draft_tools.Field("pane", "text", "The pane's id.", True, "mirror"),)),
    ("list_media", "List uploaded files", "List the pictures and videos a person uploaded (id, name, kind, size). Use an id as options.media on an image or video widget. You can't upload files.", ()),
)


class GlassPanesAPI(llm.API):
    """The "Glass Panes" tool set."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.id = DOMAIN
        self.name = "Glass Panes"

    async def async_get_api_instance(self, llm_context: llm.LLMContext) -> llm.APIInstance:
        tools: list[llm.Tool] = [_ReadTool(*spec) for spec in READ_TOOLS] + [_DraftTool(spec) for spec in draft_tools.TOOLS]
        return llm.APIInstance(api=self, api_prompt=API_PROMPT, llm_context=llm_context, tools=tools)
