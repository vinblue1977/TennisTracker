"""Infrastructure tests: the stack synthesizes and passes cdk-nag with no errors or warnings."""

import aws_cdk as cdk
from aws_cdk.assertions import Annotations, Match, Template
from cdk_nag import AwsSolutionsChecks

from infra.stack import TennisTrackerStack


def _stack() -> TennisTrackerStack:
    app = cdk.App()
    stack = TennisTrackerStack(app, "TennisTracker", env=cdk.Environment(account="123456789012", region="us-east-2"))
    cdk.Aspects.of(app).add(AwsSolutionsChecks())
    return stack


def test_synthesizes_in_us_east_2() -> None:
    stack = _stack()
    Template.from_stack(stack)  # synthesizes without error
    assert stack.region == "us-east-2"


def test_no_cdk_nag_findings() -> None:
    stack = _stack()
    Template.from_stack(stack)  # runs the aspects
    annotations = Annotations.from_stack(stack)
    assert annotations.find_error("*", Match.string_like_regexp("AwsSolutions-.*")) == []
    assert annotations.find_warning("*", Match.string_like_regexp("AwsSolutions-.*")) == []
