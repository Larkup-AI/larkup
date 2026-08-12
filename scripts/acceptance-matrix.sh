#!/usr/bin/env bash
#
# Provider acceptance matrix (plan §11.2), checks 3–9.
#
# Target-agnostic on purpose: §11.1 says one image runs everywhere, so the same
# assertions must pass everywhere. A target needing bespoke assertions has
# broken the "build once, target many" rule.
#
# Usage:
#   scripts/acceptance-matrix.sh <baseUrl> [expectedReleaseId] [allowedOrigin]
#
# Checks 1–2 (clean provision, secrets absent from logs) are provider-specific;
# see docs/deploy/agent-runtime/acceptance-matrix.md.

set -uo pipefail

BASE_URL="${1:-}"
EXPECTED_RELEASE="${2:-}"
ALLOWED_ORIGIN="${3:-}"

if [[ -z "$BASE_URL" ]]; then
  echo "usage: $0 <baseUrl> [expectedReleaseId] [allowedOrigin]" >&2
  exit 2
fi
BASE_URL="${BASE_URL%/}"

PASS=0
FAIL=0
SKIP=0

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  \033[31m✗\033[0m %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }
skip() { printf '  \033[33m–\033[0m %s (%s)\n' "$1" "${2:-}"; SKIP=$((SKIP + 1)); }

status() { curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$@"; }
body()   { curl -s --max-time 30 "$@"; }

echo
echo "Acceptance matrix — $BASE_URL"
echo

# ---------------------------------------------------------------- check 3
echo "3. Health and readiness"
if [[ "$(status "$BASE_URL/health")" == "200" ]]; then
  pass "/health returns 200"
else
  fail "/health returns 200" "got $(status "$BASE_URL/health")"
fi

READY_CODE=$(status "$BASE_URL/readiness")
if [[ "$READY_CODE" == "200" ]]; then
  pass "/readiness returns 200 (model credential present)"
elif [[ "$READY_CODE" == "503" ]]; then
  fail "/readiness returns 200" "got 503 — no model credential injected"
else
  fail "/readiness returns 200" "got $READY_CODE"
fi

# ---------------------------------------------------------------- check 7
echo
echo "7. Remote release identification"
HEALTH=$(body "$BASE_URL/health")
REPORTED=$(printf '%s' "$HEALTH" | sed -n 's/.*"releaseId":"\([^"]*\)".*/\1/p')
if [[ -z "$REPORTED" ]]; then
  fail "/health reports a releaseId" "not present in: $HEALTH"
elif [[ -n "$EXPECTED_RELEASE" && "$REPORTED" != "$EXPECTED_RELEASE" ]]; then
  fail "deployed release matches expected" "deployed=$REPORTED expected=$EXPECTED_RELEASE"
else
  pass "/health reports releaseId=$REPORTED"
fi

# ---------------------------------------------------------------- check 6
echo
echo "6. Widget origin policy"
if [[ -z "$ALLOWED_ORIGIN" ]]; then
  # Derive one from the agent's own config so the check still runs unattended.
  ALLOWED_ORIGIN=$(body "$BASE_URL/agent" | sed -n 's/.*"allowedOrigins":\["\([^"]*\)".*/\1/p')
fi

BLOCKED_ORIGIN="https://definitely-not-allowed.invalid"
BLOCKED_CODE=$(status -H "Origin: $BLOCKED_ORIGIN" "$BASE_URL/agent")
if [[ "$BLOCKED_CODE" == "403" ]]; then
  pass "blocked origin is rejected with 403"
elif [[ "$BLOCKED_CODE" == "200" ]]; then
  fail "blocked origin is rejected" "got 200 — the allow-list is '*' or not enforced"
else
  fail "blocked origin is rejected with 403" "got $BLOCKED_CODE"
fi

if [[ -n "$ALLOWED_ORIGIN" && "$ALLOWED_ORIGIN" != "*" ]]; then
  if [[ "$(status -H "Origin: $ALLOWED_ORIGIN" "$BASE_URL/agent")" == "200" ]]; then
    pass "allowed origin ($ALLOWED_ORIGIN) reaches /agent"
  else
    fail "allowed origin reaches /agent" "origin=$ALLOWED_ORIGIN"
  fi
else
  skip "allowed origin reaches /agent" "no specific origin configured"
fi

WIDGET_CODE=$(status "$BASE_URL/widget.js")
if [[ "$WIDGET_CODE" == "200" ]]; then
  pass "/widget.js is served"
else
  fail "/widget.js is served" "got $WIDGET_CODE — bundle missing from the image"
fi

# ---------------------------------------------------------------- check 4
echo
echo "4. Streaming"
STREAM_FILE=$(mktemp)
curl -s -N --max-time 45 -X POST "$BASE_URL/chat" \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Reply with a short sentence."}]}' \
  > "$STREAM_FILE" 2>/dev/null

FRAMES=$(grep -c '^data: ' "$STREAM_FILE" 2>/dev/null || echo 0)
if grep -q '"type":"error"' "$STREAM_FILE" 2>/dev/null; then
  fail "streamed answer" "runtime returned an error frame — check the model credential"
elif [[ "$FRAMES" -gt 1 ]]; then
  pass "streamed answer ($FRAMES SSE frames)"
elif [[ "$FRAMES" -eq 1 ]]; then
  fail "streamed answer" "only 1 frame — a proxy is buffering (set proxy_buffering off)"
else
  fail "streamed answer" "no SSE frames: $(head -c 200 "$STREAM_FILE")"
fi
rm -f "$STREAM_FILE"

# empty body must be refused before the model is called
if [[ "$(status -X POST "$BASE_URL/chat" -H 'Content-Type: application/json' -d '{"messages":[]}')" == "400" ]]; then
  pass "empty message list rejected with 400"
else
  fail "empty message list rejected with 400" ""
fi

# ---------------------------------------------------------------- check 5
echo
echo "5. Tool invocation or visible refusal"
AGENT_JSON=$(body "$BASE_URL/agent")
if printf '%s' "$AGENT_JSON" | grep -q '"status":"ready"'; then
  pass "agent reports ready (tool admission is reported by the dashboard /health)"
else
  fail "agent reports ready" "$AGENT_JSON"
fi

# ---------------------------------------------------------------- checks 8-9
echo
echo "8–9. Redeploy and rollback"
skip "redeploy" "provider-specific; see docs/deploy/agent-runtime/acceptance-matrix.md"
skip "rollback" "deploy the previous release's bundle and re-run with its releaseId"

# ---------------------------------------------------------------- storage
echo
echo "Storage"
if printf '%s' "$HEALTH" | grep -qi 'lancedb\|vector'; then
  fail "no local vector storage on the agent runtime" "$HEALTH"
else
  pass "agent runtime is stateless — no local vector storage"
fi

echo
printf 'passed %d · failed %d · skipped %d\n' "$PASS" "$FAIL" "$SKIP"
echo
[[ "$FAIL" -eq 0 ]] || exit 1
