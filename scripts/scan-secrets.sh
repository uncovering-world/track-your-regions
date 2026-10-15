#!/usr/bin/env bash
#
# gitleaks over every file git tracks (ADR-0108, #1504): a generic credential
# (a password, a signing secret, a password in a connection URI) fails the
# gate before it is pushed, in any file type. Semgrep's p/secrets and GitHub's
# own scanning read provider formats only.
#
# The files git tracks, as the working tree holds them, go to the scanner as a
# tar stream: what is untracked never reaches it — a local .env, the data/
# directory with its dumps — and a file added with `git add -N` does. The
# findings are printed redacted: a real secret never reaches the log.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Pinned by digest, as scan-image.sh pins Trivy: a tag can be repointed.
GITLEAKS_IMAGE="zricethezav/gitleaks:v8.24.3@sha256:e1b35e12a8c6fa8901f060459cfb6b2fc4c484d3afbe3b029733a3bbfab07055"

# A path still in the index but deleted in the working tree is dropped before
# tar, so tar has nothing to skip and its own errors stay visible; the flags
# are the ones GNU tar and bsdtar both take.
git ls-files -z --cached \
  | while IFS= read -r -d '' path; do
      if [ -e "$path" ] || [ -L "$path" ]; then printf '%s\0' "$path"; fi
    done \
  | tar --null --no-recursion -T - -cf - \
  | docker run --rm -i --entrypoint sh "$GITLEAKS_IMAGE" -c \
    'mkdir -p /scan && tar -xf - -C /scan && cd /scan && exec gitleaks dir . --config .gitleaks.toml --redact --verbose --no-banner --exit-code 1'
