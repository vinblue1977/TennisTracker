"""HTTP API Lambda: the signed-in user's profile, ratings and matches."""

import hashlib
import json
import os
import re
import secrets
from datetime import UTC, datetime
from decimal import Decimal
from functools import cache
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import boto3
from boto3.dynamodb.conditions import Key
from botocore.client import Config
from botocore.exceptions import ClientError

from api import photos, trophies
from calendar_sync.fetch import CalendarError, normalize
from push.notify import device_key, devices, notify
from push.webpush import allowed_endpoint

MAX_NOTE = 2000
MATCH_ID = re.compile(r"^(wtn|local):[\w.-]{1,80}$")


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])  # pyright: ignore[reportAttributeAccessIssue]
    if event.get("routeKey") == "GET /widget":  # the only route without sign-in: a revocable token instead
        return _widget(table, (event.get("headers") or {}).get("x-widget-token", ""))
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
    if route in ("GET /me/widget", "POST /me/widget", "DELETE /me/widget"):
        return _widget_token(table, user, route)
    if route.partition(" ")[2].startswith("/me/trophies"):
        return _trophies(table, user, route, (event.get("pathParameters") or {}).get("id", ""), event.get("body"))
    if route.partition(" ")[2].startswith("/me/photos"):
        return _photos(table, user, route, (event.get("pathParameters") or {}).get("id", ""), event.get("body"))
    if route == "PUT /me/ratings":
        return _put_ratings(table, user, event.get("body"))
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
        "utr": profile.get("utrDoubles"),
        "ntrp": profile.get("ntrp"),
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


def _trophies(table: Any, user: str, route: str, trophy_id: str, body: str | None) -> dict[str, Any]:
    mine = _items(table, user, "TROPHY#")
    if route == "GET /me/trophies":
        dismissed = {i["SK"].removeprefix("DISMISSED#") for i in _items(table, user, "DISMISSED#")}
        found = trophies.suggestions(_items(table, user, "MATCH#"), mine, dismissed)
        shelf = sorted((trophies.public(i) for i in mine), key=lambda t: t["date"], reverse=True)
        return _json(200, {"trophies": shelf, "suggestions": found})
    if route == "POST /me/trophies/dismiss":
        try:
            suggestion = json.loads(body or "{}").get("id")
        except ValueError, AttributeError:
            suggestion = None
        if not isinstance(suggestion, str) or not 0 < len(suggestion) <= 200:
            return _json(400, {"error": 'body must be {"id": "<suggestion id>"}'})
        table.put_item(Item=trophies.dismissal(user, suggestion))
        return _json(200, {"dismissed": True})
    old = next((i for i in mine if i["SK"].endswith(f"#{trophy_id}")), None) if trophy_id else None
    if route != "POST /me/trophies" and not (old and trophies.TROPHY_ID.match(trophy_id)):
        return _json(404, {"error": "no such trophy"})
    if old and route == "DELETE /me/trophies/{id}":
        _delete_photos(table, user, [i for i in _items(table, user, "PHOTO#") if photos.owner_of(i) == f"trophy:{trophy_id}"])
        table.delete_item(Key={"PK": old["PK"], "SK": old["SK"]})
        if old.get("suggestion"):  # stay gone rather than come back as a suggestion
            table.put_item(Item=trophies.dismissal(user, old["suggestion"]))
        return _json(200, {"id": trophy_id})
    data = trophies.parse(body)
    if isinstance(data, str):
        return _json(400, {"error": data})
    if old:
        data.setdefault("suggestion", old.get("suggestion"))
        data = {k: v for k, v in data.items() if v is not None}
    elif data.get("suggestion") and any(i.get("suggestion") == data["suggestion"] for i in mine):
        return _json(409, {"error": "already added"})  # a double tap
    elif len(mine) >= trophies.MAX_TROPHIES:
        return _json(400, {"error": f"up to {trophies.MAX_TROPHIES} trophies"})
    else:
        trophy_id = trophies.new_id()
    item = {**trophies.key(user, trophy_id, data["date"]), **data}
    table.put_item(Item=item)
    if old and old["SK"] != item["SK"]:  # the date is part of the key; write the new one first
        table.delete_item(Key={"PK": old["PK"], "SK": old["SK"]})
    return _json(200, trophies.public(item))


