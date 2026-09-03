#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <user-id> <monthly-source-minutes> [plan]" >&2
  echo "Requires LARKUP_VIDEO_INTELLIGENCE_CLOUD_ENDPOINT and LARKUP_VIDEO_ADMIN_TOKEN." >&2
  exit 64
}

USER_ID="${1:-}"
SOURCE_MINUTES="${2:-}"
PLAN="${3:-support-grant}"

[[ -n "$USER_ID" && -n "$SOURCE_MINUTES" ]] || usage
[[ "$USER_ID" =~ ^[A-Za-z0-9._-]{32,128}$ ]] || {
  echo "User ID must be the generated ID shown in Installed Tools." >&2
  exit 64
}
[[ "$SOURCE_MINUTES" =~ ^[0-9]+([.][0-9]+)?$ ]] || {
  echo "Monthly source minutes must be a non-negative number." >&2
  exit 64
}
[[ "$PLAN" =~ ^[A-Za-z0-9._-]{1,80}$ ]] || {
  echo "Plan may contain only letters, numbers, dots, underscores, and hyphens." >&2
  exit 64
}

ENDPOINT="${LARKUP_VIDEO_INTELLIGENCE_CLOUD_ENDPOINT:-}"
ADMIN_TOKEN="${LARKUP_VIDEO_ADMIN_TOKEN:-}"
[[ -n "$ENDPOINT" && -n "$ADMIN_TOKEN" ]] || {
  echo "Set LARKUP_VIDEO_INTELLIGENCE_CLOUD_ENDPOINT and LARKUP_VIDEO_ADMIN_TOKEN first." >&2
  exit 64
}

ENDPOINT="${ENDPOINT%/}"
PAYLOAD=$(printf '{"sourceMinutesPerMonth":%s,"plan":"%s"}' "$SOURCE_MINUTES" "$PLAN")

curl --fail-with-body --silent --show-error \
  --request POST "$ENDPOINT/v1/admin/devices/$USER_ID/entitlement" \
  --header 'Content-Type: application/json' \
  --header "X-Larkup-Admin-Token: $ADMIN_TOKEN" \
  --data "$PAYLOAD"
echo
