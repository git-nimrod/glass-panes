"""A brightness `number` (0 to 100 %) for every display that has a mirror: the backlight the mirror is set to right now.

Setting it does what the Settings page's brightness slider does. The mirror reports -1 when Android is in charge of the backlight
(nothing has been set); the number then shows as unknown until a value is set. Note: on the tested mirror Android refuses a backlight
below about 4 % (10 of 255), so 0 means "as dark as the panel goes", not "off" (see the plan for the screen switch).
"""

from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .manager import Manager
from .mirror_entities import MirrorControl, async_setup_controls


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    await async_setup_controls(hass, entry, async_add_entities, "number", DisplayBrightness.suffix, DisplayBrightness)


class DisplayBrightness(MirrorControl, NumberEntity):
    suffix = "brightness"
    _attr_name = "Brightness"
    _attr_icon = "mdi:brightness-6"
    _attr_native_min_value = 0
    _attr_native_max_value = 100
    _attr_native_step = 1
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_mode = NumberMode.SLIDER

    def __init__(self, manager: Manager, display_id: str) -> None:
        super().__init__(manager, display_id)

    @property
    def native_value(self) -> float | None:
        value = (self._status or {}).get("brightness")
        return float(value) if isinstance(value, (int, float)) and 0 <= value <= 100 else None

    async def async_set_native_value(self, value: float) -> None:
        await self._command(lambda: self._manager.mirror_set_brightness(self._display_id, int(round(value))))
