/**
 * The first clean-up a map image gets: the vivid rivers, roads and borders it
 * draws are thin coloured lines, and each such pixel takes the median of its
 * neighbours so the colour clustering sees the regions' fills alone.
 * `rgbToHsl` is the colour-space conversion the rest of the pipeline reads
 * hue and saturation through.
 */

// =============================================================================
// Map noise removal helpers
// =============================================================================

// Two-stage approach:
// Stage 1: Color-targeted removal (vivid blue = rivers, vivid red = roads)
// Stage 2: Outlier-based removal (dark text/labels with boundary context check)

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6;
  else if (max === gf) h = ((bf - rf) / d + 2) / 6;
  else h = ((rf - gf) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** Collect component-wise channel values of non-masked neighbors of (x,y) within radius. */
function collectNeighborChannels(
  src: Buffer, mask: Uint8Array, w: number, h: number,
  x: number, y: number, radius: number,
): { rs: number[]; gs: number[]; bs: number[] } {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= h) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      if (nx < 0 || nx >= w) continue;
      const np = ny * w + nx;
      if (mask[np]) continue;
      rs.push(src[np * 3]);
      gs.push(src[np * 3 + 1]);
      bs.push(src[np * 3 + 2]);
    }
  }
  return { rs, gs, bs };
}

/** Replace noise pixels with component-wise median of non-masked neighbors within given radius */
export function replaceWithNeighborMedian(
  src: Buffer, out: Buffer, mask: Uint8Array,
  w: number, h: number, radius = 5,
): number {
  let replaced = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!mask[p]) continue;
      const { rs, gs, bs } = collectNeighborChannels(src, mask, w, h, x, y, radius);
      if (rs.length >= 3) {
        rs.sort((a, b) => a - b);
        gs.sort((a, b) => a - b);
        bs.sort((a, b) => a - b);
        const mid = Math.floor(rs.length / 2);
        out[p * 3] = rs[mid];
        out[p * 3 + 1] = gs[mid];
        out[p * 3 + 2] = bs[mid];
        replaced++;
      }
    }
  }
  return replaced;
}

/** Count consecutive flagged pixels in one direction from (x,y) using (dx,dy) step, up to maxR. */
function countRun(
  mask: Uint8Array, w: number, h: number,
  x: number, y: number, dx: number, dy: number, maxR: number,
): number {
  let run = 0;
  for (let step = 1; step <= maxR; step++) {
    const nx = x + dx * step;
    const ny = y + dy * step;
    if (nx < 0 || nx >= w || ny < 0 || ny >= h) break;
    if (!mask[ny * w + nx]) break;
    run++;
  }
  return run;
}

/** Measure minimum of horizontal and vertical run lengths of consecutive flagged pixels */
export function minRunLength(mask: Uint8Array, w: number, x: number, y: number, maxR: number): number {
  const h = mask.length / w;
  const hRun = 1
    + countRun(mask, w, h, x, y, 1, 0, maxR)
    + countRun(mask, w, h, x, y, -1, 0, maxR);
  const vRun = 1
    + countRun(mask, w, h, x, y, 0, 1, maxR)
    + countRun(mask, w, h, x, y, 0, -1, maxR);
  return Math.min(hRun, vRun);
}

/** Classify each pixel in `buf` into a color type: 0=keep, 1=blue/cyan, 2=red, 3=yellow. */
function classifyColorPixels(buf: Buffer, tp: number): Uint8Array {
  const ctype = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    const { h: hue, s } = rgbToHsl(buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]);
    if (hue >= 170 && hue <= 270 && s > 20) ctype[i] = 1;
    else if ((hue <= 25 || hue >= 335) && s > 40) ctype[i] = 2;
    else if (hue >= 40 && hue <= 70 && s > 40) ctype[i] = 3;
  }
  return ctype;
}

/** Build a mask of thin colored-line pixels from a color-classified map. */
function buildThinLineMask(
  ctype: Uint8Array, w: number, h: number, maxR: number, maxThick: number,
): Uint8Array {
  const tp = w * h;
  const mask = new Uint8Array(tp);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!ctype[p]) continue;
      if (minRunLength(ctype, w, x, y, maxR) <= maxThick) mask[p] = 1;
    }
  }
  return mask;
}

/** Stage 1: Remove vivid blue (rivers), red (roads) and yellow (roads/borders) thin line features */
export function removeColoredLines(buf: Buffer, w: number, h: number, resScale = 1): number {
  const tp = w * h;
  const maxR = Math.round(14 * resScale);
  const maxThick = Math.round(12 * resScale);
  const medianR = Math.round(5 * resScale);

  // Classify: 0=keep, 1=blue/cyan, 2=red, 3=yellow
  const ctype = classifyColorPixels(buf, tp);

  // Mark thin colored features for removal (no boundary check — rivers/roads are never boundaries)
  const mask = buildThinLineMask(ctype, w, h, maxR, maxThick);

  const out = Buffer.from(buf);
  const replaced = replaceWithNeighborMedian(buf, out, mask, w, h, medianR);
  out.copy(buf);
  return replaced;
}
