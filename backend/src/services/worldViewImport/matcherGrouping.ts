/**
 * WorldView Import Matcher — Sub-Continental Grouping
 *
 * Handles the "Handle as Grouping" action: clears a region's own match,
 * marks it as `children_matched`, and runs country-level matching on its children.
 */

import { pool } from '../../db/index.js';
import type { MatchSuggestion, MatchStatus } from './types.js';
import { computeGeoSimilarityForRegion } from './geoshapeCache.js';
import {
  normalizeName,
  cleanWvName,
  getNameVariants,
  getPath,
  findBestAmongChildren,
  loadGADMData,
  type DivisionEntry,
} from './matcherUtils.js';

interface GroupingUpdate {
  id: number;
  matchStatus: MatchStatus;
  suggestions: MatchSuggestion[];
  divisionId?: number;
}

type Gadm = Awaited<ReturnType<typeof loadGADMData>>;

// ─── Scope preparation ────────────────────────────────────────────────────────

/**
 * Collect the parent's own divisions + all their descendants via BFS.
 * Returns the scope definitions (entries + a normalized-name lookup).
 */
function buildScope(
  gadm: Gadm,
  scopeDivisionIds: number[],
): { divisions: DivisionEntry[]; byName: Map<string, DivisionEntry[]> } {
  if (scopeDivisionIds.length === 0) {
    return { divisions: [], byName: new Map() };
  }

  const poolIds = new Set<number>(scopeDivisionIds);
  const queue = [...scopeDivisionIds];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const childIds = gadm.childrenOf.get(parentId);
    if (!childIds) continue;
    for (const cid of childIds) {
      if (!poolIds.has(cid)) {
        poolIds.add(cid);
        queue.push(cid);
      }
    }
  }

  const divisions = [...poolIds]
    .map(id => gadm.divisionsById.get(id))
    .filter((e): e is DivisionEntry => !!e);

  const byName = new Map<string, DivisionEntry[]>();
  for (const entry of divisions) {
    const key = normalizeName(entry.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(entry);
  }

  return { divisions, byName };
}

// ─── Scoped matching (matching against descendants of parent's divisions) ────

/** Try exact variants against the scoped name index; return first unique match. */
function findScopedVariantMatch(
  variants: readonly string[],
  scopedByName: Map<string, DivisionEntry[]>,
): { entry: DivisionEntry; score: number } | null {
  for (const variant of variants) {
    const entries = scopedByName.get(variant);
    if (entries && entries.length === 1) {
      return { entry: entries[0], score: 700 };
    }
  }
  return null;
}

/** Find the best scoped match using variant + fuzzy fallback. */
function findBestScopedMatch(
  childName: string,
  variants: readonly string[],
  scopedByName: Map<string, DivisionEntry[]>,
  scopedDivisions: DivisionEntry[],
): { entry: DivisionEntry; score: number } | null {
  const variantMatch = findScopedVariantMatch(variants, scopedByName);
  if (variantMatch) return variantMatch;

  const best = findBestAmongChildren(childName, scopedDivisions);
  if (best && best.score >= 500) return best;
  return null;
}

/** Load WV grandchildren for drill-down (name only). */
async function loadGrandchildren(childId: number): Promise<Array<{ id: number; name: string }>> {
  const gcResult = await pool.query(
    `SELECT id, name FROM regions WHERE parent_region_id = $1 ORDER BY name`,
    [childId],
  );
  return gcResult.rows.map(r => ({ id: r.id as number, name: r.name as string }));
}

/**
 * Try to match all WV grandchildren of `childId` against the given GADM
 * subdivisions. Returns a full-match map if every grandchild matched at
 * score >= 700, otherwise null.
 */
async function tryGrandchildrenDrillDown(
  childId: number,
  gadmChildIds: number[],
  gadm: Gadm,
): Promise<{
  grandchildren: Array<{ id: number; name: string }>;
  matches: Map<number, { gadmEntry: DivisionEntry; score: number }>;
} | null> {
  const gcs = await loadGrandchildren(childId);
  const gadmChildren = gadmChildIds.map(id => gadm.divisionsById.get(id)!).filter(Boolean);
  const matches = new Map<number, { gadmEntry: DivisionEntry; score: number }>();
  for (const gc of gcs) {
    const best = findBestAmongChildren(gc.name, gadmChildren);
    if (best && best.score >= 700) {
      matches.set(gc.id, { gadmEntry: best.entry, score: best.score });
    }
  }
  if (matches.size === gcs.length) {
    return { grandchildren: gcs, matches };
  }
  return null;
}

