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
CDK_CONTEXT["siteDir"] = "tests/fixtures/site"
CDK_CONTEXT["layerDir"] = (
    "tests/fixtures/layer"  # stand-in: tests don't need the built layer  # a stand-in app, so tests don't need a frontend build
)


def _stack(context: dict | None = None, account: str | None = "123456789012") -> TennisTrackerStack:
    app = cdk.App(context=CDK_CONTEXT | ({"githubRepo": REPO} if context is None else context))
    stack = TennisTrackerStack(app, "TennisTracker", env=cdk.Environment(account=account, region="us-east-2"))
    cdk.Aspects.of(app).add(AwsSolutionsChecks())
    return stack


@functools.cache
def _synthesized(context: str | None = None, account: str | None = "123456789012") -> tuple[TennisTrackerStack, Template]:
    """A stack and its template, built once per context (as JSON) and account: synthesizing is the slow part of these tests."""
    stack = _stack(None if context is None else json.loads(context), account)
    return stack, Template.from_stack(stack)


def _template(context: dict | None = None) -> Template:
    return _synthesized(None if context is None else json.dumps(context, sort_keys=True))[1]


def test_synthesizes_in_us_east_2() -> None:
    assert _synthesized()[0].region == "us-east-2"


@pytest.mark.parametrize("account", ["123456789012", None])  # None: CI synth without AWS credentials
def test_no_cdk_nag_findings(account: str | None) -> None:
    stack, _ = _synthesized(account=account)  # synthesizing runs the aspects
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
    _template({}).resource_properties_count_is("AWS::IAM::Role", web_identity, 0)


def test_wtn_sync_runs_wed_thu_and_alerts_on_crash() -> None:
    template = _template({"alertEmail": "alerts@example.com"})
    template.has_resource_properties("AWS::Lambda::Function", {"Runtime": "python3.14", "Handler": "wtn_sync.handler.handler"})
    functions = template.find_resources("AWS::Lambda::Function")
    wtn_fn = next(k for k, v in functions.items() if v["Properties"]["Handler"] == "wtn_sync.handler.handler")
    target = Match.object_like({"Arn": {"Fn::GetAtt": [wtn_fn, "Arn"]}})
    for expression in ("cron(0 11,23 ? * WED *)", "cron(0 11 ? * THU *)"):
        rule = {"ScheduleExpression": expression, "Targets": [target]}
        template.has_resource_properties("AWS::Events::Rule", rule)
    template.has_resource_properties("AWS::SNS::Subscription", {"Protocol": "email", "Endpoint": "alerts@example.com"})
    template.has_resource_properties("AWS::Logs::LogGroup", {"RetentionInDays": 14})


def test_two_alarms_total() -> None:
    template = _template({"alertEmail": "alerts@example.com"})
    template.resource_count_is("AWS::CloudWatch::Alarm", 2)
    template.has_resource_properties("AWS::CloudWatch::Alarm", {"MetricName": "Errors", "Threshold": 3, "Period": 300})
    template.has_resource_properties(
        "AWS::CloudWatch::Alarm", {"Threshold": 1, "Metrics": Match.array_with([Match.object_like({"Id": "e3"})])}
    )


def test_budget_and_widget_throttle() -> None:
    template = _template({"alertEmail": "alerts@example.com"})
    template.has_resource_properties(
        "AWS::Budgets::Budget", {"Budget": Match.object_like({"BudgetLimit": {"Amount": 5, "Unit": "USD"}})}
    )
    template.has_resource_properties(
        "AWS::ApiGatewayV2::Stage", {"RouteSettings": {"GET /widget": {"ThrottlingRateLimit": 1, "ThrottlingBurstLimit": 3}}}
    )
    _template({}).resource_count_is("AWS::Budgets::Budget", 0)


def test_rejects_malformed_repo() -> None:
    with pytest.raises(ValueError, match="githubRepo"):
        _stack({"githubRepo": "not a repo"})


def test_api_routes_require_sign_in_and_site_is_private() -> None:
    template = _template()
    routes = template.find_resources("AWS::ApiGatewayV2::Route")
    by_type = {r["Properties"]["RouteKey"]: r["Properties"]["AuthorizationType"] for r in routes.values()}
    assert len(by_type) == 29 and by_type.pop("GET /widget") == "NONE"  # token-checked in the handler
    assert set(by_type.values()) == {"JWT"}
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


