"""Check that a kiosk speaks the Glass Panes kiosk API (the contract in custom_components/glass_panes/schema/kiosk_api.json).

For anyone writing a kiosk for another board (for example a Linux one): run it against your kiosk on the home network.

    python check_kiosk_contract.py http://<kiosk address>:8099 [--key <key>] [--write]

It reads /status, checks the required fields, then calls every read-only path of every capability the kiosk lists (they must answer
200 with JSON), checks that read-only paths of capabilities it does NOT list answer 404, and that an unknown path answers 404 JSON.
With --write it also calls /reload and /brightness/default (both harmless: the page loads again, Android/the kiosk takes the backlight
back). Nothing else that changes the kiosk is ever called. Needs only Python 3.9+, no extra packages. Exit code 0 = meets the contract.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

CONTRACT = Path(__file__).resolve().parents[2] / "custom_components" / "glass_panes" / "schema" / "kiosk_api.json"
BOARD = re.compile(r"^[a-z0-9_.-]{1,40}$")

# fetch(url) -> (HTTP status, headers as a lower-case dict, body bytes)
Fetch = Callable[[str], "tuple[int, dict[str, str], bytes]"]


def http_fetch(url: str) -> tuple[int, dict[str, str], bytes]:
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:          # noqa: S310  an address the person typed
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read(1_000_000)
    except urllib.error.HTTPError as err:
        return err.code, {k.lower(): v for k, v in (err.headers or {}).items()}, err.read(1_000_000)


def check(base: str, contract: dict[str, Any], fetch: Fetch = http_fetch, key: str | None = None, write: bool = False) -> tuple[list[str], list[str]]:
    """(passed, problems): one plain line per check."""
    passed: list[str] = []
    problems: list[str] = []
    base = base.rstrip("/")

    def get(path: str) -> tuple[int, dict[str, str], Any]:
        url = base + path + (("&" if "?" in path else "?") + urlencode({"key": key}) if key else "")
        status, headers, body = fetch(url)
        try:
            data = json.loads(body.decode("utf-8")) if body else None
        except (UnicodeDecodeError, json.JSONDecodeError):
            data = None
        return status, headers, data

    status, headers, doc = get("/status")
    if status != 200 or not isinstance(doc, dict):
        return passed, [f"/status answered {status} without a JSON object; nothing else can be checked"]
    if "application/json" not in headers.get("content-type", ""):
        problems.append("/status: Content-Type is not application/json")
    if headers.get("access-control-allow-origin") != "*":
        problems.append("/status: no `Access-Control-Allow-Origin: *` header (the player page calls the kiosk from the page)")
    for field in contract["status"]["required"]:
        (passed if field in doc else problems).append(f"/status has `{field}`" if field in doc else f"/status has no `{field}`")
    if doc.get("ok") is not True:
        problems.append("/status `ok` is not true")
    if doc.get("platform") not in contract["status"]["platforms"]:
        problems.append(f"`platform` is {doc.get('platform')!r}; it must be one of {contract['status']['platforms']}")
    if not (isinstance(doc.get("board"), str) and BOARD.match(doc["board"])):
        problems.append("`board` must be 1 to 40 lowercase letters, digits, _ . or -")
    if doc.get("kiosk_api") != contract["kiosk_api"]:
        problems.append(f"`kiosk_api` is {doc.get('kiosk_api')!r}; this checker knows kiosk API {contract['kiosk_api']}")
    caps = doc.get("capabilities") if isinstance(doc.get("capabilities"), list) else []
    known = contract["capabilities"]
    for name, spec in known.items():
        if spec["required"] and name not in caps:
            problems.append(f"`capabilities` lacks the required `{name}`")
    for name in caps:
        if name not in known:
            problems.append(f"`capabilities` names `{name}`, which kiosk API {contract['kiosk_api']} does not have")

    for name, spec in known.items():
        reads = spec.get("read_only_paths") or (spec["paths"] if spec.get("read_only") else [])
        for path in reads:
            if path == "/status":
                continue
            code, _headers, data = get(path)
            if name in caps:
                ok = code == 200 and isinstance(data, (dict, list))
                (passed if ok else problems).append(f"{path} ({name}) answers 200 JSON" if ok else f"{path} ({name}) answered {code}, not 200 JSON")
            else:
                ok = code == 404
                (passed if ok else problems).append(f"{path} ({name}, not listed) answers 404" if ok else f"{path} answered {code}, but `{name}` is not in `capabilities` (list it, or answer 404)")

    code, _headers, data = get("/no-such-path-glass-panes-check")
    ok = code == 404 and isinstance(data, dict) and data.get("ok") is False
    (passed if ok else problems).append("an unknown path answers 404 {\"ok\":false}" if ok else f"an unknown path answered {code} {data!r}, not 404 {{\"ok\":false,...}}")

    if write:
        for path in ("/reload", "/brightness/default"):
            code, _headers, data = get(path)
            ok = code == 200 and isinstance(data, dict) and data.get("ok") is True
            (passed if ok else problems).append(f"{path} answers {{\"ok\":true}}" if ok else f"{path} answered {code} {data!r}")
    return passed, problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check a kiosk against the Glass Panes kiosk API.")
    parser.add_argument("address", help="the kiosk's control address, for example http://192.0.2.20:8099")
    parser.add_argument("--key", help="the kiosk's control key, if it has one")
    parser.add_argument("--write", action="store_true", help="also call /reload and /brightness/default")
    parser.add_argument("--contract", type=Path, default=CONTRACT, help="kiosk_api.json (default: the one in this repository)")
    args = parser.parse_args(argv)
    contract = json.loads(args.contract.read_text(encoding="utf-8"))
    passed, problems = check(args.address, contract, key=args.key, write=args.write)
    for line in passed:
        print("  ok   " + line)
    for line in problems:
        print("  FAIL " + line)
    print(f"\n{len(passed)} passed, {len(problems)} problems: " + ("meets kiosk API %d" % contract["kiosk_api"] if not problems else "does NOT meet the contract yet"))
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
