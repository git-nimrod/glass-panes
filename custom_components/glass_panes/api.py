"""The authenticated web endpoints under /api/glass_panes/.

Unlike the static player files, these ask for a login (requires_auth). Reading is open to any logged-in user, so a display
can run under a plain non-admin user and still fetch what it needs. Changing bindings needs an administrator; panes and
displays are changed through the websocket API and the services, not here.

    GET  /api/glass_panes/bindings            which entity feeds which widget
    PUT  /api/glass_panes/bindings            replace them (administrators only)
    GET  /api/glass_panes/panes/<pane id>     one pane (a saved one wins over the shipped one of the same id)
    GET  /api/glass_panes/displays            the displays
    GET  /api/glass_panes/displays/<id>       one display, with the entity that switches its pane
    GET  /api/glass_panes/slideshow           the photos in a media folder (signed, shrunk addresses); /photo serves one
    GET  /api/glass_panes/picture_url         a signed address for an image or camera entity's picture; /picture serves it, shrunk
"""

from __future__ import annotations

from http import HTTPStatus

from aiohttp import web

from homeassistant.components.http import KEY_HASS_USER, HomeAssistantView

from . import media as media_lib
from . import photos as photos_lib
from .const import DOMAIN
from .manager import Manager

NO_STORE = {"Cache-Control": "no-store"}


class BindingsView(HomeAssistantView):
    """GET returns the bindings document; PUT replaces it (administrators only)."""

    url = f"/api/{DOMAIN}/bindings"
    name = f"api:{DOMAIN}:bindings"
    requires_auth = True

    def __init__(self, manager: Manager) -> None:
        self._manager = manager

    async def get(self, request):
        return self.json(self._manager.bindings.data, headers=NO_STORE)

    async def put(self, request):
        user = request.get(KEY_HASS_USER)
        if user is None or not user.is_admin:
            return self.json_message("Only an administrator can change bindings", HTTPStatus.FORBIDDEN, "forbidden")
        try:
            document = await request.json()
        except ValueError:
            return self.json_message("The body must be JSON", HTTPStatus.BAD_REQUEST, "bad_json")
        problems = await self._manager.bindings.async_set(document)
        if problems:
            return self.json({"message": "The bindings are not valid", "errors": problems}, HTTPStatus.BAD_REQUEST)
        return self.json(self._manager.bindings.data, headers=NO_STORE)


class PaneView(HomeAssistantView):
    """GET returns one pane's layout (never any entities: those are bindings)."""

    url = f"/api/{DOMAIN}/panes/{{pane_id}}"
    name = f"api:{DOMAIN}:pane"
    requires_auth = True

    def __init__(self, manager: Manager) -> None:
        self._manager = manager

    async def get(self, request, pane_id: str):
        found = self._manager.get_pane(pane_id)
        if found is None:
            return self.json_message("There is no such pane", HTTPStatus.NOT_FOUND, "not_found")
        return self.json(found[0], headers=NO_STORE)


class DisplaysView(HomeAssistantView):
    url = f"/api/{DOMAIN}/displays"
    name = f"api:{DOMAIN}:displays"
    requires_auth = True

    def __init__(self, manager: Manager) -> None:
        self._manager = manager

    async def get(self, request):
        return self.json({"displays": self._manager.list_displays()}, headers=NO_STORE)


class DisplayView(HomeAssistantView):
    url = f"/api/{DOMAIN}/displays/{{display_id}}"
    name = f"api:{DOMAIN}:display"
    requires_auth = True

    def __init__(self, manager: Manager) -> None:
        self._manager = manager

    async def get(self, request, display_id: str):
        display = self._manager.get_display(display_id)
        if display is None:
            return self.json_message("There is no such display", HTTPStatus.NOT_FOUND, "not_found")
        return self.json(display, headers=NO_STORE)


class MediaListView(HomeAssistantView):
    """GET returns the uploaded images and videos, each with an expiring signed address a display can load without a login."""

    url = f"/api/{DOMAIN}/media"
    name = f"api:{DOMAIN}:media"

    def __init__(self, manager: Manager) -> None:
        self._manager = manager

    async def get(self, request: web.Request) -> web.Response:
        return self.json({"media": self._manager.list_media()}, headers=NO_STORE)


