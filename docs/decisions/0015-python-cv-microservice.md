# ADR-0015: Python CV Microservice for Image-Processing Pipeline

## Status
Accepted — 2026-04-26

## Context
The CV pipeline matches Wikivoyage map images to GADM administrative
divisions via color clustering, shape detection, and IoU scoring. The
initial implementation used Node.js with `@techstark/opencv-js` (WASM) for
all CV operations. It works but has several limitations:

- WASM startup is slow (30s+ with tsx/esbuild's dynamic import path)
- Heavy CV operations block the Node.js event loop
- Debugging intermediate stages requires custom tooling
- Python's CV ecosystem (scikit-image, scipy, opencv-python) is richer and
  faster than the WASM port
- Some algorithms (RANSAC affine estimation, morphological operations, SLIC
  superpixels) are unavailable or significantly slower in the JS port

## Decision
Add a separate Python CV microservice (FastAPI) running in its own Docker
container. The Node.js backend calls it via HTTP with binary multipart
uploads. An admin toggle in CV Settings selects JS or Python pipeline
per-instance. The JS pipeline remains the default for backward compatibility;
Python is opt-in initially.

Communication protocol: NDJSON streaming over HTTP. Each line is a JSON
object of type `progress`, `result`, `review`, or `error`. Interactive
reviews (e.g. water region confirmation) are routed via Python's
`/pipeline/respond/:reviewId` endpoint.

## Alternatives Considered
- **Replace JS pipeline entirely**: rejected — in-flight imports use the JS
  pipeline; cutover risk too high for a single change.
- **Worker thread (Node.js)**: rejected — WASM in worker doesn't fix the
  ecosystem gap; still blocks a thread.
- **Embedding Python via child_process**: rejected — poor isolation, startup
  cost on every call, no HTTP-style observability.
- **WASM in separate process**: rejected — same ecosystem limitations as WASM
  in Node.

## Consequences
- **+** Richer Python ecosystem (faster CV, RANSAC, SLIC, morphological ops).
- **+** Service isolation: CV crashes don't bring down the Node backend.
- **+** Admin can A/B compare JS vs Python pipelines per-region during transition.
- **+** Python's `typing` + pytest make the CV code easier to validate.
- **−** New service to deploy and maintain.
- **−** HTTP latency between Node and Python (mitigated by intra-Docker-network calls).
- **−** Two implementations to keep functionally in sync during the transition.

## Implementation
- `cv-python/` — FastAPI service (Dockerfile, requirements.txt, pyproject.toml).
- `docker-compose.yml` — `cv-python` service; backend gains `CV_PYTHON_URL`.
- `backend/src/services/cv/pythonCvClient.ts` — typed HTTP client.
- `backend/src/services/cv/pythonReviewBridge.ts` — in-memory Python review bridge.
- `backend/src/services/ai/aiSettingsService.ts` — DB-backed key-value settings.
- `db/init/01-schema.sql` — `ai_settings` table.
- `frontend/src/components/admin/CVSettingsPanel.tsx` — admin toggle UI.
