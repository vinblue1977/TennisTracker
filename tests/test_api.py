"""`/me` API on fake DynamoDB (moto) with made-up data."""

import json
from datetime import UTC, datetime
from decimal import Decimal

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


def widget(token: str | None) -> tuple[int, dict]:
    response = api.handler({"routeKey": "GET /widget", "headers": {"x-widget-token": token} if token else {}}, None)
    return response["statusCode"], json.loads(response["body"])


def test_widget_token_gives_wtn_and_next_match_and_can_be_replaced_or_revoked(table) -> None:
    assert call("GET /me/widget")[1] == {"enabled": False}
    table.put_item(Item={"PK": "USER#owner", "SK": "RATING#WTN#DOUBLE#2026-10-01", "value": Decimal("25.5"), "confidence": 80})
    table.put_item(Item={"PK": "USER#owner", "SK": "RATING#WTN#DOUBLE#2026-10-05", "value": Decimal("25.25"), "confidence": 82})
    table.put_item(
        Item={
            "PK": "USER#owner",
            "SK": "UPCOMING#2000-01-01T09:00Z#old",
            "title": "Past",
            "start": "2000-01-01T09:00:00+00:00",
            "end": "2000-01-01T10:00:00+00:00",
        }
    )
    soon = {"title": "League", "location": "Court 1", "allDay": False, "start": "2999-01-02T09:00:00+00:00"}
    table.put_item(Item={"PK": "USER#owner", "SK": "UPCOMING#2999-01-02T09:00Z#a", **soon})
    token = call("POST /me/widget")[1]["token"]
    status, body = widget(token)
    assert status == 200 and body["next"] == soon
    assert body["wtn"]["value"] == 25.25 and body["wtn"]["better"] == 0.25 and body["wtn"]["trend"] == [25.5, 25.25]
    assert "tennisId" not in json.dumps(body)
    new = call("POST /me/widget")[1]["token"]
    assert widget(token)[0] == 401 and widget(new)[0] == 200  # the old token stops working
    assert call("DELETE /me/widget")[1] == {"enabled": False} and widget(new)[0] == 401


def test_widget_rejects_missing_or_wrong_token(table) -> None:
    assert widget(None)[0] == 401 and widget("nope")[0] == 401


def _add(**over) -> tuple[int, dict]:
    body = {"event": "Club Open", "date": "2026-05-01", "result": "winner", "note": "", **over}
    return call("POST /me/trophies", body=json.dumps(body))


def test_trophies_add_edit_delete(table) -> None:
    status, made = _add(note=" with Sam ")
    assert status == 200 and made["note"] == "with Sam" and made["id"].startswith("t")
    assert call("GET /me/trophies")[1]["trophies"] == [made]
    edit = '{"event":"Club Open","date":"2026-06-01","result":"finalist","note":""}'
    status, edited = call("PUT /me/trophies/{id}", match_id=made["id"], body=edit)
    assert status == 200 and edited["id"] == made["id"] and edited["date"] == "2026-06-01"
    assert [t["result"] for t in call("GET /me/trophies")[1]["trophies"]] == ["finalist"]
    assert call("DELETE /me/trophies/{id}", match_id=made["id"])[0] == 200
    assert call("GET /me/trophies")[1]["trophies"] == []
    assert call("DELETE /me/trophies/{id}", match_id=made["id"])[0] == 404


@pytest.mark.parametrize(
    "over", [{"event": " "}, {"event": "x" * 101}, {"date": "2026-13-01"}, {"date": 5}, {"result": "loser"}, {"note": "x" * 201}]
)
def test_trophy_rejects_bad_input(table, over) -> None:
    assert _add(**over)[0] == 400


def test_trophy_edit_unknown_and_other_user(table) -> None:
    assert call("PUT /me/trophies/{id}", match_id="tdeadbeef0000", body="{}")[0] == 404
    table.put_item(Item={"PK": "USER#someone", "SK": "TROPHY#2026-01-01#t123456789abc", "event": "x"})
    assert call("DELETE /me/trophies/{id}", match_id="t123456789abc")[0] == 404


