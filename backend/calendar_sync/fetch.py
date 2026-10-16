"""Fetches a published iCloud calendar. Only iCloud calendar hosts, over https, small responses."""

import re
import urllib.error
import urllib.parse
import urllib.request

ALLOWED_HOST = re.compile(r"^p\d{1,3}-caldav\.icloud\.com$")
MAX_BYTES = 1_000_000
MAX_REDIRECTS = 3
TIMEOUT_SECONDS = 15


class CalendarError(Exception):
    """The calendar link is not allowed, or fetching it failed."""


def normalize(url: str) -> str:
    """webcal:// -> https://, and rejects anything that isn't an iCloud published-calendar link."""
    url = url.strip()
    if url.lower().startswith("webcal://"):
        url = "https://" + url[len("webcal://") :]
    parts = urllib.parse.urlsplit(url)
    if (
        parts.scheme != "https"
        or not parts.hostname
        or not ALLOWED_HOST.match(parts.hostname)
        or parts.port not in (None, 443)
        or parts.username
        or parts.password
        or not parts.path.startswith("/published/")
        or len(url) > 500
    ):
        raise CalendarError("Use the public link of an iCloud calendar (webcal://p…-caldav.icloud.com/published/…)")
    return urllib.parse.urlunsplit(("https", parts.hostname, parts.path, parts.query, ""))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201 (urllib's signature)
        return None  # redirects are followed by hand, so each hop is checked against the allow-list


def fetch(url: str) -> str:
    url = normalize(url)
    opener = urllib.request.build_opener(_NoRedirect)
    for _ in range(MAX_REDIRECTS + 1):
        request = urllib.request.Request(url, headers={"Accept": "text/calendar"})  # noqa: S310 (https, allow-listed host)
        try:
            with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
                body = response.read(MAX_BYTES + 1)
        except urllib.error.HTTPError as error:
            if error.code in (301, 302, 303, 307, 308) and error.headers.get("Location"):
                url = normalize(urllib.parse.urljoin(url, error.headers["Location"]))
                continue
            raise CalendarError(f"calendar returned HTTP {error.code}") from error
        except OSError as error:
            raise CalendarError(f"calendar request failed: {error}") from error
        if len(body) > MAX_BYTES:
            raise CalendarError("calendar is too large")
        return body.decode("utf-8", errors="replace")
    raise CalendarError("too many redirects")
