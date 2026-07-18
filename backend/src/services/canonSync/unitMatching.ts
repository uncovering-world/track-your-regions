/**
 * Geometric matching of canon entities to the current unit source
 * (administrative_divisions; GADM today — nothing here depends on its codes).
 *
 * "Country-level units" = children of the tree roots (roots are continents
 * in the current import). Names repeat at this level (Antarctic claim slices
 * are named after claimant countries), so geometry is the primary matcher.
 *
 * Strategy: load NE geometries into a session temp table with a GIST index,
 * then set-based overlap queries. Shares are ST_Area(intersection)/ST_Area(unit).
 */
import { pool } from '../../db/index.js';
import {
  DISPUTE_CHILD_SHARE, DISPUTE_COVERAGE_OK, DISPUTE_ROOT_SHARE, ROOT_MATCH_MIN_SHARE,
  type NeCountryFeature, type NeDisputedFeature, type UnitMatchOverride,
} from './types.js';

export function pickBestMatch(shares: { slug: string; share: number }[]): string | null {
  const best = shares.reduce<{ slug: string; share: number } | null>(
    (acc, s) => (acc === null || s.share > acc.share ? s : acc), null,
  );
  return best && best.share >= ROOT_MATCH_MIN_SHARE ? best.slug : null;
}

export function decideLanding(
  root: { rootId: number; rootShare: number },
  childShares: { id: number; share: number }[],
  coverage: number,
): { divisionIds: number[]; approximate: boolean } {
  if (root.rootShare >= DISPUTE_ROOT_SHARE) {
    return { divisionIds: [root.rootId], approximate: coverage < DISPUTE_COVERAGE_OK };
  }
  const selected = childShares.filter((c) => c.share >= DISPUTE_CHILD_SHARE).map((c) => c.id);
  if (selected.length > 0) return { divisionIds: selected, approximate: coverage < DISPUTE_COVERAGE_OK };
  // Best effort: keep the single most-covered child, marked approximate
  const top = childShares.reduce<{ id: number; share: number } | null>(
    (acc, s) => (acc === null || s.share > acc.share ? s : acc), null,
  );
  return { divisionIds: top ? [top.id] : [], approximate: true };
}

