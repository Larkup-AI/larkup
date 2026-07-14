#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC_DIR="${PROJECT_ROOT}/apps/web/public"

PASS=0
FAIL=0
WARN=0

# ── Helpers ──────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

pass() { ((PASS++)); echo -e "  ${GREEN}✓${NC} $1"; }
fail() { ((FAIL++)); echo -e "  ${RED}✗${NC} $1"; }
warn() { ((WARN++)); echo -e "  ${YELLOW}!${NC} $1"; }
section() { echo -e "\n${BLUE}━━━${NC} ${BOLD}$1${NC}"; }

# ── File existence ───────────────────────────────────────────
section "File Existence"

for f in \
  "scripts/install.sh" \
  "scripts/install-local.sh" \
  "scripts/install.ps1" \
  "apps/web/public/install.sh" \
  "apps/web/public/install-local.sh" \
  "apps/web/public/install.ps1"; do
  if [[ -f "${PROJECT_ROOT}/${f}" ]]; then
    pass "${f} exists"
  else
    fail "${f} MISSING"
  fi
done

# ── Script/public sync check ─────────────────────────────────
section "Script ↔ Public Sync"

check_sync() {
  local src="$1" dst="$2" label="$3"
  if [[ ! -f "$src" || ! -f "$dst" ]]; then
    fail "${label}: one or both files missing"
    return
  fi
  if diff -q "$src" "$dst" &>/dev/null; then
    pass "${label}: scripts/ and public/ are in sync"
  else
    fail "${label}: scripts/ and public/ differ — re-copy before pushing"
  fi
}

check_sync "${PROJECT_ROOT}/scripts/install.sh"       "${PUBLIC_DIR}/install.sh"       "install.sh"
check_sync "${PROJECT_ROOT}/scripts/install-local.sh"  "${PUBLIC_DIR}/install-local.sh"  "install-local.sh"
check_sync "${PROJECT_ROOT}/scripts/install.ps1"       "${PUBLIC_DIR}/install.ps1"       "install.ps1"

# ── Bash syntax check ────────────────────────────────────────
section "Bash Syntax Validation"

for script in "scripts/install.sh" "scripts/install-local.sh"; do
  filepath="${PROJECT_ROOT}/${script}"
  if bash -n "$filepath" 2>/dev/null; then
    pass "${script}: valid bash syntax"
  else
    fail "${script}: SYNTAX ERROR"
    bash -n "$filepath" 2>&1 | head -5 | while read -r line; do
      echo -e "    ${DIM}${line}${NC}"
    done
  fi
done

# ── PowerShell syntax check (if pwsh available) ──────────────
section "PowerShell Syntax Validation"

if command -v pwsh &>/dev/null; then
  ps1="${PROJECT_ROOT}/scripts/install.ps1"
  if pwsh -NoProfile -Command "
    \$errors = \$null
    [System.Management.Automation.Language.Parser]::ParseFile('${ps1}', [ref]\$null, [ref]\$errors)
    if (\$errors.Count -gt 0) { exit 1 } else { exit 0 }
  " 2>/dev/null; then
    pass "install.ps1: valid PowerShell syntax"
  else
    fail "install.ps1: SYNTAX ERROR"
  fi
else
  warn "install.ps1: pwsh not available — skipping syntax check"
fi

# ── Shebang check ────────────────────────────────────────────
section "Shebang Lines"

for script in "scripts/install.sh" "scripts/install-local.sh"; do
  filepath="${PROJECT_ROOT}/${script}"
  first_line=$(head -n1 "$filepath")
  if [[ "$first_line" == "#!/usr/bin/env bash" ]]; then
    pass "${script}: correct shebang (#!/usr/bin/env bash)"
  elif [[ "$first_line" == "#!/bin/bash" ]]; then
    warn "${script}: shebang is #!/bin/bash — #!/usr/bin/env bash is more portable"
  else
    fail "${script}: unexpected shebang: ${first_line}"
  fi
done

# ── set -euo pipefail ────────────────────────────────────────
section "Strict Mode (set -euo pipefail)"

for script in "scripts/install.sh" "scripts/install-local.sh"; do
  filepath="${PROJECT_ROOT}/${script}"
  if grep -q "set -euo pipefail" "$filepath"; then
    pass "${script}: strict mode enabled"
  else
    fail "${script}: missing 'set -euo pipefail'"
  fi
done

# ── Executable permissions ────────────────────────────────────
section "Executable Permissions"

