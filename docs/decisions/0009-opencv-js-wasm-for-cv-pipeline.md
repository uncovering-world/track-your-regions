# ADR-0009: Use OpenCV.js (WASM) for server-side CV pipeline

**Date:** 2026-03-24
**Status:** Accepted

---

## Context

The world view import system needs computer vision operations to auto-match Wikivoyage map images to GADM administrative divisions. Required operations include K-means clustering, morphological operations (erosion, dilation, opening/closing), color space conversion (RGB to CIELAB, HSV), connected component analysis, flood fill, and contour detection.

These operations run server-side on Node.js as part of an SSE-streaming pipeline (`wvImportMatchPipeline.ts`) that processes uploaded map images in real time.

## Decision

Use `@techstark/opencv-js` -- a pre-built WebAssembly port of OpenCV that runs directly in Node.js without native dependencies.

The WASM module is eagerly initialized at server startup (module-level `import()`) and cached on `globalThis` to survive tsx hot-reloads. A polling loop waits up to 30 seconds for `cv.Mat` to become available before marking initialization complete.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Python OpenCV via subprocess | Added deployment complexity (Python runtime, pip dependencies), IPC overhead for large image buffers, harder to integrate with SSE streaming |
| sharp-only pipeline (no CV) | sharp handles resize/format conversion well but lacks K-means, morphological operations, connected components, and color space conversions needed for map analysis |
| Cloud CV API (Google Vision, AWS Rekognition) | Per-request latency (network round-trip), cost per image, privacy concerns with uploaded maps, no fine-grained control over clustering parameters |

## Consequences

**Positive:**
- Zero native dependencies -- WASM binary works on any platform without compilation
- Full OpenCV API available in the same Node.js process; no IPC overhead
- Tight integration with SSE streaming pipeline -- can yield to event loop between CV phases
- Single language (TypeScript) for the entire pipeline

**Negative / Trade-offs:**
- WASM binary is ~10MB, adding to server startup time and memory footprint
- Some OpenCV features are unavailable in the WASM build (e.g., `pyrMeanShiftFiltering` had to be re-implemented manually in `wvImportMatchMeanshift.ts`)
- Single-threaded execution -- cannot parallelize CV operations across cores
- No TypeScript types for `@techstark/opencv-js`; `cv` is typed as `any` throughout the pipeline
- tsx/esbuild transforms dynamic `import()` slowly for the 10MB module, requiring the eager `globalThis` caching workaround

## References

- Key file: `backend/src/controllers/admin/wvImportMatchPipeline.ts` (OpenCV loading, lines 24-49)
- Pipeline modules: `backend/src/controllers/admin/wvImportMatch*.ts`
- Related ADRs: ADR-0011 (dual pipeline using OpenCV)