def test_trophy_suggestions_need_every_match_won(table) -> None:
    def match(day: str, mid: str, event: str, won: bool | None) -> None:
        item = {"PK": "USER#owner", "SK": f"MATCH#{day}#wtn:{mid}", "event": event, "won": won, "partners": [{"name": "Sam"}]}
        table.put_item(Item=item)

    match("2026-04-01", "a", "Spring Open", True)
    match("2026-04-02", "b", "Spring Open", True)
    match("2026-05-01", "c", "Lone Win", True)
    match("2026-06-01", "d", "Mixed", True)
    match("2026-06-02", "e", "Mixed", False)
    match("2026-07-01", "f", "Pending", True)
    match("2026-07-02", "g", "Pending", None)
    found = call("GET /me/trophies")[1]["suggestions"]
    assert [(s["id"], s["date"], s["matches"], s["partner"]) for s in found] == [("2026#Spring Open", "2026-04-02", 2, "Sam")]


def test_accepting_or_dismissing_removes_suggestion_and_delete_keeps_it_gone(table) -> None:
    for mid, day in (("a", "01"), ("b", "02")):
        table.put_item(Item={"PK": "USER#owner", "SK": f"MATCH#2026-04-{day}#wtn:{mid}", "event": "Spring Open", "won": True})
    table.put_item(Item={"PK": "USER#owner", "SK": "MATCH#2026-05-01#wtn:c", "event": "Other", "won": True})
    table.put_item(Item={"PK": "USER#owner", "SK": "MATCH#2026-05-02#wtn:d", "event": "Other", "won": True})
    ids = [s["id"] for s in call("GET /me/trophies")[1]["suggestions"]]
    assert ids == ["2026#Other", "2026#Spring Open"]
    _, made = _add(event="Spring Open", date="2026-04-02", suggestion="2026#Spring Open")
    assert [s["id"] for s in call("GET /me/trophies")[1]["suggestions"]] == ["2026#Other"]
    assert call("POST /me/trophies/dismiss", body='{"id": "2026#Other"}')[0] == 200
    assert call("GET /me/trophies")[1]["suggestions"] == []
    call("DELETE /me/trophies/{id}", match_id=made["id"])
    assert call("GET /me/trophies")[1]["suggestions"] == []  # deleting does not bring it back
    assert call("POST /me/trophies/dismiss", body="{}")[0] == 400


def test_trophy_edit_keeps_suggestion_link(table) -> None:
    _, made = _add(suggestion="2026#Club Open")
    call("PUT /me/trophies/{id}", match_id=made["id"], body='{"event":"Club Open","date":"2026-05-02","result":"winner"}')
    assert next(i for i in table.scan()["Items"] if i["SK"].startswith("TROPHY#"))["suggestion"] == "2026#Club Open"


def test_trophy_date_must_be_canonical_and_double_tap_is_rejected(table) -> None:
    for bad in ("20260501", "2026-W18-5"):
        assert _add(date=bad)[0] == 400, bad
    assert _add(suggestion="2026#Club Open")[0] == 200
    assert _add(suggestion="2026#Club Open")[0] == 409


