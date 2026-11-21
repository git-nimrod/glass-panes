"""Two `time` entities for every display that has a mirror: when the screen's quiet hours start and end.

They only matter when the display's Screen mode is Auto (see screen_lib.py for the rules). Home Assistant's own time zone is used.
Setting the same time for both means no quiet hours. Defaults: 23:00 to 07:00.
"""

from __future__ import annotations

from datetime import time

from homeassistant.components.time import TimeEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .mirror_entities import ScheduleSetting, async_setup_controls
from .screen_lib import parse_time


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    await async_setup_controls(hass, entry, async_add_entities, "time", QuietStart.suffix, QuietStart)
    await async_setup_controls(hass, entry, async_add_entities, "time", QuietEnd.suffix, QuietEnd)


class _QuietTime(ScheduleSetting, TimeEntity):
    field = ""

    @property
    def native_value(self) -> time | None:
        return parse_time(self._setting(self.field))

    async def async_set_value(self, value: time) -> None:
        await self._schedule.async_update(self._display_id, **{self.field: value.strftime("%H:%M")})


class QuietStart(_QuietTime):
    suffix = "quiet_start"
    field = "quiet_start"
    _attr_name = "Screen quiet hours start"
    _attr_icon = "mdi:weather-night"


class QuietEnd(_QuietTime):
    suffix = "quiet_end"
    field = "quiet_end"
    _attr_name = "Screen quiet hours end"
    _attr_icon = "mdi:weather-sunny"