class MediaFileView(HomeAssistantView):
    """GET one uploaded file. Needs a login or a signed address from the list above; supports range requests for video."""

    url = f"/api/{DOMAIN}/media/{{media_id}}"
    name = f"api:{DOMAIN}:media_file"

    def __init__(self, manager: Manager) -> None:
        self._manager = manager

    async def get(self, request: web.Request, media_id: str) -> web.StreamResponse:
        path = self._manager.media_path(media_id)
        if path is None or not await self._manager.hass.async_add_executor_job(path.is_file):
            raise web.HTTPNotFound()
        record = self._manager.get_media(media_id)
        return web.FileResponse(path, headers={"Content-Type": media_lib.MIME[record["ext"]], "Cache-Control": "private, max-age=3600"})


class SlideshowListView(HomeAssistantView):
    """GET ?folder=&w=&h= returns the photos in a media folder as expiring signed addresses of copies shrunk to w by h."""

    url = f"/api/{DOMAIN}/slideshow"
    name = f"api:{DOMAIN}:slideshow"

    def __init__(self, manager: Manager) -> None:
        self._manager = manager

    async def get(self, request: web.Request) -> web.Response:
        q = request.query
        return self.json(await self._manager.list_slideshow(q.get("folder", ""), q.get("w"), q.get("h")), headers=NO_STORE)


class PhotoView(HomeAssistantView):
    """GET one photo, shrunk and cached. Needs a login or a signed address from the list above."""

    url = f"/api/{DOMAIN}/photo"
    name = f"api:{DOMAIN}:photo"

    def __init__(self, manager: Manager) -> None:
        self._manager = manager

    async def get(self, request: web.Request) -> web.StreamResponse:
        q = request.query
        try:
            path = await self._manager.photo_file(q.get("folder", ""), q.get("name", ""), q.get("w"), q.get("h"))
        except ValueError:
            raise web.HTTPUnsupportedMediaType() from None
        if path is None:
            raise web.HTTPNotFound()
        return web.FileResponse(path, headers={"Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400"})


class PictureUrlView(HomeAssistantView):
    """GET ?entity=&w=&h= returns an expiring signed address for the current picture of an image or camera entity."""

    url = f"/api/{DOMAIN}/picture_url"
    name = f"api:{DOMAIN}:picture_url"

    def __init__(self, manager: Manager) -> None:
        self._manager = manager

    async def get(self, request: web.Request) -> web.Response:
        q = request.query
        if not photos_lib.is_picture_entity(q.get("entity")):
            return self.json_message("Only image and camera entities have a picture", HTTPStatus.BAD_REQUEST, "bad_entity")
        return self.json({"url": self._manager.picture_url(q["entity"], q.get("w"), q.get("h"))}, headers=NO_STORE)


class PictureView(HomeAssistantView):
    """GET the current picture of an image or camera entity, shrunk to fit. Never cached, because it changes."""

    url = f"/api/{DOMAIN}/picture"
    name = f"api:{DOMAIN}:picture"

    def __init__(self, manager: Manager) -> None:
        self._manager = manager

    async def get(self, request: web.Request) -> web.StreamResponse:
        q = request.query
        try:
            data = await self._manager.entity_picture(q.get("entity", ""), q.get("w"), q.get("h"))
        except ValueError:
            raise web.HTTPUnsupportedMediaType() from None
        if data is None:
            raise web.HTTPNotFound()
        return web.Response(body=data, headers={"Content-Type": "image/jpeg", "Cache-Control": "no-store"})


def views(manager: Manager) -> list[HomeAssistantView]:
    return [BindingsView(manager), PaneView(manager), DisplaysView(manager), DisplayView(manager), MediaListView(manager), MediaFileView(manager),
            SlideshowListView(manager), PhotoView(manager), PictureUrlView(manager), PictureView(manager)]
