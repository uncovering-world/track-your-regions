/**
 * Country-based matching policy
 *
 * Walks the import tree looking for nodes whose name matches a GADM country,
 * then tries to push each matched country down to its subdivision level. This
 * is the default policy and the one Wikivoyage imports use: a Wikivoyage region
 * may be a *group* of divisions ("Benelux", "Southern Germany"), so the walk
 * anchors on country names found anywhere in the tree rather than descending
 * level by level.
 *
 * `matcherHierarchicalPolicy.ts` holds the alternative for sources whose tree
 * mirrors the division hierarchy one-to-one. Shared name and GADM machinery
 * lives in `matcherUtils.ts` — this file holds only the policy.
 */

import { pool } from '../../db/index.js';
import type { ImportProgress, MatchSuggestion, MatchUpdate } from './types.js';
import {
  cleanWvName,
  findBestAmongChildren,
  getNameVariants,
  getPath,
  loadGADMData,
  type DivisionEntry,
  type GADMData,
} from './matcherUtils.js';

// ─── Country-level matcher (NEW) ─────────────────────────────────────────────

/** In-memory import tree node (built from DB) */
interface WvTreeNode {
  id: number;
  name: string;
  children: WvTreeNode[];
}

/**
 * Match import regions at the country level with optional subdivision drill-down.
 *
 * Algorithm:
 * 1. Walk the WV tree to find nodes that match GADM country names
 * 2. For matched countries with children: try matching ALL children to GADM subdivisions
 * 3. If ALL match → assign at subdivision level (mark country as 'children_matched')
 * 4. If NOT all → assign at country level only
 */
