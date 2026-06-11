/**
 * One-off backfill for the import-review workflow redesign
 * (docs/tech/planning/import-review-workflow-redesign.md).
 *
 * Sets is_work_unit + reference_division_ids for an existing imported
 * world view:
 *  1. Regions whose own assigned division is a GADM country-level division
 *     (children of root continents).
 *  2. children_matched regions whose name matches a GADM country-level
 *     division (level restriction avoids e.g. Georgia-the-state shadowing
 *     the country).
 *  2.5 needs_review regions where ALL non-rejected suggestions are
 *     country-level get flagged with all candidate ids as reference
 *     (mirrors the matcher's ambiguous-country behavior).
 *  3. Remaining children_matched regions are flagged units WITHOUT a
 *     reference so they surface in the skeleton worklist.
 *
 * Usage: cd backend && npx tsx src/scripts/backfillWorkUnits.ts <worldViewId>
 */
import { pool } from '../db/index.js';

async function main(): Promise<void> {
  const worldViewId = parseInt(process.argv[2] ?? '');
  if (!Number.isInteger(worldViewId)) {
    console.error('Usage: npx tsx src/scripts/backfillWorkUnits.ts <worldViewId>');
    process.exit(1);
  }

  // 1. Directly matched countries: own member at GADM level 0.
  //    In this DB continents are depth-1 (parent_id IS NULL) and countries are
  //    depth-2 (parent_id = <continent id>), so we match divisions whose
  //    parent is a continent (i.e. parent.parent_id IS NULL).
  const direct = await pool.query(`
    UPDATE region_import_state ris
    SET is_work_unit = TRUE,
        reference_division_ids = sub.div_ids
    FROM (
      SELECT rm.region_id, array_agg(rm.division_id) AS div_ids
      FROM region_members rm
      JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $1
      JOIN administrative_divisions ad ON ad.id = rm.division_id
      JOIN administrative_divisions continent ON continent.id = ad.parent_id
        AND continent.parent_id IS NULL
      GROUP BY rm.region_id
    ) sub
    WHERE ris.region_id = sub.region_id
    RETURNING ris.region_id
  `, [worldViewId]);

  // 2. children_matched countries: level-0-restricted name match.
  //    Same depth-2 adjustment: match against divisions whose parent is a
  //    continent (avoiding sub-national collisions like Georgia-the-state).
  const drilled = await pool.query(`
    UPDATE region_import_state ris
    SET is_work_unit = TRUE,
        reference_division_ids = ARRAY[sub.division_id]
    FROM (
      SELECT r.id AS region_id, ad.id AS division_id
      FROM regions r
      JOIN region_import_state s ON s.region_id = r.id
      JOIN administrative_divisions ad
        ON ad.name_normalized = lower(immutable_unaccent(r.name))
      JOIN administrative_divisions continent ON continent.id = ad.parent_id
        AND continent.parent_id IS NULL
      WHERE r.world_view_id = $1 AND s.match_status = 'children_matched'
    ) sub
    WHERE ris.region_id = sub.region_id
      AND ris.reference_division_ids IS NULL
    RETURNING ris.region_id
  `, [worldViewId]);

  // 2.5 Ambiguous countries: needs_review regions whose ALL non-rejected
  //     suggestions are country-level divisions (same depth-2 join as steps
  //     1-2).  Mirrors the live matcher's recordAmbiguousCountry behavior —
  //     stores all candidates as reference_division_ids.
  //     Regions with any non-country suggestion (e.g. Geta, Highlands) are
  //     intentionally excluded by the bool_and predicate.
  const ambiguous = await pool.query(`
    UPDATE region_import_state ris
    SET is_work_unit = TRUE,
        reference_division_ids = sub.div_ids
    FROM (
      SELECT rms.region_id, array_agg(DISTINCT rms.division_id) AS div_ids
      FROM region_match_suggestions rms
      JOIN regions r ON r.id = rms.region_id AND r.world_view_id = $1
      JOIN region_import_state s ON s.region_id = r.id AND s.match_status = 'needs_review'
      WHERE rms.rejected = FALSE
      GROUP BY rms.region_id
      HAVING bool_and(EXISTS (
        SELECT 1 FROM administrative_divisions ad
        JOIN administrative_divisions continent
          ON continent.id = ad.parent_id AND continent.parent_id IS NULL
        WHERE ad.id = rms.division_id
      ))
    ) sub
    WHERE ris.region_id = sub.region_id
      AND ris.reference_division_ids IS NULL
    RETURNING ris.region_id
  `, [worldViewId]);

  // 3. Remaining children_matched without reference: flag as units anyway so
  //    they appear on the dashboard with a "no reference" blocker.
  const flagged = await pool.query(`
    UPDATE region_import_state ris
    SET is_work_unit = TRUE
    FROM regions r
    WHERE r.id = ris.region_id AND r.world_view_id = $1
      AND ris.match_status = 'children_matched'
      AND ris.is_work_unit = FALSE
    RETURNING ris.region_id
  `, [worldViewId]);

  console.log(`Backfill complete: ${direct.rows.length} direct, ${drilled.rows.length} drilled (name-matched), ${ambiguous.rows.length} ambiguous countries, ${flagged.rows.length} flagged without reference.`);
  await pool.end();
}

// Only run main() when invoked directly (extension-agnostic: works under tsx
// and a compiled build), not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
