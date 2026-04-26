/**
 * WorldView Import Matcher — Shared Utilities
 *
 * Name normalization, GADM data loading, path building, and in-memory
 * matching helpers shared between country-level, legacy, and AI matchers.
 */

import { pool } from '../../db/index.js';

// ─── Name utilities ──────────────────────────────────────────────────────────

/** Common geographic suffixes (lowercase) to strip for fuzzy matching */
const STRIP_SUFFIXES: ReadonlySet<string> = new Set([
  'province', 'state', 'prefecture', 'oblast', 'county', 'district',
  'department', 'region', 'territory', 'governorate', 'municipality',
  'division', 'parish', 'canton', 'voivodeship', 'krai', 'republic',
  'autonomous', 'community', 'emirate', 'principality',
]);

/**
 * Strip a single trailing geographic suffix from a name.
 * Replaces the previous regex-based strip — the regex form had 21
 * alternations which triggered sonarjs/regex-complexity and
 * sonarjs/slow-regex warnings. This O(n) implementation is exactly
 * equivalent in behavior (case-insensitive, single trailing suffix after
 * whitespace).
 */
export function stripTrailingSuffix(name: string): string {
  const lastSpace = name.lastIndexOf(' ');
  if (lastSpace <= 0) return name;
  const tail = name.slice(lastSpace + 1);
  if (tail.length === 0) return name;
  if (STRIP_SUFFIXES.has(tail.toLowerCase())) {
    return name.slice(0, lastSpace);
  }
  return name;
}

/** Normalize a name for matching: lowercase, strip accents */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .trim();
}

/** Get name variants: original + suffix-stripped */
export function getNameVariants(name: string): string[] {
  const normalized = normalizeName(name);
  const stripped = stripTrailingSuffix(normalized).trim();
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
export function isPrefixMatch(a: string, b: string): boolean {
  // Ensure a is the shorter one
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  // Shorter must be at least 4 chars and at least 60% of the longer name's length
  if (shorter.length < 4 || shorter.length / longer.length < 0.6) return false;

  // For hyphenated names, check each part
  if (shorter.includes('-') && longer.includes('-')) {
    const sParts = shorter.split('-');
    const lParts = longer.split('-');
    if (sParts.length === lParts.length) {
      // eslint-disable-next-line security/detect-object-injection -- .every callback index into same-length string[] (split on same delimiter)
      return sParts.every((sp, i) => lParts[i].startsWith(sp) || sp.startsWith(lParts[i]));
    }
  }

  return longer.startsWith(shorter);
}

/** Clean an import region name: strip parenthetical annotations like "(USA)" */
export function cleanWvName(name: string): string {
  // Use indexOf+slice to avoid the greedy regex `\s*\(.*$` flagged by
  // sonarjs/slow-regex. Behavior is identical: anything from the first "("
  // onward is dropped, leading whitespace before it is trimmed.
  const parenIdx = name.indexOf('(');
  if (parenIdx < 0) return name.trim();
  return name.slice(0, parenIdx).trim();
}

// ─── Pre-loaded data structures ──────────────────────────────────────────────

export interface DivisionEntry {
  id: number;
  name: string;
  nameNormalized: string;
  parentId: number | null;
}

/** Pre-computed division path cache */
export type PathCache = Map<number, string>;

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
export function getPath(divisionId: number, pathCache: PathCache, divisionsById: Map<number, DivisionEntry>): string {
  let path = pathCache.get(divisionId);
  if (path === undefined) {
    path = buildPath(divisionId, divisionsById);
    pathCache.set(divisionId, path);
  }
  return path;
}

/** Check if any WV variant matches the GADM entry's normalized name exactly. */
function findExactMatch(
  variants: readonly string[],
  gadmEntry: DivisionEntry,
): { entry: DivisionEntry; score: number } | null {
  for (const variant of variants) {
    if (gadmEntry.nameNormalized === variant) {
      return { entry: gadmEntry, score: 700 };
    }
  }
  return null;
}

/** Check if any WV variant matches any GADM-name variant (suffix-stripped both sides). */
function findVariantMatch(
  variants: readonly string[],
  gadmEntry: DivisionEntry,
): { entry: DivisionEntry; score: number } | null {
  const gadmVariants = getNameVariants(gadmEntry.name);
  for (const gv of gadmVariants) {
    if (variants.includes(gv)) {
      return { entry: gadmEntry, score: 650 };
    }
  }
  return null;
}

/** Check if any WV variant is a prefix-match of the GADM normalized name. */
function findPrefixMatchEntry(
  variants: readonly string[],
  gadmEntry: DivisionEntry,
): { entry: DivisionEntry; score: number } | null {
  for (const variant of variants) {
    if (isPrefixMatch(variant, gadmEntry.nameNormalized)) {
      return { entry: gadmEntry, score: 650 };
    }
  }
  return null;
}

/**
 * Try matching a single WV name against a specific set of GADM divisions (in-memory).
 * Returns the best match or null.
 *
 * Priority: exact (700) > variant (650) > prefix (650). Within the same tier,
 * the first match wins (scanning gadmChildren in order).
 */
export function findBestAmongChildren(
  wvName: string,
  gadmChildren: DivisionEntry[],
): { entry: DivisionEntry; score: number } | null {
  const cleaned = cleanWvName(wvName);
  const variants = getNameVariants(cleaned);

  let bestMatch: { entry: DivisionEntry; score: number } | null = null;

  for (const gadmEntry of gadmChildren) {
    const exact = findExactMatch(variants, gadmEntry);
    if (exact && (!bestMatch || exact.score > bestMatch.score)) {
      bestMatch = exact;
      continue;
    }
    if (bestMatch) continue;

    const variantMatch = findVariantMatch(variants, gadmEntry);
    if (variantMatch) {
      bestMatch = variantMatch;
      continue;
    }

    const prefixMatch = findPrefixMatchEntry(variants, gadmEntry);
    if (prefixMatch) {
      bestMatch = prefixMatch;
    }
  }

  return bestMatch;
}

/** Loaded GADM data shared between matchers */
export interface GADMData {
  divisionsById: Map<number, DivisionEntry>;
  divisionsByNormalizedName: Map<string, DivisionEntry[]>;
  gadmCountries: Map<string, number[]>;
  childrenOf: Map<number, number[]>;
  countryIds: Set<number>;
  countryDescendants: Map<number, Set<number>>;
  pathCache: PathCache;
}

/** Append a value to a keyed array-map, creating the array if missing. */
function pushToMapArray<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

/** Index raw DB rows into the division + normalized-name lookups and collect roots. */
function indexRawDivisions(
  rows: Array<{ id: number; name: string; name_normalized: string | null; parent_id: number | null }>,
  divisionsById: Map<number, DivisionEntry>,
  divisionsByNormalizedName: Map<string, DivisionEntry[]>,
  continentIds: Set<number>,
): void {
  for (const row of rows) {
    const entry: DivisionEntry = {
      id: row.id,
      name: row.name,
      nameNormalized: row.name_normalized ?? normalizeName(row.name),
      parentId: row.parent_id,
    };
    divisionsById.set(entry.id, entry);
    pushToMapArray(divisionsByNormalizedName, entry.nameNormalized, entry);
    if (entry.parentId === null) {
      continentIds.add(entry.id);
    }
  }
}

/** Build a parent-id → child-ids map from the divisions map. */
function buildChildrenOf(divisionsById: Map<number, DivisionEntry>): Map<number, number[]> {
  const childrenOf = new Map<number, number[]>();
  for (const entry of divisionsById.values()) {
    if (entry.parentId !== null) {
      pushToMapArray(childrenOf, entry.parentId, entry.id);
    }
  }
  return childrenOf;
}

/**
 * Identify country IDs. Children of continents are countries; root-level
 * entries whose direct children are NOT countries (e.g. Australia with states
 * directly) are themselves treated as countries.
 */
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
  for (const cid of continentIds) {
    const children = childrenOf.get(cid);
    if (!children || children.every(ch => !countryIds.has(ch))) {
      countryIds.add(cid);
    }
  }
  return countryIds;
}

