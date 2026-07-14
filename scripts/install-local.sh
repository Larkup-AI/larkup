#!/usr/bin/env bash
set -euo pipefail

# Larkup — Local Installer (macOS / Linux / WSL)
# Self-contained under ~/.larkup — no root, no system packages touched.
# Usage: curl -fsSL https://larkup.de/install-local.sh | bash

# ── Config ────────────────────────────────────────────────────
PACKAGE_NAME="@larkup/cli"
BIN_NAME="larkup"
NODE_MAJOR=20
NODE_VERSION="v20.18.0"  # pinned portable Node version
LARKUP_PREFIX="${HOME}/.larkup"

# ── Flags ─────────────────────────────────────────────────────
DRY_RUN=0
NO_PROMPT=0
VERBOSE=0
VERSION="latest"

# ── State ─────────────────────────────────────────────────────
DETECTED_OS=""
DETECTED_ARCH=""
TMPFILES=()

# ── Colors (auto-disabled outside TTY) ────────────────────────
if [[ -t 1 ]]; then
  BOLD='\033[1m' DIM='\033[2m' NC='\033[0m'
  GREEN='\033[0;32m' YELLOW='\033[1;33m' BLUE='\033[0;34m' RED='\033[0;31m' BLACK='\033[0;30m'
else
  BOLD='' DIM='' NC='' GREEN='' YELLOW='' BLUE='' RED='' BLACK=''
fi

# ── Logging ───────────────────────────────────────────────────
log_info()    { echo -e "${BLUE}==> ${NC}${1}"; }
log_success() { echo -e "${GREEN} ✓  ${NC}${1}"; }
log_warn()    { echo -e "${YELLOW} !  ${NC}${1}"; }
log_error()   { echo -e "${RED} ✗  ${NC}${1}" >&2; }
log_debug()   { [[ "$VERBOSE" == "1" ]] && echo -e "${DIM}[debug] ${1}${NC}" || true; }
log_dry()     { echo -e "${YELLOW}[dry-run]${NC} ${1}"; }

# ── Temp files + cleanup ─────────────────────────────────────
new_tmp_file() {
  local f
  f="$(mktemp 2>/dev/null || mktemp -t 'larkup-tmp')"
  TMPFILES+=("$f")
  echo "$f"
}

new_tmp_dir() {
  local d
  d="$(mktemp -d 2>/dev/null || mktemp -d -t 'larkup-local')"
  TMPFILES+=("$d")
  echo "$d"
}

cleanup() {
  local exit_code=$?
  for f in "${TMPFILES[@]:-}"; do
    rm -rf "$f" 2>/dev/null || true
  done
  if [[ $exit_code -ne 0 && $exit_code -ne 130 ]]; then
    echo ""
    log_error "Installation failed (exit code ${exit_code})."
    log_error "Re-run with --verbose for details, or open an issue:"
    log_error "  https://github.com/Larkup-AI/larkup/issues"
  fi
}
trap cleanup EXIT
trap 'echo ""; log_warn "Installation interrupted."; exit 130' INT
trap 'echo ""; log_warn "Installation terminated."; exit 143' TERM

# ── Secure download ──────────────────────────────────────────
HTTP_CLIENT=""

find_http_client() {
  if command -v curl &>/dev/null; then
    HTTP_CLIENT="curl"; return 0
  fi
  if command -v wget &>/dev/null; then
    HTTP_CLIENT="wget"; return 0
  fi
  log_error "Neither curl nor wget found. Install one and retry."
  exit 1
}

fetch_to_file() {
  local url="$1" output="$2"
  [[ -z "$HTTP_CLIENT" ]] && find_http_client
  if [[ "$HTTP_CLIENT" == "curl" ]]; then
    curl --proto '=https' --tlsv1.2 -fsSL --retry 3 --retry-delay 1 -o "$output" "$url"
  else
    wget -q --https-only --tries=3 --timeout=20 -O "$output" "$url"
  fi
}