for script in "scripts/install.sh" "scripts/install-local.sh"; do
  filepath="${PROJECT_ROOT}/${script}"
  if [[ -x "$filepath" ]]; then
    pass "${script}: is executable"
  else
    warn "${script}: not executable — run: chmod +x ${script}"
  fi
done

# ── Domain consistency ────────────────────────────────────────
section "Domain References (larkup.de)"

EXPECTED_DOMAIN="larkup.de"

for script in "scripts/install.sh" "scripts/install-local.sh" "scripts/install.ps1"; do
  filepath="${PROJECT_ROOT}/${script}"
  
  # Check that all URLs reference the correct domain
  if grep -qE "https://${EXPECTED_DOMAIN}/" "$filepath"; then
    pass "${script}: references ${EXPECTED_DOMAIN}"
  else
    warn "${script}: no references to ${EXPECTED_DOMAIN} found"
  fi

  # Check for any stale/wrong domains
  stale_domains=$(grep -oE 'https?://[a-zA-Z0-9.-]+\.(com|io|dev|sh|ai)/' "$filepath" \
    | grep -v "nodejs.org" \
    | grep -v "github.com" \
    | grep -v "raw.githubusercontent.com" \
    | grep -v "deb.nodesource.com" \
    | grep -v "rpm.nodesource.com" \
    | grep -v "brew.sh" \
    | grep -v "${EXPECTED_DOMAIN}" \
    | sort -u || true)
  
  if [[ -n "$stale_domains" ]]; then
    warn "${script}: references external domains that may need review:"
    echo "$stale_domains" | while read -r d; do
      echo -e "    ${DIM}${d}${NC}"
    done
  fi
done

# ── Package name consistency ──────────────────────────────────
section "Package Name Consistency"

EXPECTED_PKG="@larkup/cli"
EXPECTED_BIN="larkup"

for script in "scripts/install.sh" "scripts/install-local.sh" "scripts/install.ps1"; do
  filepath="${PROJECT_ROOT}/${script}"
  
  if grep -q "${EXPECTED_PKG}" "$filepath"; then
    pass "${script}: references ${EXPECTED_PKG}"
  else
    fail "${script}: MISSING package name ${EXPECTED_PKG}"
  fi
  
  if grep -q "BIN_NAME.*=.*[\"']${EXPECTED_BIN}[\"']" "$filepath" || \
     grep -q "BinName.*=.*[\"']${EXPECTED_BIN}[\"']" "$filepath" || \
     grep -q "BIN_NAME=\"${EXPECTED_BIN}\"" "$filepath"; then
    pass "${script}: bin name is ${EXPECTED_BIN}"
  else
    fail "${script}: bin name mismatch — expected ${EXPECTED_BIN}"
  fi
done

# ── Node.js version requirements ─────────────────────────────
section "Node.js Version Requirements"

for script in "scripts/install.sh" "scripts/install-local.sh" "scripts/install.ps1"; do
  filepath="${PROJECT_ROOT}/${script}"
  
  # Check minimum Node version is consistent (should be 18)
  if grep -qE "(MIN_NODE_MAJOR|MinNodeMajor).*=.*18" "$filepath"; then
    pass "${script}: minimum Node version = 18"
  else
    min=$(grep -oE "(MIN_NODE_MAJOR|MinNodeMajor|NODE_MAJOR).*=.*[0-9]+" "$filepath" | head -1 || echo "not found")
    warn "${script}: minimum Node check — ${min}"
  fi
done

# ── Security checks ──────────────────────────────────────────
section "Security Checks"

for script in "scripts/install.sh" "scripts/install-local.sh"; do
  filepath="${PROJECT_ROOT}/${script}"
  
  # Check TLS enforcement on curl calls
  if grep -q "\-\-proto '=https'" "$filepath" || grep -q "\-\-tlsv1.2" "$filepath"; then
    pass "${script}: enforces HTTPS/TLS1.2 on downloads"
  else
    warn "${script}: no explicit TLS enforcement found"
  fi
  
  # Check wget --https-only
  if grep -q "\-\-https-only" "$filepath"; then
    pass "${script}: wget uses --https-only"
  else
    warn "${script}: wget may not enforce HTTPS"
  fi

  # Check for dangerous patterns
  if grep -qE 'curl.*\|.*bash' "$filepath" | grep -v "^#" | grep -v "echo" 2>/dev/null; then
    warn "${script}: contains curl|bash pattern in non-comment code"
  else
    pass "${script}: no unsafe pipe-to-bash in runtime code"
  fi
done

# ── Cleanup trap ──────────────────────────────────────────────
section "Cleanup / Trap Handlers"

