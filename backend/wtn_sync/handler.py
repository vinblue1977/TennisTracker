"""Daily Lambda: syncs WTN for every profile with a TennisID and records the result."""

import os
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr

from push.notify import notify
from wtn_sync.client import WtnApiError, fetch_history
from wtn_sync.items import match_item, rating_item
from wtn_sync.parse import WtnShapeError, parse

ALERT_AFTER_FAILURES = 3
START_DATE = "2010-01-01"  # before any WTN rating


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])  # pyright: ignore[reportAttributeAccessIssue]
    return {"synced": [sync_user(table, p) for p in profiles(table)]}


def profiles(table: Any) -> list[dict[str, Any]]:
    """All profiles with a TennisID; pages through the scan (each page reads at most 1 MB before filtering)."""
    found: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {"FilterExpression": Attr("SK").eq("PROFILE") & Attr("tennisId").exists()}
    while True:
        page = table.scan(**kwargs)
        found += page["Items"]
        if "LastEvaluatedKey" not in page:
            return found
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def sync_user(table: Any, profile: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    pk = profile["PK"]
    user_id = pk.removeprefix("USER#")
    previous = table.get_item(Key={"PK": pk, "SK": "SYNC#WTN"}).get("Item", {})
    end = (now + timedelta(days=1)).date().isoformat()
    try:
        ratings, matches = parse(fetch_history(str(profile["tennisId"]), START_DATE, end), str(profile["tennisId"]))
    except (WtnApiError, WtnShapeError) as error:
        failures = int(previous.get("consecutiveFailures", 0)) + 1
        table.put_item(Item={**previous, "PK": pk, "SK": "SYNC#WTN", "status": "error", "lastRunAt": now.isoformat(),
                             "lastError": str(error)[:500], "consecutiveFailures": failures})  # fmt: skip
        if failures == ALERT_AFTER_FAILURES:
            _alert(f"Tennis Tracker: WTN sync failed {failures} days in a row.\n\nLast error: {error}")
        return {"user": user_id, "status": "error", "failures": failures}

    with table.batch_writer() as batch:
        for r in ratings:
            batch.put_item(Item=rating_item(user_id, r))
        for m in matches:
            batch.put_item(Item=match_item(user_id, m))
    latest = ratings[-1] if ratings else None
    new_matches = len(matches) - int(previous.get("matchCount", 0))
    table.put_item(
        Item={
            "PK": pk,
            "SK": "SYNC#WTN",
            "status": "ok",
            "lastRunAt": now.isoformat(),
            "consecutiveFailures": 0,
            "matchCount": len(matches),
            "latestDate": latest.date if latest else None,
            "latestValue": rating_item(user_id, latest)["value"] if latest else None,
        }
    )
    changed = bool(latest and latest.date != previous.get("latestDate")) or new_matches > 0
    if changed and previous:  # not on the very first import
        _notify_change(table, user_id, previous.get("latestValue"), latest.value if latest else None, max(new_matches, 0))
    return {"user": user_id, "status": "ok", "matches": len(matches), "newMatches": max(new_matches, 0), "changed": changed}


def _notify_change(table: Any, user_id: str, before: Any, after: float | None, new_matches: int) -> None:
    parts = []
    if after is not None and before is not None and float(before) != after:
        parts.append(f"WTN {float(before):.2f} → {after:.2f}")
    if new_matches:
        parts.append(f"{new_matches} new match{'es' if new_matches > 1 else ''}")
    if parts:
        notify(table, user_id, "World Tennis Number", " · ".join(parts), "/")


def _alert(message: str) -> None:
    topic = os.environ.get("ALERT_TOPIC_ARN")
    if topic:
        boto3.client("sns").publish(TopicArn=topic, Subject="Tennis Tracker: WTN sync failing", Message=message)
