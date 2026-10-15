"""The Tennis Tracker stack. Empty for now; resources arrive with the WTN dashboard phase."""

from aws_cdk import Stack
from constructs import Construct


class TennisTrackerStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
