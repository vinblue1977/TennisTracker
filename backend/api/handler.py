"""HTTP API Lambda: the signed-in user's profile, ratings and matches."""

import json
import os
import re
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

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
    return {
        "tennisId": f"{tennis_id[:3]}•••{tennis_id[-4:]}" if tennis_id else None,  # masked
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


def _public(item: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in item.items() if k != "PK"}


def _json(status: int, body: Any) -> dict[str, Any]:
    def default(value: Any) -> Any:
        if isinstance(value, Decimal):
            return float(value)
        raise TypeError(type(value).__name__)

    return {"statusCode": status, "headers": {"Content-Type": "application/json"}, "body": json.dumps(body, default=default)}
