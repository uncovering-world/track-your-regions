#!/usr/bin/env bash
# The dev stack's frontend has two shapes, and only one of them is the
# product: the dev server (unbundled modules, HMR, no compression) is what a
# developer edits against, the production build (`vite build` served by
# `vite preview`, compressed) is what a visitor would download and the only
# shape performance is measured on. This script switches the dev stack's
# frontend container between them and says which one is answering, so that
# nobody has to open devtools to find out.
#
#   scripts/frontend-mode.sh preview   production build on the dev stack
#   scripts/frontend-mode.sh dev       back to the dev server
#   scripts/frontend-mode.sh status    which shape is up, and whether it answers
#
# The switch is docker-compose.yml's FRONTEND_MODE (read by
# frontend/docker-entrypoint.sh); `compose up` recreates the container when
# the value changes. A preview build takes the better part of a minute
# inside the container, so `preview` waits until the built page answers.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

FRONTEND_PORT="${FRONTEND_PORT:-5173}"
URL="http://localhost:${FRONTEND_PORT}/"

container_mode() {
  local id
  id="$(docker compose ps -q frontend 2>/dev/null || true)"
  if [ -z "$id" ]; then
    echo "not running"
    return
  fi
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$id" | sed -n 's/^FRONTEND_MODE=//p'
}

# What the page itself says: Vite's dev server injects its client into every
# document, a built index.html references hashed assets. The performance
# runner (frontend/perf/lighthouse.mjs) uses the same tell to refuse the
# dev server.
served_shape() {
  local html
  html="$(curl -fsS "$URL" 2>/dev/null || true)"
  if [ -z "$html" ]; then
    echo "nothing"
  elif grep -q '/@vite/client' <<<"$html"; then
    echo "dev"
  elif grep -q '/assets/' <<<"$html"; then
    echo "preview"
  else
    echo "unknown"
  fi
}

wait_for_shape() {
  local wanted="$1"
  local i
  for ((i = 1; i <= 90; i++)); do
    if [ "$(served_shape)" = "$wanted" ]; then
      return 0
    fi
    sleep 2
  done
  echo "Timed out waiting for the frontend to serve its $wanted shape at $URL" >&2
  return 1
}

cmd_status() {
  local mode shape
  mode="$(container_mode)"
  shape="$(served_shape)"
  echo "container: FRONTEND_MODE=${mode}"
  case "$shape" in
    dev)     echo "serving:   dev server at $URL - unbundled modules, HMR; not what performance is measured on" ;;
    preview) echo "serving:   production build at $URL - hashed assets, compressed; what performance is measured on" ;;
    nothing) echo "serving:   nothing at $URL yet (a preview build takes about a minute)"; return 1 ;;
    *)       echo "serving:   a page at $URL that looks like neither shape"; return 1 ;;
  esac
}

cmd_switch() {
  local mode="$1"
  echo "Bringing the dev stack's frontend up as '$mode'"
  FRONTEND_MODE="$mode" docker compose up -d --build frontend
  wait_for_shape "$mode"
  cmd_status
}

case "${1:-status}" in
  preview) cmd_switch preview ;;
  dev) cmd_switch dev ;;
  status) cmd_status ;;
  *)
    echo "Usage: scripts/frontend-mode.sh preview|dev|status" >&2
    exit 1
    ;;
esac
