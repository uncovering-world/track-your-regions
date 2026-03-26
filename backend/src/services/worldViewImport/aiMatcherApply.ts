/**
 * AI Matcher — Apply AI Results to Database
 *
 * Resolves AI-suggested division names to GADM division IDs (exact match + trigram fallback),
 * writes suggestions and match status updates in a transaction.
 */

import { pool } from '../../db/index.js';
import type { MatchSuggestion, MatchStatus, AIMatchProgress, AIMatchResult } from './types.js';

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
      let divisionId = result.divisionId;

      // Load region info and rejected division IDs from region_match_suggestions
      const check = await client.query(
        `SELECT r.id, r.is_leaf
         FROM regions r WHERE r.id = $1 AND r.world_view_id = $2`,
        [result.regionId, worldViewId],
      );
      if (check.rows.length === 0) continue;

      const isLeaf = check.rows[0].is_leaf as boolean;

      const rejectedResult = await client.query(
        `SELECT division_id FROM region_match_suggestions WHERE region_id = $1 AND rejected = true`,
        [result.regionId],
      );
      const rejected = new Set<number>(rejectedResult.rows.map(r => r.division_id as number));

      // If AI suggested a name but no divisionId, look it up by trying
      // the primary name first, then each alternative name
      if (!divisionId && result.divisionName) {
        // Strip parenthetical qualifiers the AI may add (e.g., "Shida Kartli (partial)")
        const namesToTry = [result.divisionName, ...result.alternativeNames]
          .map(n => n.replace(/\s*\([^)]*\)$/, '').trim())
          .filter(n => n.length > 0);

        // 1. Try exact normalized match (prefer higher-level divisions when name is ambiguous)
        // Strip apostrophes and geographic suffixes (AI says "Donetsk Oblast", GADM has "Donets'k")
        for (const name of namesToTry) {
          const cleaned = name
            .replace(/\s+(Oblast|Region|Province|State|Prefecture|Republic|Territory|District|Krai|Raion|Rayon|County|Department|Governorate|Wilaya|Muhafazah)$/i, '')
            .trim();
          const lookup = await client.query(
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
          for (const row of lookup.rows) {
            const foundId = row.id as number;
            if (!rejected.has(foundId)) {
              divisionId = foundId;
              break;
            }
          }
          if (divisionId) break;
        }

        // 2. Trigram similarity fallback (handles "Ingushetia"→"Ingush", etc.)
        if (!divisionId) {
          for (const name of namesToTry) {
            const lookup = await client.query(
              `SELECT id, name FROM administrative_divisions
               WHERE name_normalized % lower(immutable_unaccent($1))
                 AND similarity(name_normalized, lower(immutable_unaccent($1))) > 0.4
               ORDER BY similarity(name_normalized, lower(immutable_unaccent($1))) DESC
               LIMIT 5`,
              [name],
            );
            for (const row of lookup.rows) {
              const foundId = row.id as number;
              if (!rejected.has(foundId)) {
                divisionId = foundId;
                break;
              }
            }
            if (divisionId) break;
          }
        }
      }

      // Collect all division IDs to suggest (primary + additional)
      const divisionIds: number[] = [];
      if (divisionId && !rejected.has(divisionId)) {
        divisionIds.push(divisionId);
      }

      // Look up additional divisions (multi-division regions like Donbas = Donetsk + Luhansk)
      for (const addDiv of result.additionalDivisions) {
        const addNames = [addDiv.name, ...addDiv.alternativeNames]
          .map(n => n.replace(/\s*\([^)]*\)$/, '').trim())
          .filter(n => n.length > 0);

        let addId: number | null = null;
        // Exact lookup (prefer higher-level divisions, strip apostrophes + suffixes)
        for (const name of addNames) {
          const cleaned = name
            .replace(/\s+(Oblast|Region|Province|State|Prefecture|Republic|Territory|District|Krai|Raion|Rayon|County|Department|Governorate|Wilaya|Muhafazah)$/i, '')
            .trim();
          const lookup = await client.query(
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
          for (const row of lookup.rows) {
            const foundId = row.id as number;
            if (!rejected.has(foundId)) { addId = foundId; break; }
          }
          if (addId) break;
        }
        // Trigram fallback
        if (!addId) {
          for (const name of addNames) {
            const lookup = await client.query(
              `SELECT id FROM administrative_divisions
               WHERE name_normalized % lower(immutable_unaccent($1))
                 AND similarity(name_normalized, lower(immutable_unaccent($1))) > 0.4
               ORDER BY similarity(name_normalized, lower(immutable_unaccent($1))) DESC
               LIMIT 5`,
              [name],
            );
            for (const row of lookup.rows) {
              const foundId = row.id as number;
              if (!rejected.has(foundId)) { addId = foundId; break; }
            }
            if (addId) break;
          }
        }
        if (addId && !divisionIds.includes(addId)) {
          divisionIds.push(addId);
        }
      }

      if (divisionIds.length === 0) continue;

      // Determine new match status
      const newStatus: MatchStatus = !isLeaf
        ? 'suggested'
        : (autoAssign && result.confidence === 'high' && divisionIds.length === 1) ? 'auto_matched' : 'needs_review';

      // Build suggestions for all found divisions
      const aiSuggestions: MatchSuggestion[] = [];
      for (const dId of divisionIds) {
        const divResult = await client.query(`
          SELECT ad.name,
            (
              WITH RECURSIVE div_ancestors AS (
                SELECT ad.id, ad.name, ad.parent_id
                UNION ALL
                SELECT d.id, d.name, d.parent_id
                FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.parent_id
              )
              SELECT string_agg(name, ' > ' ORDER BY id) FROM div_ancestors
            ) AS path
          FROM administrative_divisions ad WHERE ad.id = $1
        `, [dId]);
        if (divResult.rows.length === 0) continue;
        aiSuggestions.push({
          divisionId: dId,
          name: divResult.rows[0].name as string,
          path: divResult.rows[0].path as string,
          score: result.confidence === 'high' ? 900 : 600,
        });
      }

      if (aiSuggestions.length === 0) continue;

      // Load existing suggestion + assigned member division IDs to deduplicate
      const existing = await client.query(
        `SELECT division_id FROM region_match_suggestions WHERE region_id = $1 AND rejected = false
         UNION
         SELECT division_id FROM region_members WHERE region_id = $1`,
        [result.regionId],
      );
      const existingIds = new Set(existing.rows.map(r => r.division_id as number));

      // Insert only new suggestions not already present
      for (const s of aiSuggestions) {
        if (!existingIds.has(s.divisionId)) {
          await client.query(
            `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score)
             VALUES ($1, $2, $3, $4, $5)`,
            [result.regionId, s.divisionId, s.name, s.path, s.score],
          );
        }
      }

      // Update match status
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

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
