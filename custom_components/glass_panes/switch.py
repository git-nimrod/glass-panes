"""Switches for every display that has a mirror.

- Presence detection: the camera presence on the mirror (someone in front of it). On means the mirror is watching its camera for
  changes in light (numbers only, never pictures).
- Screen (mirror app 0.13.0 and later): the screen on or off. Off is Android's sleep, which mirror-android-2 and later make fully
  black. The CPU and network stay awake, so Home Assistant can switch it back on. Switching off needs a one-time step on the mirror
  (`adb shell dpm set-active-admin com.nimrod.mirrorkiosk/.ScreenAdmin`); without it the switch reports the mirror's plain-words reason.
  With an older app the switch is unavailable.

- Bluetooth proxy, Voice, Wake word (mirror app 0.13.0 and later): all OFF by default, and the
  mirror runs nothing for them until one is switched on. With Bluetooth proxy or Voice on, the mirror shows up in Home Assistant as
  an ESPHome device (Settings > Devices & services, "Discovered"); adding it there is what makes Home Assistant use it, and Home
  Assistant then hands the mirror an encryption key by itself. Voice works only after that (the switch's `voice_state` says what it
  waits for). Wake word listens on the mirror itself and needs Voice; a sign shows on the mirror's screen whenever its mic is open.
  With an older app these switches are unavailable.

The Screen switch works with the display's Screen mode (select) and quiet hours (two time entities), see screen_schedule.py. While the
mode is Always on or Always off, switching it the other way is refused with a plain reason.

Both follow the mirror's real state, so they change by themselves if something else changes it.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import mirror_lib
from .mirror_entities import MirrorControl, async_setup_controls


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    await async_setup_controls(hass, entry, async_add_entities, "switch", DisplayPresence.suffix, DisplayPresence)
    await async_setup_controls(hass, entry, async_add_entities, "switch", DisplayScreen.suffix, DisplayScreen)
    for cls in (DisplayBluetoothProxy, DisplayVoice, DisplayWakeWord):
        await async_setup_controls(hass, entry, async_add_entities, "switch", cls.suffix, cls)


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


class DisplayScreen(MirrorControl, SwitchEntity):
    suffix = "screen"
    _attr_name = "Screen"
    _attr_icon = "mdi:monitor"

    def _screen(self) -> dict[str, Any]:
        return (self._status or {}).get("screen") or {}

    @property
    def available(self) -> bool:
        # only a kiosk that lists "screen" in its capabilities (kiosk API, mirror_lib.kiosk_info) and reports the screen state
        return super().available and (self._status is None or (mirror_lib.can(self._status, "screen") and isinstance(self._screen().get("on"), bool)))

    @property
    def is_on(self) -> bool | None:
        on = self._screen().get("on")
        return on if isinstance(on, bool) else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        ready = self._screen().get("off_ready")
        return {"off_ready": ready} if isinstance(ready, bool) else {}

    async def async_update(self) -> None:
        await super().async_update()
        schedule = self._manager.screen_schedule
        # a Screen mode of Always on / Always off is put back here, from the read this switch makes anyway (no extra calls)
        if schedule is not None and await schedule.observe(self._display_id, self._status):
            await super().async_update()

    def _forced(self) -> str | None:
        schedule = self._manager.screen_schedule
        if schedule is None or not schedule.is_running(self._display_id):
            return None
        mode = schedule.settings(self._display_id)["mode"]
        return mode if mode in ("on", "off") else None

    async def _switch(self, on: bool) -> None:
        forced = self._forced()
        if forced is not None and (forced == "on") != on:
            raise HomeAssistantError(f"This display's Screen mode is Always {forced}. Set Screen mode to Manual or Auto to switch the screen yourself.")
        await self._command(lambda: self._manager.mirror_set_screen(self._display_id, on))

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._switch(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._switch(False)


class EsphomeFeature(MirrorControl, SwitchEntity):
    """One of the mirror's ESPHome-side features (Bluetooth proxy, voice, wake word): its state comes from /status `esphome`."""

    capability = ""             # the kiosk API name (schema/kiosk_api.json)
    field = ""                  # its on/off field in the `esphome` block

    def _esphome(self) -> dict[str, Any]:
        return (self._status or {}).get("esphome") or {}

    @property
    def available(self) -> bool:
        return super().available and (self._status is None or (mirror_lib.can(self._status, self.capability) and isinstance(self._esphome().get(self.field), bool)))

    @property
    def is_on(self) -> bool | None:
        on = self._esphome().get(self.field)
        return on if isinstance(on, bool) else None

    async def _switch(self, on: bool) -> None:
        await self._command(lambda: self._manager.mirror_set_esphome(self._display_id, self.capability, on))

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._switch(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._switch(False)


class DisplayBluetoothProxy(EsphomeFeature):
    suffix = "bluetooth_proxy"
    capability = "bluetooth_proxy"
    field = "bluetooth"
    _attr_name = "Bluetooth proxy"
    _attr_icon = "mdi:bluetooth"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        e = self._esphome()
        return {k: e[k] for k in ("ble_scanning", "advertisements_sent", "ha_connected") if e.get(k) is not None}


class DisplayVoice(EsphomeFeature):
    suffix = "voice"
    capability = "voice"
    field = "voice"
    _attr_name = "Voice"
    _attr_icon = "mdi:microphone-message"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        e = self._esphome()
        out = {k: e[k] for k in ("voice_state", "encrypted", "ha_connected", "mic_open", "turns") if e.get(k) is not None}
        if e.get("name"):
            out["esphome_name"] = e["name"]           # the name the mirror has in Home Assistant's ESPHome integration
        return out


class DisplayWakeWord(EsphomeFeature):
    suffix = "wake_word"
    capability = "wake_word"
    field = "wake_word"
    _attr_name = "Wake word"
    _attr_icon = "mdi:account-voice"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        e = self._esphome()
        w = e.get("wake") or {}
        out = {k: w[k] for k in ("phrase", "listening", "wakes") if w.get(k) is not None}
        if w.get("model_ms_per_s") is not None:
            out["cpu_ms_per_second"] = w["model_ms_per_s"]
        return out

    async def async_turn_on(self, **kwargs: Any) -> None:
        if self._esphome().get("voice") is False:
            raise HomeAssistantError("Switch this mirror's Voice on first: the wake word starts a voice conversation.")
        await super().async_turn_on(**kwargs)
