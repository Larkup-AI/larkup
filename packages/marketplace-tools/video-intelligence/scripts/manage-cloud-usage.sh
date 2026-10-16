#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  manage-cloud-usage.sh status <user-id>
  manage-cloud-usage.sh reset <user-id>
  manage-cloud-usage.sh set <user-id> <monthly-source-minutes> [plan]
  manage-cloud-usage.sh add <user-id> <monthly-source-minutes> [plan]
  manage-cloud-usage.sh remove <user-id> <monthly-source-minutes> [plan]
  manage-cloud-usage.sh usage-set <user-id> <used-source-minutes>
  manage-cloud-usage.sh usage-add <user-id> <used-source-minutes>
  manage-cloud-usage.sh usage-remove <user-id> <used-source-minutes>

set/add/remove change the monthly allowance. reset clears current-period usage.
Requires LARKUP_VIDEO_INTELLIGENCE_CLOUD_ENDPOINT and LARKUP_VIDEO_ADMIN_TOKEN.
EOF
  exit 64
}

ACTION="${1:-}"
USER_ID="${2:-}"
VALUE="${3:-}"
PLAN="${4:-support-grant}"

case "$ACTION" in
  status|reset) [[ $# -eq 2 ]] || usage ;;
  set|add|remove) [[ $# -ge 3 && $# -le 4 ]] || usage ;;
  usage-set|usage-add|usage-remove) [[ $# -eq 3 ]] || usage ;;
  *) usage ;;
esac

[[ "$USER_ID" =~ ^[A-Za-z0-9._-]{32,128}$ ]] || {
  echo "User ID must be the generated ID shown in Installed Tools." >&2
  exit 64
}
if [[ -n "$VALUE" ]]; then
  [[ "$VALUE" =~ ^[0-9]+([.][0-9]+)?$ ]] || {
    echo "Source minutes must be a non-negative number." >&2
    exit 64
  }
fi
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
command -v jq >/dev/null || {
  echo "jq is required." >&2
  exit 69
}

ENDPOINT="${ENDPOINT%/}"
USAGE_URL="$ENDPOINT/v1/admin/devices/$USER_ID/usage"
ENTITLEMENT_URL="$ENDPOINT/v1/admin/devices/$USER_ID/entitlement"

request() {
  local method="$1"
  local url="$2"
  local payload="${3:-}"
  local args=(
    --fail-with-body
    --silent
    --show-error
    --request "$method"
    "$url"
    --header 'Content-Type: application/json'
    --header "X-Larkup-Admin-Token: $ADMIN_TOKEN"
  )
  if [[ -n "$payload" ]]; then
    args+=(--data "$payload")
  fi
  curl "${args[@]}"
}

case "$ACTION" in
  status)
    request GET "$USAGE_URL"
    ;;
  reset)
    request POST "$USAGE_URL" '{"operation":"reset"}'
    ;;
  usage-set|usage-add|usage-remove)
    operation="${ACTION#usage-}"
    payload=$(jq -cn --arg operation "$operation" --argjson sourceMinutes "$VALUE" \
      '{operation: $operation, sourceMinutes: $sourceMinutes}')
    request POST "$USAGE_URL" "$payload"
    ;;
  set|add|remove)
    target="$VALUE"
    if [[ "$ACTION" != "set" ]]; then
      current=$(request GET "$USAGE_URL" | jq -er '.sourceMinutesLimit | select(type == "number")') || {
        echo "Cannot add to or remove from an unlimited monthly allowance; use set instead." >&2
        exit 65
      }
      if [[ "$ACTION" == "add" ]]; then
        target=$(jq -cn --argjson current "$current" --argjson amount "$VALUE" '$current + $amount')
      else
        target=$(jq -cn --argjson current "$current" --argjson amount "$VALUE" \
          '[$current - $amount, 0] | max')
      fi
    fi
    payload=$(jq -cn --argjson sourceMinutesPerMonth "$target" --arg plan "$PLAN" \
      '{sourceMinutesPerMonth: $sourceMinutesPerMonth, plan: $plan}')
    request POST "$ENTITLEMENT_URL" "$payload" >/dev/null
    request GET "$USAGE_URL"
    ;;
esac
echo
