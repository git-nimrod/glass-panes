"""One `media_player` entity per display that has a mirror: the mirror's own speaker.

It lets anything that can play to a Home Assistant media player use the mirror as a speaker: automations and scripts
(`media_player.play_media`), the media controls on a dashboard, and Music Assistant (which can play to Home Assistant media players,
and brings Spotify, Plex and the rest with it). The Mirror Kiosk app does the playing (see mirror-app/.../AudioPlayer.kt) and is
asked over the same local connection as the other mirror controls, so the display needs its mirror address set up first.

It only plays audio from http and https addresses. Home Assistant's own media (a media-source id, or an address on Home Assistant)
is turned into an address the mirror can open before it is sent.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta
from typing import Any

from homeassistant.components.media_player import (
    MediaPlayerDeviceClass,
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerState,
    MediaType,
)
from homeassistant.components.media_player.browse_media import async_process_play_media_url
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import HomeAssistant, State, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util

from .const import DOMAIN, SIGNAL_DISPLAY_ADDED, SIGNAL_DISPLAY_REMOVED, SIGNAL_DISPLAY_UPDATED
from .manager import Manager

POLL_EVERY = timedelta(seconds=10)             # a short local call; the mirror answers in milliseconds
SETTLE_S = 0.6                                 # after a command, give the app a moment to change state before asking again

_STATES = {"playing": MediaPlayerState.PLAYING, "paused": MediaPlayerState.PAUSED, "buffering": MediaPlayerState.BUFFERING}
_NOT_AUDIO = ("video", "image", "tvshow", "movie", "channel")


def unique_id(display_id: str) -> str:
    return f"{DOMAIN}_{display_id}_audio"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    manager: Manager = hass.data[DOMAIN]["manager"]
    created: set[str] = set()

    def has_mirror(display_id: str) -> bool:
        record = manager.display_store.displays.get(display_id)
        return bool(record and record.get("endpoint"))

    @callback
    def remove_entity(display_id: str) -> None:
        created.discard(display_id)
        registry = er.async_get(hass)
        if entity_id := registry.async_get_entity_id("media_player", DOMAIN, unique_id(display_id)):
            registry.async_remove(entity_id)

    @callback
    def display_changed(display_id: str) -> None:
        if has_mirror(display_id) and display_id not in created:
            created.add(display_id)
            async_add_entities([DisplayAudio(manager, display_id)], update_before_add=True)
        elif not has_mirror(display_id) and display_id in created:
            remove_entity(display_id)                  # the mirror was disconnected: the speaker goes with it

    @callback
    def display_removed(display_id: str) -> None:
        remove_entity(display_id)

    for display_id in sorted(manager.display_store.displays):
        display_changed(display_id)
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_DISPLAY_ADDED, display_changed))
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_DISPLAY_UPDATED, display_changed))
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_DISPLAY_REMOVED, display_removed))


class DisplayAudio(MediaPlayerEntity):
    """The speaker of one display's mirror."""

    _attr_has_entity_name = True
    _attr_name = "Speaker"
    # Its own timer instead of Home Assistant's polling: the speaker comes and goes with the mirror address, and a timer owned by the
    # entity stops the moment it is removed (Home Assistant's shared polling timer outlives a removed entity until the integration unloads).
    _attr_should_poll = False
    _attr_icon = "mdi:speaker"
    _attr_device_class = MediaPlayerDeviceClass.SPEAKER
    _attr_media_content_type = MediaType.MUSIC
    _attr_supported_features = (
        MediaPlayerEntityFeature.PLAY_MEDIA | MediaPlayerEntityFeature.PLAY | MediaPlayerEntityFeature.PAUSE
        | MediaPlayerEntityFeature.STOP | MediaPlayerEntityFeature.VOLUME_SET | MediaPlayerEntityFeature.SEEK
    )

    def __init__(self, manager: Manager, display_id: str) -> None:
        self._manager = manager
        self._display_id = display_id
        self._audio: dict[str, Any] | None = None
        self._attr_unique_id = unique_id(display_id)
        self._attr_available = False
        record = manager.display_store.displays.get(display_id)
        if record:
            self._attr_device_info = DeviceInfo(
                identifiers={(DOMAIN, display_id)}, name=f"Glass Panes {record['name']}", manufacturer="Glass Panes", model="Display",
            )

    # ------------------------------------------------------------------ what it reports

    @property
    def state(self) -> MediaPlayerState | None:
        if self._audio is None:
            return None
        return _STATES.get(self._audio["state"], MediaPlayerState.IDLE)

    @property
    def volume_level(self) -> float | None:
        volume = self._audio and self._audio.get("volume")
        return volume / 100 if volume is not None else None

    # The mirror is only handed a bare stream address by Music Assistant, so it cannot name the song. Music Assistant's own copy of this
    # speaker (a media_player of the music_assistant integration) does know: it names this speaker as its `active_queue`. While the mirror is
    # playing or paused and has no song details of its own, the title, artist, album, cover and length are borrowed from that copy.
    def _mass(self) -> State | None:
        if self.hass is None or not self.entity_id or self._audio is None or self._audio["state"] not in ("playing", "paused"):
            return None
        for other in self.hass.states.async_all("media_player"):
            attrs = other.attributes
            if attrs.get("app_id") == "music_assistant" and attrs.get("active_queue") == self.entity_id and other.state not in ("idle", "off", "unavailable"):
                return other
        return None

    def _borrowed(self, key: str) -> Any:
        other = self._mass()
        return other.attributes.get(key) if other is not None else None

    @property
    def media_title(self) -> str | None:
        if self._audio and self._audio["state"] != "idle" and self._audio.get("title"):
            return self._audio["title"]
        return self._borrowed("media_title")

    @property
    def media_artist(self) -> str | None:
        if self._audio and self._audio["state"] != "idle" and self._audio.get("artist"):
            return self._audio["artist"]
        return self._borrowed("media_artist")

    @property
    def media_album_name(self) -> str | None:
        return self._borrowed("media_album_name")

    @property
    def media_image_url(self) -> str | None:
        url = self._borrowed("entity_picture")
        return url if isinstance(url, str) and url.startswith(("http://", "https://")) else None

    @property
    def media_duration(self) -> int | None:
        if self._audio and self._audio["state"] in ("playing", "paused") and (self._audio.get("duration_s") or -1) > 0:
            return self._audio["duration_s"]
        duration = self._borrowed("media_duration")
        return int(duration) if isinstance(duration, (int, float)) and duration > 0 else None

    @property
    def media_position(self) -> int | None:
        return self._audio.get("position_s") if self._audio and self._audio["state"] in ("playing", "paused") else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"error": self._audio["error"]} if self._audio and self._audio.get("error") else {}

    async def async_added_to_hass(self) -> None:
        async def poll(_now) -> None:
            await self.async_update()
            self.async_write_ha_state()

        self.async_on_remove(async_track_time_interval(self.hass, poll, POLL_EVERY, cancel_on_shutdown=True))

        @callback
        def only_media_players(data: Any) -> bool:
            return str(data.get("entity_id", "")).startswith("media_player.")

        def names_this_speaker(state: Any) -> bool:
            return state is not None and state.attributes.get("app_id") == "music_assistant" and state.attributes.get("active_queue") == self.entity_id

        @callback
        def copy_changed(event: Any) -> None:
            # a new song, or the copy no longer naming this speaker: show it now, not at the next poll
            if names_this_speaker(event.data.get("new_state")) or names_this_speaker(event.data.get("old_state")):
                self.async_write_ha_state()

        self.async_on_remove(self.hass.bus.async_listen(EVENT_STATE_CHANGED, copy_changed, event_filter=only_media_players))

    async def async_update(self) -> None:
        problem, result = await self._manager.mirror_audio(self._display_id, "status")
        audio = result.get("audio") if result and result.get("ok") else None
        self._attr_available = problem is None and audio is not None
        self._audio = audio
        if audio is not None:
            self._attr_media_position_updated_at = dt_util.utcnow()

    # ------------------------------------------------------------------ what it can be told to do

    async def _send(self, action: str, params: dict[str, Any] | None = None) -> None:
        problem, result = await self._manager.mirror_audio(self._display_id, action, params)
        if problem:
            raise HomeAssistantError(problem)
        if not result or not result.get("ok"):
            raise HomeAssistantError((result or {}).get("error") or "The mirror did not accept that.")
        await asyncio.sleep(SETTLE_S)
        await self.async_update()
        self.async_write_ha_state()

    async def async_media_play(self) -> None:
        await self._send("resume")

    async def async_media_pause(self) -> None:
        await self._send("pause")

    async def async_media_stop(self) -> None:
        await self._send("stop")

    async def async_set_volume_level(self, volume: float) -> None:
        await self._send("volume", {"v": round(min(max(volume, 0), 1) * 100)})

    async def async_media_seek(self, position: float) -> None:
        await self._send("seek", {"s": max(position, 0)})

    async def async_play_media(self, media_type: str, media_id: str, **kwargs: Any) -> None:
        if str(media_type or "").lower().startswith(_NOT_AUDIO):
            raise ServiceValidationError("The mirror's speaker plays audio only.")
        url = media_id
        if str(media_id).startswith("media-source://"):
            from homeassistant.components import media_source

            try:
                resolved = await media_source.async_resolve_media(self.hass, media_id, target_media_player=self.entity_id)
            except media_source.Unresolvable as err:
                raise ServiceValidationError(f"That media could not be opened: {err}") from err
            if not str(resolved.mime_type or "audio").startswith("audio"):
                raise ServiceValidationError("The mirror's speaker plays audio only.")
            url = resolved.url
        url = async_process_play_media_url(self.hass, url)            # an address the mirror can open (signed when it points at Home Assistant)
        if not url.lower().startswith(("http://", "https://")):
            raise ServiceValidationError("Only http and https addresses can be played.")
        extra = kwargs.get("extra") if isinstance(kwargs.get("extra"), dict) else {}
        params: dict[str, Any] = {"url": url}
        for field in ("title", "artist"):
            if isinstance(extra.get(field), str) and extra[field]:
                params[field] = extra[field][:120]
        await self._send("play", params)
