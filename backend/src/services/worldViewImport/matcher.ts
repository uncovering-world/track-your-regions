/**
 * WorldView Import Matcher
 *
 * matchCountryLevel(): walks the import tree to find country-level nodes that match
 * GADM countries. If all subregions of a matched country also match GADM direct
 * subdivisions, assigns at the subdivision level instead.
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

  return {
    divisionsById,
    divisionsByNormalizedName,
    gadmCountries,
    childrenOf,
    countryIds,
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
    isWorkUnit?: boolean;
    referenceDivisionIds?: number[];
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
        isWorkUnit: true,
        referenceDivisionIds: [gadmCountryId],
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
        isWorkUnit: true,
        referenceDivisionIds: [gadmCountryId],
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
        isWorkUnit: true,
        referenceDivisionIds: [gadmCountryId],
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
        isWorkUnit: true,
        referenceDivisionIds: [countryId],
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
      isWorkUnit: true,
      referenceDivisionIds: countryIds,
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
      // Update match status in region_import_state — persist work-unit flags
      // additively so a re-run never clears curator-set values (COALESCE).
      await client.query(
        `UPDATE region_import_state
         SET match_status = $1,
             is_work_unit = COALESCE($3, is_work_unit),
             reference_division_ids = COALESCE($4, reference_division_ids)
         WHERE region_id = $2`,
        [update.matchStatus, update.id, update.isWorkUnit ?? null, update.referenceDivisionIds ?? null],
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

function buildSuggestionFor(id: number, gadm: GADMData, score = 700): MatchSuggestion {
  const entry = gadm.divisionsById.get(id)!;
  const path = getPath(id, gadm.pathCache, gadm.divisionsById);
  return { divisionId: id, name: entry.name, path, score };
}

