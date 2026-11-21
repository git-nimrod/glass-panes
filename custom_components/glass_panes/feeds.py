"""News feeds (RSS and Atom) for the `rss` widget: check a feed address, read a feed, and fingerprint its items.

No Home Assistant imports, so it can be tested on its own. feed_cache.py fetches (Home Assistant does it, never the display) and keeps
the result; this file only turns the bytes into a short list of stories.

Safety: a feed is untrusted text from the internet. It is refused if it is too big or declares its own entities (a DOCTYPE with
<!ENTITY>, the trick behind "billion laughs" and external-file attacks); nothing in it is ever run, and every title and summary is
turned into plain text (tags dropped, entities decoded) before a display sees it.
"""

from __future__ import annotations

import hashlib
import html
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlsplit
from xml.etree import ElementTree  # nosec B405  # parse() refuses entity declarations first, and ElementTree never fetches external ones

MAX_BYTES = 2 * 1024 * 1024          # a feed bigger than this is refused (real feeds are tens of KB)
MAX_ITEMS = 30                       # stories kept per feed
MAX_TITLE = 300
MAX_SUMMARY = 280
MAX_URL = 500

_TAG = re.compile(r"<[^>]*>")
_SPACE = re.compile(r"\s+")


class FeedError(Exception):
    """A feed that could not be read, with a plain reason (never the feed's own text)."""


def url_problem(url: Any) -> str | None:
    """None for a usable feed address (http or https, a host, no user name or password), else the reason."""
    if not isinstance(url, str) or not url.strip():
        return "a feed address is needed"
    text = url.strip()
    if len(text) > MAX_URL or any(c.isspace() for c in text):
        return "the feed address is too long or has spaces in it"
    try:
        parts = urlsplit(text)
    except ValueError:
        return "that is not a web address"
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return "a feed address starts with http:// or https://"
    if parts.username or parts.password:
        return "a feed address must not hold a user name or password"
    return None


def plain(value: Any, limit: int) -> str:
    """Text only: tags dropped, entities decoded, spaces collapsed, cut to `limit` characters (on a word where possible)."""
    if not isinstance(value, str):
        return ""
    text = _SPACE.sub(" ", html.unescape(_TAG.sub(" ", html.unescape(value)))).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0] if " " in text[: limit] else text[:limit]
    return cut.rstrip(" ,;:.-") + "…"


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower() if isinstance(tag, str) else ""


def _child(node: ElementTree.Element, *names: str) -> ElementTree.Element | None:
    for name in names:
        for child in node:
            if _local(child.tag) == name:
                return child
    return None


def _text(node: ElementTree.Element | None) -> str:
    return "".join(node.itertext()) if node is not None else ""


def _when(text: str) -> int | None:
    """A feed date (RSS's RFC 822 or Atom's ISO 8601) as Unix seconds, or None."""
    text = (text or "").strip()
    if not text:
        return None
    try:
        moment = parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError):
        try:
            moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return int(moment.timestamp())


def _link(item: ElementTree.Element) -> str:
    for child in item:
        if _local(child.tag) != "link":
            continue
        href = child.get("href")
        if href and child.get("rel", "alternate") == "alternate":
            return href.strip()
        if not href and (child.text or "").strip():
            return child.text.strip()
    guid = _child(item, "guid", "id")
    return _text(guid).strip()


def parse(body: bytes) -> dict[str, Any]:
    """Read an RSS 2.0, RSS 1.0 or Atom feed. Returns {"title", "items": [{title, link, time, summary}]}, newest first.
    Raises FeedError with a plain reason."""
    if len(body) > MAX_BYTES:
        raise FeedError("the feed is too big")
    if b"<!entity" in body.lower():
        raise FeedError("the feed declares its own entities, which is refused")
    try:
        root = ElementTree.fromstring(body)  # nosec B314  # entity declarations were refused just above
    except ElementTree.ParseError as err:
        raise FeedError("the address did not give a readable feed") from err
    if _local(root.tag) not in ("rss", "feed", "rdf"):
        raise FeedError("the address did not give an RSS or Atom feed")
    channel = _child(root, "channel") if _local(root.tag) != "feed" else root
    title = plain(_text(_child(channel, "title")) if channel is not None else "", 120)
    items = []
    for node in root.iter():
        if _local(node.tag) not in ("item", "entry"):
            continue
        headline = plain(_text(_child(node, "title")), MAX_TITLE)
        if not headline:
            continue
        summary = plain(_text(_child(node, "description", "summary", "content")), MAX_SUMMARY)
        when = _when(_text(_child(node, "pubdate", "published", "updated", "date")))
        items.append({"title": headline, "link": _link(node)[:MAX_URL], "time": when, "summary": summary})
        if len(items) >= MAX_ITEMS * 2:
            break
    if any(item["time"] for item in items):
        items.sort(key=lambda item: item["time"] or 0, reverse=True)      # stable: undated items keep the feed's own order
    return {"title": title, "items": items[:MAX_ITEMS]}


def fingerprint(items: list[dict[str, Any]]) -> str:
    """A short hash of what a display would draw: it changes only when a story is added, removed or reworded."""
    digest = hashlib.sha1(usedforsecurity=False)          # a change detector, not security
    for item in items:
        digest.update((item.get("title", "") + "\x1f" + item.get("link", "") + "\x1f" + item.get("summary", "") + "\x1e").encode("utf-8"))
    return digest.hexdigest()[:16]
