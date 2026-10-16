"""Doubles matches logged by hand in the app (id `local:<hex>`)."""

import json
import re
import uuid
from datetime import date
from typing import Any

LOCAL_ID = re.compile(r"^local:[0-9a-f]{16}$")


def _name(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and 1 <= len(value.strip()) <= 60 else None


def parse(body: str | None) -> dict[str, Any] | str:
    """Validated {event, date, partner, opponents, score, won}, or an error message."""
    try:
        data = json.loads(body or "{}")
    except ValueError:
        return "body must be JSON"
    if not isinstance(data, dict):
        return "body must be a JSON object"
    event, day, score, won = data.get("event"), data.get("date"), data.get("score"), data.get("won")
    if not (isinstance(event, str) and 1 <= len(event.strip()) <= 100):
        return "event: 1 to 100 characters"
    try:
        if not (isinstance(day, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", day)):
            raise ValueError(day)
        date.fromisoformat(day)
    except ValueError:
        return "date: YYYY-MM-DD"
    partner = _name(data.get("partner"))
    if not partner:
        return "partner: 1 to 60 characters"
    raw = data.get("opponents")
    opponents = [_name(n) for n in raw] if isinstance(raw, list) and 1 <= len(raw) <= 2 else []
    if not opponents or None in opponents:
        return "opponents: 1 or 2 names of 1 to 60 characters"
    if not (isinstance(score, str) and 1 <= len(score.strip()) <= 40):
        return "score: 1 to 40 characters"
    if won is not None and not isinstance(won, bool):
        return "won: true, false or null"
    return {"event": event.strip(), "date": day, "partner": partner, "opponents": opponents, "score": score.strip(), "won": won}


def new_id() -> str:
    return "local:" + uuid.uuid4().hex[:16]


def item(user: str, match_id: str, m: dict[str, Any]) -> dict[str, Any]:
    def player(name: str) -> dict[str, Any]:
        return {"tennisId": None, "name": name, "wtn": None}

    return {
        "PK": f"USER#{user}",
        "SK": f"MATCH#{m['date']}#{match_id}",
        "source": "LOCAL",
        "event": m["event"],
        "kind": "DOUBLE",
        "won": m["won"],
        "score": m["score"],
        "status": None,
        "partners": [player(m["partner"])],
        "opponents": [player(n) for n in m["opponents"]],
        "upsetGap": None,
    }
