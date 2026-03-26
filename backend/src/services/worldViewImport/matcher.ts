/**
 * WorldView Import Matcher — Country-Level Matching
 *
 * Two matching strategies:
 *
 * 1. matchCountryLevel() — NEW (default): walks the import tree to find country-level
 *    nodes that match GADM countries. If all subregions of a matched country also match
 *    GADM direct subdivisions, assigns at the subdivision level instead.
 *
 * 2. matchChildrenAsCountries() — Treats a matched region as a sub-continental grouping
 *    and matches its children independently as countries.
 *
 * Legacy leaf-level matching lives in matcherLegacy.ts.
 *
 * Performance: pre-loads all GADM data into memory to minimize DB round-trips.
 */

import { pool } from '../../db/index.js';
import type { ImportProgress, MatchSuggestion, MatchStatus } from './types.js';
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

// ─── Country-level matcher ───────────────────────────────────────────────────

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
  const updates: Array<{
    id: number;
    matchStatus: MatchStatus;
    suggestions: MatchSuggestion[];
    divisionId?: number;
  }> = [];

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
   *
   * Two phases:
   * 1. Exact variant matching (in-memory, fast)
   * 2. Trigram similarity search (DB query, catches fuzzy matches like
   *    "Ivory Coast"↔"Côte d'Ivoire", "Timor-Leste"↔"East Timor")
   */
  async function tryFallbackMatch(name: string): Promise<MatchSuggestion[]> {
    const cleaned = cleanWvName(name);
    const variants = getNameVariants(cleaned);
    const seen = new Set<number>();
    const suggestions: MatchSuggestion[] = [];

    // Phase 1: Exact name variant matching (in-memory)
    for (const variant of variants) {
      const matches = gadm.divisionsByNormalizedName.get(variant);
      if (matches) {
        for (const entry of matches) {
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          const path = getPath(entry.id, gadm.pathCache, gadm.divisionsById);
          suggestions.push({ divisionId: entry.id, name: entry.name, path, score: 700 });
        }
      }
    }

    if (suggestions.length > 1) {
      for (const s of suggestions) s.score = 500;
    }

    if (suggestions.length > 0) {
      return suggestions.slice(0, 5);
    }

    // Phase 2: Trigram similarity search (DB fallback)
    const normalized = normalizeName(cleaned);
    const trigramResult = await pool.query(`
      SELECT id, name, similarity(name_normalized, $1) AS sim
      FROM administrative_divisions
      WHERE name_normalized % $1
        AND similarity(name_normalized, $1) > 0.3
      ORDER BY sim DESC
      LIMIT 5
    `, [normalized]);

    for (const row of trigramResult.rows) {
      const id = row.id as number;
      if (seen.has(id)) continue;
      seen.add(id);
      const path = getPath(id, gadm.pathCache, gadm.divisionsById);
      suggestions.push({
        divisionId: id,
        name: row.name as string,
        path,
        score: Math.round((row.sim as number) * 1000),
      });
    }

    return suggestions.slice(0, 5);
  }

  /** Recursively walk the WV tree to find country-level nodes */
  async function walkAndMatch(nodes: WvTreeNode[]): Promise<void> {
    for (const node of nodes) {
      if (progress.cancel) return;

      const countryIds = tryMatchCountry(node.name);

      if (countryIds.length > 0) {
        progress.totalCountries++;

        if (countryIds.length === 1) {
          // Single GADM match — auto-assign or drill down
          const countryId = countryIds[0];
          if (node.children.length === 0) {
            // Leaf country — assign directly
            const path = getPath(countryId, gadm.pathCache, gadm.divisionsById);
            const entry = gadm.divisionsById.get(countryId)!;
            updates.push({
              id: node.id,
              matchStatus: 'auto_matched',
              suggestions: [{ divisionId: countryId, name: entry.name, path, score: 700 }],
              divisionId: countryId,
            });
            progress.countriesMatched++;
          } else {
            // Country with children — try drill-down
            trySubdivisionDrillDown(node, countryId);
          }
        } else {
          // Multiple GADM divisions for this country name (e.g. Spain in Europe + Africa)
          // Suggest all and let the user approve/reject each
          const suggestions: MatchSuggestion[] = countryIds.map(id => {
            const entry = gadm.divisionsById.get(id)!;
            const path = getPath(id, gadm.pathCache, gadm.divisionsById);
            return { divisionId: id, name: entry.name, path, score: 700 };
          });
          updates.push({
            id: node.id,
            matchStatus: 'needs_review',
            suggestions,
          });
        }
      } else {
        // Not a country — check if it's a container or a leaf territory
        if (node.children.length > 0) {
          // Container (continent, sub-region grouping) — recurse into children
          await walkAndMatch(node.children);
        } else {
          // Leaf node that didn't match a country — try matching against ALL divisions.
          // This catches territories/dependencies that are standalone in the import source
          // but subdivisions in GADM (e.g. Réunion, Guadeloupe, Puerto Rico).
          const fallbackSuggestions = await tryFallbackMatch(node.name);
          if (fallbackSuggestions.length > 0) {
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
              updates.push({
                id: node.id,
                matchStatus: 'needs_review',
                suggestions: fallbackSuggestions,
              });
            }
          } else {
            progress.noCandidates++;
            updates.push({
              id: node.id,
              matchStatus: 'no_candidates',
              suggestions: [],
            });
          }
        }
      }
    }
  }

  await walkAndMatch(wvRoots);

  const matchTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[WV Matcher] Matching complete in ${matchTime}s. ${progress.totalCountries} countries found, ${progress.countriesMatched} matched (${progress.subdivisionsDrilled} with subdivision drill-down). Writing ${updates.length} results...`);

  // Phase 4: Batch-write results to relational tables
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

  // Geo comparison — runs AFTER match transaction commits so failures don't roll back matches.
  // Only for regions with multiple suggestions (needs_review/suggested).
  const geoUpdates = updates.filter(u =>
    u.suggestions.length > 1 && (u.matchStatus === 'needs_review' || u.matchStatus === 'suggested'),
  );
  if (geoUpdates.length > 0) {
    const geoClient = await pool.connect();
    try {
      for (let i = 0; i < geoUpdates.length; i++) {
        progress.statusMessage = `Computing geo similarity (${i + 1}/${geoUpdates.length})...`;
        try {
          await computeGeoSimilarityForRegion(geoClient, geoUpdates[i].id, geoUpdates[i].suggestions);
        } catch (err) {
          console.warn(`[WV Matcher] Geo similarity failed for region ${geoUpdates[i].id}:`, err instanceof Error ? err.message : err);
        }
      }
    } finally {
      geoClient.release();
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[WV Matcher] All done in ${totalTime}s: countries=${progress.countriesMatched}/${progress.totalCountries}, drilldowns=${progress.subdivisionsDrilled}, noMatch=${progress.noCandidates}`);
}
