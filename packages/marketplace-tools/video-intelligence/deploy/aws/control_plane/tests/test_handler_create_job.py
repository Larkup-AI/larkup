from __future__ import annotations

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

        self.principal = {"id": "principal-1", "entitlement": {"allowFullCoverage": True, "unlimitedRequests": True}}
        self.fake_provider = _FakeProvider()

    def test_create_job_with_an_external_source_url_skips_the_upload_lookup(self) -> None:
        with patch.object(self.handler, "get_provider", return_value=self.fake_provider):
            result = self.handler.create_job(
                self.principal,
                {
                    "source": {"url": "https://canonical.example.com/videos/a.mp4?sig=1", "durationSecs": 120},
                    "brief": {"indexingMode": "deep", "importantRanges": [{"startSecs": 10, "endSecs": 40}]},
                },
            )
        self.assertEqual(result["statusCode"], 202)
        self.assertEqual(len(self.fake_provider.launch_calls), 1)
        launched_env = self.fake_provider.launch_calls[0]["env"]
        self.assertEqual(launched_env["sourceUrl"], "https://canonical.example.com/videos/a.mp4?sig=1")

        job_id = self.fake_provider.launch_calls[0]["jobId"]
        item = self.handler.table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"})["Item"]
        self.assertNotIn("sourceKey", item)

    def test_create_job_with_an_external_source_url_requires_https(self) -> None:
        with patch.object(self.handler, "get_provider", return_value=self.fake_provider):
            with self.assertRaises(self.handler.ApiError) as ctx:
                self.handler.create_job(
                    self.principal,
                    {"source": {"url": "http://insecure.example.com/a.mp4", "durationSecs": 60}, "brief": {}},
                )
        self.assertEqual(ctx.exception.status, 400)

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
                {"source": {"uploadId": "upl_1", "durationSecs": 60}, "brief": {}},
            )
        self.assertEqual(result["statusCode"], 202)
        launched_env = self.fake_provider.launch_calls[0]["env"]
        self.assertIn("sources/principal-1/upl_1.mp4", launched_env["sourceUrl"])

        job_id = self.fake_provider.launch_calls[0]["jobId"]
        item = self.handler.table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"})["Item"]
        self.assertEqual(item["sourceKey"], "sources/principal-1/upl_1.mp4")

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
