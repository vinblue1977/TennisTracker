"""Every 15 minutes: a match reminder 2 hours before the start."""

import os
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import boto3
from boto3.dynamodb.conditions import Attr, Key

from push.notify import notify

DEFAULT_ZONE = "America/Chicago"
LATE = timedelta(hours=1)  # skip a reminder that is this overdue (e.g. a match added at the last minute)


def due(start: datetime, now: datetime) -> list[str]:
    """Which reminders are due now: 'soon' (2 hours before)."""
    soon = start - timedelta(hours=2)
    return ["soon"] if soon <= now < soon + LATE and now < start else []


def message(item: dict[str, Any], zone: ZoneInfo) -> tuple[str, str]:
    start = datetime.fromisoformat(item["start"]).astimezone(zone)
    where = f" · {item['location']}" if item.get("location") else ""
    return f"In 2 hours {clock(start)}: {item['title']}", f"{start:%a %d %b}{where}"


def clock(t: datetime) -> str:
    """12-hour time like the app: 9:00pm."""
    return f"{t.hour % 12 or 12}:{t.minute:02d}{'am' if t.hour < 12 else 'pm'}"


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])  # pyright: ignore[reportAttributeAccessIssue]
    return {"sent": run(table, datetime.now(UTC))}


def run(table: Any, now: datetime) -> int:
    sent = 0
    for profile in _profiles_with_calendar(table):
        user = profile["PK"].removeprefix("USER#")
        zone = ZoneInfo(str(profile.get("timeZone") or DEFAULT_ZONE))
        items = table.query(KeyConditionExpression=Key("PK").eq(profile["PK"]) & Key("SK").begins_with("UPCOMING#"))["Items"]
        for item in items:
            if item.get("allDay"):
                continue
            for kind in due(datetime.fromisoformat(item["start"]), now):
                if kind in item.get("reminded", []):
                    continue
                # Mark first, so a retry never sends twice.
                table.update_item(
                    Key={"PK": item["PK"], "SK": item["SK"]},
                    UpdateExpression="SET reminded = list_append(if_not_exists(reminded, :empty), :kind)",
                    ExpressionAttributeValues={":empty": [], ":kind": [kind]},
                )
                title, body = message(item, zone)
                sent += notify(table, user, title, body, "/#/upcoming")
    return sent


def _profiles_with_calendar(table: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {"FilterExpression": Attr("SK").eq("PROFILE") & Attr("calendarUrl").exists()}
    while True:
        page = table.scan(**kwargs)
        found += page["Items"]
        if "LastEvaluatedKey" not in page:
            return found
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
