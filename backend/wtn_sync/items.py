"""DynamoDB items for ratings and matches (the plan's single-table keys)."""

from decimal import Decimal
from typing import Any

from wtn_sync.parse import Match, Player, Rating


def _num(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(str(value))


def _player(p: Player) -> dict[str, Any]:
    return {"tennisId": p.tennis_id, "name": p.name, "wtn": _num(p.wtn)}


def rating_item(user_id: str, r: Rating) -> dict[str, Any]:
    return {
        "PK": f"USER#{user_id}",
        "SK": f"RATING#WTN#{r.kind}#{r.date}",
        "value": _num(r.value),
        "confidence": _num(r.confidence),
        "source": r.source,
    }


def match_item(user_id: str, m: Match) -> dict[str, Any]:
    # Notes, stars and ranks live in separate EXTRA# items, so re-syncing never overwrites them.
    return {
        "PK": f"USER#{user_id}",
        "SK": f"MATCH#{m.date}#{m.match_id}",
        "source": "WTN",
        "event": m.event,
        "won": m.won,
        "score": m.score,
        "status": m.status,
        "partners": [_player(p) for p in m.partners],
        "opponents": [_player(p) for p in m.opponents],
        "upsetGap": _num(m.upset_gap),
    }
