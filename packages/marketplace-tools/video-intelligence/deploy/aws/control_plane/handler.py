from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import secrets
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from gpu_providers.base import InstanceState
from gpu_providers.registry import DEFAULT_PROVIDER, get_provider
from gpu_providers.runpod import RunpodProvider

REGION, TABLE_NAME, BUCKET = os.environ["AWS_REGION"], os.environ["TABLE_NAME"], os.environ["BUCKET_NAME"]
# Modal is the default managed-cloud dispatch target; RunPod stays fully
# supported and selectable per-deployment. See ../../gpu_providers/README.md.
GPU_PROVIDER = os.getenv("LARKUP_VIDEO_GPU_PROVIDER", DEFAULT_PROVIDER)
RUNPOD_INTERACTIVE_ENDPOINT_ID = os.getenv("RUNPOD_INTERACTIVE_ENDPOINT_ID", "").strip()
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
# Optional: when set, outbound webhook deliveries carry an
# X-Larkup-Signature HMAC-SHA256 header over the raw JSON body so a receiver
# can verify the payload actually came from this control plane.
WEBHOOK_SIGNING_SECRET = os.getenv("WEBHOOK_SIGNING_SECRET", "")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(20 * 1024**3)))
PROCESSING_ENABLED = os.getenv("PROCESSING_ENABLED", "false").lower() == "true"
AUTO_PROVISIONING_ENABLED = os.getenv("AUTO_PROVISIONING_ENABLED", "false").lower() == "true"
AUTO_PROVISIONED_SOURCE_MINUTES = max(1, min(120, int(os.getenv("AUTO_PROVISIONED_SOURCE_MINUTES", "30"))))
TRIAL_DEVICE_LIMIT = max(0, min(1_000_000, int(os.getenv("TRIAL_DEVICE_LIMIT", "100"))))
TRIAL_SOURCE_MINUTES = max(0, min(1_000_000, float(os.getenv("TRIAL_SOURCE_MINUTES", "600"))))
TRIAL_REQUESTS_PER_MINUTE = max(1, min(600, int(os.getenv("TRIAL_REQUESTS_PER_MINUTE", "60"))))
POST_TRIAL_SOURCE_MINUTES = max(0, min(120, float(os.getenv("POST_TRIAL_SOURCE_MINUTES", "0"))))
REQUESTS_PER_MINUTE = max(30, min(600, int(os.getenv("REQUESTS_PER_MINUTE", "120"))))
TESTING_DEVICE_HASHES = {
    value.strip()
    for value in os.getenv("TESTING_DEVICE_HASHES", "").split(",")
    if value.strip()
}
table = boto3.resource("dynamodb", region_name=REGION).Table(TABLE_NAME)
s3 = boto3.client("s3", region_name=REGION, endpoint_url=f"https://s3.{REGION}.amazonaws.com", config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))


