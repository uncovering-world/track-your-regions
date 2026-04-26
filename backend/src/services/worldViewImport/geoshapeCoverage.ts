/**
 * Coverage-based matching: find the minimal covering set of GADM divisions that
 * together cover ~100% of a Wikidata geoshape.
 *
 * Also hosts helpers for computing division-to-union coverage percentages,
 * refining imprecise matches by drilling into children, and the large
 * `geoshapeMatchRegion` orchestrator.
 */

import { pool } from '../../db/index.js';
import { getOrFetchGeoshape } from './geoshapeCache.js';
import { tryBuildCompositeGeoshape } from './geoshapeComposite.js';

// =============================================================================
// Division-to-division coverage helpers
// =============================================================================

/**
 * Compute what fraction of a single GADM division's area is covered
 * by the union of other GADM divisions (the children's matches).
 * Returns a number 0–1, or null if geometries are missing.
 */
export async function computeDivisionCoverage(
  divisionId: number,
  childDivisionIds: number[],
): Promise<number | null> {
  if (childDivisionIds.length === 0) return 0;

  const result = await pool.query(`
    WITH child_union AS (
      SELECT ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ST_Union(ad.geom_simplified_medium)), 3
      )) AS geom
      FROM administrative_divisions ad
      WHERE ad.id = ANY($2) AND ad.geom_simplified_medium IS NOT NULL
    ),
    target AS (
      SELECT ST_ForcePolygonCCW(ad.geom_simplified_medium) AS geom
      FROM administrative_divisions ad
      WHERE ad.id = $1 AND ad.geom_simplified_medium IS NOT NULL
    )
    SELECT
      safe_geo_area(ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ST_Intersection(t.geom, cu.geom)), 3
      ))) /
      NULLIF(safe_geo_area(t.geom), 0) AS coverage
    FROM target t, child_union cu
  `, [divisionId, childDivisionIds]);

  if (result.rows.length === 0) return null;
  const coverage = result.rows[0].coverage as number | null;
  return coverage != null ? Math.round(coverage * 1000) / 1000 : null;
}

/**
 * Compute what fraction of multiple parent divisions is covered by
 * multiple child divisions. Unions both sets, then computes
 * intersection_area / parent_total_area.
 */
export async function computeMultiDivisionCoverage(
  parentDivisionIds: number[],
  childDivisionIds: number[],
): Promise<number | null> {
  if (parentDivisionIds.length === 0 || childDivisionIds.length === 0) return null;

  const result = await pool.query(`
    WITH parent_union AS (
      SELECT ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ST_Union(ad.geom_simplified_medium)), 3
      )) AS geom
      FROM administrative_divisions ad
      WHERE ad.id = ANY($1) AND ad.geom_simplified_medium IS NOT NULL
    ),
    child_union AS (
      SELECT ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ST_Union(ad.geom_simplified_medium)), 3
      )) AS geom
      FROM administrative_divisions ad
      WHERE ad.id = ANY($2) AND ad.geom_simplified_medium IS NOT NULL
    )
    SELECT
      safe_geo_area(ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ST_Intersection(p.geom, c.geom)), 3
      ))) /
      NULLIF(safe_geo_area(p.geom), 0) AS coverage
    FROM parent_union p, child_union c
  `, [parentDivisionIds, childDivisionIds]);

  if (result.rows.length === 0) return null;
  const coverage = result.rows[0].coverage as number | null;
  return coverage != null ? Math.round(coverage * 100000) / 100000 : null;
}

// =============================================================================
// Covering-set types
// =============================================================================

interface CoverageEntry {
  coverage: number;
  intersectionArea: number;
  gadmArea: number;
}

type CandidateInfo = {
  id: number;
  name: string;
  path: string;
  parentId: number | null;
  gadmDepth: number;
  coverage: number;
  intersectionArea: number;
  gadmArea: number;
};

/** Conflict metadata attached to a candidate that is also assigned (or has an ancestor assigned) to another region. */
interface Conflict {
  type: 'direct' | 'split';
  donorRegionId: number;
  donorRegionName: string;
  donorDivisionId: number;
  donorDivisionName: string;
}

/** A single suggestion line returned by `geoshapeMatchRegion`. */
interface GeoshapeSuggestion {
  divisionId: number;
  name: string;
  path: string;
  score: number;
  conflict?: Conflict;
}

