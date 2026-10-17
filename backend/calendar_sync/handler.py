"""Lambda every 15 minutes: upcoming matches from each profile's calendar link (UPCOMING# items)."""

import os
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key

from calendar_sync.fetch import CalendarError, fetch
from calendar_sync.ics import Event, parse

AHEAD = timedelta(days=120)
ALERT_AFTER_FAILURES = 96  # 15-minute runs: a full day of failures


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])  # pyright: ignore[reportAttributeAccessIssue]
    only = (event or {}).get("user")  # set when the API asks for an immediate sync
    profiles = [p for p in _profiles(table) if not only or p["PK"] == f"USER#{only}"]
    return {"synced": [sync_user(table, p) for p in profiles]}


def _profiles(table: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {"FilterExpression": Attr("SK").eq("PROFILE") & Attr("calendarUrl").exists()}
    while True:
        page = table.scan(**kwargs)
        found += page["Items"]
        if "LastEvaluatedKey" not in page:
            return found
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def sync_user(table: Any, profile: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    pk = profile["PK"]
    state_key = {"PK": pk, "SK": "SYNC#CAL"}
    previous = table.get_item(Key=state_key).get("Item", {})
    try:
        events = parse(fetch(str(profile["calendarUrl"])))
    except CalendarError as error:
        failures = int(previous.get("consecutiveFailures", 0)) + 1
        table.put_item(Item={**state_key, "status": "error", "lastRunAt": now.isoformat(), "lastError": str(error)[:300],
                             "consecutiveFailures": failures})  # fmt: skip
        if failures == ALERT_AFTER_FAILURES:
            _alert(f"Tennis Tracker: calendar sync failed for a day.\n\nLast error: {error}")
        return {"user": pk, "status": "error", "failures": failures}

    # The link may have been removed or changed while this sync was fetching: then leave the data alone.
    current = table.get_item(Key={"PK": pk, "SK": "PROFILE"}).get("Item", {})
    if current.get("calendarUrl") != profile["calendarUrl"]:
        return {"user": pk, "status": "skipped"}

    wanted = {_sk(e): _item(pk, e) for e in events if e.end >= now and e.start <= now + AHEAD}
    existing = {i["SK"] for i in _query(table, pk, "UPCOMING#")}
    with table.batch_writer() as batch:
        for sk in existing - wanted.keys():
            batch.delete_item(Key={"PK": pk, "SK": sk})  # cancelled, moved or past
        for sk, item in wanted.items():
            if sk not in existing:
                batch.put_item(Item=item)
    for sk in wanted.keys() & existing:  # update in place, keeping the reminders already sent
        item = wanted[sk]
        table.update_item(
            Key={"PK": pk, "SK": sk},
            UpdateExpression="SET title = :t, #loc = :l, #start = :s, #end = :e, allDay = :a",
            ExpressionAttributeNames={"#loc": "location", "#start": "start", "#end": "end"},
            ExpressionAttributeValues={
                ":t": item["title"],
                ":l": item["location"],
                ":s": item["start"],
                ":e": item["end"],
                ":a": item["allDay"],
            },
        )
    table.put_item(
        Item={**state_key, "status": "ok", "lastRunAt": now.isoformat(), "consecutiveFailures": 0, "upcoming": len(wanted)}
    )
    return {"user": pk, "status": "ok", "upcoming": len(wanted)}


def _sk(e: Event) -> str:
    return f"UPCOMING#{e.start.strftime('%Y-%m-%dT%H:%MZ')}#{e.uid[:200]}"


def _item(pk: str, e: Event) -> dict[str, Any]:
    return {
        "PK": pk,
        "SK": _sk(e),
        "title": e.title[:200],
        "location": e.location[:300],
        "start": e.start.isoformat(),
        "end": e.end.isoformat(),
        "allDay": e.all_day,
    }


def _query(table: Any, pk: str, prefix: str) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {"KeyConditionExpression": Key("PK").eq(pk) & Key("SK").begins_with(prefix)}
    while True:
        page = table.query(**kwargs)
        found += page["Items"]
        if "LastEvaluatedKey" not in page:
            return found
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def _alert(message: str) -> None:
    topic = os.environ.get("ALERT_TOPIC_ARN")
    if topic:
        boto3.client("sns").publish(TopicArn=topic, Subject="Tennis Tracker: calendar sync failing", Message=message)
