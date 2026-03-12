/**
 * WorldView Import Match Controller
 *
 * Match review endpoints: stats, accept, reject, batch accept, tree, map images, manual fix.
 */

import { Response } from 'express';
import sharp from 'sharp';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { parseMarkers, parseGeoTag } from '../../services/wikivoyageExtract/markerParser.js';
import { resolveMarkerCoordinates } from '../../services/worldViewImport/pointMatcher.js';
import { matchDivisionsByVision } from '../../services/ai/openaiService.js';
import { matchDivisionsFromClusters } from './wvImportMatchShared.js';

// OpenCV WASM — eagerly initialized at module load to avoid tsx/esbuild overhead during requests.
// tsx transforms every dynamic import() through esbuild, which takes 30s+ for the 10MB opencv.js.
// By importing at module level, the cost is paid once at server startup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Cache OpenCV on globalThis so it survives tsx hot-reloads
// (each hot-reload re-evaluates this module, but globalThis persists)
const G = globalThis as unknown as { __cv?: any; __cvReady?: Promise<void> };
if (!G.__cvReady) {
  G.__cvReady = (async () => {
    try {
      const mod = await import('@techstark/opencv-js') as Record<string, unknown>;
      const cv = (mod.default ?? mod) as Record<string, unknown>;
      for (let i = 0; i < 600 && !cv.Mat; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (cv.Mat) {
        G.__cv = cv;
        console.log('OpenCV WASM initialized');
      } else {
        console.error('OpenCV WASM failed to initialize');
      }
    } catch (err) {
      console.error('OpenCV WASM load error:', err);
    }
  })();
}
// Water review decision: approved components + mix (sub-clustered) components
interface WaterReviewDecision {
  approvedIds: number[];
  mixDecisions: Array<{ componentId: number; approvedSubClusters: number[] }>;
}
// Pending water review callbacks — SSE handler pauses here, POST handler resolves
const pendingWaterReviews = new Map<string, (decision: WaterReviewDecision) => void>();

/** Resolve a pending water review (called from POST endpoint) */
export function resolveWaterReview(reviewId: string, decision: WaterReviewDecision): boolean {
  const resolve = pendingWaterReviews.get(reviewId);
  if (!resolve) return false;
  pendingWaterReviews.delete(reviewId);
  resolve(decision);
  return true;
}

// Water crop image storage — crops served via GET endpoint (avoids SSE bloat)
// Key: "reviewId/componentId/subCluster" → base64 data URL
const waterCropImages = new Map<string, string>();

/** Store water crop images for a review session */
function storeWaterCrops(reviewId: string, components: Array<{ id: number; cropDataUrl: string; subClusters: Array<{ idx: number; cropDataUrl: string }> }>) {
  for (const wc of components) {
    waterCropImages.set(`${reviewId}/${wc.id}/-1`, wc.cropDataUrl);
    for (const sc of wc.subClusters) {
      waterCropImages.set(`${reviewId}/${wc.id}/${sc.idx}`, sc.cropDataUrl);
    }
  }
  // Auto-cleanup after 10 minutes
  setTimeout(() => {
    for (const key of [...waterCropImages.keys()]) {
      if (key.startsWith(`${reviewId}/`)) waterCropImages.delete(key);
    }
  }, 600000);
}

/** Get a stored water crop image (called from GET endpoint) */
export function getWaterCropImage(reviewId: string, componentId: number, subCluster: number): string | undefined {
  return waterCropImages.get(`${reviewId}/${componentId}/${subCluster}`);
}

// Park review — similar to water review but for national park/reserve overlays
interface ParkReviewDecision {
  /** Component IDs confirmed as parks (will be inpainted out) */
  confirmedIds: number[];
}
const pendingParkReviews = new Map<string, (decision: ParkReviewDecision) => void>();

export function resolveParkReview(reviewId: string, decision: ParkReviewDecision): boolean {
  const resolve = pendingParkReviews.get(reviewId);
  if (!resolve) return false;
  pendingParkReviews.delete(reviewId);
  resolve(decision);
  return true;
}

// Park crop images — served via same GET endpoint pattern
const parkCropImages = new Map<string, string>();

function storeParkCrops(reviewId: string, components: Array<{ id: number; cropDataUrl: string }>) {
  for (const pc of components) {
    parkCropImages.set(`${reviewId}/${pc.id}`, pc.cropDataUrl);
  }
  setTimeout(() => {
    for (const key of [...parkCropImages.keys()]) {
      if (key.startsWith(`${reviewId}/`)) parkCropImages.delete(key);
    }
  }, 600000);
}

export function getParkCropImage(reviewId: string, componentId: number): string | undefined {
  return parkCropImages.get(`${reviewId}/${componentId}`);
}

// Cluster review — let user merge small artifact clusters into real ones
interface ClusterReviewDecision {
  /** Map from small cluster label → target cluster label to merge into */
  merges: Record<number, number>;
  /** Cluster labels to exclude entirely (not a real region — set to background) */
  excludes?: number[];
}
export const pendingClusterReviews = new Map<string, (decision: ClusterReviewDecision) => void>();

// Cluster preview images — served via GET endpoint (avoids SSE bloat like water/park crops)
export const clusterPreviewImages = new Map<string, string>();

export function getClusterPreviewImage(reviewId: string): string | undefined {
  return clusterPreviewImages.get(reviewId);
}

export function resolveClusterReview(reviewId: string, decision: ClusterReviewDecision): boolean {
  const resolve = pendingClusterReviews.get(reviewId);
  if (!resolve) return false;
  pendingClusterReviews.delete(reviewId);
  resolve(decision);
  return true;
}

// =============================================================================
// Shared helpers
// =============================================================================

// SVG path helpers (parseSvgPathPoints, parseSvgSubPaths, resamplePath) live in wvImportMatchShared.ts

// --- Map noise removal: remove rivers, roads, and text labels from region maps ---
// Two-stage approach:
// Stage 1: Color-targeted removal (vivid blue = rivers, vivid red = roads)
// Stage 2: Outlier-based removal (dark text/labels with boundary context check)

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
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

/** Replace noise pixels with component-wise median of non-masked neighbors within given radius */
function replaceWithNeighborMedian(
  src: Buffer, out: Buffer, mask: Uint8Array,
  w: number, h: number, radius = 5,
): number {
  let replaced = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!mask[p]) continue;
      const rs: number[] = [], gs: number[] = [], bs: number[] = [];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
          const np = ny * w + nx;
          if (mask[np]) continue;
          rs.push(src[np * 3]); gs.push(src[np * 3 + 1]); bs.push(src[np * 3 + 2]);
        }
      }
      if (rs.length >= 3) {
        rs.sort((a, b) => a - b);
        gs.sort((a, b) => a - b);
        bs.sort((a, b) => a - b);
        const mid = Math.floor(rs.length / 2);
        out[p * 3] = rs[mid]; out[p * 3 + 1] = gs[mid]; out[p * 3 + 2] = bs[mid];
        replaced++;
      }
    }
  }
  return replaced;
}

/** Measure minimum of horizontal and vertical run lengths of consecutive flagged pixels */
function minRunLength(mask: Uint8Array, w: number, x: number, y: number, maxR: number): number {
  const p = y * w + x;
  let hRun = 1;
  for (let dx = 1; dx <= maxR && x + dx < w; dx++) {
    if (mask[p + dx]) hRun++; else break;
  }
  for (let dx = 1; dx <= maxR && x - dx >= 0; dx++) {
    if (mask[p - dx]) hRun++; else break;
  }
  let vRun = 1;
  const h = mask.length / w;
  for (let dy = 1; dy <= maxR && y + dy < h; dy++) {
    if (mask[(y + dy) * w + x]) vRun++; else break;
  }
  for (let dy = 1; dy <= maxR && y - dy >= 0; dy++) {
    if (mask[(y - dy) * w + x]) vRun++; else break;
  }
  return Math.min(hRun, vRun);
}

/** Stage 1: Remove vivid blue (rivers), red (roads) and yellow (roads/borders) thin line features */
function removeColoredLines(buf: Buffer, w: number, h: number, resScale = 1): number {
  const tp = w * h;
  const maxR = Math.round(14 * resScale);
  const maxThick = Math.round(12 * resScale);
  const medianR = Math.round(5 * resScale);
  // Classify: 0=keep, 1=blue/cyan, 2=red, 3=yellow
  const ctype = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    const { h: hue, s } = rgbToHsl(buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]);
    if (hue >= 170 && hue <= 270 && s > 20) ctype[i] = 1;
    else if ((hue <= 25 || hue >= 335) && s > 40) ctype[i] = 2;
    else if (hue >= 40 && hue <= 70 && s > 40) ctype[i] = 3;
  }

  // Mark thin colored features for removal (no boundary check — rivers/roads are never boundaries)
  const mask = new Uint8Array(tp);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!ctype[p]) continue;
      if (minRunLength(ctype, w, x, y, maxR) <= maxThick) mask[p] = 1;
    }
  }

  const out = Buffer.from(buf);
  const replaced = replaceWithNeighborMedian(buf, out, mask, w, h, medianR);
  out.copy(buf);
  return replaced;
}

/** Stage 2: Remove dark/text outlier features that sit within a single color region */
type PointInfo = { name: string; lat: number; lon: number };

interface SvgDivision { id: number; name: string; svgPath: string; cx: number; cy: number }

/**
 * Generate an SVG map showing numbered division boundaries.
 * PostGIS ST_AsSVG uses negated Y (SVG convention), so cy becomes -cy for label placement.
 */
