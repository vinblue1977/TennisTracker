"""Infrastructure tests: the stack synthesizes, passes cdk-nag, and its table and deploy role are locked down."""

import functools
import json
from pathlib import Path

import aws_cdk as cdk
import pytest
from aws_cdk.assertions import Annotations, Match, Template
from cdk_nag import AwsSolutionsChecks

from infra.stack import TennisTrackerStack

REPO = "test-owner@1/test-repo@2"
# The same feature flags as a real synth, so tests render the template the way a deploy does.
CDK_CONTEXT = {k: v for k, v in json.loads(Path("cdk.json").read_text())["context"].items() if k.startswith("@")}
CDK_CONTEXT["siteDir"] = "tests/fixtures/site"  # a stand-in app, so tests don't need a frontend build


def _stack(context: dict | None = None, account: str | None = "123456789012") -> TennisTrackerStack:
    app = cdk.App(context=CDK_CONTEXT | ({"githubRepo": REPO} if context is None else context))
    stack = TennisTrackerStack(app, "TennisTracker", env=cdk.Environment(account=account, region="us-east-2"))
    cdk.Aspects.of(app).add(AwsSolutionsChecks())
    return stack


@functools.cache
def _template() -> Template:
    """The default stack, built once and shared: synthesizing it is the slow part of these tests."""
    return Template.from_stack(_stack())


def test_synthesizes_in_us_east_2() -> None:
    stack = _stack()
    Template.from_stack(stack)
    assert stack.region == "us-east-2"


@pytest.mark.parametrize("account", ["123456789012", None])  # None: CI synth without AWS credentials
def test_no_cdk_nag_findings(account: str | None) -> None:
    stack = _stack(account=account)
    Template.from_stack(stack)  # runs the aspects
    annotations = Annotations.from_stack(stack)
    assert annotations.find_error("*", Match.string_like_regexp("AwsSolutions-.*")) == []
    assert annotations.find_warning("*", Match.string_like_regexp("AwsSolutions-.*")) == []


def test_table_is_protected_and_on_demand() -> None:
    template = _template()
    template.has_resource(
        "AWS::DynamoDB::GlobalTable",
        {
            "DeletionPolicy": "Retain",
            "Properties": Match.object_like(
                {
                    "BillingMode": "PAY_PER_REQUEST",
                    "Replicas": [
                        Match.object_like(
                            {
                                "DeletionProtectionEnabled": True,
                                "PointInTimeRecoverySpecification": {"PointInTimeRecoveryEnabled": True},
                            }
                        )
                    ],
                }
            ),
        },
    )


def test_deploy_role_trusts_only_this_repo_production_environment() -> None:
    template = _template()
    template.has_resource_properties(
        "AWS::IAM::Role",
        {
            "AssumeRolePolicyDocument": Match.object_like(
                {
                    "Statement": [
                        Match.object_like(
                            {
                                "Action": "sts:AssumeRoleWithWebIdentity",
                                "Condition": {
                                    "StringEquals": {
                                        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                                        "token.actions.githubusercontent.com:sub": f"repo:{REPO}:environment:production",
                                    }
                                },
                            }
                        )
                    ]
                }
            )
        },
    )
    # The provider is shared with another stack in the account, so this stack must not create one.
    template.resource_count_is("Custom::AWSCDKOpenIdConnectProvider", 0)
    template.resource_count_is("AWS::IAM::OIDCProvider", 0)


def test_no_deploy_role_without_repo() -> None:
    web_identity = {
        "AssumeRolePolicyDocument": Match.object_like(
            {"Statement": [Match.object_like({"Action": "sts:AssumeRoleWithWebIdentity"})]}
        )
    }
    Template.from_stack(_stack({})).resource_properties_count_is("AWS::IAM::Role", web_identity, 0)


def test_wtn_sync_runs_daily_and_alerts_on_crash() -> None:
    template = Template.from_stack(_stack({"alertEmail": "alerts@example.com"}))
    template.has_resource_properties("AWS::Lambda::Function", {"Runtime": "python3.14", "Handler": "wtn_sync.handler.handler"})
    template.has_resource_properties("AWS::Events::Rule", {"ScheduleExpression": "cron(0 11 * * ? *)"})
    template.has_resource_properties("AWS::CloudWatch::Alarm", {"MetricName": "Errors", "Threshold": 1})
    template.has_resource_properties("AWS::SNS::Subscription", {"Protocol": "email", "Endpoint": "alerts@example.com"})
    template.has_resource_properties("AWS::Logs::LogGroup", {"RetentionInDays": 14})


def test_rejects_malformed_repo() -> None:
    with pytest.raises(ValueError, match="githubRepo"):
        _stack({"githubRepo": "not a repo"})


def test_api_routes_require_sign_in_and_site_is_private() -> None:
    template = _template()
    routes = template.find_resources("AWS::ApiGatewayV2::Route")
    assert len(routes) == 4 and all(r["Properties"]["AuthorizationType"] == "JWT" for r in routes.values())
    template.has_resource_properties(
        "AWS::S3::Bucket",
        {
            "PublicAccessBlockConfiguration": {
                "BlockPublicAcls": True,
                "BlockPublicPolicy": True,
                "IgnorePublicAcls": True,
                "RestrictPublicBuckets": True,
            }
        },
    )
    template.has_resource_properties("AWS::Cognito::UserPool", {"AdminCreateUserConfig": {"AllowAdminCreateUserOnly": True}})
    template.has_resource_properties(
        "AWS::CloudFront::Distribution",
        Match.object_like({"DistributionConfig": Match.object_like({"DefaultRootObject": "index.html"})}),
    )
