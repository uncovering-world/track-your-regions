# ML Text Detection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace BlackHat morphology text detection with PP-OCRv4 DB model via onnxruntime-node for dramatically better text mask coverage.

**Architecture:** New model download service (`mlModels.ts`) handles fetching the 4.75MB ONNX model on first use. The `detectText` phase in the pipeline replaces BlackHat with ONNX inference → probability map → threshold → binary mask. Dark CC detection and all downstream phases unchanged. Falls back to BlackHat if model unavailable.

**Tech Stack:** `onnxruntime-node` (ONNX Runtime), PP-OCRv4 mobile det (DB text segmentation model), existing OpenCV WASM for dark CC + ocean buffer.

**Spec:** `docs/tech/planning/2026-03-13-ml-text-detection.md`

---

## File Structure

| File | Role |
|------|------|
| `backend/src/services/mlModels.ts` | **New** — download + cache ONNX model file, create + cache InferenceSession on globalThis |
| `backend/src/controllers/admin/wvImportMatchText.ts` | **Modify** — replace BlackHat with ML inference, keep dark CC + ocean buffer + Telea |
| `backend/package.json` | **Modify** — add `onnxruntime-node` dependency |
| `.gitignore` | **Modify** — add `backend/data/models/` |

---

### Task 1: Add onnxruntime-node dependency + gitignore

**Files:**
- Modify: `backend/package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Install onnxruntime-node**

```bash
cd /home/nikolay/projects/track-your-regions/backend && npm install onnxruntime-node
```

- [ ] **Step 2: Add model directory to gitignore**

Append to `.gitignore`:
```
# ML model files (downloaded on first use)
backend/data/models/
```

- [ ] **Step 3: Create model directory**

```bash
mkdir -p /home/nikolay/projects/track-your-regions/backend/data/models
```

- [ ] **Step 4: Verify**

```bash
cd /home/nikolay/projects/track-your-regions/backend && node -e "const ort = require('onnxruntime-node'); console.log('onnxruntime-node OK, version:', ort.env?.versions?.onnxruntime ?? 'loaded')"
```

Expected: prints version without errors.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json .gitignore
git commit -m "feat: add onnxruntime-node for ML text detection"
```

---

### Task 2: Create model download service

**Files:**
- Create: `backend/src/services/mlModels.ts`

**Context:** This service downloads the PP-OCRv4 det ONNX model on first use and caches the ONNX InferenceSession on `globalThis` (same pattern as OpenCV WASM init in `wvImportMatchPipeline.ts` lines 29-48). If download or session creation fails, it returns `null` so the caller can fall back to BlackHat.

- [ ] **Step 1: Create `mlModels.ts`**

