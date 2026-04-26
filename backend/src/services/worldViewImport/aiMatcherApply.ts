/**
 * AI Matcher — Apply AI Results to Database
 *
 * Resolves AI-suggested division names to GADM division IDs (exact match + trigram fallback),
 * writes suggestions and match status updates in a transaction.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../db/index.js';
import type { MatchSuggestion, MatchStatus, AIMatchProgress, AIMatchResult } from './types.js';

// Geographic suffixes that the AI often appends but GADM omits
// (e.g., "Donetsk Oblast" vs GADM's "Donets'k"). Matched case-insensitively.
const GEOGRAPHIC_SUFFIXES = [
  'oblast',
  'region',
  'province',
  'state',
  'prefecture',
  'republic',
  'territory',
  'district',
  'krai',
  'raion',
  'rayon',
  'county',
  'department',
  'governorate',
  'wilaya',
  'muhafazah',
];
const GEOGRAPHIC_SUFFIX_SET = new Set(GEOGRAPHIC_SUFFIXES);

/**
 * Clean an AI-provided name: strip a trailing parenthetical qualifier
 * (e.g., "Shida Kartli (partial)" → "Shida Kartli") and surrounding whitespace.
 * Uses plain string ops instead of a regex to avoid super-linear backtracking
 * risks on untrusted inputs.
 */
function cleanAiName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed.endsWith(')')) return trimmed;
  const openIdx = trimmed.lastIndexOf('(');
  if (openIdx <= 0) return trimmed;
  return trimmed.slice(0, openIdx).trim();
}

/** Strip geographic suffixes so "Donetsk Oblast" matches GADM's "Donets'k". */
function stripGeographicSuffix(name: string): string {
  const trimmed = name.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace < 0) return trimmed;
  const suffix = trimmed.slice(lastSpace + 1).toLowerCase();
  if (GEOGRAPHIC_SUFFIX_SET.has(suffix)) {
    return trimmed.slice(0, lastSpace).trim();
  }
  return trimmed;
}

/** Build the list of names to try from a primary + alternatives, cleaned and non-empty. */
function buildNamesToTry(primary: string, alternatives: string[]): string[] {
  return [primary, ...alternatives]
    .map(cleanAiName)
    .filter(n => n.length > 0);
}

/** Pick the first non-rejected ID from query rows, or null. */
function pickFirstNonRejected(
  rows: Array<{ id: number }>,
  rejected: Set<number>,
): number | null {
  for (const row of rows) {
    const foundId = row.id;
    if (!rejected.has(foundId)) return foundId;
  }
  return null;
}

/** Exact normalized match preferring higher-level (shallower) divisions. */
async function exactLookup(
  client: PoolClient,
  names: string[],
  rejected: Set<number>,
): Promise<number | null> {
  for (const name of names) {
    const cleaned = stripGeographicSuffix(name);
    const lookup = await client.query<{ id: number }>(
      `WITH matches AS (
        SELECT id,
          (WITH RECURSIVE anc AS (
            SELECT parent_id FROM administrative_divisions WHERE id = ad.id
            UNION ALL
            SELECT d.parent_id FROM administrative_divisions d JOIN anc ON d.id = anc.parent_id
          ) SELECT COUNT(*) FROM anc WHERE parent_id IS NOT NULL) AS depth
        FROM administrative_divisions ad
        WHERE replace(replace(name_normalized, '''', ''), '-', ' ') = replace(replace(lower(immutable_unaccent($1)), '''', ''), '-', ' ')
      )
      SELECT id FROM matches ORDER BY depth ASC`,
      [cleaned],
    );
    const found = pickFirstNonRejected(lookup.rows, rejected);
    if (found != null) return found;
  }
  return null;
}

/** Trigram similarity fallback (handles "Ingushetia"→"Ingush", etc.). */
async function trigramLookup(
  client: PoolClient,
  names: string[],
  rejected: Set<number>,
): Promise<number | null> {
  for (const name of names) {
    const lookup = await client.query<{ id: number }>(
      `SELECT id, name FROM administrative_divisions
       WHERE name_normalized % lower(immutable_unaccent($1))
         AND similarity(name_normalized, lower(immutable_unaccent($1))) > 0.4
       ORDER BY similarity(name_normalized, lower(immutable_unaccent($1))) DESC
       LIMIT 5`,
      [name],
    );
    const found = pickFirstNonRejected(lookup.rows, rejected);
    if (found != null) return found;
  }
  return null;
}

/** Resolve a set of names to a single division ID, using exact then trigram lookup. */
async function resolveDivisionId(
  client: PoolClient,
  names: string[],
  rejected: Set<number>,
): Promise<number | null> {
  const exact = await exactLookup(client, names, rejected);
  if (exact != null) return exact;
  return trigramLookup(client, names, rejected);
}

/** Load rejected division IDs for a region. */
async function loadRejectedDivisionIds(
  client: PoolClient,
  regionId: number,
): Promise<Set<number>> {
  const rejectedResult = await client.query<{ division_id: number }>(
    `SELECT division_id FROM region_match_suggestions WHERE region_id = $1 AND rejected = true`,
    [regionId],
  );
  return new Set(rejectedResult.rows.map(r => r.division_id));
}

/** Load the region's `is_leaf` flag, or null if the region doesn't exist in this world view. */
async function loadRegionLeafFlag(
  client: PoolClient,
  regionId: number,
  worldViewId: number,
): Promise<boolean | null> {
  const check = await client.query<{ is_leaf: boolean }>(
    `SELECT r.id, r.is_leaf
     FROM regions r WHERE r.id = $1 AND r.world_view_id = $2`,
    [regionId, worldViewId],
  );
  if (check.rows.length === 0) return null;
  return check.rows[0].is_leaf;
}

