"""HTTP API Lambda: the signed-in user's profile, ratings and matches."""

import json
import os
import re
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import boto3
from boto3.dynamodb.conditions import Key

from calendar_sync.fetch import CalendarError, normalize
from push.notify import device_key, devices, notify
from push.webpush import allowed_endpoint

MAX_NOTE = 2000
MATCH_ID = re.compile(r"^(wtn|local):[\w.-]{1,80}$")


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])  # pyright: ignore[reportAttributeAccessIssue]
    try:
        sub = event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
    except KeyError:
        return _json(401, {"error": "unauthorized"})
    user = _user_id(table, sub)
    route = event.get("routeKey", "")
    if route == "GET /me/profile":
        return _json(200, _profile(table, user))
    if route == "GET /me/ratings":
        return _json(200, {"ratings": _items(table, user, "RATING#")})
    if route == "GET /me/matches":
        return _json(200, {"matches": _matches(table, user)})
    if route == "GET /me/upcoming":
        return _json(200, {"upcoming": [_public(i) for i in _items(table, user, "UPCOMING#")]})
    if route in ("GET /me/push", "PUT /me/push", "DELETE /me/push", "POST /me/push/test"):
        return _push(table, user, route, event)
    if route == "PUT /me/calendar":
        return _put_calendar(table, user, event.get("body"))
    if route == "PUT /me/matches/{id}/extras":
        return _put_extras(table, user, (event.get("pathParameters") or {}).get("id", ""), event.get("body"))
    return _json(404, {"error": "not found"})


def _user_id(table: Any, sub: str) -> str:
    """Accounts can map to an existing data owner (SUB#<sub> -> userId); otherwise the Cognito sub is the id."""
    item = table.get_item(Key={"PK": f"SUB#{sub}", "SK": "USER"}).get("Item")
    return str(item["userId"]) if item else sub


def _items(table: Any, user: str, prefix: str) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {"KeyConditionExpression": Key("PK").eq(f"USER#{user}") & Key("SK").begins_with(prefix)}
    while True:
        page = table.query(**kwargs)
        found += page["Items"]
        if "LastEvaluatedKey" not in page:
            return found
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def _profile(table: Any, user: str) -> dict[str, Any]:
    profile = table.get_item(Key={"PK": f"USER#{user}", "SK": "PROFILE"}).get("Item", {})
    sync = table.get_item(Key={"PK": f"USER#{user}", "SK": "SYNC#WTN"}).get("Item", {})
    tennis_id = str(profile.get("tennisId", ""))
    calendar = table.get_item(Key={"PK": f"USER#{user}", "SK": "SYNC#CAL"}).get("Item", {})
    return {
        "tennisId": f"{tennis_id[:3]}•••{tennis_id[-4:]}" if tennis_id else None,  # masked
        "calendar": {"connected": "calendarUrl" in profile, **{k: calendar.get(k) for k in ("status", "lastRunAt", "upcoming")}},
        "sync": {k: sync.get(k) for k in ("status", "lastRunAt", "latestDate", "latestValue", "matchCount")},
    }


def _matches(table: Any, user: str) -> list[dict[str, Any]]:
    extras = {i["SK"].removeprefix("EXTRA#"): i for i in _items(table, user, "EXTRA#")}
    matches = []
    for item in _items(table, user, "MATCH#"):
        match_id = item["SK"].split("#", 2)[2]
        extra = extras.get(match_id, {})
        matches.append({**_public(item), "id": match_id, "note": extra.get("note", ""), "starred": bool(extra.get("starred"))})
    return sorted(matches, key=lambda m: m["SK"], reverse=True)


def _put_extras(table: Any, user: str, match_id: str, body: str | None) -> dict[str, Any]:
    if not MATCH_ID.match(match_id):
        return _json(400, {"error": "bad match id"})
    try:
        data = json.loads(body or "{}")
    except ValueError:
        return _json(400, {"error": "body must be JSON"})
    if not isinstance(data, dict):
        return _json(400, {"error": "body must be a JSON object"})
    note, starred = data.get("note", ""), data.get("starred", False)
    if not isinstance(note, str) or len(note) > MAX_NOTE or not isinstance(starred, bool):
        return _json(400, {"error": f"note: text up to {MAX_NOTE} characters; starred: true or false"})
    exists = _items(table, user, "MATCH#")
    if not any(i["SK"].endswith(f"#{match_id}") for i in exists):
        return _json(404, {"error": "no such match"})
    table.put_item(Item={"PK": f"USER#{user}", "SK": f"EXTRA#{match_id}", "note": note, "starred": starred})
    return _json(200, {"id": match_id, "note": note, "starred": starred})


