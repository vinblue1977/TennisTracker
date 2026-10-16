"""Minimal iCalendar (RFC 5545) reader for events: enough for iCloud's published calendars."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


@dataclass(frozen=True)
class Event:
    uid: str
    start: datetime  # UTC
    end: datetime  # UTC
    all_day: bool
    title: str
    location: str


def parse(text: str) -> list[Event]:
    events: list[Event] = []
    current: dict[str, tuple[dict[str, str], str]] | None = None
    for line in _unfold(text):
        name, params, value = _split(line)
        if name == "BEGIN" and value == "VEVENT":
            current = {}
        elif name == "END" and value == "VEVENT" and current is not None:
            event = _event(current)
            if event:
                events.append(event)
            current = None
        elif current is not None and name not in current:
            current[name] = (params, value)
    return events


def _unfold(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        elif raw:
            lines.append(raw)
    return lines


def _split(line: str) -> tuple[str, dict[str, str], str]:
    head, _, value = line.partition(":")
    name, *rest = head.split(";")
    params = dict(p.split("=", 1) for p in rest if "=" in p)
    return name.upper(), {k.upper(): v.strip('"') for k, v in params.items()}, value


def _text(value: str) -> str:
    return value.replace("\\n", " ").replace("\\N", " ").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\").strip()


def _when(params: dict[str, str], value: str) -> tuple[datetime, bool]:
    if params.get("VALUE") == "DATE" or len(value) == 8:
        return datetime.combine(date.fromisoformat(f"{value[:4]}-{value[4:6]}-{value[6:8]}"), time(), UTC), True
    naive = datetime.strptime(value.rstrip("Z"), "%Y%m%dT%H%M%S")
    if value.endswith("Z"):
        return naive.replace(tzinfo=UTC), False
    try:
        zone = ZoneInfo(params["TZID"]) if "TZID" in params else UTC
    except ZoneInfoNotFoundError, ValueError:
        zone = UTC
    return naive.replace(tzinfo=zone).astimezone(UTC), False


def _event(fields: dict[str, tuple[dict[str, str], str]]) -> Event | None:
    if "UID" not in fields or "DTSTART" not in fields:
        return None
    if fields.get("STATUS", ({}, ""))[1].upper() == "CANCELLED":
        return None
    try:
        start, all_day = _when(*fields["DTSTART"])
        end = _when(*fields["DTEND"])[0] if "DTEND" in fields else start + (timedelta(days=1) if all_day else timedelta(hours=2))
    except ValueError:
        return None
    return Event(
        uid=fields["UID"][1].strip(),
        start=start,
        end=end,
        all_day=all_day,
        title=_text(fields.get("SUMMARY", ({}, "Tennis"))[1]) or "Tennis",
        location=_text(fields.get("LOCATION", ({}, ""))[1]),
    )
