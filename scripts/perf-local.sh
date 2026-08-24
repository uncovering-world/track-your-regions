#!/usr/bin/env bash
# The local performance run: everything this machine can measure on its own
# data, in one command, before a push that touches what the browser loads
# or draws. Three parts, in the order they fail fastest:
#
#   1. the bundle-size budget (`npm run perf:size`);
#   2. Lighthouse against the dev stack's frontend in its production shape,
#      on the pages of the world view this database exposes - real regions,
#      real tiles, the real catalogue behind them - judged against
#      frontend/perf/lighthouse-budgets.local.json;
#   3. the latency probe (`npm run perf:api`) against the same stack.
#
# Unlike `npm run perf`, which measures a fixture inside the isolated test
# stack with a pinned Chromium, this runs on the developer's own machine,
# browser and database, so its timings are that machine's: the byte budgets
# in the local budgets file are the gate, the timings are for reading. The
# frontend is left in its production shape afterwards, ready to be looked
# at; `npm run dev:frontend:dev` switches it back.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "== 1/3 Bundle-size budget"
npm run perf:size

echo
echo "== 2/3 Lighthouse on the dev stack's production build"
./scripts/frontend-mode.sh preview
(cd frontend && node perf/lighthouse.mjs perf/lighthouse-budgets.local.json)

echo
echo "== 3/3 Latency probe against the dev stack"
node scripts/perf-api.mjs

echo
echo "Done. The frontend is serving its production build; 'npm run dev:frontend:dev' switches it back."
