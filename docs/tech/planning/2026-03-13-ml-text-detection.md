# ML-Based Text Detection for CV Pipeline

**Date**: 2026-03-13
**Status**: Design approved

## Problem

The current text detection in `wvImportMatchText.ts` uses BlackHat morphology + dark connected-component analysis on the median-filtered `rawBuf`. This approach:

1. **Misses most text** — BlackHat on median(5) image detects only ~20-30% of map labels. Region names ("MIDDLE ATLAS", "SAHARAN MOROCCO"), city labels, and rotated text ("NORTH ATLANTIC COAST") are largely undetected.
2. **Catches non-text features** — when run on the sharp `origDownBuf` instead, BlackHat also picks up region boundary lines, destroying thin coastal strips.
3. **Source mismatch** — text mask from median-filtered `rawBuf` applied as exclusion against unfiltered `colorBuf`.

Previous iterations showed that modifying `colorBuf` to remove text (Telea, BFS fill, OCR-guided fill) is destructive on thin regions where text covers 50%+ of pixels. The current approach — mark text in `textExcluded` and let downstream phases handle it — is correct but needs a much better text mask.

## Solution

Replace BlackHat + dark CC with **PP-OCRv4 mobile det** (DB text detector) running via `onnxruntime-node`. This model outputs a per-pixel text probability map, producing a precise text mask that:

- Catches all text (including small labels, rotated text, decorative text)
- Does NOT catch boundary lines or map features (trained specifically on text)
- Produces per-pixel granularity (not bounding boxes that over-mask thin regions)

## Architecture

### Model

- **Model**: PP-OCRv4 mobile det (`ch_PP-OCRv4_det_infer.onnx`, ~4.7MB)
- **Architecture**: DB (Differentiable Binarization) — a segmentation network that outputs per-pixel text probability
- **Source**: PaddlePaddle model zoo — exact URL TBD (need to locate the pre-converted ONNX export; PaddlePaddle distributes Paddle-format by default)
- **Runtime**: `onnxruntime-node` (new backend dependency, ~87MB install with native binaries)
- **Integrity**: Verify file size after download; SHA-256 check if available

### Model Management

New file `backend/src/services/mlModels.ts`:

- `ensureTextDetModel(): Promise<string>` — returns path to ONNX model file
- On first call: checks `backend/data/models/ch_PP-OCRv4_det_infer.onnx`
- If missing: downloads from PaddlePaddle GitHub releases
- Path cached in module scope after first successful load
- `backend/data/models/` added to `.gitignore`
- **Fallback**: If download fails or ONNX session creation fails, fall back to the existing BlackHat approach with a console warning. The pipeline must not fail just because the ML model is unavailable (e.g., fresh install with no internet).

### ONNX Session Management

- `onnxruntime-node` `InferenceSession` created once, cached on `globalThis` (same pattern as OpenCV WASM — survives tsx hot-reloads)
- Session creation is ~100ms, inference is ~200ms
- Session reused across pipeline runs

### Pipeline Integration

In `wvImportMatchText.ts`, the `detectText(ctx)` function changes:

**Removed**:
- BlackHat morphology on `gray(rawBuf)`
- Related OpenCV Mat allocations and cleanup (BlackHat kernel, gray mat, threshold mat)

**Added** (ML text detection):

1. **Preprocess `origDownBuf`** (assert `origDownBuf.length === TW * TH * 3`):
   - Zero-pad width and height to next multiples of 32 (preserves geometry; black bands at edges won't trigger false text detections)
   - Normalize: `(pixel / 255 - mean) / std` where mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]
   - Convert to NCHW Float32 layout (channels-first)

2. **Run inference**:
   - `session.run({ x: inputTensor })` → output tensor (probability map)
   - Output shape: [1, 1, H_padded, W_padded], float32, values in [0, 1]

3. **Postprocess**:
   - Crop probability map to TW×TH (remove padding)
   - Threshold at 0.3 → binary text mask (tunable)
   - Dilate with 3×3 elliptical kernel (smaller than BlackHat's 5×5 — ML mask is already more precise and well-localized)
   - Write to `ctx.textExcluded`

**Unchanged**:
- `colorBuf` is NOT modified
- `hsvSharp` computed from `rawBuf` via OpenCV (needed by dark CC detection + ocean buffer)
- Dark CC detection (V < 50 small components) — merged into `textExcluded` after ML mask
- Ocean buffer + Telea inpaint on `rawBuf` → `ctx.inpaintedBuf` (for water detection)
- `labBufEarly` from `colorBuf` (for BG detection)
- All downstream phase behavior

### Threshold Tuning

The 0.3 threshold is a starting point. The debug image "Text mask" already exists and will show the ML-detected mask. We evaluate on Morocco and adjust:

- Lower threshold (0.2) → catches more text but may include noise
- Higher threshold (0.5) → fewer false positives but may miss faint labels

### Dark Spot Detection

BlackHat removal also eliminates the dark CC detection (city dots, small symbols with V < 50). These are legitimate non-text features that should be excluded from K-means. Two options:

- **Keep dark CC as a separate pass** — simple, 15 lines, independent of text detection
- **Rely on K-means exclusion** — dark dots are tiny and K-means spatial mode filter handles them

Decision: Keep dark CC detection. It's cheap, reliable, and catches map symbols (compass roses, scale bars, city dots) that the text model won't detect.

## File Changes

| File | Change |
|------|--------|
| `backend/src/services/mlModels.ts` | **New** — model download helper + path caching |
| `backend/src/controllers/admin/wvImportMatchText.ts` | Replace BlackHat with ONNX inference, keep dark CC |
| `backend/package.json` | Add `onnxruntime-node` dependency |
| `.gitignore` | Add `backend/data/models/` |

## Testing

1. Run Morocco pipeline — the motivating case. Compare text mask (debug image) with the BlackHat mask screenshot.
2. Verify rotated text ("NORTH ATLANTIC COAST") is detected.
3. Verify boundary lines are NOT detected (thin coastal strips preserved).
4. Run a country with large text labels and thin regions to confirm no over-masking.
5. Check inference time stays under ~500ms.