function generateDivisionsSvg(divisions: SvgDivision[]): string {
  // Compute bounding box from SVG path coordinates
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of divisions) {
    const nums = d.svgPath.match(/-?\d+\.?\d*/g);
    if (!nums) continue;
    for (let i = 0; i < nums.length; i += 2) {
      const x = parseFloat(nums[i]);
      const y = parseFloat(nums[i + 1]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const pad = 0.3;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const geoW = maxX - minX;
  const geoH = maxY - minY;

  // Transform everything to pixel space (no viewBox — sharp renders at pixel resolution)
  const svgWidth = 1200;
  const svgHeight = Math.round(svgWidth * (geoH / geoW));
  const scaleX = svgWidth / geoW;
  const scaleY = svgHeight / geoH;

  // Transform a geo SVG path "M x y L x y ..." to pixel coordinates
  function transformPath(svgPath: string): string {
    return svgPath.replace(/-?\d+\.?\d*/g, (match, offset, str) => {
      // Determine if this is X or Y by counting preceding numbers
      const before = str.slice(0, offset);
      const numsBefore = before.match(/-?\d+\.?\d*/g);
      const idx = numsBefore ? numsBefore.length : 0;
      const val = parseFloat(match);
      if (idx % 2 === 0) {
        // X coordinate
        return ((val - minX) * scaleX).toFixed(1);
      } else {
        // Y coordinate (already negated by PostGIS)
        return ((val - minY) * scaleY).toFixed(1);
      }
    });
  }

  const fontSize = 11;
  const circleR = 8;

  const paths = divisions.map((d, i) => {
    const num = i + 1;
    // Transform centroid to pixel space (negate cy to match SVG path convention)
    const px = ((d.cx - minX) * scaleX).toFixed(1);
    const py = ((-d.cy - minY) * scaleY).toFixed(1);
    const pixelPath = transformPath(d.svgPath);
    return `<path d="${pixelPath}" fill="#ddeeff" stroke="#336" stroke-width="1" opacity="0.8"/>
<circle cx="${px}" cy="${py}" r="${circleR}" fill="white" stroke="#336" stroke-width="0.5" opacity="0.9"/>
<text x="${px}" y="${py}" font-size="${fontSize}" font-family="DejaVu Sans,sans-serif" text-anchor="middle" dominant-baseline="central" fill="#111" font-weight="bold">${num}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">
<rect width="${svgWidth}" height="${svgHeight}" fill="#f0f2f5"/>
${paths.join('\n')}
</svg>`;
}

/**
 * Fetch Wikivoyage markers for a region, check which divisions contain them.
 * Returns the points and the set of division IDs that contain at least one point.
 */
async function fetchMarkersForDivisions(
  regionId: number,
  divisionIds: number[],
): Promise<{ points: PointInfo[]; divisionsWithPoints: Set<number> }> {
  const points: PointInfo[] = [];
  const divisionsWithPoints = new Set<number>();

  if (divisionIds.length === 0) return { points, divisionsWithPoints };

  try {
    const srcResult = await pool.query(
      `SELECT source_url FROM region_import_state WHERE region_id = $1`,
      [regionId],
    );
    const sourceUrl = srcResult.rows[0]?.source_url as string | undefined;
    if (!sourceUrl) return { points, divisionsWithPoints };

    const pageTitle = decodeURIComponent(
      sourceUrl.replace('https://en.wikivoyage.org/wiki/', ''),
    );

    const url = new URL('https://en.wikivoyage.org/w/api.php');
    url.searchParams.set('action', 'parse');
    url.searchParams.set('page', pageTitle);
    url.searchParams.set('prop', 'wikitext');
    url.searchParams.set('format', 'json');

    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': 'TrackYourRegions/1.0' },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { points, divisionsWithPoints };

    const data = await resp.json() as { parse?: { wikitext?: { '*': string } } };
    const wikitext = data.parse?.wikitext?.['*'] ?? '';
    if (!wikitext) return { points, divisionsWithPoints };

    const markers = parseMarkers(wikitext);
    let resolved = await resolveMarkerCoordinates(markers);

    if (resolved.length === 0) {
      const geo = parseGeoTag(wikitext);
      if (geo) {
        resolved = [{ name: pageTitle, lat: geo.lat, lon: geo.lon, wikidataId: null }];
      }
    }

    if (resolved.length > 0) {
      const containResult = await pool.query(`
        SELECT ad.id AS division_id, p.idx
        FROM administrative_divisions ad,
          LATERAL unnest($2::double precision[], $3::double precision[])
            WITH ORDINALITY AS p(lon, lat, idx)
        WHERE ad.id = ANY($1)
          AND ad.geom_simplified_medium IS NOT NULL
          AND ST_Contains(ad.geom_simplified_medium, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326))
      `, [divisionIds, resolved.map(p => p.lon), resolved.map(p => p.lat)]);

      for (const row of containResult.rows) {
        divisionsWithPoints.add(row.division_id as number);
      }
      for (const p of resolved) {
        points.push({ name: p.name, lat: p.lat, lon: p.lon });
      }
    }
  } catch (err) {
    console.warn('[fetchMarkersForDivisions] Failed:', err instanceof Error ? err.message : err);
  }

  return { points, divisionsWithPoints };
}

// =============================================================================
// Match review endpoints
// =============================================================================

/**
 * Get match statistics for a world view.
 * GET /api/admin/wv-import/matches/:worldViewId/stats
 */
export async function getMatchStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  console.log(`[WV Import] GET /matches/${worldViewId}/stats`);

  const result = await pool.query(`
    WITH RECURSIVE ancestor_walk AS (
      -- Seed: each region's direct parent
      SELECT r.id AS region_id, r.parent_region_id AS ancestor_id
      FROM regions r
      WHERE r.world_view_id = $1 AND r.parent_region_id IS NOT NULL
      UNION ALL
      -- Walk up
      SELECT aw.region_id, reg.parent_region_id
      FROM ancestor_walk aw
      JOIN regions reg ON reg.id = aw.ancestor_id
      WHERE reg.parent_region_id IS NOT NULL
    ),
    covered_by_ancestor AS (
      -- Regions where an ancestor has assigned GADM divisions
      SELECT DISTINCT aw.region_id
      FROM ancestor_walk aw
      JOIN region_members rm ON rm.region_id = aw.ancestor_id
      WHERE aw.ancestor_id IS NOT NULL
    ),
    -- Leaf descendants that are NOT resolved (not matched and not covered by ancestor)
    unresolved_leaves AS (
      SELECT r.id AS region_id
      FROM regions r
      JOIN region_import_state ris ON ris.region_id = r.id
      WHERE r.world_view_id = $1
        AND r.is_leaf = true
        AND ris.match_status NOT IN ('auto_matched', 'manual_matched', 'children_matched')
        AND r.id NOT IN (SELECT region_id FROM covered_by_ancestor)
    ),
    -- Walk unresolved leaves up to find which ancestors have at least one unresolved leaf
    has_unresolved_desc AS (
      -- Seed: unresolved leaves themselves
      SELECT ul.region_id
      FROM unresolved_leaves ul
      UNION
      -- Walk up: parent of an unresolved region also has unresolved descendants
      SELECT r.parent_region_id
      FROM has_unresolved_desc hud
      JOIN regions r ON r.id = hud.region_id
      WHERE r.parent_region_id IS NOT NULL
    )
    SELECT
      COUNT(*) FILTER (WHERE ris.match_status = 'auto_matched') AS auto_matched,
      COUNT(*) FILTER (WHERE ris.match_status = 'children_matched') AS children_matched,
      COUNT(*) FILTER (WHERE ris.match_status = 'needs_review') AS needs_review,
      COUNT(*) FILTER (
        WHERE ris.match_status = 'needs_review'
          AND r.id NOT IN (SELECT region_id FROM covered_by_ancestor)
      ) AS needs_review_blocking,
      COUNT(*) FILTER (WHERE ris.match_status = 'no_candidates') AS no_candidates,
      COUNT(*) FILTER (
        WHERE ris.match_status = 'no_candidates'
          AND r.id NOT IN (SELECT region_id FROM covered_by_ancestor)
          AND r.id IN (SELECT region_id FROM has_unresolved_desc)
      ) AS no_candidates_blocking,
      COUNT(*) FILTER (WHERE ris.match_status = 'manual_matched') AS manual_matched,
      COUNT(*) FILTER (WHERE ris.match_status = 'suggested') AS suggested,
      COUNT(*) FILTER (WHERE ris.match_status IS NOT NULL) AS total_matched,
      COUNT(*) FILTER (WHERE r.is_leaf = true) AS total_leaves,
      COUNT(*) AS total_regions,
      COUNT(*) FILTER (
        WHERE array_length(ris.hierarchy_warnings, 1) > 0
          AND ris.hierarchy_reviewed = false
      ) AS hierarchy_warnings_count
    FROM regions r
    LEFT JOIN region_import_state ris ON ris.region_id = r.id
    WHERE r.world_view_id = $1
  `, [worldViewId]);

  res.json(result.rows[0]);
}

/**
 * Accept a single match (assign division to region).
 * Removes the accepted suggestion and keeps needs_review if more remain.
 * POST /api/admin/wv-import/matches/:worldViewId/accept
 */
export async function acceptMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, divisionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/accept — regionId=${regionId}, divisionId=${divisionId}`);

  // Verify region exists and belongs to the specified world view
  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  // Create region member
  await pool.query(
    `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [regionId, divisionId],
  );

  // Remove accepted suggestion
  await pool.query(
    `DELETE FROM region_match_suggestions WHERE region_id = $1 AND division_id = $2 AND rejected = false`,
    [regionId, divisionId],
  );

  // Decide new status based on remaining non-rejected suggestions
  const remainingResult = await pool.query(
    `SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
    [regionId],
  );
  const remainingCount = parseInt(remainingResult.rows[0].count as string);
  const newStatus = remainingCount > 0 ? 'needs_review' : 'manual_matched';

  await pool.query(
    `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
    [newStatus, regionId],
  );

  res.json({ accepted: true });
}

/**
 * Reject (dismiss) a single suggestion without accepting it.
 * POST /api/admin/wv-import/matches/:worldViewId/reject
 */
export async function rejectMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, divisionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/reject — regionId=${regionId}, divisionId=${divisionId}`);

  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  // Mark suggestion as rejected (prevents re-suggestion)
  await pool.query(
    `UPDATE region_match_suggestions SET rejected = true WHERE region_id = $1 AND division_id = $2`,
    [regionId, divisionId],
  );

  // Also remove from region_members if it was assigned
  await pool.query(
    'DELETE FROM region_members WHERE region_id = $1 AND division_id = $2',
    [regionId, divisionId],
  );

  // Determine new status based on remaining non-rejected suggestions and assigned members
  const remainingResult = await pool.query(
    `SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
    [regionId],
  );
  const remainingCount = parseInt(remainingResult.rows[0].count as string);

  let newStatus: string;
  if (remainingCount > 0) {
    newStatus = 'needs_review';
  } else {
    const memberCount = await pool.query(
      'SELECT COUNT(*) FROM region_members WHERE region_id = $1',
      [regionId],
    );
    const hasMembers = parseInt(memberCount.rows[0].count as string) > 0;
    newStatus = hasMembers ? 'manual_matched' : 'no_candidates';
  }

  await pool.query(
    `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
    [newStatus, regionId],
  );

  res.json({ rejected: true });
}

/**
 * Reject all remaining suggestions for a region.
 * POST /api/admin/wv-import/matches/:worldViewId/reject-remaining
 */
export async function rejectRemaining(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/reject-remaining — regionId=${regionId}`);

  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  // Count non-rejected suggestions before marking them
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
    [regionId],
  );
  const suggestionCount = parseInt(countResult.rows[0].count as string);

  if (suggestionCount === 0) {
    res.json({ rejected: 0 });
    return;
  }

  // Mark all non-rejected suggestions as rejected
  await pool.query(
    `UPDATE region_match_suggestions SET rejected = true WHERE region_id = $1 AND rejected = false`,
    [regionId],
  );

  // Determine new status: has assignments -> manual_matched, else no_candidates
  const memberCount = await pool.query(
    'SELECT COUNT(*) FROM region_members WHERE region_id = $1',
    [regionId],
  );
  const hasMembers = parseInt(memberCount.rows[0].count as string) > 0;
  const newStatus = hasMembers ? 'manual_matched' : 'no_candidates';

  await pool.query(
    `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
    [newStatus, regionId],
  );

  res.json({ rejected: suggestionCount });
}

/**
 * Remove all assigned divisions (region_members) for a region, keeping suggestions intact.
 * POST /api/admin/wv-import/matches/:worldViewId/clear-members
 */
export async function clearMembers(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/clear-members — regionId=${regionId}`);

  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  const deleted = await pool.query(
    'DELETE FROM region_members WHERE region_id = $1 RETURNING id',
    [regionId],
  );

  // Update status based on remaining suggestions
  const remaining = await pool.query(
    'SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false',
    [regionId],
  );
  const hasSuggestions = parseInt(remaining.rows[0].count as string) > 0;
  const newStatus = hasSuggestions ? 'needs_review' : 'no_candidates';

  await pool.query(
    'UPDATE region_import_state SET match_status = $1 WHERE region_id = $2',
    [newStatus, regionId],
  );

  res.json({ cleared: deleted.rowCount });
}

/**
 * Accept a match AND reject all remaining suggestions in a single transaction.
 * Replaces the chained acceptMatch + rejectRemaining calls.
 * POST /api/admin/wv-import/matches/:worldViewId/accept-and-reject
 */
