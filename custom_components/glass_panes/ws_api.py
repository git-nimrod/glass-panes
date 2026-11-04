"""The websocket API the sidebar builder will talk to: glass_panes/<thing>/<action>.

Reading is open to any logged-in user; changing anything needs an administrator (require_admin). Every change is checked by
the manager, so the builder, the services and the web endpoints all follow the same rules.

Home Assistant 2026.10 builds these message schemas with `probatio`; older versions used `voluptuous`. Both have the same
Required / Optional markers, so whichever is installed is used.
"""

from __future__ import annotations

from typing import Any

try:
    import probatio as schema_lib
except ImportError:  # an older Home Assistant
    import voluptuous as schema_lib

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from . import bindings as bindings_lib
from .const import DOMAIN
from .manager import Manager

Required = schema_lib.Required


def _manager(hass: HomeAssistant) -> Manager:
    return hass.data[DOMAIN]["manager"]


def _fail(connection, msg: dict[str, Any], code: str, problems: list[str] | str) -> None:
    text = problems if isinstance(problems, str) else "; ".join(problems[:10])
    connection.send_error(msg["id"], code, text)


# ---------------------------------------------------------------- panes

@callback
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/panes/list"})
def ws_panes_list(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], {"panes": _manager(hass).list_panes()})


@callback
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/panes/get", Required("pane_id"): str})
def ws_panes_get(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    found = _manager(hass).get_pane(msg["pane_id"])
    if found is None:
        _fail(connection, msg, websocket_api.ERR_NOT_FOUND, f"there is no pane '{msg['pane_id']}'")
        return
    pane, source = found
    connection.send_result(msg["id"], {"pane": pane, "source": source})


@websocket_api.require_admin
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/panes/save", Required("pane"): dict})
@websocket_api.async_response
async def ws_panes_save(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    problems = await _manager(hass).save_pane(msg["pane"])
    if problems:
        _fail(connection, msg, websocket_api.ERR_INVALID_FORMAT, problems)
        return
    connection.send_result(msg["id"], {"panes": _manager(hass).list_panes()})


@websocket_api.require_admin
@websocket_api.websocket_command({
    Required("type"): f"{DOMAIN}/panes/create", Required("name"): str,
    schema_lib.Optional("description"): str, schema_lib.Optional("copy_from"): str,
})
@websocket_api.async_response
async def ws_panes_create(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """A new blank pane, or a copy of one (`copy_from`). Its id is made from the name and is permanent."""
    problems, pane = await _manager(hass).create_pane(msg["name"], msg.get("description", ""), msg.get("copy_from"))
    if problems:
        _fail(connection, msg, websocket_api.ERR_INVALID_FORMAT, problems)
        return
    connection.send_result(msg["id"], {"pane": pane, "panes": _manager(hass).list_panes()})


@websocket_api.require_admin
@websocket_api.websocket_command({
    Required("type"): f"{DOMAIN}/panes/update", Required("pane_id"): str,
    schema_lib.Optional("name"): str, schema_lib.Optional("description"): str,
})
@websocket_api.async_response
async def ws_panes_update(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Rename a pane or change its description; the id never changes."""
    problems = await _manager(hass).update_pane_details(msg["pane_id"], msg.get("name"), msg.get("description"))
    if problems:
        _fail(connection, msg, websocket_api.ERR_INVALID_FORMAT, problems)
        return
    connection.send_result(msg["id"], {"panes": _manager(hass).list_panes()})


@websocket_api.require_admin
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/panes/delete", Required("pane_id"): str})
@websocket_api.async_response
async def ws_panes_delete(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    problem = await _manager(hass).delete_pane(msg["pane_id"])
    if problem:
        _fail(connection, msg, websocket_api.ERR_NOT_ALLOWED, problem)
        return
    connection.send_result(msg["id"], {"panes": _manager(hass).list_panes()})


# ---------------------------------------------------------------- displays

@callback
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/displays/list"})
def ws_displays_list(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], {"displays": _manager(hass).list_displays()})


@websocket_api.require_admin
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/displays/save", Required("display"): dict})
@websocket_api.async_response
async def ws_displays_save(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    problems, display = await _manager(hass).save_display(msg["display"])
    if problems:
        _fail(connection, msg, websocket_api.ERR_INVALID_FORMAT, problems)
        return
    connection.send_result(msg["id"], {"display": display})


@websocket_api.require_admin
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/displays/delete", Required("display_id"): str})
@websocket_api.async_response
async def ws_displays_delete(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    if not await _manager(hass).delete_display(msg["display_id"]):
        _fail(connection, msg, websocket_api.ERR_NOT_FOUND, f"there is no display '{msg['display_id']}'")
        return
    connection.send_result(msg["id"], {"displays": _manager(hass).list_displays()})


@websocket_api.require_admin
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/displays/login/create", Required("display_id"): str})
@websocket_api.async_response
async def ws_login_create(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Make a login for a display and return its token ONCE. Websocket only: no service hands out tokens."""
    problem, result = await _manager(hass).create_display_login(msg["display_id"])
    if problem:
        _fail(connection, msg, websocket_api.ERR_NOT_FOUND, problem)
        return
    connection.send_result(msg["id"], {**result, "display": _manager(hass).get_display(msg["display_id"])})


@websocket_api.require_admin
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/displays/login/revoke", Required("display_id"): str})
@websocket_api.async_response
async def ws_login_revoke(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    problem = await _manager(hass).revoke_display_login(msg["display_id"])
    if problem:
        _fail(connection, msg, websocket_api.ERR_NOT_FOUND, problem)
        return
    connection.send_result(msg["id"], {"display": _manager(hass).get_display(msg["display_id"])})


# ---------------------------------------------------------------- a display's mirror (all administrators only)
# Home Assistant calls the mirror's control server for the builder (the browser never does, and never sees the key). A request that
# cannot be done (no such display, no mirror set up, a value out of range) is an error; a mirror that cannot be reached or says no is
# a normal result with ok false and a plain-language `error`, so the builder can show it on the card.

def _send_mirror(connection, msg: dict[str, Any], problem: str | None, result: dict[str, Any] | None) -> None:
    if problem:
        code = websocket_api.ERR_NOT_FOUND if problem.startswith("there is no display") else websocket_api.ERR_INVALID_FORMAT
        _fail(connection, msg, code, problem)
        return
    connection.send_result(msg["id"], result)


@websocket_api.require_admin
@websocket_api.websocket_command({
    Required("type"): f"{DOMAIN}/mirror/connect", Required("display_id"): str, Required("endpoint"): str,
    schema_lib.Optional("key"): str, schema_lib.Optional("clear_key"): bool,
})
@websocket_api.async_response
async def ws_mirror_connect(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Set the mirror's address (empty = disconnect) and optionally its key. The key is write-only: the reply says only `key_set`."""
    problem = await _manager(hass).mirror_connect(msg["display_id"], msg["endpoint"], msg.get("key"), bool(msg.get("clear_key")))
    if problem:
        _send_mirror(connection, msg, problem, None)
        return
    connection.send_result(msg["id"], {"display": _manager(hass).get_display(msg["display_id"])})


@websocket_api.require_admin
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/mirror/status", Required("display_id"): str})
@websocket_api.async_response
async def ws_mirror_status(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    _send_mirror(connection, msg, *await _manager(hass).mirror_status(msg["display_id"]))


@websocket_api.require_admin
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/mirror/presence", Required("display_id"): str, Required("enabled"): bool})
@websocket_api.async_response
async def ws_mirror_presence(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    _send_mirror(connection, msg, *await _manager(hass).mirror_set_presence(msg["display_id"], msg["enabled"]))


@websocket_api.require_admin
@websocket_api.websocket_command({
    Required("type"): f"{DOMAIN}/mirror/tune", Required("display_id"): str,
    schema_lib.Optional("scans"): int, schema_lib.Optional("vscans"): int, schema_lib.Optional("hold"): int,
    schema_lib.Optional("thr"): int, schema_lib.Optional("fps"): int, schema_lib.Optional("report"): int,
})
@websocket_api.async_response
async def ws_mirror_tune(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    values = {k: msg[k] for k in ("scans", "vscans", "hold", "thr", "fps", "report") if k in msg}
    _send_mirror(connection, msg, *await _manager(hass).mirror_tune(msg["display_id"], values))


@websocket_api.require_admin
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/mirror/brightness", Required("display_id"): str, Required("level"): int})
@websocket_api.async_response
async def ws_mirror_brightness(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    _send_mirror(connection, msg, *await _manager(hass).mirror_set_brightness(msg["display_id"], msg["level"]))


@websocket_api.require_admin
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/mirror/measure", Required("display_id"): str, Required("confirm"): bool})
@websocket_api.async_response
async def ws_mirror_measure(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Switch presence off for about 20 seconds, compare memory before and after, and always switch it back on. Needs confirm true."""
    _send_mirror(connection, msg, *await _manager(hass).mirror_measure(msg["display_id"], msg["confirm"]))


# ---------------------------------------------------------------- bindings and widgets

@callback
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/bindings/get"})
def ws_bindings_get(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], _manager(hass).bindings.data)


@websocket_api.require_admin
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/bindings/set", Required("bindings"): dict})
@websocket_api.async_response
async def ws_bindings_set(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    problems = await _manager(hass).bindings.async_set(bindings_lib.wrap(msg["bindings"]))
    if problems:
        _fail(connection, msg, websocket_api.ERR_INVALID_FORMAT, problems)
        return
    connection.send_result(msg["id"], _manager(hass).bindings.data)


@callback
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/widgets/list"})
def ws_widgets_list(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """The widget types and the entity slots each takes: what the builder's palette and entity picker are made from."""
    connection.send_result(msg["id"], {"widgets": _manager(hass).registry})


# ---------------------------------------------------------------- media

@callback
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/media/list"})
def ws_media_list(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], {"media": _manager(hass).list_media()})


@websocket_api.require_admin
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/media/add", Required("file_id"): str, schema_lib.Optional("name"): str})
@websocket_api.async_response
async def ws_media_add(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Take a file uploaded through /api/file_upload (the browser sends it there first) into the media library."""
    problem, record = await _manager(hass).add_media(msg["file_id"], msg.get("name"))
    if problem:
        _fail(connection, msg, websocket_api.ERR_INVALID_FORMAT, problem)
        return
    connection.send_result(msg["id"], {"media": record, "all": _manager(hass).list_media()})


@websocket_api.require_admin
@websocket_api.websocket_command({Required("type"): f"{DOMAIN}/media/delete", Required("media_id"): str})
@websocket_api.async_response
async def ws_media_delete(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    problem = await _manager(hass).delete_media(msg["media_id"])
    if problem:
        _fail(connection, msg, websocket_api.ERR_NOT_ALLOWED, problem)
        return
    connection.send_result(msg["id"], {"all": _manager(hass).list_media()})


COMMANDS = (
    ws_media_list, ws_media_add, ws_media_delete,
    ws_panes_list, ws_panes_get, ws_panes_save, ws_panes_create, ws_panes_update, ws_panes_delete,
    ws_displays_list, ws_displays_save, ws_displays_delete, ws_login_create, ws_login_revoke,
    ws_bindings_get, ws_bindings_set, ws_widgets_list,
    ws_mirror_connect, ws_mirror_status, ws_mirror_presence, ws_mirror_tune, ws_mirror_brightness, ws_mirror_measure,
)


def async_register_commands(hass: HomeAssistant) -> None:
    for command in COMMANDS:
        websocket_api.async_register_command(hass, command)