/** Create + fill a temp table of NE country geometries for this connection. */
async function withNeTempTable<T>(
  features: { key: string; geometry: unknown }[],
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    // BEGIN must come first: ON COMMIT DROP outside an explicit transaction
    // would drop the temp table at the implicit commit of CREATE itself.
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE canon_ne_tmp (key TEXT PRIMARY KEY, geom GEOMETRY(Geometry, 4326))
      ON COMMIT DROP`);
    for (const f of features) {
      await client.query(
        `INSERT INTO canon_ne_tmp (key, geom)
         VALUES ($1, ST_SetSRID(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON($2)), 3), 4326))
         ON CONFLICT (key) DO NOTHING`,
        [f.key, JSON.stringify(f.geometry)],
      );
    }
    await client.query('CREATE INDEX ON canon_ne_tmp USING GIST (geom)');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Root units -> canon countries. NE features are keyed by the country slug
 * they resolved to in rules (iso3 match); overrides win over geometry.
 */
export async function matchRootUnits(
  neCountries: NeCountryFeature[],
  countries: { slug: string; iso3: string | null }[],
  overrides: UnitMatchOverride[],
): Promise<{ crosswalk: Map<number, string>; unmatched: { id: number; name: string }[] }> {
  const iso3ToSlug = new Map(countries.filter((c) => c.iso3).map((c) => [c.iso3 as string, c.slug]));
  const keyed = neCountries
    .filter((f) => f.iso3 && iso3ToSlug.has(f.iso3))
    .map((f) => ({ key: iso3ToSlug.get(f.iso3 as string) as string, geometry: f.geometry }));

  const rows = await withNeTempTable(keyed, async (client) => {
    const res = await client.query(`
      SELECT ad.id, ad.name, t.key AS slug,
             ST_Area(ST_Intersection(ad.geom, t.geom)) / NULLIF(ST_Area(ad.geom), 0) AS share
      FROM administrative_divisions ad
      JOIN canon_ne_tmp t ON ad.geom && t.geom
      WHERE ad.parent_id IN (SELECT r.id FROM administrative_divisions r WHERE r.parent_id IS NULL)
        AND ad.geom IS NOT NULL`);
    return res.rows as { id: number; name: string; slug: string; share: number }[];
  });

  const byUnit = new Map<number, { name: string; shares: { slug: string; share: number }[] }>();
  for (const r of rows) {
    const e = byUnit.get(r.id) ?? { name: r.name, shares: [] };
    e.shares.push({ slug: r.slug, share: Number(r.share) || 0 });
    byUnit.set(r.id, e);
  }

  const allCountryUnits = await pool.query(`
    SELECT ad.id, ad.name, r.name AS root_name
    FROM administrative_divisions ad
    JOIN administrative_divisions r ON ad.parent_id = r.id
    WHERE r.parent_id IS NULL`);
  const crosswalk = new Map<number, string>();
  const unmatched: { id: number; name: string }[] = [];
  for (const unit of allCountryUnits.rows as { id: number; name: string; root_name: string }[]) {
    const override = overrides.find((o) =>
      o.divisionName.toLowerCase() === unit.name.toLowerCase()
      && (!o.rootName || o.rootName.toLowerCase() === unit.root_name.toLowerCase()));
    const picked = override?.countrySlug ?? pickBestMatch(byUnit.get(unit.id)?.shares ?? []);
    if (picked) crosswalk.set(unit.id, picked);
    else unmatched.push({ id: unit.id, name: `${unit.root_name} / ${unit.name}` });
  }
  return { crosswalk, unmatched };
}

/**
 * Land one dispute's NE polygon on units: whole root, else child units.
 *
 * Known v1 limitation: the LIMIT 1 below anchors the dispute to a SINGLE
 * country-level unit (ranked by share of that unit's own area), so a dispute
 * straddling two countries' trees (Kashmir across India/Pakistan) lands only
 * in one of them and the rest of its extent surfaces as low coverage →
 * is_approximate. Validate against real NE data during sync calibration
 * before extending to multi-root landing.
 */
export async function landDisputeUnits(
  neFeature: NeDisputedFeature,
): Promise<{ divisionIds: number[]; approximate: boolean }> {
  return withNeTempTable([{ key: 'dispute', geometry: neFeature.geometry }], async (client) => {
    const roots = await client.query(`
      SELECT ad.id,
             ST_Area(ST_Intersection(ad.geom, t.geom)) / NULLIF(ST_Area(ad.geom), 0) AS share,
             ST_Area(ST_Intersection(ad.geom, t.geom)) / NULLIF(ST_Area(t.geom), 0) AS coverage
      FROM administrative_divisions ad, canon_ne_tmp t
      WHERE ad.parent_id IN (SELECT r.id FROM administrative_divisions r WHERE r.parent_id IS NULL)
        AND ad.geom && t.geom
      ORDER BY share DESC LIMIT 1`);
    if (roots.rows.length === 0) return { divisionIds: [], approximate: true };
    const root = roots.rows[0] as { id: number; share: number; coverage: number };

    const children = await client.query(`
      SELECT ad.id,
             ST_Area(ST_Intersection(ad.geom, t.geom)) / NULLIF(ST_Area(ad.geom), 0) AS share
      FROM administrative_divisions ad, canon_ne_tmp t
      WHERE ad.parent_id = $1 AND ad.geom && t.geom`, [root.id]);
    const childShares = (children.rows as { id: number; share: number }[])
      .map((c) => ({ id: c.id, share: Number(c.share) || 0 }));

    const selectedForCoverage = childShares.filter((c) => c.share >= DISPUTE_CHILD_SHARE).map((c) => c.id);
    const coverageIds = Number(root.share) >= DISPUTE_ROOT_SHARE ? [root.id] : selectedForCoverage;
    let coverage = Number(root.coverage) || 0;
    if (coverageIds.length > 0 && Number(root.share) < DISPUTE_ROOT_SHARE) {
      const cov = await client.query(`
        SELECT ST_Area(ST_Intersection(ST_Union(ad.geom), t.geom)) / NULLIF(ST_Area(t.geom), 0) AS coverage
        FROM administrative_divisions ad, canon_ne_tmp t
        WHERE ad.id = ANY($1)`, [coverageIds]);
      coverage = Number((cov.rows[0] as { coverage: number }).coverage) || 0;
    }
    return decideLanding({ rootId: root.id, rootShare: Number(root.share) || 0 }, childShares, coverage);
  });
}
