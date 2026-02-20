/**
 * WorldView Import Matcher
 *
 * Two matching strategies:
 *
 * 1. matchCountryLevel() — NEW (default): walks the import tree to find country-level
 *    nodes that match GADM countries. If all subregions of a matched country also match
 *    GADM direct subdivisions, assigns at the subdivision level instead.
 *
 * 2. matchLeafRegions() — LEGACY: matches every leaf region independently against all GADM
 *    divisions. Kept for backward compatibility but not called from the import pipeline.
 *
 * Performance: pre-loads all GADM data into memory to minimize DB round-trips.
 */

import { pool } from '../../db/index.js';
import type { ImportProgress, MatchSuggestion, MatchStatus } from './types.js';

// ─── Shared utilities ──────────────────────────────────────────────────────────

/** Common geographic suffixes to strip for fuzzy matching */
const STRIP_SUFFIX_REGEX = /\s+(Province|State|Prefecture|Oblast|County|District|Department|Region|Territory|Governorate|Municipality|Division|Parish|Canton|Voivodeship|Krai|Republic|Autonomous|Community|Emirate|Principality)$/i;

/** Normalize a name for matching: lowercase, strip accents */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .trim();
}

/** Get name variants: original + suffix-stripped */
function getNameVariants(name: string): string[] {
  const normalized = normalizeName(name);
  const stripped = normalized.replace(STRIP_SUFFIX_REGEX, '').trim();
  const variants = [normalized];
  if (stripped !== normalized && stripped.length > 0) {
    variants.push(normalizeName(stripped));
  }
  return variants;
}

/**
 * Check if one name starts with the other (prefix match).
 * Catches cases like "Ingushetia" vs "Ingush", "Kabardino-Balkaria" vs "Kabardin-Balkar".
 * For hyphenated names, checks prefix match on each part independently.
 */
function isPrefixMatch(a: string, b: string): boolean {
  // Ensure a is the shorter one
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  // Shorter must be at least 4 chars and at least 60% of the longer name's length
  if (shorter.length < 4 || shorter.length / longer.length < 0.6) return false;

  // For hyphenated names, check each part
  if (shorter.includes('-') && longer.includes('-')) {
    const sParts = shorter.split('-');
    const lParts = longer.split('-');
    if (sParts.length === lParts.length) {
      return sParts.every((sp, i) => lParts[i].startsWith(sp) || sp.startsWith(lParts[i]));
    }
  }

  return longer.startsWith(shorter);
}

/** Clean an import region name: strip parenthetical annotations like "(USA)" */
function cleanWvName(name: string): string {
  return name.replace(/\s*\(.*$/, '').trim();
}

// ─── Pre-loaded data structures ──────────────────────────────────────────────

interface DivisionEntry {
  id: number;
  name: string;
  nameNormalized: string;
  parentId: number | null;
}

/** Pre-computed division path cache */
type PathCache = Map<number, string>;

/** Build full path for a division using pre-loaded data */
function buildPath(divisionId: number, divisionsById: Map<number, DivisionEntry>): string {
  const parts: string[] = [];
  let current = divisionsById.get(divisionId);
  while (current) {
    parts.unshift(current.name);
    current = current.parentId ? divisionsById.get(current.parentId) : undefined;
  }
  return parts.join(' > ');
}

/** Get path from cache, computing on demand */
function getPath(divisionId: number, pathCache: PathCache, divisionsById: Map<number, DivisionEntry>): string {
  let path = pathCache.get(divisionId);
  if (path === undefined) {
    path = buildPath(divisionId, divisionsById);
    pathCache.set(divisionId, path);
  }
  return path;
}

/**
 * Try matching a single WV name against a specific set of GADM divisions (in-memory).
 * Returns the best match or null.
 */
function findBestAmongChildren(
  wvName: string,
  gadmChildren: DivisionEntry[],
): { entry: DivisionEntry; score: number } | null {
  const cleaned = cleanWvName(wvName);
  const variants = getNameVariants(cleaned);

  let bestMatch: { entry: DivisionEntry; score: number } | null = null;

  for (const gadmEntry of gadmChildren) {
    // Try exact match against GADM normalized name
    for (const variant of variants) {
      if (gadmEntry.nameNormalized === variant) {
        const score = 700; // High confidence exact match
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { entry: gadmEntry, score };
        }
      }
    }

    // Also try GADM name variants (strip suffix from GADM name too)
    if (!bestMatch) {
      const gadmVariants = getNameVariants(gadmEntry.name);
      for (const gv of gadmVariants) {
        for (const wv of variants) {
          if (gv === wv) {
            const score = 650; // Slightly lower for variant-to-variant
            if (!bestMatch || score > bestMatch.score) {
              bestMatch = { entry: gadmEntry, score };
            }
          }
        }
      }
    }

    // Prefix match fallback: catches "Ingushetia"↔"Ingush", "Kabardino-Balkaria"↔"Kabardin-Balkar"
    if (!bestMatch) {
      for (const variant of variants) {
        if (isPrefixMatch(variant, gadmEntry.nameNormalized)) {
          bestMatch = { entry: gadmEntry, score: 650 };
        }
      }
    }
  }

  return bestMatch;
}

