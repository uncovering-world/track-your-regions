#!/usr/bin/env bash
#
# `setup:py:dev` builds the venv with `python3.12` by name. Without this the
# host reports `sh: python3.12: command not found` — an error about a binary,
# when the thing the reader needs to know is why that particular one.
#
# 3.12 is not incidental: CI pins it and cv-python ships on python:3.12-slim.
# A venv on another minor version would make a green local gate stop meaning a
# green CI job, which is the promise `npm run check` is supposed to carry.
set -euo pipefail

# Run it rather than locate it: a pyenv/asdf shim is a perfectly good
# executable file, and exists as soon as *any* installed version provides
# python3.12 — it fails at dispatch when another version is selected for the
# directory. `command -v` would pass that through to the raw
# `command not found` this script exists to replace.
python3.12 -V >/dev/null 2>&1 && exit 0

{
  echo "python3.12 not found, and setup:py:dev needs that exact minor version."
  echo ""
  echo "CI pins 3.12 (actions/setup-python) and cv-python's image is"
  echo "python:3.12-slim. A venv built on a different minor version would make a"
  echo "green run here stop meaning a green run in CI, which is the whole point"
  echo "of the local gate."
  echo ""
  # Only call it wrong when it is wrong. Where 3.12 is exposed under a bare
  # name only — an activated venv, a custom-prefix build symlinked to
  # /usr/local/bin/python3 — saying "not a substitute" about Python 3.12
  # contradicts the three lines above it.
  # Folded into the condition on purpose: `set -e` would kill the script on a
  # bare assignment when `python3` exists but fails to run — a pyenv shim with
  # no version selected exits 127 — cutting the message off one line before its
  # remedy, and with exit 127 rather than 1. Inside a condition errexit is
  # suppressed, and a failing `python3` skips the branch instead of feeding its
  # error text into "This host has …".
  if found="$(python3 -V 2>&1)"; then
    if [[ "$found" == *" 3.12."* ]]; then
      echo "This host has $found, but not under the name python3.12 —"
      echo "the venv is built by that exact name. Symlink it, or use the container."
    else
      echo "This host has $found, which is not a substitute."
    fi
  fi
  echo ""
  echo "An existing cv-python/.venv keeps working — the pin binds building a new"
  echo "one, not using one you already have. If you have no venv either, the"
  echo "\`*:py\` gates print a container command that runs them against 3.12."
} >&2
exit 1
