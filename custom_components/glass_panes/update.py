"""One `update` entity per display that has a mirror: "Mirror app", the Mirror Kiosk version on the mirror against the newest release.

It shows up where Home Assistant shows every update (Settings > Updates, and on the display's device page). Pressing Install makes
Home Assistant download the release's APK from GitHub, check its SHA-256 and release certificate, and send it to the mirror, which
installs it itself and restarts (Manager.mirror_install_app). Nothing is installed unless someone presses Install or calls
`update.install`: there is no automatic updating.

A mirror can only install by itself when the app is built into its Android image (mirror-android-3 and later; the mirror lists
`app_update` in its capabilities). On older images the entity still says a newer version exists, offers no Install button, and its
summary says to install with adb.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.update import UpdateEntity, UpdateEntityFeature
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import app_update_lib, mirror_lib
from .mirror_entities import MirrorControl, async_setup_controls


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    await async_setup_controls(hass, entry, async_add_entities, "update", DisplayAppUpdate.suffix, DisplayAppUpdate)


class DisplayAppUpdate(MirrorControl, UpdateEntity):
    suffix = "app_update"
    _attr_name = "Mirror app"
    _attr_title = "Mirror Kiosk app"
    _attr_icon = "mdi:cellphone-arrow-down"

    _release: dict[str, Any] | None = None

    async def async_update(self) -> None:
        await super().async_update()
        self._release = await self._manager.app_updater.latest()

    def _can_install(self) -> bool:
        return mirror_lib.can(self._status, "app_update")

    @property
    def supported_features(self) -> UpdateEntityFeature:
        if self._can_install():
            return UpdateEntityFeature.INSTALL | UpdateEntityFeature.PROGRESS
        return UpdateEntityFeature(0)

    @property
    def installed_version(self) -> str | None:
        version = (self._status or {}).get("version")
        return version if app_update_lib.version_tuple(version) else None

    @property
    def latest_version(self) -> str | None:
        if self._release is None:
            return self.installed_version             # nothing known to be newer
        if self.installed_version and not app_update_lib.is_newer(self._release["version"], self.installed_version):
            return self.installed_version             # a mirror running a newer test build is not offered a "downgrade"
        return self._release["version"]

    @property
    def release_url(self) -> str | None:
        return (self._release or {}).get("notes_url")

    @property
    def release_summary(self) -> str | None:
        if not app_update_lib.is_newer(self.latest_version, self.installed_version):
            return None
        return app_update_lib.release_summary(self._can_install(), self.installed_version, self._release)

    async def async_install(self, version: str | None, backup: bool, **kwargs: Any) -> None:
        if version is not None and self._release is not None and version != self._release["version"]:
            raise HomeAssistantError(f"Only the newest release ({self._release['version']}) can be installed.")

        def progress(percent: int) -> None:
            self._attr_update_percentage = percent
            self.async_write_ha_state()

        self._attr_in_progress = True
        self._attr_update_percentage = 0
        self.async_write_ha_state()
        try:
            problem, result = await self._manager.mirror_install_app(self._display_id, progress)
        finally:
            self._attr_in_progress = False
            self._attr_update_percentage = None
        if problem:
            raise HomeAssistantError(problem)
        if not result or not result.get("ok"):
            await self.async_update()
            self.async_write_ha_state()
            raise HomeAssistantError((result or {}).get("error") or "The update did not go through.")
        await self.async_update()
        self.async_write_ha_state()
