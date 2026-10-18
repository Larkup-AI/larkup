#!/bin/sh
set -eu

# The managed RunPod container is already an isolated single-job sandbox and
# runs as root for GPU device access. Chrome's setuid sandbox cannot initialize
# in that environment, so keep the browser inside the container namespace.
exec /opt/chrome/chrome --no-sandbox --disable-dev-shm-usage "$@"