```typescript
/**
 * ML model management — download, cache, and provide ONNX inference sessions.
 *
 * Models are downloaded on first use to `backend/data/models/` (gitignored).
 * Sessions are cached on globalThis to survive tsx hot-reloads.
 */

import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { stat } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import path from 'path';
import { fileURLToPath } from 'url';
import * as ort from 'onnxruntime-node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, '../../data/models');

const TEXT_DET_MODEL = {
  filename: 'ch_PP-OCRv4_det_infer.onnx',
  url: 'https://huggingface.co/breezedeus/cnstd-ppocr-ch_PP-OCRv4_det/resolve/main/ch_PP-OCRv4_det_infer.onnx',
  expectedSizeMB: 4.75, // ±0.5MB tolerance
};

// Cache on globalThis to survive tsx hot-reloads (same pattern as OpenCV WASM)
const G = globalThis as unknown as {
  __textDetSession?: ort.InferenceSession | null;
  __textDetSessionReady?: Promise<ort.InferenceSession | null>;
};

async function downloadModel(url: string, destPath: string): Promise<void> {
  console.log(`[ML Models] Downloading ${path.basename(destPath)}...`);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'TrackYourRegions/1.0 (ML model download)' },
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const tmpPath = destPath + '.tmp';
  const fileStream = createWriteStream(tmpPath);
  await pipeline(Readable.fromWeb(response.body as any), fileStream);
  // Verify file size (±0.5MB tolerance)
  const stats = await stat(tmpPath);
  const sizeMB = stats.size / (1024 * 1024);
  if (Math.abs(sizeMB - TEXT_DET_MODEL.expectedSizeMB) > 0.5) {
    const fs = await import('fs/promises');
    await fs.unlink(tmpPath);
    throw new Error(`Model size mismatch: expected ~${TEXT_DET_MODEL.expectedSizeMB}MB, got ${sizeMB.toFixed(2)}MB`);
  }
  const fs = await import('fs/promises');
  await fs.rename(tmpPath, destPath);
  console.log(`[ML Models] Downloaded ${path.basename(destPath)} (${sizeMB.toFixed(1)}MB)`);
}

/**
 * Get the text detection ONNX session. Returns null if model is unavailable
 * (download failed, session creation failed). Caller should fall back to BlackHat.
 */
export function getTextDetSession(): Promise<ort.InferenceSession | null> {
  if (G.__textDetSessionReady) return G.__textDetSessionReady;

  G.__textDetSessionReady = (async () => {
    try {
      mkdirSync(MODELS_DIR, { recursive: true });
      const modelPath = path.join(MODELS_DIR, TEXT_DET_MODEL.filename);

      if (!existsSync(modelPath)) {
        await downloadModel(TEXT_DET_MODEL.url, modelPath);
      }

      const session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['cpu'],
      });
      G.__textDetSession = session;
      console.log('[ML Models] Text detection session ready');
      return session;
    } catch (err) {
      console.warn('[ML Models] Text detection unavailable, will use BlackHat fallback:', err instanceof Error ? err.message : err);
      G.__textDetSession = null;
      return null;
    }
  })();

  return G.__textDetSessionReady;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /home/nikolay/projects/track-your-regions/backend && npx tsc --noEmit
```

Expected: no errors from `mlModels.ts`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/mlModels.ts
git commit -m "feat: add ML model download service for text detection"
```

---

### Task 3: Replace BlackHat with ML text detection in detectText

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchText.ts`

**Context:** The current `detectText(ctx)` function (125 lines) does:
1. HSV conversion of rawBuf → `hsvSharp` (lines 26-32) — **KEEP**
2. BlackHat morphology → textMask (lines 33-43) — **REPLACE with ML**
3. Dark CC detection → merged into textMask (lines 44-62) — **KEEP** (uses separate mask, merged after ML)
4. Dilate → textMaskDilated (lines 64-68) — **REPLACE** (ML mask + smaller dilation)
5. textExcluded from mask (lines 70-72) — **KEEP**
6. Ocean buffer + Telea inpaint (lines 74-100) — **KEEP**
7. Debug image (lines 102-110) — **KEEP** (update label)
8. labBufEarly from colorBuf (lines 112-118) — **KEEP**

- [ ] **Step 1: Rewrite `wvImportMatchText.ts`**

Replace the entire file with the new implementation. Key changes:
- Import `getTextDetSession` and `ort` from the new service
- Add `runMLTextDetection(session, origDownBuf, TW, TH)` function for preprocessing + inference + postprocessing
- Add `detectTextBlackHat(cv, rawBuf, TW, TH, tp, hsvSharp, oddK)` function extracting old BlackHat logic as fallback
- Main `detectText(ctx)` tries ML first, falls back to BlackHat
- Dark CC detection runs after either method and merges into the mask
- Dilation uses 3×3 kernel (was 5×5)
- Debug label updated to indicate ML vs BlackHat

The new file structure:

```typescript
/**
 * Text/symbol detection phase.
 *
 * Detects text using PP-OCRv4 DB model (ML) with BlackHat fallback.
 * Dark symbols detected separately via connected-component analysis.
 * Does NOT modify colorBuf — text pixels are marked in textExcluded.
 *
 * Sets on ctx: textExcluded, hsvSharp, inpaintedBuf, labBufEarly
 */

import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import type { PipelineContext } from './wvImportMatchPipeline.js';
import { getTextDetSession } from '../../services/mlModels.js';

// --- ML text detection (PP-OCRv4 DB model) ---

/** Preprocess image, run ONNX inference, return binary text mask or null on failure. */
async function runMLTextDetection(
  session: ort.InferenceSession,
  origDownBuf: Buffer,
  TW: number,
  TH: number,
): Promise<Uint8Array | null> {
  // Validate input
  if (origDownBuf.length !== TW * TH * 3) return null;

  // Pad to next multiple of 32
  const padW = Math.ceil(TW / 32) * 32;
  const padH = Math.ceil(TH / 32) * 32;

  // Build NCHW Float32 input tensor with ImageNet normalization
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const inputData = new Float32Array(3 * padH * padW);
  const chStride = padH * padW;

  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const srcIdx = (y * TW + x) * 3;
      const dstIdx = y * padW + x;
      for (let c = 0; c < 3; c++) {
        inputData[c * chStride + dstIdx] = (origDownBuf[srcIdx + c] / 255 - mean[c]) / std[c];
      }
    }
  }
  // Padded pixels stay 0 (zero-padding — black bands, won't trigger text detection)

  const inputTensor = new ort.Tensor('float32', inputData, [1, 3, padH, padW]);
  const results = await session.run({ x: inputTensor });

  // Output: probability map [1, 1, padH, padW]
  const outputTensor = Object.values(results)[0];
  if (!outputTensor) return null;
  const probData = outputTensor.data as Float32Array;

  // Threshold and crop to original dimensions
  const TEXT_THRESHOLD = 0.3;
  const mask = new Uint8Array(TW * TH);
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      if (probData[y * padW + x] >= TEXT_THRESHOLD) {
        mask[y * TW + x] = 1;
      }
    }
  }
  return mask;
}

// --- BlackHat fallback (extracted from original detectText) ---

function detectTextBlackHat(
  cv: any, rawBuf: Buffer, TW: number, TH: number, tp: number,
  hsvSharp: Buffer, oddK: (base: number) => number,
): Uint8Array {
  const cvRaw = new cv.Mat(TH, TW, cv.CV_8UC3);
  cvRaw.data.set(rawBuf);
  const cvGray = new cv.Mat();
  cv.cvtColor(cvRaw, cvGray, cv.COLOR_RGB2GRAY);
  cvRaw.delete();
  const bhSize = oddK(11);
  const bhKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(bhSize, bhSize));
  const cvBlackHat = new cv.Mat();
  cv.morphologyEx(cvGray, cvBlackHat, cv.MORPH_BLACKHAT, bhKernel);
  bhKernel.delete();
  const textMask = new cv.Mat();
  cv.threshold(cvBlackHat, textMask, 25, 255, cv.THRESH_BINARY);
  cvBlackHat.delete(); cvGray.delete();
  const mask = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (textMask.data[i]) mask[i] = 1;
  }
  textMask.delete();
  return mask;
}

// --- Main detectText phase ---

export async function detectText(ctx: PipelineContext): Promise<void> {
  const { cv, TH, TW, tp, rawBuf, colorBuf, origDownBuf, oddK, pxS, logStep, pushDebugImage, origW, origH } = ctx;

  // HSV of rawBuf — needed by dark CC detection + ocean buffer (always computed)
  const cvRaw = new cv.Mat(TH, TW, cv.CV_8UC3);
  cvRaw.data.set(rawBuf);
  const cvHsvRaw = new cv.Mat();
  cv.cvtColor(cvRaw, cvHsvRaw, cv.COLOR_RGB2HSV);
  const hsvSharp = Buffer.from(cvHsvRaw.data);
  cvHsvRaw.delete();
  // cvRaw kept alive — reused for Telea inpaint below

  // --- Text detection: ML with BlackHat fallback ---
  let textMask: Uint8Array;
  let detectionMethod: string;

  const session = await getTextDetSession();
  if (session) {
    await logStep('Text detection (ML model)...');
    const mlMask = await runMLTextDetection(session, origDownBuf, TW, TH);
    if (mlMask) {
      textMask = mlMask;
      detectionMethod = 'ML (PP-OCRv4)';
    } else {
      console.warn('[Text] ML inference returned null, falling back to BlackHat');
      await logStep('Text detection (BlackHat fallback)...');
      textMask = detectTextBlackHat(cv, rawBuf, TW, TH, tp, hsvSharp, oddK);
      detectionMethod = 'BlackHat (fallback)';
    }
  } else {
    await logStep('Text detection (BlackHat — model unavailable)...');
    textMask = detectTextBlackHat(cv, rawBuf, TW, TH, tp, hsvSharp, oddK);
    detectionMethod = 'BlackHat (no model)';
  }

  // --- Dark spot detection: city dots/symbols (V < 50, small CCs) ---
  // Kept separate from ML text detection — catches map symbols the text model won't detect
  const darkMask = new cv.Mat(TH, TW, cv.CV_8UC1, new cv.Scalar(0));
  for (let i = 0; i < tp; i++) {
    if (hsvSharp[i * 3 + 2] < 50) darkMask.data[i] = 255;
  }
  const darkLabels = new cv.Mat();
  const darkStats = new cv.Mat();
  const darkCents = new cv.Mat();
  const numDarkCC = cv.connectedComponentsWithStats(darkMask, darkLabels, darkStats, darkCents);
  darkCents.delete();
  const maxDarkSize = Math.round(tp * 0.005);
  const darkLabelData = darkLabels.data32S;
  let darkCount = 0;
  for (let c = 1; c < numDarkCC; c++) {
    if (darkStats.intAt(c, cv.CC_STAT_AREA) <= maxDarkSize) {
      for (let i = 0; i < tp; i++) {
        if (darkLabelData[i] === c && !textMask[i]) {
          textMask[i] = 1;
          darkCount++;
        }
      }
    }
  }
  darkMask.delete(); darkLabels.delete(); darkStats.delete();
  if (darkCount > 0) console.log(`  [Text] Dark spots: added ${darkCount} pixels from small dark CCs`);

  // --- Dilate text mask (3×3 — ML mask is precise, smaller dilation than BlackHat's 5×5) ---
  const cvTextMask = new cv.Mat(TH, TW, cv.CV_8UC1);
  for (let i = 0; i < tp; i++) cvTextMask.data[i] = textMask[i] ? 255 : 0;
  const dilateK = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
  const textMaskDilated = new cv.Mat();
  cv.dilate(cvTextMask, textMaskDilated, dilateK);
  cvTextMask.delete(); dilateK.delete();

  // textExcluded: marks text pixels for K-means exclusion + forced foreground
  const textExcluded = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) if (textMaskDilated.data[i]) textExcluded[i] = 1;

  const textPixelCount = textExcluded.reduce((s, v) => s + v, 0);
  console.log(`  [Text] ${detectionMethod}: ${textPixelCount} pixels (${(textPixelCount / tp * 100).toFixed(1)}%)`);

  // --- Ocean buffer + Telea inpaint on rawBuf for water detection only ---
  const INPAINT_R = pxS(8);
  const inpaintMask = new cv.Mat();
  textMaskDilated.copyTo(inpaintMask);
  const OCEAN_BUF_R = pxS(3);
  const obSize = OCEAN_BUF_R * 2 + 1;
  const oceanBufK = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(obSize, obSize));
  const textNear = new cv.Mat();
  cv.dilate(textMaskDilated, textNear, oceanBufK);
  oceanBufK.delete();
  let oceanBuffered = 0;
  for (let i = 0; i < tp; i++) {
    if (textMaskDilated.data[i]) continue;
    if (!textNear.data[i]) continue;
    if (hsvSharp[i * 3 + 1] < 15) { inpaintMask.data[i] = 255; oceanBuffered++; }
  }
  textNear.delete();
  if (oceanBuffered > 0) console.log(`  [Text] Ocean buffer: masked ${oceanBuffered} bg pixels adjacent to text`);

  const cvInpainted = new cv.Mat();
  cv.inpaint(cvRaw, inpaintMask, cvInpainted, INPAINT_R, cv.INPAINT_TELEA);
  cvRaw.delete();
  inpaintMask.delete();

  const inpaintedBuf = Buffer.from(cvInpainted.data);
  cvInpainted.delete();

  // Debug: text mask (shows ML or BlackHat output)
  const textMaskPng = await sharp(Buffer.from(textMaskDilated.data), {
    raw: { width: TW, height: TH, channels: 1 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(
    `Text mask [${detectionMethod}] (white = excluded from K-means, NOT removed from image)`,
    `data:image/png;base64,${textMaskPng.toString('base64')}`,
  );
  textMaskDilated.delete();

  // Convert colorBuf to Lab for later BG detection
  const cvBufForSeam = new cv.Mat(TH, TW, cv.CV_8UC3);
  cvBufForSeam.data.set(colorBuf);
  const cvLabSeam = new cv.Mat();
  cv.cvtColor(cvBufForSeam, cvLabSeam, cv.COLOR_RGB2Lab);
  const labBufEarly = Buffer.from(cvLabSeam.data);
  cvBufForSeam.delete(); cvLabSeam.delete();

  // Set results on context
  ctx.textExcluded = textExcluded;
  ctx.hsvSharp = hsvSharp;
  ctx.inpaintedBuf = inpaintedBuf;
  ctx.labBufEarly = labBufEarly;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /home/nikolay/projects/track-your-regions/backend && npx tsc --noEmit
```