# ── Stdin isolation ──────────────────────────────────────────
read_tty_input() {
  if [[ -t 0 ]]; then cat
  elif [[ -r /dev/tty ]]; then cat </dev/tty
  else echo ""
  fi
}

confirm() {
  local message="${1:-Continue?}"
  if [[ "$DRY_RUN" == "1" || "$NO_PROMPT" == "1" ]]; then
    log_debug "Auto-confirmed: ${message}"
    return 0
  fi
  if [[ ! -t 0 ]] && [[ ! -r /dev/tty ]]; then
    log_debug "No terminal available, auto-confirming: ${message}"
    return 0
  fi
  echo -n -e "${YELLOW}?${NC} ${message} (y/N) "
  local reply
  reply=$(read_tty_input | head -c1)
  [[ "$reply" =~ ^[Yy]$ ]]
}

# ── Help ──────────────────────────────────────────────────────
show_help() {
  cat <<EOF
${BOLD}Larkup — Local Installer (no root required)${NC}

Installs a self-contained Larkup setup under a single directory.
No system packages are touched. Node.js is bundled automatically.

Usage:
  curl -fsSL https://larkup.de/install-local.sh | bash
  curl -fsSL https://larkup.de/install-local.sh | bash -s -- [OPTIONS]

Options:
  --prefix <path>   Install directory (default: ~/.larkup)
  --version <ver>   Install a specific CLI version (default: latest)
  --no-prompt       Skip interactive prompts (CI-friendly)
  --dry-run         Show what would happen without making changes
  --verbose         Enable debug output
  --help            Show this help message

Examples:
  # Default install to ~/.larkup
  curl -fsSL https://larkup.de/install-local.sh | bash

  # Custom prefix
  curl -fsSL https://larkup.de/install-local.sh | bash -s -- --prefix ~/tools/larkup

  # Dry run
  curl -fsSL https://larkup.de/install-local.sh | bash -s -- --dry-run
EOF
}

# ── Arg parsing ───────────────────────────────────────────────
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --prefix)
        [[ -z "${2:-}" || "${2:-}" == --* ]] && { log_error "--prefix requires a value"; exit 1; }
        LARKUP_PREFIX="$2"; shift 2 ;;
      --version)
        [[ -z "${2:-}" || "${2:-}" == --* ]] && { log_error "--version requires a value"; exit 1; }
        VERSION="$2"; shift 2 ;;
      --no-prompt) NO_PROMPT=1; shift ;;
      --dry-run)   DRY_RUN=1; shift ;;
      --verbose)   VERBOSE=1; shift ;;
      --help|-h)   show_help; exit 0 ;;
      *) log_error "Unknown option: $1"; show_help; exit 1 ;;
    esac
  done

  # Expand ~ in prefix
  LARKUP_PREFIX="${LARKUP_PREFIX/#\~/$HOME}"
}

# ── OS detection ──────────────────────────────────────────────
identify_system() {
  local uname_s uname_m
  uname_s="$(uname -s)"
  uname_m="$(uname -m)"

  case "$uname_s" in
    Darwin) DETECTED_OS="darwin" ;;
    Linux)
      if grep -qiE "microsoft|wsl" /proc/version 2>/dev/null; then
        DETECTED_OS="linux"  # WSL uses Linux binaries
      else
        DETECTED_OS="linux"
      fi ;;
    MINGW*|MSYS*|CYGWIN*)
      log_error "Windows detected. Use the PowerShell installer instead:"
      log_error "  iwr -useb https://larkup.de/install.ps1 | iex"
      exit 1 ;;
    *) log_error "Unsupported OS: ${uname_s}"; exit 1 ;;
  esac

  case "$uname_m" in
    x86_64|amd64)  DETECTED_ARCH="x64" ;;
    arm64|aarch64) DETECTED_ARCH="arm64" ;;
    armv7l)        DETECTED_ARCH="armv7l" ;;
    *)             log_error "Unsupported architecture: ${uname_m}"; exit 1 ;;
  esac

  log_success "Detected: ${BOLD}${DETECTED_OS}${NC} (${DETECTED_ARCH})"
}

