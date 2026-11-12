"""Icon paths on request: Home Assistant looks up only the icons a display asks for and sends just those.

The Material Design Icons are kept as data files on disk (player/icons/<first letter>.json, see scripts/build_icons.py). A display used
to download a whole letter file (the biggest is about 400 KB) and keep it in memory to draw one icon. Now it asks
`/glass_panes/icons?names=home,thermometer` and gets back a few hundred bytes, so the mirror never holds icon data it does not draw.

No Home Assistant imports, so the dev preview server can load this file by itself. The answer is public icon geometry (Apache 2.0),
served without a login like the other player files.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
MAX_NAMES = 64           # per request: a pane rarely uses more than a handful, the builder's picker asks for up to 60
MAX_NAME_LENGTH = 64


def shard_of(name: str) -> str:
    """The data file an icon lives in: its first letter, or `0` for names that start with a digit."""
    return name[0] if name[0].isalpha() else "0"


def parse_names(raw: str) -> list[str]:
    """The valid, distinct icon names in a comma-separated list (invalid ones are dropped; at most MAX_NAMES are kept)."""
    seen: dict[str, None] = {}
    for part in str(raw or "").split(","):
        name = part.strip()
        if name and len(name) <= MAX_NAME_LENGTH and NAME.match(name):
            seen[name] = None
        if len(seen) >= MAX_NAMES:
            break
    return list(seen)


class IconLibrary:
    """Reads icon path data from the shard files, keeping each shard in memory once it has been read (on Home Assistant, which has room;
    the display only ever receives the paths it asked for). `paths` reads files, so call it off the event loop."""

    def __init__(self, folder: Path) -> None:
        self._folder = folder
        self._shards: dict[str, dict[str, str]] = {}

    def _shard(self, key: str) -> dict[str, str]:
        if key not in self._shards:
            try:
                data = json.loads((self._folder / f"{key}.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                data = {}
            self._shards[key] = data if isinstance(data, dict) else {}
        return self._shards[key]

    def paths(self, names: list[str]) -> dict[str, str]:
        """{name: path} for the names that exist. An unknown name is simply left out."""
        found: dict[str, str] = {}
        for name in names:
            path = self._shard(shard_of(name)).get(name)
            if isinstance(path, str):
                found[name] = path
        return found
