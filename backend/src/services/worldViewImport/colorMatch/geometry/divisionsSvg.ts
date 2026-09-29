/**
 * The numbered map of a region's divisions the vision match is shown: each
 * division's outline, a circle at its centroid and its number.
 */

export interface SvgDivision { id: number; name: string; svgPath: string; cx: number; cy: number }

interface GeoBounds { minX: number; minY: number; maxX: number; maxY: number }

/** Extend bounds to include (x, y). */
function extendBounds(bounds: GeoBounds, x: number, y: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxY = Math.max(bounds.maxY, y);
}

/** Compute geographic bounds from all SVG path coordinates across divisions. */
function computeSvgBounds(divisions: SvgDivision[]): GeoBounds {
  const bounds: GeoBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const d of divisions) {
    const nums = d.svgPath.match(/-?\d+\.?\d*/g);
    if (!nums) continue;
    for (let i = 0; i < nums.length; i += 2) {
      extendBounds(bounds, parseFloat(nums[i]), parseFloat(nums[i + 1]));
    }
  }
  return bounds;
}

/** Transform a geo SVG path "M x y L x y ..." into pixel-space coordinates. */
function transformSvgPath(
  svgPath: string, minX: number, minY: number, scaleX: number, scaleY: number,
): string {
  return svgPath.replace(/-?\d+\.?\d*/g, (match, offset: number, str: string) => {
    // Determine whether this number is an X or Y coordinate by counting preceding numbers.
    const before = str.slice(0, offset);
    const numsBefore = before.match(/-?\d+\.?\d*/g);
    const idx = numsBefore ? numsBefore.length : 0;
    const val = parseFloat(match);
    if (idx % 2 === 0) {
      // X coordinate
      return ((val - minX) * scaleX).toFixed(1);
    }
    // Y coordinate (already negated by PostGIS)
    return ((val - minY) * scaleY).toFixed(1);
  });
}

/** Render a single numbered division (path + centroid circle + number) as SVG snippet. */
function renderNumberedDivision(
  d: SvgDivision, num: number,
  bounds: GeoBounds, scaleX: number, scaleY: number,
  fontSize: number, circleR: number,
): string {
  const { minX, minY } = bounds;
  // Transform centroid to pixel space (negate cy to match SVG path convention).
  const px = ((d.cx - minX) * scaleX).toFixed(1);
  const py = ((-d.cy - minY) * scaleY).toFixed(1);
  const pixelPath = transformSvgPath(d.svgPath, minX, minY, scaleX, scaleY);
  return `<path d="${pixelPath}" fill="#ddeeff" stroke="#336" stroke-width="1" opacity="0.8"/>
<circle cx="${px}" cy="${py}" r="${circleR}" fill="white" stroke="#336" stroke-width="0.5" opacity="0.9"/>
<text x="${px}" y="${py}" font-size="${fontSize}" font-family="DejaVu Sans,sans-serif" text-anchor="middle" dominant-baseline="central" fill="#111" font-weight="bold">${num}</text>`;
}

/**
 * Generate an SVG map showing numbered division boundaries.
 * PostGIS ST_AsSVG uses negated Y (SVG convention), so cy becomes -cy for label placement.
 */
export function generateDivisionsSvg(divisions: SvgDivision[]): string {
  const rawBounds = computeSvgBounds(divisions);
  const pad = 0.3;
  const bounds: GeoBounds = {
    minX: rawBounds.minX - pad,
    minY: rawBounds.minY - pad,
    maxX: rawBounds.maxX + pad,
    maxY: rawBounds.maxY + pad,
  };
  const geoW = bounds.maxX - bounds.minX;
  const geoH = bounds.maxY - bounds.minY;

  // Transform everything to pixel space (no viewBox — sharp renders at pixel resolution)
  const svgWidth = 1200;
  const svgHeight = Math.round(svgWidth * (geoH / geoW));
  const scaleX = svgWidth / geoW;
  const scaleY = svgHeight / geoH;

  const fontSize = 11;
  const circleR = 8;

  const paths = divisions.map((d, i) =>
    renderNumberedDivision(d, i + 1, bounds, scaleX, scaleY, fontSize, circleR),
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">
<rect width="${svgWidth}" height="${svgHeight}" fill="#f0f2f5"/>
${paths.join('\n')}
</svg>`;
}
