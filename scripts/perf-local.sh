#!/usr/bin/env bash
# The local performance run: everything this machine can measure on its own
# data, in one command, before a push that touches what the browser loads
# or draws. Three parts, in the order they fail fastest:
#
#   1. the bundle-size budget (`npm run perf:size`);
#   2. Lighthouse against the dev stack's frontend in its production shape,
#      on the pages of one world view - real regions, real tiles, the real
#      catalogue behind them - judged against
#      frontend/perf/lighthouse-budgets.local.json;
#   3. the latency probe (`npm run perf:api`) against the same stack.
#
# Unlike `npm run perf`, which measures a fixture inside the isolated test
# stack with a pinned Chromium, this runs on the developer's own machine,
# browser and database, so its timings are that machine's: the byte budgets
# in the local budgets file are the gate, the timings are for reading. The
# frontend is left in its production shape afterwards, ready to be looked
# at; `npm run dev:frontend:dev` switches it back.
#
# The pages and the probe name a world view and a region that exist on the
# database the run is against and that a visitor can see (`is_public`).
# The defaults are the ones the baseline in docs/tech/performance.md was
# measured on; another database names its own:
#
#   npm run perf:local -- --world-view 7 --region 42
#
# Every argument goes to the probe (scripts/perf-api.mjs) as it is, and
# --world-view also reaches the Lighthouse runner, which substitutes it
# into the budgets file's URLs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Pick --world-view out of the arguments for the runner; the probe parses
# the full list itself.
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  if [ "${args[$i]}" = "--world-view" ] && [ $((i + 1)) -lt ${#args[@]} ]; then
    export PERF_WORLD_VIEW="${args[$((i + 1))]}"
  fi
done

# The dev stack's host ports, from the same .env compose reads - the
# containers may be mapped anywhere .env says (scripts/frontend-mode.sh
# resolves them the same way for its own checks). The frontend's port is
# for the runner to substitute into the budgets file's URLs; the backend's
# and Martin's go to the probe as --api/--martin, placed before "$@" so an
# explicit flag still wins (the probe's parser is last-wins). Quotes come
# off the way compose takes them off.
env_port() {
  local name="$1" fallback="$2" value=""
  if [ -f .env ]; then
    value="$(sed -n "s/^${name}=//p" .env | tail -n 1 | sed -e "s/^[\"']//" -e "s/[\"']\$//")"
  fi
  echo "${value:-$fallback}"
}
export FRONTEND_PORT="${FRONTEND_PORT:-$(env_port FRONTEND_PORT 5173)}"
BACKEND_PORT="${BACKEND_PORT:-$(env_port BACKEND_PORT 3001)}"
MARTIN_PORT="${MARTIN_PORT:-$(env_port MARTIN_PORT 3000)}"

echo "== 1/3 Bundle-size budget"
npm run perf:size

echo
echo "== 2/3 Lighthouse on the dev stack's production build"
./scripts/frontend-mode.sh preview
(cd frontend && node perf/lighthouse.mjs perf/lighthouse-budgets.local.json)

echo
echo "== 3/3 Latency probe against the dev stack"
node scripts/perf-api.mjs --api "http://localhost:${BACKEND_PORT}" --martin "http://localhost:${MARTIN_PORT}" "$@"

echo
echo "Done. The frontend is serving its production build; 'npm run dev:frontend:dev' switches it back."
