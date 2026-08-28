"""Rent-a-VM worker entrypoint (vast, shadeform, salad, scaleway,
thundercompute, gpuai, northflank, hyperstack): pulls a queued job straight
from DynamoDB, runs the pipeline, and writes status/results straight back to
DynamoDB/S3 itself -- these providers have no managed job-queue API to relay
that through the control plane the way RunPod/Modal do. Deliberately kept
out of runtime/app: it is the only piece of this package that talks to AWS
directly. Copied into the image as app/cloud_worker.py at build time (see
runtime/Dockerfile's cloud-worker stage) so `python -m app.cloud_worker`
resolves its imports as siblings within the app package.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import boto3

from .config import Settings
from .services.pipeline import run_pipeline


def main() -> None:
    job_id = _required("LARKUP_VIDEO_JOB_ID")
    table_name = _required("LARKUP_VIDEO_TABLE_NAME")
    bucket = _required("LARKUP_VIDEO_BUCKET")
    region = os.getenv("AWS_REGION", "eu-central-1")
    table = boto3.resource("dynamodb", region_name=region).Table(table_name)
    s3 = boto3.client("s3", region_name=region)
    job = table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"}, ConsistentRead=True).get(
        "Item"
    )
    if not job:
        raise RuntimeError(f"cloud job {job_id} does not exist")
    usage_key = {"pk": f"USAGE#{job['principalId']}#{job['period']}", "sk": "USAGE"}
    estimate = job["estimatedSourceMinutes"]
    try:
        table.update_item(
            Key={"pk": f"JOB#{job_id}", "sk": "JOB"},
            UpdateExpression="SET #status = :running, progressJson = :progress",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":running": "running",
                ":progress": json.dumps(
                    {"stage": "probe", "percent": 1, "message": "GPU worker started"}
                ),
            },
        )
        settings = Settings.from_env()
        with tempfile.TemporaryDirectory(prefix="larkup-video-") as temp_dir:
            source_path = Path(temp_dir) / "source"
            s3.download_file(bucket, job["sourceKey"], str(source_path))
            result, actual_minutes = run_pipeline(
                source_path,
                json.loads(job["briefJson"]),
                settings.model_dir,
                settings.device,
                lambda stage, percent, message: table.update_item(
                    Key={"pk": f"JOB#{job_id}", "sk": "JOB"},
                    UpdateExpression="SET progressJson = :progress, updatedAt = :updated",
                    ExpressionAttributeValues={
                        ":progress": json.dumps(
                            {"stage": stage, "percent": percent, "message": message}
                        ),
                        ":updated": _now(),
                    },
                ),
                settings.disable_heavy_operators,
                settings.semantic_vision_enabled,
                settings.semantic_vision_model,
            )
            result["jobId"] = job_id
            result_key = f"results/{job['principalId']}/{job_id}.json"
            s3.put_object(
                Bucket=bucket,
                Key=result_key,
                Body=json.dumps(result, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json",
            )
            boto3.client("dynamodb", region_name=region).transact_write_items(
                TransactItems=[
                    {
                        "Update": {
                            "TableName": table_name,
                            "Key": {"pk": {"S": f"JOB#{job_id}"}, "sk": {"S": "JOB"}},
                            "UpdateExpression": (
                                "SET #status = :completed, resultKey = :result, actualSourceMinutes = :actual, "
                                "progressJson = :progress, updatedAt = :updated"
                            ),
                            "ConditionExpression": "#status IN (:queued, :running)",
                            "ExpressionAttributeNames": {"#status": "status"},
                            "ExpressionAttributeValues": {
                                ":completed": {"S": "completed"},
                                ":queued": {"S": "queued"},
                                ":running": {"S": "running"},
                                ":result": {"S": result_key},
                                ":actual": {"N": str(actual_minutes)},
                                ":progress": {
                                    "S": json.dumps(
                                        {
                                            "stage": "complete",
                                            "percent": 100,
                                            "message": "Index ready",
                                        }
                                    )
                                },
                                ":updated": {"S": _now()},
                            },
                        }
                    },
                    {
                        "Update": {
                            "TableName": table_name,
                            "Key": {
                                "pk": {"S": usage_key["pk"]},
                                "sk": {"S": usage_key["sk"]},
                            },
                            "UpdateExpression": (
                                "ADD reservedSourceMinutes :release, sourceMinutesUsed :actual, "
                                "committedMinutes :commit_delta, activeJobs :decrement"
                            ),
                            "ExpressionAttributeValues": {
                                ":release": {"N": str(-float(estimate))},
                                ":actual": {"N": str(actual_minutes)},
                                ":commit_delta": {
                                    "N": str(actual_minutes - float(estimate))
                                },
                                ":decrement": {"N": "-1"},
                            },
                        }
                    },
                ]
            )
            if int(job.get("retainSourceHours", 0)) == 0:
                s3.delete_object(Bucket=bucket, Key=job["sourceKey"])
    except Exception as error:
        _mark_failed(table, usage_key, job_id, estimate, str(error))
        raise


def _mark_failed(table: object, usage_key: dict[str, str], job_id: str, estimate: object, error: str) -> None:
    try:
        table.update_item(
            Key={"pk": f"JOB#{job_id}", "sk": "JOB"},
            UpdateExpression="SET #status = :failed, #error = :error, updatedAt = :updated",
            ConditionExpression="#status IN (:queued, :running)",
            ExpressionAttributeNames={"#status": "status", "#error": "error"},
            ExpressionAttributeValues={
                ":failed": "failed",
                ":queued": "queued",
                ":running": "running",
                ":error": error[:2_000],
                ":updated": _now(),
            },
        )
        table.update_item(
            Key=usage_key,
            UpdateExpression="ADD reservedSourceMinutes :release, activeJobs :decrement",
            ExpressionAttributeValues={
                ":release": -float(estimate),
                ":decrement": -1,
            },
        )
    except Exception:
        pass


def _required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"missing environment variable {name}")
    return value


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    main()
