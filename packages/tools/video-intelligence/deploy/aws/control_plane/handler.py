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

REGION, TABLE_NAME, BUCKET = os.environ["AWS_REGION"], os.environ["TABLE_NAME"], os.environ["BUCKET_NAME"]
RUNPOD_ENDPOINT_ID, RUNPOD_API_KEY = os.environ["RUNPOD_ENDPOINT_ID"], os.environ["RUNPOD_API_KEY"]
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(20 * 1024**3)))
PROCESSING_ENABLED = os.getenv("PROCESSING_ENABLED", "false").lower() == "true"
AUTO_PROVISIONING_ENABLED = os.getenv("AUTO_PROVISIONING_ENABLED", "false").lower() == "true"
AUTO_PROVISIONED_SOURCE_MINUTES = max(1, min(120, int(os.getenv("AUTO_PROVISIONED_SOURCE_MINUTES", "30"))))
REQUESTS_PER_MINUTE = max(30, min(600, int(os.getenv("REQUESTS_PER_MINUTE", "120"))))
TESTING_DEVICE_HASHES = {
    value.strip()
    for value in os.getenv("TESTING_DEVICE_HASHES", "").split(",")
    if value.strip()
}
RUNPOD_BASE = f"https://api.runpod.ai/v2/{RUNPOD_ENDPOINT_ID}"
table = boto3.resource("dynamodb", region_name=REGION).Table(TABLE_NAME)
s3 = boto3.client("s3", region_name=REGION, endpoint_url=f"https://s3.{REGION}.amazonaws.com", config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))


