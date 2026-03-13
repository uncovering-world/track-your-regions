import sharp from 'sharp';
import { pendingParkReviews, storeParkCrops, type ParkReviewDecision } from './wvImportMatchReview.js';
import type { PipelineContext } from './wvImportMatchPipeline.js';

/**
 * Park overlay detection and removal phase.
 *
 * Detects dark-saturated-green park overlays within the country mask,
 * prompts user review, then inpaints confirmed parks with boundary colors.
 *
 * Mutates: ctx.colorBuf (park pixels replaced with boundary colors)
 */
export async function detectParks(ctx: PipelineContext): Promise<void> {
  const {
    TW, TH, tp, origW, origH,
    colorBuf, origDownBuf, countryMask, countrySize, waterGrown,
    regionId, pxS, logStep, pushDebugImage, sendEvent,
  } = ctx;

  // ── Park overlay detection & removal ──────────────────────────────────
  // Wikivoyage maps overlay national parks/reserves as dark saturated green
  // blobs on top of region colors. These steal K-means clusters from actual
  // regions. Detect them by: dark + saturated + greenish pixels within the
  // country mask, forming mid-sized blobs that are distinctly darker than
  // their surroundings. Inpaint confirmed parks with per-pixel nearest
  // boundary color (not uniform average) so parks spanning two regions get
  // correct colors on each side.
  await logStep('Detecting park overlays...');

  // Step 1: Find "dark saturated green" candidates in the country mask
  const parkCandidate = new Uint8Array(tp);
  // Compute median brightness of country pixels to set relative threshold
  const brightnesses: number[] = [];
  for (let i = 0; i < tp; i++) {
    if (!countryMask[i]) continue;
    brightnesses.push(Math.max(colorBuf[i * 3], colorBuf[i * 3 + 1], colorBuf[i * 3 + 2]));
  }
  brightnesses.sort((a, b) => a - b);
  const medianV = brightnesses[Math.floor(brightnesses.length / 2)] || 128;
  // Park criterion: dark relative to median, saturated, greenish
  const vThresh = Math.round(medianV * 0.78); // darker than 78% of median (was 72%)
  for (let i = 0; i < tp; i++) {
    if (!countryMask[i]) continue;
    const r = colorBuf[i * 3], g = colorBuf[i * 3 + 1], b2 = colorBuf[i * 3 + 2];
    const maxC = Math.max(r, g, b2);
    const minC = Math.min(r, g, b2);
    const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
    // Dark + saturated + green-dominant (or at least green is high)
    if (maxC <= vThresh && sat >= 0.20 && g >= r && g >= b2 * 0.8) {
      parkCandidate[i] = 1;
    }
  }

  // Step 2: Morphological close to fill small gaps in park blobs
  // Dilation then erosion (kernel scales with resolution to bridge text gaps)
  const PARK_MORPH_R = pxS(2);
  const dilated = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (parkCandidate[i]) { dilated[i] = 1; continue; }
    if (!countryMask[i]) continue;
    const x = i % TW, y = Math.floor(i / TW);
    outer: for (let dy = -PARK_MORPH_R; dy <= PARK_MORPH_R; dy++) {
      for (let dx = -PARK_MORPH_R; dx <= PARK_MORPH_R; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < TW && ny >= 0 && ny < TH && parkCandidate[ny * TW + nx]) { dilated[i] = 1; break outer; }
      }
    }
  }
  const closed = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (!dilated[i]) continue;
    const x = i % TW, y = Math.floor(i / TW);
    let allSet = true;
    for (let dy = -PARK_MORPH_R; dy <= PARK_MORPH_R && allSet; dy++) {
      for (let dx = -PARK_MORPH_R; dx <= PARK_MORPH_R && allSet; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < TW && ny >= 0 && ny < TH) {
          if (!dilated[ny * TW + nx]) allSet = false;
        }
      }
    }
    if (allSet) closed[i] = 1;
  }
  // Use closed mask for CC, but only within country
  const parkMask = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (countryMask[i] && closed[i]) parkMask[i] = 1;
  }

  // Step 3: Connected components + size filter
  const parkVisited = new Uint8Array(tp);
  interface ParkBlob { id: number; pixels: number[]; avgR: number; avgG: number; avgB: number; boundaryAvgColor: [number, number, number] }
  const parkBlobs: ParkBlob[] = [];
  const minParkPx = Math.max(pxS(200), Math.round(countrySize * 0.003)); // >0.3%
  const maxParkPx = Math.round(countrySize * 0.15); // <15% (raised from 4%)
  let blobId = 0;
  for (let i = 0; i < tp; i++) {
    if (!parkMask[i] || parkVisited[i]) continue;
    const pixels: number[] = [];
    const q = [i]; parkVisited[i] = 1; let h = 0;
    while (h < q.length) {
      const p = q[h++]; pixels.push(p);
      for (const n of [p - TW, p + TW, p - 1, p + 1]) {
        if (n >= 0 && n < tp && !parkVisited[n] && parkMask[n]) { parkVisited[n] = 1; q.push(n); }
      }
    }
    const pxPct = (pixels.length / countrySize * 100).toFixed(1);
    if (pixels.length < minParkPx) {
      console.log(`    [Park skip] CC ${pixels.length}px (${pxPct}%) — too small (min=${minParkPx})`);
      continue;
    }
    if (pixels.length > maxParkPx) {
      console.log(`    [Park skip] CC ${pixels.length}px (${pxPct}%) — too large (max=${maxParkPx})`);
      continue;
    }
    // Compute blob average color
    let rr = 0, gg = 0, bb = 0;
    for (const p of pixels) { rr += colorBuf[p * 3]; gg += colorBuf[p * 3 + 1]; bb += colorBuf[p * 3 + 2]; }
    const avgR = Math.round(rr / pixels.length), avgG = Math.round(gg / pixels.length), avgB = Math.round(bb / pixels.length);

    // Step 4: Compute average boundary color for contrast check
    const blobSet = new Set(pixels);
    let bndCount = 0, brSum = 0, bgSum = 0, bbSum = 0;
    for (const p of pixels) {
      for (const n of [p - TW, p + TW, p - 1, p + 1]) {
        if (n >= 0 && n < tp && countryMask[n] && !blobSet.has(n) && !parkMask[n]) {
          brSum += colorBuf[n * 3]; bgSum += colorBuf[n * 3 + 1]; bbSum += colorBuf[n * 3 + 2];
          bndCount++;
        }
      }
    }
    if (bndCount < 10) {
      console.log(`    [Park skip] CC ${pixels.length}px (${pxPct}%) RGB(${avgR},${avgG},${avgB}) — no clear boundary (${bndCount} px)`);
      continue;
    }
    const bndR = Math.round(brSum / bndCount);
    const bndG = Math.round(bgSum / bndCount);
    const bndB = Math.round(bbSum / bndCount);

    // Step 5: Verify contrast — blob must be significantly darker than boundary
    const blobLum = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
    const bndLum = 0.299 * bndR + 0.587 * bndG + 0.114 * bndB;
    if (bndLum < blobLum * 1.12) {
      console.log(`    [Park skip] CC ${pixels.length}px (${pxPct}%) RGB(${avgR},${avgG},${avgB}) — low contrast (blobLum=${blobLum.toFixed(0)} bndLum=${bndLum.toFixed(0)} ratio=${(bndLum/blobLum).toFixed(2)})`);
      continue;
    }

    parkBlobs.push({ id: blobId++, pixels, avgR, avgG, avgB, boundaryAvgColor: [bndR, bndG, bndB] });
  }

  const totalParkPx = parkBlobs.reduce((s, b) => s + b.pixels.length, 0);
  console.log(`  [Park] Detected ${parkBlobs.length} park blob(s), ${totalParkPx}px (${(totalParkPx / countrySize * 100).toFixed(1)}% of country), medianV=${medianV}, vThresh=${vThresh}`);
  for (const pb of parkBlobs) {
    console.log(`    blob ${pb.id}: ${pb.pixels.length}px RGB(${pb.avgR},${pb.avgG},${pb.avgB}) → avg boundary RGB(${pb.boundaryAvgColor})`);
  }

  // Debug: show park detection mask (use origDownBuf for unprocessed original colors)
  const parkVizBuf = Buffer.alloc(tp * 3);
  for (let i = 0; i < tp; i++) {
    if (!countryMask[i]) {
      parkVizBuf[i * 3] = 200; parkVizBuf[i * 3 + 1] = 200; parkVizBuf[i * 3 + 2] = 200;
    } else {
      // Show original colors dimmed, parks highlighted
      parkVizBuf[i * 3] = Math.round(origDownBuf[i * 3] * 0.5 + 100);
      parkVizBuf[i * 3 + 1] = Math.round(origDownBuf[i * 3 + 1] * 0.5 + 100);
      parkVizBuf[i * 3 + 2] = Math.round(origDownBuf[i * 3 + 2] * 0.5 + 100);
    }
  }
  // Highlight confirmed park blobs in red, their boundary color as a ring
  for (const pb of parkBlobs) {
    for (const p of pb.pixels) {
      parkVizBuf[p * 3] = 220; parkVizBuf[p * 3 + 1] = 50; parkVizBuf[p * 3 + 2] = 50;
    }
  }
  const parkVizPng = await sharp(parkVizBuf, {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(
    `Park detection: ${parkBlobs.length} blobs (${(totalParkPx / countrySize * 100).toFixed(1)}% of country, red = detected parks)`,
    `data:image/png;base64,${parkVizPng.toString('base64')}`,
  );

  // Interactive review if parks were found
  if (parkBlobs.length > 0) {
    const reviewId = `pr-${regionId}-${Date.now()}`;
    // Generate crop images for each park blob
    const cropComponents: Array<{ id: number; pct: number; cropDataUrl: string }> = [];
    for (const pb of parkBlobs) {
      // Find bounding box of blob
      let minX = TW, maxX = 0, minY = TH, maxY = 0;
      for (const p of pb.pixels) {
        const x = p % TW, y = Math.floor(p / TW);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      const pad = 15;
      const cx1 = Math.max(0, minX - pad), cy1 = Math.max(0, minY - pad);
      const cx2 = Math.min(TW - 1, maxX + pad), cy2 = Math.min(TH - 1, maxY + pad);
      const cw = cx2 - cx1 + 1, ch = cy2 - cy1 + 1;
      // Render crop: unprocessed original image with 2px red border around park blob
      const cropBuf = Buffer.alloc(cw * ch * 3);
      const blobSet = new Set(pb.pixels);
      // First pass: copy original image
      for (let y = cy1; y <= cy2; y++) {
        for (let x = cx1; x <= cx2; x++) {
          const si = y * TW + x;
          const di = (y - cy1) * cw + (x - cx1);
          cropBuf[di * 3] = origDownBuf[si * 3];
          cropBuf[di * 3 + 1] = origDownBuf[si * 3 + 1];
          cropBuf[di * 3 + 2] = origDownBuf[si * 3 + 2];
        }
      }
      // Second pass: draw 2px red border on edge pixels of the blob
      for (let y = cy1; y <= cy2; y++) {
        for (let x = cx1; x <= cx2; x++) {
          const si = y * TW + x;
          if (!blobSet.has(si)) continue;
          let isEdge = false;
          for (let dy = -1; dy <= 1 && !isEdge; dy++) {
            for (let dx = -1; dx <= 1 && !isEdge; dx++) {
              if (dx === 0 && dy === 0) continue;
              const ni = (y + dy) * TW + (x + dx);
              if (y + dy < 0 || y + dy >= TH || x + dx < 0 || x + dx >= TW || !blobSet.has(ni)) isEdge = true;
            }
          }
          if (isEdge) {
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const py = (y - cy1) + dy, px = (x - cx1) + dx;
                if (py >= 0 && py < ch && px >= 0 && px < cw) {
                  const di = py * cw + px;
                  cropBuf[di * 3] = 220; cropBuf[di * 3 + 1] = 40; cropBuf[di * 3 + 2] = 40;
                }
              }
            }
          }
        }
      }
      const cropPng = await sharp(cropBuf, { raw: { width: cw, height: ch, channels: 3 } }).png().toBuffer();
      const cropDataUrl = `data:image/png;base64,${cropPng.toString('base64')}`;
      cropComponents.push({ id: pb.id, pct: Math.round(pb.pixels.length / countrySize * 1000) / 10, cropDataUrl });
    }

    storeParkCrops(reviewId, cropComponents);
    console.log(`  [Park] Stored ${cropComponents.length} crop(s) for review ${reviewId}`);

    // Send park_review SSE event (like water_review)
    sendEvent({
      type: 'park_review',
      reviewId,
      data: {
        parkCount: parkBlobs.length,
        totalParkPct: Math.round(totalParkPx / countrySize * 1000) / 10,
        components: cropComponents.map(c => ({ id: c.id, pct: c.pct })),
      },
    });
    await new Promise(resolve => setImmediate(resolve));

    // Wait for user to confirm which blobs are parks (5 min timeout → auto-confirm all)
    const decision = await new Promise<ParkReviewDecision>((resolve) => {
      pendingParkReviews.set(reviewId, resolve);
      setTimeout(() => {
        if (pendingParkReviews.has(reviewId)) {
          console.log(`  [Park] Review ${reviewId} timed out — auto-confirming all ${parkBlobs.length} blobs`);
          pendingParkReviews.delete(reviewId);
          resolve({ confirmedIds: parkBlobs.map(b => b.id) });
        }
      }, 300000);
    });

    const confirmedSet = new Set(decision.confirmedIds);
    const confirmedBlobs = parkBlobs.filter(b => confirmedSet.has(b.id));
    console.log(`  [Park] Decision: ${confirmedBlobs.length}/${parkBlobs.length} confirmed as parks`);

    // Inpaint confirmed parks — 3-pass approach:
    //   Pass 1: BFS fill detected blobs + 6px dilation from colorBuf boundary.
    //   Pass 2: Cleanup remaining dark-green remnants via BFS.
    //   Pass 3: Harmonize — each filled pixel adopts the median color of
    //           nearby non-filled country pixels so it clusters correctly.
    if (confirmedBlobs.length > 0) {
      await logStep(`Removing ${confirmedBlobs.length} park overlay(s)...`);

      // ── Pass 1: BFS fill detected blobs + 6px dilation ──
      const confirmedParkMask = new Uint8Array(tp);
      for (const pb of confirmedBlobs) {
        for (const p of pb.pixels) confirmedParkMask[p] = 1;
      }
      const PARK_DILATE = 6;
      const fillZone = new Uint8Array(tp);
      for (let i = 0; i < tp; i++) {
        if (confirmedParkMask[i]) { fillZone[i] = 1; continue; }
        if (!countryMask[i]) continue;
        const ix = i % TW, iy = Math.floor(i / TW);
        for (let dy = -PARK_DILATE; dy <= PARK_DILATE && !fillZone[i]; dy++) {
          for (let dx = -PARK_DILATE; dx <= PARK_DILATE; dx++) {
            const nx = ix + dx, ny = iy + dy;
            if (nx >= 0 && nx < TW && ny >= 0 && ny < TH && confirmedParkMask[ny * TW + nx]) {
              fillZone[i] = 1; break;
            }
          }
        }
      }
      // BFS from boundary — seed from colorBuf (same color space as K-means input)
      const parkFillColor = new Int32Array(tp * 3).fill(-1);
      const bfsQueue: number[] = [];
      const fillSet = new Set<number>();
      for (let i = 0; i < tp; i++) { if (fillZone[i]) fillSet.add(i); }
      for (const p of fillSet) {
        for (const n of [p - TW, p + TW, p - 1, p + 1]) {
          if (n >= 0 && n < tp && countryMask[n] && !fillSet.has(n) && parkFillColor[n * 3] === -1) {
            parkFillColor[n * 3] = colorBuf[n * 3];
            parkFillColor[n * 3 + 1] = colorBuf[n * 3 + 1];
            parkFillColor[n * 3 + 2] = colorBuf[n * 3 + 2];
            bfsQueue.push(n);
          }
        }
      }
      let bfsHead = 0;
      while (bfsHead < bfsQueue.length) {
        const p = bfsQueue[bfsHead++];
        for (const n of [p - TW, p + TW, p - 1, p + 1]) {
          if (n >= 0 && n < tp && fillSet.has(n) && parkFillColor[n * 3] === -1) {
            parkFillColor[n * 3] = parkFillColor[p * 3];
            parkFillColor[n * 3 + 1] = parkFillColor[p * 3 + 1];
            parkFillColor[n * 3 + 2] = parkFillColor[p * 3 + 2];
            bfsQueue.push(n);
          }
        }
      }
      for (const p of fillSet) {
        if (parkFillColor[p * 3] >= 0) {
          colorBuf[p * 3] = parkFillColor[p * 3];
          colorBuf[p * 3 + 1] = parkFillColor[p * 3 + 1];
          colorBuf[p * 3 + 2] = parkFillColor[p * 3 + 2];
        }
      }

      // ── Pass 2: cleanup remaining dark-green remnants ──
      const allFilled = new Uint8Array(tp); // track everything we've filled
      for (const p of fillSet) allFilled[p] = 1;
      const remnant = new Uint8Array(tp);
      let remnantCount = 0;
      for (let i = 0; i < tp; i++) {
        if (!countryMask[i] || allFilled[i]) continue;
        const r = colorBuf[i * 3], g = colorBuf[i * 3 + 1], b2 = colorBuf[i * 3 + 2];
        const maxC = Math.max(r, g, b2);
        const minC = Math.min(r, g, b2);
        const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
        if (maxC <= vThresh && sat >= 0.20 && g >= r && g >= b2 * 0.8) {
          remnant[i] = 1;
          allFilled[i] = 1;
          remnantCount++;
        }
      }
      if (remnantCount > 0) {
        console.log(`  [Park] Pass 2: cleaning ${remnantCount} remnant dark-green px`);
        const remFill = new Int32Array(tp * 3).fill(-1);
        const remQueue: number[] = [];
        for (let i = 0; i < tp; i++) {
          if (!remnant[i]) continue;
          for (const n of [i - TW, i + TW, i - 1, i + 1]) {
            if (n >= 0 && n < tp && countryMask[n] && !allFilled[n] && remFill[n * 3] === -1) {
              remFill[n * 3] = colorBuf[n * 3];
              remFill[n * 3 + 1] = colorBuf[n * 3 + 1];
              remFill[n * 3 + 2] = colorBuf[n * 3 + 2];
              remQueue.push(n);
            }
          }
        }
        let remHead = 0;
        while (remHead < remQueue.length) {
          const p = remQueue[remHead++];
          for (const n of [p - TW, p + TW, p - 1, p + 1]) {
            if (n >= 0 && n < tp && remnant[n] && remFill[n * 3] === -1) {
              remFill[n * 3] = remFill[p * 3];
              remFill[n * 3 + 1] = remFill[p * 3 + 1];
              remFill[n * 3 + 2] = remFill[p * 3 + 2];
              remQueue.push(n);
            }
          }
        }
        for (let i = 0; i < tp; i++) {
          if (remnant[i] && remFill[i * 3] >= 0) {
            colorBuf[i * 3] = remFill[i * 3];
            colorBuf[i * 3 + 1] = remFill[i * 3 + 1];
            colorBuf[i * 3 + 2] = remFill[i * 3 + 2];
          }
        }
      }

      // ── Pass 3: harmonize filled pixels with surrounding region color ──
      // Each filled pixel samples non-filled country pixels within a 10px
      // radius and adopts their median color. This snaps the fill to the
      // actual region interior color so K-means won't separate it.
      const HARMONIZE_R = pxS(10);
      let harmonized = 0;
      for (let i = 0; i < tp; i++) {
        if (!allFilled[i]) continue;
        const ix = i % TW, iy = Math.floor(i / TW);
        const samples: Array<[number, number, number]> = [];
        for (let dy = -HARMONIZE_R; dy <= HARMONIZE_R; dy++) {
          for (let dx = -HARMONIZE_R; dx <= HARMONIZE_R; dx++) {
            if (dx * dx + dy * dy > HARMONIZE_R * HARMONIZE_R) continue;
            const nx = ix + dx, ny = iy + dy;
            if (nx < 0 || nx >= TW || ny < 0 || ny >= TH) continue;
            const ni = ny * TW + nx;
            if (countryMask[ni] && !allFilled[ni]) {
              samples.push([colorBuf[ni * 3], colorBuf[ni * 3 + 1], colorBuf[ni * 3 + 2]]);
            }
          }
        }
        if (samples.length >= 3) {
          samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
          const mid = samples[Math.floor(samples.length / 2)];
          colorBuf[i * 3] = mid[0]; colorBuf[i * 3 + 1] = mid[1]; colorBuf[i * 3 + 2] = mid[2];
          harmonized++;
        }
      }
      console.log(`  [Park] Pass 3: harmonized ${harmonized}/${fillSet.size + remnantCount} filled px`);

      // Debug: show result after park removal
      const afterParkBuf = Buffer.alloc(tp * 3, 200);
      for (let i = 0; i < tp; i++) {
        if (waterGrown[i]) {
          afterParkBuf[i * 3] = 60; afterParkBuf[i * 3 + 1] = 120; afterParkBuf[i * 3 + 2] = 200;
        } else if (countryMask[i]) {
          afterParkBuf[i * 3] = colorBuf[i * 3]; afterParkBuf[i * 3 + 1] = colorBuf[i * 3 + 1]; afterParkBuf[i * 3 + 2] = colorBuf[i * 3 + 2];
        }
      }
      const afterParkPng = await sharp(afterParkBuf, {
        raw: { width: TW, height: TH, channels: 3 },
      }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
      await pushDebugImage(
        `After park removal (${confirmedBlobs.length} parks inpainted with boundary colors)`,
        `data:image/png;base64,${afterParkPng.toString('base64')}`,
      );
    }
  }
}