# ── Directory layout ─────────────────────────────────────────
# ~/.larkup/
#   bin/larkup        ← wrapper script (added to PATH)
#   node/             ← portable Node.js
#   lib/              ← npm global install prefix
#   lib/node_modules/ ← @larkup/cli lives here

LARKUP_BIN=""
LARKUP_NODE_DIR=""
LARKUP_LIB=""
LARKUP_NODE_BIN=""
LARKUP_NPM_BIN=""

layout_dirs() {
  LARKUP_BIN="${LARKUP_PREFIX}/bin"
  LARKUP_NODE_DIR="${LARKUP_PREFIX}/node"
  LARKUP_LIB="${LARKUP_PREFIX}/lib"
  LARKUP_NODE_BIN="${LARKUP_NODE_DIR}/bin/node"
  LARKUP_NPM_BIN="${LARKUP_NODE_DIR}/bin/npm"

  log_debug "Prefix:   ${LARKUP_PREFIX}"
  log_debug "Bin:      ${LARKUP_BIN}"
  log_debug "Node dir: ${LARKUP_NODE_DIR}"
  log_debug "Lib:      ${LARKUP_LIB}"
}

scaffold_dirs() {
  if [[ "$DRY_RUN" == "1" ]]; then
    log_dry "Would create directory structure at ${LARKUP_PREFIX}"
    return 0
  fi
  mkdir -p "${LARKUP_BIN}" "${LARKUP_NODE_DIR}" "${LARKUP_LIB}"
  log_success "Directory structure ready at ${LARKUP_PREFIX}"
}

# ── Download portable Node.js ─────────────────────────────────
# Downloads an official Node.js binary tarball and extracts it
# into the prefix. No system Node is required or touched.
provision_node() {
  # Already have a working Node in the prefix?
  if [[ -x "$LARKUP_NODE_BIN" ]]; then
    local existing_ver
    existing_ver="$("$LARKUP_NODE_BIN" -v 2>/dev/null || echo "")"
    if [[ -n "$existing_ver" ]]; then
      log_success "Local Node.js ${existing_ver} already present"
      return 0
    fi
  fi

  log_info "Downloading portable Node.js ${NODE_VERSION}..."

  # Build download URL (official Node.js prebuilts)
  local node_os node_arch tarball_name url
  node_os="${DETECTED_OS}"
  node_arch="${DETECTED_ARCH}"

  # Node uses "x64" and "arm64" but darwin/linux naming
  tarball_name="node-${NODE_VERSION}-${node_os}-${node_arch}.tar.gz"
  url="https://nodejs.org/dist/${NODE_VERSION}/${tarball_name}"

  if [[ "$DRY_RUN" == "1" ]]; then
    log_dry "Would download: ${url}"
    log_dry "Would extract to: ${LARKUP_NODE_DIR}"
    return 0
  fi

  local tmp_tarball
  tmp_tarball="$(new_tmp_file)"

  log_debug "Downloading ${url}"
  fetch_to_file "$url" "$tmp_tarball"

  # Extract, stripping the top-level directory
  log_info "Extracting Node.js..."
  rm -rf "${LARKUP_NODE_DIR}"
  mkdir -p "${LARKUP_NODE_DIR}"
  tar -xzf "$tmp_tarball" -C "${LARKUP_NODE_DIR}" --strip-components=1

  # Verify
  if [[ ! -x "$LARKUP_NODE_BIN" ]]; then
    log_error "Node.js extraction failed — ${LARKUP_NODE_BIN} not found."
    exit 1
  fi

  local installed_ver
  installed_ver="$("$LARKUP_NODE_BIN" -v)"
  log_success "Portable Node.js ${installed_ver} ready"
}

