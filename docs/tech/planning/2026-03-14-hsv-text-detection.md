# HSV-Based Text Detection for CV Pipeline

**Date**: 2026-03-14
**Status**: Approved
**Supersedes**: `2026-03-13-ml-text-detection.md`

## Summary

Replace ML model (PP-OCRv4 via onnxruntime-node) and BlackHat morphology with a simple HSV brightness threshold, validated against 120 Wikivoyage maps. Text pixels are Telea-inpainted in colorBuf before K-means.

## Rule

After `removeColoredLines` has removed bright colored lines:

```
text/symbol = V < 128  (0-255 scale, i.e., brightness < 50%)
region_fill = V >= 128
```

This catches all 5 official WV text colors (#000000, #1a1a1a, #383838, #656565, #006bff after blue removal) plus city dots, capital stars, dark borders, and symbols.

## Changes in `detectText`

### Added
1. HSV conversion of `origDownBuf` → extract V channel
2. Threshold V < 128 → binary text mask
3. Dark CC detection (existing, merged into mask)
4. Morphological dilate 5×5
5. Debug image: "Text removed (black holes)"
6. Telea inpaint `colorBuf` using mask, radius pxS(5)
7. Debug image: "Text filled (Telea)"

### Removed
- ML model inference (onnxruntime-node import, session management)
- BlackHat morphology
- BlackHat fallback logic
- Morphological close (was for ML mask gap-bridging)

### Unchanged
- `hsvSharp` from rawBuf (for ocean buffer)
- Ocean buffer + Telea on rawBuf → inpaintedBuf
- labBufEarly from colorBuf
- textExcluded output (K-means safety net)

## Dependencies to remove
- `onnxruntime-node` from backend/package.json
- `backend/src/services/mlModels.ts`
- `gcompat` / Debian-slim Docker change (can revert to Alpine)

## File changes
| File | Change |
|------|--------|
| `backend/src/controllers/admin/wvImportMatchText.ts` | Rewrite: HSV threshold + Telea fill |
| `backend/src/services/mlModels.ts` | Delete |
| `backend/package.json` | Remove onnxruntime-node |
| `backend/Dockerfile` | Revert to node:20-alpine |