class ApiError(RuntimeError):
    def __init__(self, status: int, message: str, headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status, self.headers = status, headers or {}


def handler(event: dict[str, Any], _: Any) -> dict[str, Any]:
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    path = event.get("rawPath", "/")
    try:
        if method == "GET" and path == "/v1/health":
            return response(200, {"status": "ok", "version": "0.1.0", "runtime": "managed-cloud", "authRequired": True, "processingEnabled": PROCESSING_ENABLED, "device": "cuda", "provider": "runpod-secure-cloud"})
        if method == "POST" and path == "/v1/access-codes/redeem": return redeem_code(body(event))
        if method == "POST" and path == "/v1/device-keys": return provision_device_key(body(event))
        if method == "POST" and path == "/v1/admin/access-codes":
            require_admin(headers(event).get("x-larkup-admin-token")); return create_code(body(event))
        principal = authenticate(headers(event).get("authorization"))
        if method == "POST" and path == "/v1/uploads": return create_upload(principal, body(event))
        if method == "POST" and path == "/v1/jobs": return create_job(principal, body(event))
        if method == "GET" and path == "/v1/usage": return usage(principal)
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
            ExpressionAttributeValues={":expires": int((datetime.now(timezone.utc) + timedelta(minutes=2)).timestamp()), ":one": 1, ":limit": REQUESTS_PER_MINUTE},
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
        # Renewals keep the same anonymous device principal and therefore the
        # same usage history, but adopt the current pilot entitlement policy.
        # This lets an operator safely adjust beta limits without resetting
        # consumption or creating a new billable identity.
        entitlement = auto_entitlement(str(device.get("deviceHash") or device_hash))
        api_hash = digest(api_key)
        boto3.client("dynamodb", region_name=REGION).transact_write_items(TransactItems=[
            {"Put": {"TableName": TABLE_NAME, "Item": {"pk": {"S": f"APIKEY#{api_hash}"}, "sk": {"S": "APIKEY"}, "principalId": {"S": principal_id}, "entitlementJson": {"S": json.dumps(entitlement)}, "createdAt": {"S": now_iso()}}, "ConditionExpression": "attribute_not_exists(pk)"}},
            {"Update": {"TableName": TABLE_NAME, "Key": {"pk": {"S": device_key}, "sk": {"S": "DEVICE"}}, "UpdateExpression": "SET apiKeyHash = :hash, rotatedAt = :at", "ExpressionAttributeValues": {":hash": {"S": api_hash}, ":at": {"S": now_iso()}}}},
            {"Update": {"TableName": TABLE_NAME, "Key": {"pk": {"S": f"APIKEY#{device['apiKeyHash']}"}, "sk": {"S": "APIKEY"}}, "UpdateExpression": "SET revokedAt = :at", "ExpressionAttributeValues": {":at": {"S": now_iso()}}}},
        ])
    else:
        principal_id, entitlement, api_hash = "usr_" + secrets.token_hex(12), auto_entitlement(device_hash), digest(api_key)
        try:
            boto3.client("dynamodb", region_name=REGION).transact_write_items(TransactItems=[
                {"Put": {"TableName": TABLE_NAME, "Item": {"pk": {"S": f"APIKEY#{api_hash}"}, "sk": {"S": "APIKEY"}, "principalId": {"S": principal_id}, "entitlementJson": {"S": json.dumps(entitlement)}, "createdAt": {"S": now_iso()}}, "ConditionExpression": "attribute_not_exists(pk)"}},
                {"Put": {"TableName": TABLE_NAME, "Item": {"pk": {"S": device_key}, "sk": {"S": "DEVICE"}, "principalId": {"S": principal_id}, "apiKeyHash": {"S": api_hash}, "deviceHash": {"S": device_hash}, "createdAt": {"S": now_iso()}}, "ConditionExpression": "attribute_not_exists(pk)"}},
            ])
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") == "TransactionCanceledException":
                return provision_device_key(payload)
            raise
    return response(201, {"apiKey": api_key, "entitlement": entitlement})


def auto_entitlement(device_hash: str) -> dict[str, Any]:
    if device_hash in TESTING_DEVICE_HASHES:
        # Explicit owner-only test access is bound to an anonymized local
        # installation hash. It bypasses minute/request caps but still limits
        # concurrent work and disables full-frame coverage.
        return {
            "sourceMinutesPerMonth": None,
            # Owner-device testing can recover from an interrupted browser
            # poll without blocking the next bounded diagnostic request.
            "maxConcurrentJobs": 2,
            "allowFullCoverage": False,
            "unlimitedRequests": True,
            "plan": "owner-device-testing",
        }
    return {"sourceMinutesPerMonth": AUTO_PROVISIONED_SOURCE_MINUTES, "maxConcurrentJobs": 1, "allowFullCoverage": False, "plan": "device"}


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
    timeline_duration_seconds = duration_seconds
    for candidate in brief.get("importantRanges") or []:
        try:
            candidate_end = float(candidate.get("endSecs"))
        except (AttributeError, TypeError, ValueError):
            continue
        if math.isfinite(candidate_end):
            timeline_duration_seconds = max(timeline_duration_seconds, candidate_end)
    if brief.get("indexingMode") == "full-coverage" and not principal["entitlement"].get("allowFullCoverage", False): raise ApiError(403, "full-frame analysis is not enabled for this API key")
    estimate, (period, period_start, period_end) = max(0.01, duration_seconds / 60), billing_period()
    job_id, created_at = "job_" + secrets.token_hex(12), now_iso()
    source_url = s3.generate_presigned_url("get_object", Params={"Bucket": BUCKET, "Key": upload["sourceKey"]}, ExpiresIn=3600)
    job_item = {"pk": {"S": f"JOB#{job_id}"}, "sk": {"S": "JOB"}, "principalId": {"S": principal["id"]}, "status": {"S": "queued"}, "sourceKey": {"S": upload["sourceKey"]}, "briefJson": {"S": json.dumps(brief, separators=(",", ":"))}, "estimatedSourceMinutes": {"N": str(estimate)}, "period": {"S": period}, "createdAt": {"S": created_at}, "updatedAt": {"S": created_at}, "retainSourceHours": {"N": "0"}, "progressJson": {"S": json.dumps({"stage": "queued", "percent": 0, "message": "Waiting for a secure EU GPU worker"})}}
    source_limit = principal["entitlement"].get("sourceMinutesPerMonth")
    reconcile_usage_limit(principal["id"], period, period_start, period_end, source_limit)
    available, usage_key = Decimal(str(source_limit if source_limit is not None else 1_000_000_000)), f"USAGE#{principal['id']}#{period}"
    quota_condition = (
        " AND ((attribute_not_exists(availableSourceMinutes) AND :available >= :estimate) OR availableSourceMinutes >= :estimate)"
        if source_limit is not None
        else ""
    )
    boto3.client("dynamodb", region_name=REGION).transact_write_items(TransactItems=[{"Put": {"TableName": TABLE_NAME, "Item": job_item}}, {"Update": {"TableName": TABLE_NAME, "Key": {"pk": {"S": usage_key}, "sk": {"S": "USAGE"}}, "UpdateExpression": "SET periodStart = :start, periodEnd = :end, sourceMinutesLimit = :limit, availableSourceMinutes = if_not_exists(availableSourceMinutes, :available) - :estimate ADD reservedSourceMinutes :estimate, activeJobs :one", "ConditionExpression": "(attribute_not_exists(activeJobs) OR activeJobs < :concurrency)" + quota_condition, "ExpressionAttributeValues": {":start": {"S": period_start}, ":end": {"S": period_end}, ":limit": {"N": str(source_limit) if source_limit is not None else "-1"}, ":available": {"N": str(available)}, ":estimate": {"N": str(estimate)}, ":one": {"N": "1"}, ":concurrency": {"N": str(principal["entitlement"].get("maxConcurrentJobs", 1))}}}}])
    try:
        remote = runpod(
            "/run",
            {
                "input": {
                    "sourceUrl": source_url,
                    "sourceDurationSecs": timeline_duration_seconds,
                    "brief": brief,
                }
            },
        )
        runpod_job_id = str(remote.get("id") or "")
        if not runpod_job_id: raise RuntimeError("RunPod did not return a job ID")
        table.update_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"}, UpdateExpression="SET runpodJobId = :runpod", ExpressionAttributeValues={":runpod": runpod_job_id})
    except Exception as error:
        settle_failure(job_id, f"RunPod submission failed: {error}"); raise ApiError(502, "GPU job submission failed; reservation released") from error
    return get_job(principal, job_id, 202)


def get_job(principal: dict[str, Any], job_id: str, status_code: int = 200) -> dict[str, Any]:
    item = table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"}, ConsistentRead=True).get("Item")
    if not item or item.get("principalId") != principal["id"]: raise ApiError(404, "job not found")
    if item["status"] in {"queued", "running"} and item.get("runpodJobId"):
        sync_runpod(item); item = table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"}, ConsistentRead=True)["Item"]
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


def sync_runpod(item: dict[str, Any]) -> None:
    try: remote = runpod(f"/status/{item['runpodJobId']}")
    except Exception:
        update_progress(item, "queued", 1, "Waiting for RunPod status"); return
    state = str(remote.get("status") or "").upper()
    if state in {"IN_QUEUE", "QUEUED"}: update_progress(item, "queued", 1, "Queued on a secure EU GPU worker")
    elif state in {"IN_PROGRESS", "RUNNING"}: update_progress(item, "probe", 5, "GPU worker is processing the video")
    elif state == "COMPLETED":
        output, result = remote.get("output") or {}, None
        if isinstance(output, dict): result = output.get("result")
        if not isinstance(result, dict): settle_failure(item["pk"][4:], "RunPod completed without a result"); return
        result["jobId"] = item["pk"][4:]
        result_key = f"results/{item['principalId']}/{item['pk'][4:]}.json"
        s3.put_object(Bucket=BUCKET, Key=result_key, Body=json.dumps(result, separators=(",", ":")).encode("utf-8"), ContentType="application/json", ServerSideEncryption="aws:kms")
        settle(item, "completed", float(output.get("actualSourceMinutes") or item["estimatedSourceMinutes"]), result_key=result_key)
    elif state in {"CANCELLED", "CANCELED"}: settle(item, "cancelled", 0, error="Cancelled by RunPod")
    elif state in {"FAILED", "TIMED_OUT"}: settle(item, "failed", 0, error=str(remote.get("error") or "RunPod worker failed"))


def cancel_job(principal: dict[str, Any], job_id: str) -> dict[str, Any]:
    item = table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"}, ConsistentRead=True).get("Item")
    if not item or item.get("principalId") != principal["id"]: raise ApiError(404, "job not found")
    if item["status"] not in {"queued", "running"}: raise ApiError(409, "job cannot be cancelled")
    try:
        if item.get("runpodJobId"): runpod(f"/cancel/{item['runpodJobId']}", {})
    except Exception as error: raise ApiError(502, "RunPod cancellation request failed") from error
    settle(item, "cancelled", 0, error="Cancelled by the API key owner")
    return get_job(principal, job_id)


def update_progress(item: dict[str, Any], stage: str, percent: int, message: str) -> None:
    table.update_item(Key={"pk": item["pk"], "sk": item["sk"]}, UpdateExpression="SET #status = :status, progressJson = :progress, updatedAt = :updated", ConditionExpression="#status IN (:queued, :running)", ExpressionAttributeNames={"#status": "status"}, ExpressionAttributeValues={":status": "running" if stage != "queued" else "queued", ":queued": "queued", ":running": "running", ":progress": json.dumps({"stage": stage, "percent": percent, "message": message}), ":updated": now_iso()})


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
    if int(item.get("retainSourceHours", 0)) == 0: s3.delete_object(Bucket=BUCKET, Key=item["sourceKey"])


def settle_failure(job_id: str, error: str) -> None:
    item = table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "JOB"}).get("Item")
    if item: settle(item, "failed", 0, error=error)


