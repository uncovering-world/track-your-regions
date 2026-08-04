#!/usr/bin/env bash
#
# Fail loudly, and legibly, when the Python dev tooling is not usable.
#
# Without this the first missing tool reports
# `sh: .venv/bin/ruff: No such file or directory` and takes the whole gate down
# with it. That is a real failure, but an illegible one: it reads like
# environment noise rather than "this check did not run", and a gate whose
# non-run looks like noise is a gate that eventually gets believed when it
# should not be. Everything after it in the `&&` chain is skipped too, so the
# operator cannot tell which scans happened.
#
# The remedy has to be one the reader's machine can actually follow, and it has
# to cover the gates that did not run — not a subset. A caller asking for
# `bandit` told the reader Bandit was skipped; handing back a command without
# Bandit in it produces `All checks passed!` on a host where it never ran, which
# is the failure this script exists to prevent, wearing a friendlier face. So
# the command is derived from the requested tools rather than written out once.
#
# `setup:py:dev` needs a `python3.12` binary specifically — CI pins 3.12 and
# cv-python ships on `python:3.12-slim`, so a venv built on another minor
# version would make "green locally" stop meaning "green in CI". On a host with
# no 3.12 at all, naming that script is advice that cannot be taken.
#
# Named tools rather than just the directory: a half-installed venv is the case
# that produces the confusing error, and it is the one a directory check misses.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$(dirname "$SCRIPT_DIR")/cv-python/.venv"

missing=()
for tool in "$@"; do
  [[ -x "$VENV/bin/$tool" ]] || missing+=("$tool")
done

# A venv whose base interpreter is gone passes the loop above: every shim is
# still a mode-755 regular file, and only its shebang is broken. The gate then
# dies with `bad interpreter: No such file or directory` — guard passed, gate
# did not run, message reads as environment noise, which is the whole thing
# this script exists to prevent. `.venv/bin/python` is a symlink to the base, so
# `-x` catches it: a dangling symlink is not executable.
#
# Likely on exactly the hosts this is aimed at — a distro upgrade that drops
# python3.12, a removed pyenv version, `brew unlink`.
if (( ${#missing[@]} == 0 )) && [[ ! -x "$VENV/bin/python" ]]; then
  missing=("$@")
fi

(( ${#missing[@]} == 0 )) && exit 0

# What each gate actually runs, kept in step with package.json. `ruff` covers
# two — `lint:py` and `format:py` — which is why this maps to a command list
# rather than one command per tool.
commands=()
for tool in "${missing[@]}"; do
  case "$tool" in
    ruff)      commands+=("ruff check --no-cache ." "ruff format --no-cache --check .") ;;
    mypy)      commands+=("mypy app") ;;
    bandit)    commands+=("bandit -r app -c pyproject.toml") ;;
    pip-audit) commands+=("pip-audit -r requirements.txt --ignore-vuln GHSA-rrmf-rvhw-rf47") ;;
    pytest)    commands+=("pytest") ;;
    *)         commands+=("$tool") ;;
  esac
done

{
  echo "Python dev tooling is missing: ${missing[*]}"
  echo ""
  echo "These gates did NOT run. This is a failure, not a skip."
  echo ""
  # Run it, not locate it — see require-python-312.sh: a shim that cannot
  # dispatch would send the reader to a setup script that then fails the same
  # way, which is the "half an answer" case this branch exists to remove.
  if python3.12 -V >/dev/null 2>&1; then
    echo "Install them with:  npm run setup:py:dev"
    # Scoped to the callers it is true of. CI's python-tests job builds no venv
    # — it pip-installs into the runner's own interpreter and runs pytest
    # directly — so saying "CI checks against the venv too" is false for exactly
    # the gate a contributor most often has just seen die.
    case " ${missing[*]} " in
      *" pytest "*) ;;
      *) echo "(CI's checks job builds the same venv with npm run setup:py:dev.)" ;;
    esac
  else
    echo "This host has no python3.12, which setup:py:dev requires — CI pins 3.12"
    echo "and cv-python ships on python:3.12-slim, so a venv built on another"
    echo "minor version would make a green run here stop meaning a green run in CI."
    echo ""
    echo "Either install Python 3.12, or run the gates that did not run against"
    echo "the pinned interpreter in a container:"
    echo ""
    # Caches redirected out of the mount, and `:z` as every other bind mount in
    # this repo carries.
    #
    # The container runs as root, so `mypy`'s cache, pytest's cache, the
    # coverage file and CPython's `__pycache__/` would land in the host tree
    # owned by root — and the operator
    # who takes this branch of the advice and installs 3.12 afterwards then hits
    # `PermissionError: '.coverage'`, which only `sudo rm` clears. That is this
    # script's own failure mode, moved one step later. Without `:z` the mount is
    # unreadable inside the container on an SELinux-enforcing host and the advice
    # fails outright.
    echo "  docker run --rm \\"
    echo "    -e MYPY_CACHE_DIR=/tmp/mypy -e PYTEST_ADDOPTS=-p\\ no:cacheprovider \\"
    echo "    -e PYTHONDONTWRITEBYTECODE=1 \\"
    echo "    -e COVERAGE_FILE=/tmp/.coverage \\"
    echo "    -v \"$(dirname "$SCRIPT_DIR")/cv-python:/w:z\" -w /w python:3.12-slim \\"
    printf "    sh -c 'pip install -q -r requirements.txt -r requirements-dev.txt"
    for cmd in "${commands[@]}"; do
      printf " \\\\\n         && %s" "$cmd"
    done
    printf "'\n"
    # Gated on `missing`, not on what was requested: the command list above is
    # built from what is actually absent, so gating on the request would append
    # this note to a printout showing no ruff command at all — `check:py` asks
    # for `ruff mypy`, and a venv holding ruff but not mypy prints `mypy app`
    # alone.
    #
    # `ruff` maps to its check forms, including for `lint:py:fix` and
    # `format:py:fix`. Deliberate: the write forms would rewrite the mount as
    # root, which is the hazard the environment variables above just closed.
    case " ${missing[*]} " in *" ruff "*)
      echo ""
      echo "Note: those are the check forms. The :fix variants rewrite files, and"
      echo "doing that in this container would leave them owned by root — install"
      echo "3.12 and use the venv for those."
      ;;
    esac
  fi
} >&2
exit 1
