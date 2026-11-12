"""The one place that knows about panes, displays and bindings together.

The web endpoints, the websocket API, the services and the select entities all go through this, so they follow the same
rules (a display can only show a pane that exists, a pane in use cannot be deleted, and so on).
"""

from __future__ import annotations

import asyncio
import copy
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from homeassistant.auth.const import GROUP_ID_USER
from homeassistant.auth.models import TOKEN_TYPE_LONG_LIVED_ACCESS_TOKEN
from homeassistant.components.http.auth import async_sign_path
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.util import dt as dt_util

from . import bindings as bindings_lib
from . import displays as displays_lib
from . import mirror, mirror_lib
from . import panes as panes_lib
from .const import (
    DEFAULT_PANE,
    DOMAIN,
    LOGGER,
    SIGNAL_DISPLAY_ADDED,
    SIGNAL_DISPLAY_REMOVED,
    SIGNAL_DISPLAY_UPDATED,
    SIGNAL_PANES_CHANGED,
)
from . import groups as groups_lib
from . import media as media_lib
from . import photos as photos_lib
from . import widget_ops
from .storage import BindingsStore, DisplayStore, DraftStore, GroupStore, MediaStore, PaneStore


async def remove_user_by_id(hass: HomeAssistant, user_id: str | None) -> None:
    """Delete one display login user (which also ends all its tokens). Never touches an owner or an administrator."""
    user = await hass.auth.async_get_user(user_id) if user_id else None
    if user is not None and not user.is_owner and not user.is_admin:        # never touch anyone who is not one of ours
        await hass.auth.async_remove_user(user)


async def remove_login_user(hass: HomeAssistant, record: dict[str, Any]) -> None:
    """Delete the Home Assistant user behind one display record (which also ends all its tokens) and forget its id.

    Safe to call when the user is already gone or the record has no login. Never touches an owner or an administrator."""
    await remove_user_by_id(hass, record.pop("login_user_id", None))


