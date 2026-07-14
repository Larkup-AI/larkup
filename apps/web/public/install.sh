#!/usr/bin/env bash
set -euo pipefail

# Larkup — Global Installer (macOS / Linux / WSL)
# Usage: curl -fsSL https://larkup.de/install.sh | bash

# ── Config ────────────────────────────────────────────────────
PACKAGE_NAME="@larkup/cli"
BIN_NAME="larkup"
MIN_NODE_MAJOR=18
NODEJS_SETUP_MAJOR=20

# ── Flags ─────────────────────────────────────────────────────
DRY_RUN=0
NO_PROMPT=0
VERBOSE=0
VERSION="latest"

# ── State ─────────────────────────────────────────────────────
DETECTED_OS=""
DETECTED_ARCH=""
NPM_GLOBAL_BIN=""
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

# ── Temp file tracking + cleanup ──────────────────────────────
new_tmp_file() {
  local f
  f="$(mktemp 2>/dev/null || mktemp -t 'larkup-tmp')"
  TMPFILES+=("$f")
  echo "$f"
}

new_tmp_dir() {
  local d
  d="$(mktemp -d 2>/dev/null || mktemp -d -t 'larkup-install')"
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

# ── Secure download (supports curl + wget, never pipes to bash) ─
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

# ── Stdin isolation for piped installs ────────────────────────
# When run via `curl | bash`, stdin is the pipe, not the terminal.
# We redirect interactive reads to /dev/tty when available.
read_tty_input() {
  if [[ -t 0 ]]; then
    cat  # stdin is already the terminal
  elif [[ -r /dev/tty ]]; then
    cat </dev/tty
  else
    echo ""  # no terminal available
  fi
}

confirm() {
  local message="${1:-Continue?}"
  if [[ "$DRY_RUN" == "1" || "$NO_PROMPT" == "1" ]]; then
    log_debug "Auto-confirmed: ${message}"
    return 0
  fi
  # In a piped install, try /dev/tty for interactive input
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
${BOLD}Larkup — Global Installer${NC}

Usage:
  curl -fsSL https://larkup.de/install.sh | bash
  curl -fsSL https://larkup.de/install.sh | bash -s -- [OPTIONS]

Options:
  --version <ver>   Install a specific version (default: latest)
  --no-prompt       Skip interactive prompts (CI-friendly)
  --dry-run         Show what would happen without making changes
  --verbose         Enable debug output
  --help            Show this help message

Examples:
  curl -fsSL https://larkup.de/install.sh | bash -s -- --version 1.2.0 --no-prompt
  curl -fsSL https://larkup.de/install.sh | bash -s -- --dry-run --verbose
EOF
}

# ── Arg parsing ───────────────────────────────────────────────
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
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
}

# ── OS detection ──────────────────────────────────────────────
identify_system() {
  local uname_s uname_m
  uname_s="$(uname -s)"
  uname_m="$(uname -m)"

  case "$uname_s" in
    Darwin) DETECTED_OS="macos" ;;
    Linux)
      if grep -qiE "microsoft|wsl" /proc/version 2>/dev/null; then
        DETECTED_OS="wsl"
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
    *)             DETECTED_ARCH="$uname_m" ;;
  esac

  log_success "Detected: ${BOLD}${DETECTED_OS}${NC} (${DETECTED_ARCH})"
  [[ "$DETECTED_OS" == "wsl" ]] && log_info "Running inside WSL — using Linux install path"
}

# ── Node.js version check ────────────────────────────────────
# Parses node -v into major.minor.patch components
get_node_semver() {
  local ver major minor patch
  ver="$(node -v 2>/dev/null | sed 's/^v//')" || return 1
  major="${ver%%.*}"
  minor="${ver#*.}"; minor="${minor%%.*}"
  patch="${ver##*.}"
  # Validate all components are numeric
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ && "$patch" =~ ^[0-9]+$ ]] || return 1
  echo "${major} ${minor} ${patch}"
}

check_node() {
  log_info "Checking for Node.js (>= v${MIN_NODE_MAJOR})..."

  if command -v node &>/dev/null; then
    local components major
    if components="$(get_node_semver)"; then
      read -r major _ _ <<< "$components"
      local node_ver
      node_ver="$(node -v)"

      if [[ "$major" -ge "$MIN_NODE_MAJOR" ]]; then
        log_success "Found Node.js ${node_ver} ${DIM}(meets v${MIN_NODE_MAJOR}+ requirement)${NC}"
        return 0
      fi
      log_warn "Found Node.js ${node_ver}, but Larkup requires v${MIN_NODE_MAJOR}+."
    else
      log_warn "Could not parse Node.js version."
    fi
  else
    log_warn "Node.js is not installed."
  fi

  if confirm "Install Node.js v${NODEJS_SETUP_MAJOR}.x automatically?"; then
    install_node
  else
    log_error "Node.js v${MIN_NODE_MAJOR}+ is required. Install: https://nodejs.org/"
    exit 1
  fi
}

