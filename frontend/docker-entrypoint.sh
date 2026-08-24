#!/bin/sh
# The frontend container's two shapes, chosen by FRONTEND_MODE:
#
#   dev      (default) Vite's dev server: unbundled modules, HMR, the shape a
#            developer works against and the Playwright smoke lane browses.
#   preview  A production build served by `vite preview`: one minified,
#            hashed bundle, sent compressed (see `preview` in vite.config.ts).
#            The performance lane measures this shape and nothing else — a
#            Lighthouse run against the dev server would budget a few
#            hundred unminified module requests no visitor ever makes.
#
# VITE_API_URL / VITE_MARTIN_URL are read at build time, so the bundle the
# preview serves carries whatever the container's environment says — the
# test stack's in-network hostnames when scripts/test-stack.sh starts it.
set -eu

case "${FRONTEND_MODE:-dev}" in
  dev)
    exec npm run dev -- --host
    ;;
  preview)
    npm run build
    exec npm run preview -- --host --port 5173
    ;;
  *)
    echo "FRONTEND_MODE must be 'dev' or 'preview', got '${FRONTEND_MODE}'" >&2
    exit 1
    ;;
esac