/** Loaded GADM data shared between matchers */
interface GADMData {
  divisionsById: Map<number, DivisionEntry>;
  divisionsByNormalizedName: Map<string, DivisionEntry[]>;
  gadmCountries: Map<string, number[]>;
  childrenOf: Map<number, number[]>;
  countryIds: Set<number>;
  countryDescendants: Map<number, Set<number>>;
  pathCache: PathCache;
}

/** Pre-load all GADM division data into memory */
async function loadGADMData(): Promise<GADMData> {
  const allDivisionsResult = await pool.query(`
    SELECT id, name, name_normalized, parent_id
    FROM administrative_divisions
  `);

  const divisionsById = new Map<number, DivisionEntry>();
  const divisionsByNormalizedName = new Map<string, DivisionEntry[]>();
  const continentIds = new Set<number>();
  const countryIds = new Set<number>();

  for (const row of allDivisionsResult.rows) {
    const entry: DivisionEntry = {
      id: row.id as number,
      name: row.name as string,
      nameNormalized: (row.name_normalized as string) ?? normalizeName(row.name as string),
      parentId: row.parent_id as number | null,
    };
    divisionsById.set(entry.id, entry);

    const existing = divisionsByNormalizedName.get(entry.nameNormalized);
    if (existing) {
      existing.push(entry);
    } else {
      divisionsByNormalizedName.set(entry.nameNormalized, [entry]);
    }

    if (entry.parentId === null) {
      continentIds.add(entry.id);
    }
  }

  // Build children lookup (needed before country detection)
  const childrenOf = new Map<number, number[]>();
  for (const entry of divisionsById.values()) {
    if (entry.parentId !== null) {
      const children = childrenOf.get(entry.parentId);
      if (children) {
        children.push(entry.id);
      } else {
        childrenOf.set(entry.parentId, [entry.id]);
      }
    }
  }

  // Identify countries (children of continents).
  // Also treat root-level entries that have children as countries — GADM puts
  // Australia at the root (no parent) alongside real continents.
  for (const entry of divisionsById.values()) {
    if (entry.parentId !== null && continentIds.has(entry.parentId)) {
      countryIds.add(entry.id);
    }
  }
  for (const cid of continentIds) {
    const children = childrenOf.get(cid);
    // Root entries whose children are NOT countries are real countries themselves
    // (e.g., Australia has states directly, while Asia has countries)
    if (!children || children.every(ch => !countryIds.has(ch))) {
      countryIds.add(cid);
    }
  }

  // Build country name lookup (multiple GADM divisions can share a name,
  // e.g. "Spain" under both Europe and Africa for overseas territories)
  const gadmCountries = new Map<string, number[]>();
  for (const countryId of countryIds) {
    const entry = divisionsById.get(countryId)!;
    const existing = gadmCountries.get(entry.nameNormalized);
    if (existing) {
      existing.push(entry.id);
    } else {
      gadmCountries.set(entry.nameNormalized, [entry.id]);
    }
    const stripped = entry.nameNormalized.replace(STRIP_SUFFIX_REGEX, '').trim();
    if (stripped !== entry.nameNormalized) {
      const existingStripped = gadmCountries.get(stripped);
      if (existingStripped) {
        if (!existingStripped.includes(entry.id)) existingStripped.push(entry.id);
      } else {
        gadmCountries.set(stripped, [entry.id]);
      }
    }
  }

  // For each country, collect all descendant IDs using BFS
  const countryDescendants = new Map<number, Set<number>>();
  for (const countryId of countryIds) {
    const descendants = new Set<number>([countryId]);
    const queue = [countryId];
    while (queue.length > 0) {
      const current = queue.pop()!;
      const children = childrenOf.get(current);
      if (children) {
        for (const childId of children) {
          descendants.add(childId);
          queue.push(childId);
        }
      }
    }
    countryDescendants.set(countryId, descendants);
  }

  return {
    divisionsById,
    divisionsByNormalizedName,
    gadmCountries,
    childrenOf,
    countryIds,
    countryDescendants,
    pathCache: new Map(),
  };
}

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

  /** Recursively walk the WV tree to find country-level nodes */
  function walkAndMatch(nodes: WvTreeNode[]): void {
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
          walkAndMatch(node.children);
        } else {
          // Leaf node that didn't match a country — try matching against ALL divisions.
          // This catches territories/dependencies that are standalone in the import source
          // but subdivisions in GADM (e.g. Réunion, Guadeloupe, Puerto Rico).
          const fallbackSuggestions = tryFallbackMatch(node.name);
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

  walkAndMatch(wvRoots);

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

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[WV Matcher] All done in ${totalTime}s: countries=${progress.countriesMatched}/${progress.totalCountries}, drilldowns=${progress.subdivisionsDrilled}, noMatch=${progress.noCandidates}`);
}

// ─── Handle as sub-continental grouping ──────────────────────────────────────

/**
 * Treat a matched region as a sub-continental grouping: clear its own match,
 * mark it as `children_matched`, and run country-level matching on its children.
 *
 * Used when the admin identifies Melanesia/Micronesia/Polynesia etc. as groupings
 * whose children (Fiji, PNG, ...) should be matched independently as countries.
 */
export async function matchChildrenAsCountries(
  worldViewId: number,
  regionId: number,
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

    // Try matching as a country
    const cleaned = cleanWvName(childName);
    const variants = getNameVariants(cleaned);
    let countryMatchIds: number[] = [];
    for (const variant of variants) {
      const ids = gadm.gadmCountries.get(variant);
      if (ids && ids.length > 0) { countryMatchIds = ids; break; }
    }

    if (countryMatchIds.length === 1) {
      const countryId = countryMatchIds[0];
      if (!childHasChildren) {
        // Leaf — assign directly
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
        // Has WV children — try subdivision drill-down
        const gadmChildIds = gadm.childrenOf.get(countryId);
        if (gadmChildIds && gadmChildIds.length > 0) {
          // Load WV grandchildren for drill-down
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
            // All grandchildren matched — assign at subdivision level
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
            // Not all grandchildren match — assign at country level
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
          // No GADM subdivisions — assign at country level
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
      // Multiple GADM matches — needs review
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

      if (fallbackSuggestions.length === 1 && fallbackSuggestions[0].score >= 700) {
        updates.push({
          id: childId,
          matchStatus: 'auto_matched',
          suggestions: fallbackSuggestions,
          divisionId: fallbackSuggestions[0].divisionId,
        });
        matched++;
      } else if (fallbackSuggestions.length > 0) {
        updates.push({ id: childId, matchStatus: 'needs_review', suggestions: fallbackSuggestions.slice(0, 5) });
      } else {
        updates.push({ id: childId, matchStatus: 'no_candidates', suggestions: [] });
      }
    }
  }

  // Write results to relational tables in a transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear parent's own match and mark as children_matched
    await client.query(
      `DELETE FROM region_members WHERE region_id = $1`,
      [regionId],
    );
    await client.query(
      `UPDATE region_import_state SET match_status = 'children_matched' WHERE region_id = $1`,
      [regionId],
    );
    // Clear parent's suggestions
    await client.query(
      `DELETE FROM region_match_suggestions WHERE region_id = $1`,
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

  console.log(`[WV Matcher] matchChildrenAsCountries: region ${regionId} — ${matched}/${childResult.rows.length} children matched`);
  return { matched, total: childResult.rows.length };
}

// ─── Legacy leaf-level matcher ───────────────────────────────────────────────

/**
 * Match all leaf regions in a WorldView to GADM divisions (LEGACY).
 * Kept for backward compatibility. New imports use matchCountryLevel().
 */
export async function matchLeafRegions(
  worldViewId: number,
  progress: ImportProgress,
): Promise<void> {
  progress.status = 'matching';
  const startTime = Date.now();

  // Phase 1: Pre-load GADM data
  progress.statusMessage = 'Loading GADM divisions into memory...';
  console.log('[WV Matcher] Loading all divisions into memory...');
  const gadm = await loadGADMData();
  console.log(`[WV Matcher] Loaded ${gadm.divisionsById.size} divisions, ${gadm.countryIds.size} countries`);

  // Phase 2: Load all regions + ancestor paths
  progress.statusMessage = 'Loading regions and ancestor paths...';

  const regionResult = await pool.query(`
    SELECT id, name, is_leaf FROM regions
    WHERE world_view_id = $1
    ORDER BY id
  `, [worldViewId]);
  const allRegions = regionResult.rows as Array<{ id: number; name: string; is_leaf: boolean }>;

  const ancestorResult = await pool.query(`
    WITH RECURSIVE region_ancestors AS (
      SELECT id, name, parent_region_id, id AS region_id
      FROM regions
      WHERE world_view_id = $1
      UNION ALL
      SELECT r.id, r.name, r.parent_region_id, ra.region_id
      FROM regions r
      JOIN region_ancestors ra ON r.id = ra.parent_region_id
    )
    SELECT region_id, array_agg(name ORDER BY id) AS ancestor_names
    FROM region_ancestors
    GROUP BY region_id
  `, [worldViewId]);

  const ancestorsByRegionId = new Map<number, string[]>();
  for (const row of ancestorResult.rows) {
    ancestorsByRegionId.set(row.region_id as number, row.ancestor_names as string[]);
  }

  const leafCount = allRegions.filter(r => r.is_leaf).length;
  progress.totalCountries = leafCount; // legacy: use totalCountries for leaf count
  progress.statusMessage = `Matching ${allRegions.length} regions (${leafCount} leaves)...`;
  console.log(`[WV Matcher] Pre-loading complete. Found ${allRegions.length} regions (${leafCount} leaves) to match`);

  // Phase 3: Match each region
  const updates: Array<{ id: number; matchStatus: MatchStatus; suggestions: MatchSuggestion[]; divisionId?: number }> = [];

  for (let i = 0; i < allRegions.length; i++) {
    if (progress.cancel) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Matching cancelled';
      return;
    }

    const region = allRegions[i];
    progress.matchedRegions = i + 1;
    if ((i + 1) % 200 === 0) {
      progress.statusMessage = `Matching regions... ${i + 1}/${allRegions.length}`;
    }

    // Find country context from ancestors (in-memory)
    const ancestorNames = ancestorsByRegionId.get(region.id) ?? [region.name];
    let countryId: number | null = null;
    for (const name of ancestorNames) {
      const variants = getNameVariants(name);
      for (const variant of variants) {
        const ids = gadm.gadmCountries.get(variant);
        if (ids && ids.length > 0) {
          countryId = ids[0]; // Use first match for country context
          break;
        }
      }
      if (countryId) break;
    }

    const descendantSet = countryId ? gadm.countryDescendants.get(countryId) ?? null : null;

    // Find candidates
    const candidates = await findCandidatesOptimized(
      region.name, countryId, descendantSet, gadm,
    );

    // Determine match status
    if (region.is_leaf) {
      if (candidates.length === 1 && candidates[0].score >= 700) {
        progress.countriesMatched++;
        updates.push({ id: region.id, matchStatus: 'auto_matched', suggestions: candidates, divisionId: candidates[0].divisionId });
      } else if (candidates.length > 0) {
        updates.push({ id: region.id, matchStatus: 'needs_review', suggestions: candidates });
      } else {
        progress.noCandidates++;
        updates.push({ id: region.id, matchStatus: 'no_candidates', suggestions: [] });
      }
    } else {
      if (candidates.length > 0) {
        updates.push({ id: region.id, matchStatus: 'suggested', suggestions: candidates });
      }
    }
  }

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

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[WV Matcher] All done in ${totalTime}s: auto=${progress.countriesMatched}, none=${progress.noCandidates}`);
}