interface GeoshapeMatchResult {
  found: number;
  suggestions: GeoshapeSuggestion[];
  totalCoverage?: number;
  scopeAncestorName?: string;
  nextScope?: { ancestorId: number; ancestorName: string };
}

/** Resolve the scope of the search: nearest ancestor with GADM members, plus the next one above it. */
interface ScopeInfo {
  scopeDivisionIds: number[];
  scopeAncestorName?: string;
  nextScope?: { ancestorId: number; ancestorName: string };
}

interface AncestorRow {
  id: number;
  name: string;
  division_ids: number[] | null;
}

// =============================================================================
// Covering-set refinement
// =============================================================================

/** Query the children of a division that intersect the given Wikidata geoshape. */
async function queryIntersectingChildren(
  wikidataId: string,
  parentId: number,
): Promise<Array<{ id: number; name: string; parent_id: number | null; intersection_area: number | null; gadm_area: number | null; path: string }>> {
  const childResult = await pool.query(`
    WITH wiki AS (
      SELECT ST_ForcePolygonCCW(geom) AS geom
      FROM wikidata_geoshapes
      WHERE wikidata_id = $1 AND not_available = FALSE
    )
    SELECT ad.id, ad.name, ad.parent_id,
      safe_geo_area(
        ST_ForcePolygonCCW(ST_CollectionExtract(
          ST_MakeValid(ST_Intersection(w.geom, ad.geom_simplified_medium)), 3
        ))
      ) AS intersection_area,
      safe_geo_area(ad.geom_simplified_medium) AS gadm_area,
      (WITH RECURSIVE div_ancestors AS (
        SELECT ad.id AS aid, ad.name AS aname, ad.parent_id AS apid
        UNION ALL
        SELECT d.id, d.name, d.parent_id
        FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
      )
      SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
    FROM administrative_divisions ad, wiki w
    WHERE ad.parent_id = $2
      AND ad.geom_simplified_medium IS NOT NULL
      AND ST_Intersects(ad.geom_simplified_medium, w.geom)
  `, [wikidataId, parentId]);
  return childResult.rows;
}

/**
 * Build child `CandidateInfo` rows from a raw DB result for a parent entry.
 * Filters out children whose coverage (intersection/wikiArea) is below 1%.
 */
function buildChildCandidates(
  childRows: Array<{ id: number; name: string; parent_id: number | null; intersection_area: number | null; gadm_area: number | null; path: string }>,
  parentEntry: CandidateInfo,
  wikiArea: number,
): CandidateInfo[] {
  const children: CandidateInfo[] = [];
  for (const row of childRows) {
    const childIntersectionArea = row.intersection_area ?? 0;
    const childGadmArea = row.gadm_area ?? 0;
    const childCoverage = wikiArea > 0 ? childIntersectionArea / wikiArea : 0;
    if (childCoverage < 0.01) continue;
    children.push({
      id: row.id,
      name: row.name,
      path: row.path,
      parentId: row.parent_id,
      gadmDepth: parentEntry.gadmDepth + 1,
      coverage: childCoverage,
      intersectionArea: childIntersectionArea,
      gadmArea: childGadmArea,
    });
  }
  return children;
}

/**
 * Decide whether the children's combined intersection adequately replaces the parent.
 * Returns true when the ratio of child-intersection-sum to parent-intersection >= 0.8
 * and at least one child survived the coverage filter.
 */
function shouldReplaceWithChildren(children: CandidateInfo[], parentEntry: CandidateInfo): boolean {
  if (children.length === 0) return false;
  const childIntersectionSum = children.reduce((sum, c) => sum + c.intersectionArea, 0);
  const childCoverageRatio = parentEntry.intersectionArea > 0
    ? childIntersectionSum / parentEntry.intersectionArea
    : 0;
  return childCoverageRatio >= 0.8;
}

/**
 * Refine a single entry from the covering set:
 * returns either the entry unchanged, or its recursively-refined child replacements.
 */
