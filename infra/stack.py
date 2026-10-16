"""The Tennis Tracker stack: data table, daily WTN sync, sign-in, API, hosting and the GitHub deploy role."""

import re

from aws_cdk import CfnOutput, DefaultStackSynthesizer, Duration, RemovalPolicy, Stack
from aws_cdk import aws_cloudwatch_actions as cw_actions
from aws_cdk import aws_dynamodb as dynamodb
from aws_cdk import aws_events as events
from aws_cdk import aws_events_targets as targets
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from aws_cdk import aws_sns as sns
from aws_cdk import aws_sns_subscriptions as subs
from cdk_nag import NagPackSuppression, NagSuppressions, RegexAppliesTo
from constructs import Construct

from infra.web import Web

GITHUB = "token.actions.githubusercontent.com"


class TennisTrackerStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # One table for everything, keyed by user (PK) and item type (SK), as in the plan's data model.
        self.table = dynamodb.TableV2(
            self,
            "Table",
            partition_key=dynamodb.Attribute(name="PK", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="SK", type=dynamodb.AttributeType.STRING),
            billing=dynamodb.Billing.on_demand(),
            point_in_time_recovery_specification=dynamodb.PointInTimeRecoverySpecification(point_in_time_recovery_enabled=True),
            deletion_protection=True,
            removal_policy=RemovalPolicy.RETAIN,
        )
        CfnOutput(self, "TableName", value=self.table.table_name)

        topic = self._alert_topic()
        # 11:00 UTC = 06:00 Chicago in summer (05:00 in winter).
        self._scheduled("WtnSync", "wtn_sync.handler.handler", events.Schedule.cron(minute="0", hour="11"), topic, "WTN sync")
        calendar = self._scheduled(
            "CalendarSync", "calendar_sync.handler.handler", events.Schedule.rate(Duration.hours(1)), topic, "Calendar sync"
        )
        site_dir = self.node.try_get_context("siteDir") or "frontend/dist"
        Web(self, "Web", table=self.table, site_dir=site_dir, calendar_fn=calendar)  # pyright: ignore[reportArgumentType]

        github_repo: str = self.node.try_get_context("githubRepo") or ""
        if github_repo:
            self._github_deploy_role(github_repo)

    def _alert_topic(self) -> sns.Topic:
        topic = sns.Topic(self, "AlertTopic", enforce_ssl=True)
        alert_email: str = self.node.try_get_context("alertEmail") or ""
        if alert_email:
            topic.add_subscription(subs.EmailSubscription(alert_email))  # pyright: ignore[reportArgumentType]
        NagSuppressions.add_resource_suppressions(
            topic,
            [NagPackSuppression(id="AwsSolutions-SNS2", reason="Alerts hold no secrets; a customer-managed key costs $1/month")],
        )
        return topic

    def _scheduled(self, name: str, handler: str, schedule: events.Schedule, topic: sns.Topic, what: str) -> lambda_.Function:
        """A Lambda on a schedule, with table access, 14-day logs and an email if it crashes."""
        fn = lambda_.Function(
            self,
            name,
            runtime=lambda_.Runtime.PYTHON_3_14,
            architecture=lambda_.Architecture.ARM_64,
            handler=handler,
            code=lambda_.Code.from_asset("backend", exclude=["**/__pycache__"]),
            memory_size=256,
            timeout=Duration.seconds(60),
            environment={"TABLE_NAME": self.table.table_name, "ALERT_TOPIC_ARN": topic.topic_arn},
            log_group=logs.LogGroup(self, f"{name}Logs", retention=logs.RetentionDays.TWO_WEEKS),
        )
        self.table.grant_read_write_data(fn)
        topic.grant_publish(fn)
        target = targets.LambdaFunction(fn)  # pyright: ignore[reportArgumentType]
        events.Rule(self, f"{name}Schedule", schedule=schedule, targets=[target])  # pyright: ignore[reportArgumentType]
        fn.metric_errors(period=Duration.days(1)).create_alarm(
            self, f"{name}Errors", threshold=1, evaluation_periods=1, alarm_description=f"{what} Lambda crashed"
        ).add_alarm_action(cw_actions.SnsAction(topic))  # pyright: ignore[reportArgumentType]
        CfnOutput(self, f"{name}Function", value=fn.function_name)
        NagSuppressions.add_resource_suppressions(
            fn,
            [
                NagPackSuppression(
                    id="AwsSolutions-IAM4",
                    reason="AWSLambdaBasicExecutionRole only allows writing this function's logs",
                    applies_to=["Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"],
                ),
                NagPackSuppression(
                    id="AwsSolutions-IAM5",
                    reason="CDK's table grant includes its indexes",
                    applies_to=[RegexAppliesTo(regex=r"/^Resource::<Table.+\.Arn>\/index\/\*$/g")],
                ),
            ],
            apply_to_children=True,
        )
        return fn

    def _github_deploy_role(self, github_repo: str) -> None:
        """Role for GitHub Actions in this repo's production environment. Reuses the account's OIDC provider."""
        if not re.fullmatch(r"[\w.-]+(@\d+)?/[\w.-]+(@\d+)?", github_repo):
            raise ValueError("githubRepo must be owner/repo or owner@id/repo@id")
        synthesizer = self.synthesizer
        qualifier = (
            synthesizer.bootstrap_qualifier if isinstance(synthesizer, DefaultStackSynthesizer) else None
        ) or DefaultStackSynthesizer.DEFAULT_QUALIFIER
        provider_arn = f"arn:{self.partition}:iam::{self.account}:oidc-provider/{GITHUB}"
        role = iam.Role(
            self,
            "GitHubDeployRole",
            description=f"GitHub Actions deploys from {github_repo} (production environment only)",
            max_session_duration=Duration.hours(1),
            assumed_by=iam.WebIdentityPrincipal(  # pyright: ignore[reportArgumentType]
                provider_arn,
                conditions={
                    "StringEquals": {
                        f"{GITHUB}:aud": "sts.amazonaws.com",
                        f"{GITHUB}:sub": f"repo:{github_repo}:environment:production",
                    }
                },
            ),
        )
        # Deploys go through the CDK bootstrap roles.
        role.add_to_policy(
            iam.PolicyStatement(
                actions=["sts:AssumeRole"],
                resources=[f"arn:{self.partition}:iam::{self.account}:role/cdk-{qualifier}-*-{self.account}-{self.region}"],
            )
        )
        self.table.grant(role, "dynamodb:DescribeTable")  # smoke test
        NagSuppressions.add_resource_suppressions(
            role,
            [
                NagPackSuppression(
                    id="AwsSolutions-IAM5",
                    reason="Only sts:AssumeRole on this account's CDK bootstrap roles",
                    # Partition and account render as literals or tokens depending on flags and credentials.
                    applies_to=[RegexAppliesTo(regex=rf"/^Resource::arn:.+:iam::.+:role\/cdk-{qualifier}-\*-.+$/g")],
                )
            ],
            apply_to_children=True,
        )
        CfnOutput(self, "GitHubDeployRoleArn", value=role.role_arn)