/**
 * Find candidate divisions using in-memory lookups + DB fallback for trigram.
 */
async function findCandidatesOptimized(
  regionName: string,
  countryDivisionId: number | null,
  descendantSet: Set<number> | null,
  gadm: GADMData,
): Promise<MatchSuggestion[]> {
  const nameVariants = getNameVariants(regionName);
  const candidates = new Map<number, MatchSuggestion>();

  for (const variant of nameVariants) {
    // Exact match (in-memory)
    const exactMatches = gadm.divisionsByNormalizedName.get(variant);
    if (exactMatches) {
      for (const entry of exactMatches) {
        if (candidates.has(entry.id)) continue;
        let score = 400;
        if (descendantSet?.has(entry.id)) score += 300;
        candidates.set(entry.id, {
          divisionId: entry.id, name: entry.name, path: '', score,
        });
      }
    }

    // Trigram similarity (DB with GIN index)
    if (candidates.size < 5) {
      const trigramResult = await pool.query(`
        SELECT id, name, similarity(name_normalized, $1) AS sim
        FROM administrative_divisions
        WHERE name_normalized % $1
          AND similarity(name_normalized, $1) > 0.4
        ORDER BY sim DESC
        LIMIT 10
      `, [variant]);

      for (const row of trigramResult.rows) {
        const id = row.id as number;
        if (candidates.has(id)) continue;
        let score = Math.round((row.sim as number) * 100);
        if (descendantSet?.has(id)) score += 300;
        candidates.set(id, {
          divisionId: id, name: row.name as string, path: '', score,
        });
      }
    }
  }

  // Prefer candidates within the country
  let candidateList = Array.from(candidates.values());
  if (countryDivisionId && descendantSet) {
    const inCountry = candidateList.filter(c => descendantSet.has(c.divisionId));
    if (inCountry.length > 0) {
      if (inCountry.length === 1) inCountry[0].score += 50;
      candidateList = inCountry;
    }
  }

  if (candidateList.length === 1) candidateList[0].score += 50;

  // Fill in paths
  for (const c of candidateList) {
    c.path = getPath(c.divisionId, gadm.pathCache, gadm.divisionsById);
  }

  return candidateList.sort((a, b) => b.score - a.score).slice(0, 5);
}