Expected: no errors. The `ort` import may show warnings about `any` types — acceptable.

- [ ] **Step 3: Run pre-commit checks**

```bash
npm run check && npm run knip
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchText.ts
git commit -m "feat: replace BlackHat text detection with PP-OCRv4 ML model"
```

---

### Task 4: Manual pipeline test on Morocco

This task validates the ML text detection end-to-end.

- [ ] **Step 1: Start the dev backend**

```bash
cd /home/nikolay/projects/track-your-regions && npm run dev:backend
```

Watch the console for `[ML Models] Downloading ch_PP-OCRv4_det_infer.onnx...` on first run, followed by `[ML Models] Text detection session ready`.

- [ ] **Step 2: Trigger the Morocco pipeline**

In the admin UI, navigate to the Morocco region and trigger the auto CV match pipeline. Watch the SSE progress events.

- [ ] **Step 3: Evaluate the text mask debug image**

Compare the new "Text mask [ML (PP-OCRv4)]" debug image with the old BlackHat mask. The ML mask should:
- Detect region names: "MIDDLE ATLAS", "HIGH ATLAS", "ANTI ATLAS", "SAHARAN MOROCCO", etc.
- Detect rotated text: "NORTH ATLANTIC COAST"
- Detect city labels: "Casablanca", "Marrakech", "Fez", etc.
- NOT detect region boundary lines (thin colored boundaries should be preserved)

- [ ] **Step 4: Evaluate downstream results**

Check that:
- K-means clustering produces cleaner clusters (text pixels excluded more completely)
- Thin coastal regions are NOT destroyed
- The overall pipeline completes without errors

- [ ] **Step 5: Adjust threshold if needed**

If the text mask is too aggressive (catching non-text features), increase `TEXT_THRESHOLD` from 0.3 to 0.4 or 0.5. If it misses small text, decrease to 0.2. Re-run the pipeline after each adjustment.

- [ ] **Step 6: Run full pre-commit suite**

```bash
npm run check && npm run knip && npm run security:all && TEST_REPORT_LOCAL=1 npm test
```

- [ ] **Step 7: Final commit with any threshold adjustments**

If threshold was changed from the default 0.3, commit the adjustment.