/** Build normalized-name → country-ids lookup, including suffix-stripped keys. */
function buildGadmCountryNameIndex(
  countryIds: Set<number>,
  divisionsById: Map<number, DivisionEntry>,
): Map<string, number[]> {
  const gadmCountries = new Map<string, number[]>();
  for (const countryId of countryIds) {
    const entry = divisionsById.get(countryId)!;
    pushToMapArray(gadmCountries, entry.nameNormalized, entry.id);

    const stripped = stripTrailingSuffix(entry.nameNormalized).trim();
    if (stripped !== entry.nameNormalized) {
      const existingStripped = gadmCountries.get(stripped);
      if (existingStripped) {
        if (!existingStripped.includes(entry.id)) existingStripped.push(entry.id);
      } else {
        gadmCountries.set(stripped, [entry.id]);
      }
    }
  }
  return gadmCountries;
}

/** For each country, collect all descendant IDs (including itself) via BFS. */
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
      if (children) {
        for (const childId of children) {
          descendants.add(childId);
          queue.push(childId);
        }
      }
    }
    countryDescendants.set(countryId, descendants);
  }
  return countryDescendants;
}

/** Pre-load all GADM division data into memory */
export async function loadGADMData(): Promise<GADMData> {
  const allDivisionsResult = await pool.query(`
    SELECT id, name, name_normalized, parent_id
    FROM administrative_divisions
  `);

  const divisionsById = new Map<number, DivisionEntry>();
  const divisionsByNormalizedName = new Map<string, DivisionEntry[]>();
  const continentIds = new Set<number>();

  indexRawDivisions(
    allDivisionsResult.rows,
    divisionsById,
    divisionsByNormalizedName,
    continentIds,
  );

  const childrenOf = buildChildrenOf(divisionsById);
  const countryIds = identifyCountryIds(divisionsById, continentIds, childrenOf);
  const gadmCountries = buildGadmCountryNameIndex(countryIds, divisionsById);
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
