"""A presence `switch` for every display that has a mirror: the camera presence on the mirror (someone in front of it).

On means the mirror is watching its camera for changes in light (numbers only, never pictures). It follows the mirror's real setting, so
it changes by itself if someone flips presence in the Settings page or on the mirror.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .mirror_entities import MirrorControl, async_setup_controls


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    await async_setup_controls(hass, entry, async_add_entities, "switch", DisplayPresence.suffix, DisplayPresence)


class DisplayPresence(MirrorControl, SwitchEntity):
    suffix = "presence"
    _attr_name = "Presence detection"
    _attr_icon = "mdi:motion-sensor"

    @property
    def is_on(self) -> bool | None:
        enabled = ((self._status or {}).get("presence") or {}).get("settings", {}).get("enabled")
        return enabled if isinstance(enabled, bool) else None

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._command(lambda: self._manager.mirror_set_presence(self._display_id, True))

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._command(lambda: self._manager.mirror_set_presence(self._display_id, False))
