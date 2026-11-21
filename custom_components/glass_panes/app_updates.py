"""Home Assistant's side of Mirror Kiosk app updates: which release is newest, and the checked APK file to send.

One `AppUpdater` is shared by all displays: GitHub is asked at most every CHECK_EVERY (the update entities of several mirrors share
the answer), and one downloaded APK serves every mirror. The rules (which release, the hash and certificate checks) live in
app_update_lib.py; this file only does the network and the disk. Nothing here runs on a schedule of its own: the update entities ask
when Home Assistant polls them, and a download happens only when someone presses Install.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta
from typing import Any

import aiohttp
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.util import dt as dt_util

from . import app_update_lib as lib
from .const import LOGGER

CHECK_EVERY = timedelta(hours=6)
FAILED_RETRY = timedelta(minutes=30)
DOWNLOAD_TIMEOUT_S = 900
HEADERS = {"Accept": "application/vnd.github+json", "User-Agent": "glass-panes-home-assistant", "X-GitHub-Api-Version": "2022-11-28"}


class AppUpdater:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._latest: dict[str, Any] | None = None
        self._checked_at: datetime | None = None
        self._next_check: datetime | None = None
        self.last_problem: str | None = None
        self._check_lock = asyncio.Lock()
        self._download_lock = asyncio.Lock()

    @property
    def cache_dir(self) -> str:
        return self.hass.config.path(".storage", "glass_panes_app")

    async def latest(self, force: bool = False) -> dict[str, Any] | None:
        """The newest usable app release ({version, tag, url, size, sha256, notes_url, title}), or None when there is none or GitHub
        cannot be reached (the last good answer is kept)."""
        async with self._check_lock:
            now = dt_util.utcnow()
            if not force and self._next_check is not None and now < self._next_check:
                return self._latest
            try:
                releases = await self._fetch_releases()
            except Exception as err:  # noqa: BLE001  a failed look at GitHub must never break a mirror's entities
                self.last_problem = "Could not ask GitHub for new mirror app releases; trying again later."
                LOGGER.debug("Checking for mirror app releases failed (%s)", type(err).__name__)
                self._next_check = now + FAILED_RETRY
                return self._latest
            self._latest = lib.pick_release(releases)
            self.last_problem = None
            self._checked_at = now
            self._next_check = now + CHECK_EVERY
            return self._latest

    async def _fetch_releases(self) -> Any:
        """GitHub's release list (the only call to the GitHub API, kept in one method so the test suite can replace it)."""
        session = async_get_clientsession(self.hass)
        async with session.get(lib.RELEASES_API, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=20)) as response:
            if response.status != 200:
                raise ValueError(f"GitHub answered {response.status}")
            return await response.json(content_type=None)

    async def fetch_apk(self, release: dict[str, Any]) -> tuple[str | None, str | None]:
        """(problem, path): the release's APK on disk, downloaded if needed and checked (size, SHA-256, release certificate)."""
        async with self._download_lock:
            await self.hass.async_add_executor_job(lambda: os.makedirs(self.cache_dir, exist_ok=True))
            path = os.path.join(self.cache_dir, f"mirror-kiosk-v{release['version']}.apk")
            if await self.hass.async_add_executor_job(os.path.exists, path):
                problem = await self.hass.async_add_executor_job(lib.apk_problem, path, release["sha256"], release["size"])
                if problem is None:
                    return None, path
            problem = await self._download(release, path)
            if problem:
                return problem, None
            problem = await self.hass.async_add_executor_job(lib.apk_problem, path, release["sha256"], release["size"])
            if problem:
                await self.hass.async_add_executor_job(_remove, path)
                return problem, None
            await self.hass.async_add_executor_job(_keep_only, self.cache_dir, os.path.basename(path))
            return None, path

    async def _download(self, release: dict[str, Any], path: str) -> str | None:
        part = path + ".part"
        session = async_get_clientsession(self.hass)
        f = await self.hass.async_add_executor_job(open, part, "wb")
        try:
            # GitHub answers the release address with a redirect to its file store; the SHA-256 check afterwards is what proves the file
            async with session.get(release["url"], headers={"User-Agent": HEADERS["User-Agent"]},
                                   timeout=aiohttp.ClientTimeout(total=DOWNLOAD_TIMEOUT_S)) as response:
                if response.status != 200:
                    return f"GitHub did not hand out the app file (code {int(response.status)})."
                total = 0
                async for chunk in response.content.iter_chunked(1 << 20):
                    total += len(chunk)
                    if total > lib.MAX_APK_BYTES:
                        return "The app file from GitHub is far bigger than expected, so it was dropped."
                    await self.hass.async_add_executor_job(f.write, chunk)
        except (aiohttp.ClientError, TimeoutError, OSError):
            return "Could not download the app file from GitHub. Check Home Assistant's internet connection and try again."
        finally:
            await self.hass.async_add_executor_job(f.close)
        await self.hass.async_add_executor_job(os.replace, part, path)
        return None


def _remove(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def _keep_only(folder: str, keep: str) -> None:
    """Old APKs (and half downloads) are dropped once a newer one is checked, so the cache holds one file."""
    for name in os.listdir(folder):
        if name != keep and (name.endswith(".apk") or name.endswith(".part")):
            _remove(os.path.join(folder, name))
