/**
 * The border preview a reviewer sees first: every division's outline, the
 * country's external border in red and its internal borders dashed in blue,
 * and a dot on each division saying whether it is already held. The rows it
 * draws are loaded by `controllers/admin/wvImportMatchScope.ts`.
 */

import sharp from 'sharp';

interface DivPath { id: number; svgPath: string }

export interface Centroid { id: number; name: string; cx: number; cy: number; assigned: { regionId: number; regionName: string } | null }

export interface BorderData {
  divPaths: DivPath[];
  countryPath: string;
  externalBorder: string | null;
  internalBorder: string | null;
  cMinX: number; cMinY: number; cMaxX: number; cMaxY: number;
}

/** Render the "Step 1" debug image (GADM divisions + classified borders) to PNG. */
export async function renderBorderDebugPng(data: BorderData, centroids: Centroid[]): Promise<Buffer> {
  const { divPaths, countryPath, externalBorder, internalBorder, cMinX, cMinY, cMaxX, cMaxY } = data;
  const pad = 0.5;
  const vbX = cMinX - pad;
  const vbY = -(cMaxY + pad);
  const vbW = (cMaxX - cMinX) + 2 * pad;
  const vbH = (cMaxY - cMinY) + 2 * pad;
  const ss = Math.max(vbW, vbH) / 800;

  const divisionShapes = divPaths.map(d =>
    `<path d="${d.svgPath}" fill="#ddeeff" stroke="#90a4ae" stroke-width="${ss}" fill-opacity="0.7"/>`
  ).join('\n');
  const dots = centroids.map(c => {
    const color = c.assigned ? '#2e7d32' : '#e65100';
    return `<circle cx="${c.cx}" cy="${-c.cy}" r="${ss * 4}" fill="${color}" stroke="white" stroke-width="${ss * 0.5}"/>`;
  }).join('\n');
  const externalPath = externalBorder
    ? `<path d="${externalBorder}" fill="none" stroke="#d32f2f" stroke-width="${ss * 3}" stroke-linecap="round"/>`
    : '';
  const internalPath = internalBorder
    ? `<path d="${internalBorder}" fill="none" stroke="#1565c0" stroke-width="${ss * 2}" stroke-dasharray="${ss * 4},${ss * 3}" stroke-linecap="round"/>`
    : '';

  const borderSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="1600">
    <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#f0f2f5"/>
    <path d="${countryPath}" fill="#e8e8e8" stroke="#bbb" stroke-width="${ss * 0.5}"/>
    ${divisionShapes}
    ${externalPath}
    ${internalPath}
    ${dots}
  </svg>`;
  return sharp(Buffer.from(borderSvg))
    .flatten({ background: '#f0f2f5' })
    .png()
    .toBuffer();
}