# ── Install the CLI into the local prefix ─────────────────────
install_cli() {
  local spec="${PACKAGE_NAME}@${VERSION}"
  log_info "Installing ${BOLD}${spec}${NC} into ${LARKUP_LIB}..."

  if [[ "$DRY_RUN" == "1" ]]; then
    log_dry "Would run: npm install -g --prefix ${LARKUP_LIB} ${spec}"
    return 0
  fi

  local install_log
  install_log="$(new_tmp_file)"

  # Use the local Node + npm, install into our lib prefix
  if "${LARKUP_NPM_BIN}" install -g \
      --prefix "${LARKUP_LIB}" \
      --no-fund --no-audit \
      "$spec" >"$install_log" 2>&1; then
    log_success "CLI installed"
    return 0
  fi

  # Failed — show diagnostics
  log_error "npm install failed."
  if [[ -s "$install_log" ]]; then
    log_warn "Last lines:"
    tail -n 20 "$install_log" >&2
  fi
  log_error "Re-run with --verbose for full output."
  exit 1
}

# ── Create wrapper script ─────────────────────────────────────
# A small shell script at ~/.larkup/bin/larkup that uses the
# bundled Node.js to run the CLI. This is what the user calls.
create_wrapper() {
  local wrapper_path="${LARKUP_BIN}/${BIN_NAME}"
  local cli_entry="${LARKUP_LIB}/lib/node_modules/${PACKAGE_NAME}/bin/cli.js"

  log_info "Creating wrapper at ${wrapper_path}..."

  if [[ "$DRY_RUN" == "1" ]]; then
    log_dry "Would create wrapper script at ${wrapper_path}"
    return 0
  fi

  cat > "$wrapper_path" <<WRAPPER
#!/usr/bin/env bash
# Auto-generated by Larkup local installer — do not edit
# Uses the bundled Node.js to run the Larkup CLI
LARKUP_ROOT="${LARKUP_PREFIX}"
NODE_BIN="\${LARKUP_ROOT}/node/bin/node"
CLI_ENTRY="\${LARKUP_ROOT}/lib/lib/node_modules/${PACKAGE_NAME}/bin/cli.js"

# Fallback: if cli.js doesn't exist at the expected path, try to find it
if [[ ! -f "\${CLI_ENTRY}" ]]; then
  # npm might use a different structure depending on version
  for candidate in \\
    "\${LARKUP_ROOT}/lib/node_modules/${PACKAGE_NAME}/bin/cli.js" \\
    "\${LARKUP_ROOT}/lib/lib/node_modules/${PACKAGE_NAME}/dist/cli.js" \\
    "\${LARKUP_ROOT}/lib/node_modules/${PACKAGE_NAME}/dist/cli.js"; do
    if [[ -f "\${candidate}" ]]; then
      CLI_ENTRY="\${candidate}"
      break
    fi
  done
fi

if [[ ! -f "\${CLI_ENTRY}" ]]; then
  echo "error: Larkup CLI entry point not found." >&2
  echo "Try re-running the installer: curl -fsSL https://larkup.de/install-local.sh | bash" >&2
  exit 1
fi

exec "\${NODE_BIN}" "\${CLI_ENTRY}" "\$@"
WRAPPER

  chmod +x "$wrapper_path"
  log_success "Wrapper created"
}

