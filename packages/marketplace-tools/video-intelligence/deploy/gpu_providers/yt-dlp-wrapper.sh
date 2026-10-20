#!/bin/sh
set -eu

browser_home="${TMPDIR:-/tmp}/larkup-chromium-home"
mkdir -p "$browser_home"
export HOME="$browser_home"
export XDG_CACHE_HOME="$browser_home/cache"
export XDG_CONFIG_HOME="$browser_home/config"

display_number=99
xvfb_log="${TMPDIR:-/tmp}/larkup-xvfb.log"
Xvfb ":$display_number" -screen 0 1280x1024x24 -nolisten tcp >"$xvfb_log" 2>&1 &
xvfb_pid=$!
cleanup() {
  kill "$xvfb_pid" 2>/dev/null || true
  wait "$xvfb_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

attempt=0
while [ "$attempt" -lt 20 ] && [ ! -S "/tmp/.X11-unix/X$display_number" ]; do
  if ! kill -0 "$xvfb_pid" 2>/dev/null; then
    cat "$xvfb_log" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ ! -S "/tmp/.X11-unix/X$display_number" ]; then
  cat "$xvfb_log" >&2
  exit 1
fi
export DISPLAY=":$display_number"

proxy_server="${SCRAPER_PROXY_SERVER:-}"
proxy_username="${SCRAPER_PROXY_USERNAME:-}"
proxy_password="${SCRAPER_PROXY_PASSWORD:-}"
if [ -n "$proxy_server$proxy_username$proxy_password" ]; then
  if [ -z "$proxy_server" ] || [ -z "$proxy_username" ] || [ -z "$proxy_password" ]; then
    echo "Incomplete managed video proxy configuration" >&2
    exit 1
  fi
  case "$proxy_server" in
    http://*|https://*) ;;
    *) proxy_server="http://$proxy_server" ;;
  esac
  proxy_scheme="${proxy_server%%://*}"
  proxy_address="${proxy_server#*://}"
  proxy_address="${proxy_address%/}"
  set -- --proxy "$proxy_scheme://$proxy_username:$proxy_password@$proxy_address" "$@"
fi

/usr/local/bin/yt-dlp-python \
  --js-runtimes node:/opt/node/bin/node \
  --extractor-args 'youtube:player_client=mweb,web_safari,web_embedded' \
  --extractor-args 'youtubepot-wpc:browser_path=/usr/local/bin/larkup-chrome' \
  "$@"