export async function acceptAndRejectRest(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, divisionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/accept-and-reject — regionId=${regionId}, divisionId=${divisionId}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify region exists and belongs to the specified world view
    const region = await client.query(
      'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (region.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Region not found in this world view' });
      return;
    }

    // Create region member
    await client.query(
      `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [regionId, divisionId],
    );

    // Reject all remaining non-rejected suggestions (except the accepted one, which we delete)
    await client.query(
      `UPDATE region_match_suggestions SET rejected = true
       WHERE region_id = $1 AND division_id != $2 AND rejected = false`,
      [regionId, divisionId],
    );

    // Delete the accepted suggestion itself
    await client.query(
      `DELETE FROM region_match_suggestions WHERE region_id = $1 AND division_id = $2 AND rejected = false`,
      [regionId, divisionId],
    );

    // Set status to manual_matched (we accepted one and rejected all others)
    await client.query(
      `UPDATE region_import_state SET match_status = 'manual_matched' WHERE region_id = $1`,
      [regionId],
    );

    await client.query('COMMIT');
    res.json({ accepted: true, rejected: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Accept a batch of matches.
 * POST /api/admin/wv-import/matches/:worldViewId/accept-batch
 */
export async function acceptBatchMatches(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  console.log(`[WV Import] POST /matches/${worldViewId}/accept-batch — ${req.body?.assignments?.length ?? 0} assignments`);
  const { assignments } = req.body as {
    assignments: Array<{ regionId: number; divisionId: number }>;
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let accepted = 0;
    for (const { regionId, divisionId } of assignments) {
      // Verify region belongs to this world view
      const check = await client.query(
        'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
        [regionId, worldViewId],
      );
      if (check.rows.length === 0) continue;

      // Create region member
      const result = await client.query(
        `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING id`,
        [regionId, divisionId],
      );

      if (result.rows.length > 0) {
        accepted++;
      }

      // Remove accepted suggestion
      await client.query(
        `DELETE FROM region_match_suggestions WHERE region_id = $1 AND division_id = $2 AND rejected = false`,
        [regionId, divisionId],
      );
    }

    // Update import state for each unique region
    const uniqueRegionIds = [...new Set(assignments.map(a => a.regionId))];
    for (const regionId of uniqueRegionIds) {
      const remainingResult = await client.query(
        `SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
        [regionId],
      );
      const remainingCount = parseInt(remainingResult.rows[0].count as string);
      const newStatus = remainingCount > 0 ? 'needs_review' : 'manual_matched';
      await client.query(
        `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
        [newStatus, regionId],
      );
    }

    await client.query('COMMIT');
    res.json({ accepted });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get region tree with match status for hierarchical review.
 * GET /api/admin/wv-import/matches/:worldViewId/tree
 */
export async function getMatchTree(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  console.log(`[WV Import] GET /matches/${worldViewId}/tree`);

  const result = await pool.query(`
    SELECT
      r.id,
      r.name,
      r.parent_region_id,
      r.is_leaf,
      ris.match_status,
      ris.source_url,
      ris.region_map_url,
      ris.map_image_reviewed,
      ris.needs_manual_fix,
      ris.fix_note,
      ris.source_external_id AS wikidata_id,
      ris.hierarchy_warnings,
      ris.hierarchy_reviewed,
      COALESCE(ris.geo_available, (
        SELECT NOT wg.not_available FROM wikidata_geoshapes wg
        WHERE wg.wikidata_id = ris.source_external_id
      )) AS geo_available,
      (SELECT COALESCE(json_agg(json_build_object(
        'divisionId', rms.division_id, 'name', rms.name, 'path', rms.path, 'score', rms.score, 'geoSimilarity', rms.geo_similarity
      ) ORDER BY rms.score DESC), '[]'::json)
      FROM region_match_suggestions rms WHERE rms.region_id = r.id AND rms.rejected = false) AS suggestions,
      (SELECT COALESCE(json_agg(rmi.image_url), '[]'::json)
      FROM region_map_images rmi WHERE rmi.region_id = r.id) AS map_image_candidates,
      (SELECT COUNT(*) FROM region_members rm WHERE rm.region_id = r.id) AS member_count,
      (
        SELECT COALESCE(json_agg(json_build_object(
          'divisionId', ad.id,
          'name', ad.name,
          'path', (
            WITH RECURSIVE div_ancestors AS (
              SELECT ad.id, ad.name, ad.parent_id
              UNION ALL
              SELECT d.id, d.name, d.parent_id
              FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.parent_id
            )
            SELECT string_agg(name, ' > ' ORDER BY id) FROM div_ancestors
          ),
          'hasCustomGeom', rm.custom_geom IS NOT NULL
        ) ORDER BY ad.name), '[]'::json)
        FROM region_members rm
        JOIN administrative_divisions ad ON rm.division_id = ad.id
        WHERE rm.region_id = r.id
      ) AS assigned_divisions
    FROM regions r
    LEFT JOIN region_import_state ris ON ris.region_id = r.id
    WHERE r.world_view_id = $1
    ORDER BY r.name
  `, [worldViewId]);

  // Build tree in memory
  interface TreeNode {
    id: number;
    name: string;
    isLeaf: boolean;
    matchStatus: string | null;
    suggestions: Array<{ divisionId: number; name: string; path: string; score: number; geoSimilarity: number | null }>;
    sourceUrl: string | null;
    regionMapUrl: string | null;
    mapImageCandidates: string[];
    mapImageReviewed: boolean;
    needsManualFix: boolean;
    fixNote: string | null;
    wikidataId: string | null;
    memberCount: number;
    assignedDivisions: Array<{ divisionId: number; name: string; path: string; hasCustomGeom: boolean }>;
    hierarchyWarnings: string[];
    hierarchyReviewed: boolean;
    geoAvailable: boolean | null;
    children: TreeNode[];
  }

  const nodesById = new Map<number, TreeNode>();
  const roots: TreeNode[] = [];

  // Create all nodes
  for (const row of result.rows) {
    nodesById.set(row.id as number, {
      id: row.id as number,
      name: row.name as string,
      isLeaf: row.is_leaf as boolean,
      matchStatus: row.match_status as string | null,
      suggestions: (row.suggestions as TreeNode['suggestions']) ?? [],
      sourceUrl: row.source_url as string | null,
      regionMapUrl: row.region_map_url as string | null,
      mapImageCandidates: (row.map_image_candidates as string[]) ?? [],
      mapImageReviewed: row.map_image_reviewed === true,
      needsManualFix: row.needs_manual_fix === true,
      fixNote: row.fix_note as string | null,
      wikidataId: row.wikidata_id as string | null,
      memberCount: parseInt(row.member_count as string),
      assignedDivisions: (row.assigned_divisions as TreeNode['assignedDivisions']) ?? [],
      hierarchyWarnings: (row.hierarchy_warnings as string[]) ?? [],
      hierarchyReviewed: row.hierarchy_reviewed === true,
      geoAvailable: (row.geo_available as boolean | null) ?? null,
      children: [],
    });
  }

  // Wire parent-child relationships
  for (const row of result.rows) {
    const node = nodesById.get(row.id as number)!;
    const parentId = row.parent_region_id as number | null;
    if (parentId && nodesById.has(parentId)) {
      nodesById.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  res.json(roots);
}

/**
 * Select a map image from candidates for a region.
 * POST /api/admin/wv-import/matches/:worldViewId/select-map-image
 */
export async function selectMapImage(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, imageUrl } = req.body as { regionId: number; imageUrl: string | null };
  console.log(`[WV Import] POST /matches/${worldViewId}/select-map-image — regionId=${regionId}, imageUrl=${imageUrl ? '(url)' : 'null'}`);

  // Verify region exists and belongs to the specified world view
  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  // Validate imageUrl is in the candidates list (prevent arbitrary URL injection)
  if (imageUrl !== null) {
    const candidatesResult = await pool.query(
      `SELECT image_url FROM region_map_images WHERE region_id = $1`,
      [regionId],
    );
    const candidates = candidatesResult.rows.map(r => r.image_url as string);
    if (!candidates.includes(imageUrl)) {
      res.status(400).json({ error: 'Image URL is not in the candidates list' });
      return;
    }
  }

  if (imageUrl !== null) {
    await pool.query(
      `UPDATE region_import_state SET region_map_url = $1, map_image_reviewed = true WHERE region_id = $2`,
      [imageUrl, regionId],
    );
  } else {
    await pool.query(
      `UPDATE region_import_state SET region_map_url = NULL, map_image_reviewed = true WHERE region_id = $1`,
      [regionId],
    );
  }

  res.json({ selected: true });
}

/**
 * Mark/unmark a region as needing manual fixes in WorldEditor.
 * POST /api/admin/wv-import/matches/:worldViewId/mark-manual-fix
 */
export async function markManualFix(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, needsManualFix, fixNote } = req.body as { regionId: number; needsManualFix: boolean; fixNote?: string };

  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  await pool.query(
    `UPDATE region_import_state SET needs_manual_fix = $1, fix_note = $2 WHERE region_id = $3`,
    [needsManualFix, needsManualFix ? (fixNote ?? null) : null, regionId],
  );

  res.json({ updated: true });
}

/**
 * Return per-division geometries as a FeatureCollection with assignment info.
 * POST /api/admin/wv-import/matches/:worldViewId/union-geometry
 */
export async function getUnionGeometry(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionIds, regionId } = req.body as { divisionIds: number[]; regionId?: number };

  // Check which divisions are already assigned to regions in this world view
  const assignedResult = await pool.query(`
    SELECT rm.division_id, r.name AS region_name
    FROM region_members rm
    JOIN regions r ON r.id = rm.region_id
    WHERE rm.division_id = ANY($1) AND r.world_view_id = $2
  `, [divisionIds, worldViewId]);
  const assignedMap = new Map<number, string>();
  for (const row of assignedResult.rows) {
    assignedMap.set(row.division_id as number, row.region_name as string);
  }

  const result = await pool.query(`
    SELECT ad.id, ad.name, ST_AsGeoJSON(
      ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ad.geom_simplified_medium), 3
      ))
    ) AS geojson
    FROM administrative_divisions ad
    WHERE ad.id = ANY($1) AND ad.geom_simplified_medium IS NOT NULL
  `, [divisionIds]);

  // Fetch markers when regionId is provided
  const { points, divisionsWithPoints } = regionId
    ? await fetchMarkersForDivisions(regionId, divisionIds)
    : { points: [] as PointInfo[], divisionsWithPoints: new Set<number>() };

  const features: Array<{ type: 'Feature'; properties: Record<string, unknown>; geometry: unknown }> = [];
  for (const row of result.rows) {
    if (row.geojson) {
      const divId = row.id as number;
      const assignedTo = assignedMap.get(divId);
      features.push({
        type: 'Feature',
        properties: {
          name: row.name as string,
          divisionId: divId,
          hasPoints: divisionsWithPoints.has(divId),
          ...(assignedTo ? { assignedTo } : {}),
        },
        geometry: JSON.parse(row.geojson as string),
      });
    }
  }

  // Add point markers
  for (const p of points) {
    features.push({
      type: 'Feature',
      properties: { name: p.name, isMarker: true },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    });
  }

  if (features.length === 0) {
    res.status(404).json({ error: 'No geometry found for given divisions' });
    return;
  }
  res.json({ geometry: { type: 'FeatureCollection', features } });
}

/**
 * Split divisions deeper: replace each given division with its GADM children
 * that intersect the region's geoshape. Returns the new set of division IDs
 * with their coverage and union geometry.
 *
 * POST /api/admin/wv-import/matches/:worldViewId/split-deeper
 */
export async function splitDivisionsDeeper(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionIds, wikidataId, regionId } = req.body as { divisionIds: number[]; wikidataId: string; regionId: number };

  // Check if geoshape is available for spatial filtering
  const geoCheck = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM wikidata_geoshapes WHERE wikidata_id = $1 AND not_available = FALSE AND geom IS NOT NULL) AS available`,
    [wikidataId],
  );
  const hasGeoshape = geoCheck.rows[0]?.available as boolean;

  // For each input division, find its children.
  // When geoshape is available, filter by spatial intersection and compute coverage.
  // When not, return all children (no spatial filter).
  // Divisions without children (leaves) are kept as-is.
  const result = hasGeoshape
    ? await pool.query(`
        WITH wiki AS (
          SELECT ST_ForcePolygonCCW(geom) AS geom
          FROM wikidata_geoshapes
          WHERE wikidata_id = $2 AND not_available = FALSE
        ),
        wiki_area AS (
          SELECT safe_geo_area(geom) AS area FROM wiki
        ),
        parent_children AS (
          SELECT child.id, child.name, child.parent_id,
            safe_geo_area(
              ST_ForcePolygonCCW(ST_CollectionExtract(
                ST_MakeValid(ST_Intersection(w.geom, child.geom_simplified_medium)), 3
              ))
            ) / NULLIF(wa.area, 0) AS coverage
          FROM administrative_divisions child, wiki w, wiki_area wa
          WHERE child.parent_id = ANY($1)
            AND child.geom_simplified_medium IS NOT NULL
            AND ST_Intersects(child.geom_simplified_medium, w.geom)
        ),
        leaf_divisions AS (
          SELECT ad.id, ad.name, ad.parent_id,
            safe_geo_area(
              ST_ForcePolygonCCW(ST_CollectionExtract(
                ST_MakeValid(ST_Intersection(w.geom, ad.geom_simplified_medium)), 3
              ))
            ) / NULLIF(wa.area, 0) AS coverage
          FROM administrative_divisions ad, wiki w, wiki_area wa
          WHERE ad.id = ANY($1)
            AND NOT ad.has_children
            AND ad.geom_simplified_medium IS NOT NULL
        ),
        all_results AS (
          SELECT * FROM parent_children
          UNION ALL
          SELECT * FROM leaf_divisions
        )
        SELECT r.id, r.name, r.parent_id,
          ROUND(r.coverage::numeric, 4) AS coverage,
          (WITH RECURSIVE div_ancestors AS (
            SELECT r.id AS aid, r.name AS aname, r.parent_id AS apid
            UNION ALL
            SELECT d.id, d.name, d.parent_id
            FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
          )
          SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
        FROM all_results r
        WHERE r.coverage > 0.005
        ORDER BY r.coverage DESC
      `, [divisionIds, wikidataId])
    : await pool.query(`
        WITH parent_children AS (
          SELECT child.id, child.name, child.parent_id, NULL::numeric AS coverage
          FROM administrative_divisions child
          WHERE child.parent_id = ANY($1)
            AND child.geom_simplified_medium IS NOT NULL
        ),
        leaf_divisions AS (
          SELECT ad.id, ad.name, ad.parent_id, NULL::numeric AS coverage
          FROM administrative_divisions ad
          WHERE ad.id = ANY($1)
            AND NOT ad.has_children
        ),
        all_results AS (
          SELECT * FROM parent_children
          UNION ALL
          SELECT * FROM leaf_divisions
        )
        SELECT r.id, r.name, r.parent_id, r.coverage,
          (WITH RECURSIVE div_ancestors AS (
            SELECT r.id AS aid, r.name AS aname, r.parent_id AS apid
            UNION ALL
            SELECT d.id, d.name, d.parent_id
            FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
          )
          SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
        FROM all_results r
        ORDER BY r.name
      `, [divisionIds]);

  // Fetch per-division geometries for rendering individual borders
  const resultIds = result.rows.map(r => r.id as number);
  const features: Array<{ type: 'Feature'; properties: Record<string, unknown>; geometry: unknown }> = [];

  // Check which divisions are already assigned to regions in this world view
  const assignedMap = new Map<number, string>(); // divisionId → regionName
  if (resultIds.length > 0) {
    const assignedResult = await pool.query(`
      SELECT rm.division_id, r.name AS region_name
      FROM region_members rm
      JOIN regions r ON r.id = rm.region_id
      WHERE rm.division_id = ANY($1) AND r.world_view_id = $2
    `, [resultIds, worldViewId]);
    for (const row of assignedResult.rows) {
      assignedMap.set(row.division_id as number, row.region_name as string);
    }
  }

  if (resultIds.length > 0) {
    const geoResult = await pool.query(`
      SELECT ad.id, ad.name, ST_AsGeoJSON(
        ST_ForcePolygonCCW(ST_CollectionExtract(
          ST_MakeValid(ad.geom_simplified_medium), 3
        ))
      ) AS geojson
      FROM administrative_divisions ad
      WHERE ad.id = ANY($1) AND ad.geom_simplified_medium IS NOT NULL
    `, [resultIds]);
    for (const row of geoResult.rows) {
      if (row.geojson) {
        const divId = row.id as number;
        const assignedTo = assignedMap.get(divId);
        features.push({
          type: 'Feature',
          properties: {
            name: row.name as string,
            divisionId: divId,
            hasPoints: false,
            ...(assignedTo ? { assignedTo } : {}),
          },
          geometry: JSON.parse(row.geojson as string),
        });
      }
    }
  }

  // Fetch Wikivoyage markers and check which divisions contain points
  const { points, divisionsWithPoints } = await fetchMarkersForDivisions(regionId, resultIds);

  // Mark features that contain points
  for (const f of features) {
    if (divisionsWithPoints.has(f.properties.divisionId as number)) {
      f.properties.hasPoints = true;
    }
  }

  // Add point markers as features
  for (const p of points) {
    features.push({
      type: 'Feature',
      properties: { name: p.name, isMarker: true },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    });
  }

  res.json({
    divisions: result.rows.map(r => ({
      divisionId: r.id as number,
      name: r.name as string,
      path: r.path as string,
      parentId: r.parent_id as number | null,
      coverage: r.coverage != null ? parseFloat(r.coverage as string) : null,
      hasPoints: divisionsWithPoints.has(r.id as number),
      assignedTo: assignedMap.get(r.id as number) ?? null,
    })),
    geometry: features.length > 0
      ? { type: 'FeatureCollection', features }
      : null,
    points: points.length > 0 ? points : undefined,
  });
}

/**
 * Use AI vision to suggest which divisions belong to a region based on its map image.
 * POST /api/admin/wv-import/matches/:worldViewId/vision-match
 */
export async function visionMatchDivisions(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionIds, regionId, imageUrl } = req.body as { divisionIds: number[]; regionId: number; imageUrl: string };

  // Get the region name
  const regionResult = await pool.query(
    `SELECT name FROM regions WHERE id = $1 AND world_view_id = $2`,
    [regionId, worldViewId],
  );

  if (regionResult.rows.length === 0) {
    res.status(404).json({ error: 'Region not found' });
    return;
  }

  const regionName = regionResult.rows[0].name as string;
  const regionMapUrl = imageUrl;

  // Fetch division SVG paths, centroids, and bounding boxes
  const divResult = await pool.query(`
    SELECT id, name,
      ST_AsSVG(geom_simplified_medium, 0, 2) AS svg_path,
      ST_X(ST_Centroid(geom_simplified_medium)) AS cx,
      ST_Y(ST_Centroid(geom_simplified_medium)) AS cy
    FROM administrative_divisions
    WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
  `, [divisionIds]);

  if (divResult.rows.length === 0) {
    res.status(400).json({ error: 'No valid divisions found' });
    return;
  }

  const divisions = divResult.rows.map(r => ({
    id: r.id as number,
    name: r.name as string,
    svgPath: r.svg_path as string,
    cx: parseFloat(r.cx as string),
    cy: parseFloat(r.cy as string),
  }));

  // Generate numbered SVG map of all candidate divisions
  const divisionsSvg = generateDivisionsSvg(divisions);
  // Convert SVG to PNG (OpenAI doesn't accept SVG)
  const pngBuffer = await sharp(Buffer.from(divisionsSvg)).flatten({ background: '#f0f2f5' }).png().toBuffer();
  const pngBase64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;

  // Use a high-res version of the region map image
  const hiresImageUrl = `${regionMapUrl}?width=1280`;

  const result = await matchDivisionsByVision(regionName, hiresImageUrl, pngBase64, divisions);

  res.json({
    suggestedIds: result.suggestedIds,
    rejectedIds: result.rejectedIds,
    unclearIds: result.unclearIds,
    reasoning: result.reasoning,
    cost: result.usage.cost.totalCost,
    debugImages: {
      regionMap: hiresImageUrl,
      divisionsMap: pngBase64,
    },
  });
}

/**
 * CV-based division matching at parent region level.
 * Gathers ALL divisions from child region suggestions + assigned,
 * computes the full country outline, and generates classified border debug images.
 *
 * POST /api/admin/wv-import/matches/:worldViewId/color-match
 * Body: { regionId: number } — the parent region with children
 */
