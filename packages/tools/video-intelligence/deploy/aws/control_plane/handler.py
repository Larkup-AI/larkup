from __future__ import annotations

import base64
import hashlib
import hmac
import json
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
        if method == "POST" and path == "/v1/admin/access-codes":
            require_admin(headers(event).get("x-larkup-admin-token")); return create_code(body(event))
        principal = authenticate(headers(event).get("authorization"))
        if method == "POST" and path == "/v1/uploads": return create_upload(principal, body(event))
        if method == "POST" and path == "/v1/jobs": return create_job(principal, body(event))
        if method == "GET" and path == "/v1/usage": return usage(principal)
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
    item = table.get_item(Key={"pk": f"APIKEY#{digest(authorization.split(' ', 1)[1].strip())}", "sk": "APIKEY"}).get("Item")
    if not item or item.get("revokedAt"): raise ApiError(401, "invalid API key")
    return {"id": item["principalId"], "entitlement": json.loads(item["entitlementJson"])}


def create_upload(principal: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    file_name, content_type, size = str(payload.get("fileName") or "video.bin")[:255], str(payload.get("contentType") or "application/octet-stream")[:120], int(payload.get("sizeBytes") or 0)
    if size <= 0 or size > MAX_UPLOAD_BYTES: raise ApiError(413, "invalid or oversized upload")
    upload_id, suffix = "upl_" + secrets.token_hex(12), (file_name.rsplit(".", 1)[-1] if "." in file_name else "bin")
    key = f"sources/{principal['id']}/{upload_id}.{suffix[:12]}"
    table.put_item(Item={"pk": f"UPLOAD#{upload_id}", "sk": "UPLOAD", "principalId": principal["id"], "sourceKey": key, "fileName": file_name, "sizeBytes": size, "createdAt": now_iso(), "expiresAtEpoch": int((datetime.now(timezone.utc) + timedelta(hours=24)).timestamp())})
    url = s3.generate_presigned_url("put_object", Params={"Bucket": BUCKET, "Key": key, "ContentType": content_type}, ExpiresIn=900)
    return response(201, {"uploadId": upload_id, "uploadUrl": url, "uploadHeaders": {"Content-Type": content_type}})


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
    if brief.get("indexingMode") == "full-coverage" and not principal["entitlement"].get("allowFullCoverage", False): raise ApiError(403, "full-frame analysis is not enabled for this API key")
    estimate, (period, period_start, period_end) = max(0.01, duration_seconds / 60), billing_period()
    job_id, created_at = "job_" + secrets.token_hex(12), now_iso()
    source_url = s3.generate_presigned_url("get_object", Params={"Bucket": BUCKET, "Key": upload["sourceKey"]}, ExpiresIn=3600)
    job_item = {"pk": {"S": f"JOB#{job_id}"}, "sk": {"S": "JOB"}, "principalId": {"S": principal["id"]}, "status": {"S": "queued"}, "sourceKey": {"S": upload["sourceKey"]}, "briefJson": {"S": json.dumps(brief, separators=(",", ":"))}, "estimatedSourceMinutes": {"N": str(estimate)}, "period": {"S": period}, "createdAt": {"S": created_at}, "updatedAt": {"S": created_at}, "retainSourceHours": {"N": str(min(24, int(brief.get("retainSourceHours") or 0)))}, "progressJson": {"S": json.dumps({"stage": "queued", "percent": 0, "message": "Waiting for a secure EU GPU worker"})}}
    source_limit = principal["entitlement"].get("sourceMinutesPerMonth")
    available, usage_key = Decimal(str(source_limit if source_limit is not None else 1_000_000_000)), f"USAGE#{principal['id']}#{period}"
    boto3.client("dynamodb", region_name=REGION).transact_write_items(TransactItems=[{"Put": {"TableName": TABLE_NAME, "Item": job_item}}, {"Update": {"TableName": TABLE_NAME, "Key": {"pk": {"S": usage_key}, "sk": {"S": "USAGE"}}, "UpdateExpression": "SET periodStart = :start, periodEnd = :end, sourceMinutesLimit = :limit, availableSourceMinutes = if_not_exists(availableSourceMinutes, :available) - :estimate ADD reservedSourceMinutes :estimate, activeJobs :one", "ConditionExpression": "(attribute_not_exists(activeJobs) OR activeJobs < :concurrency) AND (attribute_not_exists(availableSourceMinutes) OR availableSourceMinutes >= :estimate)", "ExpressionAttributeValues": {":start": {"S": period_start}, ":end": {"S": period_end}, ":limit": {"N": str(source_limit) if source_limit is not None else "-1"}, ":available": {"N": str(available)}, ":estimate": {"N": str(estimate)}, ":one": {"N": "1"}, ":concurrency": {"N": str(principal["entitlement"].get("maxConcurrentJobs", 1))}}}}])
    try:
        remote = runpod("/run", {"input": {"sourceUrl": source_url, "brief": brief}})
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


def usage(principal: dict[str, Any]) -> dict[str, Any]:
    period, period_start, period_end = billing_period(); item = table.get_item(Key={"pk": f"USAGE#{principal['id']}#{period}", "sk": "USAGE"}).get("Item", {}); entitlement = principal["entitlement"]
    return response(200, {"periodStart": period_start, "periodEnd": period_end, "sourceMinutesUsed": item.get("sourceMinutesUsed", 0), "sourceMinutesLimit": entitlement.get("sourceMinutesPerMonth"), "activeJobs": item.get("activeJobs", 0), "concurrentJobsLimit": entitlement.get("maxConcurrentJobs", 1), "allowFullCoverage": entitlement.get("allowFullCoverage", False)})


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
