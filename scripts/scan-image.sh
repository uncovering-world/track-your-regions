#!/usr/bin/env bash
#
# Trivy CVE scan of the cv-python image, matching the CI job.
#
# The image is handed over as a tar rather than through the Docker socket.
# Mounting /var/run/docker.sock would give the scanner root-equivalent control
# of the host daemon, and on SELinux hosts it only works with the confinement
# turned off (--security-opt label=disable) — a lot of authority to grant a
# scanner that only needs to read one image. `docker save` gives it exactly
# that and nothing else. CI needs none of this: trivy-action runs on the host.
#
# Flags mirror .github/workflows/ci.yml so a red scan here means a red job
# there. `--ignore-unfixed` is the load-bearing one: without it the gate blocks
# on CVEs with no released patch, which cv-python cannot act on — its Dockerfile
# already runs `apt-get upgrade` at build time.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

IMAGE_TAG="track-your-regions/cv-python:scan"

# Pinned by digest, per the same rule ci.yml states for this scanner: a tag can
# be repointed, a digest cannot. The trailing version is what makes the pin
# bumpable — a digest alone says nothing about what it currently is. Bump both
# together with the CI pin.
TRIVY_IMAGE="aquasec/trivy@sha256:be1190afcb28352bfddc4ddeb71470835d16462af68d310f9f4bca710961a41e"  # v0.70.0

docker build -t "$IMAGE_TAG" ./cv-python

# Disk-backed, not /tmp. The image is ~8.6 GB (easyocr pulls torch, which pulls
# the CUDA runtime set), and on Fedora /tmp is a RAM-backed tmpfs capped at half
# of memory — measured here as 9.7 GB total, so the tarball alone would take
# most of it, in RAM, for the length of the scan. /var/tmp is on real disk on
# both Fedora and Debian; an explicit TMPDIR still wins.
tarball="$(mktemp --tmpdir="${TMPDIR:-/var/tmp}" tyr-cv-python-scan.XXXXXX.tar)"
cleanup() { rm -f "$tarball"; }
trap cleanup EXIT

docker save "$IMAGE_TAG" -o "$tarball"

# :ro,z — read-only because the scanner has no reason to write to it, and z so
# the mount carries a label SELinux will let the container read.
docker run --rm -v "$tarball:/scan.tar:ro,z" "$TRIVY_IMAGE" image \
  --input /scan.tar \
  --severity HIGH,CRITICAL \
  --exit-code 1 \
  --ignore-unfixed