async function refineEntry(
  entry: CandidateInfo,
  wikidataId: string,
  wikiArea: number,
  depth: number,
  maxDepth: number,
): Promise<CandidateInfo[]> {
  const precision = entry.gadmArea > 0 ? entry.intersectionArea / entry.gadmArea : 1;
  if (precision >= 0.5 || depth >= maxDepth) {
    return [entry];
  }

  console.log(
    `[Geoshape Refine] ${entry.name} (id=${entry.id}): precision=${(precision * 100).toFixed(1)}% — drilling down to children`,
  );

  const childRows = await queryIntersectingChildren(wikidataId, entry.id);
  const children = buildChildCandidates(childRows, entry, wikiArea);

  const childIntersectionSum = children.reduce((sum, c) => sum + c.intersectionArea, 0);
  const childCoverageRatio = entry.intersectionArea > 0
    ? childIntersectionSum / entry.intersectionArea
    : 0;

  if (shouldReplaceWithChildren(children, entry)) {
    console.log(
      `[Geoshape Refine] Replacing ${entry.name} with ${children.length} children (childCoverageRatio=${(childCoverageRatio * 100).toFixed(1)}%)`,
    );
    return refineCoveringSet(children, wikidataId, wikiArea, depth + 1, maxDepth);
  }

  console.log(
    `[Geoshape Refine] Keeping ${entry.name} — children insufficient (${children.length} children, childCoverageRatio=${(childCoverageRatio * 100).toFixed(1)}%)`,
  );
  return [entry];
}

/**
 * Refine a covering set by drilling down imprecise divisions.
 *
 * For each division in the covering set, computes precision = intersectionArea / gadmArea.
 * If precision < 0.5 (the geoshape covers less than half the GADM division), replaces
 * that division with its children that intersect the geoshape — recursively up to maxDepth.
 * This handles cases like a Wikivoyage island region matching a whole GADM province.
 */
async function refineCoveringSet(
  coveringSet: CandidateInfo[],
  wikidataId: string,
  wikiArea: number,
  depth: number = 0,
  maxDepth: number = 3,
): Promise<CandidateInfo[]> {
  const result: CandidateInfo[] = [];
  for (const entry of coveringSet) {
    const refined = await refineEntry(entry, wikidataId, wikiArea, depth, maxDepth);
    result.push(...refined);
  }
  return result;
}

// =============================================================================
// Region / ancestor / scope helpers
// =============================================================================

/** Load region import state used as the entry point of the geoshape match. */
async function loadRegionGeoshapeContext(
  worldViewId: number,
  regionId: number,
): Promise<{ wikidataId?: string; sourceUrl?: string; isLeaf?: boolean }> {
  const wdResult = await pool.query(
    `SELECT ris.source_external_id, ris.source_url, r.is_leaf
     FROM region_import_state ris
     JOIN regions r ON r.id = ris.region_id
     WHERE ris.region_id = $1 AND r.world_view_id = $2`,
    [regionId, worldViewId],
  );
  const row = wdResult.rows[0];
  return {
    wikidataId: row?.source_external_id as string | undefined,
    sourceUrl: row?.source_url as string | undefined,
    isLeaf: row?.is_leaf as boolean | undefined,
  };
}

/** Ensure the region's Wikidata geoshape is cached (with composite fallback) and update geo_available. */
async function ensureGeoshapeAvailable(
  wikidataId: string,
  regionId: number,
  sourceUrl: string | undefined,
): Promise<boolean> {
  let available = await getOrFetchGeoshape(wikidataId);
  if (!available) {
    available = await tryBuildCompositeGeoshape(wikidataId, sourceUrl);
  }
  await pool.query(
    'UPDATE region_import_state SET geo_available = $1 WHERE region_id = $2',
    [available, regionId],
  );
  return available;
}

/** Load ancestor chain rows for a region, each with its assigned GADM division IDs. */
async function loadAncestorChain(regionId: number): Promise<AncestorRow[]> {
  const ancestorResult = await pool.query(`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_region_id, 0 AS depth FROM regions WHERE id = $1
      UNION ALL
      SELECT r.id, r.name, r.parent_region_id, a.depth + 1
      FROM regions r JOIN ancestors a ON r.id = a.parent_region_id
    )
    SELECT a.id, a.name,
      (SELECT array_agg(rm.division_id) FROM region_members rm WHERE rm.region_id = a.id) AS division_ids
    FROM ancestors a
    ORDER BY a.depth
  `, [regionId]);
  return ancestorResult.rows as AncestorRow[];
}

/** Decide whether an ancestor row holds GADM division IDs. */
function rowHasDivisions(row: AncestorRow): boolean {
  return row.division_ids != null && row.division_ids.length > 0;
}

/** Filter out the self-row (current region) from the ancestor chain. */
function ancestorsExcludingSelf(ancestors: AncestorRow[], regionId: number): AncestorRow[] {
  return ancestors.filter(a => a.id !== regionId);
}

