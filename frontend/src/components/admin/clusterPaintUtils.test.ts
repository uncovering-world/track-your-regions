import { describe, it, expect } from 'vitest';
import {
  floodFillFromSource, overlayToPixelLabels, computeClusterPercentages,
  hexToRgb, rgbToHex, parseRgbString, getDistinctColor,
} from './clusterPaintUtils';
import type { PixelData, PaletteEntry } from './clusterPaintUtils';

function createPixelData(w: number, h: number, fill?: [number, number, number, number]): PixelData {
  const data = new Uint8ClampedArray(w * h * 4);
  if (fill) {
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = fill[0]; data[i * 4 + 1] = fill[1];
      data[i * 4 + 2] = fill[2]; data[i * 4 + 3] = fill[3];
    }
  }
  return { data, width: w, height: h };
}

function setPixel(pd: PixelData, x: number, y: number, r: number, g: number, b: number, a = 255) {
  const i = (y * pd.width + x) * 4;
  pd.data[i] = r; pd.data[i + 1] = g; pd.data[i + 2] = b; pd.data[i + 3] = a;
}

function getPixel(pd: PixelData, x: number, y: number): [number, number, number, number] {
  const i = (y * pd.width + x) * 4;
  return [pd.data[i], pd.data[i + 1], pd.data[i + 2], pd.data[i + 3]];
}