# ── PATH management ──────────────────────────────────────────
persist_path_entry() {
  local dir="$1"

  if echo ":${PATH}:" | grep -q ":${dir}:"; then
    log_debug "${dir} already on PATH"
    return 0
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    log_dry "Would add ${dir} to PATH in shell profile"
    return 0
  fi

  local shell_name profile export_line
  shell_name="$(basename "${SHELL:-/bin/bash}")"

  case "$shell_name" in
    zsh)  profile="${HOME}/.zshrc" ;;
    bash)
      if [[ "$DETECTED_OS" == "darwin" ]]; then
        profile="${HOME}/.bash_profile"
      else
        profile="${HOME}/.bashrc"
      fi ;;
    fish) profile="${HOME}/.config/fish/config.fish" ;;
    *)    profile="${HOME}/.profile" ;;
  esac

  if [[ "$shell_name" == "fish" ]]; then
    export_line="set -gx PATH ${dir} \$PATH"
  else
    export_line="export PATH=\"${dir}:\$PATH\""
  fi

  if [[ -f "$profile" ]] && grep -qF "$dir" "$profile" 2>/dev/null; then
    log_debug "PATH entry already in ${profile}"
  else
    { echo ""; echo "# Added by Larkup local installer"; echo "$export_line"; } >> "$profile"
    log_success "Updated PATH in ${profile}"
  fi

  export PATH="${dir}:${PATH}"
}

# ── Post-install verification ─────────────────────────────────
verify_setup() {
  if [[ "$DRY_RUN" == "1" ]]; then
    log_dry "Would verify '${BIN_NAME}' is reachable"
    return 0
  fi

  hash -r 2>/dev/null || true

  if command -v "$BIN_NAME" &>/dev/null; then
    local ver
    ver="$($BIN_NAME --version 2>/dev/null || echo "")"
    log_success "${BIN_NAME} is on PATH ${DIM}(${ver})${NC}"
    return 0
  fi

  log_warn "'${BIN_NAME}' not yet on PATH in this session."
  log_info "Restart your terminal, or run now:"
  echo -e "  ${GREEN}export PATH=\"${LARKUP_BIN}:\$PATH\"${NC}"
}

# ── Banner ────────────────────────────────────────────────────
show_banner() {
  echo -e "${BLACK}"
  cat <<'BANNER'
   __               __
  / /   ____ ______/ /____  ______
 / /   / __ `/ ___/ //_/ / / / __ \
/ /___/ /_/ / /  / ,< / /_/ / /_/ /
\____/\__,_/_/  /_/|_|\__,_/ .___/
                          /_/
BANNER
  echo -e "${NC}"
  echo -e "  ${DIM}Local installer — no root required${NC}"
  echo ""
}

# ── Post-install summary ─────────────────────────────────────
show_summary() {
  echo ""
  echo -e "${BOLD}Installed to:${NC} ${LARKUP_PREFIX}"
  echo -e "  ${DIM}Node.js:${NC}  ${LARKUP_NODE_DIR}"
  echo -e "  ${DIM}CLI:${NC}      ${LARKUP_LIB}"
  echo -e "  ${DIM}Wrapper:${NC}  ${LARKUP_BIN}/${BIN_NAME}"
  echo ""
  echo -e "${BOLD}Get started:${NC}"
  echo -e "  ${GREEN}${BIN_NAME} init my-rag-server${NC}"
  echo -e "  ${GREEN}cd my-rag-server${NC}"
  echo -e "  ${GREEN}${BIN_NAME} dev${NC}"
  echo ""
  echo -e "  ${DIM}Docs:   https://larkup.de/docs${NC}"
  echo -e "  ${DIM}Issues: https://github.com/Larkup-AI/larkup/issues${NC}"
  echo ""
  echo -e "  ${DIM}To uninstall: rm -rf ${LARKUP_PREFIX}${NC}"
  echo ""
}

# ── Main ──────────────────────────────────────────────────────
main() {
  parse_args "$@"
  [[ "$VERBOSE" == "1" ]] && set -x

  show_banner

  if [[ "$DRY_RUN" == "1" ]]; then
    log_info "Running in ${BOLD}dry-run${NC} mode — no changes will be made."
    echo ""
  fi

  identify_system
  layout_dirs
  scaffold_dirs
  provision_node
  install_cli
  create_wrapper
  persist_path_entry "${LARKUP_BIN}"
  verify_setup
  show_summary

  log_success "Done! 🚀"
}

main "$@"