/** Find the next ancestor with divisions after `startIndex`, for the "broaden scope" UI hint. */
function findNextScopeAfter(
  ancestors: AncestorRow[],
  startIndex: number,
): { ancestorId: number; ancestorName: string } | undefined {
  for (let i = startIndex; i < ancestors.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- loop-counter index into typed AncestorRow[]
    const row = ancestors[i];
    if (rowHasDivisions(row)) {
      return { ancestorId: row.id, ancestorName: row.name };
    }
  }
  return undefined;
}

/** Scope mode: start at the requested ancestor and use its divisions (if it has any). */
function resolveScopeFromRequestedAncestor(
  ancestors: AncestorRow[],
  scopeAncestorId: number,
): ScopeInfo {
  const idx = ancestors.findIndex(a => a.id === scopeAncestorId);
  if (idx < 0) return { scopeDivisionIds: [] };

  // eslint-disable-next-line security/detect-object-injection -- idx is from findIndex on the same typed AncestorRow[]
  const row = ancestors[idx];
  if (!rowHasDivisions(row)) {
    return { scopeDivisionIds: [] };
  }

  return {
    scopeDivisionIds: row.division_ids ?? [],
    scopeAncestorName: row.name,
    nextScope: findNextScopeAfter(ancestors, idx + 1),
  };
}

/** Scope mode: use the nearest ancestor that has GADM divisions assigned. */
function resolveScopeFromNearestAncestor(ancestors: AncestorRow[]): ScopeInfo {
  const idx = ancestors.findIndex(rowHasDivisions);
  if (idx < 0) return { scopeDivisionIds: [] };

  // eslint-disable-next-line security/detect-object-injection -- idx is from findIndex on the same typed AncestorRow[]
  const row = ancestors[idx];
  return {
    scopeDivisionIds: row.division_ids ?? [],
    scopeAncestorName: row.name,
    nextScope: findNextScopeAfter(ancestors, idx + 1),
  };
}

/**
 * Walk the ancestor chain (ordered child→root) and pick the scope + next-scope ancestors.
 *
 * If `scopeAncestorId` is provided, the scope starts at that ancestor; otherwise the scope
 * is the nearest ancestor that has GADM divisions assigned. Either way, `nextScope` is the
 * next ancestor further up the chain that also has divisions (used by the UI to let admins
 * broaden the scope).
 */
function resolveScopeFromAncestors(
  ancestors: AncestorRow[],
  regionId: number,
  scopeAncestorId: number | undefined,
): ScopeInfo {
  const filtered = ancestorsExcludingSelf(ancestors, regionId);
  if (scopeAncestorId != null) {
    return resolveScopeFromRequestedAncestor(filtered, scopeAncestorId);
  }
  return resolveScopeFromNearestAncestor(filtered);
}

// =============================================================================
// Candidate discovery and filtering
// =============================================================================

interface CandidateRow {
  id: number;
  name: string;
  parent_id: number | null;
  gadm_depth: number;
  path: string;
}

/** Find candidate GADM divisions (spatial intersection) — scoped to an ancestor's descendants when available. */
async function queryCandidateDivisions(
  wikidataId: string,
  scopeDivisionIds: number[],
): Promise<CandidateRow[]> {
  if (scopeDivisionIds.length > 0) {
    const result = await pool.query(`
      WITH RECURSIVE scope_descendants AS (
        SELECT id, parent_id, 0 AS gadm_depth FROM administrative_divisions WHERE id = ANY($2)
        UNION ALL
        SELECT ad.id, ad.parent_id, sd.gadm_depth + 1
        FROM administrative_divisions ad
        JOIN scope_descendants sd ON ad.parent_id = sd.id
      ),
      candidates AS (
        SELECT ad.id, ad.name, ad.parent_id, sd.gadm_depth
        FROM administrative_divisions ad
        JOIN scope_descendants sd ON ad.id = sd.id
        WHERE ad.geom_simplified_medium IS NOT NULL
          AND ST_Intersects(
            ad.geom_simplified_medium,
            (SELECT geom FROM wikidata_geoshapes WHERE wikidata_id = $1 AND not_available = FALSE)
          )
      )
      SELECT c.id, c.name, c.parent_id, c.gadm_depth,
        (WITH RECURSIVE div_ancestors AS (
          SELECT c.id AS aid, c.name AS aname, c.parent_id AS apid
          UNION ALL
          SELECT d.id, d.name, d.parent_id
          FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
        )
        SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
      FROM candidates c
    `, [wikidataId, scopeDivisionIds]);
    return result.rows as CandidateRow[];
  }

  const result = await pool.query(`
    WITH candidates AS (
      SELECT ad.id, ad.name, ad.parent_id, 0 AS gadm_depth
      FROM administrative_divisions ad
      WHERE ad.geom_simplified_medium IS NOT NULL
        AND ST_Intersects(
          ad.geom_simplified_medium,
          (SELECT geom FROM wikidata_geoshapes WHERE wikidata_id = $1 AND not_available = FALSE)
        )
      LIMIT 200
    )
    SELECT c.id, c.name, c.parent_id, c.gadm_depth,
      (WITH RECURSIVE div_ancestors AS (
        SELECT c.id AS aid, c.name AS aname, c.parent_id AS apid
        UNION ALL
        SELECT d.id, d.name, d.parent_id
        FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
      )
      SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
    FROM candidates c
  `, [wikidataId]);
  return result.rows as CandidateRow[];
}