def test_photo_bucket_is_private_and_kept() -> None:
    template = _template()
    template.has_resource(
        "AWS::S3::Bucket",
        {
            "DeletionPolicy": "Retain",
            "Properties": Match.object_like(
                {
                    "PublicAccessBlockConfiguration": Match.object_like({"BlockPublicAcls": True, "RestrictPublicBuckets": True}),
                    "CorsConfiguration": Match.object_like({"CorsRules": [Match.object_like({"AllowedMethods": ["POST"]})]}),
                    "VersioningConfiguration": {"Status": "Enabled"},
                }
            ),
        },
    )


def test_api_can_only_add_view_and_delete_photos() -> None:
    policies = _template().find_resources("AWS::IAM::Policy")
    statements = [s for p in policies.values() for s in p["Properties"]["PolicyDocument"]["Statement"]]
    photo = [s for s in statements if "PhotoBucket" in str(s.get("Resource"))]
    assert [sorted(s["Action"]) for s in photo] == [["s3:DeleteObject", "s3:GetObject", "s3:PutObject"]]


def test_sign_in_page_is_dark() -> None:
    _template().has_resource_properties(
        "AWS::Cognito::ManagedLoginBranding",
        {
            "UseCognitoProvidedValues": False,
            "Settings": Match.object_like(
                {"categories": Match.object_like({"global": Match.object_like({"colorSchemeMode": "DARK"})})}
            ),
        },
    )


def test_reminders_run_every_15_minutes_and_lambdas_can_only_read_the_signing_key() -> None:
    template = _template()
    template.has_resource_properties("AWS::Events::Rule", {"ScheduleExpression": "rate(15 minutes)"})
    template.has_resource_properties("AWS::Lambda::Function", {"Handler": "push.reminders.handler", "Layers": Match.any_value()})
    policies = template.find_resources("AWS::IAM::Policy")
    statements = [s for p in policies.values() for s in p["Properties"]["PolicyDocument"]["Statement"]]
    ssm = [s for s in statements if "ssm" in json.dumps(s["Action"])]
    assert ssm and all(s["Action"] == "ssm:GetParameter" and "vapid-private-key" in json.dumps(s["Resource"]) for s in ssm)


def test_unconfirmed_photo_uploads_expire_after_a_day() -> None:
    bucket = next(b for b in _template().find_resources("AWS::S3::Bucket").values() if b["Properties"].get("BucketName"))
    rules = bucket["Properties"]["LifecycleConfiguration"]["Rules"]
    assert any(r.get("Prefix") == "incoming/" and r["ExpirationInDays"] == 1 for r in rules)


def test_backup_runs_sundays_into_a_private_bucket_and_can_only_add_files() -> None:
    t = _template()
    t.has_resource_properties("AWS::Events::Rule", {"ScheduleExpression": "cron(0 6 ? * SUN *)"})

    def expires_in_90_days(bucket: dict) -> bool:
        rules = bucket["Properties"].get("LifecycleConfiguration", {}).get("Rules", [])
        return any(r.get("ExpirationInDays") == 90 for r in rules)

    buckets = [b for b in t.find_resources("AWS::S3::Bucket").values() if expires_in_90_days(b)]
    assert len(buckets) == 1 and buckets[0]["DeletionPolicy"] == "Retain"
    assert buckets[0]["Properties"]["PublicAccessBlockConfiguration"]["BlockPublicAcls"] is True
    statements = [
        s for p in t.find_resources("AWS::IAM::Policy").values() for s in p["Properties"]["PolicyDocument"]["Statement"]
    ]
    assert len([s for s in statements if s["Action"] == "s3:PutObject"]) == 1


def test_localhost_is_allowed_only_with_the_dev_origin_context() -> None:
    assert "http://localhost:5173" not in json.dumps(_template().to_json())
    dev = _template({"githubRepo": REPO, "devOrigin": "true"})
    dev.has_resource_properties(
        "AWS::ApiGatewayV2::Api", {"CorsConfiguration": {"AllowOrigins": Match.array_with(["http://localhost:5173"])}}
    )
    dev.has_resource_properties("AWS::Cognito::UserPoolClient", {"CallbackURLs": Match.array_with(["http://localhost:5173/"])})
