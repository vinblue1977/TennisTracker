"""Sends a notification to every device a user turned notifications on for (PUSH# items)."""

import functools
import hashlib
import logging
import os
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

from push.webpush import Gone, send

log = logging.getLogger(__name__)


def device_key(endpoint: str) -> str:
    return "PUSH#" + hashlib.sha256(endpoint.encode()).hexdigest()[:32]


@functools.cache
def _private_key() -> str:
    param = boto3.client("ssm").get_parameter(Name=os.environ["VAPID_KEY_PARAM"], WithDecryption=True)
    return param["Parameter"]["Value"]


def devices(table: Any, user: str) -> list[dict[str, Any]]:
    return table.query(KeyConditionExpression=Key("PK").eq(f"USER#{user}") & Key("SK").begins_with("PUSH#"))["Items"]


def notify(table: Any, user: str, title: str, body: str, url: str = "/") -> int:
    """Returns how many devices it reached; expired subscriptions are removed."""
    sent = 0
    for device in devices(table, user):
        try:
            send(device["subscription"], {"title": title, "body": body, "url": url}, _private_key(), os.environ["VAPID_SUBJECT"])
            sent += 1
        except Gone:
            table.delete_item(Key={"PK": device["PK"], "SK": device["SK"]})
        except Exception:  # one bad device must not stop the others
            log.exception("push failed")
    return sent
