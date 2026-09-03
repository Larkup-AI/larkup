from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_SECURITY_TOKEN", "testing")
os.environ.setdefault("AWS_SESSION_TOKEN", "testing")
os.environ["AWS_REGION"] = "us-east-1"
os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
os.environ["TABLE_NAME"] = "larkup-video-test-table"
os.environ["BUCKET_NAME"] = "larkup-video-test-bucket"
os.environ.setdefault("RUNPOD_API_KEY", "testing-runpod")

_CONTROL_PLANE_DIR = Path(__file__).resolve().parents[1]
_DEPLOY_DIR = _CONTROL_PLANE_DIR.parent.parent
for path in (str(_CONTROL_PLANE_DIR), str(_DEPLOY_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

from moto import mock_aws  # noqa: E402


class _FakeProvider:
    name = "fake"

    def __init__(self) -> None:
        self.launch_calls: list[dict] = []

    def launch(self, *, job_id, image, env, gpu_type):
        self.launch_calls.append({"jobId": job_id, "env": env, "gpuType": gpu_type})
        return "fake-instance-1"


@mock_aws
class CreateJobTests(unittest.TestCase):
    def setUp(self) -> None:
        import boto3

        for name in [mod for mod in sys.modules if mod == "handler"]:
            del sys.modules[name]
        import handler  # noqa: PLC0415

        self.handler = handler
        self.handler.PROCESSING_ENABLED = True

        self.dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
        self.dynamodb.create_table(
            TableName=os.environ["TABLE_NAME"],
            AttributeDefinitions=[
                {"AttributeName": "pk", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "S"},
            ],
            KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
            BillingMode="PAY_PER_REQUEST",
        )
        self.handler.table = self.dynamodb.Table(os.environ["TABLE_NAME"])

        s3 = boto3.client("s3", region_name="us-east-1")
        s3.create_bucket(Bucket=os.environ["BUCKET_NAME"])
        self.handler.s3 = s3

        self.principal = {"id": "principal-1", "entitlement": {"unlimitedRequests": True}}
        self.fake_provider = _FakeProvider()
        self.models = {
            "audio": {"provider": "deepgram", "apiKey": "audio-secret", "model": "nova-3"},
            "brain": {"provider": "openai", "apiKey": "brain-secret", "model": "openai/gpt-5-mini"},
            "vision": {"provider": "vercel_ai_gateway", "apiKey": "vision-secret", "model": "google/gemini-3.6-flash"},
        }

    def test_create_job_with_an_external_source_url_skips_the_upload_lookup(self) -> None:
        with patch.object(self.handler, "get_provider", return_value=self.fake_provider):
            result = self.handler.create_job(
                self.principal,
                {
                    "source": {"url": "https://canonical.example.com/videos/a.mp4?sig=1", "durationSecs": 120},
                    "brief": {"indexingMode": "thorough", "importantRanges": [{"startSecs": 10, "endSecs": 40}]},
                    "modelConfiguration": self.models,
                },
            )
        self.assertEqual(result["statusCode"], 202)
        self.assertEqual(len(self.fake_provider.launch_calls), 1)
        launched_env = self.fake_provider.launch_calls[0]["env"]
        self.assertEqual(launched_env["sourceUrl"], "https://canonical.example.com/videos/a.mp4?sig=1")

        job_id = self.fake_provider.launch_calls[0]["jobId"]
        item = self.handler.table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"})["Item"]
        self.assertNotIn("sourceKey", item)

    def test_create_job_forwards_user_models_only_to_the_worker(self) -> None:
        with patch.object(self.handler, "get_provider", return_value=self.fake_provider):
            result = self.handler.create_job(
                self.principal,
                {
                    "source": {"url": "https://canonical.example.com/videos/a.mp4", "durationSecs": 120},
                    "brief": {},
                    "modelConfiguration": self.models,
                },
            )
        self.assertEqual(result["statusCode"], 202)
        launched = self.fake_provider.launch_calls[0]["env"]
        self.assertEqual(launched["modelConfiguration"], self.models)
        job_id = self.fake_provider.launch_calls[0]["jobId"]
        item = self.handler.table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"})["Item"]
        self.assertNotIn("modelConfiguration", item)
        self.assertNotIn("vision-secret", json.dumps(item, default=str))
        self.assertNotIn("brain-secret", json.dumps(item, default=str))
        self.assertNotIn("audio-secret", json.dumps(item, default=str))

    def test_interactive_job_uses_and_persists_the_bounded_queue(self) -> None:
        interactive_provider = _FakeProvider()
        self.handler.GPU_PROVIDER = "runpod"
        self.handler.RUNPOD_INTERACTIVE_ENDPOINT_ID = "interactive-endpoint"

        with patch.object(
            self.handler,
            "RunpodProvider",
            return_value=interactive_provider,
        ) as provider_class:
            result = self.handler.create_job(
                self.principal,
                {
                    "source": {
                        "url": "https://canonical.example.com/videos/a.mp4",
                        "durationSecs": 30,
                    },
                    "brief": {"interactive": True},
                    "modelConfiguration": self.models,
                },
            )

        self.assertEqual(result["statusCode"], 202)
        self.assertGreaterEqual(provider_class.call_count, 1)
        self.assertTrue(
            all(
                call.kwargs
                == {
                    "api_key": os.environ["RUNPOD_API_KEY"],
                    "endpoint_id": "interactive-endpoint",
                }
                for call in provider_class.call_args_list
            )
        )
        job_id = interactive_provider.launch_calls[0]["jobId"]
        item = self.handler.table.get_item(
            Key={"pk": f"JOB#{job_id}", "sk": "JOB"}
        )["Item"]
        self.assertEqual(item["providerEndpointId"], "interactive-endpoint")

    def test_create_job_with_an_external_source_url_requires_https(self) -> None:
        with patch.object(self.handler, "get_provider", return_value=self.fake_provider):
            with self.assertRaises(self.handler.ApiError) as ctx:
                self.handler.create_job(
                    self.principal,
                    {"source": {"url": "http://insecure.example.com/a.mp4", "durationSecs": 60}, "brief": {}, "modelConfiguration": self.models},
                )
        self.assertEqual(ctx.exception.status, 400)

    def test_cancel_only_active_job_targets_the_single_principal_job(self) -> None:
        self.handler.table.put_item(
            Item={
                "pk": "JOB#job-active",
                "sk": "JOB",
                "principalId": self.principal["id"],
                "status": "running",
            }
        )
        with patch.object(self.handler, "cancel_job", return_value={"id": "job-active"}) as cancel:
            result = self.handler.cancel_only_active_job(self.principal)
        self.assertEqual(result, {"id": "job-active"})
        cancel.assert_called_once_with(self.principal, "job-active")

    def test_cancel_only_active_job_rejects_an_ambiguous_principal(self) -> None:
        for job_id in ("job-one", "job-two"):
            self.handler.table.put_item(
                Item={
                    "pk": f"JOB#{job_id}",
                    "sk": "JOB",
                    "principalId": self.principal["id"],
                    "status": "queued",
                }
            )
        with self.assertRaises(self.handler.ApiError) as ctx:
            self.handler.cancel_only_active_job(self.principal)
        self.assertEqual(ctx.exception.status, 409)

    def test_cancel_only_active_job_clears_a_stale_usage_counter(self) -> None:
        period, _, _ = self.handler.billing_period()
        self.handler.table.put_item(
            Item={
                "pk": f"USAGE#{self.principal['id']}#{period}",
                "sk": "USAGE",
                "activeJobs": 1,
            }
        )
        result = self.handler.cancel_only_active_job(self.principal)
        body = json.loads(result["body"])
        self.assertTrue(body["alreadyStopped"])
        usage = self.handler.table.get_item(
            Key={"pk": f"USAGE#{self.principal['id']}#{period}", "sk": "USAGE"}
        )["Item"]
        self.assertEqual(usage["activeJobs"], 0)

    def test_usage_returns_exact_active_job_ids_for_safe_host_recovery(self) -> None:
        period, _, _ = self.handler.billing_period()
        self.handler.table.put_item(
            Item={
                "pk": f"USAGE#{self.principal['id']}#{period}",
                "sk": "USAGE",
                "activeJobs": 1,
            }
        )
        self.handler.table.put_item(
            Item={
                "pk": "JOB#job-orphan",
                "sk": "JOB",
                "principalId": self.principal["id"],
                "status": "queued",
            }
        )

        result = self.handler.usage(self.principal)
        body = json.loads(result["body"])

        self.assertEqual(body["activeJobs"], 1)
        self.assertEqual(body["activeJobIds"], ["job-orphan"])

    def test_create_job_explains_when_the_video_exceeds_the_remaining_quota(self) -> None:
        principal = {
            "id": "principal-1",
            "entitlement": {
                "sourceMinutesPerMonth": 30,
                "maxConcurrentJobs": 1,
            },
        }

        with self.assertRaises(self.handler.ApiError) as ctx:
            self.handler.create_job(
                principal,
                {
                    "source": {"url": "https://canonical.example.com/videos/long.mp4", "durationSecs": 31 * 60},
                    "brief": {},
                    "modelConfiguration": self.models,
                },
            )

        self.assertEqual(ctx.exception.status, 429)
        self.assertEqual(
            str(ctx.exception),
            "Your cloud quota has 30.00 minutes remaining, but this video requires 31.00 minutes.",
        )

    def test_create_job_still_supports_the_uploadid_flow(self) -> None:
        self.handler.table.put_item(
            Item={
                "pk": "UPLOAD#upl_1",
                "sk": "UPLOAD",
                "principalId": "principal-1",
                "sourceKey": "sources/principal-1/upl_1.mp4",
                "fileName": "a.mp4",
                "sizeBytes": 1000,
            }
        )
        self.handler.s3.put_object(Bucket=os.environ["BUCKET_NAME"], Key="sources/principal-1/upl_1.mp4", Body=b"data")

        with patch.object(self.handler, "get_provider", return_value=self.fake_provider):
            result = self.handler.create_job(
                self.principal,
                {"source": {"uploadId": "upl_1", "durationSecs": 60}, "brief": {}, "modelConfiguration": self.models},
            )
        self.assertEqual(result["statusCode"], 202)
        launched_env = self.fake_provider.launch_calls[0]["env"]
        self.assertIn("sources/principal-1/upl_1.mp4", launched_env["sourceUrl"])

        job_id = self.fake_provider.launch_calls[0]["jobId"]
        item = self.handler.table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"})["Item"]
        self.assertEqual(item["sourceKey"], "sources/principal-1/upl_1.mp4")

    def test_bounded_job_keeps_the_original_timeline_for_the_worker(self) -> None:
        with patch.object(self.handler, "get_provider", return_value=self.fake_provider):
            result = self.handler.create_job(
                self.principal,
                {
                    "source": {
                        "url": "https://example.test/source.mp4",
                        "durationSecs": 20,
                        "timelineDurationSecs": 3_137.241,
                    },
                    "brief": {
                        "interactive": True,
                        "importantRanges": [{"startSecs": 0, "endSecs": 20}],
                    },
                    "modelConfiguration": self.models,
                },
            )

        self.assertEqual(result["statusCode"], 202)
        self.assertEqual(
            self.fake_provider.launch_calls[0]["env"]["sourceDurationSecs"],
            3_137.241,
        )

    def test_interactive_zero_start_keeps_the_bounded_worker_path_without_timeline_metadata(
        self,
    ) -> None:
        with patch.object(self.handler, "get_provider", return_value=self.fake_provider):
            result = self.handler.create_job(
                self.principal,
                {
                    "source": {
                        "url": "https://example.test/source.mp4",
                        "durationSecs": 20,
                    },
                    "brief": {
                        "interactive": True,
                        "importantRanges": [{"startSecs": 0, "endSecs": 20}],
                    },
                    "modelConfiguration": self.models,
                },
            )

        self.assertEqual(result["statusCode"], 202)
        self.assertEqual(
            self.fake_provider.launch_calls[0]["env"]["sourceDurationSecs"], 21.0
        )

    def test_settle_skips_s3_delete_for_a_job_with_no_source_key(self) -> None:
        item = {
            "pk": "JOB#job_external",
            "sk": "JOB",
            "principalId": "principal-1",
            "period": "2026-08",
            "estimatedSourceMinutes": "1",
            "retainSourceHours": 0,
        }
        self.handler.table.put_item(
            Item={
                **item,
                "status": "running",
                "progressJson": "{}",
                "createdAt": "now",
                "updatedAt": "now",
            }
        )
        self.handler.table.put_item(
            Item={
                "pk": "USAGE#principal-1#2026-08",
                "sk": "USAGE",
                "reservedSourceMinutes": 1,
                "sourceMinutesUsed": 0,
                "availableSourceMinutes": 100,
                "activeJobs": 1,
            }
        )
        # Must not raise even though there is no sourceKey to delete.
        self.handler.settle(item, "completed", 0.5, result_key="results/principal-1/job_external.json")

    def test_device_trials_are_capped_and_support_can_update_one_device(self) -> None:
        self.assertEqual(self.handler.TRIAL_DEVICE_LIMIT, 100)
        self.assertEqual(self.handler.TRIAL_SOURCE_MINUTES, 600)
        self.handler.AUTO_PROVISIONING_ENABLED = True
        self.handler.TRIAL_DEVICE_LIMIT = 1
        self.handler.POST_TRIAL_SOURCE_MINUTES = 0
        self.handler.TRIAL_REQUESTS_PER_MINUTE = 25

        first_id, second_id = "a" * 32, "b" * 32
        first = json.loads(self.handler.provision_device_key({"installationId": first_id})["body"])
        second = json.loads(self.handler.provision_device_key({"installationId": second_id})["body"])
        self.assertEqual(first["entitlement"]["plan"], "first-100-trial")
        self.assertEqual(first["entitlement"]["sourceMinutesPerMonth"], 600)
        self.assertEqual(second["entitlement"]["plan"], "support-required")
        self.assertEqual(second["entitlement"]["sourceMinutesPerMonth"], 0)

        updated = json.loads(
            self.handler.update_device_entitlement(
                second_id,
                {
                    "sourceMinutesPerMonth": 60,
                    "maxConcurrentJobs": 2,
                    "requestsPerMinute": 45,
                    "plan": "support-grant",
                },
            )["body"]
        )
        self.assertEqual(updated["entitlement"]["sourceMinutesPerMonth"], 60)
        self.assertEqual(updated["entitlement"]["maxConcurrentJobs"], 2)
        self.assertEqual(updated["entitlement"]["requestsPerMinute"], 45)

        principal = self.handler.authenticate(f"Bearer {second['apiKey']}")
        self.assertEqual(principal["entitlement"]["plan"], "support-grant")

    def test_settle_deletes_the_source_object_when_retain_hours_is_zero(self) -> None:
        self.handler.s3.put_object(Bucket=os.environ["BUCKET_NAME"], Key="sources/principal-1/upl_2.mp4", Body=b"data")
        item = {
            "pk": "JOB#job_owned",
            "sk": "JOB",
            "principalId": "principal-1",
            "period": "2026-08",
            "estimatedSourceMinutes": "1",
            "retainSourceHours": 0,
            "sourceKey": "sources/principal-1/upl_2.mp4",
        }
        self.handler.table.put_item(
            Item={**item, "status": "running", "progressJson": "{}", "createdAt": "now", "updatedAt": "now"}
        )
        self.handler.table.put_item(
            Item={
                "pk": "USAGE#principal-1#2026-08",
                "sk": "USAGE",
                "reservedSourceMinutes": 1,
                "sourceMinutesUsed": 0,
                "availableSourceMinutes": 100,
                "activeJobs": 1,
            }
        )
        self.handler.settle(item, "completed", 0.5, result_key="results/principal-1/job_owned.json")
        with self.assertRaises(Exception):
            self.handler.s3.head_object(Bucket=os.environ["BUCKET_NAME"], Key="sources/principal-1/upl_2.mp4")


if __name__ == "__main__":
    unittest.main()