@cache
def _s3() -> Any:
    region = boto3.Session().region_name
    return boto3.client(
        "s3", region_name=region, endpoint_url=f"https://s3.{region}.amazonaws.com", config=Config(signature_version="s3v4")
    )


def _delete_photos(table: Any, user: str, items: list[dict[str, Any]]) -> None:
    for item in items:
        _s3().delete_object(Bucket=os.environ["PHOTO_BUCKET"], Key=photos.object_key(user, photos.photo_id_of(item)))
        table.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})


def _photos(table: Any, user: str, route: str, photo_id: str, body: str | None) -> dict[str, Any]:
    bucket = os.environ["PHOTO_BUCKET"]
    mine = _items(table, user, "PHOTO#")
    if route == "GET /me/photos":
        cover = photos.covers(mine)
        s3 = _s3()
        shelf = [
            {
                "id": photos.photo_id_of(i),
                "owner": photos.owner_of(i),
                "cover": photos.photo_id_of(i) in cover,
                "url": s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": bucket, "Key": photos.object_key(user, photos.photo_id_of(i))},
                    ExpiresIn=photos.LINK_SECONDS,
                ),
            }
            for i in mine
        ]
        return _json(200, {"photos": sorted(shelf, key=lambda p: p["id"])})
    if route in ("PUT /me/photos/{id}", "DELETE /me/photos/{id}"):
        item = next((i for i in mine if photos.PHOTO_ID.match(photo_id) and photos.photo_id_of(i) == photo_id), None)
        if not item:
            return _json(404, {"error": "no such photo"})
        if route.startswith("DELETE"):
            _delete_photos(table, user, [item])
            return _json(200, {"id": photo_id})
        for other in (i for i in mine if photos.owner_of(i) == photos.owner_of(item)):  # one cover per owner
            table.update_item(
                Key={"PK": other["PK"], "SK": other["SK"]},
                UpdateExpression="SET cover = :c",
                ExpressionAttributeValues={":c": other is item},
            )
        return _json(200, {"id": photo_id, "cover": True})
    try:
        data = json.loads(body or "{}")
    except ValueError:
        data = None
    parsed = photos.parse_owner(data.get("owner")) if isinstance(data, dict) else None
    if not parsed:
        return _json(400, {"error": 'body must be {"owner": "match:<id>" or "trophy:<id>"}'})
    kind, owner_id = parsed
    prefix, owner = ("MATCH#", f"match:{owner_id}") if kind == "match" else ("TROPHY#", f"trophy:{owner_id}")
    if not any(i["SK"].endswith(f"#{owner_id}") for i in _items(table, user, prefix)):
        return _json(404, {"error": f"no such {kind}"})
    if sum(photos.owner_of(i) == owner for i in mine) >= photos.MAX_PER_OWNER:
        return _json(400, {"error": f"up to {photos.MAX_PER_OWNER} photos"})
    if route == "POST /me/photos/upload-url":
        new = photos.new_id()
        post = _s3().generate_presigned_post(
            Bucket=bucket,
            Key=photos.object_key(user, new),
            Fields={"Content-Type": "image/jpeg"},
            Conditions=[{"Content-Type": "image/jpeg"}, ["content-length-range", 1, photos.MAX_BYTES]],
            ExpiresIn=300,
        )
        return _json(200, {"id": new, **post})
    new = data.get("id") if isinstance(data, dict) else None
    if route != "POST /me/photos" or not (isinstance(new, str) and photos.PHOTO_ID.match(new)):
        return _json(400, {"error": "bad photo id"})
    if any(photos.photo_id_of(i) == new for i in mine):
        return _json(409, {"error": "already added"})
    try:
        _s3().head_object(Bucket=bucket, Key=photos.object_key(user, new))
    except ClientError:
        return _json(400, {"error": "upload not found"})
    table.put_item(Item={**photos.key(user, owner, new), "at": datetime.now(UTC).isoformat()})
    return _json(200, {"id": new, "owner": owner})


