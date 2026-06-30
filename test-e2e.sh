#!/bin/bash
set -e

#===========================================
# Larkup RAG — E2E Test Runner
#===========================================
# Usage:
#   ./test-e2e.sh                    # Run all tests (web UI must be running)
#   ./test-e2e.sh --suite web        # Only Web UI tests
#   ./test-e2e.sh --suite api        # Only API tests
#   ./test-e2e.sh --suite sdk        # Only SDK tests
#   ./test-e2e.sh --suite cli        # Only CLI tests
#   ./test-e2e.sh --suite install    # Only installation tests
#   ./test-e2e.sh --headed           # Run with browser visible
#   ./test-e2e.sh --debug            # Run with Playwright Inspector

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
E2E_DIR="$SCRIPT_DIR/apps/e2e"

# ---- Parse arguments ----
SUITE="all"
EXTRA_ARGS=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --suite)
            SUITE="$2"
            shift 2
            ;;
        --headed)
            EXTRA_ARGS="$EXTRA_ARGS --headed"
            shift
            ;;
        --debug)
            EXTRA_ARGS="$EXTRA_ARGS --debug"
            shift
            ;;
        --ui)
            EXTRA_ARGS="$EXTRA_ARGS --ui"
            shift
            ;;
        *)
            EXTRA_ARGS="$EXTRA_ARGS $1"
            shift
            ;;
    esac
done

# ---- Load .env.e2e ----
if [ -f "$E2E_DIR/.env.e2e" ]; then
    echo "Loading .env.e2e..."
    set -a
    source "$E2E_DIR/.env.e2e"
    set +a
fi

# ---- Check prerequisites ----
echo ""
echo "========================================="
echo "  Larkup RAG — E2E Test Runner"
echo "========================================="
echo "  Suite:  $SUITE"
echo "  E2E:    $E2E_DIR"
echo "========================================="
echo ""

# Check if web UI is running
echo "🔍 Checking web UI on :4567..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost:4567 | grep -q "200\|302\|304"; then
    echo "  ✓ Web UI is running"
else
    echo "  ✗ Web UI is not running!"
    echo "  Start it with: pnpm dev (from repo root)"
    echo ""
    read -p "Start pnpm start (production build) now? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Building and starting development server in background..."
        mkdir -p "$SCRIPT_DIR/playwright-report"
        cd "$SCRIPT_DIR/apps/web" && pnpm dev > "$SCRIPT_DIR/playwright-report/webui.log" 2>&1 &
        DEV_PID=$!
        echo "  Waiting 60s for build and server start..."
        sleep 60
    else
        echo "Please start the server manually and try again."
        exit 1
    fi
fi

# ---- Install Playwright browsers if needed ----
if [ ! -d "$HOME/Library/Caches/ms-playwright" ] && [ ! -d "$HOME/.cache/ms-playwright" ]; then
    echo "📦 Installing Playwright browsers..."
    cd "$E2E_DIR" && npx playwright install chromium
fi

# ---- Install E2E dependencies ----
echo "📦 Installing E2E dependencies..."
cd "$SCRIPT_DIR" && pnpm install --filter @larkup-rag/e2e

# ---- Run tests ----
echo ""
echo "🧪 Running E2E tests..."
echo ""

cd "$E2E_DIR"

case $SUITE in
    web)
        npx playwright test tests/web-ui/ $EXTRA_ARGS
        ;;
    api)
        npx playwright test tests/api/ $EXTRA_ARGS
        ;;
    sdk)
        npx playwright test tests/sdk/ $EXTRA_ARGS
        ;;
    cli)
        npx playwright test tests/cli/ $EXTRA_ARGS
        ;;
    install)
        npx playwright test tests/installation/ $EXTRA_ARGS
        ;;
    all)
        npx playwright test $EXTRA_ARGS
        ;;
    *)
        echo "Unknown suite: $SUITE"
        echo "Available: web, api, sdk, cli, install, all"
        exit 1
        ;;
esac

EXIT_CODE=$?

# ---- Cleanup ----
cleanup() {
    if [ -n "$DEV_PID" ]; then
        echo "Stopping dev server (PID $DEV_PID)..."
        # Send SIGTERM to the process group if possible, or just kill the PID
        kill $DEV_PID 2>/dev/null || true
    fi
}

trap cleanup EXIT INT TERM

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo "========================================="
    echo "  ✅ All E2E tests passed!"
    echo "========================================="
else
    echo "========================================="
    echo "  ❌ Some E2E tests failed (exit code: $EXIT_CODE)"
    echo "  Run 'cd apps/e2e && npx playwright show-report' for details"
    echo "========================================="
fi

exit $EXIT_CODE
