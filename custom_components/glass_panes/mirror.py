"""Home Assistant calling a mirror's control server (the Mirror Kiosk app, port 8099).

Why Home Assistant makes the call and not the browser: a page opened over https cannot call a plain http address, and the key must
never reach the browser. So the builder asks Home Assistant (admins only), and Home Assistant asks the mirror.

Rules this file keeps:
- Only the fixed paths below are ever called, on the address the owner typed (checked by mirror_lib.parse_endpoint).
- Redirects are never followed: a mirror that answers with one is refused, so a call cannot be bounced to another place.
- Short timeouts, a size limit on the answer, and nothing the mirror sends is passed on except the fields we know (mirror_lib).
- The key is sent as `?key=` (the only way the app takes it) and is never logged. Error texts are written here, never copied
  from an exception, because an exception message can contain the address.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib.parse import urlencode

import aiohttp
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from . import mirror_lib as lib

REQUEST_TIMEOUT_S = 6          # one call to the mirror
MAX_BYTES = 65536              # the biggest answer we will read
MEASURE_WAIT_S = 20            # how long presence stays off during a measurement (tests set this to 0)


class MirrorError(Exception):
    """The text is meant for the owner and contains no address and no key."""


async def call(hass: HomeAssistant, endpoint: str, key: str | None, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """GET one fixed path on the mirror and return its JSON answer. Raises MirrorError with a plain-language reason."""
    query = {k: str(v) for k, v in (params or {}).items()}
    if key:
        query["key"] = key
    url = endpoint + path + ("?" + urlencode(query) if query else "")
    session = async_get_clientsession(hass)
    try:
        async with session.get(url, allow_redirects=False, timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_S)) as response:
            status = response.status
            declared = response.headers.get("Content-Length", "")
            if declared.isdigit() and int(declared) > MAX_BYTES:
                raise MirrorError("The mirror's answer was far bigger than expected, so it was ignored.")
            # The mirror's tiny web server can send one answer in several pieces, and one read() returns only the piece that has arrived
            # (a status of about 1.6 KB came back cut off, which looked like "not the Mirror Kiosk app"). So read until the end, in pieces,
            # and cap the total: chunked answers carry no Content-Length, so the cap has to be on what is actually read.
            stream = response.content          # taken once: it is one stream (Home Assistant's test fake makes a new one on every access)
            body = b""
            while True:
                piece = await stream.read(8192)
                if not piece:
                    break
                body += piece
                if len(body) > MAX_BYTES:
                    raise MirrorError("The mirror's answer was far bigger than expected, so it was ignored.")
    except MirrorError:
        raise
    except TimeoutError:
        raise MirrorError("The mirror did not answer in time. Check that it is on and on the same network.") from None
    except aiohttp.ClientSSLError:
        raise MirrorError("Could not make a secure connection. The mirror app speaks plain http; use an http:// address.") from None
    except (aiohttp.ClientError, OSError):
        raise MirrorError("Could not reach the mirror. Check its address and that the mirror app is running.") from None
    if 300 <= status < 400:
        raise MirrorError("The mirror answered with a redirect. Redirects are never followed, so nothing was done. Check the address.")
    if status == 403 and path == "/pair":
        raise MirrorError("The mirror did not accept that code. Check the six digits on its screen. After five wrong tries it waits a minute and shows a new code.")
    if status == 403:
        raise MirrorError("The mirror refused the key. Set the key again (it must match the one given to the app) or clear it.")
    if len(body) > MAX_BYTES:
        raise MirrorError("The mirror's answer was far bigger than expected, so it was ignored.")
    try:
        data = json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        data = None
    if not isinstance(data, dict):
        raise MirrorError(f"That address answered (code {int(status)}) but not like the Mirror Kiosk app. Check the address and port.")
    if status != 200 or data.get("ok") is False:
        reason = lib.clean_text(data.get("error"), 120)
        raise MirrorError(f"The mirror said no (code {int(status)}{': ' + reason if reason else ''}).")
    return data


async def read_status(hass: HomeAssistant, endpoint: str, key: str | None, now: str) -> dict[str, Any]:
    """Read /status and keep the known fields. `now` is when it was measured (an ISO time given by the caller)."""
    raw = await call(hass, endpoint, key, "/status")
    status = lib.shape_status(raw)
    if status is None:
        raise MirrorError("That address answered but not like the Mirror Kiosk app. Check the address and port.")
    return {**status, "measured_at": now}