def _put_calendar(table: Any, user: str, body: str | None) -> dict[str, Any]:
    try:
        data = json.loads(body or "{}")
        if not isinstance(data, dict) or not isinstance(data.get("url"), str):
            raise KeyError("url")
        url = normalize(data["url"]) if data["url"] else None  # empty string disconnects
    except (ValueError, KeyError, CalendarError) as error:
        return _json(400, {"error": str(error) if isinstance(error, CalendarError) else 'body must be {"url": "webcal://…"}'})
    key = {"PK": f"USER#{user}", "SK": "PROFILE"}
    if url:
        table.update_item(Key=key, UpdateExpression="SET calendarUrl = :u", ExpressionAttributeValues={":u": url})
        function = os.environ.get("CALENDAR_FUNCTION")
        if function:  # sync now rather than at the next hourly run
            boto3.client("lambda").invoke(FunctionName=function, InvocationType="Event", Payload=json.dumps({"user": user}))
    else:
        table.update_item(Key=key, UpdateExpression="REMOVE calendarUrl")
        for item in _items(table, user, "UPCOMING#"):
            table.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
    return _json(200, {"connected": bool(url)})


def _push(table: Any, user: str, route: str, event: dict[str, Any]) -> dict[str, Any]:
    """Notifications on this device: status (GET), turn on (PUT), turn off (DELETE), test (POST)."""
    if route == "GET /me/push":
        endpoint = (event.get("queryStringParameters") or {}).get("endpoint", "")
        mine = devices(table, user)
        return _json(200, {"devices": len(mine), "thisDevice": any(d["SK"] == device_key(endpoint) for d in mine)})
    try:
        data = json.loads(event.get("body") or "{}")
        if not isinstance(data, dict):
            raise ValueError
    except ValueError:
        return _json(400, {"error": "body must be a JSON object"})
    endpoint = data.get("endpoint")
    if not isinstance(endpoint, str) or len(endpoint) > 1000 or not allowed_endpoint(endpoint):
        return _json(400, {"error": "not a known push service"})
    key = {"PK": f"USER#{user}", "SK": device_key(endpoint)}
    if route == "DELETE /me/push":
        table.delete_item(Key=key)
        return _json(200, {"devices": len(devices(table, user))})
    if route == "POST /me/push/test":
        if "Item" not in table.get_item(Key=key):
            return _json(404, {"error": "notifications are not on for this device"})
        return _json(200, {"sent": notify(table, user, "Tennis", "Notifications work on this device.", "/#/me")})
    keys = data.get("keys")
    if not (isinstance(keys, dict) and all(isinstance(keys.get(k), str) and 0 < len(keys[k]) <= 200 for k in ("p256dh", "auth"))):
        return _json(400, {"error": "subscription keys missing"})
    zone = data.get("timeZone")
    try:
        ZoneInfo(zone) if isinstance(zone, str) and len(zone) <= 64 else None
    except ZoneInfoNotFoundError, ValueError:
        zone = None
    table.put_item(Item={**key, "subscription": {"endpoint": endpoint, "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]}}})
    if isinstance(zone, str):
        table.update_item(
            Key={"PK": f"USER#{user}", "SK": "PROFILE"},
            UpdateExpression="SET #tz = :z",  # timeZone is a DynamoDB reserved word
            ExpressionAttributeNames={"#tz": "timeZone"},
            ExpressionAttributeValues={":z": zone},
        )
    return _json(200, {"devices": len(devices(table, user))})


def _public(item: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in item.items() if k != "PK"}


def _json(status: int, body: Any) -> dict[str, Any]:
    def default(value: Any) -> Any:
        if isinstance(value, Decimal):
            return float(value)
        raise TypeError(type(value).__name__)

    headers = {"Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    return {"statusCode": status, "headers": headers, "body": json.dumps(body, default=default)}
