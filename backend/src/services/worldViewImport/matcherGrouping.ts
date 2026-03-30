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
  // Load GADM data
  const gadm = await loadGADMData();

  // Load children of this region
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

  // Build scoped division pool: children (and deeper) of the parent's assigned divisions
  // If no scope, fall back to all GADM countries
  let scopedDivisions: DivisionEntry[] = [];
  let scopedByName: Map<string, DivisionEntry[]> = new Map();

  if (scopeDivisionIds.length > 0) {
    // Collect the parent's own divisions + all their descendants (BFS)
    const poolIds = new Set<number>(scopeDivisionIds);
    const queue = [...scopeDivisionIds];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      const childIds = gadm.childrenOf.get(parentId);
      if (childIds) {
        for (const cid of childIds) {
          if (!poolIds.has(cid)) {
            poolIds.add(cid);
            queue.push(cid);
          }
        }
      }
    }
    scopedDivisions = [...poolIds]
      .map(id => gadm.divisionsById.get(id))
      .filter((e): e is DivisionEntry => !!e);

    // Index by normalized name for lookup
    for (const entry of scopedDivisions) {
      const key = normalizeName(entry.name);
      if (!scopedByName.has(key)) scopedByName.set(key, []);
      scopedByName.get(key)!.push(entry);
    }
    console.log(`[WV Matcher] Scoped matching: ${scopedDivisions.length} divisions (${scopeDivisionIds.length} parent + descendants)`);
  }

  const useScoped = scopedDivisions.length > 0;

  const updates: Array<{
    id: number;
    matchStatus: MatchStatus;
    suggestions: MatchSuggestion[];
    divisionId?: number;
  }> = [];
  let matched = 0;

  for (const row of childResult.rows) {
    const childId = row.id as number;
    const childName = row.name as string;
    const childHasChildren = row.has_children as boolean;

    const cleaned = cleanWvName(childName);
    const variants = getNameVariants(cleaned);

    if (useScoped) {
      // --- Scoped matching: match against descendants of parent's divisions ---
      let bestMatch: { entry: DivisionEntry; score: number } | null = null;

      // Try name variants against scoped divisions
      for (const variant of variants) {
        const entries = scopedByName.get(variant);
        if (entries && entries.length === 1) {
          bestMatch = { entry: entries[0], score: 700 };
          break;
        }
      }

      // Fallback: findBestAmongChildren for fuzzy matching
      if (!bestMatch) {
        const best = findBestAmongChildren(childName, scopedDivisions);
        if (best && best.score >= 500) {
          bestMatch = best;
        }
      }

      if (bestMatch) {
        const { entry, score } = bestMatch;
        if (!childHasChildren) {
          // Leaf — assign directly
          const path = getPath(entry.id, gadm.pathCache, gadm.divisionsById);
          updates.push({
            id: childId,
            matchStatus: score >= 700 ? 'auto_matched' : 'needs_review',
            suggestions: [{ divisionId: entry.id, name: entry.name, path, score }],
            divisionId: score >= 700 ? entry.id : undefined,
          });
          if (score >= 700) matched++;
        } else {
          // Has WV children — try subdivision drill-down
          const gadmChildIds = gadm.childrenOf.get(entry.id);
          if (gadmChildIds && gadmChildIds.length > 0) {
            const gcResult = await pool.query(
              `SELECT id, name FROM regions WHERE parent_region_id = $1 ORDER BY name`,
              [childId],
            );
            const gadmChildren = gadmChildIds.map(id => gadm.divisionsById.get(id)!).filter(Boolean);
            const matches = new Map<number, { gadmEntry: DivisionEntry; score: number }>();
            for (const gc of gcResult.rows) {
              const best = findBestAmongChildren(gc.name as string, gadmChildren);
              if (best && best.score >= 700) {
                matches.set(gc.id as number, { gadmEntry: best.entry, score: best.score });
              }
            }
            if (matches.size === gcResult.rows.length) {
              // All grandchildren matched at subdivision level
              updates.push({ id: childId, matchStatus: 'children_matched', suggestions: [] });
              for (const gc of gcResult.rows) {
                const m = matches.get(gc.id as number)!;
                const path = getPath(m.gadmEntry.id, gadm.pathCache, gadm.divisionsById);
                updates.push({
                  id: gc.id as number,
                  matchStatus: 'auto_matched',
                  suggestions: [{ divisionId: m.gadmEntry.id, name: m.gadmEntry.name, path, score: m.score }],
                  divisionId: m.gadmEntry.id,
                });
              }
              matched++;
            } else {
              // Not all grandchildren match — assign at this level
              const path = getPath(entry.id, gadm.pathCache, gadm.divisionsById);
              updates.push({
                id: childId,
                matchStatus: score >= 700 ? 'auto_matched' : 'needs_review',
                suggestions: [{ divisionId: entry.id, name: entry.name, path, score }],
                divisionId: score >= 700 ? entry.id : undefined,
              });
              if (score >= 700) matched++;
            }
          } else {
            // No GADM subdivisions — assign at this level
            const path = getPath(entry.id, gadm.pathCache, gadm.divisionsById);
            updates.push({
              id: childId,
              matchStatus: score >= 700 ? 'auto_matched' : 'needs_review',
              suggestions: [{ divisionId: entry.id, name: entry.name, path, score }],
              divisionId: score >= 700 ? entry.id : undefined,
            });
            if (score >= 700) matched++;
          }
        }
      } else {
        // No match found in scoped divisions — try trigram search within scope
        const normalized = normalizeName(cleaned);
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

        const fallbackSuggestions: MatchSuggestion[] = [];
        for (const r of trigramResult.rows) {
          const path = getPath(r.id as number, gadm.pathCache, gadm.divisionsById);
          fallbackSuggestions.push({
            divisionId: r.id as number,
            name: r.name as string,
            path,
            score: Math.round((r.sim as number) * 1000),
          });
        }

        if (fallbackSuggestions.length === 1 && fallbackSuggestions[0].score >= 700) {
          updates.push({
            id: childId,
            matchStatus: 'auto_matched',
            suggestions: fallbackSuggestions,
            divisionId: fallbackSuggestions[0].divisionId,
          });
          matched++;
        } else if (fallbackSuggestions.length > 0) {
          updates.push({ id: childId, matchStatus: 'needs_review', suggestions: fallbackSuggestions });
        } else {
          updates.push({ id: childId, matchStatus: 'no_candidates', suggestions: [] });
        }
      }
    } else {
      // --- Unscoped: original behavior — match against all GADM countries ---
      let countryMatchIds: number[] = [];
      for (const variant of variants) {
        const ids = gadm.gadmCountries.get(variant);
        if (ids && ids.length > 0) { countryMatchIds = ids; break; }
      }

      if (countryMatchIds.length === 1) {
        const countryId = countryMatchIds[0];
        if (!childHasChildren) {
          const path = getPath(countryId, gadm.pathCache, gadm.divisionsById);
          const entry = gadm.divisionsById.get(countryId)!;
          updates.push({
            id: childId,
            matchStatus: 'auto_matched',
            suggestions: [{ divisionId: countryId, name: entry.name, path, score: 700 }],
            divisionId: countryId,
          });
          matched++;
        } else {
          const gadmChildIds = gadm.childrenOf.get(countryId);
          if (gadmChildIds && gadmChildIds.length > 0) {
            const gcResult = await pool.query(
              `SELECT id, name FROM regions WHERE parent_region_id = $1 ORDER BY name`,
              [childId],
            );
            const gadmChildren = gadmChildIds.map(id => gadm.divisionsById.get(id)!).filter(Boolean);
            const matches = new Map<number, { gadmEntry: DivisionEntry; score: number }>();
            for (const gc of gcResult.rows) {
              const best = findBestAmongChildren(gc.name as string, gadmChildren);
              if (best && best.score >= 700) {
                matches.set(gc.id as number, { gadmEntry: best.entry, score: best.score });
              }
            }
            if (matches.size === gcResult.rows.length) {
              updates.push({ id: childId, matchStatus: 'children_matched', suggestions: [] });
              for (const gc of gcResult.rows) {
                const m = matches.get(gc.id as number)!;
                const path = getPath(m.gadmEntry.id, gadm.pathCache, gadm.divisionsById);
                updates.push({
                  id: gc.id as number,
                  matchStatus: 'auto_matched',
                  suggestions: [{ divisionId: m.gadmEntry.id, name: m.gadmEntry.name, path, score: m.score }],
                  divisionId: m.gadmEntry.id,
                });
              }
              matched++;
            } else {
              const path = getPath(countryId, gadm.pathCache, gadm.divisionsById);
              const entry = gadm.divisionsById.get(countryId)!;
              updates.push({
                id: childId,
                matchStatus: 'auto_matched',
                suggestions: [{ divisionId: countryId, name: entry.name, path, score: 700 }],
                divisionId: countryId,
              });
              matched++;
            }
          } else {
            const path = getPath(countryId, gadm.pathCache, gadm.divisionsById);
            const entry = gadm.divisionsById.get(countryId)!;
            updates.push({
              id: childId,
              matchStatus: 'auto_matched',
              suggestions: [{ divisionId: countryId, name: entry.name, path, score: 700 }],
              divisionId: countryId,
            });
            matched++;
          }
        }
      } else if (countryMatchIds.length > 1) {
        const suggestions: MatchSuggestion[] = countryMatchIds.map(id => {
          const entry = gadm.divisionsById.get(id)!;
          const path = getPath(id, gadm.pathCache, gadm.divisionsById);
          return { divisionId: id, name: entry.name, path, score: 700 };
        });
        updates.push({ id: childId, matchStatus: 'needs_review', suggestions });
      } else {
        // No country match — try fallback against all divisions
        const seen = new Set<number>();
        const fallbackSuggestions: MatchSuggestion[] = [];
        for (const variant of variants) {
          const matches = gadm.divisionsByNormalizedName.get(variant);
          if (matches) {
            for (const entry of matches) {
              if (seen.has(entry.id)) continue;
              seen.add(entry.id);
              const path = getPath(entry.id, gadm.pathCache, gadm.divisionsById);
              fallbackSuggestions.push({ divisionId: entry.id, name: entry.name, path, score: 700 });
            }
          }
        }
        if (fallbackSuggestions.length > 1) {
          for (const s of fallbackSuggestions) s.score = 500;
        }
        if (fallbackSuggestions.length === 0) {
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
            fallbackSuggestions.push({ divisionId: id, name: r.name as string, path, score: Math.round((r.sim as number) * 1000) });
          }
        }
        if (fallbackSuggestions.length === 1 && fallbackSuggestions[0].score >= 700) {
          updates.push({ id: childId, matchStatus: 'auto_matched', suggestions: fallbackSuggestions, divisionId: fallbackSuggestions[0].divisionId });
          matched++;
        } else if (fallbackSuggestions.length > 0) {
          updates.push({ id: childId, matchStatus: 'needs_review', suggestions: fallbackSuggestions.slice(0, 5) });
        } else {
          updates.push({ id: childId, matchStatus: 'no_candidates', suggestions: [] });
        }
      }
    }
  }

  // Write results to relational tables in a transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Mark parent as children_matched (keep its division assignments)
    await client.query(
      `UPDATE region_import_state SET match_status = 'children_matched' WHERE region_id = $1`,
      [regionId],
    );

    // Write child updates
    for (const update of updates) {
      await client.query(
        `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
        [update.matchStatus, update.id],
      );

      // Clear old suggestions and insert new ones
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

  // Geo comparison — runs after match transaction commits
  const geoUpdates = updates.filter(u =>
    u.suggestions.length > 1 && (u.matchStatus === 'needs_review' || u.matchStatus === 'suggested'),
  );
  if (geoUpdates.length > 0) {
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

  console.log(`[WV Matcher] matchChildrenAsCountries: region ${regionId} — ${matched}/${childResult.rows.length} children matched`);
  return { matched, total: childResult.rows.length };
}
