"""Notifications: sending to devices, match reminders, the push API and WTN-change messages (fake AWS, made-up data)."""

import json
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import boto3
import pytest
from moto import mock_aws

from api import handler as api
from push import notify as n
from push import reminders as r
from push import webpush
from wtn_sync import handler as wtn

CHICAGO = ZoneInfo("America/Chicago")
SUB = {"endpoint": "https://web.push.apple.com/device-1", "keys": {"p256dh": "BFAKEKEY", "auth": "FAKEAUTH"}}


@pytest.fixture
def table(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-2")
    monkeypatch.setenv("TABLE_NAME", "t")
    monkeypatch.setenv("VAPID_SUBJECT", "https://example.com")
    monkeypatch.setattr(n, "_private_key", lambda: "unused")
    with mock_aws():
        t = boto3.resource("dynamodb").create_table(
            TableName="t",
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
            AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"}, {"AttributeName": "SK", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        t.put_item(Item={"PK": "SUB#sub-1", "SK": "USER", "userId": "owner"})
        t.put_item(Item={"PK": "USER#owner", "SK": "PROFILE", "calendarUrl": "https://p30-caldav.icloud.com/published/2/X"})
        yield t


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    messages: list[dict] = []

    def fake_send(sub, message, key, subject):
        if sub["endpoint"].endswith("gone"):
            raise webpush.Gone(sub["endpoint"])
        messages.append(message)

    monkeypatch.setattr(n, "send", fake_send)
    return messages


def call(route: str, body: dict | None = None, query: dict | None = None) -> tuple[int, dict]:
    event = {"routeKey": route, "requestContext": {"authorizer": {"jwt": {"claims": {"sub": "sub-1"}}}}}
    if body is not None:
        event["body"] = json.dumps(body)
    if query is not None:
        event["queryStringParameters"] = query
    response = api.handler(event, None)
    return response["statusCode"], json.loads(response["body"])


def test_notify_reaches_devices_and_drops_expired_ones(table, sent) -> None:
    for endpoint in ("https://web.push.apple.com/ok", "https://web.push.apple.com/gone"):
        table.put_item(Item={"PK": "USER#owner", "SK": n.device_key(endpoint), "subscription": {**SUB, "endpoint": endpoint}})
    assert n.notify(table, "owner", "Title", "Body", "/x") == 1
    assert sent == [{"title": "Title", "body": "Body", "url": "/x"}]
    assert [d["subscription"]["endpoint"] for d in n.devices(table, "owner")] == ["https://web.push.apple.com/ok"]


def test_one_failing_device_does_not_stop_the_rest(table, monkeypatch: pytest.MonkeyPatch) -> None:
    table.put_item(Item={"PK": "USER#owner", "SK": n.device_key(SUB["endpoint"]), "subscription": SUB})

    def boom(*args):
        raise RuntimeError("network")

    monkeypatch.setattr(n, "send", boom)
    assert n.notify(table, "owner", "T", "B") == 0


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (datetime(2026, 10, 16, 0, 59, tzinfo=UTC), []),  # 19:59 Chicago the evening before
        (datetime(2026, 10, 16, 1, 0, tzinfo=UTC), ["evening"]),  # 20:00 Chicago
        (datetime(2026, 10, 16, 2, 30, tzinfo=UTC), []),  # over an hour late: skipped
        (datetime(2026, 10, 16, 19, 0, tzinfo=UTC), ["soon"]),  # 14:00 Chicago, match at 16:00
        (datetime(2026, 10, 16, 21, 0, tzinfo=UTC), []),  # started
    ],
)
def test_reminder_times(now: datetime, expected: list[str]) -> None:
    assert r.due(datetime(2026, 10, 16, 21, 0, tzinfo=UTC), CHICAGO, now) == expected


def test_reminders_send_once_each(table, sent) -> None:
    table.put_item(Item={"PK": "USER#owner", "SK": n.device_key(SUB["endpoint"]), "subscription": SUB})
    table.put_item(
        Item={"PK": "USER#owner", "SK": "UPCOMING#2026-10-17T02:00Z#u1", "title": "League final", "location": "Test Club",
              "start": "2026-10-17T02:00:00+00:00", "end": "2026-10-17T04:00:00+00:00", "allDay": False}
    )  # fmt: skip
    evening = datetime(2026, 10, 16, 1, 5, tzinfo=UTC)  # 20:05 Chicago, the day before
    assert r.run(table, evening) == 1 and r.run(table, evening) == 0
    assert sent[0] == {"title": "Tomorrow 9:00pm: League final", "body": "Fri 16 Oct · Test Club", "url": "/#/upcoming"}
    assert r.run(table, datetime(2026, 10, 17, 0, 10, tzinfo=UTC)) == 1  # 2 hours before
    assert sent[1]["title"] == "In 2 hours 9:00pm: League final"


def test_push_api_turns_on_tests_and_turns_off(table, sent) -> None:
    assert call("PUT /me/push", {"endpoint": "https://evil.example.com/x", "keys": SUB["keys"]})[0] == 400
    assert call("PUT /me/push", {"endpoint": SUB["endpoint"]})[0] == 400  # no keys
    assert call("PUT /me/push", {**SUB, "timeZone": "America/Chicago"}) == (200, {"devices": 1})
    assert table.get_item(Key={"PK": "USER#owner", "SK": "PROFILE"})["Item"]["timeZone"] == "America/Chicago"
    assert call("GET /me/push", query={"endpoint": SUB["endpoint"]})[1] == {"devices": 1, "thisDevice": True}
    assert call("POST /me/push/test", {"endpoint": SUB["endpoint"]}) == (200, {"sent": 1})
    assert call("DELETE /me/push", {"endpoint": SUB["endpoint"]}) == (200, {"devices": 0})
    assert call("POST /me/push/test", {"endpoint": SUB["endpoint"]})[0] == 404


def test_bad_time_zone_is_ignored(table, sent) -> None:
    assert call("PUT /me/push", {**SUB, "timeZone": "Not/AZone"})[0] == 200
    assert "timeZone" not in table.get_item(Key={"PK": "USER#owner", "SK": "PROFILE"})["Item"]


def test_wtn_change_message(table, monkeypatch: pytest.MonkeyPatch) -> None:
    messages: list[tuple] = []
    monkeypatch.setattr(wtn, "notify", lambda table, user, title, body, url: messages.append((title, body)))
    wtn._notify_change(table, "owner", 25.34, 25.0, 1)
    wtn._notify_change(table, "owner", 25.0, 25.0, 0)  # nothing new: no message
    assert messages == [("World Tennis Number", "WTN 25.34 → 25.00 · 1 new match")]


@pytest.mark.parametrize(
    ("hour", "minute", "expected"), [(21, 0, "9:00pm"), (0, 5, "12:05am"), (12, 30, "12:30pm"), (9, 0, "9:00am")]
)
def test_clock_is_12_hour(hour: int, minute: int, expected: str) -> None:
    assert r.clock(datetime(2026, 10, 16, hour, minute, tzinfo=UTC)) == expected