def _put_ratings(table: Any, user: str, body: str | None) -> dict[str, Any]:
    """Hand-entered doubles UTR (1-16.5) and NTRP (1.0-7.0 in halves); null clears one."""
    try:
        data = json.loads(body or "{}")
    except ValueError:
        return _json(400, {"error": "body must be JSON"})
    if not isinstance(data, dict) or not data.keys() <= {"utr", "ntrp"} or not data:
        return _json(400, {"error": 'body must be {"utr": 8.5, "ntrp": 4.0}'})
    limits = {"utr": (1.0, 16.5, 0.01), "ntrp": (1.0, 7.0, 0.5)}
    attrs = {"utr": "utrDoubles", "ntrp": "ntrp"}
    sets, removes, values = [], [], {}
    for field, value in data.items():
        low, high, step = limits[field]
        if value is None:
            removes.append(attrs[field])
            continue
        valid = isinstance(value, int | float) and not isinstance(value, bool) and low <= value <= high
        if not valid or abs(round(value / step) * step - value) > 1e-9:
            return _json(400, {"error": f"{field}: a number from {low} to {high} in steps of {step}"})
        sets.append(f"{attrs[field]} = :{field}")
        values[f":{field}"] = Decimal(str(value))
    expression = ("SET " + ", ".join(sets) if sets else "") + (" REMOVE " + ", ".join(removes) if removes else "")
    kwargs: dict[str, Any] = {"ExpressionAttributeValues": values} if values else {}
    table.update_item(Key={"PK": f"USER#{user}", "SK": "PROFILE"}, UpdateExpression=expression.strip(), **kwargs)
    profile = table.get_item(Key={"PK": f"USER#{user}", "SK": "PROFILE"}).get("Item", {})
    return _json(200, {"utr": profile.get("utrDoubles"), "ntrp": profile.get("ntrp")})


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


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _widget_token(table: Any, user: str, route: str) -> dict[str, Any]:
    """Home Screen widget token: status (GET), make or replace (POST, shown once), turn off (DELETE)."""
    key = {"PK": f"USER#{user}", "SK": "PROFILE"}
    old = table.get_item(Key=key).get("Item", {}).get("widgetHash")
    if route == "GET /me/widget":
        return _json(200, {"enabled": bool(old)})
    if old:
        table.delete_item(Key={"PK": f"WIDGET#{old}", "SK": "TOKEN"})
    if route == "DELETE /me/widget":
        table.update_item(Key=key, UpdateExpression="REMOVE widgetHash")
        return _json(200, {"enabled": False})
    token = secrets.token_urlsafe(32)
    digest = _hash(token)
    table.put_item(Item={"PK": f"WIDGET#{digest}", "SK": "TOKEN", "userId": user})
    table.update_item(Key=key, UpdateExpression="SET widgetHash = :h", ExpressionAttributeValues={":h": digest})
    return _json(200, {"enabled": True, "token": token})


def _instant(value: str) -> datetime:
    moment = datetime.fromisoformat(value)
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _widget(table: Any, token: str) -> dict[str, Any]:
    """WTN doubles and the next match, for the widget; nothing else leaves through the token."""
    item = table.get_item(Key={"PK": f"WIDGET#{_hash(token)}", "SK": "TOKEN"}).get("Item") if token else None
    if not item:
        return _json(401, {"error": "unauthorized"})
    user = str(item["userId"])
    ratings = sorted(_items(table, user, "RATING#WTN#DOUBLE#"), key=lambda r: r["SK"])
    wtn = None
    if ratings:
        last = ratings[-1]
        better = round(float(ratings[-2]["value"]) - float(last["value"]), 2) if len(ratings) > 1 else None  # lower is better
        wtn = {
            "value": last["value"],
            "better": better,
            "confidence": last.get("confidence"),
            "date": last["SK"].rsplit("#", 1)[1],
            "trend": [r["value"] for r in ratings[-24:]],
        }
    now = datetime.now(UTC)
    upcoming = [
        i for i in _items(table, user, "UPCOMING#") if _instant(i.get("end") or i["start"]) >= now
    ]  # all-day: until its end
    nxt = min(upcoming, key=lambda i: _instant(i["start"]), default=None)
    next_match = {k: nxt[k] for k in ("title", "start", "location", "allDay")} if nxt else None
    return _json(200, {"wtn": wtn, "next": next_match})


def _public(item: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in item.items() if k != "PK"}


def _json(status: int, body: Any) -> dict[str, Any]:
    def default(value: Any) -> Any:
        if isinstance(value, Decimal):
            return float(value)
        raise TypeError(type(value).__name__)

    headers = {"Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    return {"statusCode": status, "headers": headers, "body": json.dumps(body, default=default)}