/** Emit updates marking parent as children_matched + all grandchildren auto_matched. */
function pushFullGrandchildrenUpdates(
  parentId: number,
  grandchildren: Array<{ id: number; name: string }>,
  matches: Map<number, { gadmEntry: DivisionEntry; score: number }>,
  gadm: Gadm,
  updates: GroupingUpdate[],
): void {
  updates.push({ id: parentId, matchStatus: 'children_matched', suggestions: [] });
  for (const gc of grandchildren) {
    const m = matches.get(gc.id)!;
    const path = getPath(m.gadmEntry.id, gadm.pathCache, gadm.divisionsById);
    updates.push({
      id: gc.id,
      matchStatus: 'auto_matched',
      suggestions: [{ divisionId: m.gadmEntry.id, name: m.gadmEntry.name, path, score: m.score }],
      divisionId: m.gadmEntry.id,
    });
  }
}

/** Emit a direct-assignment update for a single entry match. */
function pushDirectAssignment(
  childId: number,
  entry: DivisionEntry,
  score: number,
  gadm: Gadm,
  updates: GroupingUpdate[],
): boolean {
  const path = getPath(entry.id, gadm.pathCache, gadm.divisionsById);
  updates.push({
    id: childId,
    matchStatus: score >= 700 ? 'auto_matched' : 'needs_review',
    suggestions: [{ divisionId: entry.id, name: entry.name, path, score }],
    divisionId: score >= 700 ? entry.id : undefined,
  });
  return score >= 700;
}

/**
 * Handle a scoped child that has WV grandchildren: try drill-down first, fall
 * back to direct assignment. Returns whether the match counted as auto.
 */
async function handleScopedChildWithGrandchildren(
  childId: number,
  match: { entry: DivisionEntry; score: number },
  gadm: Gadm,
  updates: GroupingUpdate[],
): Promise<boolean> {
  const gadmChildIds = gadm.childrenOf.get(match.entry.id);
  if (!gadmChildIds || gadmChildIds.length === 0) {
    return pushDirectAssignment(childId, match.entry, match.score, gadm, updates);
  }

  const drillResult = await tryGrandchildrenDrillDown(childId, gadmChildIds, gadm);
  if (drillResult) {
    pushFullGrandchildrenUpdates(childId, drillResult.grandchildren, drillResult.matches, gadm, updates);
    return true;
  }

  return pushDirectAssignment(childId, match.entry, match.score, gadm, updates);
}

/** Trigram fallback within the scoped division set. */
async function scopedTrigramFallback(
  childName: string,
  scopedDivisions: DivisionEntry[],
  gadm: Gadm,
): Promise<MatchSuggestion[]> {
  const normalized = normalizeName(cleanWvName(childName));
  const scopeIds = scopedDivisions.map(d => d.id);
  const trigramResult = await pool.query(`
    SELECT id, name, similarity(name_normalized, $1) AS sim
    FROM administrative_divisions
    WHERE id = ANY($2)
      AND name_normalized % $1
      AND similarity(name_normalized, $1) > 0.3
    ORDER BY sim DESC
    LIMIT 5
  `, [normalized, scopeIds]);

  return trigramResult.rows.map(r => ({
    divisionId: r.id as number,
    name: r.name as string,
    path: getPath(r.id as number, gadm.pathCache, gadm.divisionsById),
    score: Math.round((r.sim as number) * 1000),
  }));
}

/** Emit updates for the scoped trigram-fallback result. Returns whether it counts as auto. */
function pushFallbackOrNone(
  childId: number,
  fallbackSuggestions: MatchSuggestion[],
  updates: GroupingUpdate[],
): boolean {
  if (fallbackSuggestions.length === 1 && fallbackSuggestions[0].score >= 700) {
    updates.push({
      id: childId,
      matchStatus: 'auto_matched',
      suggestions: fallbackSuggestions,
      divisionId: fallbackSuggestions[0].divisionId,
    });
    return true;
  }
  if (fallbackSuggestions.length > 0) {
    updates.push({ id: childId, matchStatus: 'needs_review', suggestions: fallbackSuggestions });
  } else {
    updates.push({ id: childId, matchStatus: 'no_candidates', suggestions: [] });
  }
  return false;
}

/** Process one scoped child (scope divisions defined). Returns whether it was auto-matched. */
async function processScopedChild(
  child: { id: number; name: string; hasChildren: boolean },
  scopedDivisions: DivisionEntry[],
  scopedByName: Map<string, DivisionEntry[]>,
  gadm: Gadm,
  updates: GroupingUpdate[],
): Promise<boolean> {
  const cleaned = cleanWvName(child.name);
  const variants = getNameVariants(cleaned);

  const bestMatch = findBestScopedMatch(child.name, variants, scopedByName, scopedDivisions);

  if (bestMatch) {
    if (!child.hasChildren) {
      return pushDirectAssignment(child.id, bestMatch.entry, bestMatch.score, gadm, updates);
    }
    return handleScopedChildWithGrandchildren(child.id, bestMatch, gadm, updates);
  }

  const fallback = await scopedTrigramFallback(child.name, scopedDivisions, gadm);
  return pushFallbackOrNone(child.id, fallback, updates);
}