for script in "scripts/install.sh" "scripts/install-local.sh"; do
  filepath="${PROJECT_ROOT}/${script}"
  
  if grep -q "trap cleanup EXIT" "$filepath"; then
    pass "${script}: EXIT trap registered"
  else
    fail "${script}: missing EXIT trap for cleanup"
  fi
  
  if grep -q "trap.*INT" "$filepath"; then
    pass "${script}: INT (Ctrl+C) trap registered"
  else
    warn "${script}: no INT trap"
  fi
done

# ── Dry-run support ──────────────────────────────────────────
section "Dry-Run Support"

for script in "scripts/install.sh" "scripts/install-local.sh"; do
  filepath="${PROJECT_ROOT}/${script}"
  
  if grep -q "\-\-dry-run" "$filepath"; then
    pass "${script}: --dry-run flag supported"
  else
    fail "${script}: missing --dry-run support"
  fi
done

if grep -qi "DryRun" "${PROJECT_ROOT}/scripts/install.ps1"; then
  pass "install.ps1: -DryRun flag supported"
else
  fail "install.ps1: missing -DryRun support"
fi

# ── Dry-run smoke test (install.sh) ──────────────────────────
section "Dry-Run Smoke Test (install.sh)"

dry_run_output=$(bash "${PROJECT_ROOT}/scripts/install.sh" --dry-run --no-prompt 2>&1) || true
dry_exit=$?

if [[ $dry_exit -eq 0 ]]; then
  pass "install.sh --dry-run exits cleanly (code 0)"
else
  fail "install.sh --dry-run exited with code ${dry_exit}"
fi

if echo "$dry_run_output" | grep -qi "dry-run"; then
  pass "install.sh --dry-run prints dry-run markers"
else
  fail "install.sh --dry-run output missing dry-run markers"
fi

if echo "$dry_run_output" | grep -qi "detected"; then
  pass "install.sh --dry-run detects OS"
else
  warn "install.sh --dry-run did not print OS detection"
fi

# ── Dry-run smoke test (install-local.sh) ─────────────────────
section "Dry-Run Smoke Test (install-local.sh)"

dry_run_output2=$(bash "${PROJECT_ROOT}/scripts/install-local.sh" --dry-run --no-prompt 2>&1) || true
dry_exit2=$?

if [[ $dry_exit2 -eq 0 ]]; then
  pass "install-local.sh --dry-run exits cleanly (code 0)"
else
  fail "install-local.sh --dry-run exited with code ${dry_exit2}"
fi

if echo "$dry_run_output2" | grep -qi "dry-run"; then
  pass "install-local.sh --dry-run prints dry-run markers"
else
  fail "install-local.sh --dry-run output missing dry-run markers"
fi

if echo "$dry_run_output2" | grep -qi "no root"; then
  pass "install-local.sh --dry-run shows 'no root required' banner"
else
  warn "install-local.sh --dry-run did not show local-install banner"
fi

# ── Help flag test ────────────────────────────────────────────
section "Help Flag Test"

for script in "scripts/install.sh" "scripts/install-local.sh"; do
  filepath="${PROJECT_ROOT}/${script}"
  help_output=$(bash "$filepath" --help 2>&1) || true
  
  if echo "$help_output" | grep -qi "usage"; then
    pass "${script} --help shows usage info"
  else
    fail "${script} --help missing usage info"
  fi
  
  if echo "$help_output" | grep -q "${EXPECTED_DOMAIN}"; then
    pass "${script} --help references ${EXPECTED_DOMAIN}"
  else
    warn "${script} --help doesn't reference ${EXPECTED_DOMAIN}"
  fi
done

# ── No trailing whitespace / CRLF check ──────────────────────
section "Line Endings"

for script in "scripts/install.sh" "scripts/install-local.sh"; do
  filepath="${PROJECT_ROOT}/${script}"
  if file "$filepath" | grep -qi "CRLF"; then
    fail "${script}: has Windows CRLF line endings — will break on Linux/macOS"
  else
    pass "${script}: Unix line endings (LF)"
  fi
done

# ── Summary ──────────────────────────────────────────────────
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}Results:${NC}  ${GREEN}${PASS} passed${NC}  ${RED}${FAIL} failed${NC}  ${YELLOW}${WARN} warnings${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [[ $FAIL -gt 0 ]]; then
  echo -e "\n${RED}${BOLD}FAILED${NC} — fix the issues above before pushing.\n"
  exit 1
else
  echo -e "\n${GREEN}${BOLD}ALL GOOD${NC} — safe to push. 🚀\n"
  exit 0
fi
