"""Where things are kept: Home Assistant's own storage (config/.storage/glass_panes.*).

- glass_panes.bindings  which entity feeds which widget (see bindings.py)
- glass_panes.panes     panes saved from the builder (the shipped examples are files and are not copied here)
- glass_panes.displays  the displays and which pane each is showing
- glass_panes.media     the index of uploaded images and videos (the files themselves are in config/glass_panes/media/)
- glass_panes.drafts    panes an agent is still building (a draft becomes a saved pane when the agent finishes it)
- glass_panes.groups    reusable widget groups you saved from the builder (see groups.py)
"""

from __future__ import annotations

import copy
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from . import bindings as bindings_lib
from . import displays as displays_lib
from . import groups as groups_lib
from . import media as media_lib
from .const import DOMAIN, LOGGER

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.bindings"          # kept under this name so existing installs keep their bindings
PANES_KEY = f"{DOMAIN}.panes"
DISPLAYS_KEY = f"{DOMAIN}.displays"
MEDIA_KEY = f"{DOMAIN}.media"
DRAFTS_KEY = f"{DOMAIN}.drafts"
GROUPS_KEY = f"{DOMAIN}.groups"


class BindingsStore:
    """The current bindings document, loaded once and saved whenever it is replaced."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY, private=True)
        self.data: dict[str, Any] = bindings_lib.empty()

    async def async_load(self) -> None:
        stored = await self._store.async_load()
        if stored is None:
            return
        problems = bindings_lib.validate(stored)
        if problems:
            # keep running with nothing bound rather than half-trusting a damaged file
            LOGGER.warning("Stored bindings are not valid and were ignored: %s", "; ".join(problems[:5]))
            return
        self.data = stored

    async def async_set(self, document: Any) -> list[str]:
        """Replace everything. Returns the problems found; nothing is saved if there are any."""
        problems = bindings_lib.validate(document)
        if problems:
            return problems
        self.data = copy.deepcopy(document)
        await self._store.async_save(self.data)
        return []


class PaneStore:
    """Panes saved from the builder, by id. A saved pane with the id of a shipped one replaces it."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, PANES_KEY)
        self.panes: dict[str, dict[str, Any]] = {}

    async def async_load(self, check) -> None:
        """`check(pane) -> list of problems` is applied to everything read back; damaged panes are skipped, not trusted."""
        stored = await self._store.async_load()
        if not isinstance(stored, dict) or not isinstance(stored.get("panes"), dict):
            return
        for pane_id, pane in stored["panes"].items():
            problems = check(pane)
            if problems or not isinstance(pane, dict) or pane.get("id") != pane_id:
                LOGGER.warning("Saved pane '%s' is not valid and was ignored: %s", pane_id, "; ".join(problems[:3]))
                continue
            self.panes[pane_id] = pane

    async def _save(self) -> None:
        await self._store.async_save({"schema_version": 1, "panes": self.panes})

    async def async_put(self, pane: dict[str, Any]) -> None:
        self.panes[pane["id"]] = copy.deepcopy(pane)
        await self._save()

    async def async_remove(self, pane_id: str) -> bool:
        if pane_id not in self.panes:
            return False
        del self.panes[pane_id]
        await self._save()
        return True


class DisplayStore:
    """The displays: id -> {name, timezone, pane, and optionally login_user_id, endpoint, key}.

    `private=True` makes Home Assistant write the file readable by its own user only, because it can hold a mirror's key."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, DISPLAYS_KEY, private=True)
        self.displays: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> None:
        stored = await self._store.async_load()
        if stored is None:
            return
        problems = displays_lib.validate_document(stored)
        if problems:
            LOGGER.warning("Stored displays are not valid and were ignored: %s", "; ".join(problems[:5]))
            return
        self.displays = stored["displays"]

    async def async_save(self) -> None:
        await self._store.async_save({"schema_version": displays_lib.SCHEMA_VERSION, "displays": self.displays})


class MediaStore:
    """The index of uploaded media: id -> {id, name, kind, ext, size, created}."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, MEDIA_KEY)
        self.media: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> None:
        stored = await self._store.async_load()
        if stored is None:
            return
        problems = media_lib.validate_document(stored)
        if problems:
            LOGGER.warning("Stored media index is not valid and was ignored: %s", "; ".join(problems[:5]))
            return
        self.media = stored["media"]

    async def _save(self) -> None:
        await self._store.async_save({"schema_version": 1, "media": self.media})

    async def async_put(self, record: dict[str, Any]) -> None:
        self.media[record["id"]] = record
        await self._save()

    async def async_remove(self, media_id: str) -> bool:
        if media_id not in self.media:
            return False
        del self.media[media_id]
        await self._save()
        return True


class DraftStore:
    """Panes an agent is still building. A draft is {id, name, target, pane, bindings, created, updated}; it is not shown on any display
    and does not appear in the pane list until it is finished (see Manager.finish_draft)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, DRAFTS_KEY)
        self.drafts: dict[str, dict[str, Any]] = {}

    async def async_load(self, check) -> None:
        """`check(pane) -> problems` is applied to every draft's pane; a damaged draft is dropped, not trusted."""
        stored = await self._store.async_load()
        if not isinstance(stored, dict) or not isinstance(stored.get("drafts"), dict):
            return
        for draft_id, draft in stored["drafts"].items():
            if not isinstance(draft, dict) or not isinstance(draft.get("pane"), dict) or not isinstance(draft.get("bindings", {}), dict):
                LOGGER.warning("A saved draft '%s' is not valid and was dropped", draft_id)
                continue
            problems = check(draft["pane"])
            if problems:
                LOGGER.warning("A saved draft '%s' is not valid and was dropped: %s", draft_id, "; ".join(problems[:3]))
                continue
            self.drafts[draft_id] = draft

    async def async_save(self) -> None:
        await self._store.async_save({"schema_version": 1, "drafts": self.drafts})


class GroupStore:
    """Reusable widget groups, by id (see groups.py). Loaded the first time they are needed."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, GROUPS_KEY, private=True)      # private: may hold your entity ids
        self.groups: dict[str, dict[str, Any]] = {}
        self.loaded = False

    async def async_load(self) -> None:
        """Read the saved groups. `loaded` becomes true only once the read has worked: if it raises, nothing is marked loaded, so the next
        save cannot write a list that is missing everything stored before."""
        stored = await self._store.async_load()
        if isinstance(stored, dict) and isinstance(stored.get("groups"), dict):
            for group_id, group in stored["groups"].items():
                if groups_lib.is_stored_group(group_id, group):
                    self.groups[group_id] = group
                else:
                    LOGGER.warning("A saved widget group is not valid and was ignored: %s", group_id)
        self.loaded = True

    async def _save(self) -> None:
        await self._store.async_save({"schema_version": 1, "groups": self.groups})

    async def async_put(self, group: dict[str, Any]) -> None:
        self.groups[group["id"]] = copy.deepcopy(group)
        await self._save()

    async def async_remove(self, group_id: str) -> bool:
        if group_id not in self.groups:
            return False
        del self.groups[group_id]
        await self._save()
        return True
