"""Fetching news feeds for the `rss` widget, on Home Assistant's side, with a cache. The parsing is in feeds.py.

- A feed is fetched only when a display (or the builder) shows an `rss` widget and its copy is older than the widget's
  `refresh_minutes`. There is no timer: a feed nobody shows is never fetched.
- Displays never reach the internet for it: they ask Home Assistant, and only for a widget of a saved pane, so a display's login
  cannot be used to make Home Assistant fetch any address it likes (the address comes from the pane, which an administrator saved).
- Two displays showing the same feed share one fetch and one copy. A fetch that fails keeps the last good stories and says why;
  it is not tried again until the refresh time has passed.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import aiohttp
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from . import feeds
from .const import LOGGER

TIMEOUT_S = 15
MIN_REFRESH_MIN, DEFAULT_REFRESH_MIN, MAX_REFRESH_MIN = 10, 30, 1440
MAX_FEEDS = 20                      # copies kept at once (the least recently used goes first)
USER_AGENT = "GlassPanes-HomeAssistant (+https://github.com/git-nimrod/glass-panes)"


def refresh_seconds(value: Any) -> int:
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        minutes = DEFAULT_REFRESH_MIN
    return min(max(minutes, MIN_REFRESH_MIN), MAX_REFRESH_MIN) * 60


class FeedCache:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._copies: dict[str, dict[str, Any]] = {}       # url -> {title, items, hash, fetched, tried, problem, used}
        self._running: dict[str, asyncio.Task] = {}
        self.clock = time.time                               # replaced in tests

    async def get(self, url: str, refresh_minutes: Any = None) -> dict[str, Any]:
        """The feed's stories, fetched now only if the copy is older than the refresh time. Never raises."""
        problem = feeds.url_problem(url)
        if problem:
            return {"items": [], "hash": "", "problem": problem}
        url = url.strip()
        copy = self._copies.get(url)
        now = self.clock()
        if copy is None or now - copy["tried"] >= refresh_seconds(refresh_minutes):
            running = self._running.get(url)
            if running is None or running.done():
                running = self.hass.async_create_task(self._fetch(url))
                self._running[url] = running
            await asyncio.shield(running)
            copy = self._copies.get(url)
        if copy is None:
            return {"items": [], "hash": "", "problem": "the feed could not be read"}
        copy["used"] = now
        return {"title": copy["title"], "items": copy["items"], "hash": copy["hash"], "fetched": copy["fetched"], "problem": copy["problem"]}

    async def _fetch(self, url: str) -> None:
        old = self._copies.get(url)
        result: dict[str, Any] = dict(old) if old else {"title": "", "items": [], "hash": "", "fetched": None}
        result["tried"] = self.clock()
        result["used"] = result["tried"]
        try:
            body = await self._download(url)
            parsed = await self.hass.async_add_executor_job(feeds.parse, body)
            result.update(title=parsed["title"], items=parsed["items"], hash=feeds.fingerprint(parsed["items"]), fetched=int(result["tried"]), problem=None)
        except feeds.FeedError as err:
            result["problem"] = str(err)
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            result["problem"] = "the feed did not answer" if isinstance(err, asyncio.TimeoutError) else "the feed could not be reached"
        except Exception as err:  # noqa: BLE001  never raise into a display's request; log only the kind of error
            LOGGER.warning("Reading a news feed failed unexpectedly (%s)", type(err).__name__)
            result["problem"] = "something unexpected went wrong reading the feed"
        self._copies[url] = result
        if len(self._copies) > MAX_FEEDS:
            oldest = min(self._copies, key=lambda u: self._copies[u]["used"])
            self._copies.pop(oldest, None)

    async def _download(self, url: str) -> bytes:
        session = async_get_clientsession(self.hass)
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=TIMEOUT_S), max_redirects=3,
                               headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5"}) as response:
            if response.status != 200:
                raise feeds.FeedError(f"the feed answered with error {response.status}")
            declared = response.headers.get("Content-Length", "")
            if declared.isdigit() and int(declared) > feeds.MAX_BYTES:
                raise feeds.FeedError("the feed is too big")
            stream = response.content          # taken once (Home Assistant's test fake makes a new stream on every access)
            body = b""
            while piece := await stream.read(65536):
                body += piece
                if len(body) > feeds.MAX_BYTES:
                    raise feeds.FeedError("the feed is too big")
            return body
