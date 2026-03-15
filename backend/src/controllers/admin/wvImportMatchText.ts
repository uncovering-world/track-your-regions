/**
 * Text/symbol detection phase.
 *
 * Detects text and dark symbols using HSV brightness threshold (V < 128),
 * validated against 120 Wikivoyage maps. All WV text colors have V < 50%
 * while all region fills have V >= 50%.
 *
 * After detection, Telea-inpaints text pixels in colorBuf so K-means sees
 * clean region colors. textExcluded is still set as a safety net for K-means
 * centroid exclusion.
 *
 * Sets on ctx: textExcluded, hsvSharp, inpaintedBuf, labBufEarly
 * Modifies: colorBuf (text pixels replaced with Telea-inpainted colors)
 */

import sharp from 'sharp';
import type { PipelineContext } from './wvImportMatchPipeline.js';
import { detectColoredLines } from './wvImportMatchHelpers.js';

export async function detectText(ctx: PipelineContext): Promise<void> {
  const { cv, TH, TW, tp, rawBuf, colorBuf, pxS, RES_SCALE, logStep, pushDebugImage, origW, origH } = ctx;

  await logStep('Text detection (HSV threshold)...');

  // --- HSV of rawBuf — needed by dark CC detection + ocean buffer ---
  const cvRaw = new cv.Mat(TH, TW, cv.CV_8UC3);
  cvRaw.data.set(rawBuf);
  const cvHsvRaw = new cv.Mat();
  cv.cvtColor(cvRaw, cvHsvRaw, cv.COLOR_RGB2HSV);
  const hsvSharp = Buffer.from(cvHsvRaw.data);
  cvHsvRaw.delete();
  // cvRaw kept alive — reused for Telea inpaint on rawBuf below

  // --- HSV text detection: V < 128 on origDownBuf (0-255 scale = 50%) ---
  // 120-map analysis: 100% of WV text colors have V < 50%, 96% of fills V >= 50%.
  // Uses origDownBuf (clean downscale, no median) for accurate brightness values.
  // removeColoredLines already ran on colorBuf, removing bright colored lines
  // (roads, rivers, blue water labels) that would otherwise be kept by this rule.
  const TEXT_V_THRESHOLD = 128;
  const textMask = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    const r = colorBuf[i * 3], g = colorBuf[i * 3 + 1], b = colorBuf[i * 3 + 2];
    const v = Math.max(r, g, b);
    if (v < TEXT_V_THRESHOLD) textMask[i] = 1;
  }

  // --- Dark CC detection: small dark symbol clusters (V < 50 on rawBuf) ---
  // Catches city dots, capital stars, compass fragments, scale bar pieces.
  // Uses a stricter V < 50 threshold and size filter for scattered small symbols
  // that might sit at V just above the main threshold.
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

  // --- Dilate dark text mask ONLY (3×3) before merging colored lines ---
  // Only dark text pixels need dilation (anti-aliased edges).
  // Colored lines are already precisely detected by run-length filter — no dilation.
  const cvTextMask = new cv.Mat(TH, TW, cv.CV_8UC1);
  for (let i = 0; i < tp; i++) cvTextMask.data[i] = textMask[i] ? 255 : 0;
  const dilateK = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
  const textMaskDilated = new cv.Mat();
  cv.dilate(cvTextMask, textMaskDilated, dilateK);
  cvTextMask.delete(); dilateK.delete();

  // --- Colored line detection: blue rivers, red/yellow roads, blue water labels ---
  // Detected as mask only — NO median replacement (which blurs boundaries).
  // Merged AFTER dilation so line pixels don't get inflated.
  const lineMask = detectColoredLines(colorBuf, TW, TH, RES_SCALE);
  let lineCount = 0;
  for (let i = 0; i < tp; i++) {
    if (lineMask[i] && !textMaskDilated.data[i]) {
      textMaskDilated.data[i] = 255;
      lineCount++;
    }
  }
  if (lineCount > 0) console.log(`  [Text] Colored lines: added ${lineCount} pixels (rivers, roads, water labels)`);

  // textExcluded: marks text pixels for K-means exclusion + forced foreground
  const textExcluded = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) if (textMaskDilated.data[i]) textExcluded[i] = 1;

  const textPixelCount = textExcluded.reduce((s, v) => s + v, 0);
  console.log(`  [Text] HSV (V<${TEXT_V_THRESHOLD}): ${textPixelCount} pixels (${(textPixelCount / tp * 100).toFixed(1)}%)`);

  // --- Debug: text mask ---
  const textMaskPng = await sharp(Buffer.from(textMaskDilated.data), {
    raw: { width: TW, height: TH, channels: 1 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(
    'Text mask [HSV V<128] (white = text/symbols detected)',
    `data:image/png;base64,${textMaskPng.toString('base64')}`,
  );

  // --- Debug: colorBuf with text pixels blacked out ---
  if (textPixelCount > 0) {
    const holesViz = Buffer.from(colorBuf);
    for (let i = 0; i < tp; i++) {
      if (textExcluded[i]) { holesViz[i * 3] = 0; holesViz[i * 3 + 1] = 0; holesViz[i * 3 + 2] = 0; }
    }
    const holesPng = await sharp(holesViz, {
      raw: { width: TW, height: TH, channels: 3 },
    }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
    await pushDebugImage(
      'Text removed (black holes)',
      `data:image/png;base64,${holesPng.toString('base64')}`,
    );
  }

  // --- Smart Telea inpaint: only fill SMALL dark CCs (individual text characters) ---
  // Large dark CCs (coastal text bands, boundary strips) stay as-is in colorBuf
  // but are excluded from K-means via textExcluded. BFS label propagation handles them.
  // This prevents Telea from blurring across thin coastal regions.
  if (textPixelCount > 0) {
    // CC analysis on the combined mask to separate small text from large strips
    const ccLabels = new cv.Mat();
    const ccStats = new cv.Mat();
    const ccCents = new cv.Mat();
    const numCC = cv.connectedComponentsWithStats(textMaskDilated, ccLabels, ccStats, ccCents);
    ccCents.delete();

    // Threshold: CCs smaller than 0.1% of image are individual text/symbols → Telea fill
    // CCs larger than 0.1% are coastal strips, large text bands → exclude only, no fill
    const MAX_FILL_SIZE = Math.round(tp * 0.001);
    const smallCCLabels = new Set<number>();
    let smallPixels = 0, largePixels = 0;
    for (let c = 1; c < numCC; c++) {
      const area = ccStats.intAt(c, cv.CC_STAT_AREA);
      if (area <= MAX_FILL_SIZE) {
        smallCCLabels.add(c);
        smallPixels += area;
      } else {
        largePixels += area;
      }
    }
    ccStats.delete();
    console.log(`  [Text] CCs: ${numCC - 1} total, ${smallCCLabels.size} small (${smallPixels}px → Telea fill), ${numCC - 1 - smallCCLabels.size} large (${largePixels}px → exclude only)`);

    // Build inpaint mask for small CCs only
    const inpaintSmall = new cv.Mat(TH, TW, cv.CV_8UC1, new cv.Scalar(0));
    const ccData = ccLabels.data32S;
    for (let i = 0; i < tp; i++) {
      if (ccData[i] > 0 && smallCCLabels.has(ccData[i])) {
        inpaintSmall.data[i] = 255;
      }
    }
    ccLabels.delete();

    // Telea inpaint only small text CCs
    if (smallPixels > 0) {
      const FILL_R = pxS(2); // ~3px — tight around character strokes
      const cvColor = new cv.Mat(TH, TW, cv.CV_8UC3);
      cvColor.data.set(colorBuf);
      const cvFilled = new cv.Mat();
      cv.inpaint(cvColor, inpaintSmall, cvFilled, FILL_R, cv.INPAINT_TELEA);
      const filledData = cvFilled.data;
      for (let i = 0; i < tp; i++) {
        if (inpaintSmall.data[i]) {
          colorBuf[i * 3] = filledData[i * 3];
          colorBuf[i * 3 + 1] = filledData[i * 3 + 1];
          colorBuf[i * 3 + 2] = filledData[i * 3 + 2];
        }
      }
      cvColor.delete(); cvFilled.delete();
    }
    inpaintSmall.delete();

    const filledPng = await sharp(Buffer.from(colorBuf), {
      raw: { width: TW, height: TH, channels: 3 },
    }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
    await pushDebugImage(
      'Text filled (small CCs only, large excluded) — fed to K-means',
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

  textMaskDilated.delete();

  // Convert colorBuf to Lab for later BG detection (now uses Telea-filled version)
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