describe('floodFillFromSource (two-canvas: borderData + colorData)', () => {
  it('fills uniform border canvas region, writes to color canvas', () => {
    const border = createPixelData(4, 4, [255, 255, 255, 255]);
    const color = createPixelData(4, 4);
    floodFillFromSource(border, color, 0, 0, [255, 0, 0, 180], 0);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++)
        expect(getPixel(color, x, y)).toEqual([255, 0, 0, 180]);
  });

  it('stops at border canvas color boundaries', () => {
    const border = createPixelData(4, 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 2; x++) setPixel(border, x, y, 255, 0, 0);
      for (let x = 2; x < 4; x++) setPixel(border, x, y, 0, 0, 255);
    }
    const color = createPixelData(4, 4);
    floodFillFromSource(border, color, 0, 0, [0, 255, 0, 180], 0);
    expect(getPixel(color, 1, 2)).toEqual([0, 255, 0, 180]);
    expect(getPixel(color, 2, 0)).toEqual([0, 0, 0, 0]);
  });

  it('crosses through transparent border pixels (erased borders)', () => {
    // Border: left=red, pixel 2=transparent (erased), right=red
    const border = createPixelData(4, 1);
    setPixel(border, 0, 0, 200, 0, 0);
    setPixel(border, 1, 0, 200, 0, 0);
    // pixel 2 left transparent (alpha=0) — erased border
    setPixel(border, 3, 0, 200, 0, 0);

    const color = createPixelData(4, 1);
    floodFillFromSource(border, color, 0, 0, [0, 255, 0, 200], 0);
    expect(getPixel(color, 0, 0)).toEqual([0, 255, 0, 200]); // filled
    expect(getPixel(color, 1, 0)).toEqual([0, 255, 0, 200]); // filled
    expect(getPixel(color, 2, 0)).toEqual([0, 255, 0, 200]); // crossed erased border
    expect(getPixel(color, 3, 0)).toEqual([0, 255, 0, 200]); // filled (same color on other side)
  });

  it('stops at dark drawn border on border canvas', () => {
    // Uniform light region with a dark gray border line at column 2
    const border = createPixelData(4, 4, [200, 200, 200, 255]);
    for (let y = 0; y < 4; y++) setPixel(border, 2, y, 51, 51, 51); // #333

    const color = createPixelData(4, 4);
    floodFillFromSource(border, color, 0, 0, [0, 255, 0, 200], 30);
    expect(getPixel(color, 1, 0)).toEqual([0, 255, 0, 200]); // filled
    expect(getPixel(color, 2, 0)).toEqual([0, 0, 0, 0]);     // dark border, not filled
    expect(getPixel(color, 3, 0)).toEqual([0, 0, 0, 0]);     // beyond border
  });

  it('stops at different-color fills on color canvas', () => {
    const border = createPixelData(4, 1, [200, 200, 200, 255]); // uniform
    const color = createPixelData(4, 1);
    // Pre-fill pixel 2 with red on color canvas
    setPixel(color, 2, 0, 255, 0, 0, 200);

    // Fill blue — should stop at the red fill boundary
    floodFillFromSource(border, color, 0, 0, [0, 0, 255, 200], 100);
    expect(getPixel(color, 0, 0)).toEqual([0, 0, 255, 200]);
    expect(getPixel(color, 1, 0)).toEqual([0, 0, 255, 200]);
    expect(getPixel(color, 2, 0)).toEqual([255, 0, 0, 200]); // red untouched
  });

  it('passes through same-color fills on color canvas', () => {
    const border = createPixelData(4, 1, [200, 200, 200, 255]);
    const color = createPixelData(4, 1);
    setPixel(color, 1, 0, 0, 0, 255, 200); // pre-filled blue

    floodFillFromSource(border, color, 0, 0, [0, 0, 255, 200], 100);
    for (let x = 0; x < 4; x++)
      expect(getPixel(color, x, 0)).toEqual([0, 0, 255, 200]);
  });

  it('does nothing for out-of-bounds start', () => {
    const border = createPixelData(4, 4, [255, 255, 255, 255]);
    const color = createPixelData(4, 4);
    floodFillFromSource(border, color, -1, 0, [255, 0, 0, 180], 0);
    expect(getPixel(color, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe('overlayToPixelLabels', () => {
  it('maps colors to nearest palette entry', () => {
    const overlay = createPixelData(2, 1);
    setPixel(overlay, 0, 0, 255, 0, 0, 255);
    setPixel(overlay, 1, 0, 0, 0, 255, 255);
    const palette: PaletteEntry[] = [
      { label: 0, color: [255, 0, 0] },
      { label: 1, color: [0, 0, 255] },
    ];
    const { pixelLabels, colorCentroids } = overlayToPixelLabels(overlay, palette);
    expect(pixelLabels[0]).toBe(0);
    expect(pixelLabels[1]).toBe(1);
    expect(colorCentroids[0]).toEqual([255, 0, 0]);
    expect(colorCentroids[1]).toEqual([0, 0, 255]);
  });

  it('treats transparent pixels as background (255)', () => {
    const overlay = createPixelData(2, 1);
    setPixel(overlay, 0, 0, 255, 0, 0, 255);
    const { pixelLabels } = overlayToPixelLabels(overlay, [{ label: 0, color: [255, 0, 0] }]);
    expect(pixelLabels[0]).toBe(0);
    expect(pixelLabels[1]).toBe(255);
  });
});

describe('computeClusterPercentages', () => {
  it('computes correct percentages for painted clusters', () => {
    const overlay = createPixelData(4, 1);
    setPixel(overlay, 0, 0, 255, 0, 0, 255);
    setPixel(overlay, 1, 0, 255, 0, 0, 255);
    setPixel(overlay, 2, 0, 0, 0, 255, 255);
    // pixel 3 left transparent
    const palette: PaletteEntry[] = [
      { label: 0, color: [255, 0, 0] },
      { label: 1, color: [0, 0, 255] },
    ];
    const pcts = computeClusterPercentages(overlay, palette);
    // 3 opaque pixels: 2 red (66.7%), 1 blue (33.3%)
    expect(pcts.get(0)).toBeCloseTo(66.7, 0);
    expect(pcts.get(1)).toBeCloseTo(33.3, 0);
  });

  it('returns empty map for fully transparent overlay', () => {
    const overlay = createPixelData(4, 4);
    const pcts = computeClusterPercentages(overlay, [{ label: 0, color: [255, 0, 0] }]);
    expect(pcts.size).toBe(0);
  });
});

describe('getDistinctColor', () => {
  it('returns a hex color string', () => {
    expect(getDistinctColor(0)).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('wraps around after 15 colors', () => {
    expect(getDistinctColor(15)).toBe(getDistinctColor(0));
  });

  it('returns different colors for different indices', () => {
    const colors = new Set(Array.from({ length: 15 }, (_, i) => getDistinctColor(i)));
    expect(colors.size).toBe(15);
  });
});

describe('color helpers', () => {
  it('hexToRgb', () => {
    expect(hexToRgb('#ff0000')).toEqual([255, 0, 0]);
    expect(hexToRgb('00ff00')).toEqual([0, 255, 0]);
  });
  it('rgbToHex', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
  });
  it('parseRgbString', () => {
    expect(parseRgbString('rgb(255, 0, 0)')).toEqual([255, 0, 0]);
    expect(parseRgbString('rgb(0,128,255)')).toEqual([0, 128, 255]);
  });
});