// ─── Unscoped matching (fall back to all GADM countries) ─────────────────────

/** Find GADM country IDs for a WV name using exact variants. */
function findCountryIdsForName(variants: readonly string[], gadm: Gadm): number[] {
  for (const variant of variants) {
    const ids = gadm.gadmCountries.get(variant);
    if (ids && ids.length > 0) return ids;
  }
  return [];
}

/** Emit an auto_matched update at the country level for a WV child. */
function pushCountryLevelMatch(
  childId: number,
  countryId: number,
  gadm: Gadm,
  updates: GroupingUpdate[],
): void {
  const path = getPath(countryId, gadm.pathCache, gadm.divisionsById);
  const entry = gadm.divisionsById.get(countryId)!;
  updates.push({
    id: childId,
    matchStatus: 'auto_matched',
    suggestions: [{ divisionId: countryId, name: entry.name, path, score: 700 }],
    divisionId: countryId,
  });
}

/**
 * Handle a unique-country match, with optional drill-down when the WV child
 * has grandchildren. Always counts as an auto-match (returns nothing).
 */
async function handleSingleUnscopedCountry(
  child: { id: number; name: string; hasChildren: boolean },
  countryId: number,
  gadm: Gadm,
  updates: GroupingUpdate[],
): Promise<void> {
  if (!child.hasChildren) {
    pushCountryLevelMatch(child.id, countryId, gadm, updates);
    return;
  }

  const gadmChildIds = gadm.childrenOf.get(countryId);
  if (!gadmChildIds || gadmChildIds.length === 0) {
    pushCountryLevelMatch(child.id, countryId, gadm, updates);
    return;
  }

  const drillResult = await tryGrandchildrenDrillDown(child.id, gadmChildIds, gadm);
  if (drillResult) {
    pushFullGrandchildrenUpdates(child.id, drillResult.grandchildren, drillResult.matches, gadm, updates);
    return;
  }

  pushCountryLevelMatch(child.id, countryId, gadm, updates);
}

/** Collect exact-name-variant matches against ALL divisions, appending in-place. */
function collectExactVariantFallbackInto(
  variants: readonly string[],
  gadm: Gadm,
  seen: Set<number>,
  out: MatchSuggestion[],
): void {
  for (const variant of variants) {
    const matches = gadm.divisionsByNormalizedName.get(variant);
    if (!matches) continue;
    for (const entry of matches) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const path = getPath(entry.id, gadm.pathCache, gadm.divisionsById);
      out.push({ divisionId: entry.id, name: entry.name, path, score: 700 });
    }
  }
}

/** Trigram similarity search against ALL divisions, appending in-place. */
async function collectTrigramFallbackInto(
  childName: string,
  gadm: Gadm,
  seen: Set<number>,
  out: MatchSuggestion[],
): Promise<void> {
  const normalized = normalizeName(cleanWvName(childName));
  const trigramResult = await pool.query(`
    SELECT id, name, similarity(name_normalized, $1) AS sim
    FROM administrative_divisions
    WHERE name_normalized % $1
      AND similarity(name_normalized, $1) > 0.3
    ORDER BY sim DESC
    LIMIT 5
  `, [normalized]);
  for (const r of trigramResult.rows) {
    const id = r.id as number;
    if (seen.has(id)) continue;
    seen.add(id);
    const path = getPath(id, gadm.pathCache, gadm.divisionsById);
    out.push({ divisionId: id, name: r.name as string, path, score: Math.round((r.sim as number) * 1000) });
  }
}

/** Exact-variant + trigram fallback against ALL divisions. */
async function unscopedFullFallback(
  childName: string,
  variants: readonly string[],
  gadm: Gadm,
): Promise<MatchSuggestion[]> {
  const seen = new Set<number>();
  const fallbackSuggestions: MatchSuggestion[] = [];

  collectExactVariantFallbackInto(variants, gadm, seen, fallbackSuggestions);

  if (fallbackSuggestions.length > 1) {
    for (const s of fallbackSuggestions) s.score = 500;
  }

  if (fallbackSuggestions.length === 0) {
    await collectTrigramFallbackInto(childName, gadm, seen, fallbackSuggestions);
  }

  return fallbackSuggestions.slice(0, 5);
}

