/**
 * Strict tiling verification for a work unit (import-review redesign).
 *
 * Reference territory resolution: own region_members, else
 * reference_division_ids. Deliberately NO name-match fallback — an
 * unresolvable reference is itself a sign-off blocker
 * (spec: docs/tech/planning/import-review-workflow-redesign.md).
 */
import { pool } from '../../db/index.js';

export interface ReferenceResolution {
  divisionIds: number[];
  source: 'members' | 'reference' | null;
}

export type VerifyBlocker = 'no_reference_territory' | 'unassigned_leaves' | 'coverage_gaps' | 'overlaps';

export interface VerifyResult {
  referenceDivisionIds: number[];
  referenceSource: 'members' | 'reference' | null;
  unassignedLeaves: Array<{ regionId: number; name: string }>;
  coverageGaps: Array<{ divisionId: number; name: string; parentName: string | null }>;
  overlaps: Array<{ divisionId: number; name: string; regionIds: number[] }>;
  blockers: VerifyBlocker[];
  verifiedAt: string;
}

export async function resolveReference(regionId: number): Promise<ReferenceResolution> {
  const members = await pool.query(
    'SELECT division_id FROM region_members WHERE region_id = $1',
    [regionId],
  );
  if (members.rows.length > 0) {
    return { divisionIds: members.rows.map(r => r.division_id as number), source: 'members' };
  }
  const ref = await pool.query(
    'SELECT reference_division_ids FROM region_import_state WHERE region_id = $1',
    [regionId],
  );
  const ids = (ref.rows[0]?.reference_division_ids as number[] | null) ?? [];
  return ids.length > 0 ? { divisionIds: ids, source: 'reference' } : { divisionIds: [], source: null };
}

// Scoped variant of COVERAGE_GAPS_SQL (wvImportCoverageController.ts):
// assigned = strict descendants' members only ($1 = unit region id);
// gap roots = the reference divisions ($2) instead of GADM roots;
// candidates restricted to the reference closure.
const SCOPED_COVERAGE_SQL = `
  WITH RECURSIVE subtree_regions AS (
    SELECT id FROM regions WHERE id = $1
    UNION ALL
    SELECT r.id FROM regions r JOIN subtree_regions s ON r.parent_region_id = s.id
  ),
  assigned AS (
    SELECT DISTINCT rm.division_id AS id
    FROM region_members rm
    WHERE rm.region_id IN (SELECT id FROM subtree_regions)
      AND rm.region_id <> $1
  ),
  reference_closure AS (
    SELECT unnest($2::integer[]) AS id
    UNION ALL
    SELECT child.id
    FROM reference_closure rc
    JOIN administrative_divisions child ON child.parent_id = rc.id
  ),
  ancestors AS (
    SELECT a.id AS current_id FROM assigned a
    UNION ALL
    SELECT ad.parent_id
    FROM ancestors anc
    JOIN administrative_divisions ad ON ad.id = anc.current_id
    WHERE ad.parent_id IS NOT NULL
  ),
  has_coverage_below AS (SELECT DISTINCT current_id AS id FROM ancestors),
  covered_descendants AS (
    SELECT a.id AS current_id FROM assigned a
    UNION ALL
    SELECT child.id
    FROM covered_descendants cd
    JOIN administrative_divisions child ON child.parent_id = cd.current_id
  ),
  fully_covered AS (SELECT DISTINCT current_id AS id FROM covered_descendants)
  SELECT d.id, d.name, p.name AS parent_name
  FROM administrative_divisions d
  LEFT JOIN administrative_divisions p ON p.id = d.parent_id
  WHERE d.id IN (SELECT id FROM reference_closure)
    AND d.id NOT IN (SELECT id FROM fully_covered)
    AND d.id NOT IN (SELECT id FROM has_coverage_below)
    AND (d.id = ANY($2) OR d.parent_id IN (SELECT id FROM has_coverage_below))
  ORDER BY p.name NULLS FIRST, d.name
`;

/**
 * Return the minimal set of highest-level uncovered GADM divisions (gap boundaries)
 * for a region. A boundary is the highest-level division that is entirely uncovered
 * AND whose parent already has partial coverage — so assigning it covers the whole
 * subtree in one step.
 *
 * Shared by verifyWorkUnit (for the ChecksBar chip count) and analyzeCoverageGaps
 * (for the Coverage Gaps panel) so the two endpoints can never drift.
 */
export async function getCoverageBoundaries(
  regionId: number,
  referenceDivisionIds: number[],
): Promise<Array<{ id: number; name: string; parentName: string | null }>> {
  const result = await pool.query(SCOPED_COVERAGE_SQL, [regionId, referenceDivisionIds]);
  return result.rows.map(r => ({
    id: r.id as number,
    name: r.name as string,
    parentName: (r.parent_name as string) ?? null,
  }));
}

