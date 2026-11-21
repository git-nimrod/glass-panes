"""One `select` entity per display: its options are the panes, its state is the pane the display is showing.

Choosing an option (select.select_option, or an automation doing the same) makes the display switch panes, so every
native Home Assistant trigger already works for switching: a state change, a time, a presence sensor, a scene.
"""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import (
    DOMAIN,
    SIGNAL_DISPLAY_ADDED,
    SIGNAL_DISPLAY_REMOVED,
    SIGNAL_DISPLAY_UPDATED,
    SIGNAL_PANES_CHANGED,
)
from .manager import Manager
from .mirror_entities import ScheduleSetting, async_setup_controls
from .screen_lib import MODES


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    manager: Manager = hass.data[DOMAIN]["manager"]
    async_add_entities([DisplayPaneSelect(manager, display_id) for display_id in sorted(manager.display_store.displays)])

    @callback
    def display_added(display_id: str) -> None:
        async_add_entities([DisplayPaneSelect(manager, display_id)])

    @callback
    def display_removed(display_id: str) -> None:
        entities = er.async_get(hass)
        if entity_id := entities.async_get_entity_id("select", DOMAIN, f"{DOMAIN}_{display_id}"):
            entities.async_remove(entity_id)
        devices = dr.async_get(hass)
        if device := devices.async_get_device_by_identifier((DOMAIN, display_id), entry.entry_id):
            devices.async_remove_device(device.id)

    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_DISPLAY_ADDED, display_added))
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_DISPLAY_REMOVED, display_removed))
    await async_setup_controls(hass, entry, async_add_entities, "select", DisplayScreenMode.suffix, DisplayScreenMode)


class DisplayPaneSelect(SelectEntity):
    """The pane a display is showing."""

    _attr_has_entity_name = True
    _attr_name = None            # the entity takes the device's name, so it is select.glass_panes_<display>
    _attr_should_poll = False
    _attr_icon = "mdi:monitor-dashboard"

    def __init__(self, manager: Manager, display_id: str) -> None:
        self._manager = manager
        self._display_id = display_id
        self._attr_unique_id = f"{DOMAIN}_{display_id}"
        self._refresh()

    def _refresh(self) -> None:
        record = self._manager.display_store.displays.get(self._display_id)
        options = self._manager.pane_ids()
        preview = self._manager.preview_pane_id(self._display_id)      # a live "show on the mirror" preview takes over for a while
        pane = preview or (record["pane"] if record else None)
        if preview and preview not in options:
            options = [*options, preview]
        self._attr_options = options
        self._attr_current_option = pane if pane in options else None
        if record:
            self._attr_device_info = DeviceInfo(
                identifiers={(DOMAIN, self._display_id)},
                name=f"Glass Panes {record['name']}",
                manufacturer="Glass Panes",
                model="Display",
            )

    async def async_added_to_hass(self) -> None:
        @callback
        def display_updated(display_id: str) -> None:
            if display_id == self._display_id:
                self._changed()

        @callback
        def panes_changed() -> None:
            self._changed()

        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_DISPLAY_UPDATED, display_updated))
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_PANES_CHANGED, panes_changed))

    @callback
    def _changed(self) -> None:
        self._refresh()
        # keep the device's name in step if the display was renamed (unless the user renamed the device themselves)
        devices = dr.async_get(self.hass)
        entry_id = self.registry_entry.config_entry_id if self.registry_entry else None
        device = devices.async_get_device_by_identifier((DOMAIN, self._display_id), entry_id) if entry_id else None
        info = getattr(self, "_attr_device_info", None)
        if device and info and device.name != info.get("name"):
            devices.async_update_device(device.id, name=info["name"])
        self.async_write_ha_state()

    async def async_select_option(self, option: str) -> None:
        problem = await self._manager.set_display_pane(self._display_id, option)
        if problem:
            raise ServiceValidationError(problem)


class DisplayScreenMode(ScheduleSetting, SelectEntity):
    """How the screen of a display's mirror is run: Manual (the default, the schedule does nothing), Auto (off during quiet hours),
    On or Off (kept that way). Exists while the display has a mirror; the rules are in screen_lib.py."""

    suffix = "screen_mode"
    runs_schedule = True
    _attr_name = "Screen mode"
    _attr_icon = "mdi:monitor-shimmer"
    _attr_options = list(MODES)
    _attr_translation_key = "screen_mode"

    @property
    def current_option(self) -> str | None:
        return self._setting("mode")

    async def async_select_option(self, option: str) -> None:
        if option not in MODES:
            raise ServiceValidationError(f"Screen mode must be one of {', '.join(MODES)}")
        await self._schedule.async_update(self._display_id, mode=option)
