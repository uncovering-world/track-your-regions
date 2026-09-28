/**
 * Helper functions for World View controllers
 */

import { pool } from '../../db/index.js';
import type { PoolClient } from 'pg';

/**
 * Insert into region_members for the (region_id, division_id) pair without a
 * custom geometry, ignoring conflicts with an existing row. Race-safe: relies
 * on the partial unique index `idx_region_members_unique_no_custom`
 * (see db/init/01-schema.sql) so concurrent callers can't double-insert.
 */
export async function ensureRegionMember(
  regionId: number,
  divisionId: number,
  db: Pick<PoolClient, 'query'> = pool,
): Promise<void> {
  // Explicit arbiter pins the dedupe to the partial unique index. A bare
  // `ON CONFLICT DO NOTHING` works today, but only because the partial index
  // happens to be the only unique constraint on this table; pinning the
  // arbiter prevents a future unique constraint from silently changing what
  // counts as a duplicate.
  await db.query(
    `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
     ON CONFLICT (region_id, division_id) WHERE custom_geom IS NULL DO NOTHING`,
    [regionId, divisionId],
  );
}

/**
 * Move every member row of one region to another, each row as it is (#384).
 *
 * A row is what a curator made it: a whole division, or a cut part with its
 * `custom_geom` and `custom_name` — the west of Russia, the Keys of Monroe
 * County. Moving the row itself keeps that part, and keeps two parts of one
 * division as two rows; every row the target already holds stays. The one
 * row that cannot move is a whole division the target already holds whole,
 * which `idx_region_members_unique_no_custom` refuses a second time; it adds
 * nothing to the target's coverage, so it is dropped.
 *
 * `db` is the pool or the caller's transaction client. Answers how many rows
 * moved.
 */
export async function moveMembersToRegion(
  db: Pick<PoolClient, 'query'>,
  fromRegionId: number,
  toRegionId: number,
): Promise<number> {
  await db.query(
    `DELETE FROM region_members m
     WHERE m.region_id = $1 AND m.custom_geom IS NULL
       AND EXISTS (
         SELECT 1 FROM region_members t
         WHERE t.region_id = $2 AND t.division_id = m.division_id AND t.custom_geom IS NULL
       )`,
    [fromRegionId, toRegionId],
  );
  const moved = await db.query(
    'UPDATE region_members SET region_id = $2 WHERE region_id = $1',
    [fromRegionId, toRegionId],
  );
  return moved.rowCount ?? 0;
}

/**
 * Sync match_status in region_import_state after member changes.
 *
 * When members are added/removed via the Editor, the match_status
 * must reflect the actual state of region_members:
 * - Has members → 'manual_matched'
 * - No members, has suggestions → 'needs_review'
 * - No members, no suggestions → 'no_candidates'
 *
 * No-op for non-imported regions (no row in region_import_state).
 */
export async function syncImportMatchStatus(
  regionId: number,
  db: Pick<PoolClient, 'query'> = pool,
): Promise<void> {
  // Check if this is an imported region
  const risResult = await db.query(
    `SELECT match_status FROM region_import_state WHERE region_id = $1`,
    [regionId]
  );
  if (risResult.rows.length === 0) return;

  const currentStatus = risResult.rows[0].match_status as string;

  const countResult = await db.query(
    'SELECT COUNT(*) FROM region_members WHERE region_id = $1',
    [regionId]
  );
  const memberCount = parseInt(countResult.rows[0].count as string);

  let newStatus: string;
  if (memberCount > 0) {
    newStatus = 'manual_matched';
  } else {
    const suggestionCount = await db.query(
      'SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false',
      [regionId]
    );
    const hasSuggestions = parseInt(suggestionCount.rows[0].count as string) > 0;
    newStatus = hasSuggestions ? 'needs_review' : 'no_candidates';
  }

  if (currentStatus !== newStatus) {
    await db.query(
      `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
      [newStatus, regionId]
    );
  }
}