/** Collect the full list of division IDs (primary + additional) to suggest for a result. */
async function collectDivisionIds(
  client: PoolClient,
  result: AIMatchResult,
  rejected: Set<number>,
): Promise<number[]> {
  let primaryId = result.divisionId;

  // Resolve primary name if no ID was provided
  if (!primaryId && result.divisionName) {
    const names = buildNamesToTry(result.divisionName, result.alternativeNames);
    primaryId = await resolveDivisionId(client, names, rejected);
  }

  const divisionIds: number[] = [];
  if (primaryId && !rejected.has(primaryId)) {
    divisionIds.push(primaryId);
  }

  // Resolve any additional divisions (multi-division regions like Donbas = Donetsk + Luhansk)
  for (const addDiv of result.additionalDivisions) {
    const addNames = buildNamesToTry(addDiv.name, addDiv.alternativeNames);
    const addId = await resolveDivisionId(client, addNames, rejected);
    if (addId && !divisionIds.includes(addId)) {
      divisionIds.push(addId);
    }
  }

  return divisionIds;
}

/** Decide the match status based on leaf-ness and AI confidence. */
function decideMatchStatus(
  isLeaf: boolean,
  autoAssign: boolean,
  result: AIMatchResult,
  divisionCount: number,
): MatchStatus {
  if (!isLeaf) return 'suggested';
  if (autoAssign && result.confidence === 'high' && divisionCount === 1) {
    return 'auto_matched';
  }
  return 'needs_review';
}

/** Build match suggestions (with name + path) for the resolved division IDs. */
async function buildSuggestions(
  client: PoolClient,
  divisionIds: number[],
  confidence: AIMatchResult['confidence'],
): Promise<MatchSuggestion[]> {
  const score = confidence === 'high' ? 900 : 600;
  const suggestions: MatchSuggestion[] = [];
  for (const dId of divisionIds) {
    const divResult = await client.query<{ name: string; path: string }>(
      `SELECT ad.name,
        (
          WITH RECURSIVE div_ancestors AS (
            SELECT ad.id, ad.name, ad.parent_id
            UNION ALL
            SELECT d.id, d.name, d.parent_id
            FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.parent_id
          )
          SELECT string_agg(name, ' > ' ORDER BY id) FROM div_ancestors
        ) AS path
      FROM administrative_divisions ad WHERE ad.id = $1`,
      [dId],
    );
    if (divResult.rows.length === 0) continue;
    suggestions.push({
      divisionId: dId,
      name: divResult.rows[0].name,
      path: divResult.rows[0].path,
      score,
    });
  }
  return suggestions;
}

/** Load the set of division IDs already suggested (un-rejected) or assigned to this region. */
async function loadExistingDivisionIds(
  client: PoolClient,
  regionId: number,
): Promise<Set<number>> {
  const existing = await client.query<{ division_id: number }>(
    `SELECT division_id FROM region_match_suggestions WHERE region_id = $1 AND rejected = false
     UNION
     SELECT division_id FROM region_members WHERE region_id = $1`,
    [regionId],
  );
  return new Set(existing.rows.map(r => r.division_id));
}

/** Insert suggestions that are not already present. */
async function insertNewSuggestions(
  client: PoolClient,
  regionId: number,
  suggestions: MatchSuggestion[],
  existingIds: Set<number>,
): Promise<void> {
  for (const s of suggestions) {
    if (!existingIds.has(s.divisionId)) {
      await client.query(
        `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score)
         VALUES ($1, $2, $3, $4, $5)`,
        [regionId, s.divisionId, s.name, s.path, s.score],
      );
    }
  }
}

/** Process a single AI result: resolve, suggest, update status, optionally auto-assign. */
async function processSingleResult(
  client: PoolClient,
  worldViewId: number,
  result: AIMatchResult,
  autoAssign: boolean,
  progress: AIMatchProgress,
): Promise<void> {
  const isLeaf = await loadRegionLeafFlag(client, result.regionId, worldViewId);
  if (isLeaf == null) return;

  const rejected = await loadRejectedDivisionIds(client, result.regionId);
  const divisionIds = await collectDivisionIds(client, result, rejected);
  if (divisionIds.length === 0) return;

  const newStatus = decideMatchStatus(isLeaf, autoAssign, result, divisionIds.length);
  const aiSuggestions = await buildSuggestions(client, divisionIds, result.confidence);
  if (aiSuggestions.length === 0) return;

  const existingIds = await loadExistingDivisionIds(client, result.regionId);
  await insertNewSuggestions(client, result.regionId, aiSuggestions, existingIds);

  await client.query(
    `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
    [newStatus, result.regionId],
  );

  // Auto-assign for high confidence single-match leaves only
  if (autoAssign && result.confidence === 'high' && isLeaf && divisionIds.length === 1) {
    await client.query(
      `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [result.regionId, divisionIds[0]],
    );
    progress.improved++;
  }
}

/**
 * Apply AI matching results to the database.
 *
 * For each result:
 * 1. Resolve division name → GADM ID (exact + trigram)
 * 2. Handle multi-division regions (additionalDivisions)
 * 3. Insert suggestions, update match status
 * 4. Auto-assign high-confidence single-match leaves
 */
export async function applyAIResults(
  worldViewId: number,
  results: AIMatchResult[],
  progress: AIMatchProgress,
  autoAssign = true,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const result of results) {
      await processSingleResult(client, worldViewId, result, autoAssign, progress);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