// A division overlaps when it (or a GADM ancestor of it) is claimed by two
// different direct-child subtrees. child_of maps every subtree member row to
// the direct child it belongs to.
const OVERLAP_SQL = `
  WITH RECURSIVE child_of AS (
    SELECT r.id AS region_id, r.id AS root_child_id
    FROM regions r WHERE r.parent_region_id = $1
    UNION ALL
    SELECT r.id, c.root_child_id
    FROM regions r JOIN child_of c ON r.parent_region_id = c.region_id
  ),
  claims AS (
    SELECT rm.division_id, c.root_child_id
    FROM region_members rm JOIN child_of c ON c.region_id = rm.region_id
  ),
  expanded AS (
    SELECT cl.division_id AS claimed_id, cl.division_id AS leaf_id, cl.root_child_id
    FROM claims cl
    UNION ALL
    SELECT e.claimed_id, ad.id, e.root_child_id
    FROM expanded e JOIN administrative_divisions ad ON ad.parent_id = e.leaf_id
  )
  SELECT e.leaf_id AS division_id, ad.name,
         array_agg(DISTINCT e.root_child_id) AS root_child_ids
  FROM expanded e
  JOIN administrative_divisions ad ON ad.id = e.leaf_id
  GROUP BY e.leaf_id, ad.name
  HAVING COUNT(DISTINCT e.root_child_id) > 1
  ORDER BY ad.name
`;

/**
 * Run all sign-off checks for a work unit. Blockers: no_reference_territory,
 * unassigned_leaves, coverage_gaps, overlaps. Leaf units (no child regions)
 * skip coverage/overlap — their own assignment IS the coverage; absence is
 * caught by the unassigned-leaf scan.
 */
// worldViewId unused here: the controller's work-unit lookup enforces world-view scope (IDOR guard); kept for endpoint symmetry.
export async function verifyWorkUnit(worldViewId: number, regionId: number): Promise<VerifyResult> {
  const verifiedAt = new Date().toISOString();
  const reference = await resolveReference(regionId);
  const blockers: VerifyBlocker[] = [];

  if (reference.source === null) {
    return {
      referenceDivisionIds: [],
      referenceSource: null,
      unassignedLeaves: [],
      coverageGaps: [],
      overlaps: [],
      blockers: ['no_reference_territory'],
      verifiedAt,
    };
  }

  const childCount = await pool.query(
    'SELECT COUNT(*) AS count FROM regions WHERE parent_region_id = $1',
    [regionId],
  );
  const hasChildren = parseInt(childCount.rows[0].count as string) > 0;

  const leaves = await pool.query(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM regions WHERE id = $1
       UNION ALL
       SELECT r.id FROM regions r JOIN subtree s ON r.parent_region_id = s.id
     )
     SELECT r.id AS region_id, r.name
     FROM regions r
     LEFT JOIN region_import_state ris ON ris.region_id = r.id
     WHERE r.id IN (SELECT id FROM subtree)
       AND r.is_leaf = TRUE
       AND COALESCE(ris.assignment_waived, FALSE) = FALSE
       AND NOT EXISTS (SELECT 1 FROM region_members rm WHERE rm.region_id = r.id)
     ORDER BY r.name`,
    [regionId],
  );
  const unassignedLeaves = leaves.rows.map(r => ({
    regionId: r.region_id as number,
    name: r.name as string,
  }));
  if (unassignedLeaves.length > 0) blockers.push('unassigned_leaves');

  let coverageGaps: VerifyResult['coverageGaps'] = [];
  let overlaps: VerifyResult['overlaps'] = [];
  if (hasChildren) {
    const boundaries = await getCoverageBoundaries(regionId, reference.divisionIds);
    coverageGaps = boundaries.map(b => ({
      divisionId: b.id,
      name: b.name,
      parentName: b.parentName,
    }));
    if (coverageGaps.length > 0) blockers.push('coverage_gaps');

    const overlapRows = await pool.query(OVERLAP_SQL, [regionId]);
    overlaps = overlapRows.rows.map(r => ({
      divisionId: r.division_id as number,
      name: r.name as string,
      regionIds: r.root_child_ids as number[],
    }));
    if (overlaps.length > 0) blockers.push('overlaps');
  }

  return {
    referenceDivisionIds: reference.divisionIds,
    referenceSource: reference.source,
    unassignedLeaves,
    coverageGaps,
    overlaps,
    blockers,
    verifiedAt,
  };
}
