"""Sign-in (Cognito passkeys), the `/me` HTTP API, and the app's hosting (private S3 behind CloudFront)."""

import json
from pathlib import Path

from aws_cdk import Aws, CfnOutput, Duration, RemovalPolicy, Stack
from aws_cdk import aws_apigatewayv2 as apigw
from aws_cdk import aws_apigatewayv2_authorizers as authorizers
from aws_cdk import aws_apigatewayv2_integrations as integrations
from aws_cdk import aws_cloudfront as cloudfront
from aws_cdk import aws_cloudfront_origins as origins
from aws_cdk import aws_cloudwatch as cloudwatch
from aws_cdk import aws_cloudwatch_actions as cw_actions
from aws_cdk import aws_cognito as cognito
from aws_cdk import aws_dynamodb as dynamodb
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from aws_cdk import aws_s3 as s3
from aws_cdk import aws_s3_deployment as s3deploy
from aws_cdk import aws_sns as sns
from cdk_nag import NagPackSuppression, NagSuppressions, RegexAppliesTo
from constructs import Construct

from infra.push import grant_vapid

DEV_ORIGIN = "http://localhost:5173"


class Web(Construct):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        table: dynamodb.ITableV2,
        site_dir: str,
        calendar_fn: lambda_.IFunction,
        wtn_fn: lambda_.IFunction,
        layer: lambda_.ILayerVersion,
        push_env: dict[str, str],
        topic: sns.ITopic,
    ) -> None:
        super().__init__(scope, construct_id)
        region = Stack.of(self).region

        # ---- hosting: private bucket, served only through CloudFront
        bucket = s3.Bucket(
            self,
            "SiteBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            object_ownership=s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )
        auth_prefix = f"tennis-tracker-{Aws.ACCOUNT_ID}"
        photo_bucket_name = f"{auth_prefix}-photos"
        photo_host = f"{photo_bucket_name}.s3.{region}.amazonaws.com"
        auth_url = f"https://{auth_prefix}.auth.{region}.amazoncognito.com"
        headers = cloudfront.ResponseHeadersPolicy(
            self,
            "SecurityHeaders",
            security_headers_behavior=cloudfront.ResponseSecurityHeadersBehavior(
                content_security_policy=cloudfront.ResponseHeadersContentSecurityPolicy(
                    content_security_policy=(
                        "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; "
                        f"img-src 'self' data: https://{photo_host}; "
                        "manifest-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; "
                        f"connect-src 'self' https://*.execute-api.{region}.amazonaws.com {auth_url} https://{photo_host}; "
                        "upgrade-insecure-requests"
                    ),
                    override=True,
                ),
                strict_transport_security=cloudfront.ResponseHeadersStrictTransportSecurity(
                    access_control_max_age=Duration.days(365), include_subdomains=True, override=True
                ),
                content_type_options=cloudfront.ResponseHeadersContentTypeOptions(override=True),
                frame_options=cloudfront.ResponseHeadersFrameOptions(
                    frame_option=cloudfront.HeadersFrameOption.DENY, override=True
                ),
                referrer_policy=cloudfront.ResponseHeadersReferrerPolicy(
                    referrer_policy=cloudfront.HeadersReferrerPolicy.NO_REFERRER, override=True
                ),
            ),
            custom_headers_behavior=cloudfront.ResponseCustomHeadersBehavior(
                custom_headers=[
                    cloudfront.ResponseCustomHeader(
                        header="Permissions-Policy",
                        value="camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
                        override=True,
                    ),
                    cloudfront.ResponseCustomHeader(header="Cross-Origin-Opener-Policy", value="same-origin", override=True),
                ]
            ),
        )
        distribution = cloudfront.Distribution(
            self,
            "Site",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_control(bucket),  # pyright: ignore[reportArgumentType]
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                response_headers_policy=headers,
            ),
            default_root_object="index.html",
            # The app routes in the browser: unknown paths load the app.
            error_responses=[
                cloudfront.ErrorResponse(http_status=code, response_http_status=200, response_page_path="/index.html")
                for code in (403, 404)
            ],
            price_class=cloudfront.PriceClass.PRICE_CLASS_100,
        )
        site_url = f"https://{distribution.distribution_domain_name}"
        # localhost is allowed only when deploying with `-c devOrigin=true`
        dev_origins = [DEV_ORIGIN] if str(self.node.try_get_context("devOrigin")).lower() == "true" else []
        dev_urls = [f"{o}/" for o in dev_origins]

        # ---- photos: private bucket; the app uploads with short-lived signed forms and views with signed links
        photos = s3.Bucket(
            self,
            "PhotoBucket",
            bucket_name=photo_bucket_name,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            minimum_tls_version=1.2,
            versioned=True,  # an overwritten or deleted photo can be restored for a week
            lifecycle_rules=[
                s3.LifecycleRule(
                    noncurrent_version_expiration=Duration.days(7), abort_incomplete_multipart_upload_after=Duration.days(1)
                ),
                # Uploads land here until the app confirms them; unconfirmed ones are not kept.
                s3.LifecycleRule(prefix="incoming/", expiration=Duration.days(1), noncurrent_version_expiration=Duration.days(1)),
            ],
            object_ownership=s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
            removal_policy=RemovalPolicy.RETAIN,  # your photos outlive a stack teardown
            cors=[
                s3.CorsRule(
                    allowed_origins=[site_url],  # the app only, not localhost
                    allowed_methods=[s3.HttpMethods.POST],
                    allowed_headers=["Content-Type"],
                    max_age=3600,
                )
            ],
        )

        # ---- sign-in: passkeys (Face ID / Touch ID) first; password as backup; no self sign-up
        pool = cognito.UserPool(
            self,
            "UserPool",
            self_sign_up_enabled=False,
            sign_in_aliases=cognito.SignInAliases(email=True),
            auto_verify=cognito.AutoVerifiedAttrs(email=True),
            password_policy=cognito.PasswordPolicy(
                min_length=12,
                require_lowercase=True,
                require_uppercase=True,
                require_digits=True,
                require_symbols=True,
                temp_password_validity=Duration.days(3),
            ),
            mfa=cognito.Mfa.OPTIONAL,
            mfa_second_factor=cognito.MfaSecondFactor(otp=True, sms=False),
            sign_in_policy=cognito.SignInPolicy(
                allowed_first_auth_factors=cognito.AllowedFirstAuthFactors(password=True, passkey=True)
            ),
            passkey_user_verification=cognito.PasskeyUserVerification.REQUIRED,
            account_recovery=cognito.AccountRecovery.EMAIL_ONLY,
            feature_plan=cognito.FeaturePlan.ESSENTIALS,
            deletion_protection=True,
            removal_policy=RemovalPolicy.RETAIN,
        )
        cfn_pool: cognito.CfnUserPool = pool.node.default_child  # type: ignore[assignment]
        cfn_pool.web_authn_factor_configuration = "MULTI_FACTOR_WITH_USER_VERIFICATION"  # a passkey counts as MFA
        client = pool.add_client(
            "WebClient",
            auth_flows=cognito.AuthFlow(user=True, user_srp=True),
            prevent_user_existence_errors=True,
            generate_secret=False,  # public browser client (authorization code + PKCE)
            access_token_validity=Duration.hours(1),
            id_token_validity=Duration.hours(1),
            refresh_token_validity=Duration.days(30),
            enable_token_revocation=True,
            o_auth=cognito.OAuthSettings(
                flows=cognito.OAuthFlows(authorization_code_grant=True),
                scopes=[cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
                callback_urls=[f"{site_url}/", *dev_urls],
                logout_urls=[f"{site_url}/", *dev_urls],
            ),
            supported_identity_providers=[cognito.UserPoolClientIdentityProvider.COGNITO],
        )
        # Managed login v2 is needed for passkeys; its style must exist before the page switches to v2.
        branding = cognito.CfnManagedLoginBranding(
            self,
            "LoginBranding",
            user_pool_id=pool.user_pool_id,
            client_id=client.user_pool_client_id,
            use_cognito_provided_values=False,
            settings=json.loads((Path(__file__).parent / "login" / "branding.json").read_text()),  # dark, app colours
        )
        domain = pool.add_domain(
            "LoginDomain",
            cognito_domain=cognito.CognitoDomainOptions(domain_prefix=auth_prefix),
            managed_login_version=cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
        )
        domain.node.add_dependency(branding)

        # ---- API: every route needs a signed-in user
        fn = lambda_.Function(
            self,
            "Api",
            runtime=lambda_.Runtime.PYTHON_3_14,
            architecture=lambda_.Architecture.ARM_64,
            handler="api.handler.handler",
            code=lambda_.Code.from_asset("backend", exclude=["**/__pycache__"]),
            memory_size=256,
            timeout=Duration.seconds(10),
            environment={
                "TABLE_NAME": table.table_name,
                "PHOTO_BUCKET": photos.bucket_name,
                "CALENDAR_FUNCTION": calendar_fn.function_name,
                "WTN_FUNCTION": wtn_fn.function_name,
                **push_env,
            },
            layers=[layer],
            log_group=logs.LogGroup(self, "ApiLogs", retention=logs.RetentionDays.TWO_WEEKS),
        )
        table.grant_read_write_data(fn)
        # The app's own function: a burst of crashes (3 in 5 minutes) or throttled calls emails the alert topic.
        for metric_name, metric in (("Errors", fn.metric_errors), ("Throttles", fn.metric_throttles)):
            metric(period=Duration.minutes(5)).create_alarm(
                self,
                f"Api{metric_name}",
                threshold=3,
                evaluation_periods=1,
                treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
                alarm_description=f"The app's API Lambda reported {metric_name.lower()}",
            ).add_alarm_action(cw_actions.SnsAction(topic))  # pyright: ignore[reportArgumentType]
        fn.add_to_role_policy(  # photos only: add, view and delete objects (no listing, no bucket settings)
            iam.PolicyStatement(
                actions=["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], resources=[photos.arn_for_objects("*")]
            )
        )
        grant_vapid(fn)  # "send a test"
        calendar_fn.grant_invoke(fn)  # sync right after the calendar link is saved
        wtn_fn.grant_invoke(fn)  # "Sync now" for WTN
        api = apigw.HttpApi(
            self,
            "HttpApi",
            create_default_stage=False,
            default_authorizer=authorizers.HttpUserPoolAuthorizer("Cognito", pool, user_pool_clients=[client]),  # pyright: ignore[reportArgumentType]
            cors_preflight=apigw.CorsPreflightOptions(
                allow_origins=[site_url, *dev_origins],
                allow_methods=[
                    apigw.CorsHttpMethod.GET,
                    apigw.CorsHttpMethod.PUT,
                    apigw.CorsHttpMethod.POST,
                    apigw.CorsHttpMethod.DELETE,
                ],
                allow_headers=["Authorization", "Content-Type"],
                max_age=Duration.hours(1),
            ),
        )
        integration = integrations.HttpLambdaIntegration("ApiIntegration", fn)  # pyright: ignore[reportArgumentType]
        for method, path in (
            (apigw.HttpMethod.GET, "/me/profile"),
            (apigw.HttpMethod.GET, "/me/ratings"),
            (apigw.HttpMethod.PUT, "/me/ratings"),
            (apigw.HttpMethod.GET, "/me/matches"),
            (apigw.HttpMethod.POST, "/me/matches"),
            (apigw.HttpMethod.PUT, "/me/matches/{id}"),
            (apigw.HttpMethod.DELETE, "/me/matches/{id}"),
            (apigw.HttpMethod.PUT, "/me/matches/{id}/extras"),
            (apigw.HttpMethod.GET, "/me/trophies"),
            (apigw.HttpMethod.POST, "/me/trophies"),
            (apigw.HttpMethod.POST, "/me/trophies/dismiss"),
            (apigw.HttpMethod.PUT, "/me/trophies/{id}"),
            (apigw.HttpMethod.DELETE, "/me/trophies/{id}"),
            (apigw.HttpMethod.GET, "/me/photos"),
            (apigw.HttpMethod.POST, "/me/photos"),
            (apigw.HttpMethod.POST, "/me/photos/upload-url"),
            (apigw.HttpMethod.PUT, "/me/photos/{id}"),
            (apigw.HttpMethod.DELETE, "/me/photos/{id}"),
            (apigw.HttpMethod.GET, "/me/upcoming"),
            (apigw.HttpMethod.PUT, "/me/calendar"),
            (apigw.HttpMethod.POST, "/me/wtn-sync"),
            (apigw.HttpMethod.GET, "/me/push"),
            (apigw.HttpMethod.PUT, "/me/push"),
            (apigw.HttpMethod.DELETE, "/me/push"),
            (apigw.HttpMethod.POST, "/me/push/test"),
            (apigw.HttpMethod.GET, "/me/widget"),
            (apigw.HttpMethod.POST, "/me/widget"),
            (apigw.HttpMethod.DELETE, "/me/widget"),
        ):
            api.add_routes(path=path, methods=[method], integration=integration)
        # The widget (Scriptable) can't sign in: the handler checks its own revocable token.
        api.add_routes(
            path="/widget", methods=[apigw.HttpMethod.GET], integration=integration, authorizer=apigw.HttpNoneAuthorizer()
        )
        NagSuppressions.add_resource_suppressions_by_path(
            Stack.of(self),
            f"{api.node.path}/GET--widget/Resource",
            [NagPackSuppression(id="AwsSolutions-APIG4", reason="Widget route: the handler checks a hashed, revocable token")],
        )
        access_logs = logs.LogGroup(self, "ApiAccessLogs", retention=logs.RetentionDays.TWO_WEEKS)
        stage = apigw.HttpStage(
            self,
            "Stage",
            http_api=api,
            stage_name="$default",
            auto_deploy=True,
            throttle=apigw.ThrottleSettings(rate_limit=10, burst_limit=20),
        )
        cfn_stage: apigw.CfnStage = stage.node.default_child  # type: ignore[assignment]
        # The widget route is public (token-checked in the handler): cap it so a flood can't use up the app's allowance.
        cfn_stage.route_settings = {
            "GET /widget": {
                "ThrottlingRateLimit": 1,
                "ThrottlingBurstLimit": 3,
            }  # CloudFormation key names: a map value is not converted
        }
        cfn_stage.access_log_settings = apigw.CfnStage.AccessLogSettingsProperty(
            destination_arn=access_logs.log_group_arn,
            format='{"requestId":"$context.requestId","route":"$context.routeKey","status":"$context.status"}',
        )
        api_url = stage.url.rstrip("/")

        # ---- app files plus config.json with this stack's API and sign-in settings
        s3deploy.BucketDeployment(
            self,
            "DeploySite",
            destination_bucket=bucket,
            sources=[
                s3deploy.Source.asset(site_dir),
                s3deploy.Source.json_data(
                    "config.json",
                    {
                        "apiUrl": api_url,
                        "authUrl": auth_url,
                        "clientId": client.user_pool_client_id,
                        "region": region,
                        "vapidPublicKey": Stack.of(self).node.try_get_context("vapidPublicKey") or "",
                    },
                ),
            ],
            distribution=distribution,
            distribution_paths=["/*"],
            memory_limit=256,
        )

        CfnOutput(Stack.of(self), "SiteUrl", value=site_url)
        CfnOutput(Stack.of(self), "ApiUrl", value=api_url)
        CfnOutput(Stack.of(self), "UserPoolId", value=pool.user_pool_id)
        self._suppress(fn, pool, distribution, bucket, photos)

    def _suppress(
        self,
        fn: lambda_.Function,
        pool: cognito.UserPool,
        distribution: cloudfront.Distribution,
        bucket: s3.Bucket,
        photos: s3.Bucket,
    ) -> None:
        def reason(rule: str, why: str, applies_to: list | None = None) -> NagPackSuppression:
            return NagPackSuppression(id=rule, reason=why, applies_to=applies_to)

        logs_policy = "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
        NagSuppressions.add_resource_suppressions(
            fn,
            [
                reason("AwsSolutions-IAM4", "Basic execution role only writes this function's logs", [logs_policy]),
                reason(
                    "AwsSolutions-IAM5",
                    "CDK's table grant includes its indexes",
                    [RegexAppliesTo(regex=r"/^Resource::<Table.+\.Arn>\/index\/\*$/g")],
                ),
                reason(
                    "AwsSolutions-IAM5",
                    "Photos: object-level access to the photo bucket only",
                    [RegexAppliesTo(regex=r"/^Resource::.*PhotoBucket.*\/\*$/g")],
                ),
            ],
            apply_to_children=True,
        )
        NagSuppressions.add_resource_suppressions(
            pool,
            [
                reason("AwsSolutions-COG2", "Passkeys with user verification are the primary factor; TOTP optional"),
                reason("AwsSolutions-COG3", "Advanced security (Plus plan) costs extra; sign-up is closed"),
                reason("AwsSolutions-COG8", "Plus plan costs extra per user; Essentials has passkeys"),
            ],
            apply_to_children=True,
        )
        NagSuppressions.add_resource_suppressions(
            distribution,
            [
                reason("AwsSolutions-CFR1", "Personal app; no geo restriction needed"),
                reason("AwsSolutions-CFR2", "WAF costs ~$5+/month, over budget; API is behind sign-in and throttled"),
                reason("AwsSolutions-CFR3", "Access logs cost extra; CloudFront metrics suffice for a personal app"),
                reason("AwsSolutions-CFR4", "Default CloudFront domain and certificate (no custom domain yet)"),
            ],
        )
        NagSuppressions.add_resource_suppressions(
            bucket, [reason("AwsSolutions-S1", "Static app files only; access logging costs extra")]
        )
        NagSuppressions.add_resource_suppressions(
            photos, [reason("AwsSolutions-S1", "Personal photos; access logging costs extra")]
        )
        # CDK's own helper Lambdas (bucket deployment, auto-delete): their runtime and policies are CDK's.
        stack = Stack.of(self)
        NagSuppressions.add_stack_suppressions(
            stack,
            [
                reason("AwsSolutions-IAM4", "CDK-managed helper Lambdas use the basic execution role", [logs_policy]),
                reason(
                    "AwsSolutions-IAM5",
                    "CDK bucket deployment needs object-level wildcards on its own buckets",
                    [RegexAppliesTo(regex=r"/^(Action::s3:.*|Resource::.*\*)$/g")],
                ),  # fmt: skip
                reason("AwsSolutions-L1", "CDK-managed helper Lambdas pick their own runtime"),
            ],
        )
