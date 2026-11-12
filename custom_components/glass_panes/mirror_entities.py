"""Shared plumbing for the controls Home Assistant gets for a display that has a mirror: a brightness `number`, a presence `switch`.

They come and go with the mirror address (set it and they appear, clear it and they are removed), like the speaker. They read the
mirror's /status every POLL_EVERY (30 seconds), ONE shared read per display (see Manager.mirror_status_cached), so the state shown is
real, not what Home Assistant last asked for. Setting a control calls the same manager methods as the builder's Settings page, so the
same ranges and the same key handling apply. Until the first read (up to half a minute after setup) a control shows an unknown value (and still takes commands); if that read fails it becomes unavailable.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_track_time_interval

from .const import DOMAIN, SIGNAL_DISPLAY_ADDED, SIGNAL_DISPLAY_REMOVED, SIGNAL_DISPLAY_UPDATED
from .manager import Manager

POLL_EVERY = timedelta(seconds=30)          # /status makes the mirror measure its memory, so it is not asked often (the app is short of RAM and CPU)


def unique_id(display_id: str, suffix: str) -> str:
    return f"{DOMAIN}_{display_id}_{suffix}"


class MirrorControl(Entity):
    """Base of the controls: one display's mirror, polled through the shared status read."""

    _attr_has_entity_name = True
    _attr_should_poll = False                 # its own timer, so it stops the moment the entity is removed (see media_player.py)
    suffix = ""

    def __init__(self, manager: Manager, display_id: str) -> None:
        self._manager = manager
        self._display_id = display_id
        self._status: dict[str, Any] | None = None
        self._attr_unique_id = unique_id(display_id, self.suffix)
        self._attr_available = True               # until the first read says otherwise: a control that is not yet read still takes commands
        record = manager.display_store.displays.get(display_id)
        if record:
            self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, display_id)}, name=f"Glass Panes {record['name']}", manufacturer="Glass Panes", model="Display")

    async def async_added_to_hass(self) -> None:
        async def poll(_now) -> None:
            await self.async_update()
            self.async_write_ha_state()

        self.async_on_remove(async_track_time_interval(self.hass, poll, POLL_EVERY, cancel_on_shutdown=True))

    async def async_update(self) -> None:
        problem, result = await self._manager.mirror_status_cached(self._display_id)
        ok = problem is None and bool(result) and result.get("ok") is True
        self._attr_available = ok
        self._status = result if ok else None

    async def _command(self, run: Callable[[], Any]) -> None:
        """Run one manager call, turn a refusal into an error the person sees, and read the mirror again."""
        problem, result = await run()
        if problem:
            raise HomeAssistantError(problem)
        if not result or not result.get("ok"):
            raise HomeAssistantError((result or {}).get("error") or "The mirror did not accept that.")
        await self.async_update()
        self.async_write_ha_state()


async def async_setup_controls(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback, platform: str, suffix: str,
    factory: Callable[[Manager, str], MirrorControl],
) -> None:
    """Create one control per display that has a mirror, keep that true as displays change, and remove it with the mirror."""
    manager: Manager = hass.data[DOMAIN]["manager"]
    created: set[str] = set()

    def has_mirror(display_id: str) -> bool:
        record = manager.display_store.displays.get(display_id)
        return bool(record and record.get("endpoint"))

    @callback
    def remove_entity(display_id: str) -> None:
        created.discard(display_id)
        registry = er.async_get(hass)
        if entity_id := registry.async_get_entity_id(platform, DOMAIN, unique_id(display_id, suffix)):
            registry.async_remove(entity_id)

    @callback
    def display_changed(display_id: str) -> None:
        if has_mirror(display_id) and display_id not in created:
            created.add(display_id)
            async_add_entities([factory(manager, display_id)])              # no read before adding: the first poll comes with the timer
        elif not has_mirror(display_id) and display_id in created:
            remove_entity(display_id)

    @callback
    def display_removed(display_id: str) -> None:
        remove_entity(display_id)

    for display_id in sorted(manager.display_store.displays):
        display_changed(display_id)
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_DISPLAY_ADDED, display_changed))
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_DISPLAY_UPDATED, display_changed))
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_DISPLAY_REMOVED, display_removed))