class Manager:
    def __init__(
        self,
        hass: HomeAssistant,
        shipped: dict[str, dict[str, Any]],
        checker: panes_lib.PaneChecker,
        registry: dict[str, Any],
        bindings: BindingsStore,
        pane_store: PaneStore,
        display_store: DisplayStore,
        media_store: MediaStore,
        draft_store: DraftStore | None = None,
    ) -> None:
        self.hass = hass
        self.shipped = shipped
        self.registry = registry
        self.bindings = bindings
        self.pane_store = pane_store
        self.display_store = display_store
        self.media_store = media_store
        self.draft_store = draft_store
        self._checker = checker
        self.group_store = GroupStore(hass)                    # loaded the first time a group is asked for
        self._status_reads: dict[str, asyncio.Task] = {}      # the /status read under way for each display, so the controls of one display share it
        self._photo_lock = asyncio.Lock()                    # one picture is shrunk at a time, so a big folder cannot starve Home Assistant
        self.pane_schema: dict[str, Any] = {}                 # the pane JSON Schema, kept so tools and agents can be handed it
        self._mirror_locks: dict[str, asyncio.Lock] = {}     # one per display: a measurement and a presence switch must not overlap
        self._lock = asyncio.Lock()        # one change at a time, so two requests cannot interleave their saves

    # ------------------------------------------------------------------ panes

    def refresh_shipped(self, shipped: dict[str, dict[str, Any]], checker: panes_lib.PaneChecker, registry: dict[str, Any]) -> None:
        """Swap in freshly read shipped panes (after an update) and tell the select entities the options may have changed."""
        self.shipped = shipped
        self._checker = checker
        self.registry = registry
        async_dispatcher_send(self.hass, SIGNAL_PANES_CHANGED)

    async def async_repair_displays(self) -> None:
        """After an update that removes a shipped pane, a display may still point at it. Put such a display on the default pane."""
        ids = set(self.pane_ids())
        fixed = [d for d, record in self.display_store.displays.items() if record["pane"] not in ids]
        if not fixed:
            return
        async with self._lock:
            for display_id in fixed:
                self.display_store.displays[display_id]["pane"] = self._default_pane()
            await self.display_store.async_save()
        for display_id in fixed:
            LOGGER.warning("Display '%s' was showing a pane that no longer exists; it now shows '%s'", display_id, self._default_pane())
            async_dispatcher_send(self.hass, SIGNAL_DISPLAY_UPDATED, display_id)

    def pane_ids(self) -> list[str]:
        """Every pane a display can show: the shipped ones, then any saved ones with new ids."""
        return sorted(self.shipped) + sorted(i for i in self.pane_store.panes if i not in self.shipped)

    def get_pane(self, pane_id: str) -> tuple[dict[str, Any], str] | None:
        """A pane and where it came from ('user' when a saved pane exists, replacing a shipped one of the same id)."""
        if pane_id in self.pane_store.panes:
            return self.pane_store.panes[pane_id], "user"
        if pane_id in self.shipped:
            return self.shipped[pane_id], "shipped"
        return None

    def list_panes(self) -> list[dict[str, Any]]:
        out = []
        for pane_id in self.pane_ids():
            pane, source = self.get_pane(pane_id)  # type: ignore[misc]
            out.append(panes_lib.summarize(pane, source, source == "user" and pane_id in self.shipped))
        return out

    async def save_pane(self, pane: Any) -> list[str]:
        """Save a pane from the builder. Returns the problems; nothing is saved if there are any."""
        errors = self._checker.check(pane)
        if errors:
            return errors
        async with self._lock:
            if pane["id"] not in self.pane_store.panes and len(self.pane_store.panes) >= panes_lib.MAX_USER_PANES:
                return [f"too many saved panes (the limit is {panes_lib.MAX_USER_PANES})"]
            await self.pane_store.async_put(pane)
        async_dispatcher_send(self.hass, SIGNAL_PANES_CHANGED)
        return []

    # ------------------------------------------------------------------ reusable widget groups

    async def _groups(self) -> dict[str, dict[str, Any]]:
        if not self.group_store.loaded:
            await self.group_store.async_load()
        return self.group_store.groups

    async def list_groups(self) -> list[dict[str, Any]]:
        groups = await self._groups()
        return [groups_lib.shape(g) for g in sorted(groups.values(), key=lambda g: g["name"].lower())]

    async def save_group(self, name: Any, widgets: Any, bindings: Any) -> tuple[list[str], dict[str, Any] | None]:
        """Save a set of widgets (and what they are bound to) under a name. The widgets are checked as a pane would be, so a group
        can never hold something a pane could not."""
        errors = groups_lib.validate_request(name, widgets, bindings)
        if errors:
            return errors, None
        errors = self._checker.check(groups_lib.stand_in_pane(name, widgets))
        if not errors:
            errors = bindings_lib.validate(bindings_lib.wrap({groups_lib.PANE_ID: bindings}))
        if errors:
            return errors, None
        async with self._lock:
            groups = await self._groups()
            if len(groups) >= groups_lib.MAX_GROUPS:
                return [f"too many saved groups (the limit is {groups_lib.MAX_GROUPS})"], None
            group = {"id": groups_lib.unique_id(name, set(groups)), "name": name.strip(), "widgets": copy.deepcopy(widgets),
                     "bindings": copy.deepcopy(bindings), "created": datetime.now(timezone.utc).isoformat()}
            await self.group_store.async_put(group)
        return [], groups_lib.shape(group)

    async def delete_group(self, group_id: Any) -> bool:
        async with self._lock:
            await self._groups()
            return isinstance(group_id, str) and await self.group_store.async_remove(group_id)

    async def create_pane(self, name: Any, description: Any = "", copy_from: Any = None) -> tuple[list[str], dict[str, Any] | None]:
        """Make a new pane, blank or a copy of an existing one. Its id comes from the name and never changes after that."""
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
            return ["name must be 1 to 80 characters"], None
        if not isinstance(description, str) or len(description) > 400:
            return ["description must be text of at most 400 characters"], None
        if copy_from is not None:
            source = self.get_pane(copy_from) if isinstance(copy_from, str) else None
            if source is None:
                return [f"there is no pane '{copy_from}' to copy"], None
            pane = json.loads(json.dumps(source[0]))      # a deep copy, so the original is never touched
        else:
            pane = {"schema_version": 1, "id": "", "name": "", "canvas": {"width": panes_lib.CANVAS_WIDTH, "height": panes_lib.CANVAS_HEIGHT},
                    "background": "#000000", "motion": {"widgets": "fade"}, "widgets": []}
        async with self._lock:
            pane["id"] = displays_lib.unique_id(name, set(self.pane_ids()), "pane")
            pane["name"] = name.strip()
            pane["description"] = description.strip()
            errors = self._checker.check(pane)
            if errors:
                return errors, None
            if len(self.pane_store.panes) >= panes_lib.MAX_USER_PANES:
                return [f"too many saved panes (the limit is {panes_lib.MAX_USER_PANES})"], None
            await self.pane_store.async_put(pane)
        async_dispatcher_send(self.hass, SIGNAL_PANES_CHANGED)
        return [], pane

    async def update_pane_details(self, pane_id: str, name: Any = None, description: Any = None) -> list[str]:
        """Rename a pane or change its description. The id stays the same, so automations that use it keep working."""
        found = self.get_pane(pane_id)
        if found is None:
            return [f"there is no pane '{pane_id}'"]
        pane = json.loads(json.dumps(found[0]))
        if name is not None:
            pane["name"] = name.strip() if isinstance(name, str) else name
        if description is not None:
            pane["description"] = description.strip() if isinstance(description, str) else description
        return await self.save_pane(pane)

    async def delete_pane(self, pane_id: str) -> str | None:
        """Delete a saved pane (a shipped pane it replaced comes back). Returns the reason it cannot be, or None."""
        async with self._lock:
            if pane_id not in self.pane_store.panes:
                return "only a saved pane can be deleted" if pane_id in self.shipped else "there is no such pane"
            if pane_id not in self.shipped:
                users = [d["name"] for d in self.display_store.displays.values() if d["pane"] == pane_id]
                if users:
                    return "it is showing on " + ", ".join(users) + "; switch those displays first"
            await self.pane_store.async_remove(pane_id)
        async_dispatcher_send(self.hass, SIGNAL_PANES_CHANGED)
        return None

    async def set_pane_bindings(self, pane_id: Any, mapping: Any) -> list[str]:
        """Replace the entities bound to ONE pane (widget id -> slot -> entity). Every other pane's bindings are left exactly as they are.
        An empty mapping (or None) clears that pane's bindings. Returns the problems; nothing is saved if there are any."""
        if not isinstance(pane_id, str) or pane_id not in self.pane_ids():
            return [f"there is no pane '{pane_id}'"]
        if mapping is not None and not isinstance(mapping, dict):
            return ["bindings must be an object: widget id -> slot -> entity id or list"]
        async with self._lock:
            document = copy.deepcopy(self.bindings.data)
            if mapping:
                document["bindings"][pane_id] = mapping
            else:
                document["bindings"].pop(pane_id, None)
            return await self.bindings.async_set(document)

    # ------------------------------------------------------------------ drafts (a pane an agent is still building)
    # An agent builds in a draft: nothing is shown on a display and nothing appears in the pane list until it finishes. Every step is
    # checked exactly like saving a pane, so a draft is always a valid pane, and finishing it saves a normal pane the person can open and
    # edit by hand in the builder. Finishing never overwrites a pane unless it is asked to (`replace`).

    MAX_DRAFTS = 10
    DRAFT_DAYS = 7

    def _drafts(self) -> dict[str, dict[str, Any]]:
        return self.draft_store.drafts if self.draft_store is not None else {}

    def _draft_summary(self, draft: dict[str, Any]) -> dict[str, Any]:
        pane = draft["pane"]
        return {
            "draft": draft["id"], "name": pane.get("name", ""), "description": pane.get("description", ""),
            "widgets": [{"id": w["id"], "type": w["type"], "name": w.get("name", w["id"]), "x": w["x"], "y": w["y"], "w": w["w"], "h": w["h"]} for w in pane.get("widgets", [])],
            "theme": pane.get("theme"), "edits": draft.get("target"), "created": draft.get("created"), "updated": draft.get("updated"),
        }

    def list_drafts(self) -> list[dict[str, Any]]:
        return [self._draft_summary(d) for d in self._drafts().values()]

    def get_draft(self, draft_id: Any) -> dict[str, Any] | None:
        draft = self._drafts().get(draft_id) if isinstance(draft_id, str) else None
        if draft is None:
            return None
        return {**self._draft_summary(draft), "pane": copy.deepcopy(draft["pane"]), "bindings": copy.deepcopy(draft["bindings"])}

    async def start_draft(self, name: Any = None, description: Any = "", copy_from: Any = None, edit: Any = None) -> tuple[list[str], dict[str, Any] | None]:
        """Start a draft: blank, a copy of a pane (`copy_from`), or a working copy of a pane you want to change (`edit`)."""
        if self.draft_store is None:
            return ["drafts are not available"], None
        if copy_from is not None and edit is not None:
            return ["use copy_from or edit, not both"], None
        source_id = edit if edit is not None else copy_from
        source = self.get_pane(source_id) if isinstance(source_id, str) else None
        if source_id is not None and source is None:
            return [f"there is no pane '{source_id}'"], None
        if source is None and (not isinstance(name, str) or not 1 <= len(name.strip()) <= 80):
            return ["name the new pane (1 to 80 characters)"], None
        if not isinstance(description, str) or len(description) > 400:
            return ["description must be text of at most 400 characters"], None
        async with self._lock:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=self.DRAFT_DAYS)).isoformat()
            stale = [d for d, rec in self._drafts().items() if rec.get("updated", rec.get("created", "")) < cutoff]
            for draft_id in stale:
                del self.draft_store.drafts[draft_id]
            if len(self._drafts()) >= self.MAX_DRAFTS:
                return [f"there are already {self.MAX_DRAFTS} drafts. Finish or discard one first (list_drafts shows them)"], None
            draft_id = "d_" + uuid.uuid4().hex[:8]
            if source is not None:
                pane = copy.deepcopy(source[0])
                bindings = copy.deepcopy(self.bindings.data["bindings"].get(source_id, {}))
                if isinstance(name, str) and name.strip():
                    pane["name"] = name.strip()
                elif edit is None:
                    pane["name"] = f"{pane.get('name', source_id)} (copy)"
            else:
                pane = {"schema_version": 1, "id": "", "name": name.strip(), "canvas": {"width": panes_lib.CANVAS_WIDTH, "height": panes_lib.CANVAS_HEIGHT},
                        "background": "#000000", "motion": {"widgets": "fade"}, "widgets": []}
                bindings = {}
            pane["id"] = draft_id
            if description.strip():
                pane["description"] = description.strip()
            problems = self._checker.check(pane)
            if problems:
                return problems, None
            now = datetime.now(timezone.utc).isoformat()
            self.draft_store.drafts[draft_id] = {"id": draft_id, "target": edit if edit is not None else None, "pane": pane, "bindings": bindings, "created": now, "updated": now}
            await self.draft_store.async_save()
            return [], self._draft_summary(self.draft_store.drafts[draft_id])

    async def edit_draft(self, draft_id: Any, action: str, **args: Any) -> tuple[list[str], dict[str, Any] | None]:
        """Change a draft with one step. Actions: add_widget, update_widget, place_widget, remove_widget, align_widgets, bind_widget, set_pane.
        The step is refused with its reasons (and the draft left as it was) if the result would not be a valid pane."""
        ops = widget_ops
        async with self._lock:
            draft = self._drafts().get(draft_id) if isinstance(draft_id, str) else None
            if draft is None:
                return [f"there is no draft '{draft_id}' (list_drafts shows yours)"], None
            pane, bindings = draft["pane"], draft["bindings"]
            widget: dict[str, Any] | None = None
            added: list[str] = []
            try:
                if action == "add_widget":
                    entities = args.pop("entities", None)
                    pane, widget = ops.add_widget(pane, args.pop("type", None), self.registry, **args)
                    if entities is not None:
                        if not isinstance(entities, dict):
                            raise ops.OpError("entities must be an object: slot name -> entity id (or list)")
                        for slot, value in entities.items():
                            bindings = ops.bind(pane, bindings, self.registry, widget["id"], slot, value)
                elif action == "add_group":
                    saved = (await self._groups()).get(args.get("group")) if isinstance(args.get("group"), str) else None
                    if saved is None:
                        names = ", ".join(f"{g['id']} ({g['name']})" for g in sorted((await self._groups()).values(), key=lambda g: g["id"])) or "none yet"
                        raise ops.OpError(f"there is no saved group '{args.get('group')}'. Saved groups: {names}")
                    pane, bindings, added = ops.add_group(pane, bindings, saved)
                elif action == "update_widget":
                    pane, widget = ops.update_widget(pane, args.pop("widget", None), **args)
                elif action == "place_widget":
                    pane, widget = ops.place_widget(pane, args.pop("widget", None), **args)
                elif action == "remove_widget":
                    gone = args.get("widget")
                    pane = ops.remove_widget(pane, gone)
                    bindings = {k: v for k, v in bindings.items() if k != gone}
                elif action == "align_widgets":
                    pane = ops.align_widgets(pane, args.get("widgets"), args.get("mode"))
                elif action == "bind_widget":
                    widget_id = args.get("widget")
                    bindings = ops.bind(pane, bindings, self.registry, widget_id, args.get("slot"), args.get("entity"))
                    widget = pane["widgets"][ops.widget_index(pane, widget_id)]
                elif action == "set_pane":
                    pane = ops.set_pane_fields(pane, **args)
                else:
                    return [f"unknown step '{action}'"], None
            except ops.OpError as error:
                return error.problems, None
            problems = self._checker.check(pane)
            if not problems:
                problems = bindings_lib.validate(bindings_lib.wrap({pane["id"]: bindings}))
            if not problems:
                # bindings that point at a widget that no longer exists are dropped, so a draft never keeps stale entities
                ids = {w["id"] for w in pane["widgets"]}
                bindings = {k: v for k, v in bindings.items() if k in ids}
            if problems:
                return problems, None
            draft["pane"], draft["bindings"] = pane, bindings
            draft["updated"] = datetime.now(timezone.utc).isoformat()
            await self.draft_store.async_save()
            summary = self._draft_summary(draft)
            result: dict[str, Any] = {"draft": draft_id, "widgets": summary["widgets"]}
            if action == "add_group":
                result["added"] = added
            if widget is not None:
                result["widget"] = copy.deepcopy(widget)
                result["bindings"] = copy.deepcopy(bindings.get(widget["id"], {}))
            return [], result

    async def finish_draft(self, draft_id: Any, replace: Any = False) -> tuple[list[str], dict[str, Any] | None]:
        """Save a draft as a real pane. A new pane by default (its id comes from the name); with `replace`, a draft made with `edit` overwrites that pane."""
        draft = self._drafts().get(draft_id) if isinstance(draft_id, str) else None
        if draft is None:
            return [f"there is no draft '{draft_id}' (list_drafts shows yours)"], None
        if replace and not draft.get("target"):
            return ["only a draft started with `edit` can replace a pane. Finish it without `replace` to save it as a new pane"], None
        pane = copy.deepcopy(draft["pane"])
        bindings = copy.deepcopy(draft["bindings"])
        if replace:
            pane_id = draft["target"]
        else:
            pane_id = displays_lib.unique_id(pane["name"], set(self.pane_ids()), "pane")
        pane["id"] = pane_id
        problems = self._checker.check(pane) or bindings_lib.validate(bindings_lib.wrap({pane_id: bindings}))
        if problems:
            return problems, None
        problems = await self.save_pane(pane)
        if problems:
            return problems, None
        problems = await self.set_pane_bindings(pane_id, bindings)
        if problems:
            return [f"the pane was saved but its entities were not: {'; '.join(problems[:5])}"], None
        async with self._lock:
            self.draft_store.drafts.pop(draft_id, None)
            await self.draft_store.async_save()
        return [], {"pane": pane_id, "name": pane["name"], "widgets": len(pane["widgets"]), "replaced": bool(replace),
                    "next": "Open Glass Panes in the sidebar to see it and edit it by hand, or show it on a display with show_pane."}

    async def discard_draft(self, draft_id: Any) -> bool:
        async with self._lock:
            if self.draft_store is None or not isinstance(draft_id, str) or draft_id not in self.draft_store.drafts:
                return False
            del self.draft_store.drafts[draft_id]
            await self.draft_store.async_save()
            return True

    # ------------------------------------------------------------------ media (uploaded images and videos)

    def media_dir(self) -> Path:
        return Path(self.hass.config.path(DOMAIN, "media"))

    def get_media(self, media_id: str) -> dict[str, Any] | None:
        return self.media_store.media.get(media_id) if media_lib.is_valid_id(media_id) else None

    def media_path(self, media_id: str) -> Path | None:
        record = self.get_media(media_id)
        return self.media_dir() / f"{record['id']}.{record['ext']}" if record else None

    def media_url(self, media_id: str) -> str:
        """An expiring signed address for one file, so a display can load it without a login. Tied to Home Assistant's read-only
        content user, so it opens nothing but media files."""
        return async_sign_path(self.hass, f"/api/{DOMAIN}/media/{media_id}", timedelta(days=7), use_content_user=True)

    def public_media(self, record: dict[str, Any]) -> dict[str, Any]:
        return {"id": record["id"], "name": record["name"], "kind": record["kind"], "size": record["size"],
                "created": record["created"], "url": self.media_url(record["id"])}

    def list_media(self) -> list[dict[str, Any]]:
        records = sorted(self.media_store.media.values(), key=lambda r: r["created"], reverse=True)
        return [self.public_media(r) for r in records]

    def media_users(self, media_id: str) -> list[str]:
        """Names of the saved panes that use this file."""
        return [p["name"] for p in self.pane_store.panes.values()
                if any((w.get("options") or {}).get("media") == media_id for w in p.get("widgets", []))]

    # ------------------------------------------------------------------ photos (slideshow) and entity pictures

    def photo_roots(self) -> dict[str, Path]:
        """Home Assistant's media folders by name ("local" is /media on Home Assistant OS; network storage mounts appear under it too)."""
        dirs = getattr(self.hass.config, "media_dirs", None) or {}
        roots = {name: Path(path) for name, path in dirs.items()}
        return roots or {"local": Path(self.hass.config.path("media"))}

    def photo_location(self, folder: Any) -> tuple[Path, str]:
        """(media folder, folder inside it) for what was typed. The first part may name a media folder ("local/photos");
        otherwise the first media folder is used."""
        roots = self.photo_roots()
        text = str(folder or "").replace("\\", "/").strip().strip("/")
        head, _, rest = text.partition("/")
        if head in roots:
            return roots[head], rest
        return next(iter(roots.values())), text

    def photo_cache_dir(self) -> Path:
        return Path(self.hass.config.path(DOMAIN, "cache"))

    def photo_url(self, folder: Any, name: str, w: int, h: int) -> str:
        """An expiring signed address for one photo at one size (a display loads it without a login; it opens nothing else)."""
        query = urlencode({"folder": str(folder or ""), "name": name, "w": w, "h": h})
        return async_sign_path(self.hass, f"/api/{DOMAIN}/photo?{query}", timedelta(days=7), use_content_user=True)

    async def list_slideshow(self, folder: Any, w: Any, h: Any) -> dict[str, Any]:
        """The photos in a folder as signed addresses sized for a widget of w by h. {"items": [...]} or a "problem"."""
        root, rel = self.photo_location(folder)
        names = await self.hass.async_add_executor_job(photos_lib.list_photos, root, rel)
        if names is None:
            return {"items": [], "count": 0, "problem": "folder_not_found"}
        w, h = photos_lib.bucket(w), photos_lib.bucket(h)
        return {"items": [self.photo_url(folder, name, w, h) for name in names], "count": len(names)}

    async def photo_file(self, folder: Any, name: Any, w: Any, h: Any) -> Path | None:
        """The shrunk copy of one photo (made now when it is not cached yet). None when there is no such photo.
        Raises ValueError when the file is not a readable picture."""
        root, rel = self.photo_location(folder)
        w, h = photos_lib.bucket(w), photos_lib.bucket(h)
        cache = self.photo_cache_dir()

        def work() -> Path | None:
            path = photos_lib.resolve_photo(root, rel, name)
            if path is None:
                return None
            fresh = not (cache / photos_lib.cache_name(path, w, h)).is_file()
            result = photos_lib.resized_file(path, cache, w, h)
            if fresh:
                photos_lib.prune(cache)
            return result

        async with self._photo_lock:
            return await self.hass.async_add_executor_job(work)

    def picture_url(self, entity_id: str, w: Any, h: Any) -> str:
        query = urlencode({"entity": entity_id, "w": photos_lib.bucket(w), "h": photos_lib.bucket(h)})
        return async_sign_path(self.hass, f"/api/{DOMAIN}/picture?{query}", timedelta(days=7), use_content_user=True)

    async def entity_picture(self, entity_id: str, w: Any, h: Any) -> bytes | None:
        """The current picture of an image or camera entity, or the cover art of a media player, shrunk to w by h as a JPEG. None when the entity
        gives no picture now. (A full-size cover decodes to several MB on the mirror, so Now playing asks for the size it draws.)
        Raises ValueError when what it gave is not a readable picture."""
        from homeassistant.exceptions import HomeAssistantError

        if not photos_lib.is_picture_entity(entity_id):
            return None
        w, h = photos_lib.bucket(w), photos_lib.bucket(h)
        if entity_id.split(".")[0] not in self.hass.config.components:       # the camera or image integration is not set up here
            return None
        try:
            if entity_id.startswith("camera."):
                from homeassistant.components import camera

                content = (await camera.async_get_image(self.hass, entity_id, 10, w, h)).content
            elif entity_id.startswith("media_player."):
                from homeassistant.components.media_player.const import DATA_COMPONENT

                player = self.hass.data[DATA_COMPONENT].get_entity(entity_id)
                content = (await player.async_get_media_image())[0] if player is not None else None
            else:
                from homeassistant.components import image

                content = (await image.async_get_image(self.hass, entity_id)).content
        except (HomeAssistantError, asyncio.TimeoutError, KeyError, ImportError, AttributeError):
            return None
        if not content:
            return None
        async with self._photo_lock:
            return await self.hass.async_add_executor_job(photos_lib.shrink, content, w, h)


    def _ingest(self, file_id: str, media_id: str) -> dict[str, Any]:
        from homeassistant.components.file_upload import process_uploaded_file

        with process_uploaded_file(self.hass, file_id) as path:        # removes the temporary upload afterwards
            return media_lib.ingest(path, self.media_dir(), media_id)

    async def add_media(self, file_id: Any, name: Any) -> tuple[str | None, dict[str, Any] | None]:
        """Take a file uploaded through Home Assistant's upload endpoint into the media library. Returns (problem, record)."""
        if not isinstance(file_id, str) or not file_id:
            return "no file was given", None
        label = (name.strip() if isinstance(name, str) else "")[:80] or "Untitled"
        async with self._lock:
            if len(self.media_store.media) >= media_lib.MAX_MEDIA:
                return f"too many files (the limit is {media_lib.MAX_MEDIA}); delete some first", None
            media_id = media_lib.new_id(set(self.media_store.media))
            try:
                info = await self.hass.async_add_executor_job(self._ingest, file_id, media_id)
            except ValueError as err:
                return str(err), None
            record = {**info, "name": label, "created": datetime.now(timezone.utc).isoformat()}
            await self.media_store.async_put(record)
        return None, self.public_media(record)

    async def delete_media(self, media_id: str) -> str | None:
        """Delete an uploaded file. Returns the reason it cannot be deleted, or None."""
        record = self.get_media(media_id)
        if record is None:
            return "there is no such file"
        users = self.media_users(media_id)
        if users:
            return "it is used by " + ", ".join(users) + "; change those panes first"
        path = self.media_path(media_id)
        async with self._lock:
            await self.media_store.async_remove(media_id)
        if path is not None:
            await self.hass.async_add_executor_job(lambda: path.unlink(missing_ok=True))
        return None

    # ------------------------------------------------------------------ displays

    def _public(self, display_id: str) -> dict[str, Any]:
        record = self.display_store.displays[display_id]
        entity_id = er.async_get(self.hass).async_get_entity_id("select", DOMAIN, f"{DOMAIN}_{display_id}")
        return {"id": display_id, "name": record["name"], "timezone": record.get("timezone"), "pane": record["pane"], "entity_id": entity_id,
                # Home Assistant's own zone: a display with no zone of its own shows times in this one (read live, so a change follows)
                "ha_timezone": self.hass.config.time_zone,
                "has_login": bool(record.get("login_user_id")),
                # Only yes/no answers: the mirror's address is shown to administrators by the mirror commands, and the key is never shown
                "has_mirror": bool(record.get("endpoint")), "key_set": bool(record.get("key"))}

    def list_displays(self) -> list[dict[str, Any]]:
        return [self._public(i) for i in sorted(self.display_store.displays)]

    def get_display(self, display_id: str) -> dict[str, Any] | None:
        return self._public(display_id) if display_id in self.display_store.displays else None

    def _default_pane(self) -> str:
        ids = self.pane_ids()
        return DEFAULT_PANE if DEFAULT_PANE in ids else ids[0]

    async def save_display(self, data: Any) -> tuple[list[str], dict[str, Any] | None]:
        """Create a display, or update one that has the given id. Only the fields given are changed.

        `endpoint` (the mirror's address) may be given here. The mirror's `key` may NOT: it is set only through mirror_connect
        (the builder's websocket command), so it never passes through a service call, an automation or an agent."""
        if isinstance(data, dict) and "key" in data:
            return ["the mirror key cannot be set here; use the builder's Connect a mirror form"], None
        errors = displays_lib.validate_fields(data)
        if errors:
            return errors, None
        async with self._lock:
            existing = self.display_store.displays
            display_id = data.get("id")
            is_new = display_id is None or display_id not in existing
            if is_new:
                if "name" not in data:
                    return ["a new display needs a name"], None
                if len(existing) >= displays_lib.MAX_DISPLAYS:
                    return [f"too many displays (the limit is {displays_lib.MAX_DISPLAYS})"], None
                display_id = display_id or displays_lib.unique_id(data["name"], set(existing))
                record = {"name": data["name"].strip(), "timezone": data.get("timezone") or None,
                          "pane": data.get("pane") or self._default_pane()}
                if data.get("endpoint"):
                    record["endpoint"] = mirror_lib.parse_endpoint(data["endpoint"])[0]
            else:
                record = dict(existing[display_id])
                if "name" in data:
                    record["name"] = data["name"].strip()
                if "timezone" in data:
                    record["timezone"] = data["timezone"] or None
                if "pane" in data:
                    record["pane"] = data["pane"]
                if "endpoint" in data:
                    self._set_endpoint(record, data["endpoint"])
            if record["pane"] not in self.pane_ids():
                return [f"pane '{record['pane']}' does not exist"], None
            existing[display_id] = record
            await self.display_store.async_save()
        async_dispatcher_send(self.hass, SIGNAL_DISPLAY_ADDED if is_new else SIGNAL_DISPLAY_UPDATED, display_id)
        return [], self._public(display_id)

    @staticmethod
    def _set_endpoint(record: dict[str, Any], endpoint: Any) -> None:
        """Set or clear a record's mirror address. A different address drops the saved key, so a key made for one device is never
        sent to another; an empty address removes both."""
        new = mirror_lib.parse_endpoint(endpoint)[0] if endpoint else None
        if new != record.get("endpoint"):
            record.pop("key", None)
        if new:
            record["endpoint"] = new
        else:
            record.pop("endpoint", None)

    async def delete_display(self, display_id: str) -> bool:
        async with self._lock:
            if display_id not in self.display_store.displays:
                return False
            await self._remove_login(self.display_store.displays[display_id])        # its login goes with it
            del self.display_store.displays[display_id]
            await self.display_store.async_save()
        async_dispatcher_send(self.hass, SIGNAL_DISPLAY_REMOVED, display_id)
        return True

    # ------------------------------------------------------------------ a display's own login
    # A display needs to read states and calendars, so it signs in as a user. Each display gets its OWN dedicated user (an ordinary,
    # non-admin one that can only sign in from the home network) with one long-lived token, shown once to the person who asked for it.
    # Revoking removes the user, which ends every token it had. Home Assistant cannot limit a user to certain entities, so this user
    # can read what any ordinary user can; it just cannot change settings and cannot be an admin.

    async def _remove_login(self, record: dict[str, Any]) -> None:
        await remove_login_user(self.hass, record)

    async def create_display_login(self, display_id: str, keep_previous: bool = False) -> tuple[str | None, dict[str, Any] | None]:
        """Make (or replace) the display's login. Returns (problem, {"token", "user", "previous_user_id"}). The token is not kept anywhere.

        Normally the old login is removed first, so its token stops working at once. With `keep_previous` it is left alone and its user id
        is returned, so the caller can remove it once the new token has really reached the display (see pair_mirror)."""
        async with self._lock:
            record = self.display_store.displays.get(display_id)
            if record is None:
                return f"there is no display '{display_id}'", None
            previous = record.get("login_user_id") if keep_previous else None
            if not keep_previous:
                await self._remove_login(record)                  # replacing: the old token stops working
            user = await self.hass.auth.async_create_user(f"Glass Panes: {record['name']}"[:80], group_ids=[GROUP_ID_USER], local_only=True)
            try:
                refresh = await self.hass.auth.async_create_refresh_token(
                    user, client_name=f"Glass Panes display {display_id}", token_type=TOKEN_TYPE_LONG_LIVED_ACCESS_TOKEN,
                    access_token_expiration=timedelta(days=3650))
                token = self.hass.auth.async_create_access_token(refresh)
            except Exception:
                await self.hass.auth.async_remove_user(user)
                raise
            record["login_user_id"] = user.id
            await self.display_store.async_save()
        return None, {"token": token, "user": user.name, "previous_user_id": previous}

    async def _settle_login(self, display_id: str, login: dict[str, Any], delivered: bool) -> None:
        """After a pairing that kept the old login: once the new token was delivered the old user goes; if not, the new user goes and the
        old login is put back, so a failed pairing leaves the display exactly as it was."""
        async with self._lock:
            record = self.display_store.displays.get(display_id)
            if record is None:
                return
            new_id = record.get("login_user_id")
            if delivered:
                await remove_user_by_id(self.hass, login.get("previous_user_id"))
            else:
                await remove_user_by_id(self.hass, new_id)
                if login.get("previous_user_id"):
                    record["login_user_id"] = login["previous_user_id"]
                else:
                    record.pop("login_user_id", None)
            await self.display_store.async_save()

    async def revoke_display_login(self, display_id: str) -> str | None:
        async with self._lock:
            record = self.display_store.displays.get(display_id)
            if record is None:
                return f"there is no display '{display_id}'"
            await self._remove_login(record)
            await self.display_store.async_save()
        return None

    async def set_display_pane(self, display_id: str, pane_id: str) -> str | None:
        """Make a display show a pane. Returns the reason it cannot, or None."""
        if display_id not in self.display_store.displays:
            return f"there is no display '{display_id}'"
        if pane_id not in self.pane_ids():
            return f"there is no pane '{pane_id}'"
        async with self._lock:
            if self.display_store.displays[display_id]["pane"] != pane_id:
                self.display_store.displays[display_id]["pane"] = pane_id
                await self.display_store.async_save()
        async_dispatcher_send(self.hass, SIGNAL_DISPLAY_UPDATED, display_id)
        return None

    # ------------------------------------------------------------------ a display's mirror (the Mirror Kiosk app's control server)
    # Home Assistant makes these calls (see mirror.py). Every method returns (problem, result): `problem` is set when the request itself
    # cannot be done (no such display, no mirror set up, a value out of range, not confirmed); otherwise `result` is a dict with
    # "ok" True/False, and on False an "error" text for when the mirror itself could not be reached or said no. Nothing here raises
    # for a mirror problem, and nothing returned contains the key (it is also scrubbed from every text as a last line of defence).

    async def mirror_connect(self, display_id: str, endpoint: Any, key: Any = None, clear_key: bool = False) -> str | None:
        """Set, change or remove the mirror address (an empty address disconnects) and, optionally, the key. Returns a problem or None."""
        if not isinstance(endpoint, str):
            return "the address must be text"
        if endpoint.strip():
            problem = mirror_lib.parse_endpoint(endpoint)[1]
            if problem:
                return f"endpoint: {problem}"
        if key is not None:
            problem = mirror_lib.key_problem(key, new=True)
            if problem:
                return problem
        async with self._lock:
            record = self.display_store.displays.get(display_id)
            if record is None:
                return f"there is no display '{display_id}'"
            self._set_endpoint(record, endpoint.strip())          # a different address drops the old key
            if clear_key or not record.get("endpoint"):
                record.pop("key", None)
            if key is not None and record.get("endpoint"):
                record["key"] = key
            await self.display_store.async_save()
        async_dispatcher_send(self.hass, SIGNAL_DISPLAY_UPDATED, display_id)
        return None

    async def pair_mirror(self, display_id: Any, endpoint: Any, code: Any, base_url: Any) -> str | None:
        """Set a mirror up from the code it shows on its screen. Returns the problem, or None when it worked.

        1. the mirror is asked whether the code is right (nothing changes yet), so a typo cannot cost a working display its login;
        2. Home Assistant makes the display's login and sends the mirror its page address, the login token and a new control key, all
           straight over the home network: the token is never shown to the builder and never put in a log or an answer;
        3. the mirror's address and key are remembered, like the Connect a mirror form does.

        The display's previous login (if it had one) is only removed once the mirror has the new one, so a pairing that fails halfway leaves
        a working display working."""
        record = self.display_store.displays.get(display_id) if isinstance(display_id, str) else None
        if record is None:
            return f"there is no display '{display_id}'"
        problem = mirror_lib.code_problem(code)
        if problem:
            return problem
        address, problem = mirror_lib.parse_endpoint(endpoint)
        if problem:
            return f"mirror address: {problem}"
        player, problem = mirror_lib.player_url(base_url, display_id)
        if problem:
            return problem
        digits = mirror_lib.clean_code(code)
        try:
            await mirror.call(self.hass, address, None, "/pair", {"code": digits, "check": 1})
        except mirror.MirrorError as err:
            return str(err)
        problem, login = await self.create_display_login(display_id, keep_previous=True)        # the old login keeps working until this one is delivered
        if problem or login is None:
            return problem or "could not make the display's login"
        key = secrets.token_urlsafe(24)
        try:
            await mirror.call(self.hass, address, None, "/pair", {"code": digits, "url": player, "token": login["token"], "key": key})
        except mirror.MirrorError as err:
            await self._settle_login(display_id, login, delivered=False)
            return str(err)
        except BaseException:
            await self._settle_login(display_id, login, delivered=False)
            raise
        await self._settle_login(display_id, login, delivered=True)
        async with self._lock:
            record = self.display_store.displays.get(display_id)
            if record is not None:
                self._set_endpoint(record, address)
                record["key"] = key
                await self.display_store.async_save()
        async_dispatcher_send(self.hass, SIGNAL_DISPLAY_UPDATED, display_id)
        return None

    def _mirror_target(self, display_id: Any) -> tuple[str | None, str | None, str | None]:
        record = self.display_store.displays.get(display_id) if isinstance(display_id, str) else None
        if record is None:
            return f"there is no display '{display_id}'", None, None
        if not record.get("endpoint"):
            return "this display has no mirror set up; connect one first", None, None
        return None, record["endpoint"], record.get("key")

    def _mirror_lock(self, display_id: str) -> asyncio.Lock:
        return self._mirror_locks.setdefault(display_id, asyncio.Lock())

    async def _mirror_run(self, display_id: Any, work) -> tuple[str | None, dict[str, Any] | None]:
        """Run `work(endpoint, key)` against the display's mirror; a mirror problem becomes {"ok": False, "error": text}."""
        problem, endpoint, key = self._mirror_target(display_id)
        if problem:
            return problem, None
        try:
            result = await work(endpoint, key)
        except mirror.MirrorError as err:
            result = {"ok": False, "error": str(err)}
        except Exception as err:  # noqa: BLE001  never raise into the caller; log only the kind of error (its text can hold the address)
            LOGGER.warning("Talking to the mirror of display %s failed unexpectedly (%s)", display_id, type(err).__name__)
            result = {"ok": False, "error": "Something unexpected went wrong talking to the mirror (see the Home Assistant log)."}
        return None, mirror_lib.scrub(result, key)

    # ------------------------------------------------------------------ audio (the mirror's own speaker, as a media player)

    AUDIO_PATHS = {"status": "/audio", "play": "/audio/play", "pause": "/audio/pause", "resume": "/audio/resume",
                   "stop": "/audio/stop", "seek": "/audio/seek", "volume": "/audio/volume"}

    async def mirror_audio(self, display_id: Any, action: str, params: dict[str, Any] | None = None) -> tuple[str | None, dict[str, Any] | None]:
        """One audio call to a display's mirror (only the fixed paths above). Returns (problem, {"ok": True, "audio": {...}} or {"ok": False, "error"})."""
        path = self.AUDIO_PATHS.get(action)
        if path is None:
            return f"unknown audio action '{action}'", None

        async def work(endpoint, key):
            data = await mirror.call(self.hass, endpoint, key, path, params)
            return {"ok": True, "audio": mirror_lib.shape_audio(data)}      # None when it was only an acknowledgement
        return await self._mirror_run(display_id, work)

    def _now(self) -> str:
        return dt_util.utcnow().isoformat(timespec="seconds")

    async def mirror_status(self, display_id: Any) -> tuple[str | None, dict[str, Any] | None]:
        """Read the mirror's live status: page, presence, and REAL measured memory, with the time it was measured and a plain verdict."""
        async def work(endpoint, key):
            status = await mirror.read_status(self.hass, endpoint, key, self._now())
            return {"ok": True, "endpoint": endpoint, "key_set": bool(key), **status, "verdict": mirror_lib.verdict(status["memory"]),
                    "measuring": self._mirror_lock(display_id).locked()}
        return await self._mirror_run(display_id, work)

    async def mirror_status_cached(self, display_id: Any) -> tuple[str | None, dict[str, Any] | None]:
        """The mirror's status. Callers that ask while a read is already running join it, so the number and the switch of one display,
        whose timers fire together, cost one call between them. A read that has finished is never reused: every poll is a fresh look."""
        running = self._status_reads.get(display_id)
        if running is not None and not running.done():
            return await asyncio.shield(running)
        task = self.hass.async_create_task(self.mirror_status(display_id))          # a tracked task, so Home Assistant waits for it on shutdown
        self._status_reads[display_id] = task
        return await asyncio.shield(task)

    async def mirror_set_presence(self, display_id: Any, enabled: Any) -> tuple[str | None, dict[str, Any] | None]:
        if not isinstance(enabled, bool):
            return "enabled must be true or false", None

        async def work(endpoint, key):
            if self._mirror_lock(display_id).locked():
                return {"ok": False, "error": "A measurement is running on this mirror; wait for it to finish (about half a minute)."}
            await mirror.call(self.hass, endpoint, key, "/presence/on" if enabled else "/presence/off")
            return {"ok": True, "presence": "on" if enabled else "off"}
        return await self._mirror_run(display_id, work)

    async def mirror_tune(self, display_id: Any, values: Any) -> tuple[str | None, dict[str, Any] | None]:
        clean, problems = mirror_lib.validate_tune(values)
        if problems:
            return "; ".join(problems), None

        async def work(endpoint, key):
            await mirror.call(self.hass, endpoint, key, "/presence/tune", clean)
            return {"ok": True, "applied": clean}
        return await self._mirror_run(display_id, work)

    async def mirror_set_brightness(self, display_id: Any, level: Any) -> tuple[str | None, dict[str, Any] | None]:
        number, problem = mirror_lib.validate_brightness(level)
        if problem:
            return problem, None

        async def work(endpoint, key):
            await mirror.call(self.hass, endpoint, key, f"/brightness/{number}")
            return {"ok": True, "brightness": number}
        return await self._mirror_run(display_id, work)

    async def mirror_measure(self, display_id: Any, confirm: Any) -> tuple[str | None, dict[str, Any] | None]:
        """Measure what presence costs: read status, turn presence off, wait, read again, and ALWAYS turn presence back on.

        Needs confirm=True (the builder asks the owner first). If presence was already off, nothing is touched. Whatever goes wrong
        after presence was switched off (the second reading fails, the request is cancelled), the `finally` below still sends
        "presence on"; if even that fails, the result says so in plain words."""
        if confirm is not True:
            return "measuring switches presence off for about half a minute; confirm to go ahead", None

        async def work(endpoint, key):
            lock = self._mirror_lock(display_id)
            if lock.locked():
                return {"ok": False, "error": "A measurement is already running on this mirror."}
            async with lock:
                before = await mirror.read_status(self.hass, endpoint, key, self._now())       # a failure here changed nothing
                if mirror_lib.presence_is_on(before) is not True:
                    return {"ok": False, "error": "Presence is already off (or the mirror does not say), so there is nothing to compare. Turn it on first. Nothing was changed."}
                failure = None
                after = None
                try:
                    await mirror.call(self.hass, endpoint, key, "/presence/off")
                    await asyncio.sleep(mirror.MEASURE_WAIT_S)
                    after = await mirror.read_status(self.hass, endpoint, key, self._now())
                    if mirror_lib.presence_is_on(after) is not False:
                        failure = "The mirror still says presence is on, so the second reading is not a fair comparison."
                        after = None
                except mirror.MirrorError as err:
                    failure = str(err)
                finally:
                    restore_problem = None
                    try:
                        await mirror.call(self.hass, endpoint, key, "/presence/on")
                    except mirror.MirrorError as err:
                        restore_problem = str(err)
                    except Exception as err:  # noqa: BLE001
                        LOGGER.warning("Turning presence back on for display %s failed unexpectedly (%s)", display_id, type(err).__name__)
                        restore_problem = "unexpected error"
            restored = restore_problem is None
            note = " Presence was switched back on." if restored else f" PRESENCE COULD NOT BE TURNED BACK ON ({restore_problem}). Turn it on yourself with the Presence switch."
            if failure or after is None:
                return {"ok": False, "error": f"The measurement did not finish: {failure or 'no second reading'}.{note}", "presence_restored": restored}
            result = {"ok": True, "presence_restored": restored, "before": before, "after": after,
                      "difference": mirror_lib.presence_cost(before, after, mirror.MEASURE_WAIT_S)}
            if not restored:
                result["error"] = note.strip()
            return result
        return await self._mirror_run(display_id, work)
