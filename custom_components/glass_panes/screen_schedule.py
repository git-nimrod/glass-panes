"""The screen schedule: a mode (Manual, Auto, On, Off) and quiet hours per display that has a mirror.

The rules are in screen_lib.py; this file is the Home Assistant side. Kept in config/.storage/glass_panes.screen.

- Nothing runs for a display until its "Screen mode" entity exists (the mirror is connected) and is enabled.
- Auto uses Home Assistant's own time triggers (async_track_time_change) at the start and the end of quiet hours: two timers per
  display, no polling and nothing on the mirror.
- On and Off are put back when the regular status read (the one the Screen switch already makes every 30 seconds) shows the
  mirror in the other state, so they cost no extra calls.
- The default is Manual: a new display gets no schedule until the person picks one.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from . import screen_lib
from .const import DOMAIN, LOGGER

STORE_KEY = f"{DOMAIN}.screen"
SIGNAL_SCREEN_SETTINGS = f"{DOMAIN}_screen_settings"      # argument: the display id


class ScreenSchedule:
    def __init__(self, hass: HomeAssistant, set_screen: Callable[[str, bool], Any]) -> None:
        self.hass = hass
        self._set_screen = set_screen                       # Manager.mirror_set_screen
        self._store: Store[dict[str, Any]] = Store(hass, screen_lib.SCHEMA_VERSION, STORE_KEY)
        self._settings: dict[str, dict[str, Any]] = {}
        self._timers: dict[str, list[CALLBACK_TYPE]] = {}

    async def async_load(self) -> None:
        stored = await self._store.async_load()
        displays = stored.get("displays") if isinstance(stored, dict) else None
        if isinstance(displays, dict):
            self._settings = {str(k): screen_lib.clean_settings(v) for k, v in displays.items()}

    def settings(self, display_id: str) -> dict[str, Any]:
        return dict(self._settings.get(display_id) or screen_lib.default_settings())

    def is_running(self, display_id: str) -> bool:
        return display_id in self._timers

    async def async_update(self, display_id: str, **changes: Any) -> dict[str, Any]:
        """Change the mode or a time, save, re-arm the timers and bring the screen into line once."""
        merged = {**self.settings(display_id), **{k: v for k, v in changes.items() if v is not None}}
        if "quiet_start" in changes or "quiet_end" in changes:
            for field in ("quiet_start", "quiet_end"):
                parsed = screen_lib.parse_time(merged[field])
                merged[field] = parsed.strftime("%H:%M") if parsed else merged[field]
        clean = screen_lib.clean_settings(merged)
        self._settings[display_id] = clean
        await self._store.async_save({"displays": self._settings})
        if self.is_running(display_id):
            self._arm(display_id)
            await self._apply(display_id, screen_lib.wanted(clean, dt_util.now().time()))
        async_dispatcher_send(self.hass, SIGNAL_SCREEN_SETTINGS, display_id)
        return clean

    async def async_forget(self, display_id: str) -> None:
        """The display was deleted: drop its settings too."""
        self.stop(display_id)
        if self._settings.pop(display_id, None) is not None:
            await self._store.async_save({"displays": self._settings})

    @callback
    def start(self, display_id: str) -> None:
        """Called when the display's Screen mode entity is added: arm the timers and settle the screen once."""
        self._arm(display_id)
        settings = self.settings(display_id)
        want = screen_lib.wanted(settings, dt_util.now().time())
        # after a restart, Auto only acts if it is quiet time now (outside quiet hours a person may have their own reasons)
        if settings["mode"] == "auto" and want is True:
            want = None
        if want is not None:
            self.hass.async_create_task(self._apply(display_id, want))

    @callback
    def stop(self, display_id: str) -> None:
        for cancel in self._timers.pop(display_id, []):
            cancel()

    @callback
    def _arm(self, display_id: str) -> None:
        for cancel in self._timers.pop(display_id, []):
            cancel()
        self._timers[display_id] = []
        settings = self.settings(display_id)
        if settings["mode"] != "auto":
            return
        start, end = screen_lib.parse_time(settings["quiet_start"]), screen_lib.parse_time(settings["quiet_end"])
        if start is None or end is None or start == end:
            return

        async def at_start(_now: datetime) -> None:
            if self.settings(display_id)["mode"] == "auto":
                await self._apply(display_id, False)

        async def at_end(_now: datetime) -> None:
            if self.settings(display_id)["mode"] == "auto":
                await self._apply(display_id, True)

        self._timers[display_id] = [
            async_track_time_change(self.hass, at_start, hour=start.hour, minute=start.minute, second=0),
            async_track_time_change(self.hass, at_end, hour=end.hour, minute=end.minute, second=0),
        ]

    async def observe(self, display_id: str, status: dict[str, Any] | None) -> bool:
        """Given a fresh status read: put a forced On or Off back if the mirror is in the other state. True if it sent something."""
        if not self.is_running(display_id) or not status:
            return False
        want = screen_lib.needs_putting_back(self.settings(display_id), (status.get("screen") or {}).get("on"))
        return want is not None and await self._apply(display_id, want)

    async def _apply(self, display_id: str, on: bool | None) -> bool:
        if on is None:
            return False
        problem, result = await self._set_screen(display_id, on)
        if not problem and (result or {}).get("ok"):
            return True
        # the reason is plain words from the mirror or the manager (never the address or the key)
        LOGGER.warning("Screen schedule for display %s could not switch the screen %s: %s", display_id, "on" if on else "off",
                       problem or (result or {}).get("error") or "no answer")
        return False
