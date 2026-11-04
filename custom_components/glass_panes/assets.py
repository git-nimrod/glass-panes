"""Serves the player, panel, shipped panes and schemas from /glass_panes/<folder>/<file>.

Home Assistant's own static file serving has no way to say "always re-check this file", so browsers guess how long to keep a
copy and can keep running an old panel or player for days after an update. These files are served with `Cache-Control: no-cache`
instead: the browser keeps its copy but asks every time whether it changed (a cheap "not modified" answer when it did not), so
an update shows up on the next page load.

Like before, these are served without a login, so only layouts and code may live in these folders, never entities or secrets.
"""

from __future__ import annotations

from pathlib import Path

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import DOMAIN

STATIC_FOLDERS = ("player", "panes", "schema", "panel")


class AssetsView(HomeAssistantView):
    """GET /glass_panes/<folder>/<path>: one file from one of the static folders, never anything outside them."""

    url = f"/{DOMAIN}/{{folder}}/{{path:.*}}"
    name = f"{DOMAIN}:assets"
    requires_auth = False

    def __init__(self, hass: HomeAssistant, base: Path) -> None:
        self._hass = hass
        self._base = base

    def _find(self, folder: str, path: str) -> Path | None:
        """The file to send, or None. Runs off the event loop because it touches the disk."""
        if folder not in STATIC_FOLDERS:
            return None
        root = (self._base / folder).resolve()
        target = (root / path).resolve()
        if root != target and root not in target.parents:       # a path that climbs out of the folder
            return None
        return target if target.is_file() else None

    async def get(self, request: web.Request, folder: str, path: str) -> web.StreamResponse:
        target = await self._hass.async_add_executor_job(self._find, folder, path)
        if target is None:
            raise web.HTTPNotFound()
        return web.FileResponse(target, headers={"Cache-Control": "no-cache"})
