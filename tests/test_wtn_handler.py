"""Sync handler on fake AWS (moto) and made-up WTN data."""

import json
from datetime import UTC, datetime
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

from wtn_sync import handler as h
from wtn_sync.client import WtnApiError

PAYLOAD = json.loads(Path("tests/fixtures/wtn_past.json").read_text())
NOW = datetime(2026, 10, 16, 11, tzinfo=UTC)


@pytest.fixture
def aws(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-2")
    with mock_aws():
        ddb = boto3.resource("dynamodb")
        table = ddb.create_table(
            TableName="t",
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
            AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"}, {"AttributeName": "SK", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        table.put_item(Item={"PK": "USER#owner", "SK": "PROFILE", "tennisId": "TEST-ID-ME"})
        sns = boto3.client("sns")
        topic = sns.create_topic(Name="alerts")["TopicArn"]
        sqs = boto3.client("sqs")
        queue = sqs.create_queue(QueueName="inbox")["QueueUrl"]
        queue_arn = sqs.get_queue_attributes(QueueUrl=queue, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]
        sns.subscribe(TopicArn=topic, Protocol="sqs", Endpoint=queue_arn)
        monkeypatch.setenv("TABLE_NAME", "t")
        monkeypatch.setenv("ALERT_TOPIC_ARN", topic)
        yield table, lambda: sqs.receive_message(QueueUrl=queue, MaxNumberOfMessages=10).get("Messages", [])


def _profile(table):
    return table.get_item(Key={"PK": "USER#owner", "SK": "PROFILE"})["Item"]


def test_sync_writes_ratings_matches_and_state(aws, monkeypatch: pytest.MonkeyPatch) -> None:
    table, _ = aws
    monkeypatch.setattr(h, "fetch_history", lambda tid, start, end: PAYLOAD)
    result = h.handler({}, None)["synced"][0]
    assert result == {"user": "owner", "status": "ok", "matches": 5, "newMatches": 5, "changed": True}
    items = table.scan()["Items"]
    assert sum(i["SK"].startswith("MATCH#") for i in items) == 5
    assert sum(i["SK"].startswith("RATING#WTN#") for i in items) == 5
    state = table.get_item(Key={"PK": "USER#owner", "SK": "SYNC#WTN"})["Item"]
    assert state["status"] == "ok" and state["latestDate"] == "2026-06-01" and state["consecutiveFailures"] == 0


def test_second_sync_with_same_data_is_unchanged_and_keeps_notes(aws, monkeypatch: pytest.MonkeyPatch) -> None:
    table, _ = aws
    monkeypatch.setattr(h, "fetch_history", lambda tid, start, end: PAYLOAD)
    h.sync_user(table, _profile(table), NOW)
    table.put_item(Item={"PK": "USER#owner", "SK": "EXTRA#wtn:m-upset", "note": "great comeback"})
    result = h.sync_user(table, _profile(table), NOW)
    assert result["changed"] is False and result["newMatches"] == 0
    assert table.get_item(Key={"PK": "USER#owner", "SK": "EXTRA#wtn:m-upset"})["Item"]["note"] == "great comeback"


def test_alerts_once_on_the_third_failure_and_resets_on_success(aws, monkeypatch: pytest.MonkeyPatch) -> None:
    table, inbox = aws

    def fail(tid, start, end):
        raise WtnApiError("request failed: HTTP Error 403: Forbidden")

    monkeypatch.setattr(h, "fetch_history", fail)
    results = [h.sync_user(table, _profile(table), NOW) for _ in range(4)]
    assert [r["failures"] for r in results] == [1, 2, 3, 4]
    messages = inbox()
    assert len(messages) == 1 and "3 runs in a row" in json.loads(messages[0]["Body"])["Message"]

    monkeypatch.setattr(h, "fetch_history", lambda tid, start, end: PAYLOAD)
    assert h.sync_user(table, _profile(table), NOW)["status"] == "ok"
    assert table.get_item(Key={"PK": "USER#owner", "SK": "SYNC#WTN"})["Item"]["consecutiveFailures"] == 0


def test_profiles_without_tennis_id_are_skipped(aws, monkeypatch: pytest.MonkeyPatch) -> None:
    table, _ = aws
    table.put_item(Item={"PK": "USER#other", "SK": "PROFILE"})
    monkeypatch.setattr(h, "fetch_history", lambda tid, start, end: PAYLOAD)
    assert [r["user"] for r in h.handler({}, None)["synced"]] == ["owner"]


def test_profiles_pages_through_the_whole_scan() -> None:
    class PagedTable:
        def __init__(self) -> None:
            self.calls: list[dict] = []

        def scan(self, **kwargs):
            self.calls.append(kwargs)
            if "ExclusiveStartKey" not in kwargs:
                return {"Items": [{"PK": "USER#a"}], "LastEvaluatedKey": {"PK": "x", "SK": "y"}}
            return {"Items": [{"PK": "USER#b"}]}

    table = PagedTable()
    assert [p["PK"] for p in h.profiles(table)] == ["USER#a", "USER#b"]
    assert table.calls[1]["ExclusiveStartKey"] == {"PK": "x", "SK": "y"}


def test_sync_now_runs_only_the_asked_user(aws, monkeypatch: pytest.MonkeyPatch) -> None:
    table, _ = aws
    table.put_item(Item={"PK": "USER#other", "SK": "PROFILE", "tennisId": "OTHER-ID"})
    monkeypatch.setattr(h, "fetch_history", lambda tid, start, end: PAYLOAD)
    assert [r["user"] for r in h.handler({"user": "owner"}, None)["synced"]] == ["owner"]


def test_sync_now_for_a_user_without_tennis_id_does_nothing(aws, monkeypatch: pytest.MonkeyPatch) -> None:
    table, _ = aws
    table.put_item(Item={"PK": "USER#other", "SK": "PROFILE"})
    monkeypatch.setattr(h, "fetch_history", lambda tid, start, end: PAYLOAD)
    assert h.handler({"user": "other"}, None) == {"synced": []}
    assert h.handler({"user": "nobody"}, None) == {"synced": []}
