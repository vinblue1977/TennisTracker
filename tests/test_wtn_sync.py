"""WTN sync: parsing, scores, upsets and DynamoDB items, on made-up data."""

import io
import json
from decimal import Decimal
from pathlib import Path

import pytest

from wtn_sync import client
from wtn_sync.items import match_item, rating_item
from wtn_sync.parse import WtnShapeError, my_side_first, parse

ME = "TEST-ID-ME"
PAYLOAD = json.loads(Path("tests/fixtures/wtn_past.json").read_text())


def _matches():
    _, matches = parse(PAYLOAD, ME)
    return {m.match_id: m for m in matches}


@pytest.mark.parametrize(
    ("score", "won", "expected"),
    [
        ("3-6 7-6 1-0", True, "3-6 7-6 1-0"),
        ("7-5 4-2", False, "5-7 2-4"),
        ("7-6(5) 6-4", False, "6-7(5) 4-6"),
        ("7-6(7-5) 6-4", False, "6-7(5-7) 4-6"),
        ("6-0 6-0 def", False, "0-6 0-6 def"),
    ],
)
def test_my_side_first(score: str, won: bool, expected: str) -> None:
    assert my_side_first(score, won) == expected


def test_ratings_are_oldest_first_with_the_starting_estimate() -> None:
    shuffled = {"data": {"wtnPast": list(reversed(PAYLOAD["data"]["wtnPast"]))}}
    ratings, _ = parse(shuffled, ME)
    assert [r.date for r in ratings] == ["2010-01-01", "2025-08-04", "2026-05-04", "2026-05-11", "2026-06-01"]
    assert ratings[0].value == 29.1


def test_matches_are_deduplicated_newest_first_and_only_mine() -> None:
    _, matches = parse(PAYLOAD, ME)
    assert [m.match_id for m in matches] == ["wtn:m-abandoned", "wtn:m-singles", "wtn:m-default", "wtn:m-loss", "wtn:m-upset"]


def test_upset_win_has_partner_opponents_and_gap() -> None:
    m = _matches()["wtn:m-upset"]
    assert m.won and m.score == "3-6 7-6 1-0" and m.event == "Test Championships"
    assert [(p.name, p.wtn) for p in m.partners] == [("Pat Partner", 26.16)]
    assert [(p.name, p.wtn) for p in m.opponents] == [("Olly One", 23.31), ("Otto Two", 24.3)]
    assert m.upset_gap == 3.25  # (27.95 + 26.16) / 2 - (23.31 + 24.3) / 2


def test_loss_is_flipped_and_never_an_upset() -> None:
    m = _matches()["wtn:m-loss"]
    assert not m.won and m.score == "6-7(5) 4-6" and m.upset_gap is None


def test_sets_and_level_are_kept_from_your_side() -> None:
    win, loss = _matches()["wtn:m-upset"], _matches()["wtn:m-loss"]
    as_tuples = lambda m: [(s.mine, s.theirs, s.tiebreak) for s in m.sets]  # noqa: E731
    assert win.level == "LOC" and as_tuples(win) == [(3, 6, None), (7, 6, (7, 5)), (1, 0, None)]
    assert as_tuples(loss) == [(6, 7, (5, 7)), (4, 6, None)]  # flipped like the score
    assert _matches()["wtn:m-singles"].sets == () and _matches()["wtn:m-singles"].level is None


def test_default_win_has_no_opponents() -> None:
    m = _matches()["wtn:m-default"]
    assert m.won and m.opponents == () and m.partners == () and m.upset_gap is None


def test_changed_shape_raises() -> None:
    with pytest.raises(WtnShapeError):
        parse({"data": {"wtnPast": [{"type": "DOUBLE"}]}}, ME)


def test_items_use_plan_keys_and_decimals() -> None:
    ratings, matches = parse(PAYLOAD, ME)
    r = rating_item("u1", ratings[1])
    assert (r["PK"], r["SK"], r["value"]) == ("USER#u1", "RATING#WTN#DOUBLE#2025-08-04", Decimal("26.13"))
    m = match_item("u1", matches[-1])
    assert m["SK"] == "MATCH#2025-08-03#wtn:m-upset"
    assert m["upsetGap"] == Decimal("3.25") and m["opponents"][0]["wtn"] == Decimal("23.31")
    assert m["level"] == "LOC" and m["sets"][1] == {"mine": 7, "theirs": 6, "tiebreak": [7, 5]}
    assert "note" not in m  # notes live in EXTRA# items


def test_fetch_history_sends_query_and_returns_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = {}

    def fake_urlopen(request, timeout):
        sent["body"] = json.loads(request.data)
        sent["agent"] = request.get_header("User-agent")
        sent["timeout"] = timeout
        return io.BytesIO(json.dumps(PAYLOAD).encode())

    monkeypatch.setattr(client.urllib.request, "urlopen", fake_urlopen)
    assert client.fetch_history(ME, "2010-01-01", "2026-10-16") == PAYLOAD
    assert sent["body"]["variables"] == {"t": ME, "start": "2010-01-01", "end": "2026-10-16"}
    assert sent["timeout"] == client.TIMEOUT_SECONDS
    assert sent["agent"] == client.USER_AGENT  # the default Python agent gets 403


def test_fetch_history_raises_on_api_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        client.urllib.request, "urlopen", lambda request, timeout: io.BytesIO(b'{"errors": [{"message": "Not Authorised!"}]}')
    )
    with pytest.raises(client.WtnApiError, match="Not Authorised"):
        client.fetch_history(ME, "2010-01-01", "2026-10-16")


def test_fetch_history_raises_on_network_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(request, timeout):
        raise OSError("timed out")

    monkeypatch.setattr(client.urllib.request, "urlopen", boom)
    with pytest.raises(client.WtnApiError, match="timed out"):
        client.fetch_history(ME, "2010-01-01", "2026-10-16")


def test_fetch_history_requires_https() -> None:
    with pytest.raises(client.WtnApiError, match="https"):
        client.fetch_history(ME, "2010-01-01", "2026-10-16", endpoint="http://example.com/graphql")


def test_singles_use_singles_ratings() -> None:
    m = _matches()["wtn:m-singles"]
    assert m.kind == "SINGLE" and [p.wtn for p in m.opponents] == [26.0]
    assert m.upset_gap == 2.0  # 28.0 vs 26.0, singles ratings only
    assert _matches()["wtn:m-upset"].kind == "DOUBLE"


def test_no_winner_is_neither_win_nor_loss() -> None:
    m = _matches()["wtn:m-abandoned"]
    assert m.won is None and m.score == "6-4 2-1" and m.upset_gap is None
