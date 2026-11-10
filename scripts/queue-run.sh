#!/usr/bin/env bash
# Works a queue unattended, one item per fresh context (`/queue` § Between items).
#
# Each pass starts a new non-interactive Claude Code session with
# `/queue resume <n> unattended`. That session works the current item to its end,
# hands the queue off (*Owner* reads `handoff …`) and exits, so the next pass
# starts from the queue and its handoff note instead of from the previous item's
# history. The loop goes on only while the session it started handed off: a
# release, a question for the maintainer, a closed queue or a failed run stops it.
#
# Usage: scripts/queue-run.sh <queue number> [--items N] [--budget USD]
#   --items N     stop after N passes (default 5)
#   --budget USD  passed to each session as --max-budget-usd
set -euo pipefail

usage() { echo "usage: scripts/queue-run.sh <queue number> [--items N] [--budget USD]" >&2; exit 2; }

[[ $# -ge 1 && $1 =~ ^[0-9]+$ ]] || usage
queue=$1; shift
items=5
budget=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --items) [[ ${2:-} =~ ^[0-9]+$ ]] || usage; items=$2; shift 2 ;;
    --budget) [[ ${2:-} =~ ^[0-9]+([.][0-9]+)?$ ]] || usage; budget=(--max-budget-usd "$2"); shift 2 ;;
    *) usage ;;
  esac
done

command -v claude >/dev/null || { echo "queue-run: claude is not on PATH" >&2; exit 1; }
command -v gh >/dev/null || { echo "queue-run: gh is not on PATH" >&2; exit 1; }

# The first line of the queue's *Owner* section, or `closed` once the issue is.
owner_line() {
  local state
  state=$(gh issue view "$queue" --json state -q .state)
  if [[ $state != OPEN ]]; then echo closed; return; fi
  gh issue view "$queue" --json body -q .body \
    | awk '/^## /{inside = ($0 == "## Owner"); next} inside && NF {print; exit}'
}

for ((pass = 1; pass <= items; pass++)); do
  echo "queue-run: pass $pass of $items on queue #$queue"
  if ! claude -p "/queue resume $queue unattended" \
      --permission-mode auto --name "queue-$queue-pass-$pass" ${budget[@]+"${budget[@]}"}; then
    echo "queue-run: the session exited with an error; stopping" >&2
    exit 1
  fi
  owner=$(owner_line)
  case $owner in
    handoff*) echo "queue-run: handed off ($owner)" ;;
    *) echo "queue-run: stopping, the queue was not handed off: ${owner:-no Owner line}"; exit 0 ;;
  esac
done
echo "queue-run: $items passes done; the queue stays handed off for the next run"
