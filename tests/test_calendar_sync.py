"""Calendar sync: ICS parsing, link safety and the handler, on made-up data."""

import io
import urllib.error
from datetime import UTC, datetime

import boto3
import pytest
from moto import mock_aws

from calendar_sync import fetch as f
from calendar_sync import handler as h
from calendar_sync.ics import parse

LINK = "webcal://p30-caldav.icloud.com/published/2/TESTTOKEN"
NOW = datetime(2026, 10, 16, 12, tzinfo=UTC)
ICS = "\r\n".join(
    [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:utc-1",
        "DTSTART:20261017T020000Z",
        "DTEND:20261017T040000Z",
        "SUMMARY:Doubles league\\, playoff",
        "LOCATION:Test Club\\nCourt 3",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:tz-2",
        "DTSTART;TZID=America/Chicago:20261017T090000",
        "DTEND;TZID=America/Chicago:20261017T103000",
        "SUMMARY:USTA match with a very long title that is",
        "  folded across lines",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:allday-3",
        "DTSTART;VALUE=DATE:20261020",
        "SUMMARY:Tournament day",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:cancelled-4",
        "DTSTART:20261018T150000Z",
        "STATUS:CANCELLED",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:past-5",
        "DTSTART:20260101T150000Z",
        "DTEND:20260101T170000Z",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
)


def test_parses_utc_timezones_all_day_folding_and_escapes() -> None:
    events = {e.uid: e for e in parse(ICS)}
    assert set(events) == {"utc-1", "tz-2", "allday-3", "past-5"}  # cancelled dropped
    assert events["utc-1"].title == "Doubles league, playoff" and events["utc-1"].location == "Test Club Court 3"
    assert events["tz-2"].start == datetime(2026, 10, 17, 14, tzinfo=UTC)  # 09:00 Chicago (CDT)
    assert events["tz-2"].title == "USTA match with a very long title that is folded across lines"
    assert events["allday-3"].all_day and events["allday-3"].end == datetime(2026, 10, 21, tzinfo=UTC)
    assert events["past-5"].title == "Tennis"


@pytest.mark.parametrize(
    "url",
    [
        "http://p30-caldav.icloud.com/published/2/x",  # not https
        "https://evil.example.com/published/2/x",
        "https://p30-caldav.icloud.com.evil.com/published/2/x",
        "https://icloud.com@evil.com/published/2/x",  # user-info trick
        "https://p30-caldav.icloud.com:8443/published/2/x",
        "https://p30-caldav.icloud.com/private/x",
        "https://169.254.169.254/latest/meta-data/",
        "file:///etc/passwd",
        "",
    ],
)
def test_rejects_anything_but_icloud_published_links(url: str) -> None:
    with pytest.raises(f.CalendarError):
        f.normalize(url)


def test_accepts_webcal_and_https_icloud_links() -> None:
    assert f.normalize(LINK) == "https://p30-caldav.icloud.com/published/2/TESTTOKEN"
    assert f.normalize("https://p7-caldav.icloud.com/published/2/X?x=1#frag") == "https://p7-caldav.icloud.com/published/2/X?x=1"


class FakeOpener:
    def __init__(self, responses: list) -> None:
        self.responses = responses
        self.urls: list[str] = []

    def open(self, request, timeout):
        self.urls.append(request.full_url)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return io.BytesIO(response)


def _redirect(to: str) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("u", 302, "Found", {"Location": to}, None)  # pyright: ignore[reportArgumentType]


def test_follows_redirects_only_to_allowed_hosts(monkeypatch: pytest.MonkeyPatch) -> None:
    ok = FakeOpener([_redirect("https://p31-caldav.icloud.com/published/2/Y"), ICS.encode()])
    monkeypatch.setattr(f.urllib.request, "build_opener", lambda *a: ok)
    assert "BEGIN:VCALENDAR" in f.fetch(LINK) and ok.urls[1].startswith("https://p31-caldav.icloud.com/")

    bad = FakeOpener([_redirect("https://evil.example.com/steal")])
    monkeypatch.setattr(f.urllib.request, "build_opener", lambda *a: bad)
    with pytest.raises(f.CalendarError):
        f.fetch(LINK)
    assert len(bad.urls) == 1  # never requested the other host


def test_rejects_huge_calendars_and_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(f.urllib.request, "build_opener", lambda *a: FakeOpener([b"x" * (f.MAX_BYTES + 1)]))
    with pytest.raises(f.CalendarError, match="too large"):
        f.fetch(LINK)
    monkeypatch.setattr(f.urllib.request, "build_opener", lambda *a: FakeOpener([OSError("timed out")]))
    with pytest.raises(f.CalendarError, match="timed out"):
        f.fetch(LINK)


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
        t.put_item(Item={"PK": "USER#owner", "SK": "PROFILE", "calendarUrl": LINK})
        t.put_item(Item={"PK": "USER#nocal", "SK": "PROFILE"})
        yield t


def _upcoming(table) -> list[str]:
    return sorted(i["SK"].split("#")[2] for i in table.scan()["Items"] if i["SK"].startswith("UPCOMING#"))


def test_sync_keeps_future_events_and_removes_cancelled_ones(table, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(h, "fetch", lambda url: ICS)
    profile = table.get_item(Key={"PK": "USER#owner", "SK": "PROFILE"})["Item"]
    assert h.sync_user(table, profile, NOW) == {"user": "USER#owner", "status": "ok", "upcoming": 3}
    assert _upcoming(table) == ["allday-3", "tz-2", "utc-1"]

    monkeypatch.setattr(h, "fetch", lambda url: ICS.replace("UID:tz-2", "UID:tz-2\r\nSTATUS:CANCELLED"))
    h.sync_user(table, profile, NOW)
    assert _upcoming(table) == ["allday-3", "utc-1"]


def test_handler_syncs_only_profiles_with_a_calendar_or_the_requested_user(table, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(h, "fetch", lambda url: ICS)
    assert [r["user"] for r in h.handler({}, None)["synced"]] == ["USER#owner"]
    assert h.handler({"user": "someone-else"}, None)["synced"] == []


def test_failures_are_recorded(table, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(url):
        raise f.CalendarError("calendar returned HTTP 404")

    monkeypatch.setattr(h, "fetch", boom)
    profile = table.get_item(Key={"PK": "USER#owner", "SK": "PROFILE"})["Item"]
    assert h.sync_user(table, profile, NOW)["failures"] == 1
    assert table.get_item(Key={"PK": "USER#owner", "SK": "SYNC#CAL"})["Item"]["status"] == "error"
