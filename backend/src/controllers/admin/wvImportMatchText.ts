/**
 * Text/symbol detection phase.
 *
 * Detects text and dark symbols on rawBuf using BlackHat morphology + dark CC analysis.
 * Does NOT modify colorBuf — text pixels are marked in textExcluded for downstream exclusion.
 * Also produces inpaintedBuf (Telea on rawBuf) for water detection and labBufEarly for BG detection.
 *
 * Sets on ctx: textExcluded, hsvSharp, inpaintedBuf, labBufEarly
 */

import sharp from 'sharp';
import type { PipelineContext } from './wvImportMatchPipeline.js';

export async function detectText(ctx: PipelineContext): Promise<void> {
  const { cv, TH, TW, tp, rawBuf, colorBuf, oddK, pxS, logStep, pushDebugImage, origW, origH } = ctx;

  // --- Step A: Detect text/symbols for exclusion (no colorBuf modification) ---
  // Key insight: we do NOT need to remove text from colorBuf. Every downstream step
  // already handles text via textExcluded:
  //  - K-means: skips text pixels, BFS label propagation fills their labels spatially
  //  - BG detection: forces text as foreground
  //  - Park detection: text is unsaturated (sat ≈ 0), fails park criterion
  // Modifying colorBuf is destructive on thin regions where text covers 50%+ of pixels.
  // Detection uses rawBuf (median-filtered) — conservative, preserves coastal strips.
  await logStep('Text detection (BlackHat + dark spots)...');
  const cvRaw = new cv.Mat(TH, TW, cv.CV_8UC3);
  cvRaw.data.set(rawBuf);
  // HSV of rawBuf for dark spot detection + ocean buffer
  const cvHsvRaw = new cv.Mat();
  cv.cvtColor(cvRaw, cvHsvRaw, cv.COLOR_RGB2HSV);
  const hsvSharp = Buffer.from(cvHsvRaw.data);
  cvHsvRaw.delete();
  // Black Hat = closing - original: highlights dark thin features on lighter bg
  const cvGray = new cv.Mat();
  cv.cvtColor(cvRaw, cvGray, cv.COLOR_RGB2GRAY);
  const bhSize = oddK(11);
  const bhKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(bhSize, bhSize));
  const cvBlackHat = new cv.Mat();
  cv.morphologyEx(cvGray, cvBlackHat, cv.MORPH_BLACKHAT, bhKernel);
  bhKernel.delete();
  const textMask = new cv.Mat();
  cv.threshold(cvBlackHat, textMask, 25, 255, cv.THRESH_BINARY);
  cvBlackHat.delete(); cvGray.delete();
  // Dark spot detection: city dots/symbols (V < 50, small CCs)
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
  for (let c = 1; c < numDarkCC; c++) {
    if (darkStats.intAt(c, cv.CC_STAT_AREA) <= maxDarkSize) {
      for (let i = 0; i < tp; i++) {
        if (darkLabelData[i] === c) textMask.data[i] = 255;
      }
    }
  }
  darkMask.delete(); darkLabels.delete(); darkStats.delete();
  // Dilate text mask to cover anti-aliased text edges
  const textDilateK = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  const textMaskDilated = new cv.Mat();
  cv.dilate(textMask, textMaskDilated, textDilateK);
  textMask.delete(); textDilateK.delete();

  // textExcluded: marks text pixels for K-means exclusion + forced foreground
  const textExcluded = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) if (textMaskDilated.data[i]) textExcluded[i] = 1;

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

  // Extract inpaintedBuf before deleting the Mat
  const inpaintedBuf = Buffer.from(cvInpainted.data);
  cvInpainted.delete();

  // Debug: text mask
  const textMaskPng = await sharp(Buffer.from(textMaskDilated.data), {
    raw: { width: TW, height: TH, channels: 1 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(
    'Text mask (white = detected text/symbols — excluded from K-means, NOT removed from image)',
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