/**
 * Build a conflict map for candidates: for each candidate, note the nearest ancestor
 * (including itself) already assigned to another region in this world view.
 */
async function loadConflictMap(
  candidateIds: number[],
  worldViewId: number,
  regionId: number,
): Promise<Map<number, Conflict>> {
  const conflictMap = new Map<number, Conflict>();
  if (candidateIds.length === 0) return conflictMap;

  const conflictResult = await pool.query(`
    WITH RECURSIVE candidate_ancestors AS (
      SELECT ad.id AS candidate_id, ad.id AS ancestor_id, ad.name AS ancestor_name, ad.parent_id, 0 AS depth
      FROM administrative_divisions ad
      WHERE ad.id = ANY($1)
      UNION ALL
      SELECT ca.candidate_id, ad.id, ad.name, ad.parent_id, ca.depth + 1
      FROM administrative_divisions ad
      JOIN candidate_ancestors ca ON ad.id = ca.parent_id
    )
    SELECT DISTINCT ON (ca.candidate_id)
      ca.candidate_id,
      ca.ancestor_id AS donor_division_id,
      ca.ancestor_name AS donor_division_name,
      ca.depth,
      rm.region_id AS donor_region_id,
      r.name AS donor_region_name
    FROM candidate_ancestors ca
    JOIN region_members rm ON rm.division_id = ca.ancestor_id
    JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $2
    WHERE rm.region_id != $3
    ORDER BY ca.candidate_id, ca.depth ASC
  `, [candidateIds, worldViewId, regionId]);

  for (const row of conflictResult.rows) {
    const candidateId = row.candidate_id as number;
    const donorDivisionId = row.donor_division_id as number;
    conflictMap.set(candidateId, {
      type: candidateId === donorDivisionId ? 'direct' : 'split',
      donorRegionId: row.donor_region_id as number,
      donorRegionName: row.donor_region_name as string,
      donorDivisionId,
      donorDivisionName: row.donor_division_name as string,
    });
  }
  return conflictMap;
}

interface ExclusionSets {
  rejectedIds: Set<number>;
  existingIds: Set<number>;
  assignedIds: Set<number>;
}

/**
 * Load the sets used to skip candidates: suggestions already rejected, suggestions already
 * present (un-rejected), and divisions already assigned (plus their GADM descendants).
 */
