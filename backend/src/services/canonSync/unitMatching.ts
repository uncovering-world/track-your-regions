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
    // Several NE features can key to the same country slug (e.g. NE assigns
    // ISO_A3_EH=AUS to Australia, Indian Ocean Territories, Coral Sea
    // Islands and Ashmore and Cartier Islands alike): merge their geometry
    // on conflict instead of dropping every feature after the first.
    for (const f of features) {
      // The CASE guards against degenerate NE polygons that ST_MakeValid
      // "un-crosses" into a world-spanning band (observed: the Rockall islet
      // inverting to cover half the planet and landing on Russia's Far
      // East). No legitimate feature approaches 20000 deg² (largest real
      // units are ~1800), so anything bigger is inverted — take its
      // complement within the world envelope instead.
      await client.query(
        `INSERT INTO canon_ne_tmp (key, geom)
         SELECT $1, CASE WHEN ST_Area(g.geom) > 20000
             THEN ST_CollectionExtract(ST_Difference(ST_MakeEnvelope(-180, -90, 180, 90, 4326), g.geom), 3)
             ELSE g.geom END
         FROM (SELECT ST_SetSRID(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON($2)), 3), 4326) AS geom) g
         ON CONFLICT (key) DO UPDATE
         SET geom = ST_CollectionExtract(ST_Collect(canon_ne_tmp.geom, EXCLUDED.geom), 3)`,
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
/** Max levels to descend below the country-level unit when landing. */
const DISPUTE_MAX_DESCENT = 4;
/**
 * Best-effort landings only count when the dispute covers at least this
 * share of the unit it lands on. Below it, a dust-sized feature (Rockall,
 * Hans Island) would "land" on a unit thousands of times its size — an
 * honest zero-unit dispute is better than hatching half a country.
 */
const DISPUTE_MIN_LANDING_SHARE = 0.01;

async function queryChildShares(
  client: import('pg').PoolClient, parentId: number,
): Promise<{ id: number; share: number; hasChildren: boolean }[]> {
  const res = await client.query(`
    SELECT ad.id, ad.has_children,
           ST_Area(ST_Intersection(ad.geom, t.geom)) / NULLIF(ST_Area(ad.geom), 0) AS share
    FROM administrative_divisions ad, canon_ne_tmp t
    WHERE ad.parent_id = $1 AND ad.geom && t.geom`, [parentId]);
  return (res.rows as { id: number; has_children: boolean; share: number }[])
    .map((c) => ({ id: c.id, share: Number(c.share) || 0, hasChildren: c.has_children }));
}

async function queryCoverage(
  client: import('pg').PoolClient, ids: number[],
): Promise<number> {
  // ST_Union(ad.geom) here is the single-argument AGGREGATE form; mixing
  // it with the bare t.geom column with no GROUP BY is a PostgreSQL
  // 42803 error (t.geom appears outside an aggregate/GROUP BY). Pre-
  // aggregate in a subquery instead — canon_ne_tmp always has exactly
  // one row for this call, so the cross join stays a single pairing.
  const cov = await client.query(`
    SELECT ST_Area(ST_Intersection(u.geom, t.geom)) / NULLIF(ST_Area(t.geom), 0) AS coverage
    FROM (SELECT ST_Union(geom) AS geom FROM administrative_divisions WHERE id = ANY($1)) u, canon_ne_tmp t`,
    [ids]);
  return Number((cov.rows[0] as { coverage: number }).coverage) || 0;
}

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
    if (Number(root.share) >= DISPUTE_ROOT_SHARE) {
      return decideLanding({ rootId: root.id, rootShare: Number(root.share) || 0 }, [], Number(root.coverage) || 0);
    }

    // Recursive descent: a small dispute inside a huge unit clears no child
    // at the first level (Kurils vs a whole federal district — best-effort
    // would hatch the entire district). Follow the most-covered child down
    // while it has children of its own, until some level yields real
    // selections or the tree bottoms out.
    let parentId = root.id;
    let parentShare = Number(root.share) || 0;
    const bestEffort = (id: number, share: number): { divisionIds: number[]; approximate: boolean } =>
      (share >= DISPUTE_MIN_LANDING_SHARE ? { divisionIds: [id], approximate: true } : { divisionIds: [], approximate: true });
    for (let depth = 0; depth < DISPUTE_MAX_DESCENT; depth++) {
      const childShares = await queryChildShares(client, parentId);
      if (childShares.length === 0) break;
      const selected = childShares.filter((c) => c.share >= DISPUTE_CHILD_SHARE);
      if (selected.length > 0) {
        const ids = selected.map((c) => c.id);
        return decideLanding(
          { rootId: parentId, rootShare: 0 }, childShares, await queryCoverage(client, ids));
      }
      const top = childShares.reduce((acc, s) => (s.share > acc.share ? s : acc), childShares[0]);
      if (!top.hasChildren || depth === DISPUTE_MAX_DESCENT - 1) {
        return bestEffort(top.id, top.share);
      }
      parentId = top.id;
      parentShare = top.share;
    }
    return bestEffort(parentId, parentShare);
  });
}