@pytest.fixture
def bucket(table, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("PHOTO_BUCKET", "photos")
    s3 = boto3.client("s3", region_name="us-east-2")
    s3.create_bucket(Bucket="photos", CreateBucketConfiguration={"LocationConstraint": "us-east-2"})
    return s3


def _photo(s3, owner: str = "match:wtn:m1", upload: bool = True) -> tuple[int, dict]:
    status, signed = call("POST /me/photos/upload-url", body=json.dumps({"owner": owner}))
    assert status == 200 and signed["fields"]["Content-Type"] == "image/jpeg" and "photos" in signed["url"]
    assert signed["url"].startswith("https://photos.s3."), signed["url"]  # the CSP only allows the bucket's own host
    if upload:
        s3.put_object(Bucket="photos", Key=f"incoming/owner/{signed['id']}.jpg", Body=b"\xff\xd8\xff\xe0jpeg")
    return call("POST /me/photos", body=json.dumps({"owner": owner, "id": signed["id"]}))


def test_photos_add_list_cover_delete(bucket) -> None:
    first = _photo(bucket)[1]["id"]
    second = _photo(bucket)[1]["id"]
    listed = call("GET /me/photos")[1]["photos"]
    assert {p["id"] for p in listed} == {first, second}
    assert all(p["owner"] == "match:wtn:m1" and "X-Amz-Signature" in p["url"] for p in listed)
    assert [p["cover"] for p in listed if p["id"] == first] == [True]  # the first upload is the cover
    assert call("PUT /me/photos/{id}", match_id=second)[0] == 200
    assert {p["id"] for p in call("GET /me/photos")[1]["photos"] if p["cover"]} == {second}
    assert call("DELETE /me/photos/{id}", match_id=first)[0] == 200
    assert [p["id"] for p in call("GET /me/photos")[1]["photos"]] == [second]
    assert "Contents" not in bucket.list_objects_v2(Bucket="photos", Prefix=f"owner/{first}")
    assert call("DELETE /me/photos/{id}", match_id=first)[0] == 404


def test_photo_focus_is_saved_and_validated(bucket) -> None:
    photo = _photo(bucket)[1]["id"]
    assert call("GET /me/photos")[1]["photos"][0]["focus"] == 20  # the default
    assert call("PUT /me/photos/{id}", match_id=photo, body='{"focus": 65}') == (200, {"id": photo, "focus": 65})
    assert call("GET /me/photos")[1]["photos"][0]["focus"] == 65
    for bad in ('{"focus": 101}', '{"focus": -1}', '{"focus": "top"}', '{"focus": true}', "[1]", "nope"):
        assert call("PUT /me/photos/{id}", match_id=photo, body=bad)[0] == 400
    assert call("PUT /me/photos/{id}", match_id="p123456789ab", body='{"focus": 5}')[0] == 404


def test_photos_need_an_existing_owner_and_an_uploaded_file(bucket) -> None:
    assert call("POST /me/photos/upload-url", body='{"owner": "match:wtn:nope"}')[0] == 404
    assert call("POST /me/photos/upload-url", body='{"owner": "trophy:t123456789abc"}')[0] == 404
    assert call("POST /me/photos/upload-url", body='{"owner": "../x"}')[0] == 400
    assert call("POST /me/photos/upload-url", body="not json")[0] == 400
    assert _photo(bucket, upload=False) == (400, {"error": "upload not found"})
    assert call("POST /me/photos", body='{"owner": "match:wtn:m1", "id": "../x"}')[0] == 400


def test_photos_are_limited_per_owner_and_private_to_the_user(bucket, table) -> None:
    for _ in range(10):
        assert _photo(bucket)[0] == 200
    assert call("POST /me/photos/upload-url", body='{"owner": "match:wtn:m1"}')[0] == 400
    assert call("GET /me/photos", sub="sub-2")[1]["photos"] == []
    table.put_item(Item={"PK": "USER#someone", "SK": "PHOTO#match:wtn:x#p123456789ab"})
    assert call("DELETE /me/photos/{id}", match_id="p123456789ab")[0] == 404


def test_deleting_a_trophy_deletes_its_photos(bucket) -> None:
    trophy = _add()[1]["id"]
    photo = _photo(bucket, owner=f"trophy:{trophy}")[1]["id"]
    assert call("DELETE /me/trophies/{id}", match_id=trophy)[0] == 200
    assert call("GET /me/photos")[1]["photos"] == []
    assert "Contents" not in bucket.list_objects_v2(Bucket="photos", Prefix=f"owner/{photo}")


def test_a_photo_id_is_added_once(bucket) -> None:
    photo = _photo(bucket)[1]["id"]
    again = call("POST /me/photos", body=json.dumps({"owner": "match:wtn:m2", "id": photo}))
    assert again == (409, {"error": "already added"})


def test_a_file_that_is_not_a_jpeg_is_rejected_and_removed(bucket) -> None:
    signed = call("POST /me/photos/upload-url", body='{"owner": "match:wtn:m1"}')[1]
    bucket.put_object(Bucket="photos", Key=f"incoming/owner/{signed['id']}.jpg", Body=b"<html>not an image")
    assert call("POST /me/photos", body=json.dumps({"owner": "match:wtn:m1", "id": signed["id"]})) == (
        400,
        {"error": "not a JPEG"},
    )
    assert "Contents" not in bucket.list_objects_v2(Bucket="photos")


def test_a_confirmed_upload_moves_out_of_incoming(bucket) -> None:
    photo = _photo(bucket)[1]["id"]
    assert [o["Key"] for o in bucket.list_objects_v2(Bucket="photos")["Contents"]] == [f"owner/{photo}.jpg"]


LOGGED = {
    "event": "Club night",
    "date": "2026-10-10",
    "partner": "Pat Partner",
    "opponents": ["Sam One", "Sam Two"],
    "score": "6-3 6-4",
    "won": True,
}


def test_logged_match_is_added_edited_and_deleted(table) -> None:
    status, body = call("POST /me/matches", body=json.dumps(LOGGED))
    assert status == 200 and body["id"].startswith("local:")
    mid = body["id"]
    logged = next(m for m in call("GET /me/matches")[1]["matches"] if m["id"] == mid)
    assert (
        logged["kind"] == "DOUBLE"
        and logged["source"] == "LOCAL"
        and logged["partners"][0]["name"] == "Pat Partner"
        and len(logged["opponents"]) == 2
    )
    call("PUT /me/matches/{id}/extras", match_id=mid, body='{"note": "fun", "starred": true}')
    assert (
        call("PUT /me/matches/{id}", match_id=mid, body=json.dumps({**LOGGED, "date": "2026-10-11", "score": "6-3 3-6 6-4"}))[0]
        == 200
    )
    matches = [m for m in call("GET /me/matches")[1]["matches"] if m["id"] == mid]
    assert (
        len(matches) == 1 and matches[0]["SK"] == f"MATCH#2026-10-11#{mid}" and matches[0]["note"] == "fun"
    )  # moved, extras kept
    assert call("DELETE /me/matches/{id}", match_id=mid)[0] == 200
    assert all(m["id"] != mid for m in call("GET /me/matches")[1]["matches"])
    assert table.get_item(Key={"PK": "USER#owner", "SK": f"EXTRA#{mid}"}).get("Item") is None


@pytest.mark.parametrize(
    "change",
    [
        {"event": ""},
        {"date": "2026-02-30"},
        {"date": "２０２６-10-10"},
        {"date": "yesterday"},
        {"partner": " "},
        {"opponents": []},
        {"opponents": ["a", "b", "c"]},
        {"opponents": [5]},
        {"score": ""},
        {"won": "yes"},
    ],
)
def test_logged_match_rejects_bad_input(table, change: dict) -> None:
    assert call("POST /me/matches", body=json.dumps({**LOGGED, **change}))[0] == 400
    assert call("POST /me/matches", body="[]")[0] == 400


def test_synced_and_other_users_matches_cannot_be_changed(table) -> None:
    for mid in ("wtn:m1", "local:0123456789abcdef", "../x"):
        assert call("PUT /me/matches/{id}", match_id=mid, body=json.dumps(LOGGED))[0] == 404
        assert call("DELETE /me/matches/{id}", match_id=mid)[0] == 404
    assert table.get_item(Key={"PK": "USER#owner", "SK": "MATCH#2026-10-02#wtn:m1"}).get("Item")


def test_wtn_sync_now_starts_one_user_and_waits_a_minute_between_runs(table, monkeypatch: pytest.MonkeyPatch) -> None:
    invoked: list[dict] = []

    class FakeLambda:
        def invoke(self, **kwargs) -> None:
            invoked.append(kwargs)

    monkeypatch.setenv("WTN_FUNCTION", "wtn-fn")
    monkeypatch.setattr(api.boto3, "client", lambda name: FakeLambda())
    assert call("POST /me/wtn-sync") == (202, {"started": True})
    assert invoked == [{"FunctionName": "wtn-fn", "InvocationType": "Event", "Payload": '{"user": "owner"}'}]

    just_now = datetime.now(UTC).isoformat()
    table.put_item(Item={"PK": "USER#owner", "SK": "SYNC#WTN", "status": "ok", "lastRunAt": just_now})
    assert call("POST /me/wtn-sync")[0] == 429 and len(invoked) == 1

    table.delete_item(Key={"PK": "USER#owner", "SK": "PROFILE"})
    table.put_item(Item={"PK": "USER#owner", "SK": "PROFILE"})
    assert call("POST /me/wtn-sync")[0] == 400  # no TennisID
