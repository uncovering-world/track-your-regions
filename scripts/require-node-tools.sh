#!/usr/bin/env bash
#
# Fail loudly, and legibly, when the repo-root dev tooling is not installed.
#
# The tools this guards used to be fetched per run with `npx --yes`, which
# resolved their whole transitive tree from the registry every time and so could
# not be missing — it could only be a different version than yesterday, or a
# registry blip failing an unrelated PR (#490). They are ordinary devDependencies
# now, which trades that for the failure mode every other local dependency has:
# `sh: madge: command not found`, exit 127, on a checkout where nobody ran
# `npm install` at the root. That reads like environment noise rather than "this
# check did not run", and everything after it in the `&&` chain is skipped too —
# the same illegibility require-py-tools.sh exists to remove on the Python side.
#
# Named tools rather than just `node_modules/`: an install interrupted partway
# leaves the directory there, and it is exactly that case a directory check
# passes and the gate then dies on.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

missing=()
for tool in "$@"; do
  [[ -x "$ROOT/node_modules/.bin/$tool" ]] || missing+=("$tool")
done

(( ${#missing[@]} == 0 )) && exit 0

# What each gate actually runs, kept in step with package.json — a reader who
# just watched a chain die needs the name of the check that did not run, not
# only the name of the binary behind it.
gates=()
for tool in "${missing[@]}"; do
  case "$tool" in
    madge) gates+=("lint:circular") ;;
    *)     gates+=("$tool") ;;
  esac
done

{
  echo "Root dev tooling is missing: ${missing[*]}"
  echo ""
  echo "These gates did NOT run: ${gates[*]}"
  echo "That is a failure, not a skip."
  echo ""
  echo "Install it with:  npm install    (in the repository root)"
  echo ""
  echo "The root package.json holds the repo-wide lint tools; their transitive"
  echo "versions come from the tracked root package-lock.json, so the tool that"
  echo "runs here is the tool CI's checks job runs with npm ci."
} >&2
exit 1