async function loadExclusionSets(regionId: number): Promise<ExclusionSets> {
  const [rejectedResult, existingResult, assignedResult] = await Promise.all([
    pool.query(
      `SELECT division_id FROM region_match_suggestions WHERE region_id = $1 AND rejected = true`,
      [regionId],
    ),
    pool.query(
      `SELECT division_id FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
      [regionId],
    ),
    pool.query(
      `WITH RECURSIVE assigned_tree AS (
        SELECT division_id AS id FROM region_members WHERE region_id = $1
        UNION ALL
        SELECT ad.id FROM administrative_divisions ad JOIN assigned_tree at ON ad.parent_id = at.id
      )
      SELECT id AS division_id FROM assigned_tree`,
      [regionId],
    ),
  ]);
  return {
    rejectedIds: new Set(rejectedResult.rows.map(r => r.division_id as number)),
    existingIds: new Set(existingResult.rows.map(r => r.division_id as number)),
    assignedIds: new Set(assignedResult.rows.map(r => r.division_id as number)),
  };
}

/**
 * Compute per-candidate coverage (intersection / wiki area) in a single SQL batch.
 * Returns a map keyed by division_id, skipping candidates whose overlap is below 1%.
 */
async function computeCoverageMap(
  wikidataId: string,
  candidateIds: number[],
): Promise<Map<number, CoverageEntry>> {
  const coverageResult = await pool.query(`
    WITH wiki AS (
      SELECT ST_ForcePolygonCCW(geom) AS geom
      FROM wikidata_geoshapes
      WHERE wikidata_id = $1 AND not_available = FALSE
    ),
    wiki_area AS (
      SELECT safe_geo_area(geom) AS area FROM wiki
    )
    SELECT ad.id AS division_id,
      safe_geo_area(
        ST_ForcePolygonCCW(ST_CollectionExtract(
          ST_MakeValid(ST_Intersection(w.geom, ad.geom_simplified_medium)), 3
        ))
      ) / NULLIF(wa.area, 0) AS coverage,
      safe_geo_area(
        ST_ForcePolygonCCW(ST_CollectionExtract(
          ST_MakeValid(ST_Intersection(w.geom, ad.geom_simplified_medium)), 3
        ))
      ) AS intersection_area,
      safe_geo_area(ad.geom_simplified_medium) AS gadm_area
    FROM administrative_divisions ad, wiki w, wiki_area wa
    WHERE ad.id = ANY($2)
      AND ad.geom_simplified_medium IS NOT NULL
  `, [wikidataId, candidateIds]);

  const coverageMap = new Map<number, CoverageEntry>();
  for (const row of coverageResult.rows) {
    const coverage = row.coverage as number | null;
    if (coverage != null && coverage > 0.01) {
      coverageMap.set(row.division_id as number, {
        coverage,
        intersectionArea: (row.intersection_area as number | null) ?? 0,
        gadmArea: (row.gadm_area as number | null) ?? 0,
      });
    }
  }
  return coverageMap;
}

/** Compute the total Wikidata geoshape area (used for refinement precision checks). */
async function computeWikiArea(wikidataId: string): Promise<number> {
  const wikiAreaResult = await pool.query(`
    SELECT safe_geo_area(ST_ForcePolygonCCW(geom)) AS area
    FROM wikidata_geoshapes
    WHERE wikidata_id = $1 AND not_available = FALSE
  `, [wikidataId]);
  return (wikiAreaResult.rows[0]?.area as number) ?? 0;
}

/** Merge candidate rows with their coverage entries into a single info map. */
function buildCandidateInfoMap(
  candidateRows: CandidateRow[],
  coverageMap: Map<number, CoverageEntry>,
): Map<number, CandidateInfo> {
  const out = new Map<number, CandidateInfo>();
  for (const row of candidateRows) {
    const entry = coverageMap.get(row.id);
    if (!entry) continue;
    out.set(row.id, {
      id: row.id,
      name: row.name,
      path: row.path,
      parentId: row.parent_id,
      gadmDepth: row.gadm_depth,
      coverage: entry.coverage,
      intersectionArea: entry.intersectionArea,
      gadmArea: entry.gadmArea,
    });
  }
  return out;
}

/**
 * Check if any ancestor of `candidate` (walking parent_id chain through the candidate info map)
 * is already in the `selectedIds` set.
 */
function hasAncestorSelected(
  candidate: CandidateInfo,
  selectedIds: Set<number>,
  candidateInfoMap: Map<number, CandidateInfo>,
): boolean {
  let walkId: number | null = candidate.parentId;
  while (walkId != null) {
    if (selectedIds.has(walkId)) return true;
    const parent = candidateInfoMap.get(walkId);
    if (!parent) return false;
    walkId = parent.parentId;
  }
  return false;
}

/**
 * Greedy covering-set selection: iterate candidates shallow-first and keep each one
 * whose ancestors are not already selected. Excludes scope roots (already assigned to the ancestor).
 */
function buildCoveringSet(
  candidateInfoMap: Map<number, CandidateInfo>,
  scopeRootIds: Set<number>,
): CandidateInfo[] {
  const sortedCandidates = [...candidateInfoMap.values()]
    .filter(c => !scopeRootIds.has(c.id))
    .sort((a, b) => a.gadmDepth - b.gadmDepth || b.coverage - a.coverage);

  const selectedIds = new Set<number>();
  const coveringSet: CandidateInfo[] = [];
  for (const candidate of sortedCandidates) {
    if (!hasAncestorSelected(candidate, selectedIds, candidateInfoMap)) {
      selectedIds.add(candidate.id);
      coveringSet.push(candidate);
    }
  }
  return coveringSet;
}

/** Compute coverage of the wiki shape by the union of the selected divisions, rounded to 3 decimals. */
async function computeTotalCoverage(
  wikidataId: string,
  selectedDivisionIds: number[],
): Promise<number | undefined> {
  const totalCoverageResult = await pool.query(`
    WITH wiki AS (
      SELECT ST_ForcePolygonCCW(geom) AS geom
      FROM wikidata_geoshapes
      WHERE wikidata_id = $1 AND not_available = FALSE
    ),
    selected_union AS (
      SELECT ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ST_Union(ad.geom_simplified_medium)), 3
      )) AS geom
      FROM administrative_divisions ad
      WHERE ad.id = ANY($2) AND ad.geom_simplified_medium IS NOT NULL
    )
    SELECT
      safe_geo_area(
        ST_ForcePolygonCCW(ST_CollectionExtract(
          ST_MakeValid(ST_Intersection(w.geom, su.geom)), 3
        ))
      ) / NULLIF(safe_geo_area(w.geom), 0) AS total_coverage
    FROM wiki w, selected_union su
  `, [wikidataId, selectedDivisionIds]);

  const totalCoverage = totalCoverageResult.rows[0]?.total_coverage as number | null;
  return totalCoverage != null ? Math.round(totalCoverage * 1000) / 1000 : undefined;
}

/**
 * Persist each covering-set entry as a suggestion with its per-division coverage
 * as `geo_similarity`, and return the plain (non-conflict) suggestion list.
 */
async function writeCoveringSuggestions(
  regionId: number,
  refinedCoveringSet: CandidateInfo[],
  conflictMap: Map<number, Conflict>,
  newStatus: 'suggested' | 'needs_review',
): Promise<GeoshapeSuggestion[]> {
  const suggestions: GeoshapeSuggestion[] = [];

  await pool.query(
    `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
    [newStatus, regionId],
  );

  for (const c of refinedCoveringSet) {
    const score = Math.round(c.coverage * 1000);
    // For covering sets, geo_similarity = per-division coverage of the wiki shape.
    // Using IoU here would be misleading: each division's IoU inflates via the
    // sqrt(rev_coverage) penalty, so 4 divisions at ~25% coverage each would
    // show ~50% IoU each (summing to ~200%), instead of ~25% each (summing to ~100%).
    const geoSimilarity = Math.round(c.coverage * 1000) / 1000;

    suggestions.push({ divisionId: c.id, name: c.name, path: c.path, score });

    const conflict = conflictMap.get(c.id);
    await pool.query(
      `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, geo_similarity, conflict_type, donor_region_id, donor_division_id, donor_region_name, donor_division_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [regionId, c.id, c.name, c.path, score, geoSimilarity, conflict?.type ?? null, conflict?.donorRegionId ?? null, conflict?.donorDivisionId ?? null, conflict?.donorRegionName ?? null, conflict?.donorDivisionName ?? null],
    );
  }

  return suggestions;
}

/** Format a human-readable coverage pct (e.g. "42.5%") from a rounded coverage value. */
function formatCoverage(rounded: number | undefined): string {
  if (rounded == null) return '?%';
  return `${(rounded * 100).toFixed(1)}%`;
}

/** Summarize the covering set for debug logging. */
function formatCoveringSetLog(suggestions: GeoshapeSuggestion[]): string {
  return suggestions.map(s => `${s.name} (${(s.score / 10).toFixed(1)}%)`).join(', ');
}

/**
 * Match a region by comparing its Wikidata geoshape against GADM divisions.
 *
 * Finds a minimal covering set of the highest-level GADM divisions that together
 * cover ~100% of the source geoshape. Prefers shallowest divisions in the GADM
 * hierarchy — if a province covers part of the shape, its districts are not listed.
 *
 * Strategy:
 * 1. Fetch/cache the region's Wikidata geoshape
 * 2. Scope search: walk up the region tree to find nearest ancestor with assigned
 *    GADM divisions, then get all GADM descendants
 * 3. Find candidate GADM divisions via ST_Intersects, with GADM depth
 * 4. Compute coverage (intersection_area / wiki_area) for each candidate in batch
 * 5. Build covering set: shallowest first, skip children of already-selected divisions
 * 6. Return covering set as suggestions with total coverage
 */
export async function geoshapeMatchRegion(
  worldViewId: number,
  regionId: number,
  scopeAncestorId?: number,
): Promise<GeoshapeMatchResult> {
  // 1. Load region context
  const { wikidataId, sourceUrl, isLeaf } = await loadRegionGeoshapeContext(worldViewId, regionId);
  if (!wikidataId) return { found: 0, suggestions: [] };

  // 2. Ensure geoshape is cached; bail if unavailable
  const available = await ensureGeoshapeAvailable(wikidataId, regionId, sourceUrl);
  if (!available) return { found: 0, suggestions: [] };

  // 3. Resolve scope from ancestor chain
  const ancestors = await loadAncestorChain(regionId);
  const { scopeDivisionIds, scopeAncestorName, nextScope } = resolveScopeFromAncestors(
    ancestors,
    regionId,
    scopeAncestorId,
  );
  const scopeRootIds = new Set(scopeDivisionIds);

  // 4. Find candidate GADM divisions + conflict map
  const candidateRows = await queryCandidateDivisions(wikidataId, scopeDivisionIds);
  const conflictMap = scopeAncestorId != null && candidateRows.length > 0
    ? await loadConflictMap(candidateRows.map(r => r.id), worldViewId, regionId)
    : new Map<number, Conflict>();

  if (candidateRows.length === 0) {
    console.log(`[Geoshape Match] No spatial candidates for region ${regionId} (${wikidataId}) in scope ${scopeAncestorName ?? 'global'}`);
    return { found: 0, suggestions: [], scopeAncestorName, nextScope };
  }
  console.log(`[Geoshape Match] Found ${candidateRows.length} spatial candidates for region ${regionId} (${wikidataId})`);

  // 5. Filter candidates against exclusion sets
  const { rejectedIds, existingIds, assignedIds } = await loadExclusionSets(regionId);
  const filteredCandidateIds = candidateRows
    .map(r => r.id)
    .filter(id => !rejectedIds.has(id) && !existingIds.has(id) && !assignedIds.has(id));
  if (filteredCandidateIds.length === 0) {
    console.log(`[Geoshape Match] All candidates already handled for region ${regionId}`);
    return { found: 0, suggestions: [] };
  }

  // 6. Compute per-candidate coverage + wiki area
  const coverageMap = await computeCoverageMap(wikidataId, filteredCandidateIds);
  if (coverageMap.size === 0) {
    console.log(`[Geoshape Match] No candidates with significant coverage for region ${regionId}`);
    return { found: 0, suggestions: [] };
  }
  const wikiArea = await computeWikiArea(wikidataId);

  // 7. Build and refine covering set
  const candidateInfoMap = buildCandidateInfoMap(candidateRows, coverageMap);
  const coveringSet = buildCoveringSet(candidateInfoMap, scopeRootIds);
  if (coveringSet.length === 0) {
    console.log(`[Geoshape Match] No covering set candidates for region ${regionId}`);
    return { found: 0, suggestions: [] };
  }
  const refinedCoveringSet = await refineCoveringSet(coveringSet, wikidataId, wikiArea);
  if (refinedCoveringSet.length === 0) {
    console.log(`[Geoshape Match] No refined covering set candidates for region ${regionId}`);
    return { found: 0, suggestions: [] };
  }

  // 8. Compute total coverage and write suggestions
  const roundedTotalCoverage = await computeTotalCoverage(wikidataId, refinedCoveringSet.map(c => c.id));
  const newStatus = isLeaf ? 'needs_review' : 'suggested';
  const suggestions = await writeCoveringSuggestions(regionId, refinedCoveringSet, conflictMap, newStatus);

  suggestions.sort((a, b) => b.score - a.score);
  const coverageLabel = formatCoverage(roundedTotalCoverage);
  console.log(
    `[Geoshape Match] Covering set for region ${regionId}: ${formatCoveringSetLog(suggestions)} — total coverage: ${coverageLabel}`,
  );

  const suggestionsWithConflict = suggestions.map(s => ({
    ...s,
    conflict: conflictMap.get(s.divisionId),
  }));

  return {
    found: suggestionsWithConflict.length,
    suggestions: suggestionsWithConflict,
    totalCoverage: roundedTotalCoverage,
    scopeAncestorName,
    nextScope,
  };
}