# ── Node.js installation ─────────────────────────────────────
has_root_access() { [[ "$(id -u)" == "0" ]]; }

elevate() {
  if has_root_access; then "$@"; else sudo "$@"; fi
}

install_node() {
  log_info "Installing Node.js v${NODEJS_SETUP_MAJOR}.x..."

  if [[ "$DRY_RUN" == "1" ]]; then
    log_dry "Would install Node.js v${NODEJS_SETUP_MAJOR}.x via system package manager"
    return 0
  fi

  if [[ "$DETECTED_OS" == "macos" ]]; then
    if command -v brew &>/dev/null; then
      log_info "Installing via Homebrew..."
      brew install "node@${NODEJS_SETUP_MAJOR}"
      brew link --overwrite "node@${NODEJS_SETUP_MAJOR}" 2>/dev/null || true
    else
      log_error "Homebrew not found. Install Node.js manually: https://nodejs.org/"
      log_error "Or install Homebrew first: https://brew.sh"
      exit 1
    fi

  elif [[ "$DETECTED_OS" == "linux" || "$DETECTED_OS" == "wsl" ]]; then
    local setup_script
    setup_script="$(new_tmp_file)"

    if command -v apt-get &>/dev/null; then
      log_info "Installing via apt (NodeSource)..."
      fetch_to_file "https://deb.nodesource.com/setup_${NODEJS_SETUP_MAJOR}.x" "$setup_script"
      elevate bash "$setup_script"
      elevate apt-get install -y nodejs
    elif command -v dnf &>/dev/null; then
      log_info "Installing via dnf (NodeSource)..."
      fetch_to_file "https://rpm.nodesource.com/setup_${NODEJS_SETUP_MAJOR}.x" "$setup_script"
      elevate bash "$setup_script"
      elevate dnf install -y nodejs
    elif command -v yum &>/dev/null; then
      log_info "Installing via yum (NodeSource)..."
      fetch_to_file "https://rpm.nodesource.com/setup_${NODEJS_SETUP_MAJOR}.x" "$setup_script"
      elevate bash "$setup_script"
      elevate yum install -y nodejs
    elif command -v pacman &>/dev/null; then
      log_info "Installing via pacman..."
      elevate pacman -Sy --noconfirm nodejs npm
    elif command -v apk &>/dev/null; then
      log_info "Installing via apk..."
      elevate apk add --no-cache nodejs npm
    else
      log_error "No supported package manager found (apt, dnf, yum, pacman, apk)."
      log_error "Install Node.js v${MIN_NODE_MAJOR}+ manually: https://nodejs.org/"
      exit 1
    fi
  fi

  # Verify
  if ! command -v node &>/dev/null; then
    log_error "Node.js installation completed but 'node' not found in PATH."
    log_error "Restart your shell and retry."
    exit 1
  fi
  log_success "Node.js $(node -v) installed"
}

# ── npm prefix setup (avoids sudo npm install -g) ─────────────
# Running `sudo npm install -g` creates root-owned files in npm's
# cache that break future installs. Instead, redirect npm's global
# prefix to a user-writable directory.
resolve_npm_bin() {
  local prefix
  prefix="$(npm config get prefix 2>/dev/null || echo "")"
  [[ -n "$prefix" ]] && echo "${prefix}/bin"
}

configure_npm_globals() {
  local current_bin
  current_bin="$(resolve_npm_bin)"
  log_debug "Current npm global bin: ${current_bin:-<unknown>}"

  # Already writable? Use as-is.
  if [[ -n "$current_bin" ]] && [[ -w "$current_bin" ]] 2>/dev/null; then
    NPM_GLOBAL_BIN="$current_bin"
    log_debug "npm global bin is writable"
    return 0
  fi

  # Redirect to user-owned ~/.npm-global
  local new_prefix="${HOME}/.npm-global"
  log_warn "npm global directory not writable (${current_bin:-unknown})."
  log_info "Redirecting npm prefix to ${new_prefix} (no sudo needed)."

  if [[ "$DRY_RUN" == "1" ]]; then
    log_dry "Would run: npm config set prefix ${new_prefix}"
    NPM_GLOBAL_BIN="${new_prefix}/bin"
    return 0
  fi

  mkdir -p "${new_prefix}"
  npm config set prefix "${new_prefix}"
  NPM_GLOBAL_BIN="${new_prefix}/bin"
  log_success "npm prefix → ${new_prefix}"

  persist_path_entry "${NPM_GLOBAL_BIN}"
}

