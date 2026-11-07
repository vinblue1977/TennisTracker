"""The Lambda layer lockfile must hold every package named in layer/requirements.in."""

import re
from pathlib import Path

LAYER = Path(__file__).resolve().parent.parent / "layer"


def test_lockfile_covers_requirements_in() -> None:
    wanted = [
        re.split(r"[<>=!~\[ ;#]", line.strip(), maxsplit=1)[0].lower()
        for line in (LAYER / "requirements.in").read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    locked = set(re.findall(r"^([A-Za-z0-9._-]+)==", (LAYER / "requirements.txt").read_text(), re.M))
    locked = {name.lower() for name in locked}
    assert wanted
    assert set(wanted) <= locked, f"missing from layer/requirements.txt: {set(wanted) - locked}"