export async function colorMatchDivisionsSSE(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = parseInt(String(req.query.regionId));

  // SSE setup — disable TCP buffering for immediate flush
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.socket?.setNoDelay(true);

  const startTime = Date.now();
  const sendEvent = (event: { type: string; step?: string; elapsed?: number; debugImage?: { label: string; dataUrl: string }; data?: unknown; message?: string; reviewId?: string; waterMaskImage?: string; waterPxPercent?: number; waterComponents?: Array<{ id: number; pct: number; cropDataUrl: string; subClusters: Array<{ idx: number; pct: number; cropDataUrl: string }> }> }) => {
    if (res.destroyed) return;
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client disconnected */ }
  };
  const logStep = async (step: string) => {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`[CV Match SSE] ${step} (${elapsed.toFixed(1)}s)`);
    sendEvent({ type: 'progress', step, elapsed });
    // Yield to event loop so SSE data actually flushes to client
    await new Promise(resolve => setImmediate(resolve));
  };

  // Get parent region info (name, map image)
  const regionResult = await pool.query(`
    SELECT r.name, ris.region_map_url
    FROM regions r
    LEFT JOIN region_import_state ris ON ris.region_id = r.id
    WHERE r.id = $1 AND r.world_view_id = $2
  `, [regionId, worldViewId]);

  if (regionResult.rows.length === 0) {
    sendEvent({ type: 'error', message: 'Region not found' });
    res.end();
    return;
  }

  const regionName = regionResult.rows[0].name as string;
  const regionMapUrl = regionResult.rows[0].region_map_url as string | null;

  if (!regionMapUrl) {
    sendEvent({ type: 'error', message: 'No map image selected for this region' });
    res.end();
    return;
  }

  await logStep(`Loading divisions for ${regionName}...`);

  // Collect ALL divisions known to be part of this parent region's territory.
  // Includes divisions assigned to the parent itself and to all child regions,
  // both via region_members (confirmed) and region_match_suggestions (proposed).
  // This ensures multi-part territories (e.g. Egypt: Africa + Sinai) are fully covered.
  const [knownMemberResult, knownSugResult] = await Promise.all([
    pool.query(`
      SELECT DISTINCT division_id AS id FROM region_members
      WHERE region_id = $1 OR region_id IN (
        SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
      )
    `, [regionId, worldViewId]),
    pool.query(`
      SELECT DISTINCT rms.division_id AS id FROM region_match_suggestions rms
      WHERE (rms.region_id = $1 OR rms.region_id IN (
        SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
      ))
      AND rms.rejected = FALSE
    `, [regionId, worldViewId]),
  ]);

  const knownDivisionIds = new Set<number>();
  for (const r of knownMemberResult.rows) knownDivisionIds.add(r.id as number);
  for (const r of knownSugResult.rows) knownDivisionIds.add(r.id as number);

  if (knownDivisionIds.size === 0) {
    sendEvent({ type: 'error', message: 'No divisions found in this region or its children — need at least one assigned or suggested division' });
    res.end();
    return;
  }

  const sampleDivId = [...knownDivisionIds][0];

  // Find country ancestor + determine GADM depth of sample division
  const countryResult = await pool.query(`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_id, 0 AS depth FROM administrative_divisions WHERE id = $1
      UNION ALL
      SELECT ad.id, ad.name, ad.parent_id, a.depth + 1 FROM administrative_divisions ad
      JOIN ancestors a ON a.parent_id = ad.id
    )
    SELECT a.id, a.name, a.depth FROM ancestors a
    JOIN administrative_divisions p ON a.parent_id = p.id
    WHERE p.parent_id IS NULL
    LIMIT 1
  `, [sampleDivId]);

  const countryId = countryResult.rows[0]?.id as number | undefined;
  const countryDepth = countryResult.rows[0]?.depth as number | undefined;
  if (!countryId || countryDepth === undefined) {
    sendEvent({ type: 'error', message: 'Could not find country ancestor' });
    res.end();
    return;
  }

  // Get ALL GADM divisions at the same depth as the sample (all siblings across the country).
  // depth=1 means direct children of country, depth=2 means grandchildren, etc.
  // If depth=0, the sample IS the country itself — go one level deeper to get subdivisions.
  let targetDepth = countryDepth === 0 ? 1 : countryDepth;
  let allDivsResult = await pool.query(`
    WITH RECURSIVE descendants AS (
      SELECT id, 0 AS depth FROM administrative_divisions WHERE id = $1
      UNION ALL
      SELECT ad.id, d.depth + 1 FROM administrative_divisions ad
      JOIN descendants d ON ad.parent_id = d.id
      WHERE d.depth < $2
    )
    SELECT id FROM descendants WHERE depth = $2
  `, [countryId, targetDepth]);

  // If only 1 division found (e.g. sample at country level), try one level deeper
  if (allDivsResult.rows.length <= 1 && targetDepth === countryDepth) {
    targetDepth = countryDepth + 1;
    allDivsResult = await pool.query(`
      WITH RECURSIVE descendants AS (
        SELECT id, 0 AS depth FROM administrative_divisions WHERE id = $1
        UNION ALL
        SELECT ad.id, d.depth + 1 FROM administrative_divisions ad
        JOIN descendants d ON ad.parent_id = d.id
        WHERE d.depth < $2
      )
      SELECT id FROM descendants WHERE depth = $2
    `, [countryId, targetDepth]);
  }

  // Union GADM descendants with ALL known divisions from region members + suggestions.
  // The GADM walk captures unassigned siblings, while known divisions ensure
  // multi-part territories (e.g. Egypt with African + Asian divisions) are fully covered.
  const allDivisionIdSet = new Set<number>();
  for (const r of allDivsResult.rows) allDivisionIdSet.add(r.id as number);
  for (const id of knownDivisionIds) allDivisionIdSet.add(id);

  const allDivisionIds = [...allDivisionIdSet];
  if (allDivisionIds.length === 0) {
    sendEvent({ type: 'error', message: 'No divisions found at this level' });
    res.end();
    return;
  }

  const gadmCount = allDivsResult.rows.length;
  const extraFromRegion = allDivisionIds.length - gadmCount;
  if (extraFromRegion > 0) {
    await logStep(`Found ${gadmCount} GADM divisions + ${extraFromRegion} extra from region members (total: ${allDivisionIds.length})`);
  }

  // Get which divisions are already assigned to which child region
  const assignedResult = await pool.query(`
    SELECT rm.division_id, rm.region_id, r.name AS region_name
    FROM region_members rm
    JOIN regions r ON r.id = rm.region_id
    WHERE rm.region_id IN (
      SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
    )
  `, [regionId, worldViewId]);

  const assignedMap = new Map<number, { regionId: number; regionName: string }>();
  for (const r of assignedResult.rows) {
    assignedMap.set(r.division_id as number, {
      regionId: r.region_id as number,
      regionName: r.region_name as string,
    });
  }

  // Count child regions to cap K-means cluster count
  const childCountResult = await pool.query(
    `SELECT COUNT(*) FROM regions WHERE parent_region_id = $1 AND world_view_id = $2`,
    [regionId, worldViewId],
  );
  const expectedRegionCount = parseInt(childCountResult.rows[0].count as string);

  // Fetch centroids + names for all divisions
  const centroidResult = await pool.query(`
    SELECT id, name,
      ST_X(ST_Centroid(geom_simplified_medium)) AS cx,
      ST_Y(ST_Centroid(geom_simplified_medium)) AS cy
    FROM administrative_divisions
    WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
  `, [allDivisionIds]);

  // Map division ID → display name (built up as we recurse deeper)
  const divNameMap = new Map<number, string>();

  const centroids = centroidResult.rows.map(r => {
    const name = r.name as string;
    divNameMap.set(r.id as number, name);
    return {
      id: r.id as number,
      cx: parseFloat(r.cx as string),
      cy: parseFloat(r.cy as string),
      assigned: assignedMap.get(r.id as number) ?? null,
    };
  });

  await logStep(`Computing borders for ${centroids.length} divisions...`);

  // Fetch individual division SVG paths + classified borders + country outline
  const [divPathsResult, borderResult] = await Promise.all([
    // Individual division outlines as SVG (for CV rasterization)
    pool.query(`
      SELECT id, ST_AsSVG(geom_simplified_medium, 0, 4) AS svg_path
      FROM administrative_divisions
      WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
    `, [allDivisionIds]),
    // Union border classification + region outline + bbox
    // Use subset (union of all relevant divisions) for bbox — NOT the GADM country,
    // so multi-part regions (e.g. Egypt: Africa + Sinai) get full coverage.
    pool.query(`
      WITH subset AS (
        SELECT ST_Union(geom_simplified_medium) AS geom
        FROM administrative_divisions
        WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
      ),
      all_borders AS (
        SELECT ST_Union(ST_Boundary(geom_simplified_medium)) AS geom
        FROM administrative_divisions
        WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
      )
      SELECT
        ST_AsSVG(subset.geom, 0, 4) AS country_path,
        ST_AsSVG(
          ST_Intersection(
            all_borders.geom,
            ST_Buffer(ST_Boundary(subset.geom), 0.001)
          ), 0, 4
        ) AS external_border,
        ST_AsSVG(
          ST_Difference(
            all_borders.geom,
            ST_Buffer(ST_Boundary(subset.geom), 0.001)
          ), 0, 4
        ) AS internal_border,
        ST_XMin(subset.geom) AS country_min_x,
        ST_YMin(subset.geom) AS country_min_y,
        ST_XMax(subset.geom) AS country_max_x,
        ST_YMax(subset.geom) AS country_max_y
      FROM subset, all_borders
    `, [allDivisionIds]),
  ]);

  if (borderResult.rows.length === 0) {
    sendEvent({ type: 'error', message: 'Could not compute borders' });
    res.end();
    return;
  }

  // Individual division paths (SVG for CV rasterization)
  const divPaths = divPathsResult.rows.map(r => ({
    id: r.id as number,
    svgPath: r.svg_path as string,
  }));

  const row = borderResult.rows[0];
  const countryPath = row.country_path as string;
  const externalBorder = row.external_border as string | null;
  const internalBorder = row.internal_border as string | null;
  const cMinX = parseFloat(row.country_min_x as string);
  const cMinY = parseFloat(row.country_min_y as string);
  const cMaxX = parseFloat(row.country_max_x as string);
  const cMaxY = parseFloat(row.country_max_y as string);

  // Build debug SVG with country context
  const pad = 0.5;
  const vbX = cMinX - pad;
  const vbY = -(cMaxY + pad);
  const vbW = (cMaxX - cMinX) + 2 * pad;
  const vbH = (cMaxY - cMinY) + 2 * pad;
  const ss = Math.max(vbW, vbH) / 800; // stroke scale (thin lines for accuracy)

  // Individual division outlines (all same style — assigned/unassigned shown by centroid dots)
  const divisionShapes = divPaths.map(d =>
    `<path d="${d.svgPath}" fill="#ddeeff" stroke="#90a4ae" stroke-width="${ss}" fill-opacity="0.7"/>`
  ).join('\n');

  // Centroid dots (green = assigned, orange = unassigned)
  const dots = centroids.map(c => {
    const color = c.assigned ? '#2e7d32' : '#e65100';
    return `<circle cx="${c.cx}" cy="${-c.cy}" r="${ss * 4}" fill="${color}" stroke="white" stroke-width="${ss * 0.5}"/>`;
  }).join('\n');

  const borderSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="1600">
    <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#f0f2f5"/>
    <path d="${countryPath}" fill="#e8e8e8" stroke="#bbb" stroke-width="${ss * 0.5}"/>
    ${divisionShapes}
    ${externalBorder ? `<path d="${externalBorder}" fill="none" stroke="#d32f2f" stroke-width="${ss * 3}" stroke-linecap="round"/>` : ''}
    ${internalBorder ? `<path d="${internalBorder}" fill="none" stroke="#1565c0" stroke-width="${ss * 2}" stroke-dasharray="${ss * 4},${ss * 3}" stroke-linecap="round"/>` : ''}
    ${dots}
  </svg>`;

  const borderPng = await sharp(Buffer.from(borderSvg))
    .flatten({ background: '#f0f2f5' })
    .png()
    .toBuffer();

  const debugImages: Array<{ label: string; dataUrl: string }> = [];
  let debugIdx = 0;
  const debugSlug = regionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const pushDebugImage = async (label: string, dataUrl: string) => {
    const img = { label, dataUrl };
    debugImages.push(img);
    sendEvent({ type: 'debug_image', debugImage: img });
    // Save debug images to /tmp for inspection (named by region to avoid overwrites)
    try {
      const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const fs = await import('fs');
      fs.writeFileSync(`/tmp/cv-debug-${debugSlug}-${debugIdx++}.png`, Buffer.from(b64, 'base64'));
    } catch { /* ignore */ }
    await new Promise(resolve => setImmediate(resolve));
  };

  await pushDebugImage(
    'Step 1: GADM divisions with classified borders (red=external, blue dashed=internal, green dot=assigned, orange dot=unassigned)',
    `data:image/png;base64,${borderPng.toString('base64')}`,
  );

  // Step 2: CV border detection on the source map image
  // Pipeline: downscale → noise removal (rivers/roads/text) → multi-bg detection via edge K-means →
  // foreground mask → morphological close → connected components → country silhouette →
  // K-means color clustering → spatial split → merge → ICP → division assignment → OCR → geo preview

  try {
    await logStep('Fetching source map image...');
    const mapResponse = await fetch(regionMapUrl, {
      headers: { 'User-Agent': 'TrackYourRegions/1.0 (CV border detection)' },
      redirect: 'follow',
    });
    if (mapResponse.ok) {
      const mapBuffer = Buffer.from(await mapResponse.arrayBuffer());
      const origMeta = await sharp(mapBuffer).metadata();
      const origW = origMeta.width!;
      const origH = origMeta.height!;

      // Downscale to 800px + targeted noise removal (rivers, roads, text)
      const TW = 800;
      const scale = TW / origW;
      const TH = Math.round(origH * scale);
      const tp = TW * TH;
      // Scale factor for pixel-based constants (calibrated at 500px base resolution)
      const RES_SCALE = TW / 500;
      /** Scale pixel constant and ensure odd (required for OpenCV kernels) */
      const oddK = (base: number) => { const v = Math.round(base * RES_SCALE); return v | 1; };
      /** Scale pixel constant (round to nearest integer) */
      const pxS = (base: number) => Math.round(base * RES_SCALE);

      await logStep('Noise removal (downscale + median + line removal)...');
      if (!G.__cv) throw new Error('OpenCV WASM not available');
      const cv = G.__cv;
      // Keep clean downscale for water review crops (before any processing)
      const origDownBuf = await sharp(mapBuffer)
        .removeAlpha()
        .resize(TW, TH, { kernel: 'lanczos3' })
        .raw()
        .toBuffer();
      // Light median + color-targeted line removal (kernel scales with resolution)
      const rawBuf = await sharp(mapBuffer)
        .removeAlpha()
        .resize(TW, TH, { kernel: 'lanczos3' })
        .median(oddK(5))
        .raw()
        .toBuffer();
      removeColoredLines(rawBuf, TW, TH, RES_SCALE);

      // Clean color buffer for K-means: start from origDownBuf (zero spatial filtering →
      // zero cross-boundary contamination). Text is removed via BFS color propagation
      // (nearest non-text neighbor color) instead of Telea inpainting (which bleeds ocean)
      // or spatial filters (median/bilateral/mean-shift all blur across boundaries).
      // This is the "Photoshop Select by Color → Content-Aware Fill" approach.
      const colorBuf = Buffer.from(origDownBuf);
      removeColoredLines(colorBuf, TW, TH, RES_SCALE);

      // Debug: show image after noise removal (before CV processing)
      const noiseRemovedPng = await sharp(Buffer.from(rawBuf), {
        raw: { width: TW, height: TH, channels: 3 },
      }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
      await pushDebugImage(
        'After noise removal (downscale + median + line removal)',
        `data:image/png;base64,${noiseRemovedPng.toString('base64')}`,
      );

      // --- Step A: Detect text/symbols mask → inpaint with surrounding colors ---
      await logStep('Text detection + inpainting...');
      const cvRaw = new cv.Mat(TH, TW, cv.CV_8UC3);
      cvRaw.data.set(rawBuf);
      // HSV of raw image (for dark spot detection)
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
      // Also detect city dots/symbols: very dark spots (V < 50), but only small ones
      // to avoid catching large dark title boxes (like "Cameroon" banner)
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
      // Dilate text mask to cover anti-aliased text edges.
      // Fixed 5×5 kernel: anti-aliased edges are always ~1-2px regardless of resolution.
      // Scaling this would over-dilate on thin coastal strips, eating all clean pixels.
      const textDilateK = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
      const textMaskDilated = new cv.Mat();
      cv.dilate(textMask, textMaskDilated, textDilateK);
      textMask.delete(); textDilateK.delete();

      // Save text mask for K-means exclusion (text pixels get unreliable colors after inpainting)
      const textExcluded = new Uint8Array(tp);
      for (let i = 0; i < tp; i++) if (textMaskDilated.data[i]) textExcluded[i] = 1;

      // --- Ocean buffer: prevent water/background colors from bleeding into coastal text ---
      // Telea inpainting samples all non-masked pixels within its radius. On thin coastal
      // strips, this includes ocean pixels, creating dirty mixed colors. Fix: also mask
      // clearly-background pixels directly adjacent to text so Telea fills from land side.
      // Conservative: only immediate neighbors (3px dilation), only very low saturation
      // (S < 15 = truly gray background, not desaturated land like desert/olive).
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
        if (textMaskDilated.data[i]) continue; // already masked as text
        if (!textNear.data[i]) continue;        // not adjacent to text
        if (hsvSharp[i * 3 + 1] < 15) {         // S < 15 → truly gray background only
          inpaintMask.data[i] = 255;
          oceanBuffered++;
        }
      }
      textNear.delete();
      if (oceanBuffered > 0) {
        console.log(`  [Text] Ocean buffer: masked ${oceanBuffered} bg pixels adjacent to text`);
      }

      // Inpaint: fill masked pixels with surrounding colors (Telea algorithm)
      const cvInpainted = new cv.Mat();
      cv.inpaint(cvRaw, inpaintMask, cvInpainted, INPAINT_R, cv.INPAINT_TELEA);
      cvRaw.delete(); inpaintMask.delete();

      // Debug: text mask
      const textMaskPng = await sharp(Buffer.from(textMaskDilated.data), {
        raw: { width: TW, height: TH, channels: 1 },
      }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
      await pushDebugImage(
        'Text mask (white = detected text/symbols to inpaint)',
        `data:image/png;base64,${textMaskPng.toString('base64')}`,
      );
      textMaskDilated.delete();

      // --- BFS color propagation on colorBuf (Photoshop-style text removal) ---
      // Each text pixel gets the color of its NEAREST non-text neighbor.
      // Unlike Telea inpainting (fills from ALL boundary pixels including ocean →
      // dirty mixed colors on thin strips), BFS copies from the nearest clean pixel
      // on the SAME side of the region boundary. On a thin blue strip with text:
      // non-text blue edge pixels → BFS fills text inward with blue → pink never leaks in.
      {
        const bfsQ: number[] = [];
        const filled = new Uint8Array(tp);
        for (let i = 0; i < tp; i++) {
          if (!textExcluded[i]) { filled[i] = 1; bfsQ.push(i); }
        }
        let h = 0, replaced = 0;
        while (h < bfsQ.length) {
          const p = bfsQ[h++];
          for (const n of [p - TW, p + TW, p - 1, p + 1]) {
            if (n >= 0 && n < tp && !filled[n]) {
              filled[n] = 1;
              colorBuf[n * 3] = colorBuf[p * 3];
              colorBuf[n * 3 + 1] = colorBuf[p * 3 + 1];
              colorBuf[n * 3 + 2] = colorBuf[p * 3 + 2];
              bfsQ.push(n);
              replaced++;
            }
          }
        }
        console.log(`  [Color] BFS text removal on colorBuf: ${replaced} pixels filled with nearest neighbor color`);
      }

      // Convert colorBuf to Lab for seam detection and later BG detection
      const cvBufForSeam = new cv.Mat(TH, TW, cv.CV_8UC3);
      cvBufForSeam.data.set(colorBuf);
      const cvLabSeam = new cv.Mat();
      cv.cvtColor(cvBufForSeam, cvLabSeam, cv.COLOR_RGB2Lab);
      const labBufEarly = Buffer.from(cvLabSeam.data);
      cvBufForSeam.delete(); cvLabSeam.delete();

      // Extend textExcluded at BFS seam boundaries: where two different fill colors meet,
      // the boundary pixels may have been assigned the wrong side's color. Mark the
      // immediate neighbors of high-ΔE transitions as excluded too.
      const SEAM_DE_SQ = 8 * 8;
      let seamExtended = 0;
      const seamMark = new Uint8Array(tp);
      for (let i = 0; i < tp; i++) {
        if (!textExcluded[i]) continue;
        const L1 = labBufEarly[i * 3], a1 = labBufEarly[i * 3 + 1], b1 = labBufEarly[i * 3 + 2];
        for (const n of [i - TW, i + TW, i - 1, i + 1]) {
          if (n < 0 || n >= tp || !textExcluded[n]) continue;
          const dL = L1 - labBufEarly[n * 3], dA = a1 - labBufEarly[n * 3 + 1], dB = b1 - labBufEarly[n * 3 + 2];
          if (dL * dL + dA * dA + dB * dB > SEAM_DE_SQ) { seamMark[i] = 1; seamMark[n] = 1; break; }
        }
      }
      // Extend exclusion: mark non-excluded neighbors of seam pixels
      for (let i = 0; i < tp; i++) {
        if (!seamMark[i]) continue;
        for (const n of [i - TW, i + TW, i - 1, i + 1]) {
          if (n >= 0 && n < tp && !textExcluded[n]) {
            textExcluded[n] = 1;
            seamExtended++;
          }
        }
      }
      if (seamExtended > 0) {
        console.log(`  [Seam] Extended textExcluded by ${seamExtended} pixels around ${[...seamMark].filter(Boolean).length} seam pixels`);
      }

      // --- Step B: Detect water on CLEAN inpainted image (sharp, no blur yet) ---
      // Running after text removal so blue text labels don't get detected as water
      await logStep('Detecting water (on clean sharp image, after text removal)...');
      const inpaintedBuf = Buffer.from(cvInpainted.data);
      const cvHsvClean = new cv.Mat();
      cv.cvtColor(cvInpainted, cvHsvClean, cv.COLOR_RGB2HSV);
      const hsvClean = Buffer.from(cvHsvClean.data);
      cvHsvClean.delete();

      // Adaptive water thresholds: sample edge pixels to find actual water color
      const edgeHsvSamples: Array<[number, number, number]> = [];
      for (let x = 0; x < TW; x++) {
        for (let band = 0; band < 5; band++) {
          for (const idx of [band * TW + x, (TH - 1 - band) * TW + x]) {
            const h = hsvClean[idx * 3], s = hsvClean[idx * 3 + 1], v = hsvClean[idx * 3 + 2];
            if (h >= 70 && h <= 140 && s > 8) edgeHsvSamples.push([h, s, v]);
          }
        }
      }
      for (let y = 0; y < TH; y++) {
        for (let band = 0; band < 5; band++) {
          for (const idx of [y * TW + band, y * TW + TW - 1 - band]) {
            const h = hsvClean[idx * 3], s = hsvClean[idx * 3 + 1], v = hsvClean[idx * 3 + 2];
            if (h >= 70 && h <= 140 && s > 8) edgeHsvSamples.push([h, s, v]);
          }
        }
      }
      const totalEdgePx = (TW + TH) * 2 * 5;
      const useAdaptiveWater = edgeHsvSamples.length > totalEdgePx * 0.03;
      let adaptiveH = 0, adaptiveS = 0, adaptiveV = 0;
      if (useAdaptiveWater) {
        edgeHsvSamples.sort((a, b) => a[0] - b[0]);
        adaptiveH = edgeHsvSamples[Math.floor(edgeHsvSamples.length / 2)][0];
        edgeHsvSamples.sort((a, b) => a[1] - b[1]);
        adaptiveS = edgeHsvSamples[Math.floor(edgeHsvSamples.length / 2)][1];
        edgeHsvSamples.sort((a, b) => a[2] - b[2]);
        adaptiveV = edgeHsvSamples[Math.floor(edgeHsvSamples.length / 2)][2];
        console.log(`  [Water] Adaptive: ${edgeHsvSamples.length} edge samples (${(edgeHsvSamples.length / totalEdgePx * 100).toFixed(1)}%), median HSV=(${adaptiveH},${adaptiveS},${adaptiveV})`);
      }

      // ── Multi-signal water detection with voting ──
      // Three independent signals vote on each pixel. A pixel is water if ≥2 agree.
      // This handles boundary blur (median + inpainting smears water↔land edges) and
      // text within water (dark text fails on original but inpainted to blue).
      //
      // Signal A: HSV thresholds on inpainted image (text removed → clean inside water)
      // Signal B: HSV thresholds on original image (sharp boundaries, text still present)
      // Signal C: Color proximity to known-water centroid (fills text gaps by color)

      // Helper: does pixel pass water tier thresholds? Adaptive when edge water is found.
      const passesWaterTier = (h: number, s: number, v: number, r: number, g: number, b: number): boolean => {
        if (useAdaptiveWater) {
          // Adaptive tiers centered on sampled water color
          if (Math.abs(h - adaptiveH) <= 20 && s > adaptiveS * 0.5 && v > adaptiveV * 0.5 && b > g) return true;
          if (Math.abs(h - adaptiveH) <= 30 && s > Math.max(adaptiveS * 0.25, 8) && v > adaptiveV * 0.6) return true;
          return false;
        }
        // Fallback: hardcoded tiers (for landlocked countries with no edge water)
        if (h >= 90 && h <= 120 && s > 40 && v > 90 && b > g + 12) return true;
        if (h >= 80 && h <= 110 && s > 18 && s < 80 && v > 190 && b > r + 15) return true;
        return false;
      };

      // Signal A: on inpainted (text-free) image
      const voteA = new Uint8Array(tp);
      let countA = 0;
      for (let i = 0; i < tp; i++) {
        if (passesWaterTier(hsvClean[i * 3], hsvClean[i * 3 + 1], hsvClean[i * 3 + 2],
            inpaintedBuf[i * 3], inpaintedBuf[i * 3 + 1], inpaintedBuf[i * 3 + 2])) {
          voteA[i] = 1; countA++;
        }
      }

      // Signal B: on original (unprocessed) image — sharp region boundaries
      const cvOrigForWater = new cv.Mat(TH, TW, cv.CV_8UC3);
      cvOrigForWater.data.set(origDownBuf);
      const cvHsvOrig = new cv.Mat();
      cv.cvtColor(cvOrigForWater, cvHsvOrig, cv.COLOR_RGB2HSV);
      const hsvOrig = Buffer.from(cvHsvOrig.data);
      cvOrigForWater.delete(); cvHsvOrig.delete();

      const voteB = new Uint8Array(tp);
      let countB = 0;
      for (let i = 0; i < tp; i++) {
        if (passesWaterTier(hsvOrig[i * 3], hsvOrig[i * 3 + 1], hsvOrig[i * 3 + 2],
            origDownBuf[i * 3], origDownBuf[i * 3 + 1], origDownBuf[i * 3 + 2])) {
          voteB[i] = 1; countB++;
        }
      }

      // Seeds = A ∩ B (high-confidence water — both images agree)
      let seedR = 0, seedG = 0, seedB = 0, seedCnt = 0;
      for (let i = 0; i < tp; i++) {
        if (voteA[i] && voteB[i]) {
          seedR += inpaintedBuf[i * 3];
          seedG += inpaintedBuf[i * 3 + 1];
          seedB += inpaintedBuf[i * 3 + 2];
          seedCnt++;
        }
      }

      // Signal C: color proximity to water centroid on inpainted image
      // Fills text gaps (inpainted text → similar blue → close to centroid)
      // Rejects different-colored land (violet, green → far from centroid)
      const voteC = new Uint8Array(tp);
      let countC = 0;
      if (seedCnt > 0) {
        const avgR = seedR / seedCnt, avgG = seedG / seedCnt, avgB = seedB / seedCnt;
        const COLOR_DIST_SQ = 50 * 50;
        for (let i = 0; i < tp; i++) {
          const dr = inpaintedBuf[i * 3] - avgR;
          const dg = inpaintedBuf[i * 3 + 1] - avgG;
          const db = inpaintedBuf[i * 3 + 2] - avgB;
          if (dr * dr + dg * dg + db * db <= COLOR_DIST_SQ) { voteC[i] = 1; countC++; }
        }
      }

      // Final water = ≥2 votes agree
      const waterRaw = new Uint8Array(tp);
      let waterRawCount = 0;
      for (let i = 0; i < tp; i++) {
        if (voteA[i] + voteB[i] + voteC[i] >= 2) { waterRaw[i] = 255; waterRawCount++; }
      }
      console.log(`  [Water] Voting: A=${countA} B=${countB} C=${countC} seeds(A∩B)=${seedCnt} → final=${waterRawCount} (${(waterRawCount / tp * 100).toFixed(1)}%)`);

      // --- Step C: colorBuf is the single clean buffer for all downstream processing ---
      // Pipeline: origDownBuf (no spatial filter) → line removal → BFS text fill.
      // No bilateral/median/mean-shift = zero cross-boundary contamination.
      // Used for: foreground detection, park detection, K-means, debug visualization.
      cvInpainted.delete(); // no longer needed — water detection already consumed it

      // Debug: show clean colorBuf (text removed, no spatial blur)
      const colorBufPng = await sharp(Buffer.from(colorBuf), {
        raw: { width: TW, height: TH, channels: 3 },
      }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
      await pushDebugImage(
        'Clean image (text BFS-filled, no spatial filter — used for all downstream)',
        `data:image/png;base64,${colorBufPng.toString('base64')}`,
      );

      // Alias: buf = colorBuf for all downstream code (foreground, parks, K-means, viz)
      const buf = colorBuf;

      // HSV of the clean image for foreground detection
      const cvBufFinal = new cv.Mat(TH, TW, cv.CV_8UC3);
      cvBufFinal.data.set(buf);
      const cvHsvFinal = new cv.Mat();
      cv.cvtColor(cvBufFinal, cvHsvFinal, cv.COLOR_RGB2HSV);
      const hsvBuf = Buffer.from(cvHsvFinal.data);
      cvBufFinal.delete(); cvHsvFinal.delete();

      await logStep('Background detection + foreground mask...');

      // Morphological close on water mask to fill small gaps, then keep large regions
      const waterRawMat = cv.matFromArray(TH, TW, cv.CV_8UC1, waterRaw);
      const wkSize = oddK(7);
      const waterKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(wkSize, wkSize));
      const waterClosedMat = new cv.Mat();
      cv.morphologyEx(waterRawMat, waterClosedMat, cv.MORPH_CLOSE, waterKernel);
      waterRawMat.delete();
      // Connected components: keep water regions (>0.3% of image to catch lakes)
      const waterLabels = new cv.Mat();
      const waterStats = new cv.Mat();
      const waterCents = new cv.Mat();
      const numWaterCC = cv.connectedComponentsWithStats(waterClosedMat, waterLabels, waterStats, waterCents);
      waterClosedMat.delete(); waterCents.delete();
      // Collect water components with bounding boxes, crops, and pre-computed sub-clusters
      interface WaterSubCluster { idx: number; pct: number; cropDataUrl: string }
      interface WaterComponent { id: number; area: number; pct: number; cropDataUrl: string; subClusters: WaterSubCluster[] }
      const waterComponents: WaterComponent[] = [];
      const waterMask = new Uint8Array(tp);
      const minWaterSize = Math.round(tp * 0.003); // 0.3% — catch lakes like Tanganyika, Kivu
      const waterLabelData = waterLabels.data32S;
      // Store sub-cluster centroids for "Mix" response handling
      const compSubCentroids = new Map<number, Array<[number, number, number]>>();

      // Helper: generate crop of original image with magenta outline for given pixel set
      const generateOutlineCrop = async (
        pixelTest: (si: number) => boolean,
        cxStat: number, cyStat: number, bwStat: number, bhStat: number,
      ): Promise<string | null> => {
        const pad = 20;
        const cropX = Math.max(0, cxStat - pad);
        const cropY = Math.max(0, cyStat - pad);
        const cropW = Math.min(TW - cropX, bwStat + pad * 2);
        const cropH = Math.min(TH - cropY, bhStat + pad * 2);
        if (cropW <= 3 || cropH <= 3) return null;
        const cropBuf = Buffer.alloc(cropW * cropH * 3);
        for (let y = 0; y < cropH; y++) {
          for (let x = 0; x < cropW; x++) {
            const si = (cropY + y) * TW + (cropX + x);
            const di = (y * cropW + x) * 3;
            cropBuf[di] = origDownBuf[si * 3];
            cropBuf[di + 1] = origDownBuf[si * 3 + 1];
            cropBuf[di + 2] = origDownBuf[si * 3 + 2];
          }
        }
        // Draw 2px magenta border on edge pixels
        for (let y = 0; y < cropH; y++) {
          for (let x = 0; x < cropW; x++) {
            const si = (cropY + y) * TW + (cropX + x);
            if (!pixelTest(si)) continue;
            let isEdge = false;
            for (let dy = -1; dy <= 1 && !isEdge; dy++) {
              for (let dx = -1; dx <= 1 && !isEdge; dx++) {
                if (dx === 0 && dy === 0) continue;
                const ny = cropY + y + dy, nx = cropX + x + dx;
                if (ny < 0 || ny >= TH || nx < 0 || nx >= TW || !pixelTest(ny * TW + nx)) isEdge = true;
              }
            }
            if (isEdge) {
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  const py = y + dy, px = x + dx;
                  if (py >= 0 && py < cropH && px >= 0 && px < cropW) {
                    const di = (py * cropW + px) * 3;
                    cropBuf[di] = 255; cropBuf[di + 1] = 0; cropBuf[di + 2] = 255;
                  }
                }
              }
            }
          }
        }
        const targetW = Math.min(250, cropW * 2);
        const png = await sharp(cropBuf, { raw: { width: cropW, height: cropH, channels: 3 } })
          .resize(targetW, undefined, { kernel: 'lanczos3' }).png().toBuffer();
        return `data:image/png;base64,${png.toString('base64')}`;
      };

      for (let c = 1; c < numWaterCC; c++) {
        const area = waterStats.intAt(c, cv.CC_STAT_AREA);
        if (area < minWaterSize) continue;
        const bw = waterStats.intAt(c, cv.CC_STAT_WIDTH);
        const bh = waterStats.intAt(c, cv.CC_STAT_HEIGHT);
        const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
        const solidity = area / Math.max(1, bw * bh);
        if (aspect > 4 && solidity < 0.3) continue; // elongated + sparse = river

        // Mark this component in the mask
        for (let i = 0; i < tp; i++) {
          if (waterLabelData[i] === c) waterMask[i] = 1;
        }

        const cx = waterStats.intAt(c, cv.CC_STAT_LEFT);
        const cy = waterStats.intAt(c, cv.CC_STAT_TOP);

        // Generate main crop
        let mainCrop: string | undefined;
        try {
          mainCrop = (await generateOutlineCrop(si => waterLabelData[si] === c, cx, cy, bw, bh)) ?? undefined;
        } catch { /* skip */ }
        if (!mainCrop) continue;

        // K=2 sub-clustering on component pixels (for "Mix" option)
        const compPx: Array<[number, number, number, number]> = []; // [r, g, b, pixelIndex]
        for (let y = cy; y < cy + bh && y < TH; y++) {
          for (let x = cx; x < cx + bw && x < TW; x++) {
            const si = y * TW + x;
            if (waterLabelData[si] === c) {
              compPx.push([inpaintedBuf[si * 3], inpaintedBuf[si * 3 + 1], inpaintedBuf[si * 3 + 2], si]);
            }
          }
        }

        const subClusters: WaterSubCluster[] = [];
        if (compPx.length > 20) {
          // Farthest-point K=2 init
          const cents: Array<[number, number, number]> = [[compPx[0][0], compPx[0][1], compPx[0][2]]];
          let maxD = 0, bestI = 0;
          for (let i = 1; i < compPx.length; i++) {
            const d = (compPx[i][0] - cents[0][0]) ** 2 + (compPx[i][1] - cents[0][1]) ** 2 + (compPx[i][2] - cents[0][2]) ** 2;
            if (d > maxD) { maxD = d; bestI = i; }
          }
          cents.push([compPx[bestI][0], compPx[bestI][1], compPx[bestI][2]]);

          // K-means iterations
          const assignments = new Uint8Array(compPx.length);
          for (let iter = 0; iter < 20; iter++) {
            const sums = [[0, 0, 0, 0], [0, 0, 0, 0]];
            for (let i = 0; i < compPx.length; i++) {
              const [r, g, b] = compPx[i];
              const d0 = (r - cents[0][0]) ** 2 + (g - cents[0][1]) ** 2 + (b - cents[0][2]) ** 2;
              const d1 = (r - cents[1][0]) ** 2 + (g - cents[1][1]) ** 2 + (b - cents[1][2]) ** 2;
              const k = d0 <= d1 ? 0 : 1;
              assignments[i] = k;
              sums[k][0] += r; sums[k][1] += g; sums[k][2] += b; sums[k][3]++;
            }
            for (let k = 0; k < 2; k++) {
              if (sums[k][3] > 0) {
                cents[k] = [Math.round(sums[k][0] / sums[k][3]), Math.round(sums[k][1] / sums[k][3]), Math.round(sums[k][2] / sums[k][3])];
              }
            }
          }
          compSubCentroids.set(c, cents);

          // Generate sub-cluster crops with distinct outline colors
          const subPixelSets = [new Set<number>(), new Set<number>()];
          const subAreas = [0, 0];
          for (let i = 0; i < compPx.length; i++) {
            subPixelSets[assignments[i]].add(compPx[i][3]);
            subAreas[assignments[i]]++;
          }
          // Compute bounding box per sub-cluster
          for (let k = 0; k < 2; k++) {
            if (subAreas[k] < 5) continue;
            let minX = TW, minY = TH, maxX = 0, maxY = 0;
            for (const si of subPixelSets[k]) {
              const px = si % TW, py = Math.floor(si / TW);
              if (px < minX) minX = px; if (px > maxX) maxX = px;
              if (py < minY) minY = py; if (py > maxY) maxY = py;
            }
            try {
              const subCrop = await generateOutlineCrop(si => subPixelSets[k].has(si), minX, minY, maxX - minX + 1, maxY - minY + 1);
              if (subCrop) {
                subClusters.push({
                  idx: k,
                  pct: Math.round(subAreas[k] / tp * 1000) / 10,
                  cropDataUrl: subCrop,
                });
              }
            } catch { /* skip */ }
          }
        }

        waterComponents.push({
          id: c, area, pct: Math.round(area / tp * 1000) / 10,
          cropDataUrl: mainCrop,
          subClusters,
        });
      }
      waterLabels.delete(); waterStats.delete();

      console.log(`  [Water] ${waterComponents.length} component(s) after CC filter (from ${numWaterCC - 1} raw)`);

      // Dilate water mask with elliptical kernel for safety margin
      const waterMaskMat = cv.matFromArray(TH, TW, cv.CV_8UC1, waterMask);
      const wdSize = oddK(5);
      const waterDilateKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(wdSize, wdSize));
      const waterGrownMat = new cv.Mat();
      cv.dilate(waterMaskMat, waterGrownMat, waterDilateKernel);
      const waterGrown = new Uint8Array(waterGrownMat.data);
      waterMaskMat.delete(); waterGrownMat.delete(); waterKernel.delete(); waterDilateKernel.delete();

      // Debug: water mask overlay on original image
      const waterVizBuf = Buffer.from(inpaintedBuf);
      let waterPxCount = 0;
      for (let i = 0; i < tp; i++) {
        if (waterGrown[i]) {
          waterVizBuf[i * 3] = 255; waterVizBuf[i * 3 + 1] = 0; waterVizBuf[i * 3 + 2] = 0;
          waterPxCount++;
        }
      }
      const waterDebugPng = await sharp(Buffer.from(waterVizBuf), {
        raw: { width: TW, height: TH, channels: 3 },
      }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
      await pushDebugImage(
        `Water mask (red, ${waterPxCount} px = ${(waterPxCount / tp * 100).toFixed(1)}%)`,
        `data:image/png;base64,${waterDebugPng.toString('base64')}`,
      );

      // Interactive per-component water review
      if (waterComponents.length > 0) {
        const reviewId = `wr-${regionId}-${Date.now()}`;
        // Store crop images in memory — served via GET endpoint (avoids SSE stalling)
        storeWaterCrops(reviewId, waterComponents);
        const cropCount = waterComponents.reduce((n, wc) => n + 1 + wc.subClusters.length, 0);
        console.log(`  [Water] Stored ${cropCount} crop(s) for review ${reviewId}`);
        // Lightweight SSE event — no images, just metadata + reviewId
        sendEvent({
          type: 'water_review',
          reviewId,
          waterPxPercent: Math.round(waterPxCount / tp * 1000) / 10,
          waterComponents: waterComponents.map(wc => ({
            id: wc.id, pct: wc.pct, cropDataUrl: '',
            subClusters: wc.subClusters.map(sc => ({ idx: sc.idx, pct: sc.pct, cropDataUrl: '' })),
          })),
        });
        await new Promise(resolve => setImmediate(resolve));

        // Wait for user response: approved IDs + mix decisions
        // The POST endpoint calls resolveWaterReview() which resolves this promise.
        // Only auto-resolve on timeout (5 min); do NOT auto-resolve on req.close
        // because the SSE connection may drop transiently while the user is deciding.
        const decision = await new Promise<WaterReviewDecision>((resolve) => {
          pendingWaterReviews.set(reviewId, resolve);
          setTimeout(() => {
            if (pendingWaterReviews.has(reviewId)) {
              console.log(`  [Water] Review ${reviewId} timed out — auto-approving all`);
              pendingWaterReviews.delete(reviewId);
              resolve({ approvedIds: waterComponents.map(wc => wc.id), mixDecisions: [] });
            }
          }, 300000);
        });

        // Check if any components were rejected or mixed
        const approvedSet = new Set(decision.approvedIds);
        const mixMap = new Map(decision.mixDecisions.map(m => [m.componentId, new Set(m.approvedSubClusters)]));
        const rejectedIds = waterComponents.filter(wc => !approvedSet.has(wc.id) && !mixMap.has(wc.id)).map(wc => wc.id);
        const needsRebuild = rejectedIds.length > 0 || mixMap.size > 0;
        let preRebuildWaterPx = 0;
        for (let i = 0; i < tp; i++) if (waterGrown[i]) preRebuildWaterPx++;
        console.log(`  [Water] Decision received: approved=[${[...approvedSet]}] rejected=[${rejectedIds}] mix=[${[...mixMap.keys()]}] all_components=[${waterComponents.map(wc => wc.id)}] needsRebuild=${needsRebuild} preRebuildWaterPx=${preRebuildWaterPx}`);

        if (needsRebuild) {
          const changes: string[] = [];
          const rejected = waterComponents.filter(wc => !approvedSet.has(wc.id) && !mixMap.has(wc.id));
          if (rejected.length) changes.push(`${rejected.length} rejected`);
          if (mixMap.size) changes.push(`${mixMap.size} mixed`);
          await logStep(`Rebuilding water mask (${changes.join(', ')})...`);

          // Redo CC analysis from waterRaw to get labels
          const wRawMat2 = cv.matFromArray(TH, TW, cv.CV_8UC1, waterRaw);
          const wk2Size = oddK(7);
          const wKernel2 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(wk2Size, wk2Size));
          const wClosed2 = new cv.Mat();
          cv.morphologyEx(wRawMat2, wClosed2, cv.MORPH_CLOSE, wKernel2);
          wRawMat2.delete();
          const wLabels2 = new cv.Mat();
          const wStats2 = new cv.Mat();
          const wCents2 = new cv.Mat();
          cv.connectedComponentsWithStats(wClosed2, wLabels2, wStats2, wCents2);
          wClosed2.delete(); wCents2.delete();
          const lData2 = wLabels2.data32S;

          waterMask.fill(0);
          for (let i = 0; i < tp; i++) {
            const label = lData2[i];
            if (label <= 0) continue;
            const lArea = wStats2.intAt(label, cv.CC_STAT_AREA);
            if (lArea < minWaterSize) continue;
            const lbw = wStats2.intAt(label, cv.CC_STAT_WIDTH);
            const lbh = wStats2.intAt(label, cv.CC_STAT_HEIGHT);
            const lasp = Math.max(lbw, lbh) / Math.max(1, Math.min(lbw, lbh));
            const lsol = lArea / Math.max(1, lbw * lbh);
            if (lasp > 4 && lsol < 0.3) continue;

            if (approvedSet.has(label)) {
              waterMask[i] = 1; // Fully approved
            } else if (mixMap.has(label)) {
              // Mix: keep only approved sub-clusters
              const approvedSubs = mixMap.get(label)!;
              const cents = compSubCentroids.get(label);
              if (cents) {
                const r = inpaintedBuf[i * 3], g = inpaintedBuf[i * 3 + 1], b = inpaintedBuf[i * 3 + 2];
                const d0 = (r - cents[0][0]) ** 2 + (g - cents[0][1]) ** 2 + (b - cents[0][2]) ** 2;
                const d1 = (r - cents[1][0]) ** 2 + (g - cents[1][1]) ** 2 + (b - cents[1][2]) ** 2;
                const nearest = d0 <= d1 ? 0 : 1;
                if (approvedSubs.has(nearest)) waterMask[i] = 1;
              }
            }
            // Else: rejected — waterMask stays 0
          }
          wLabels2.delete(); wStats2.delete(); wKernel2.delete();

          // Re-dilate
          const wm3 = cv.matFromArray(TH, TW, cv.CV_8UC1, waterMask);
          const wd3Size = oddK(5);
          const wdk3 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(wd3Size, wd3Size));
          const wg3 = new cv.Mat();
          cv.dilate(wm3, wg3, wdk3);
          const newGrown = new Uint8Array(wg3.data);
          wm3.delete(); wg3.delete(); wdk3.delete();
          for (let i = 0; i < tp; i++) waterGrown[i] = newGrown[i];
          let postRebuildWaterPx = 0;
          for (let i = 0; i < tp; i++) if (waterGrown[i]) postRebuildWaterPx++;
          console.log(`  [Water] Rebuild complete: ${preRebuildWaterPx} → ${postRebuildWaterPx} water px (delta: ${postRebuildWaterPx - preRebuildWaterPx})`);

          // Updated debug image
          let cnt = 0;
          const viz = Buffer.from(inpaintedBuf);
          for (let i = 0; i < tp; i++) {
            if (waterGrown[i]) { viz[i * 3] = 255; viz[i * 3 + 1] = 0; viz[i * 3 + 2] = 0; cnt++; }
          }
          const p = await sharp(Buffer.from(viz), { raw: { width: TW, height: TH, channels: 3 } })
            .resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
          await pushDebugImage(
            `Water mask (corrected, ${cnt} px = ${(cnt / tp * 100).toFixed(1)}%)`,
            `data:image/png;base64,${p.toString('base64')}`,
          );
        }
      }

      // Detect background colors via K-means on 5px-band image edge pixels
      const edgePx: Array<[number, number, number]> = [];
      for (let x = 0; x < TW; x++) {
        for (let band = 0; band < 5; band++) {
          const tIdx = (band * TW + x) * 3;
          const bIdx = ((TH - 1 - band) * TW + x) * 3;
          edgePx.push([buf[tIdx], buf[tIdx + 1], buf[tIdx + 2]]);
          edgePx.push([buf[bIdx], buf[bIdx + 1], buf[bIdx + 2]]);
        }
      }
      for (let y = 0; y < TH; y++) {
        for (let band = 0; band < 5; band++) {
          const lIdx = (y * TW + band) * 3;
          const rIdx = (y * TW + TW - 1 - band) * 3;
          edgePx.push([buf[lIdx], buf[lIdx + 1], buf[lIdx + 2]]);
          edgePx.push([buf[rIdx], buf[rIdx + 1], buf[rIdx + 2]]);
        }
      }

      // K-means (K=3) on edge pixels with farthest-point initialization
      const BK = 3;
      const bgCentroids: Array<[number, number, number]> = [edgePx[0]];
      for (let c = 1; c < BK; c++) {
        let maxDist = 0, bestIdx = 0;
        for (let i = 0; i < edgePx.length; i++) {
          let minDist = Infinity;
          for (const ct of bgCentroids) {
            const d = (edgePx[i][0] - ct[0]) ** 2 + (edgePx[i][1] - ct[1]) ** 2 + (edgePx[i][2] - ct[2]) ** 2;
            if (d < minDist) minDist = d;
          }
          if (minDist > maxDist) { maxDist = minDist; bestIdx = i; }
        }
        bgCentroids.push([...edgePx[bestIdx]]);
      }
      for (let iter = 0; iter < 20; iter++) {
        const sums = bgCentroids.map(() => [0, 0, 0, 0]);
        for (const px of edgePx) {
          let bestDist = Infinity, bestK = 0;
          for (let k = 0; k < BK; k++) {
            const d = (px[0] - bgCentroids[k][0]) ** 2 + (px[1] - bgCentroids[k][1]) ** 2 + (px[2] - bgCentroids[k][2]) ** 2;
            if (d < bestDist) { bestDist = d; bestK = k; }
          }
          sums[bestK][0] += px[0]; sums[bestK][1] += px[1]; sums[bestK][2] += px[2]; sums[bestK][3]++;
        }
        for (let k = 0; k < BK; k++) {
          if (sums[k][3] > 0) {
            bgCentroids[k] = [
              Math.round(sums[k][0] / sums[k][3]),
              Math.round(sums[k][1] / sums[k][3]),
              Math.round(sums[k][2] / sums[k][3]),
            ];
          }
        }
      }

      // Active background = edge clusters with >10% of edge pixels
      const bgCnts = new Array(BK).fill(0);
      for (const px of edgePx) {
        let bestDist = Infinity, bestK = 0;
        for (let k = 0; k < BK; k++) {
          const d = (px[0] - bgCentroids[k][0]) ** 2 + (px[1] - bgCentroids[k][1]) ** 2 + (px[2] - bgCentroids[k][2]) ** 2;
          if (d < bestDist) { bestDist = d; bestK = k; }
        }
        bgCnts[bestK]++;
      }
      const activeBg: Array<[number, number, number]> = [];
      for (let k = 0; k < BK; k++) {
        if (bgCnts[k] / edgePx.length > 0.10) activeBg.push(bgCentroids[k]);
      }

      // ── Coastal band: the water detector found the coastline with a fine border.
      // Pixels adjacent to detected water on the land side are guaranteed foreground —
      // use this to protect thin coastal strips from being erased by bg detection.
      const COAST_BAND_R = pxS(5);
      const coastalBand = new Uint8Array(tp);
      let coastalCount = 0;
      for (let i = 0; i < tp; i++) {
        if (!waterGrown[i]) continue;
        const wx = i % TW, wy = Math.floor(i / TW);
        for (let dy = -COAST_BAND_R; dy <= COAST_BAND_R; dy++) {
          for (let dx = -COAST_BAND_R; dx <= COAST_BAND_R; dx++) {
            if (dx * dx + dy * dy > COAST_BAND_R * COAST_BAND_R) continue;
            const nx = wx + dx, ny = wy + dy;
            if (nx < 0 || nx >= TW || ny < 0 || ny >= TH) continue;
            const ni = ny * TW + nx;
            if (!waterGrown[ni] && !coastalBand[ni]) { coastalBand[ni] = 1; coastalCount++; }
          }
        }
      }
      console.log(`  [FG] Coastal band: ${coastalCount} pixels marked as guaranteed foreground (within ${COAST_BAND_R}px of water)`);

      // Foreground mask: pixel is foreground if it's far from background AND has saturation.
      // Three additional forced-foreground signals prevent thin strips from disappearing:
      //  1. textExcluded: text was detected there → on top of the map region, not background
      //  2. coastalBand: adjacent to detected water → land side of coastline
      const fgMask = new Uint8Array(tp);
      const BG_DIST_SQ = 35 * 35; // RGB distance threshold from background colors
      const MIN_FG_SAT = 25; // OpenCV S range 0-255; actual map regions have S>30
      for (let i = 0; i < tp; i++) {
        if (waterGrown[i]) continue;
        // Forced foreground: text areas and coastal band survive regardless of color
        if (textExcluded[i] || coastalBand[i]) { fgMask[i] = 1; continue; }
        const sat = hsvBuf[i * 3 + 1];
        let isBg = false;
        for (const bg of activeBg) {
          const dr = buf[i * 3] - bg[0], dg = buf[i * 3 + 1] - bg[1], db = buf[i * 3 + 2] - bg[2];
          if (dr * dr + dg * dg + db * db <= BG_DIST_SQ) { isBg = true; break; }
        }
        // Foreground: far from background, or has meaningful color saturation
        if (!isBg || sat > MIN_FG_SAT) fgMask[i] = 1;
      }

      // Morphological helper
      function cvMorphOp(mask: Uint8Array, w: number, h: number, op: number, kernelSize: number): Uint8Array {
        const mat = cv.matFromArray(h, w, cv.CV_8UC1, mask);
        const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(kernelSize, kernelSize));
        const dst = new cv.Mat();
        cv.morphologyEx(mat, dst, op, kernel);
        const result = new Uint8Array(dst.data);
        mat.delete(); kernel.delete(); dst.delete();
        return result;
      }

      // Smooth the binary mask with Gaussian blur + re-threshold.
      // This removes noisy spikes from colored lines in the gray background area,
      // filling small gaps and smoothing the boundary before morphological close.
      const fgMat = cv.matFromArray(TH, TW, cv.CV_8UC1, fgMask);
      // Scale to 0-255 for blur
      for (let i = 0; i < tp; i++) fgMat.data[i] = fgMat.data[i] ? 255 : 0;
      const fgBlurred = new cv.Mat();
      const gbSize = oddK(15);
      cv.GaussianBlur(fgMat, fgBlurred, new cv.Size(gbSize, gbSize), 0);
      const fgSmoothed = new cv.Mat();
      cv.threshold(fgBlurred, fgSmoothed, 128, 1, cv.THRESH_BINARY);
      const smoothedFg = new Uint8Array(fgSmoothed.data);
      fgMat.delete(); fgBlurred.delete(); fgSmoothed.delete();

      // Close: fills gaps from region borders (scales with resolution)
      const closed = cvMorphOp(smoothedFg, TW, TH, cv.MORPH_CLOSE, oddK(31));

      await logStep('Connected components + country silhouette...');
      // Connected components via OpenCV (8-connectivity, faster than manual BFS)
      const closedMat = cv.matFromArray(TH, TW, cv.CV_8UC1, closed);
      const ccLabelsMat = new cv.Mat();
      const ccStats = new cv.Mat();
      const ccCents = new cv.Mat();
      const numCC = cv.connectedComponentsWithStats(closedMat, ccLabelsMat, ccStats, ccCents);
      closedMat.delete(); ccCents.delete();
      const ccLabels = ccLabelsMat.data32S; // Int32Array view

      // Prefer largest component that doesn't touch image border (country surrounded by bg)
      const touchesBorder = new Set<number>();
      for (let x = 0; x < TW; x++) {
        if (ccLabels[x] > 0) touchesBorder.add(ccLabels[x]);
        if (ccLabels[(TH - 1) * TW + x] > 0) touchesBorder.add(ccLabels[(TH - 1) * TW + x]);
      }
      for (let y = 0; y < TH; y++) {
        if (ccLabels[y * TW] > 0) touchesBorder.add(ccLabels[y * TW]);
        if (ccLabels[y * TW + TW - 1] > 0) touchesBorder.add(ccLabels[y * TW + TW - 1]);
      }
      // Build sorted list of components by area (skip label 0 = background)
      const componentSizes: Array<{ id: number; size: number }> = [];
      for (let c = 1; c < numCC; c++) {
        componentSizes.push({ id: c, size: ccStats.intAt(c, cv.CC_STAT_AREA) });
      }
      componentSizes.sort((a, b) => b.size - a.size);
      let countryComp = componentSizes.length > 0 ? componentSizes[0].id : 0;
      for (const c of componentSizes) {
        if (!touchesBorder.has(c.id) && c.size > tp * 0.10) { countryComp = c.id; break; }
      }
      if (componentSizes.length > 0 && ccStats.intAt(countryComp, cv.CC_STAT_AREA) < tp * 0.10) {
        countryComp = componentSizes[0].id;
      }
      ccStats.delete();

      // Fill interior holes (flood from image border, anything not reached = country)
      const outerMask = new Uint8Array(tp);
      const borderQueue: number[] = [];
      for (let x = 0; x < TW; x++) { borderQueue.push(x); borderQueue.push((TH - 1) * TW + x); }
      for (let y = 0; y < TH; y++) { borderQueue.push(y * TW); borderQueue.push(y * TW + TW - 1); }
      for (const p of borderQueue) outerMask[p] = 1;
      let bHead = 0;
      while (bHead < borderQueue.length) {
        const p = borderQueue[bHead++];
        for (const n of [p - TW, p + TW, p - 1, p + 1]) {
          if (n >= 0 && n < tp && !outerMask[n] && ccLabels[n] !== countryComp) {
            outerMask[n] = 1;
            borderQueue.push(n);
          }
        }
      }

      let countryMask = new Uint8Array(tp);
      let countrySize = 0;
      for (let i = 0; i < tp; i++) {
        // Exclude water pixels — interior hole fill would otherwise re-include lakes
        // surrounded by land (e.g. Lake Victoria) since flood can't reach them
        countryMask[i] = ((ccLabels[i] === countryComp || !outerMask[i]) && !waterGrown[i]) ? 1 : 0;
        if (countryMask[i]) countrySize++;
      }
      ccLabelsMat.delete(); // done with ccLabels view

      // Restore forced-foreground pixels that morphological pipeline erased.
      // Gaussian blur (25px kernel) destroys thin strips (~15px wide), and CC selection
      // drops fragments disconnected from the main body. But textExcluded (text on map
      // regions) and coastalBand (land adjacent to water) are known foreground — re-add them.
      let forcedRestored = 0;
      for (let i = 0; i < tp; i++) {
        if (!waterGrown[i] && !countryMask[i] && (textExcluded[i] || coastalBand[i])) {
          countryMask[i] = 1;
          countrySize++;
          forcedRestored++;
        }
      }
      if (forcedRestored > 0) {
        console.log(`  [FG] Restored ${forcedRestored} forced-foreground pixels erased by morph pipeline`);
      }

      // Saturation refinement: when country mask is >70% of image, the background
      // detection likely failed (neighbors have similar gray tones). Use saturation
      // to separate colorful country regions from muted gray neighbors.
      const initialMaskPct = countrySize / tp;
      if (initialMaskPct > 0.70) {
        // Compute per-pixel saturation: sat = (max - min) / max
        const sat = new Uint8Array(tp);
        for (let i = 0; i < tp; i++) {
          const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          sat[i] = max === 0 ? 0 : Math.round(((max - min) / max) * 255);
        }

        // Otsu threshold on saturation histogram of country-mask pixels
        const satHist = new Array(256).fill(0);
        let satTotal = 0;
        for (let i = 0; i < tp; i++) {
          if (countryMask[i]) { satHist[sat[i]]++; satTotal++; }
        }
        let totalSum = 0;
        for (let i = 0; i < 256; i++) totalSum += i * satHist[i];

        let bestThresh = 0, bestVariance = 0, bgSum = 0, bgCount = 0;
        for (let t = 0; t < 256; t++) {
          bgCount += satHist[t];
          bgSum += t * satHist[t];
          const fgCount = satTotal - bgCount;
          if (bgCount === 0 || fgCount === 0) continue;
          const bgMean = bgSum / bgCount;
          const fgMean = (totalSum - bgSum) / fgCount;
          const variance = bgCount * fgCount * (bgMean - fgMean) ** 2;
          if (variance > bestVariance) { bestVariance = variance; bestThresh = t; }
        }
        const satThreshold = Math.max(15, Math.min(80, bestThresh));

        // Smooth saturation with OpenCV 5×5 median for robustness
        const satMat = cv.matFromArray(TH, TW, cv.CV_8UC1, sat);
        const satBlurred = new cv.Mat();
        cv.medianBlur(satMat, satBlurred, oddK(9));
        const satSmooth = new Uint8Array(satBlurred.data);
        satMat.delete(); satBlurred.delete();

        // Keep only saturated pixels, then close gaps and find largest CC
        const refinedFg = new Uint8Array(tp);
        for (let i = 0; i < tp; i++) {
          if (countryMask[i] && satSmooth[i] >= satThreshold) refinedFg[i] = 1;
        }
        // Close: fill holes from text inpainting (scales with resolution)
        const refinedClosed = cvMorphOp(refinedFg, TW, TH, cv.MORPH_CLOSE, oddK(41));

        // Find largest CC via OpenCV
        const rClosedMat = cv.matFromArray(TH, TW, cv.CV_8UC1, refinedClosed);
        const rLabels = new cv.Mat();
        const rStats = new cv.Mat();
        const rCents = new cv.Mat();
        const numRCC = cv.connectedComponentsWithStats(rClosedMat, rLabels, rStats, rCents);
        rClosedMat.delete(); rCents.delete();
        const rccLabels = rLabels.data32S;
        let rcc = 0, rccMaxSize = 0;
        for (let c = 1; c < numRCC; c++) {
          const area = rStats.intAt(c, cv.CC_STAT_AREA);
          if (area > rccMaxSize) { rccMaxSize = area; rcc = c; }
        }
        rStats.delete();

        // Rebuild country mask with outer flood fill
        const rOuterMask = new Uint8Array(tp);
        const rBorderQ: number[] = [];
        for (let x = 0; x < TW; x++) { rBorderQ.push(x); rBorderQ.push((TH - 1) * TW + x); }
        for (let y = 0; y < TH; y++) { rBorderQ.push(y * TW); rBorderQ.push(y * TW + TW - 1); }
        for (const p of rBorderQ) rOuterMask[p] = 1;
        let rHead = 0;
        while (rHead < rBorderQ.length) {
          const p = rBorderQ[rHead++];
          for (const n of [p - TW, p + TW, p - 1, p + 1])
            if (n >= 0 && n < tp && !rOuterMask[n] && rccLabels[n] !== rcc) { rOuterMask[n] = 1; rBorderQ.push(n); }
        }

        const refinedCountry = new Uint8Array(tp);
        let refinedSize = 0;
        for (let i = 0; i < tp; i++) {
          refinedCountry[i] = ((rccLabels[i] === rcc || !rOuterMask[i]) && !waterGrown[i]) ? 1 : 0;
          if (refinedCountry[i]) refinedSize++;
        }
        rLabels.delete(); // done with rccLabels view

        // Restore forced-foreground pixels in refined mask too
        for (let i = 0; i < tp; i++) {
          if (!waterGrown[i] && !refinedCountry[i] && (textExcluded[i] || coastalBand[i])) {
            refinedCountry[i] = 1;
            refinedSize++;
          }
        }

        // Use refined mask if significantly smaller and still reasonable
        if (refinedSize / tp < initialMaskPct * 0.85 && refinedSize / tp > 0.10) {
          countryMask = refinedCountry;
          countrySize = refinedSize;
        }
      }

      // Debug: show country mask + water mask overlay
      const maskVizBuf = Buffer.alloc(tp * 3, 200); // gray background
      for (let i = 0; i < tp; i++) {
        if (waterGrown[i]) {
          maskVizBuf[i * 3] = 60; maskVizBuf[i * 3 + 1] = 120; maskVizBuf[i * 3 + 2] = 200; // blue = water
        } else if (countryMask[i]) {
          maskVizBuf[i * 3] = buf[i * 3]; maskVizBuf[i * 3 + 1] = buf[i * 3 + 1]; maskVizBuf[i * 3 + 2] = buf[i * 3 + 2]; // original colors
        }
      }
      const maskPng = await sharp(maskVizBuf, {
        raw: { width: TW, height: TH, channels: 3 },
      }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
      await pushDebugImage(
        `Country mask (${(countrySize / tp * 100).toFixed(0)}% of image) + water (blue)`,
        `data:image/png;base64,${maskPng.toString('base64')}`,
      );

      // ── Park overlay detection & removal ──────────────────────────────────
      // Wikivoyage maps overlay national parks/reserves as dark saturated green
      // blobs on top of region colors. These steal K-means clusters from actual
      // regions. Detect them by: dark + saturated + greenish pixels within the
      // country mask, forming mid-sized blobs that are distinctly darker than
      // their surroundings. Inpaint confirmed parks with per-pixel nearest
      // boundary color (not uniform average) so parks spanning two regions get
      // correct colors on each side.
      await logStep('Detecting park overlays...');
      {
        // Step 1: Find "dark saturated green" candidates in the country mask
        const parkCandidate = new Uint8Array(tp);
        // Compute median brightness of country pixels to set relative threshold
        const brightnesses: number[] = [];
        for (let i = 0; i < tp; i++) {
          if (!countryMask[i]) continue;
          brightnesses.push(Math.max(buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]));
        }
        brightnesses.sort((a, b) => a - b);
        const medianV = brightnesses[Math.floor(brightnesses.length / 2)] || 128;
        // Park criterion: dark relative to median, saturated, greenish
        const vThresh = Math.round(medianV * 0.78); // darker than 78% of median (was 72%)
        for (let i = 0; i < tp; i++) {
          if (!countryMask[i]) continue;
          const r = buf[i * 3], g = buf[i * 3 + 1], b2 = buf[i * 3 + 2];
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
          for (const p of pixels) { rr += buf[p * 3]; gg += buf[p * 3 + 1]; bb += buf[p * 3 + 2]; }
          const avgR = Math.round(rr / pixels.length), avgG = Math.round(gg / pixels.length), avgB = Math.round(bb / pixels.length);

          // Step 4: Compute average boundary color for contrast check
          const blobSet = new Set(pixels);
          let bndCount = 0, brSum = 0, bgSum = 0, bbSum = 0;
          for (const p of pixels) {
            for (const n of [p - TW, p + TW, p - 1, p + 1]) {
              if (n >= 0 && n < tp && countryMask[n] && !blobSet.has(n) && !parkMask[n]) {
                brSum += buf[n * 3]; bgSum += buf[n * 3 + 1]; bbSum += buf[n * 3 + 2];
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
          //   Pass 1: BFS fill detected blobs + 6px dilation from buf boundary.
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
            // BFS from boundary — seed from buf (same color space as K-means input)
            const parkFillColor = new Int32Array(tp * 3).fill(-1);
            const bfsQueue: number[] = [];
            const fillSet = new Set<number>();
            for (let i = 0; i < tp; i++) { if (fillZone[i]) fillSet.add(i); }
            for (const p of fillSet) {
              for (const n of [p - TW, p + TW, p - 1, p + 1]) {
                if (n >= 0 && n < tp && countryMask[n] && !fillSet.has(n) && parkFillColor[n * 3] === -1) {
                  parkFillColor[n * 3] = buf[n * 3];
                  parkFillColor[n * 3 + 1] = buf[n * 3 + 1];
                  parkFillColor[n * 3 + 2] = buf[n * 3 + 2];
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
                buf[p * 3] = parkFillColor[p * 3];
                buf[p * 3 + 1] = parkFillColor[p * 3 + 1];
                buf[p * 3 + 2] = parkFillColor[p * 3 + 2];
              }
            }

            // ── Pass 2: cleanup remaining dark-green remnants ──
            const allFilled = new Uint8Array(tp); // track everything we've filled
            for (const p of fillSet) allFilled[p] = 1;
            const remnant = new Uint8Array(tp);
            let remnantCount = 0;
            for (let i = 0; i < tp; i++) {
              if (!countryMask[i] || allFilled[i]) continue;
              const r = buf[i * 3], g = buf[i * 3 + 1], b2 = buf[i * 3 + 2];
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
                    remFill[n * 3] = buf[n * 3];
                    remFill[n * 3 + 1] = buf[n * 3 + 1];
                    remFill[n * 3 + 2] = buf[n * 3 + 2];
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
                  buf[i * 3] = remFill[i * 3];
                  buf[i * 3 + 1] = remFill[i * 3 + 1];
                  buf[i * 3 + 2] = remFill[i * 3 + 2];
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
                    samples.push([buf[ni * 3], buf[ni * 3 + 1], buf[ni * 3 + 2]]);
                  }
                }
              }
              if (samples.length >= 3) {
                samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
                const mid = samples[Math.floor(samples.length / 2)];
                buf[i * 3] = mid[0]; buf[i * 3 + 1] = mid[1]; buf[i * 3 + 2] = mid[2];
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
                afterParkBuf[i * 3] = buf[i * 3]; afterParkBuf[i * 3 + 1] = buf[i * 3 + 1]; afterParkBuf[i * 3 + 2] = buf[i * 3 + 2];
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

      await logStep('K-means color clustering...');

      // Convert clean color buffer to CIELAB for perceptually-accurate K-means
      const cvBufForLab = new cv.Mat(TH, TW, cv.CV_8UC3);
      cvBufForLab.data.set(buf);
      const cvLabMat = new cv.Mat();
      cv.cvtColor(cvBufForLab, cvLabMat, cv.COLOR_RGB2Lab);
      const labBuf = Buffer.from(cvLabMat.data);
      cvBufForLab.delete(); cvLabMat.delete();

      // Per-channel stats for z-score normalization (amplifies chromatic differences)
      let sumL = 0, sumA = 0, sumB = 0, sumL2 = 0, sumA2 = 0, sumB2 = 0;
      let statCount = 0;
      for (let i = 0; i < tp; i++) {
        if (!countryMask[i] || textExcluded[i]) continue;
        const L = labBuf[i * 3], a = labBuf[i * 3 + 1], b = labBuf[i * 3 + 2];
        sumL += L; sumA += a; sumB += b;
        sumL2 += L * L; sumA2 += a * a; sumB2 += b * b;
        statCount++;
      }
      if (statCount === 0) throw new Error('No country pixels remaining after text exclusion — cannot cluster');
      const meanL = sumL / statCount, meanA = sumA / statCount, meanB = sumB / statCount;
      const rawStdL = Math.sqrt(Math.max(0, sumL2 / statCount - meanL * meanL));
      const rawStdA = Math.sqrt(Math.max(0, sumA2 / statCount - meanA * meanA));
      const rawStdB = Math.sqrt(Math.max(0, sumB2 / statCount - meanB * meanB));
      const stdL = rawStdL < 0.01 ? 1.0 : rawStdL;
      const stdA = rawStdA < 0.01 ? 1.0 : rawStdA;
      const stdB = rawStdB < 0.01 ? 1.0 : rawStdB;
      const wL = 0.5 / stdL, wA = 1.0 / stdA, wB = 1.0 / stdB;
      console.log(`  [Lab] mean=(${meanL.toFixed(1)},${meanA.toFixed(1)},${meanB.toFixed(1)}) std=(${stdL.toFixed(1)},${stdA.toFixed(1)},${stdB.toFixed(1)})`);

      // K-means: use ~3x expected region count for enough color resolution
      // to separate similar-but-distinct regions. The merge step consolidates
      // truly redundant clusters afterward. Cap at 32, floor at 8.
      const CK = Math.max(8, Math.min(expectedRegionCount * 3, 32));
      console.log(`  [K-means] CK=${CK} (expectedRegions=${expectedRegionCount})`);
      // Exclude text pixels from K-means centroids — their BFS-filled colors are
      // from nearest neighbors and may be wrong at region boundaries.
      // Park pixels are already filled with correct boundary colors in buf (=colorBuf).
      const countryPixels: Array<[number, number, number]> = [];
      const countryIndices: number[] = [];
      let textExcludedCount = 0;
      for (let i = 0; i < tp; i++) {
        if (countryMask[i]) {
          if (textExcluded[i]) { textExcludedCount++; continue; }
          countryPixels.push([
            (labBuf[i * 3] - meanL) * wL,
            (labBuf[i * 3 + 1] - meanA) * wA,
            (labBuf[i * 3 + 2] - meanB) * wB,
          ]);
          countryIndices.push(i);
        }
      }
      if (textExcludedCount > 0) {
        console.log(`  [K-means] Excluded ${textExcludedCount} text pixels from centroid computation (${(textExcludedCount / countrySize * 100).toFixed(1)}% of country)`);
      }

      // K-means++ initialization: probabilistic distance-weighted sampling
      const colorCentroids: Array<[number, number, number]> = [countryPixels[Math.floor(countryPixels.length / 2)]];
      for (let c = 1; c < CK; c++) {
        const d2 = new Float64Array(countryPixels.length);
        let totalD2 = 0;
        for (let i = 0; i < countryPixels.length; i++) {
          let minDist = Infinity;
          for (const ct of colorCentroids) {
            const d = (countryPixels[i][0] - ct[0]) ** 2 + (countryPixels[i][1] - ct[1]) ** 2 + (countryPixels[i][2] - ct[2]) ** 2;
            if (d < minDist) minDist = d;
          }
          d2[i] = minDist;
          totalD2 += minDist;
        }
        let target = Math.random() * totalD2;
        let chosen = 0;
        for (let i = 0; i < countryPixels.length; i++) {
          target -= d2[i];
          if (target <= 0) { chosen = i; break; }
        }
        let retries = 0;
        while (retries < 5) {
          const p = countryPixels[chosen];
          let tooClose = false;
          for (const ct of colorCentroids) {
            if ((p[0] - ct[0]) ** 2 + (p[1] - ct[1]) ** 2 + (p[2] - ct[2]) ** 2 < 4) { tooClose = true; break; }
          }
          if (!tooClose) break;
          chosen = Math.floor(Math.random() * countryPixels.length);
          retries++;
        }
        colorCentroids.push([...countryPixels[chosen]]);
      }
      const MAX_ITER = 40;
      for (let iter = 0; iter < MAX_ITER; iter++) {
        const sums = colorCentroids.map(() => [0, 0, 0, 0]);
        for (const px of countryPixels) {
          let bestDist = Infinity, bestK = 0;
          for (let k = 0; k < CK; k++) {
            const d = (px[0] - colorCentroids[k][0]) ** 2 + (px[1] - colorCentroids[k][1]) ** 2 + (px[2] - colorCentroids[k][2]) ** 2;
            if (d < bestDist) { bestDist = d; bestK = k; }
          }
          sums[bestK][0] += px[0]; sums[bestK][1] += px[1]; sums[bestK][2] += px[2]; sums[bestK][3]++;
        }
        let totalMovement = 0;
        for (let k = 0; k < CK; k++) {
          if (sums[k][3] > 0) {
            const newC: [number, number, number] = [
              sums[k][0] / sums[k][3],
              sums[k][1] / sums[k][3],
              sums[k][2] / sums[k][3],
            ];
            totalMovement += Math.abs(newC[0] - colorCentroids[k][0]) + Math.abs(newC[1] - colorCentroids[k][1]) + Math.abs(newC[2] - colorCentroids[k][2]);
            colorCentroids[k] = newC;
          }
        }
        if (totalMovement < 1.0) {
          console.log(`  [K-means] Converged at iteration ${iter + 1}`);
          break;
        }
      }

      // Convert centroids: normalized Lab → original Lab → RGB (for debug viz + shared pipeline)
      const rgbCentroids: Array<[number, number, number]> = colorCentroids.map(c => {
        const oL = Math.round(Math.min(255, Math.max(0, c[0] / wL + meanL)));
        const oA = Math.round(Math.min(255, Math.max(0, c[1] / wA + meanA)));
        const oB = Math.round(Math.min(255, Math.max(0, c[2] / wB + meanB)));
        const labPx = new cv.Mat(1, 1, cv.CV_8UC3);
        labPx.data[0] = oL; labPx.data[1] = oA; labPx.data[2] = oB;
        const rgbPx = new cv.Mat();
        cv.cvtColor(labPx, rgbPx, cv.COLOR_Lab2RGB);
        const rgb: [number, number, number] = [rgbPx.data[0], rgbPx.data[1], rgbPx.data[2]];
        labPx.delete(); rgbPx.delete();
        return rgb;
      });

      // Two-phase label assignment using colorBuf (lightly filtered, accurate colors):
      // Phase 1: Assign labels to clean (non-excluded) country pixels by nearest centroid.
      // Phase 2: BFS-propagate labels from clean pixels into excluded (text+park) gaps.
      // Clean pixels have accurate per-region colors from colorBuf (median(3) + mean shift).
      // Excluded pixels get labels from spatial neighbors, preserving connectivity.
      const pixelLabels = new Uint8Array(tp).fill(255);
      const clusterCounts = new Array(CK).fill(0);
      // Phase 1: color-based assignment for clean pixels only (normalized Lab)
      for (let i = 0; i < tp; i++) {
        if (!countryMask[i] || textExcluded[i]) continue;
        const nL = (labBuf[i * 3] - meanL) * wL;
        const nA = (labBuf[i * 3 + 1] - meanA) * wA;
        const nB = (labBuf[i * 3 + 2] - meanB) * wB;
        let bestDist = Infinity, bestK = 0;
        for (let k = 0; k < CK; k++) {
          const d = (nL - colorCentroids[k][0]) ** 2 + (nA - colorCentroids[k][1]) ** 2 + (nB - colorCentroids[k][2]) ** 2;
          if (d < bestDist) { bestDist = d; bestK = k; }
        }
        pixelLabels[i] = bestK;
        clusterCounts[bestK]++;
      }
      // Phase 2: BFS from clean pixels into text regions
      if (textExcludedCount > 0) {
        const bfsQ: number[] = [];
        for (let i = 0; i < tp; i++) {
          if (pixelLabels[i] < 255) bfsQ.push(i);
        }
        let bfsH = 0, bfsFilled = 0;
        while (bfsH < bfsQ.length) {
          const p = bfsQ[bfsH++];
          const lbl = pixelLabels[p];
          for (const n of [p - TW, p + TW, p - 1, p + 1]) {
            if (n >= 0 && n < tp && countryMask[n] && pixelLabels[n] === 255) {
              pixelLabels[n] = lbl;
              clusterCounts[lbl]++;
              bfsQ.push(n);
              bfsFilled++;
            }
          }
        }
        console.log(`  [K-means] BFS propagated labels to ${bfsFilled} text pixels`);
      }

      // Spatial mode filter: clean up salt-and-pepper noise from BFS seams and line residue.
      // For each pixel, if the majority of its neighborhood has a different label AND the
      // pixel's color is reasonably close to the majority's centroid, relabel it.
      const MODE_R = pxS(5); // radius in pixels (8 at TW=800)
      let modeRelabeled = 0;
      const newLabels = new Uint8Array(pixelLabels); // copy — don't modify during iteration
      for (let i = 0; i < tp; i++) {
        if (!countryMask[i] || pixelLabels[i] === 255) continue;
        const ix = i % TW, iy = Math.floor(i / TW);
        const votes = new Map<number, number>();
        for (let dy = -MODE_R; dy <= MODE_R; dy++) {
          const ny = iy + dy;
          if (ny < 0 || ny >= TH) continue;
          for (let dx = -MODE_R; dx <= MODE_R; dx++) {
            const nx = ix + dx;
            if (nx < 0 || nx >= TW) continue;
            const ni = ny * TW + nx;
            if (pixelLabels[ni] !== 255) votes.set(pixelLabels[ni], (votes.get(pixelLabels[ni]) || 0) + 1);
          }
        }
        const myLabel = pixelLabels[i];
        let bestLabel = myLabel, bestCount = 0;
        for (const [lbl, cnt] of votes) {
          if (cnt > bestCount) { bestCount = cnt; bestLabel = lbl; }
        }
        if (bestLabel === myLabel) continue;
        // Guard: only relabel if pixel's color is close enough to majority centroid
        const nL = (labBuf[i * 3] - meanL) * wL;
        const nA = (labBuf[i * 3 + 1] - meanA) * wA;
        const nB = (labBuf[i * 3 + 2] - meanB) * wB;
        const distOwn = (nL - colorCentroids[myLabel][0]) ** 2 + (nA - colorCentroids[myLabel][1]) ** 2 + (nB - colorCentroids[myLabel][2]) ** 2;
        const distMaj = (nL - colorCentroids[bestLabel][0]) ** 2 + (nA - colorCentroids[bestLabel][1]) ** 2 + (nB - colorCentroids[bestLabel][2]) ** 2;
        if (distMaj < distOwn * 2.0) {
          newLabels[i] = bestLabel;
          modeRelabeled++;
        }
      }
      // Apply relabeling
      if (modeRelabeled > 0) {
        for (let i = 0; i < tp; i++) pixelLabels[i] = newLabels[i];
        // Recount
        clusterCounts.fill(0);
        for (let i = 0; i < tp; i++) {
          if (countryMask[i] && pixelLabels[i] < 255) clusterCounts[pixelLabels[i]]++;
        }
        console.log(`  [Mode filter] Relabeled ${modeRelabeled} noisy pixels to neighborhood majority`);
      }

      // Log K-means results before processing
      console.log(`  [K-means] ${CK} clusters, countrySize=${countrySize}:`);
      for (let k = 0; k < CK; k++) {
        if (clusterCounts[k] === 0) continue;
        const pct = (clusterCounts[k] / countrySize * 100).toFixed(1);
        const c = rgbCentroids[k];
        console.log(`    cluster ${k}: RGB(${c[0]},${c[1]},${c[2]}) ${clusterCounts[k]}px (${pct}%)`);
      }


      // ── Spatial split through complete event: delegated to shared function ──
      await matchDivisionsFromClusters({
        worldViewId, regionId,
        knownDivisionIds,
        buf, mapBuffer, countryMask, waterGrown, pixelLabels, colorCentroids: rgbCentroids,
        TW, TH, origW, origH,
        skipClusterReview: false,
        sendEvent: sendEvent as (event: Record<string, unknown>) => void,
        logStep, pushDebugImage, debugImages,
        startTime,
      });

    } else {
      console.log(`  Source map fetch failed: ${mapResponse.status}`);
    }
  } catch (mapErr) {
    const errMsg = mapErr instanceof Error ? mapErr.message : String(mapErr);
    console.error('  Source map border detection failed:', mapErr);
    await logStep(`CV processing error: ${errMsg}`);
  }

  if (!res.destroyed) res.end();
}
