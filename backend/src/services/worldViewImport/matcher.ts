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
// eslint-disable-next-line sonarjs/slow-regex, sonarjs/regex-complexity -- pure word-level alternation anchored to $; no nested quantifiers, so the engine commits to one alternate per match attempt
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
  // eslint-disable-next-line sonarjs/slow-regex -- `\s*` matches whitespace only and is followed by a literal `(`; `.*$` is a single greedy run anchored to end-of-string. No nested quantifiers, no catastrophic backtracking.
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

interface ScoredEntry { entry: DivisionEntry; score: number }

function exactNameMatch(gadmEntry: DivisionEntry, variants: string[]): ScoredEntry | null {
  for (const variant of variants) {
    if (gadmEntry.nameNormalized === variant) {
      return { entry: gadmEntry, score: 700 };
    }
  }
  return null;
}

function variantNameMatch(gadmEntry: DivisionEntry, variants: string[]): ScoredEntry | null {
  const gadmVariants = getNameVariants(gadmEntry.name);
  for (const gv of gadmVariants) {
    for (const wv of variants) {
      if (gv === wv) return { entry: gadmEntry, score: 650 };
    }
  }
  return null;
}

function prefixNameMatch(gadmEntry: DivisionEntry, variants: string[]): ScoredEntry | null {
  for (const variant of variants) {
    if (isPrefixMatch(variant, gadmEntry.nameNormalized)) {
      return { entry: gadmEntry, score: 650 };
    }
  }
  return null;
}

function pickBetter(current: ScoredEntry | null, candidate: ScoredEntry | null): ScoredEntry | null {
  if (!candidate) return current;
  if (!current || candidate.score > current.score) return candidate;
  return current;
}

/**
 * Try matching a single WV name against a specific set of GADM divisions (in-memory).
 * Returns the best match or null.
 */
