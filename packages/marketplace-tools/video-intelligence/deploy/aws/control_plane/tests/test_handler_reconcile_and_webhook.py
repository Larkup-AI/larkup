from __future__ import annotations

import json
import os
import sys
import threading
import unittest
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
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


class _RecordingWebhookHandler(BaseHTTPRequestHandler):
    received: list[dict] = []

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        type(self).received.append({"body": json.loads(body), "headers": dict(self.headers)})
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args) -> None:  # silence test output
        pass


@mock_aws
class ReconcileAndWebhookTests(unittest.TestCase):
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
        self.s3 = boto3.client("s3", region_name="us-east-1")
        self.s3.create_bucket(Bucket=os.environ["BUCKET_NAME"])
        self.handler.s3 = self.s3

    def _put_usage(self, principal_id: str, period: str) -> None:
        self.handler.table.put_item(
            Item={
                "pk": f"USAGE#{principal_id}#{period}",
                "sk": "USAGE",
                "reservedSourceMinutes": 1,
                "sourceMinutesUsed": 0,
                "availableSourceMinutes": 100,
                "activeJobs": 1,
            }
        )

    def test_handler_dispatches_to_reconcile_for_an_eventbridge_scheduled_event(self) -> None:
        with patch.object(self.handler, "reconcile_stale_jobs") as reconcile:
            result = self.handler.handler({"source": "aws.events", "detail-type": "Scheduled Event"}, None)
        reconcile.assert_called_once()
        self.assertEqual(result, {"status": "reconciled"})

    def test_reconcile_stale_jobs_force_fails_a_job_past_the_timeout_and_releases_its_source(self) -> None:
        self.handler.STALE_JOB_TIMEOUT_HOURS = 6
        self.s3.put_object(Bucket=os.environ["BUCKET_NAME"], Key="sources/p1/stuck.mp4", Body=b"data")
        old_created_at = (datetime.now(timezone.utc) - timedelta(hours=10)).isoformat()
        self.handler.table.put_item(
            Item={
                "pk": "JOB#job_stuck",
                "sk": "JOB",
                "principalId": "p1",
                "status": "running",
                "sourceKey": "sources/p1/stuck.mp4",
                "period": "2026-08",
                "estimatedSourceMinutes": "1",
                "retainSourceHours": 0,
                "createdAt": old_created_at,
                "updatedAt": old_created_at,
                "progressJson": "{}",
            }
        )
        self._put_usage("p1", "2026-08")

        self.handler.reconcile_stale_jobs()

        item = self.handler.table.get_item(Key={"pk": "JOB#job_stuck", "sk": "JOB"})["Item"]
        self.assertEqual(item["status"], "failed")
        with self.assertRaises(Exception):
            self.s3.head_object(Bucket=os.environ["BUCKET_NAME"], Key="sources/p1/stuck.mp4")

    def test_reconcile_stale_jobs_leaves_a_fresh_job_untouched_when_the_provider_is_unreachable(self) -> None:
        recent_created_at = datetime.now(timezone.utc).isoformat()
        self.handler.table.put_item(
            Item={
                "pk": "JOB#job_fresh",
                "sk": "JOB",
                "principalId": "p1",
                "status": "running",
                "instanceId": "inst-1",
                "providerName": "modal",
                "period": "2026-08",
                "estimatedSourceMinutes": "1",
                "retainSourceHours": 0,
                "createdAt": recent_created_at,
                "updatedAt": recent_created_at,
                "progressJson": "{}",
            }
        )
        # get_provider("modal") will fail to build (no MODAL_TOKEN_ID/SECRET
        # env), exercising sync_job's own except branch, which conservatively
        # marks the job "queued" (retryable) rather than raising or failing
        # it outright -- must not raise, and must not settle to a terminal
        # status just because one status check had a transient problem.
        self.handler.reconcile_stale_jobs()
        item = self.handler.table.get_item(Key={"pk": "JOB#job_fresh", "sk": "JOB"})["Item"]
        self.assertIn(item["status"], {"queued", "running"})

    def test_settle_delivers_a_signed_webhook_on_completion(self) -> None:
        _RecordingWebhookHandler.received = []
        server = HTTPServer(("127.0.0.1", 0), _RecordingWebhookHandler)
        port = server.server_port
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            self.handler.WEBHOOK_SIGNING_SECRET = "test-secret"
            item = {
                "pk": "JOB#job_webhook",
                "sk": "JOB",
                "principalId": "p1",
                "period": "2026-08",
                "estimatedSourceMinutes": "1",
                "retainSourceHours": 0,
                "webhookUrl": f"http://127.0.0.1:{port}/hook",
            }
            self.handler.table.put_item(
                Item={**item, "status": "running", "progressJson": "{}", "createdAt": "now", "updatedAt": "now"}
            )
            self._put_usage("p1", "2026-08")

            # deliver_webhook is called synchronously inside settle(), so the
            # POST has already completed (or failed) by the time this returns.
            self.handler.settle(item, "completed", 0.5, result_key="results/p1/job_webhook.json")

            self.assertEqual(len(_RecordingWebhookHandler.received), 1)
            delivered = _RecordingWebhookHandler.received[0]
            self.assertEqual(delivered["body"]["jobId"], "job_webhook")
            self.assertEqual(delivered["body"]["status"], "completed")
            self.assertIn("X-Larkup-Signature", delivered["headers"])
        finally:
            server.shutdown()
            thread.join(timeout=5)

    def test_settle_without_a_webhook_url_does_not_raise(self) -> None:
        item = {
            "pk": "JOB#job_no_webhook",
            "sk": "JOB",
            "principalId": "p1",
            "period": "2026-08",
            "estimatedSourceMinutes": "1",
            "retainSourceHours": 0,
        }
        self.handler.table.put_item(
            Item={**item, "status": "running", "progressJson": "{}", "createdAt": "now", "updatedAt": "now"}
        )
        self._put_usage("p1", "2026-08")
        self.handler.settle(item, "completed", 0.5, result_key="results/p1/job_no_webhook.json")

    def test_settle_delivery_failure_does_not_raise(self) -> None:
        item = {
            "pk": "JOB#job_bad_webhook",
            "sk": "JOB",
            "principalId": "p1",
            "period": "2026-08",
            "estimatedSourceMinutes": "1",
            "retainSourceHours": 0,
            "webhookUrl": "http://127.0.0.1:1/unreachable",
        }
        self.handler.table.put_item(
            Item={**item, "status": "running", "progressJson": "{}", "createdAt": "now", "updatedAt": "now"}
        )
        self._put_usage("p1", "2026-08")
        self.handler.settle(item, "completed", 0.5, result_key="results/p1/job_bad_webhook.json")


if __name__ == "__main__":
    unittest.main()
