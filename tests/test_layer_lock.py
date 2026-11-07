"""The Lambda layer lockfile must be the layer's own: everything in layer/requirements.in, nothing from the CDK app."""

import re
from pathlib import Path

LAYER = Path(__file__).resolve().parent.parent / "layer"


def _norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()  # PEP 503


def test_lockfile_is_the_layers_own() -> None:
    wanted = {
        _norm(m.group(1))
        for line in (LAYER / "requirements.in").read_text().splitlines()
        if (m := re.match(r"([A-Za-z0-9][A-Za-z0-9._-]*)", line.strip()))
    }
    locked = {_norm(n) for n in re.findall(r"^([A-Za-z0-9._-]+)==", (LAYER / "requirements.txt").read_text(), re.M)}
    assert wanted
    assert wanted <= locked, f"missing from layer/requirements.txt: {wanted - locked}"
    assert {"cffi", "pycparser"} <= locked, "cryptography's dependencies are missing"
    assert not locked & {"aws-cdk-lib", "jsii", "constructs"}, "the CDK app's packages are in the layer lockfile"