function findBestAmongChildren(
  wvName: string,
  gadmChildren: DivisionEntry[],
): ScoredEntry | null {
  const variants = getNameVariants(cleanWvName(wvName));
  let best: ScoredEntry | null = null;

  for (const gadmEntry of gadmChildren) {
    best = pickBetter(best, exactNameMatch(gadmEntry, variants));
    if (best) continue;
    best = pickBetter(best, variantNameMatch(gadmEntry, variants));
    if (best) continue;
    best = pickBetter(best, prefixNameMatch(gadmEntry, variants));
  }

  return best;
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

function appendToMapList<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

interface ParsedDivisions {
  divisionsById: Map<number, DivisionEntry>;
  divisionsByNormalizedName: Map<string, DivisionEntry[]>;
  continentIds: Set<number>;
}

function parseDivisionRows(rows: Array<Record<string, unknown>>): ParsedDivisions {
  const divisionsById = new Map<number, DivisionEntry>();
  const divisionsByNormalizedName = new Map<string, DivisionEntry[]>();
  const continentIds = new Set<number>();

  for (const row of rows) {
    const entry: DivisionEntry = {
      id: row.id as number,
      name: row.name as string,
      nameNormalized: (row.name_normalized as string) ?? normalizeName(row.name as string),
      parentId: row.parent_id as number | null,
    };
    divisionsById.set(entry.id, entry);
    appendToMapList(divisionsByNormalizedName, entry.nameNormalized, entry);
    if (entry.parentId === null) continentIds.add(entry.id);
  }
  return { divisionsById, divisionsByNormalizedName, continentIds };
}

function buildChildrenLookup(divisionsById: Map<number, DivisionEntry>): Map<number, number[]> {
  const childrenOf = new Map<number, number[]>();
  for (const entry of divisionsById.values()) {
    if (entry.parentId !== null) appendToMapList(childrenOf, entry.parentId, entry.id);
  }
  return childrenOf;
}

function identifyCountryIds(
  divisionsById: Map<number, DivisionEntry>,
  continentIds: Set<number>,
  childrenOf: Map<number, number[]>,
): Set<number> {
  const countryIds = new Set<number>();
  for (const entry of divisionsById.values()) {
    if (entry.parentId !== null && continentIds.has(entry.parentId)) {
      countryIds.add(entry.id);
    }
  }
  // Root entries with no country children are themselves countries — GADM puts
  // Australia at the root (no parent) alongside continents.
  for (const cid of continentIds) {
    const children = childrenOf.get(cid);
    if (!children || children.every(ch => !countryIds.has(ch))) {
      countryIds.add(cid);
    }
  }
  return countryIds;
}

function buildCountryNameIndex(
  divisionsById: Map<number, DivisionEntry>,
  countryIds: Set<number>,
): Map<string, number[]> {
  const gadmCountries = new Map<string, number[]>();
  for (const countryId of countryIds) {
    const entry = divisionsById.get(countryId)!;
    appendToMapList(gadmCountries, entry.nameNormalized, entry.id);

    const stripped = entry.nameNormalized.replace(STRIP_SUFFIX_REGEX, '').trim();
    if (stripped === entry.nameNormalized) continue;

    const existingStripped = gadmCountries.get(stripped);
    if (existingStripped) {
      if (!existingStripped.includes(entry.id)) existingStripped.push(entry.id);
    } else {
      gadmCountries.set(stripped, [entry.id]);
    }
  }
  return gadmCountries;
}

function buildCountryDescendants(
  countryIds: Set<number>,
  childrenOf: Map<number, number[]>,
): Map<number, Set<number>> {
  const countryDescendants = new Map<number, Set<number>>();
  for (const countryId of countryIds) {
    const descendants = new Set<number>([countryId]);
    const queue = [countryId];
    while (queue.length > 0) {
      const current = queue.pop()!;
      const children = childrenOf.get(current);
      if (!children) continue;
      for (const childId of children) {
        descendants.add(childId);
        queue.push(childId);
      }
    }
    countryDescendants.set(countryId, descendants);
  }
  return countryDescendants;
}

/** Pre-load all GADM division data into memory */
async function loadGADMData(): Promise<GADMData> {
  const allDivisionsResult = await pool.query(`
    SELECT id, name, name_normalized, parent_id
    FROM administrative_divisions
  `);

  const { divisionsById, divisionsByNormalizedName, continentIds } =
    parseDivisionRows(allDivisionsResult.rows as Array<Record<string, unknown>>);
  const childrenOf = buildChildrenLookup(divisionsById);
  const countryIds = identifyCountryIds(divisionsById, continentIds, childrenOf);
  const gadmCountries = buildCountryNameIndex(divisionsById, countryIds);
  const countryDescendants = buildCountryDescendants(countryIds, childrenOf);

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
interface MatchUpdate {
  id: number;
  matchStatus: MatchStatus;
  suggestions: MatchSuggestion[];
  divisionId?: number;
}

function buildSuggestionFor(id: number, gadm: GADMData, score = 700): MatchSuggestion {
  const entry = gadm.divisionsById.get(id)!;
  const path = getPath(id, gadm.pathCache, gadm.divisionsById);
  return { divisionId: id, name: entry.name, path, score };
}

function lookupCountryByName(name: string, gadm: GADMData): number[] {
  const variants = getNameVariants(cleanWvName(name));
  for (const variant of variants) {
    const ids = gadm.gadmCountries.get(variant);
    if (ids && ids.length > 0) return ids;
  }
  return [];
}

function buildFallbackSuggestions(name: string, gadm: GADMData): MatchSuggestion[] {
  const variants = getNameVariants(cleanWvName(name));
  const seen = new Set<number>();
  const suggestions: MatchSuggestion[] = [];
  for (const variant of variants) {
    const matches = gadm.divisionsByNormalizedName.get(variant);
    if (!matches) continue;
    for (const entry of matches) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      suggestions.push(buildSuggestionFor(entry.id, gadm));
    }
  }
  if (suggestions.length > 1) {
    for (const s of suggestions) s.score = 500;
  }
  return suggestions.slice(0, 5);
}

function pushAutoMatchedCountry(
  childId: number,
  countryId: number,
  gadm: GADMData,
  updates: MatchUpdate[],
): void {
  updates.push({
    id: childId,
    matchStatus: 'auto_matched',
    suggestions: [buildSuggestionFor(countryId, gadm)],
    divisionId: countryId,
  });
}

async function tryGrandchildrenDrillDown(
  childId: number,
  countryId: number,
  gadm: GADMData,
  updates: MatchUpdate[],
): Promise<boolean> {
  const gadmChildIds = gadm.childrenOf.get(countryId);
  if (!gadmChildIds || gadmChildIds.length === 0) return false;

  const gcResult = await pool.query(
    `SELECT id, name FROM regions WHERE parent_region_id = $1 ORDER BY name`,
    [childId],
  );
  const gadmChildren = gadmChildIds.map(id => gadm.divisionsById.get(id)!).filter(Boolean);
  const matches = new Map<number, ScoredEntry>();
  for (const gc of gcResult.rows) {
    const best = findBestAmongChildren(gc.name as string, gadmChildren);
    if (best && best.score >= 700) {
      matches.set(gc.id as number, best);
    }
  }
  if (matches.size !== gcResult.rows.length) return false;

  updates.push({ id: childId, matchStatus: 'children_matched', suggestions: [] });
  for (const gc of gcResult.rows) {
    const m = matches.get(gc.id as number)!;
    updates.push({
      id: gc.id as number,
      matchStatus: 'auto_matched',
      suggestions: [buildSuggestionFor(m.entry.id, gadm, m.score)],
      divisionId: m.entry.id,
    });
  }
  return true;
}

function pushFallbackOrNoCandidates(
  childId: number,
  fallbackSuggestions: MatchSuggestion[],
  updates: MatchUpdate[],
): boolean {
  if (fallbackSuggestions.length === 0) {
    updates.push({ id: childId, matchStatus: 'no_candidates', suggestions: [] });
    return false;
  }
  if (fallbackSuggestions.length === 1 && fallbackSuggestions[0].score >= 700) {
    updates.push({
      id: childId,
      matchStatus: 'auto_matched',
      suggestions: fallbackSuggestions,
      divisionId: fallbackSuggestions[0].divisionId,
    });
    return true;
  }
  updates.push({ id: childId, matchStatus: 'needs_review', suggestions: fallbackSuggestions });
  return false;
}

interface ChildRowForRematch {
  id: number;
  name: string;
  has_children: boolean;
}

async function rematchChildAsCountry(
  child: ChildRowForRematch,
  gadm: GADMData,
  updates: MatchUpdate[],
): Promise<boolean> {
  const countryMatchIds = lookupCountryByName(child.name, gadm);

  if (countryMatchIds.length === 1) {
    const countryId = countryMatchIds[0];
    if (!child.has_children) {
      pushAutoMatchedCountry(child.id, countryId, gadm, updates);
      return true;
    }
    const drilled = await tryGrandchildrenDrillDown(child.id, countryId, gadm, updates);
    if (!drilled) {
      pushAutoMatchedCountry(child.id, countryId, gadm, updates);
    }
    return true;
  }

  if (countryMatchIds.length > 1) {
    updates.push({
      id: child.id,
      matchStatus: 'needs_review',
      suggestions: countryMatchIds.map(id => buildSuggestionFor(id, gadm)),
    });
    return false;
  }

  return pushFallbackOrNoCandidates(child.id, buildFallbackSuggestions(child.name, gadm), updates);
}

async function writeRematchUpdates(
  regionId: number,
  updates: MatchUpdate[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear parent's own match and mark as children_matched.
    await client.query(`DELETE FROM region_members WHERE region_id = $1`, [regionId]);
    await client.query(
      `UPDATE region_import_state SET match_status = 'children_matched' WHERE region_id = $1`,
      [regionId],
    );
    await client.query(`DELETE FROM region_match_suggestions WHERE region_id = $1`, [regionId]);

    for (const update of updates) {
      await client.query(
        `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
        [update.matchStatus, update.id],
      );
      await client.query(
        `DELETE FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
        [update.id],
      );
      for (const s of update.suggestions) {
        await client.query(
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score)
           VALUES ($1, $2, $3, $4, $5)`,
          [update.id, s.divisionId, s.name, s.path, s.score],
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

export async function matchChildrenAsCountries(
  worldViewId: number,
  regionId: number,
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

  const updates: MatchUpdate[] = [];
  let matched = 0;

  for (const row of childResult.rows as ChildRowForRematch[]) {
    if (await rematchChildAsCountry(row, gadm, updates)) matched++;
  }

  await writeRematchUpdates(regionId, updates);

  console.log(`[WV Matcher] matchChildrenAsCountries: region ${regionId} — ${matched}/${childResult.rows.length} children matched`);
  return { matched, total: childResult.rows.length };
}

// ─── Legacy leaf-level matcher ───────────────────────────────────────────────

interface RegionRow { id: number; name: string; is_leaf: boolean }

async function loadRegionsAndAncestors(worldViewId: number): Promise<{
  allRegions: RegionRow[];
  ancestorsByRegionId: Map<number, string[]>;
}> {
  const regionResult = await pool.query(`
    SELECT id, name, is_leaf FROM regions
    WHERE world_view_id = $1
    ORDER BY id
  `, [worldViewId]);

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
  return {
    allRegions: regionResult.rows as RegionRow[],
    ancestorsByRegionId,
  };
}

function findCountryFromAncestors(ancestorNames: string[], gadm: GADMData): number | null {
  for (const name of ancestorNames) {
    const variants = getNameVariants(name);
    for (const variant of variants) {
      const ids = gadm.gadmCountries.get(variant);
      if (ids && ids.length > 0) return ids[0];
    }
  }
  return null;
}

function classifyLeafCandidates(
  region: RegionRow,
  candidates: MatchSuggestion[],
  progress: ImportProgress,
): MatchUpdate {
  if (candidates.length === 1 && candidates[0].score >= 700) {
    progress.countriesMatched++;
    return {
      id: region.id,
      matchStatus: 'auto_matched',
      suggestions: candidates,
      divisionId: candidates[0].divisionId,
    };
  }
  if (candidates.length > 0) {
    return { id: region.id, matchStatus: 'needs_review', suggestions: candidates };
  }
  progress.noCandidates++;
  return { id: region.id, matchStatus: 'no_candidates', suggestions: [] };
}

async function writePlainMatchUpdates(updates: MatchUpdate[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const update of updates) {
      await client.query(
        `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
        [update.matchStatus, update.id],
      );
      for (const s of update.suggestions) {
        await client.query(
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score)
           VALUES ($1, $2, $3, $4, $5)`,
          [update.id, s.divisionId, s.name, s.path, s.score],
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

  progress.statusMessage = 'Loading GADM divisions into memory...';
  console.log('[WV Matcher] Loading all divisions into memory...');
  const gadm = await loadGADMData();
  console.log(`[WV Matcher] Loaded ${gadm.divisionsById.size} divisions, ${gadm.countryIds.size} countries`);

  progress.statusMessage = 'Loading regions and ancestor paths...';
  const { allRegions, ancestorsByRegionId } = await loadRegionsAndAncestors(worldViewId);

  const leafCount = allRegions.filter(r => r.is_leaf).length;
  progress.totalCountries = leafCount; // legacy: use totalCountries for leaf count
  progress.statusMessage = `Matching ${allRegions.length} regions (${leafCount} leaves)...`;
  console.log(`[WV Matcher] Pre-loading complete. Found ${allRegions.length} regions (${leafCount} leaves) to match`);

  const updates: MatchUpdate[] = [];

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

    const ancestorNames = ancestorsByRegionId.get(region.id) ?? [region.name];
    const countryId = findCountryFromAncestors(ancestorNames, gadm);
    const descendantSet = countryId ? gadm.countryDescendants.get(countryId) ?? null : null;
    const candidates = await findCandidatesOptimized(region.name, countryId, descendantSet, gadm);

    if (region.is_leaf) {
      updates.push(classifyLeafCandidates(region, candidates, progress));
    } else if (candidates.length > 0) {
      updates.push({ id: region.id, matchStatus: 'suggested', suggestions: candidates });
    }
  }

  progress.statusMessage = 'Writing match results...';
  await writePlainMatchUpdates(updates);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[WV Matcher] All done in ${totalTime}s: auto=${progress.countriesMatched}, none=${progress.noCandidates}`);
}

function addExactMatchCandidates(
  variant: string,
  descendantSet: Set<number> | null,
  gadm: GADMData,
  candidates: Map<number, MatchSuggestion>,
): void {
  const exactMatches = gadm.divisionsByNormalizedName.get(variant);
  if (!exactMatches) return;
  for (const entry of exactMatches) {
    if (candidates.has(entry.id)) continue;
    let score = 400;
    if (descendantSet?.has(entry.id)) score += 300;
    candidates.set(entry.id, { divisionId: entry.id, name: entry.name, path: '', score });
  }
}

async function addTrigramMatchCandidates(
  variant: string,
  descendantSet: Set<number> | null,
  candidates: Map<number, MatchSuggestion>,
): Promise<void> {
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
    candidates.set(id, { divisionId: id, name: row.name as string, path: '', score });
  }
}

function preferInCountryCandidates(
  candidateList: MatchSuggestion[],
  descendantSet: Set<number> | null,
): MatchSuggestion[] {
  if (!descendantSet) return candidateList;
  const inCountry = candidateList.filter(c => descendantSet.has(c.divisionId));
  if (inCountry.length === 0) return candidateList;
  if (inCountry.length === 1) inCountry[0].score += 50;
  return inCountry;
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
  const candidates = new Map<number, MatchSuggestion>();

  for (const variant of getNameVariants(regionName)) {
    addExactMatchCandidates(variant, descendantSet, gadm, candidates);
    if (candidates.size < 5) {
      await addTrigramMatchCandidates(variant, descendantSet, candidates);
    }
  }

  let candidateList = Array.from(candidates.values());
  if (countryDivisionId) {
    candidateList = preferInCountryCandidates(candidateList, descendantSet);
  }
  if (candidateList.length === 1) candidateList[0].score += 50;

  for (const c of candidateList) {
    c.path = getPath(c.divisionId, gadm.pathCache, gadm.divisionsById);
  }

  return candidateList.sort((a, b) => b.score - a.score).slice(0, 5);
}