/** Process one unscoped child (no parent-scope divisions). Returns whether it was auto-matched. */
async function processUnscopedChild(
  child: { id: number; name: string; hasChildren: boolean },
  gadm: Gadm,
  updates: GroupingUpdate[],
): Promise<boolean> {
  const cleaned = cleanWvName(child.name);
  const variants = getNameVariants(cleaned);

  const countryMatchIds = findCountryIdsForName(variants, gadm);

  if (countryMatchIds.length === 1) {
    await handleSingleUnscopedCountry(child, countryMatchIds[0], gadm, updates);
    return true;
  }

  if (countryMatchIds.length > 1) {
    const suggestions: MatchSuggestion[] = countryMatchIds.map(id => {
      const entry = gadm.divisionsById.get(id)!;
      const path = getPath(id, gadm.pathCache, gadm.divisionsById);
      return { divisionId: id, name: entry.name, path, score: 700 };
    });
    updates.push({ id: child.id, matchStatus: 'needs_review', suggestions });
    return false;
  }

  // No country match — try fallback against all divisions
  const fallback = await unscopedFullFallback(child.name, variants, gadm);
  return pushFallbackOrNone(child.id, fallback, updates);
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/** Write grouping updates in a single transaction (parent + children). */
async function writeGroupingUpdates(
  regionId: number,
  updates: GroupingUpdate[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE region_import_state SET match_status = 'children_matched' WHERE region_id = $1`,
      [regionId],
    );

    for (const update of updates) {
      await client.query(
        `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
        [update.matchStatus, update.id],
      );

      await client.query(
        `DELETE FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
        [update.id],
      );
      for (const suggestion of update.suggestions) {
        await client.query(
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score)
           VALUES ($1, $2, $3, $4, $5)`,
          [update.id, suggestion.divisionId, suggestion.name, suggestion.path, suggestion.score],
        );
      }

      if (update.divisionId) {
        await client.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [update.id, update.divisionId],
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Run geo-similarity refinement on multi-candidate updates. */
async function runGroupingGeoComparison(updates: GroupingUpdate[]): Promise<void> {
  const geoUpdates = updates.filter(u =>
    u.suggestions.length > 1 && (u.matchStatus === 'needs_review' || u.matchStatus === 'suggested'),
  );
  if (geoUpdates.length === 0) return;

  const geoClient = await pool.connect();
  try {
    for (const update of geoUpdates) {
      try {
        await computeGeoSimilarityForRegion(geoClient, update.id, update.suggestions);
      } catch (err) {
        console.warn(`[WV Matcher] Geo similarity failed for region ${update.id}:`, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    geoClient.release();
  }
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Treat a matched region as a sub-continental grouping: mark it as `children_matched`
 * and run matching on its children.
 *
 * When `scopeDivisionIds` is provided, matches children against the GADM children
 * (and deeper descendants) of those divisions. When empty, falls back to matching
 * against all GADM countries. Parent's own division assignments are preserved.
 */
export async function matchChildrenAsCountries(
  worldViewId: number,
  regionId: number,
  scopeDivisionIds: number[] = [],
): Promise<{ matched: number; total: number }> {
  const gadm = await loadGADMData();

  const childResult = await pool.query(`
    SELECT id, name,
      (SELECT COUNT(*) FROM regions sub WHERE sub.parent_region_id = r.id) > 0 AS has_children
    FROM regions r
    WHERE r.parent_region_id = $1 AND r.world_view_id = $2
    ORDER BY r.name
  `, [regionId, worldViewId]);

  if (childResult.rows.length === 0) {
    throw new Error('Region has no children to match');
  }

  const scope = buildScope(gadm, scopeDivisionIds);
  const useScoped = scope.divisions.length > 0;
  if (useScoped) {
    console.log(`[WV Matcher] Scoped matching: ${scope.divisions.length} divisions (${scopeDivisionIds.length} parent + descendants)`);
  }

  const updates: GroupingUpdate[] = [];
  let matched = 0;

  for (const row of childResult.rows) {
    const child = {
      id: row.id as number,
      name: row.name as string,
      hasChildren: row.has_children as boolean,
    };

    const wasAutoMatched = useScoped
      ? await processScopedChild(child, scope.divisions, scope.byName, gadm, updates)
      : await processUnscopedChild(child, gadm, updates);

    if (wasAutoMatched) matched++;
  }

  await writeGroupingUpdates(regionId, updates);
  await runGroupingGeoComparison(updates);

  console.log(`[WV Matcher] matchChildrenAsCountries: region ${regionId} — ${matched}/${childResult.rows.length} children matched`);
  return { matched, total: childResult.rows.length };
}
