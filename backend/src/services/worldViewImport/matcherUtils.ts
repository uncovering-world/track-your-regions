/**
 * WorldView Import Matcher — Shared Utilities
 *
 * Name normalization, GADM data loading, and in-memory matching helpers
 * shared between country-level and legacy leaf-level matchers.
 */

import { pool } from '../../db/index.js';

// ─── Name utilities ──────────────────────────────────────────────────────────

/** Common geographic suffixes to strip for fuzzy matching */
export const STRIP_SUFFIX_REGEX = /\s+(Province|State|Prefecture|Oblast|County|District|Department|Region|Territory|Governorate|Municipality|Division|Parish|Canton|Voivodeship|Krai|Republic|Autonomous|Community|Emirate|Principality)$/i;

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
      return sParts.every((sp, i) => lParts[i].startsWith(sp) || sp.startsWith(lParts[i]));
    }
  }

  return longer.startsWith(shorter);
}

/** Clean an import region name: strip parenthetical annotations like "(USA)" */
export function cleanWvName(name: string): string {
  return name.replace(/\s*\(.*$/, '').trim();
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

/**
 * Try matching a single WV name against a specific set of GADM divisions (in-memory).
 * Returns the best match or null.
 */
export function findBestAmongChildren(
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
export interface GADMData {
  divisionsById: Map<number, DivisionEntry>;
  divisionsByNormalizedName: Map<string, DivisionEntry[]>;
  gadmCountries: Map<string, number[]>;
  childrenOf: Map<number, number[]>;
  countryIds: Set<number>;
  countryDescendants: Map<number, Set<number>>;
  pathCache: PathCache;
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
