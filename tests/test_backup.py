"""Backup handler on fake AWS (moto) and made-up data."""

import gzip
import json
from decimal import Decimal

import boto3
import pytest
from backup import handler as h
from moto import mock_aws


@pytest.fixture
def aws(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-2")
    monkeypatch.setenv("TABLE_NAME", "t")
    monkeypatch.setenv("BACKUP_BUCKET", "backup-bucket")
    with mock_aws():
        table = boto3.resource("dynamodb").create_table(
            TableName="t",
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
            AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"}, {"AttributeName": "SK", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        boto3.client("s3").create_bucket(Bucket="backup-bucket", CreateBucketConfiguration={"LocationConstraint": "us-east-2"})
        yield table


def test_writes_every_item_as_gzipped_json(aws) -> None:
    aws.put_item(Item={"PK": "USER#owner", "SK": "RATING#WTN#DOUBLE#2026-10-05", "value": Decimal("25.5"), "n": 3})
    aws.put_item(Item={"PK": "USER#owner", "SK": "MATCH#2026-10-02#m1", "won": True, "tags": {"b", "a"}})
    result = h.handler({}, None)
    assert result["items"] == 2 and result["key"].startswith("backups/") and result["key"].endswith(".json.gz")
    body = boto3.client("s3").get_object(Bucket="backup-bucket", Key=result["key"])["Body"].read()
    saved = json.loads(gzip.decompress(body))
    assert saved["table"] == "t" and len(saved["items"]) == 2
    rating = next(i for i in saved["items"] if i["SK"].startswith("RATING"))
    assert rating["value"] == 25.5 and rating["n"] == 3
    assert next(i for i in saved["items"] if i["SK"].startswith("MATCH"))["tags"] == ["a", "b"]


def test_pages_through_a_large_table(aws) -> None:
    with aws.batch_writer() as batch:
        for i in range(300):
            batch.put_item(
                Item={"PK": "USER#owner", "SK": f"MATCH#{i:04}", "pad": "x" * 10_000}
            )  # over 1 MB: needs several scan pages
    assert h.handler({}, None)["items"] == 300
