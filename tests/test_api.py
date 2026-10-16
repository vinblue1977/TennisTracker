"""`/me` API on fake DynamoDB (moto) with made-up data."""

import json

import boto3
import pytest
from moto import mock_aws

from api import handler as api


@pytest.fixture
def table(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-2")
    monkeypatch.setenv("TABLE_NAME", "t")
    with mock_aws():
        t = boto3.resource("dynamodb").create_table(
            TableName="t",
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
            AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"}, {"AttributeName": "SK", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        t.put_item(Item={"PK": "SUB#sub-1", "SK": "USER", "userId": "owner"})
        t.put_item(Item={"PK": "USER#owner", "SK": "PROFILE", "tennisId": "TEST-ID-ME"})
        t.put_item(Item={"PK": "USER#owner", "SK": "SYNC#WTN", "status": "ok", "matchCount": 2})
        t.put_item(Item={"PK": "USER#owner", "SK": "RATING#WTN#DOUBLE#2026-10-05", "value": 25})
        t.put_item(Item={"PK": "USER#owner", "SK": "MATCH#2026-10-02#wtn:m1", "won": True, "score": "6-3 6-2"})
        t.put_item(Item={"PK": "USER#owner", "SK": "MATCH#2026-09-26#wtn:m2", "won": False, "score": "5-7 2-4"})
        t.put_item(Item={"PK": "USER#someone", "SK": "MATCH#2026-01-01#wtn:x", "won": True})
        yield t


def call(route: str, sub: str | None = "sub-1", match_id: str | None = None, body: str | None = None) -> tuple[int, dict]:
    event: dict = {"routeKey": route, "requestContext": {}}
    if sub:
        event["requestContext"] = {"authorizer": {"jwt": {"claims": {"sub": sub}}}}
    if match_id is not None:
        event["pathParameters"] = {"id": match_id}
    if body is not None:
        event["body"] = body
    response = api.handler(event, None)
    return response["statusCode"], json.loads(response["body"])


def test_profile_masks_tennis_id_and_shows_sync(table) -> None:
    status, body = call("GET /me/profile")
    assert status == 200 and body["tennisId"] == "TES•••D-ME" and body["sync"]["status"] == "ok"


def test_ratings_and_matches_are_only_the_mapped_users(table) -> None:
    assert call("GET /me/ratings")[1]["ratings"][0]["value"] == 25
    matches = call("GET /me/matches")[1]["matches"]
    assert [m["id"] for m in matches] == ["wtn:m1", "wtn:m2"]  # newest first; never another user's
    assert matches[0]["note"] == "" and matches[0]["starred"] is False and "PK" not in matches[0]


def test_unmapped_user_sees_only_their_own_empty_data(table) -> None:
    assert call("GET /me/matches", sub="sub-2")[1]["matches"] == []


def test_extras_are_saved_and_returned_with_matches(table) -> None:
    status, _ = call("PUT /me/matches/{id}/extras", match_id="wtn:m1", body='{"note": "great comeback", "starred": true}')
    assert status == 200
    m1 = call("GET /me/matches")[1]["matches"][0]
    assert m1["note"] == "great comeback" and m1["starred"] is True


@pytest.mark.parametrize(
    ("match_id", "body", "status"),
    [
        ("../etc", "{}", 400),
        ("wtn:m1", "not json", 400),
        ("wtn:m1", "[]", 400),
        ("wtn:m1", "null", 400),
        ("wtn:m1", '"x"', 400),
        ("wtn:m1", '{"note": 5}', 400),
        ("wtn:m1", json.dumps({"note": "x" * 2001}), 400),
        ("wtn:m1", '{"starred": "yes"}', 400),
        ("wtn:x", '{"note": "not mine"}', 404),
    ],
)
def test_extras_reject_bad_input_and_other_users_matches(table, match_id: str, body: str, status: int) -> None:
    assert call("PUT /me/matches/{id}/extras", match_id=match_id, body=body)[0] == status


def test_requires_sign_in_and_known_route(table) -> None:
    assert call("GET /me/profile", sub=None)[0] == 401
    assert call("GET /admin")[0] == 404


def test_calendar_link_is_validated_saved_and_removed(table) -> None:
    assert call("PUT /me/calendar", body='{"url": "https://evil.example.com/published/2/x"}')[0] == 400
    assert call("PUT /me/calendar", body="[]")[0] == 400
    status, body = call("PUT /me/calendar", body='{"url": "webcal://p30-caldav.icloud.com/published/2/TESTTOKEN"}')
    assert status == 200 and body == {"connected": True}
    profile = table.get_item(Key={"PK": "USER#owner", "SK": "PROFILE"})["Item"]
    assert profile["calendarUrl"] == "https://p30-caldav.icloud.com/published/2/TESTTOKEN" and profile["tennisId"] == "TEST-ID-ME"
    assert call("GET /me/profile")[1]["calendar"]["connected"] is True

    table.put_item(Item={"PK": "USER#owner", "SK": "UPCOMING#2026-10-17T02:00Z#u1", "title": "League"})
    assert [u["title"] for u in call("GET /me/upcoming")[1]["upcoming"]] == ["League"]
    assert call("PUT /me/calendar", body='{"url": ""}')[1] == {"connected": False}
    assert call("GET /me/upcoming")[1]["upcoming"] == []
    assert "calendarUrl" not in table.get_item(Key={"PK": "USER#owner", "SK": "PROFILE"})["Item"]


def test_hand_entered_ratings_are_validated_saved_and_cleared(table) -> None:
    for bad in ('{"utr": 17}', '{"ntrp": 3.7}', '{"utr": "8"}', '{"utr": true}', "{}", '{"x": 1}', "[]"):
        assert call("PUT /me/ratings", body=bad)[0] == 400, bad
    assert call("PUT /me/ratings", body='{"utr": 7.25, "ntrp": 3.5}') == (200, {"utr": 7.25, "ntrp": 3.5})
    profile = call("GET /me/profile")[1]
    assert profile["utr"] == 7.25 and profile["ntrp"] == 3.5 and profile["tennisId"] == "TES•••D-ME"
    assert call("PUT /me/ratings", body='{"utr": null}')[1] == {"utr": None, "ntrp": 3.5}


def test_ratings_accept_boundaries_and_reject_off_step_values(table) -> None:
    assert call("PUT /me/ratings", body='{"utr": 1, "ntrp": 7.0}')[0] == 200
    assert call("PUT /me/ratings", body='{"utr": 16.5, "ntrp": 1.0}')[0] == 200
    assert call("PUT /me/ratings", body='{"utr": null, "ntrp": null}')[1] == {"utr": None, "ntrp": None}
    for bad in ('{"utr": 7.255}', '{"utr": NaN}', '{"ntrp": Infinity}', '{"utr": 0.99}'):
        assert call("PUT /me/ratings", body=bad)[0] == 400, bad
