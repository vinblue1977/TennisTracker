"""Turns a `wtnPast` response into ratings and matches, seen from the player's side."""

import re
from dataclasses import dataclass
from statistics import mean
from typing import Any

UPSET_GAP = 0.5  # a win is an upset when your team's average WTN was at least this much worse (higher)
_SET = re.compile(r"^(\d+)-(\d+)(?:\((\d+)(?:-(\d+))?\))?$")


class WtnShapeError(Exception):
    """The API answered, but not in the expected shape: it may have changed."""


@dataclass(frozen=True)
class Rating:
    date: str
    kind: str  # SINGLE or DOUBLE
    value: float
    confidence: float | None
    source: str | None


@dataclass(frozen=True)
class Player:
    tennis_id: str | None
    name: str
    wtn: float | None  # going into the match


@dataclass(frozen=True)
class SetScore:
    mine: int
    theirs: int
    tiebreak: tuple[int, int] | None  # points, yours first; None when the set had no tiebreak


@dataclass(frozen=True)
class Match:
    match_id: str
    date: str
    event: str
    kind: str  # SINGLE or DOUBLE
    won: bool | None  # None: no winner recorded (e.g. abandoned)
    score: str  # your side first
    status: str | None
    partners: tuple[Player, ...]
    opponents: tuple[Player, ...]
    upset_gap: float | None  # set only for upset wins
    sets: tuple[SetScore, ...]  # your side first; empty when the API gave no set detail
    level: str | None  # ITF code, e.g. LOC, DIS, REC


def my_side_first(score: str, won: bool | None) -> str:
    """WTN writes scores winner first; flips each set (and tiebreak points) for a loss."""
    if won is not False:
        return score
    parts = []
    for part in score.split():
        m = _SET.match(part)
        if not m:
            parts.append(part)
            continue
        a, b, tb_a, tb_b = m.groups()
        tiebreak = "" if tb_a is None else f"({tb_a})" if tb_b is None else f"({tb_b}-{tb_a})"
        parts.append(f"{b}-{a}{tiebreak}")
    return " ".join(parts)


def _sets(raw: list[dict[str, Any]] | None, won: bool | None) -> tuple[SetScore, ...]:
    """The API lists every set from the match winner's side, so a loss swaps them (as `my_side_first` does).

    Tiebreak points are assumed to follow the same side. The API has returned none for this player yet,
    so the UI shows only the lower number, which is right either way.
    """
    sets = []
    for s in raw or []:
        a, b = s["winnerGamesWon"], s["loserGamesWon"]
        tb = s.get("tiebreaker")
        points = (tb["winnerPointsWon"], tb["loserPointsWon"]) if tb else None
        if won is False:
            a, b = b, a
            points = points and (points[1], points[0])
        sets.append(SetScore(a, b, points))
    return tuple(sets)


def parse(payload: dict[str, Any], tennis_id: str) -> tuple[list[Rating], list[Match]]:
    try:
        entries = payload["data"]["wtnPast"]
        ratings = [
            Rating(e["ratingDate"][:10], e["type"], float(e["tennisNumber"]), e.get("confidence"), e.get("source"))
            for e in entries
        ]
        matches: dict[str, Match] = {}
        for entry in entries:
            for raw in entry.get("matchUps") or []:
                match = _match(raw, tennis_id)
                if match:
                    matches[match.match_id] = match
    except (KeyError, TypeError, ValueError) as error:
        raise WtnShapeError(f"unexpected response shape: {error!r}") from error
    # The API's order isn't chronological: ratings oldest first, matches newest first.
    return sorted(ratings, key=lambda r: r.date), sorted(matches.values(), key=lambda m: m.date, reverse=True)


def _match(raw: dict[str, Any], tennis_id: str) -> Match | None:
    # Singles or doubles from the slots per side (a slot may have no person, e.g. a default).
    kind = "DOUBLE" if max((len(s["players"]) for s in raw["sides"]), default=0) > 1 else "SINGLE"
    wtn = {w["personId"]: float(w["tennisNumber"]) for w in raw.get("worldTennisNumbers") or [] if w["type"] == kind}
    sides = {s["sideNumber"]: [p["person"] for p in s["players"] if p.get("person")] for s in raw["sides"]}
    mine = next((n for n, people in sides.items() if any(p.get("tennisID") == tennis_id for p in people)), None)
    if mine is None:
        return None  # not this player's match
    won = None if not raw.get("winningSide") else raw["winningSide"] == mine

    def player(p: dict[str, Any]) -> Player:
        name = f"{p.get('standardGivenName') or ''} {p.get('standardFamilyName') or ''}".strip()
        return Player(p.get("tennisID"), name, wtn.get(p["id"]))

    partners = tuple(player(p) for p in sides[mine] if p.get("tennisID") != tennis_id)
    opponents = tuple(player(p) for n, people in sides.items() if n != mine for p in people)
    my_team = [wtn.get(p["id"]) for p in sides[mine]]
    their_team = [wtn.get(p["id"]) for n, people in sides.items() if n != mine for p in people]
    upset_gap = None
    if won and their_team and None not in my_team and None not in their_team:
        gap = round(mean(my_team) - mean(their_team), 2)  # pyright: ignore[reportArgumentType]
        upset_gap = gap if gap >= UPSET_GAP else None
    return Match(
        match_id=f"wtn:{raw['id']}",
        date=raw["start"][:10],
        event=(raw.get("tournament") or {}).get("name") or "",
        kind=kind,
        won=won,
        score=my_side_first((raw.get("score") or {}).get("scoreString") or "", won),
        status=raw.get("status"),
        partners=partners,
        opponents=opponents,
        upset_gap=upset_gap,
        sets=_sets((raw.get("score") or {}).get("sets"), won),
        level=raw.get("tournamentLevel"),
    )