export async function matchCountryLevel(
  worldViewId: number,
  progress: ImportProgress,
): Promise<void> {
  progress.status = 'matching';
  const startTime = Date.now();

  // Phase 1: Load GADM data
  progress.statusMessage = 'Loading GADM divisions into memory...';
  console.log('[WV Matcher] Loading all divisions into memory...');
  const gadm = await loadGADMData();
  console.log(`[WV Matcher] Loaded ${gadm.divisionsById.size} divisions, ${gadm.countryIds.size} countries`);

  // Phase 2: Load WV region tree from DB
  progress.statusMessage = 'Loading import regions...';
  const regionResult = await pool.query(`
    SELECT id, name, parent_region_id
    FROM regions
    WHERE world_view_id = $1
    ORDER BY id
  `, [worldViewId]);

  // Build WV tree in memory
  const wvNodesById = new Map<number, WvTreeNode>();
  const wvRoots: WvTreeNode[] = [];

  for (const row of regionResult.rows) {
    wvNodesById.set(row.id as number, {
      id: row.id as number,
      name: row.name as string,
      children: [],
    });
  }
  for (const row of regionResult.rows) {
    const node = wvNodesById.get(row.id as number)!;
    const parentId = row.parent_region_id as number | null;
    if (parentId && wvNodesById.has(parentId)) {
      wvNodesById.get(parentId)!.children.push(node);
    } else {
      wvRoots.push(node);
    }
  }

  console.log(`[WV Matcher] Built WV tree: ${wvNodesById.size} regions, ${wvRoots.length} roots`);

  // Phase 3: Walk tree and match
  progress.statusMessage = 'Matching countries...';
  const updates: MatchUpdate[] = [];

  /** Try to find GADM country IDs matching an import region name. Returns all matching IDs. */
  function tryMatchCountry(name: string): number[] {
    const cleaned = cleanWvName(name);
    const variants = getNameVariants(cleaned);
    for (const variant of variants) {
      const ids = gadm.gadmCountries.get(variant);
      if (ids !== undefined && ids.length > 0) return ids;
    }
    return [];
  }

  /**
   * Try matching ALL children of a WV country node to GADM direct subdivisions.
   * If all match → assign at child level. Otherwise → assign at country level.
   */
  function trySubdivisionDrillDown(
    wvCountry: WvTreeNode,
    gadmCountryId: number,
  ): void {
    const gadmChildIds = gadm.childrenOf.get(gadmCountryId);
    if (!gadmChildIds || gadmChildIds.length === 0) {
      // GADM country has no subdivisions → assign at country level
      const path = getPath(gadmCountryId, gadm.pathCache, gadm.divisionsById);
      const entry = gadm.divisionsById.get(gadmCountryId)!;
      updates.push({
        id: wvCountry.id,
        matchStatus: 'auto_matched',
        suggestions: [{ divisionId: gadmCountryId, name: entry.name, path, score: 700 }],
        divisionId: gadmCountryId,
      });
      progress.countriesMatched++;
      return;
    }

    const gadmChildren = gadmChildIds
      .map(id => gadm.divisionsById.get(id)!)
      .filter(Boolean);

    // Try matching each WV child
    const matches = new Map<number, { gadmEntry: DivisionEntry; score: number }>();
    for (const wvChild of wvCountry.children) {
      const best = findBestAmongChildren(wvChild.name, gadmChildren);
      if (best && best.score >= 700) {
        matches.set(wvChild.id, { gadmEntry: best.entry, score: best.score });
      }
    }

    if (matches.size === wvCountry.children.length) {
      // ALL children matched → assign at subdivision level
      progress.subdivisionsDrilled++;

      // Mark country as children_matched (no direct assignment)
      updates.push({
        id: wvCountry.id,
        matchStatus: 'children_matched',
        suggestions: [],
      });

      // Mark each child as auto_matched
      for (const wvChild of wvCountry.children) {
        const match = matches.get(wvChild.id)!;
        const path = getPath(match.gadmEntry.id, gadm.pathCache, gadm.divisionsById);
        updates.push({
          id: wvChild.id,
          matchStatus: 'auto_matched',
          suggestions: [{ divisionId: match.gadmEntry.id, name: match.gadmEntry.name, path, score: match.score }],
          divisionId: match.gadmEntry.id,
        });
      }
      progress.countriesMatched++;
    } else {
      // Not all children match → assign at country level
      const path = getPath(gadmCountryId, gadm.pathCache, gadm.divisionsById);
      const entry = gadm.divisionsById.get(gadmCountryId)!;
      updates.push({
        id: wvCountry.id,
        matchStatus: 'auto_matched',
        suggestions: [{ divisionId: gadmCountryId, name: entry.name, path, score: 700 }],
        divisionId: gadmCountryId,
      });
      progress.countriesMatched++;
    }
  }

  /**
   * Fallback: search ALL GADM divisions by name for unmatched leaf nodes.
   * Catches territories/dependencies like Réunion, Guadeloupe, Puerto Rico
   * that are standalone in the import source but subdivisions in GADM.
   */
  function tryFallbackMatch(name: string): MatchSuggestion[] {
    const cleaned = cleanWvName(name);
    const variants = getNameVariants(cleaned);
    const seen = new Set<number>();
    const suggestions: MatchSuggestion[] = [];

    for (const variant of variants) {
      const matches = gadm.divisionsByNormalizedName.get(variant);
      if (matches) {
        for (const entry of matches) {
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          const path = getPath(entry.id, gadm.pathCache, gadm.divisionsById);
          // Score: 700 for single match, lower if ambiguous (multiple results)
          suggestions.push({ divisionId: entry.id, name: entry.name, path, score: 700 });
        }
      }
    }

    // If multiple matches, lower score to force review
    if (suggestions.length > 1) {
      for (const s of suggestions) s.score = 500;
    }

    return suggestions.slice(0, 5);
  }

  function recordSingleCountry(node: WvTreeNode, countryId: number): void {
    if (node.children.length === 0) {
      updates.push({
        id: node.id,
        matchStatus: 'auto_matched',
        suggestions: [buildSuggestionFor(countryId, gadm)],
        divisionId: countryId,
      });
      progress.countriesMatched++;
      return;
    }
    trySubdivisionDrillDown(node, countryId);
  }

  function recordAmbiguousCountry(node: WvTreeNode, countryIds: number[]): void {
    updates.push({
      id: node.id,
      matchStatus: 'needs_review',
      suggestions: countryIds.map(id => buildSuggestionFor(id, gadm)),
    });
  }

  function recordFallbackOrNoMatch(node: WvTreeNode): void {
    const fallbackSuggestions = tryFallbackMatch(node.name);
    if (fallbackSuggestions.length === 0) {
      progress.noCandidates++;
      updates.push({ id: node.id, matchStatus: 'no_candidates', suggestions: [] });
      return;
    }
    progress.totalCountries++;
    if (fallbackSuggestions.length === 1 && fallbackSuggestions[0].score >= 700) {
      updates.push({
        id: node.id,
        matchStatus: 'auto_matched',
        suggestions: fallbackSuggestions,
        divisionId: fallbackSuggestions[0].divisionId,
      });
      progress.countriesMatched++;
    } else {
      updates.push({ id: node.id, matchStatus: 'needs_review', suggestions: fallbackSuggestions });
    }
  }

  /** Recursively walk the WV tree to find country-level nodes */
  function walkAndMatch(nodes: WvTreeNode[]): void {
    for (const node of nodes) {
      if (progress.cancel) return;

      const countryIds = tryMatchCountry(node.name);
      if (countryIds.length === 1) {
        progress.totalCountries++;
        recordSingleCountry(node, countryIds[0]);
      } else if (countryIds.length > 1) {
        progress.totalCountries++;
        recordAmbiguousCountry(node, countryIds);
      } else if (node.children.length > 0) {
        walkAndMatch(node.children);
      } else {
        recordFallbackOrNoMatch(node);
      }
    }
  }

  walkAndMatch(wvRoots);

  const matchTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[WV Matcher] Matching complete in ${matchTime}s. ${progress.totalCountries} countries found, ${progress.countriesMatched} matched (${progress.subdivisionsDrilled} with subdivision drill-down). Writing ${updates.length} results...`);

  // Phase 4: Batch-write results to relational tables
  //
  // Re-checked here, not only per node in the walk: the walk's own cancel check
  // is what *creates* a partial `updates` array, and committing that leaves some
  // regions auto_matched and the rest no_candidates while runImport takes its
  // cancelled branch and never advances import_runs past 'matching' — which the
  // review UI reads as an import still in flight. A partial commit is worse than
  // the whole one, and the hierarchical policy already refuses both.
  if (progress.cancel) {
    progress.status = 'cancelled';
    progress.statusMessage = 'Matching cancelled';
    console.log(`[WV Matcher] Cancelled before writing; ${updates.length} pending results discarded.`);
    return;
  }

  progress.statusMessage = 'Writing match results...';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const update of updates) {
      // Update match status in region_import_state
      await client.query(
        `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
        [update.matchStatus, update.id],
      );

      // Insert suggestions into region_match_suggestions
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

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[WV Matcher] All done in ${totalTime}s: countries=${progress.countriesMatched}/${progress.totalCountries}, drilldowns=${progress.subdivisionsDrilled}, noMatch=${progress.noCandidates}`);
}

/** Build a suggestion for a division id, resolving its name and path from GADM. */
function buildSuggestionFor(id: number, gadm: GADMData, score = 700): MatchSuggestion {
  const entry = gadm.divisionsById.get(id)!;
  const path = getPath(id, gadm.pathCache, gadm.divisionsById);
  return { divisionId: id, name: entry.name, path, score };
}
