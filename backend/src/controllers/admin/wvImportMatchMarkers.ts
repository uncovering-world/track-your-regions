/**
 * The markers a region's Wikivoyage article carries, and which of the
 * candidate divisions hold one: the vision match shows them beside the
 * numbered map (`wvImportMatchGeometryController.ts`).
 */

import { pool } from '../../db/index.js';
import { parseMarkers, parseGeoTag } from '../../services/wikivoyageExtract/markerParser.js';
import { resolveMarkerCoordinates } from '../../services/worldViewImport/pointMatcher.js';
import { userAgent } from '../../config/userAgent.js';

/** A named point from the article, in WGS84. */
export type PointInfo = { name: string; lat: number; lon: number };

/**
 * Fetch Wikivoyage markers for a region, check which divisions contain them.
 * Returns the points and the set of division IDs that contain at least one point.
 */
export async function fetchMarkersForDivisions(
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
      headers: { 'User-Agent': userAgent() },
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
          AND ST_DWithin(ad.geom_simplified_medium::geography, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography, 5000)
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
