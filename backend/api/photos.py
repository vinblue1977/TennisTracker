"""Photos on matches and trophies: private S3 objects, shown through short-lived signed links."""

import re
import uuid
from typing import Any

MAX_PER_OWNER = 10
MAX_BYTES = 3_000_000
LINK_SECONDS = 900
JPEG_START = b"\xff\xd8\xff"
PHOTO_ID = re.compile(r"^p[0-9a-f]{12}$")
OWNER = re.compile(r"^(match|trophy):([\w.:-]{1,80})$")


def new_id() -> str:
    return "p" + uuid.uuid4().hex[:12]


def object_key(user: str, photo_id: str) -> str:
    return f"{user}/{photo_id}.jpg"


def incoming_key(user: str, photo_id: str) -> str:
    """Where an upload lands until it is confirmed; the bucket expires this prefix after a day."""
    return f"incoming/{user}/{photo_id}.jpg"


def key(user: str, owner: str, photo_id: str) -> dict[str, str]:
    return {"PK": f"USER#{user}", "SK": f"PHOTO#{owner}#{photo_id}"}


def parse_owner(value: Any) -> tuple[str, str] | None:
    """('match' | 'trophy', id) from 'match:<id>' or 'trophy:<id>'; None if malformed."""
    found = OWNER.match(value) if isinstance(value, str) else None
    return (found.group(1), found.group(2)) if found else None


def owner_of(item: dict[str, Any]) -> str:
    return str(item["SK"]).split("#", 2)[1]


def photo_id_of(item: dict[str, Any]) -> str:
    return str(item["SK"]).rsplit("#", 1)[1]


DEFAULT_FOCUS = 20  # a little above centre keeps heads in group shots


def parse_focus(value: Any) -> int | None:
    """The focus as a whole number 0-100, or None if it is anything else."""
    ok = isinstance(value, int | float) and not isinstance(value, bool) and 0 <= value <= 100
    return int(value) if ok else None


def focus_of(item: dict[str, Any]) -> int:
    return int(item.get("focus", DEFAULT_FOCUS))


def covers(items: list[dict[str, Any]]) -> set[str]:
    """Ids of each owner's cover: the one flagged, else the first uploaded."""
    by_owner: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        by_owner.setdefault(owner_of(item), []).append(item)
    return {
        photo_id_of(next((i for i in group if i.get("cover")), min(group, key=lambda i: str(i.get("at", "")))))
        for group in by_owner.values()
    }