# ── PATH management ──────────────────────────────────────────
# Writes an export line to the user's shell profile and updates
# the current session. Handles zsh, bash, fish, and generic sh.
persist_path_entry() {
  local dir="$1"

  # Already on PATH?
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
      if [[ "$DETECTED_OS" == "macos" ]]; then
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

  # Don't duplicate
  if [[ -f "$profile" ]] && grep -qF "$dir" "$profile" 2>/dev/null; then
    log_debug "PATH entry already in ${profile}"
  else
    { echo ""; echo "# Added by Larkup installer"; echo "$export_line"; } >> "$profile"
    log_success "Updated PATH in ${profile}"
  fi

  export PATH="${dir}:${PATH}"
}

# ── Existing install detection ────────────────────────────────
detect_prior_install() {
  if ! command -v "$BIN_NAME" &>/dev/null; then
    return 1
  fi
  local existing_ver
  existing_ver="$($BIN_NAME --version 2>/dev/null || echo "unknown")"
  if [[ "$VERSION" == "latest" ]]; then
    log_info "Larkup ${existing_ver} found — upgrading to latest..."
  else
    log_info "Larkup ${existing_ver} found — installing v${VERSION}..."
  fi
  return 0
}

# ── Install Larkup ───────────────────────────────────────────
install_larkup() {
  local spec="${PACKAGE_NAME}@${VERSION}"

  local is_upgrade=0
  detect_prior_install && is_upgrade=1

  configure_npm_globals

  log_info "Installing ${BOLD}${spec}${NC}..."

  if [[ "$DRY_RUN" == "1" ]]; then
    log_dry "Would run: npm install -g ${spec}"
    return 0
  fi

  # Capture output to a log for diagnostics on failure
  local install_log
  install_log="$(new_tmp_file)"

  if npm install -g --no-fund --no-audit "$spec" >"$install_log" 2>&1; then
    [[ "$is_upgrade" == "1" ]] && log_success "Larkup upgraded!" || log_success "Larkup installed!"
    return 0
  fi

  # Installation failed — show diagnostics
  log_error "npm install -g failed."
  if [[ -s "$install_log" ]]; then
    echo ""
    log_warn "Last lines of npm output:"
    tail -n 20 "$install_log" >&2
    echo ""
  fi

  # Extract npm debug log path if available
  local debug_log
  debug_log="$(sed -n -E 's/.*A complete log of this run can be found in:[[:space:]]*//p' "$install_log" | tail -n1 || true)"
  [[ -n "$debug_log" ]] && log_info "npm debug log: ${debug_log}"

  log_error "Re-run with --verbose for full output."
  exit 1
}

# ── Post-install verification ─────────────────────────────────
# The #1 real-world failure: npm install succeeds but the binary
# isn't on PATH. Detect this and give actionable guidance.
verify_install() {
  if [[ "$DRY_RUN" == "1" ]]; then
    log_dry "Would verify '${BIN_NAME}' is reachable on PATH"
    return 0
  fi

  hash -r 2>/dev/null || true  # flush shell command cache

  if command -v "$BIN_NAME" &>/dev/null; then
    local ver
    ver="$($BIN_NAME --version 2>/dev/null || echo "")"
    log_success "${BIN_NAME} is on PATH ${DIM}(${ver})${NC}"
    return 0
  fi

  # Not found — diagnose
  echo ""
  log_warn "'${BIN_NAME}' installed but not found on PATH."

  local bin_dir="${NPM_GLOBAL_BIN}"
  if [[ -z "$bin_dir" ]]; then
    bin_dir="$(resolve_npm_bin 2>/dev/null || echo "")"
  fi

  if [[ -n "$bin_dir" && -f "${bin_dir}/${BIN_NAME}" ]]; then
    log_info "Binary exists at: ${bin_dir}/${BIN_NAME}"
    log_info "Fix: restart your terminal, or run now:"
    echo -e "  ${GREEN}export PATH=\"${bin_dir}:\$PATH\"${NC}"

    # Attempt to persist the fix
    persist_path_entry "$bin_dir"
  else
    log_warn "Could not locate the installed binary."
    log_info "Check: npm config get prefix"
    log_info "The binary should be in \$(npm config get prefix)/bin/"
  fi
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
}

# ── Post-install next steps ───────────────────────────────────
show_next_steps() {
  echo ""
  echo -e "${BOLD}Get started:${NC}"
  echo -e "  ${GREEN}larkup init my-rag-server${NC}"
  echo -e "  ${GREEN}cd my-rag-server${NC}"
  echo -e "  ${GREEN}larkup dev${NC}"
  echo ""
  echo -e "  ${DIM}Docs:   https://larkup.de/docs${NC}"
  echo -e "  ${DIM}Issues: https://github.com/Larkup-AI/larkup/issues${NC}"
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
  check_node
  install_larkup
  verify_install
  show_next_steps
  log_success "Done! 🚀"
}

main "$@"
