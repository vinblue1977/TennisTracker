"""ITF World Tennis Number GraphQL client (public endpoint, no login)."""

import json
import urllib.request
from typing import Any

ENDPOINT = "https://prd-itf-kube.clubspark.pro/tods-gw-api/graphql"
TIMEOUT_SECONDS = 20
USER_AGENT = "curl/8.7.1"

QUERY = """
query($t: ID!, $start: String, $end: String) {
  wtnPast(tennisID: $t, startDate: $start, endDate: $end) {
    type ratingDate tennisNumber confidence source
    matchUps {
      id start winningSide status
      score { scoreString }
      tournament { name }
      sides { sideNumber players { person { id tennisID standardGivenName standardFamilyName } } }
      worldTennisNumbers { personId tennisNumber type }
    }
  }
}
"""


class WtnApiError(Exception):
    """The ITF API failed or answered with errors."""


def fetch_history(tennis_id: str, start: str, end: str, endpoint: str = ENDPOINT) -> dict[str, Any]:
    """Returns the raw `wtnPast` response for one player between two ISO dates."""
    if not endpoint.startswith("https://"):
        raise WtnApiError("endpoint must be https")
    body = json.dumps({"query": QUERY, "variables": {"t": tennis_id, "start": start, "end": end}}).encode()
    # The API rejects Python's default User-Agent (403) but answers curl. Owner's choice; may break if tightened.
    headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
    request = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")  # noqa: S310 (https checked)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310 (https checked)
            payload = json.load(response)
    except (OSError, ValueError) as error:
        raise WtnApiError(f"request failed: {error}") from error
    if payload.get("errors"):
        raise WtnApiError(f"API errors: {payload['errors'][0].get('message', '?')}")
    return payload
