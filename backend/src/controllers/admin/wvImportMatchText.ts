/**
 * Text/symbol detection phase.
 *
 * Detects text using PP-OCRv4 DB model (ML) with BlackHat morphology fallback.
 * Dark symbols detected separately via connected-component analysis.
 * Does NOT modify colorBuf — text pixels are marked in textExcluded for downstream exclusion.
 * Also produces inpaintedBuf (Telea on rawBuf) for water detection and labBufEarly for BG detection.
 *
 * Sets on ctx: textExcluded, hsvSharp, inpaintedBuf, labBufEarly
 */

import sharp from 'sharp';
import type { PipelineContext } from './wvImportMatchPipeline.js';
import { getTextDetSession } from '../../services/mlModels.js';

// ---------------------------------------------------------------------------
// ML text detection (PP-OCRv4 DB model)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OrtSession = any;

/** Preprocess image, run ONNX inference, return binary text mask or null on failure. */
async function runMLTextDetection(
  session: OrtSession,
  origDownBuf: Buffer,
  TW: number,
  TH: number,
): Promise<Uint8Array | null> {
  if (origDownBuf.length !== TW * TH * 3) return null;

  const ort = await import('onnxruntime-node');

  // Pad to next multiple of 32 (zero-padding preserves geometry)
  const padW = Math.ceil(TW / 32) * 32;
  const padH = Math.ceil(TH / 32) * 32;

  // Build NCHW Float32 input with ImageNet normalization
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
  // Padded pixels stay 0 — black bands won't trigger text detection

  const inputTensor = new ort.Tensor('float32', inputData, [1, 3, padH, padW]);
  const results = await session.run({ x: inputTensor });

  // Output: probability map — take first output tensor
  const outputTensor = Object.values(results)[0] as { data: Float32Array } | undefined;
  if (!outputTensor) return null;
  const probData = outputTensor.data;

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

// ---------------------------------------------------------------------------
// BlackHat fallback (extracted from original detectText)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectTextBlackHat(
  cv: any, rawBuf: Buffer, TW: number, TH: number, tp: number,
  oddK: (base: number) => number,
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
  const textMaskMat = new cv.Mat();
  cv.threshold(cvBlackHat, textMaskMat, 25, 255, cv.THRESH_BINARY);
  cvBlackHat.delete(); cvGray.delete();
  const mask = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (textMaskMat.data[i]) mask[i] = 1;
  }
  textMaskMat.delete();
  return mask;
}

// ---------------------------------------------------------------------------
// Main detectText phase
// ---------------------------------------------------------------------------

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
      textMask = detectTextBlackHat(cv, rawBuf, TW, TH, tp, oddK);
      detectionMethod = 'BlackHat (fallback)';
    }
  } else {
    await logStep('Text detection (BlackHat — model unavailable)...');
    textMask = detectTextBlackHat(cv, rawBuf, TW, TH, tp, oddK);
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

  // --- Dilate text mask (3×3 — ML mask is precise, smaller than BlackHat's 5×5) ---
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

  // --- Debug: show colorBuf with text pixels removed (holes) ---
  if (textPixelCount > 0) {
    const holesViz = Buffer.from(colorBuf);
    for (let i = 0; i < tp; i++) {
      if (textExcluded[i]) { holesViz[i * 3] = 0; holesViz[i * 3 + 1] = 0; holesViz[i * 3 + 2] = 0; }
    }
    const holesPng = await sharp(holesViz, {
      raw: { width: TW, height: TH, channels: 3 },
    }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
    await pushDebugImage(
      `Text removed (black holes) [${detectionMethod}]`,
      `data:image/png;base64,${holesPng.toString('base64')}`,
    );
  }

  // --- Telea inpaint colorBuf to fill text holes ---
  // With the precise ML mask (text only, no boundaries), Telea smoothly
  // interpolates from surrounding region colors. Small radius since text
  // characters are thin (~3-8px at 800px resolution).
  if (textPixelCount > 0) {
    const FILL_R = pxS(5); // ~8px at TW=800 — covers text character width
    const cvColor = new cv.Mat(TH, TW, cv.CV_8UC3);
    cvColor.data.set(colorBuf);
    const cvFilled = new cv.Mat();
    cv.inpaint(cvColor, textMaskDilated, cvFilled, FILL_R, cv.INPAINT_TELEA);
    // Copy inpainted pixels back into colorBuf
    const filledData = cvFilled.data;
    for (let i = 0; i < tp; i++) {
      if (textExcluded[i]) {
        colorBuf[i * 3] = filledData[i * 3];
        colorBuf[i * 3 + 1] = filledData[i * 3 + 1];
        colorBuf[i * 3 + 2] = filledData[i * 3 + 2];
      }
    }
    cvColor.delete(); cvFilled.delete();
    console.log(`  [Text] Telea inpaint: filled ${textPixelCount} text pixels in colorBuf`);

    // Debug: show the filled result
    const filledPng = await sharp(Buffer.from(colorBuf), {
      raw: { width: TW, height: TH, channels: 3 },
    }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
    await pushDebugImage(
      `Text filled (Telea inpaint) [${detectionMethod}] — fed to K-means`,
      `data:image/png;base64,${filledPng.toString('base64')}`,
    );
  }

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
