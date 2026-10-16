"""Trophies: ones added by hand, plus suggestions from WTN events won in every match."""

import hashlib
import json
import re
import uuid
from collections import Counter
from datetime import date
from typing import Any

MAX_TROPHIES = 200
RESULTS = ("winner", "finalist")
TROPHY_ID = re.compile(r"^t[0-9a-f]{12}$")


def parse(body: str | None) -> dict[str, Any] | str:
    """Validated {event, date, result, note, suggestion?}, or an error message."""
    try:
        data = json.loads(body or "{}")
    except ValueError:
        return "body must be JSON"
    if not isinstance(data, dict):
        return "body must be a JSON object"
    event, day, result, note = (data.get(k, "") for k in ("event", "date", "result", "note"))
    suggestion = data.get("suggestion")
    if not (isinstance(event, str) and 1 <= len(event.strip()) <= 100):
        return "event: 1 to 100 characters"
    try:
        date.fromisoformat(day)
    except TypeError, ValueError:
        return "date: YYYY-MM-DD"
    if result not in RESULTS:
        return "result: winner or finalist"
    if not isinstance(note, str) or len(note) > 200:
        return "note: up to 200 characters"
    if suggestion is not None and not (isinstance(suggestion, str) and len(suggestion) <= 200):
        return "suggestion: text up to 200 characters"
    out = {"event": event.strip(), "date": day, "result": result, "note": note.strip()}
    return {**out, "suggestion": suggestion} if suggestion else out


def new_id() -> str:
    return "t" + uuid.uuid4().hex[:12]


def key(user: str, trophy_id: str, day: str) -> dict[str, str]:
    return {"PK": f"USER#{user}", "SK": f"TROPHY#{day}#{trophy_id}"}


def dismissal(user: str, suggestion: str) -> dict[str, str]:
    return {"PK": f"USER#{user}", "SK": f"DISMISSED#{hashlib.sha256(suggestion.encode()).hexdigest()[:16]}"}


def public(item: dict[str, Any]) -> dict[str, Any]:
    day, trophy_id = item["SK"].split("#", 2)[1:]
    return {"id": trophy_id, "date": day, **{k: item.get(k, "") for k in ("event", "result", "note")}}


def suggestions(matches: list[dict[str, Any]], trophies: list[dict[str, Any]], dismissed: set[str]) -> list[dict[str, Any]]:
    """Events (per year) where every match was won, at least two; not already added or dismissed."""
    taken = {t["suggestion"] for t in trophies if t.get("suggestion")}
    groups: dict[str, list[dict[str, Any]]] = {}
    for m in matches:
        if m.get("event"):
            groups.setdefault(f"{m['SK'].split('#')[1][:4]}#{m['event']}", []).append(m)
    found = []
    for group_id, ms in groups.items():
        sk = hashlib.sha256(group_id.encode()).hexdigest()[:16]
        if len(ms) < 2 or not all(m.get("won") is True for m in ms) or group_id in taken or sk in dismissed:
            continue
        last = max(ms, key=lambda m: m["SK"])
        partners = Counter(p["name"] for m in ms for p in m.get("partners", []) if p.get("name"))
        found.append(
            {
                "id": group_id,
                "event": last["event"],
                "date": last["SK"].split("#")[1],
                "matches": len(ms),
                "partner": partners.most_common(1)[0][0] if partners else "",
            }
        )
    return sorted(found, key=lambda s: s["date"], reverse=True)
