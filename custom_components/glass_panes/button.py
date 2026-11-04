"""One `button` entity per display and pane: pressing it makes that display show that pane.

The display's `select` already lets an automation choose a pane by its id. These buttons are the friendly version for
dashboards, voice assistants and scenes: each one is named after the pane (so it follows a rename), and its entity id is
fixed when it is created. The built-in panes' buttons start disabled so a fresh install does not add a screenful of
entities; switch them on in the entity settings. Buttons for panes you make yourself start enabled.
"""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN, SIGNAL_DISPLAY_ADDED, SIGNAL_DISPLAY_REMOVED, SIGNAL_DISPLAY_UPDATED, SIGNAL_PANES_CHANGED
from .manager import Manager


def button_unique_id(display_id: str, pane_id: str) -> str:
    return f"{DOMAIN}_{display_id}__{pane_id}"


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    manager: Manager = hass.data[DOMAIN]["manager"]
    made: set[str] = set()                        # unique ids of the buttons added so far

    @callback
    def add_missing() -> None:
        new = []
        for display_id in sorted(manager.display_store.displays):
            for pane_id in manager.pane_ids():
                unique_id = button_unique_id(display_id, pane_id)
                if unique_id not in made:
                    made.add(unique_id)
                    new.append(PaneButton(manager, display_id, pane_id))
        if new:
            async_add_entities(new)

    @callback
    def remove_stale() -> None:
        """Remove the buttons of panes that no longer exist (the entity removes itself when its registry entry goes)."""
        registry = er.async_get(hass)
        live = {button_unique_id(d, p) for d in manager.display_store.displays for p in manager.pane_ids()}
        for reg in er.async_entries_for_config_entry(registry, entry.entry_id):
            if reg.domain == "button" and reg.unique_id.startswith(f"{DOMAIN}_") and reg.unique_id not in live:
                registry.async_remove(reg.entity_id)
        made.intersection_update(live)

    @callback
    def panes_changed() -> None:
        remove_stale()
        add_missing()

    @callback
    def display_changed(_display_id: str) -> None:
        panes_changed()

    add_missing()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_PANES_CHANGED, panes_changed))
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_DISPLAY_ADDED, display_changed))
    # forget a removed display's buttons so the same display can be added again later
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_DISPLAY_REMOVED, display_changed))


class PaneButton(ButtonEntity):
    """Show one pane on one display."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_icon = "mdi:image-frame"

    def __init__(self, manager: Manager, display_id: str, pane_id: str) -> None:
        self._manager = manager
        self._display_id = display_id
        self._pane_id = pane_id
        self._attr_unique_id = button_unique_id(display_id, pane_id)
        # a fixed name for the entity id; the visible name follows the pane (see `name`)
        found = manager.get_pane(pane_id)
        self._attr_entity_registry_enabled_default = pane_id not in manager.shipped
        self._first_name = found[0]["name"] if found else pane_id
        self._set_device()

    def _set_device(self) -> None:
        record = self._manager.display_store.displays.get(self._display_id)
        if record:
            self._attr_device_info = DeviceInfo(
                identifiers={(DOMAIN, self._display_id)}, name=f"Glass Panes {record['name']}",
                manufacturer="Glass Panes", model="Display",
            )

    @property
    def name(self) -> str:
        found = self._manager.get_pane(self._pane_id)
        return found[0]["name"] if found else self._first_name

    async def async_added_to_hass(self) -> None:
        @callback
        def changed(*_args: str) -> None:
            self.async_write_ha_state()

        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_PANES_CHANGED, changed))
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_DISPLAY_UPDATED, changed))

    async def async_press(self) -> None:
        problem = await self._manager.set_display_pane(self._display_id, self._pane_id)
        if problem:
            raise ServiceValidationError(problem)