class ApiError(RuntimeError):
    def __init__(self, status: int, message: str, headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status, self.headers = status, headers or {}


STALE_JOB_TIMEOUT_HOURS = int(os.getenv("STALE_JOB_TIMEOUT_HOURS", "6"))
FINALIZING_STALL_TIMEOUT_MINUTES = max(
    5, min(60, int(os.getenv("FINALIZING_STALL_TIMEOUT_MINUTES", "12")))
)


def handler(event: dict[str, Any], _: Any) -> dict[str, Any]:
    # EventBridge's scheduled-rule payload has no requestContext/rawPath --
    # this is the periodic cleanup sweep (see ReconcileScheduleRule in
    # template.yaml), not an API Gateway request.
    if "requestContext" not in event:
        reconcile_stale_jobs()
        return {"status": "reconciled"}
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    path = event.get("rawPath", "/")
    try:
        if method == "GET" and path == "/v1/health":
            return response(200, {"status": "ok", "version": "0.1.0", "runtime": "managed-cloud", "operators": {}, "authRequired": True, "processingEnabled": PROCESSING_ENABLED})
        if method == "POST" and path == "/v1/access-codes/redeem": return redeem_code(body(event))
        if method == "POST" and path == "/v1/device-keys": return provision_device_key(body(event))
        if method == "POST" and path == "/v1/admin/access-codes":
            require_admin(headers(event).get("x-larkup-admin-token")); return create_code(body(event))
        if method == "POST" and path.startswith("/v1/admin/devices/") and path.endswith("/entitlement"):
            require_admin(headers(event).get("x-larkup-admin-token"))
            installation_id = path.removeprefix("/v1/admin/devices/").removesuffix("/entitlement").strip("/")
            return update_device_entitlement(installation_id, body(event))
        principal = authenticate(headers(event).get("authorization"))
        if method == "POST" and path == "/v1/uploads": return create_upload(principal, body(event))
        if method == "POST" and path == "/v1/jobs": return create_job(principal, body(event))
        if method == "GET" and path == "/v1/usage": return usage(principal)
        if method == "DELETE" and path == "/v1/jobs/active": return cancel_only_active_job(principal)
        if method == "POST" and path.startswith("/v1/jobs/") and path.endswith("/result/ack"):
            return acknowledge_result(principal, path.removeprefix("/v1/jobs/").removesuffix("/result/ack").rstrip("/"))
        if path.startswith("/v1/jobs/"):
            job_id = path.rsplit("/", 1)[-1]
            if method == "GET": return get_job(principal, job_id)
            if method == "DELETE": return cancel_job(principal, job_id)
        return response(404, {"detail": "route not found"})
    except ApiError as error:
        return response(error.status, {"detail": str(error)}, error.headers)
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in {"ConditionalCheckFailedException", "TransactionCanceledException"}:
            return response(429, {"detail": "quota or concurrency limit reached"}, {"Retry-After": "60"})
        raise


def authenticate(authorization: str | None) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "): raise ApiError(401, "missing API key")
    key_hash = digest(authorization.split(' ', 1)[1].strip())
    item = table.get_item(Key={"pk": f"APIKEY#{key_hash}", "sk": "APIKEY"}).get("Item")
    if not item or item.get("revokedAt"): raise ApiError(401, "invalid API key")
    entitlement = json.loads(item["entitlementJson"])
    if entitlement.get("unlimitedRequests") is True:
        return {"id": item["principalId"], "entitlement": entitlement}
    minute = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    try:
        table.update_item(
            Key={"pk": f"RATE#{key_hash}#{minute}", "sk": "RATE"},
            UpdateExpression="SET expiresAtEpoch = :expires ADD requests :one",
            ConditionExpression="attribute_not_exists(requests) OR requests < :limit",
            ExpressionAttributeValues={":expires": int((datetime.now(timezone.utc) + timedelta(minutes=2)).timestamp()), ":one": 1, ":limit": max(1, min(600, int(entitlement.get("requestsPerMinute", REQUESTS_PER_MINUTE))))},
        )
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise ApiError(429, "API request rate limit reached", {"Retry-After": "60"}) from error
        raise
    return {"id": item["principalId"], "entitlement": entitlement}


def provision_device_key(payload: dict[str, Any]) -> dict[str, Any]:
    if not AUTO_PROVISIONING_ENABLED: raise ApiError(503, "automatic device access is not enabled")
    installation_id = str(payload.get("installationId") or "")
    if len(installation_id) < 32 or len(installation_id) > 128: raise ApiError(400, "invalid installation identifier")
    device_key, device_hash = f"DEVICE#{digest('device:' + installation_id)}", digest('device:' + installation_id)
    device = table.get_item(Key={"pk": device_key, "sk": "DEVICE"}).get("Item")
    api_key, api_hash = "lvi_" + secrets.token_urlsafe(30), None
    if device:
        principal_id = device["principalId"]
        # Renewals keep the stable anonymous principal and its explicit
        # entitlement. Older records predate per-device policy storage, so
        # preserve their legacy allowance rather than unexpectedly resetting
        # a current user's cloud access.
        entitlement = json.loads(device.get("entitlementJson") or json.dumps(legacy_auto_entitlement(str(device.get("deviceHash") or device_hash))))
        api_hash = digest(api_key)
        boto3.client("dynamodb", region_name=REGION).transact_write_items(TransactItems=[
            {"Put": {"TableName": TABLE_NAME, "Item": {"pk": {"S": f"APIKEY#{api_hash}"}, "sk": {"S": "APIKEY"}, "principalId": {"S": principal_id}, "entitlementJson": {"S": json.dumps(entitlement)}, "createdAt": {"S": now_iso()}}, "ConditionExpression": "attribute_not_exists(pk)"}},
            {"Update": {"TableName": TABLE_NAME, "Key": {"pk": {"S": device_key}, "sk": {"S": "DEVICE"}}, "UpdateExpression": "SET apiKeyHash = :hash, entitlementJson = :entitlement, rotatedAt = :at", "ExpressionAttributeValues": {":hash": {"S": api_hash}, ":entitlement": {"S": json.dumps(entitlement)}, ":at": {"S": now_iso()}}}},
            {"Update": {"TableName": TABLE_NAME, "Key": {"pk": {"S": f"APIKEY#{device['apiKeyHash']}"}, "sk": {"S": "APIKEY"}}, "UpdateExpression": "SET revokedAt = :at", "ExpressionAttributeValues": {":at": {"S": now_iso()}}}},
        ])
    else:
        principal_id, entitlement, api_hash = "usr_" + secrets.token_hex(12), auto_entitlement(device_hash, claim_trial_slot()), digest(api_key)
        try:
            boto3.client("dynamodb", region_name=REGION).transact_write_items(TransactItems=[
                {"Put": {"TableName": TABLE_NAME, "Item": {"pk": {"S": f"APIKEY#{api_hash}"}, "sk": {"S": "APIKEY"}, "principalId": {"S": principal_id}, "entitlementJson": {"S": json.dumps(entitlement)}, "createdAt": {"S": now_iso()}}, "ConditionExpression": "attribute_not_exists(pk)"}},
            {"Put": {"TableName": TABLE_NAME, "Item": {"pk": {"S": device_key}, "sk": {"S": "DEVICE"}, "principalId": {"S": principal_id}, "apiKeyHash": {"S": api_hash}, "deviceHash": {"S": device_hash}, "entitlementJson": {"S": json.dumps(entitlement)}, "createdAt": {"S": now_iso()}}, "ConditionExpression": "attribute_not_exists(pk)"}},
            ])
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") == "TransactionCanceledException":
                return provision_device_key(payload)
            raise
    return response(201, {"apiKey": api_key, "entitlement": entitlement})


def legacy_auto_entitlement(device_hash: str) -> dict[str, Any]:
    if device_hash in TESTING_DEVICE_HASHES:
        # Explicit owner-only test access is bound to an anonymized local
        # installation hash. It bypasses every metering gate while the tool is
        # under active verification; the managed GPU queue remains responsible
        # for scheduling the actual work.
        return {
            "sourceMinutesPerMonth": None,
            "maxConcurrentJobs": 100,
            "unlimitedRequests": True,
            "plan": "owner-device-testing",
        }
    return {"sourceMinutesPerMonth": AUTO_PROVISIONED_SOURCE_MINUTES, "maxConcurrentJobs": 1, "requestsPerMinute": REQUESTS_PER_MINUTE, "plan": "auto-device"}


def claim_trial_slot() -> bool:
    """Atomically reserve one of the bounded, no-payment cloud trials."""
    if TRIAL_DEVICE_LIMIT <= 0:
        return False
    try:
        table.update_item(
            Key={"pk": "TRIAL#DEVICE", "sk": "TRIAL"},
            UpdateExpression="SET updatedAt = :at ADD claimedDevices :one",
            ConditionExpression="attribute_not_exists(claimedDevices) OR claimedDevices < :limit",
            ExpressionAttributeValues={":at": now_iso(), ":one": 1, ":limit": TRIAL_DEVICE_LIMIT},
        )
        return True
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        raise


def auto_entitlement(device_hash: str, has_trial: bool) -> dict[str, Any]:
    if device_hash in TESTING_DEVICE_HASHES:
        return legacy_auto_entitlement(device_hash)
    if has_trial:
        return {"sourceMinutesPerMonth": TRIAL_SOURCE_MINUTES, "maxConcurrentJobs": 1, "requestsPerMinute": TRIAL_REQUESTS_PER_MINUTE, "plan": "first-100-trial"}
    return {"sourceMinutesPerMonth": POST_TRIAL_SOURCE_MINUTES, "maxConcurrentJobs": 1, "requestsPerMinute": TRIAL_REQUESTS_PER_MINUTE, "plan": "support-required"}


def update_device_entitlement(installation_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Support-only control: update one device without billing or exposing its API key."""
    if len(installation_id) < 32 or len(installation_id) > 128:
        raise ApiError(400, "invalid installation identifier")
    device = table.get_item(Key={"pk": f"DEVICE#{digest('device:' + installation_id)}", "sk": "DEVICE"}).get("Item")
    if not device or not device.get("apiKeyHash"):
        raise ApiError(404, "device not found")
    key = table.get_item(Key={"pk": f"APIKEY#{device['apiKeyHash']}", "sk": "APIKEY"}).get("Item")
    if not key or key.get("revokedAt"):
        raise ApiError(404, "device has no active API key")
    current = json.loads(key["entitlementJson"])
    source_minutes = payload.get("sourceMinutesPerMonth", current.get("sourceMinutesPerMonth"))
    if source_minutes is not None:
        try: source_minutes = max(0, min(1_000_000, float(source_minutes)))
        except (TypeError, ValueError) as error: raise ApiError(400, "sourceMinutesPerMonth must be a number or null") from error
    try: max_jobs = max(1, min(100, int(payload.get("maxConcurrentJobs", current.get("maxConcurrentJobs", 1))))); requests_per_minute = max(1, min(600, int(payload.get("requestsPerMinute", current.get("requestsPerMinute", REQUESTS_PER_MINUTE)))))
    except (TypeError, ValueError) as error: raise ApiError(400, "maxConcurrentJobs and requestsPerMinute must be numbers") from error
    entitlement = {"sourceMinutesPerMonth": source_minutes, "maxConcurrentJobs": max_jobs, "requestsPerMinute": requests_per_minute, "plan": str(payload.get("plan", current.get("plan", "support")))[:80]}
    encoded = json.dumps(entitlement)
    table.update_item(Key={"pk": key["pk"], "sk": key["sk"]}, UpdateExpression="SET entitlementJson = :entitlement", ExpressionAttributeValues={":entitlement": encoded})
    table.update_item(Key={"pk": device["pk"], "sk": device["sk"]}, UpdateExpression="SET entitlementJson = :entitlement, updatedAt = :at", ExpressionAttributeValues={":entitlement": encoded, ":at": now_iso()})
    period, period_start, period_end = billing_period()
    reconcile_usage_limit(str(device["principalId"]), period, period_start, period_end, source_minutes)
    return response(200, {"principalId": device["principalId"], "entitlement": entitlement})


def create_upload(principal: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    file_name, content_type, size = str(payload.get("fileName") or "video.bin")[:255], str(payload.get("contentType") or "application/octet-stream")[:120], int(payload.get("sizeBytes") or 0)
    if size <= 0 or size > MAX_UPLOAD_BYTES: raise ApiError(413, "invalid or oversized upload")
    upload_id, suffix = "upl_" + secrets.token_hex(12), (file_name.rsplit(".", 1)[-1] if "." in file_name else "bin")
    key = f"sources/{principal['id']}/{upload_id}.{suffix[:12]}"
    table.put_item(Item={"pk": f"UPLOAD#{upload_id}", "sk": "UPLOAD", "principalId": principal["id"], "sourceKey": key, "fileName": file_name, "sizeBytes": size, "createdAt": now_iso(), "expiresAtEpoch": int((datetime.now(timezone.utc) + timedelta(hours=24)).timestamp())})
    url = s3.generate_presigned_url("put_object", Params={"Bucket": BUCKET, "Key": key, "ContentType": content_type, "ServerSideEncryption": "aws:kms"}, ExpiresIn=900)
    return response(201, {"uploadId": upload_id, "uploadUrl": url, "uploadHeaders": {"Content-Type": content_type, "x-amz-server-side-encryption": "aws:kms"}})


def create_job(principal: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    if not PROCESSING_ENABLED: raise ApiError(503, "GPU processing is temporarily unavailable", {"Retry-After": "300"})
    source, brief = payload.get("source") or {}, payload.get("brief") or {}
    model_configuration = worker_model_configuration(payload.get("modelConfiguration"))
    # A caller that already holds a durable canonical copy (the web app's own
    # S3StorageProvider) supplies source.url directly instead of re-uploading
    # through this control plane's short-lived sources/ prefix -- this is
    # what makes watch_original work long after the original upload expired,
    # and it never re-transfers the file through this stack at all. `url` is
    # the existing VideoSource contract field (contracts.ts); the
    # sourceKey-backed uploadId path below stays for the original client
    # upload flow (create_upload's presigned PUT).
    external_source_url = str(source.get("url") or "")
    if external_source_url:
        if not external_source_url.startswith("https://"): raise ApiError(400, "source.url must be an HTTPS URL")
        upload = None
    else:
        upload_id = str(source.get("uploadId") or "")
        upload = table.get_item(Key={"pk": f"UPLOAD#{upload_id}", "sk": "UPLOAD"}).get("Item")
        if not upload or upload.get("principalId") != principal["id"]: raise ApiError(404, "upload not found")
        try: s3.head_object(Bucket=BUCKET, Key=upload["sourceKey"])
        except ClientError as error: raise ApiError(409, "upload has not completed") from error
    duration_seconds = float(source.get("durationSecs") or 0)
    if duration_seconds <= 0: raise ApiError(400, "source.durationSecs is required for cloud quota reservation")
    # A bounded inspection sends its short billable duration here, while its
    # timestamps remain on the original source timeline. Give the worker a
    # horizon that includes every requested range without charging that full
    # timeline duration against quota.
    # The submitted duration is the billable source window for an interactive
    # inspection. Keep the original timeline separately so a range beginning
    # at 0 is not mistaken for a complete short source and materialized in
    # full by the RunPod worker.
    try:
        timeline_duration_seconds = float(source.get("timelineDurationSecs") or duration_seconds)
    except (TypeError, ValueError):
        timeline_duration_seconds = duration_seconds
    if not math.isfinite(timeline_duration_seconds) or timeline_duration_seconds <= 0:
        timeline_duration_seconds = duration_seconds
    furthest_requested_second = 0.0
    for candidate in brief.get("importantRanges") or []:
        try:
            candidate_end = float(candidate.get("endSecs"))
        except (AttributeError, TypeError, ValueError):
            continue
        if math.isfinite(candidate_end):
            timeline_duration_seconds = max(timeline_duration_seconds, candidate_end)
            furthest_requested_second = max(furthest_requested_second, candidate_end)
    # Older web clients only send the billable clipped duration. A bounded
    # request starting at 0:00 can therefore look like a complete short
    # source to a worker and accidentally trigger full-source materialization.
    # Interactive inspection is always range-directed, so preserve its exact
    # ffmpeg range path even when the original timeline is unavailable. The
    # extra second is control metadata only; it never changes quota usage or
    # the requested range passed to the worker.
    if brief.get("interactive") is True and furthest_requested_second > 0:
        timeline_duration_seconds = max(
            timeline_duration_seconds, furthest_requested_second + 1.0
        )
    estimate, (period, period_start, period_end) = max(0.01, duration_seconds / 60), billing_period()
    job_id, created_at = "job_" + secrets.token_hex(12), now_iso()
    source_url = external_source_url or s3.generate_presigned_url("get_object", Params={"Bucket": BUCKET, "Key": upload["sourceKey"]}, ExpiresIn=3600)
    webhook_url = str(payload.get("webhookUrl") or "")
    if webhook_url and not webhook_url.startswith("https://"): raise ApiError(400, "webhookUrl must be an HTTPS URL")
    provider_endpoint_id = (
        RUNPOD_INTERACTIVE_ENDPOINT_ID
        if GPU_PROVIDER == "runpod" and brief.get("interactive") is True
        else ""
    )
    job_item = {"pk": {"S": f"JOB#{job_id}"}, "sk": {"S": "JOB"}, "principalId": {"S": principal["id"]}, "status": {"S": "queued"}, **({"sourceKey": {"S": upload["sourceKey"]}} if upload else {}), **({"webhookUrl": {"S": webhook_url}} if webhook_url else {}), **({"providerEndpointId": {"S": provider_endpoint_id}} if provider_endpoint_id else {}), "briefJson": {"S": json.dumps(brief, separators=(",", ":"))}, "estimatedSourceMinutes": {"N": str(estimate)}, "period": {"S": period}, "createdAt": {"S": created_at}, "updatedAt": {"S": created_at}, "lastProgressAt": {"S": created_at}, "retainSourceHours": {"N": "0"}, "progressJson": {"S": json.dumps({"stage": "queued", "percent": 0, "message": "Waiting for Larkup Cloud processing capacity"})}}
    source_limit = principal["entitlement"].get("sourceMinutesPerMonth")
    reconcile_usage_limit(principal["id"], period, period_start, period_end, source_limit)
    available, usage_key = Decimal(str(source_limit if source_limit is not None else 1_000_000_000)), f"USAGE#{principal['id']}#{period}"
    usage_item = table.get_item(Key={"pk": usage_key, "sk": "USAGE"}, ConsistentRead=True).get("Item", {})
    if source_limit is not None:
        remaining_minutes = max(
            Decimal("0"),
            Decimal(str(source_limit))
            - Decimal(str(usage_item.get("sourceMinutesUsed", 0)))
            - Decimal(str(usage_item.get("reservedSourceMinutes", 0))),
        )
        if Decimal(str(estimate)) > remaining_minutes:
            raise quota_limit_error(remaining_minutes, estimate)
    active_jobs = int(usage_item.get("activeJobs", 0))
    concurrent_jobs_limit = int(principal["entitlement"].get("maxConcurrentJobs", 1))
    if not principal["entitlement"].get("unlimitedRequests") and active_jobs >= concurrent_jobs_limit:
        raise ApiError(429, f"You already have {active_jobs} active video indexing job{'s' if active_jobs != 1 else ''}. Your plan allows {concurrent_jobs_limit} at a time.", {"Retry-After": "60"})
    quota_condition = (
        " AND ((attribute_not_exists(availableSourceMinutes) AND :available >= :estimate) OR availableSourceMinutes >= :estimate)"
        if source_limit is not None
        else ""
    )
    usage_values = {
        ":start": {"S": period_start},
        ":end": {"S": period_end},
        ":limit": {"N": str(source_limit) if source_limit is not None else "-1"},
        ":available": {"N": str(available)},
        ":estimate": {"N": str(estimate)},
        ":one": {"N": "1"},
    }
    concurrency_condition = ""
    if not principal["entitlement"].get("unlimitedRequests"):
        concurrency_condition = "(attribute_not_exists(activeJobs) OR activeJobs < :concurrency)"
        usage_values[":concurrency"] = {"N": str(principal["entitlement"].get("maxConcurrentJobs", 1))}
    usage_update = {
        "TableName": TABLE_NAME,
        "Key": {"pk": {"S": usage_key}, "sk": {"S": "USAGE"}},
        "UpdateExpression": "SET periodStart = :start, periodEnd = :end, sourceMinutesLimit = :limit, availableSourceMinutes = if_not_exists(availableSourceMinutes, :available) - :estimate ADD reservedSourceMinutes :estimate, activeJobs :one",
        "ExpressionAttributeValues": usage_values,
    }
    if concurrency_condition or quota_condition:
        usage_update["ConditionExpression"] = concurrency_condition + quota_condition
    try:
        boto3.client("dynamodb", region_name=REGION).transact_write_items(TransactItems=[{"Put": {"TableName": TABLE_NAME, "Item": job_item}}, {"Update": usage_update}])
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") != "TransactionCanceledException":
            raise
        current_usage = table.get_item(Key={"pk": usage_key, "sk": "USAGE"}, ConsistentRead=True).get("Item", {})
        current_active_jobs = int(current_usage.get("activeJobs", 0))
        if not principal["entitlement"].get("unlimitedRequests") and current_active_jobs >= concurrent_jobs_limit:
            raise ApiError(429, f"You already have {current_active_jobs} active video indexing job{'s' if current_active_jobs != 1 else ''}. Your plan allows {concurrent_jobs_limit} at a time.", {"Retry-After": "60"}) from error
        if source_limit is not None:
            current_remaining = max(
                Decimal("0"),
                Decimal(str(source_limit))
                - Decimal(str(current_usage.get("sourceMinutesUsed", 0)))
                - Decimal(str(current_usage.get("reservedSourceMinutes", 0))),
            )
            raise quota_limit_error(current_remaining, estimate) from error
        raise
    try:
        # runpod/modal are job-queue providers: `env` is the direct worker
        # payload they submit (see gpu_providers/README.md), not shell-style
        # string env vars, so brief/duration travel through as-is.
        instance_id = provider_for(GPU_PROVIDER, provider_endpoint_id).launch(
            job_id=job_id,
            image="",
            env={
                "jobId": job_id,
                "sourceUrl": source_url,
                "sourceDurationSecs": timeline_duration_seconds,
                "brief": brief,
                "modelConfiguration": model_configuration,
            },
            gpu_type=os.getenv("LARKUP_VIDEO_GPU_TYPE", ""),
        )
        if not instance_id: raise RuntimeError(f"{GPU_PROVIDER} did not return an instance id")
        table.update_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"}, UpdateExpression="SET providerName = :provider, instanceId = :instance", ExpressionAttributeValues={":provider": GPU_PROVIDER, ":instance": instance_id})
    except Exception as error:
        settle_failure(job_id, "Larkup Cloud could not start video indexing. Please retry."); raise ApiError(502, "Larkup Cloud could not start video indexing. Please retry.") from error
    return get_job(principal, job_id, 202)


def provider_for(name: str, endpoint_id: str = ""):
    """Resolve the queue that owns a job, including its bounded fast lane."""
    if name == "runpod" and endpoint_id:
        return RunpodProvider(
            api_key=os.environ["RUNPOD_API_KEY"],
            endpoint_id=endpoint_id,
        )
    return get_provider(name)


def provider_for_job(item: dict[str, Any]):
    return provider_for(
        str(item.get("providerName") or GPU_PROVIDER),
        str(item.get("providerEndpointId") or ""),
    )


def worker_model_configuration(value: Any) -> dict[str, dict[str, str]]:
    """Validate an ephemeral BYOK bundle without writing it into the job item."""
    if not isinstance(value, dict):
        raise ApiError(
            400,
            "Audio, agent / tool-brain, and vision provider settings are required before indexing starts",
        )
    allowed = {
        "audio": {"openai", "groq", "deepgram", "elevenlabs"},
        "brain": {"vercel_ai_gateway", "google", "openai"},
        "vision": {"vercel_ai_gateway", "google", "openai"},
    }
    result: dict[str, dict[str, str]] = {}
    for role, providers in allowed.items():
        item = value.get(role)
        if not isinstance(item, dict):
            raise ApiError(400, f"A configured {role} provider, model, and API key are required")
        provider = str(item.get("provider") or "").strip()
        api_key = str(item.get("apiKey") or "").strip()
        model = str(item.get("model") or "").strip()
        if provider not in providers:
            raise ApiError(400, f"Unsupported {role} provider for Video Intelligence")
        if not api_key or len(api_key) > 2048:
            raise ApiError(400, f"A valid {role} API key is required before indexing starts")
        if not model or len(model) > 256:
            raise ApiError(400, f"A valid {role} model is required before indexing starts")
        result[role] = {"provider": provider, "apiKey": api_key, "model": model}
    return result


def quota_limit_error(remaining_minutes: Decimal, required_minutes: float) -> ApiError:
    return ApiError(
        429,
        f"Your cloud quota has {float(remaining_minutes):.2f} minutes remaining, but this video requires {required_minutes:.2f} minutes.",
    )


def get_job(principal: dict[str, Any], job_id: str, status_code: int = 200) -> dict[str, Any]:
    item = table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"}, ConsistentRead=True).get("Item")
    if not item or item.get("principalId") != principal["id"]: raise ApiError(404, "job not found")
    if item["status"] in {"queued", "running"} and item.get("instanceId"):
        sync_job(item); item = table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"}, ConsistentRead=True)["Item"]
    result_url = s3.generate_presigned_url("get_object", Params={"Bucket": BUCKET, "Key": item["resultKey"]}, ExpiresIn=900) if item.get("resultKey") else None
    return response(status_code, {"id": job_id, "status": item["status"], "createdAt": item["createdAt"], "updatedAt": item["updatedAt"], "progress": json.loads(item["progressJson"]), "estimatedSourceMinutes": item["estimatedSourceMinutes"], "result": None, "resultUrl": result_url, "error": item.get("error")})


def acknowledge_result(principal: dict[str, Any], job_id: str) -> dict[str, Any]:
    item = table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"}, ConsistentRead=True).get("Item")
    if not item or item.get("principalId") != principal["id"]: raise ApiError(404, "job not found")
    if item.get("status") != "completed": raise ApiError(409, "job result is not ready")
    result_key = item.get("resultKey")
    if not result_key:
        return response(200, {"status": "already-acknowledged"})
    s3.delete_object(Bucket=BUCKET, Key=result_key)
    try:
        table.update_item(
            Key={"pk": item["pk"], "sk": item["sk"]},
            UpdateExpression="SET resultAcknowledgedAt = :acknowledged REMOVE resultKey",
            ConditionExpression="attribute_exists(resultKey)",
            ExpressionAttributeValues={":acknowledged": now_iso()},
        )
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException": raise
        return response(200, {"status": "already-acknowledged"})
    return response(200, {"status": "acknowledged"})


def sync_job(item: dict[str, Any]) -> None:
    provider_name = str(item.get("providerName") or GPU_PROVIDER)
    instance_id = str(item.get("instanceId") or "")
    if finalizing_is_stalled(item):
        try:
            provider_for_job(item).terminate(instance_id)
        except Exception:
            pass
        settle(
            item,
            "failed",
            0,
            error="Video analysis stopped making progress while finalizing. Please retry.",
        )
        return
    try:
        provider = provider_for_job(item)
        status = provider.get_status(instance_id)
    except Exception:
        update_progress(item, "queued", 1, "Checking your Larkup Cloud job status"); return
    if status.state == InstanceState.PENDING:
        update_progress(item, "queued", 1, "Queued with Larkup Cloud")
    elif status.state == InstanceState.RUNNING:
        # Job-queue providers relay their worker's own progress reports
        # through get_progress; anything else (or a rent-a-VM provider,
        # which always returns None here) falls back to a coarse placeholder.
        progress = provider.get_progress(instance_id)
        if progress:
            update_progress(
                item,
                progress["stage"],
                progress["percent"],
                public_progress_message(progress["message"]),
                progress.get("stagePercent"),
                progress,
            )
        else:
            # A transient relay hiccup (eventual-consistency lag on the
            # provider's status API, a momentarily malformed payload) must
            # not look like the job restarting from scratch. Re-affirm the
            # last recorded progress instead of resetting to the first
            # stage -- the real stage/percent resumes on the next
            # successful poll, so this only ever holds the UI steady.
            try:
                previous = json.loads(str(item.get("progressJson") or "{}"))
            except json.JSONDecodeError:
                previous = {}
            if previous.get("stage") and isinstance(previous.get("percent"), int):
                update_progress(
                    item,
                    previous["stage"],
                    previous["percent"],
                    previous.get("message") or "Larkup Cloud is processing the video",
                    previous.get("stagePercent"),
                    previous,
                )
            else:
                update_progress(item, "probe", 5, "Larkup Cloud is processing the video")
    elif status.state == InstanceState.EXITED:
        output = provider.get_result(instance_id)
        result = output.get("result") if isinstance(output, dict) else None
        if not isinstance(result, dict): settle_failure(item["pk"][4:], "Larkup Cloud completed without a result. Please retry."); return
        result["jobId"] = item["pk"][4:]
        result_key = f"results/{item['principalId']}/{item['pk'][4:]}.json"
        s3.put_object(Bucket=BUCKET, Key=result_key, Body=json.dumps(result, separators=(",", ":")).encode("utf-8"), ContentType="application/json", ServerSideEncryption="aws:kms")
        settle(item, "completed", float(output.get("actualSourceMinutes") or item["estimatedSourceMinutes"]), result_key=result_key)
    elif status.state == InstanceState.FAILED:
        print(
            json.dumps(
                {
                    "event": "gpu_job_failed",
                    "jobId": item["pk"][4:],
                    "provider": provider_name,
                    "instanceId": instance_id,
                    "detail": status.detail,
                },
                separators=(",", ":"),
            )
        )
        settle(item, "failed", 0, error="Larkup Cloud could not complete this video. Please retry.")


def public_progress_message(message: str) -> str:
    """Keep worker implementation details and retired setup copy out of the UI."""
    if message == "Preparing the visual search model for this video — this can take a little longer the first time":
        return "Creating the visual search index"
    return message


def cancel_job(principal: dict[str, Any], job_id: str) -> dict[str, Any]:
    item = table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"}, ConsistentRead=True).get("Item")
    if not item or item.get("principalId") != principal["id"]: raise ApiError(404, "job not found")
    if item["status"] not in {"queued", "running"}: raise ApiError(409, "job cannot be cancelled")
    try:
        if item.get("instanceId"): provider_for_job(item).terminate(str(item["instanceId"]))
    except Exception as error: raise ApiError(502, "GPU cancellation request failed") from error
    settle(item, "cancelled", 0, error="Cancelled by the API key owner")
    return get_job(principal, job_id)


def cancel_only_active_job(principal: dict[str, Any]) -> dict[str, Any]:
    """Recovery for a deleted local asset when there is exactly one active job."""
    active = active_jobs_for_principal(principal["id"])
    if not active:
        reconcile_active_job_count(principal["id"], 0)
        return response(200, {"status": "cancelled", "alreadyStopped": True})
    if len(active) > 1:
        raise ApiError(409, "More than one video is active. Stop it from its media card instead.")
    return cancel_job(principal, str(active[0]["pk"])[4:])


def active_jobs_for_principal(principal_id: str) -> list[dict[str, Any]]:
    """Returns durable active jobs; usage counters are never the source of truth."""
    active: list[dict[str, Any]] = []
    start_key: dict[str, Any] | None = None
    while True:
        request: dict[str, Any] = {
            "FilterExpression": "principalId = :principal AND #status IN (:queued, :running)",
            "ExpressionAttributeNames": {"#status": "status"},
            "ExpressionAttributeValues": {
                ":principal": principal_id,
                ":queued": "queued",
                ":running": "running",
            },
        }
        if start_key:
            request["ExclusiveStartKey"] = start_key
        page = table.scan(**request)
        active.extend(page.get("Items", []))
        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return active


def reconcile_active_job_count(principal_id: str, active_count: int) -> None:
    """Repair a stale usage counter without changing metered source minutes."""
    period, _, _ = billing_period()
    key = {"pk": f"USAGE#{principal_id}#{period}", "sk": "USAGE"}
    if not table.get_item(Key=key).get("Item"):
        return
    table.update_item(
        Key=key,
        UpdateExpression="SET activeJobs = :active",
        ExpressionAttributeValues={":active": active_count},
    )


def update_progress(
    item: dict[str, Any],
    stage: str,
    percent: int,
    message: str,
    stage_percent: float | int | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    progress = {"stage": stage, "percent": percent, "message": message}
    if stage_percent is not None:
        try:
            measured = float(stage_percent)
        except (TypeError, ValueError):
            measured = None
        if measured is not None and 0 <= measured <= 100:
            progress["stagePercent"] = measured
    for key in (
        "sequence",
        "elapsedSeconds",
        "estimatedRemainingSeconds",
        "current",
        "total",
    ):
        try:
            measured = float((details or {}).get(key))
        except (TypeError, ValueError):
            continue
        if measured >= 0:
            progress[key] = int(measured) if measured.is_integer() else measured
    unit = str((details or {}).get("unit") or "").strip()[:80]
    if unit:
        progress["unit"] = unit
    try:
        previous = json.loads(str(item.get("progressJson") or "{}"))
    except json.JSONDecodeError:
        previous = {}
    changed = previous != progress
    updated_at = now_iso()
    expression = "SET #status = :status, progressJson = :progress, updatedAt = :updated"
    values: dict[str, Any] = {
        ":status": "running" if stage != "queued" else "queued",
        ":queued": "queued",
        ":running": "running",
        ":progress": json.dumps(progress),
        ":updated": updated_at,
    }
    if changed:
        expression += ", lastProgressAt = :progressed"
        values[":progressed"] = updated_at
    table.update_item(
        Key={"pk": item["pk"], "sk": item["sk"]},
        UpdateExpression=expression,
        ConditionExpression="#status IN (:queued, :running)",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues=values,
    )


def finalizing_is_stalled(item: dict[str, Any], now: datetime | None = None) -> bool:
    """Stop a job that repeatedly reports the same near-complete final phase."""
    try:
        progress = json.loads(str(item.get("progressJson") or "{}"))
        is_finalizing = progress.get("stage") == "synthesize" and int(progress.get("percent", 0)) >= 98
    except (TypeError, ValueError, json.JSONDecodeError):
        return False
    if not is_finalizing:
        return False
    try:
        # Old jobs predate lastProgressAt. Their created timestamp is the only
        # truthful marker for a final phase that has never advanced.
        started = datetime.fromisoformat(str(item.get("lastProgressAt") or item.get("createdAt") or ""))
    except ValueError:
        return False
    return ((now or datetime.now(timezone.utc)) - started).total_seconds() >= (
        FINALIZING_STALL_TIMEOUT_MINUTES * 60
    )


def deliver_webhook(item: dict[str, Any], status: str, error: str | None) -> None:
    """Best-effort: a slow or failing receiver must never affect job settlement."""
    webhook_url = str(item.get("webhookUrl") or "")
    if not webhook_url:
        return
    payload = json.dumps(
        {"jobId": item["pk"][4:], "status": status, "error": error, "updatedAt": now_iso()},
        separators=(",", ":"),
    ).encode("utf-8")
    request_headers = {"Content-Type": "application/json"}
    if WEBHOOK_SIGNING_SECRET:
        request_headers["X-Larkup-Signature"] = hmac.new(
            WEBHOOK_SIGNING_SECRET.encode("utf-8"), payload, hashlib.sha256
        ).hexdigest()
    try:
        request = urllib.request.Request(webhook_url, data=payload, headers=request_headers, method="POST")
        urllib.request.urlopen(request, timeout=5)
    except (urllib.error.URLError, ValueError, TimeoutError):
        pass


def settle(item: dict[str, Any], status: str, actual: float, result_key: str | None = None, error: str | None = None) -> None:
    estimate = float(item["estimatedSourceMinutes"])
    values: dict[str, Any] = {":status": {"S": status}, ":updated": {"S": now_iso()}, ":progress": {"S": json.dumps({"stage": "complete" if status == "completed" else "queued", "percent": 100 if status == "completed" else 0, "message": "Index ready" if status == "completed" else error or status})}, ":queued": {"S": "queued"}, ":running": {"S": "running"}, ":estimate": {"N": str(-estimate)}, ":actual": {"N": str(actual)}, ":available": {"N": str(estimate - actual)}, ":one": {"N": "-1"}}
    expression, names = "SET #status = :status, progressJson = :progress, updatedAt = :updated", {"#status": "status"}
    if result_key: expression += ", resultKey = :result"; values[":result"] = {"S": result_key}
    if error: expression += ", #error = :error"; names["#error"] = "error"; values[":error"] = {"S": error[:2000]}
    try:
        job_values = {key: values[key] for key in (":status", ":updated", ":progress", ":queued", ":running")}
        if result_key: job_values[":result"] = values[":result"]
        if error: job_values[":error"] = values[":error"]
        boto3.client("dynamodb", region_name=REGION).transact_write_items(TransactItems=[{"Update": {"TableName": TABLE_NAME, "Key": {"pk": {"S": item["pk"]}, "sk": {"S": "JOB"}}, "UpdateExpression": expression, "ConditionExpression": "#status IN (:queued, :running)", "ExpressionAttributeNames": names, "ExpressionAttributeValues": job_values}}, {"Update": {"TableName": TABLE_NAME, "Key": {"pk": {"S": f"USAGE#{item['principalId']}#{item['period']}"}, "sk": {"S": "USAGE"}}, "UpdateExpression": "ADD reservedSourceMinutes :estimate, sourceMinutesUsed :actual, availableSourceMinutes :available, activeJobs :one", "ExpressionAttributeValues": {key: values[key] for key in (":estimate", ":actual", ":available", ":one")}}}])
    except ClientError as error_obj:
        if error_obj.response.get("Error", {}).get("Code") != "TransactionCanceledException": raise
    # An externally-sourced job (source.url) has no sourceKey: this
    # control plane never owned a copy of that file, so there is nothing of
    # its own to delete. The caller's own canonical store governs that
    # source's retention instead.
    if item.get("sourceKey") and int(item.get("retainSourceHours", 0)) == 0: s3.delete_object(Bucket=BUCKET, Key=item["sourceKey"])
    deliver_webhook(item, status, error)


def settle_failure(job_id: str, error: str) -> None:
    item = table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"}).get("Item")
    if item: settle(item, "failed", 0, error=error)


def reconcile_active_jobs(principal_id: str) -> None:
    """Settle completed GPU work even if a browser disconnected mid-poll."""
    start_key: dict[str, Any] | None = None
    while True:
        request: dict[str, Any] = {
            "FilterExpression": "principalId = :principal AND #status IN (:queued, :running)",
            "ExpressionAttributeNames": {"#status": "status"},
            "ExpressionAttributeValues": {
                ":principal": principal_id,
                ":queued": "queued",
                ":running": "running",
            },
        }
        if start_key:
            request["ExclusiveStartKey"] = start_key
        page = table.scan(**request)
        for candidate in page.get("Items", []):
            if candidate.get("instanceId"):
                try:
                    sync_job(candidate)
                except Exception:
                    # Usage must remain available if a concurrent status poll
                    # settled this job first or an individual provider check
                    # is temporarily unavailable.
                    continue
        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return


def reconcile_stale_jobs() -> None:
    """Periodic sweep (see the EventBridge ReconcileScheduleRule) across every
    active job, not just one principal's. reconcile_active_jobs above only
    runs when that principal happens to poll /v1/usage again; a client that
    crashes or a browser tab that closes mid-job would otherwise leave a
    queued/running job -- and its reserved quota and any owned S3 source
    object -- stranded forever. This also force-fails anything stuck past
    STALE_JOB_TIMEOUT_HOURS even if the provider's own status check keeps
    reporting it as in-flight, so a provider-side bug cannot leak quota
    indefinitely either.
    """
    now = datetime.now(timezone.utc)
    start_key: dict[str, Any] | None = None
    while True:
        request: dict[str, Any] = {
            "FilterExpression": "#status IN (:queued, :running)",
            "ExpressionAttributeNames": {"#status": "status"},
            "ExpressionAttributeValues": {":queued": "queued", ":running": "running"},
        }
        if start_key:
            request["ExclusiveStartKey"] = start_key
        page = table.scan(**request)
        for candidate in page.get("Items", []):
            try:
                created_at = datetime.fromisoformat(str(candidate.get("createdAt") or ""))
                age_hours = (now - created_at).total_seconds() / 3600
            except ValueError:
                age_hours = 0
            if age_hours >= STALE_JOB_TIMEOUT_HOURS:
                try:
                    settle_failure(
                        candidate["pk"][4:],
                        f"Job exceeded the {STALE_JOB_TIMEOUT_HOURS}h safety timeout with no terminal status.",
                    )
                except Exception:
                    continue
                continue
            if candidate.get("instanceId"):
                try:
                    sync_job(candidate)
                except Exception:
                    continue
        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return


def usage(principal: dict[str, Any]) -> dict[str, Any]:
    try:
        reconcile_active_jobs(principal["id"])
    except Exception:
        # A usage read must never become unavailable because background
        # reconciliation had a transient provider or table failure.
        pass
    period, period_start, period_end = billing_period(); item = table.get_item(Key={"pk": f"USAGE#{principal['id']}#{period}", "sk": "USAGE"}).get("Item", {}); entitlement = principal["entitlement"]
    active_jobs = active_jobs_for_principal(principal["id"])
    active_count = len(active_jobs)
    if int(item.get("activeJobs", 0)) != active_count:
        reconcile_active_job_count(principal["id"], active_count)
    return response(200, {"periodStart": period_start, "periodEnd": period_end, "sourceMinutesUsed": item.get("sourceMinutesUsed", 0), "sourceMinutesLimit": entitlement.get("sourceMinutesPerMonth"), "activeJobs": active_count, "activeJobIds": [str(job["pk"])[4:] for job in active_jobs], "concurrentJobsLimit": entitlement.get("maxConcurrentJobs", 1)})


def reconcile_usage_limit(principal_id: str, period: str, period_start: str, period_end: str, source_limit: float | None) -> None:
    """Adjust remaining allowance when a device entitlement is renewed.

    Usage belongs to the stable anonymous principal, not an API-key rotation.
    Recalculation therefore preserves spent/reserved minutes while applying the
    latest allowance policy.
    """
    key = {"pk": f"USAGE#{principal_id}#{period}", "sk": "USAGE"}
    if source_limit is None:
        # A device-scoped owner testing entitlement intentionally has no
        # minute cap. Replace any stale capped balance from an earlier key so
        # it cannot block the same anonymous principal after rotation.
        table.update_item(
            Key=key,
            UpdateExpression="SET periodStart = :start, periodEnd = :end, sourceMinutesLimit = :limit, availableSourceMinutes = :available",
            ExpressionAttributeValues={
                ":start": period_start,
                ":end": period_end,
                ":limit": Decimal("-1"),
                ":available": Decimal("1000000000"),
            },
        )
        return
    item = table.get_item(Key=key).get("Item")
    if not item or float(item.get("sourceMinutesLimit", -1)) == float(source_limit):
        return
    used = Decimal(str(item.get("sourceMinutesUsed", 0)))
    reserved = Decimal(str(item.get("reservedSourceMinutes", 0)))
    remaining = max(Decimal("0"), Decimal(str(source_limit)) - used - reserved)
    table.update_item(
        Key=key,
        UpdateExpression="SET periodStart = :start, periodEnd = :end, sourceMinutesLimit = :limit, availableSourceMinutes = :available",
        ExpressionAttributeValues={
            ":start": period_start,
            ":end": period_end,
            ":limit": Decimal(str(source_limit)),
            ":available": remaining,
        },
    )


def create_code(payload: dict[str, Any]) -> dict[str, Any]:
    code, max_uses = "lvi_code_" + secrets.token_urlsafe(18), max(1, min(100_000, int(payload.get("maxUses") or 1)))
    entitlement = {"sourceMinutesPerMonth": max(0, float(payload.get("sourceMinutesPerMonth") or 600)), "maxConcurrentJobs": max(1, int(payload.get("maxConcurrentJobs") or 1)), "requestsPerMinute": max(1, min(600, int(payload.get("requestsPerMinute") or REQUESTS_PER_MINUTE))), "plan": "access-code"}
    table.put_item(Item={"pk": f"CODE#{digest(code)}", "sk": "CODE", "label": str(payload.get("label") or "Cloud access")[:120], "entitlementJson": json.dumps(entitlement), "maxUses": max_uses, "uses": 0, "expiresAt": payload.get("expiresAt") or "9999-12-31T23:59:59+00:00", "createdAt": now_iso()})
    return response(201, {"code": code, "label": payload.get("label"), "maxUses": max_uses, "expiresAt": payload.get("expiresAt")})


def redeem_code(payload: dict[str, Any]) -> dict[str, Any]:
    code = str(payload.get("code") or ""); item = table.get_item(Key={"pk": f"CODE#{digest(code)}", "sk": "CODE"}).get("Item")
    if not item or item["expiresAt"] <= now_iso(): raise ApiError(401, "invalid or expired access code")
    try: table.update_item(Key={"pk": item["pk"], "sk": "CODE"}, UpdateExpression="ADD uses :one", ConditionExpression="uses < maxUses", ExpressionAttributeValues={":one": 1})
    except ClientError as error: raise ApiError(401, "invalid or exhausted access code") from error
    api_key, principal_id = "lvi_" + secrets.token_urlsafe(30), "usr_" + secrets.token_hex(12)
    table.put_item(Item={"pk": f"APIKEY#{digest(api_key)}", "sk": "APIKEY", "principalId": principal_id, "entitlementJson": item["entitlementJson"], "createdAt": now_iso()})
    return response(200, {"apiKey": api_key, "entitlement": json.loads(item["entitlementJson"])})


def require_admin(token: str | None) -> None:
    if not ADMIN_TOKEN or not token or not hmac.compare_digest(token, ADMIN_TOKEN): raise ApiError(401, "invalid admin token")

def body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("body") or "{}"; raw = base64.b64decode(raw).decode("utf-8") if event.get("isBase64Encoded") else raw
    try: value = json.loads(raw)
    except json.JSONDecodeError as error: raise ApiError(400, "invalid JSON body") from error
    if not isinstance(value, dict): raise ApiError(400, "JSON body must be an object")
    return value

def headers(event: dict[str, Any]) -> dict[str, str]: return {str(key).lower(): str(value) for key, value in (event.get("headers") or {}).items()}
def response(status: int, payload: dict[str, Any], extra_headers: dict[str, str] | None = None) -> dict[str, Any]: return {"statusCode": status, "headers": {"Content-Type": "application/json", **(extra_headers or {})}, "body": json.dumps(payload, default=lambda value: int(value) if isinstance(value, Decimal) and value % 1 == 0 else float(value))}
def digest(value: str) -> str: return hashlib.sha256(value.encode("utf-8")).hexdigest()
def now_iso() -> str: return datetime.now(timezone.utc).isoformat()
def billing_period() -> tuple[str, str, str]:
    now = datetime.now(timezone.utc); start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0); end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    return start.strftime("%Y-%m"), start.isoformat(), end.isoformat()
