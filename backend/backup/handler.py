"""Lambda (Sundays): copies every item in the table to a gzipped JSON file in the backup bucket."""

import gzip
import json
import os
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import boto3


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])  # pyright: ignore[reportAttributeAccessIssue]
    items = scan_all(table)
    key = f"backups/{datetime.now(UTC):%Y-%m-%d}.json.gz"
    body = gzip.compress(json.dumps({"table": table.name, "items": items}, default=_json, sort_keys=True).encode())
    boto3.client("s3").put_object(Bucket=os.environ["BACKUP_BUCKET"], Key=key, Body=body, ContentType="application/gzip")
    return {"key": key, "items": len(items)}


def scan_all(table: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {"ConsistentRead": True}
    while True:
        page = table.scan(**kwargs)
        found += page["Items"]
        if "LastEvaluatedKey" not in page:
            return found
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def _json(value: Any) -> Any:
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, set):
        return sorted(value)
    raise TypeError(f"cannot back up {type(value).__name__}")
