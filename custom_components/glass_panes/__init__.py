"""Glass Panes: show designed panes on any display, switched by Home Assistant state.

What this sets up:
- the player, the shipped panes and the schemas as web files (no login: they hold no entities or secrets)
- a store for panes saved from the builder, for displays, and for entity bindings (the last behind a login)
- one `select` entity per display whose state is the pane it is showing
- a login-protected web API, a websocket API and services for all of the above
The sidebar builder and the display services that talk to a kiosk app come later.
"""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import llm
from homeassistant.loader import async_get_integration

from . import api, ws_api
from .assets import AssetsView
from .const import DOMAIN, LOGGER
from .llm_api import GlassPanesAPI
from .manager import Manager, remove_login_user
from .panes import PaneChecker, load_shipped
from .services import async_register_services, async_remove_services
from .storage import BindingsStore, DisplayStore, DraftStore, MediaStore, PaneStore

PLATFORMS = [Platform.SELECT, Platform.BUTTON, Platform.MEDIA_PLAYER]

# The folders handed out over the web (without a login) are listed, with the reasons, in assets.py.

# The sidebar builder: a custom element served from the panel folder, shown to administrators only.
PANEL_URL_PATH = "glass-panes"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Glass Panes after it is added from Settings > Devices & services."""
    data = hass.data.setdefault(DOMAIN, {})
    base = Path(__file__).parent

    if not data.get("static_registered"):
        # served by our own view (assets.py) so every file carries "Cache-Control: no-cache": a browser or the kiosk app then
        # re-checks it on each load and picks up an update straight away, instead of guessing how long to keep an old copy
        hass.http.register_view(AssetsView(hass, base))
        # a view cannot be un-registered, so do it once per Home Assistant run even if the entry is reloaded
        data["static_registered"] = True

    # The shipped panes are read from disk on every setup (not just the first), so reloading the integration after an update
    # picks up changed panes without a Home Assistant restart. Reading touches the disk, so it happens off the event loop.
    shipped, pane_schema, registry, problems = await hass.async_add_executor_job(load_shipped, base)
    for problem in problems:
        LOGGER.warning("A shipped pane was left out: %s", problem)
    checker = PaneChecker(pane_schema)

    if "manager" not in data:
        bindings = BindingsStore(hass)
        await bindings.async_load()
        pane_store = PaneStore(hass)
        await pane_store.async_load(checker.check)
        display_store = DisplayStore(hass)
        await display_store.async_load()
        media_store = MediaStore(hass)
        await media_store.async_load()
        draft_store = DraftStore(hass)
        await draft_store.async_load(checker.check)

        manager = Manager(hass, shipped, checker, registry, bindings, pane_store, display_store, media_store, draft_store)
        manager.pane_schema = pane_schema
        data["manager"] = manager
        # views and websocket commands cannot be removed once added, so this happens once per Home Assistant run
        for view in api.views(manager):
            hass.http.register_view(view)
        ws_api.async_register_commands(hass)
    else:
        data["manager"].refresh_shipped(shipped, checker, registry)
        data["manager"].pane_schema = pane_schema

    await data["manager"].async_repair_displays()
    if "unregister_llm_api" not in data:
        data["unregister_llm_api"] = llm.async_register_api(hass, GlassPanesAPI(hass))
    async_register_services(hass, data["manager"])

    # A panel cannot be registered twice, so it is removed again on unload (see async_unload_entry).
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name="glass-panes-panel",
        sidebar_title="Glass Panes",
        sidebar_icon="mdi:monitor-dashboard",
        # the version in the address makes a browser fetch the new panel after each update, whatever it has stored
        module_url=f"/{DOMAIN}/panel/glass-panes-panel.js?v={(await async_get_integration(hass, DOMAIN)).version}",
        require_admin=True,
    )
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    LOGGER.info("Glass Panes loaded; player at /%s/player/index.html (entry %s)", DOMAIN, entry.entry_id)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload Glass Panes. The web paths, endpoints and websocket commands stay registered until Home Assistant restarts."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
        async_remove_services(hass)
        unregister = hass.data.get(DOMAIN, {}).pop("unregister_llm_api", None)
        if unregister is not None:
            unregister()
        LOGGER.info("Glass Panes unloaded (entry %s)", entry.entry_id)
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """The owner pressed Delete on the integration. Revoke every display login; keep panes, displays, bindings and uploads.

    Home Assistant calls this after the entry has been unloaded, so the manager may be gone (for example when Home Assistant
    was restarted with the entry disabled). It is used if it is still around, otherwise the displays are read straight from
    storage. The display list itself is kept (only the login ids are cleared), so adding the integration again restores
    everything except the logins, which the owner makes again with "Set up login".
    """
    manager = hass.data.get(DOMAIN, {}).get("manager")
    store = manager.display_store if manager is not None else DisplayStore(hass)
    if manager is None:
        await store.async_load()
    revoked = 0
    for display_id, record in store.displays.items():
        if not record.get("login_user_id"):
            continue
        try:
            await remove_login_user(hass, record)
            revoked += 1
        except Exception:  # noqa: BLE001  one stuck user must not stop the others (or the removal)
            LOGGER.exception("Could not remove the login of display %s", display_id)
    if revoked:
        await store.async_save()
    LOGGER.info("Glass Panes removed (entry %s): %d display login(s) revoked; panes, displays and uploads kept", entry.entry_id, revoked)
