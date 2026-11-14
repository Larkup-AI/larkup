#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")"
case "${1:-}" in
  resume|install|connect|launch|backup|stop|account|status|dashboard) exec python3 -m harness.remote "$@" ;;
  *) exec python3 -m harness.remote launch "$@" ;;
esac
