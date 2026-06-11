/**
 * Work-unit workflow helpers (import-review redesign).
 *
 * touchWorkUnitForRegion is the staleness chokepoint: any mutation inside a
 * work unit's subtree marks the unit active. not_started → in_progress on
 * first activity; signed_off → in_progress on later edits, RETAINING
 * signed_off_at so the dashboard can badge "modified after sign-off"
 * (spec: docs/tech/planning/import-review-workflow-redesign.md).
 */
import { pool } from '../../db/index.js';

export async function touchWorkUnitForRegion(regionId: number): Promise<void> {
  await pool.query(
    `WITH RECURSIVE walk_up AS (
       SELECT r.id, r.parent_region_id, 0 AS depth
       FROM regions r WHERE r.id = $1
       UNION ALL
       SELECT r.id, r.parent_region_id, w.depth + 1
       FROM regions r JOIN walk_up w ON r.id = w.parent_region_id
     ),
     nearest_unit AS (
       SELECT w.id
       FROM walk_up w
       JOIN region_import_state ris ON ris.region_id = w.id
       WHERE ris.is_work_unit = TRUE
       ORDER BY w.depth
       LIMIT 1
     )
     UPDATE region_import_state
     SET signoff_status = 'in_progress'
     WHERE region_id IN (SELECT id FROM nearest_unit)
       AND signoff_status IN ('not_started', 'signed_off')`,
    [regionId],
  );
}