def runpod(path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(f"{RUNPOD_BASE}{path}", data=data, headers={"Authorization": f"Bearer {RUNPOD_API_KEY}", "Content-Type": "application/json"}, method="POST" if payload is not None else "GET")
    try:
        with urllib.request.urlopen(request, timeout=20) as remote: parsed = json.loads(remote.read().decode("utf-8"))
    except urllib.error.HTTPError as error: raise RuntimeError(f"RunPod HTTP {error.code}") from error
    if not isinstance(parsed, dict) or parsed.get("error"): raise RuntimeError(str(parsed.get("error") if isinstance(parsed, dict) else "invalid RunPod response"))
    return parsed


def reconcile_active_jobs(principal_id: str) -> None:
    """Settle completed RunPod work even if a browser disconnected mid-poll."""
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
            if candidate.get("runpodJobId"):
                try:
                    sync_runpod(candidate)
                except Exception:
                    # Usage must remain available if a concurrent status poll
                    # settled this job first or an individual provider check
                    # is temporarily unavailable.
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
    return response(200, {"periodStart": period_start, "periodEnd": period_end, "sourceMinutesUsed": item.get("sourceMinutesUsed", 0), "sourceMinutesLimit": entitlement.get("sourceMinutesPerMonth"), "activeJobs": item.get("activeJobs", 0), "concurrentJobsLimit": entitlement.get("maxConcurrentJobs", 1), "allowFullCoverage": entitlement.get("allowFullCoverage", False)})


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
    entitlement = {"sourceMinutesPerMonth": max(1, float(payload.get("sourceMinutesPerMonth") or 600)), "maxConcurrentJobs": max(1, int(payload.get("maxConcurrentJobs") or 1)), "allowFullCoverage": bool(payload.get("allowFullCoverage", False)), "plan": "access-code"}
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
