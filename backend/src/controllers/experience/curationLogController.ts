/**
 * A place's curation history as a curator reads it: the place's own rows and
 * those about every entry a standing merge folded into it, narrowed to the
 * caller's scope.
 */

import type { z } from 'zod/v4';
import type { CurationLog, CurationLogEntry } from '../../api/responses/curation.js';
import { pool } from '../../db/index.js';
import type { ExperienceCurationLogRow, ExperiencesRow, RegionsRow, UsersRow } from '../../db/schema.generated.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import type { idParamSchema } from '../../types/index.js';
import type { UserRole } from '../../types/auth.js';
import { CURATOR_SCOPED_REGIONS_CTE, CURATOR_UNRESTRICTED_SCOPE_EXISTS } from '../../middleware/auth.js';

type IdParams = z.output<typeof idParamSchema>;

/**
 * The entries a place's history reads, `$2` being the place (#1366): the place
 * itself, and every entry a standing merge folded into it — the decisions made
 * about an entry travel with what the merge moved, its memberships and their
 * pins among them, while the log rows stay on the entry's own id. A place
 * folded in after it had folded others in brings theirs too. `folded_id` names
 * the folded entry, null on the place's own rows. It extends the recursive
 * `CURATOR_SCOPED_REGIONS_CTE`, which both reads open with.
 */
const LOG_PLACES_CTE = `log_places AS (
    SELECT $2::int AS id, NULL::int AS folded_id
    UNION
    SELECT m.folded_id, m.folded_id
    FROM experience_merges m
    JOIN log_places lp ON m.survivor_id = lp.id
    WHERE m.undone_at IS NULL
  )`;

/**
 * Resolve what a caller may see of one experience's curation log.
 *
 * `unrestricted` — admins, global curators, and curators of the experience's
 * source see every row. `hasScopedRegion` — a region-scoped curator reaches
 * the log at all only if something in it is attributable to their scope: a
 * region the experience is assigned to, or a region already named by one of
 * its log rows. The second half matters because a curator's last act in a
 * region is often removing the experience from it, which deletes the
 * assignment and logs that removal — on assignments alone, the gate would
 * refuse them the record of what they just did.
 *
 * It grants nothing extra: the rows that come back are filtered through the
 * same closure either way, so the gate never admits a row the filter would
 * drop. It is strictly the stronger of the two, and deliberately so — neither
 * `EXISTS` can be satisfied by a row naming no region, so an experience whose
 * log holds only those is refused here even though the filter would have
 * returned them. That is the hole #442 names: without the gate, any curator
 * could read the log of an experience in no one's scope.
 */
async function resolveCurationLogScope(
  userId: number,
  userRole: UserRole,
  experienceId: number,
  sourceId: number,
): Promise<{ unrestricted: boolean; hasScopedRegion: boolean }> {
  if (userRole === 'admin') return { unrestricted: true, hasScopedRegion: true };

  const result = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}, ${LOG_PLACES_CTE}
    SELECT
      ${CURATOR_UNRESTRICTED_SCOPE_EXISTS} AS unrestricted,
      (EXISTS (
        SELECT 1 FROM experience_regions er
        JOIN curator_scoped_regions s ON s.id = er.region_id
        WHERE er.experience_id = $2
      ) OR EXISTS (
        SELECT 1 FROM log_places p
        JOIN experience_curation_log cl ON cl.experience_id = p.id
        JOIN curator_scoped_regions s ON s.id = cl.region_id
      )) AS has_scoped_region
  `, [userId, experienceId, sourceId]);

  const row = result.rows[0];
  return { unrestricted: row.unrestricted === true, hasScopedRegion: row.has_scoped_region === true };
}

/**
 * Get curation log for an experience
 * GET /api/experiences/:id/curation-log
 *
 * Returns the curation history: who did what and when. Requires curator auth,
 * and a region-scoped curator gets only the rows for regions they cover — the
 * scope check qualifies the result set, not one representative region.
 */
export async function getCurationLog(
  { params: { id: experienceId }, caller }: { params: IdParams; caller: Express.User },
): Promise<CurationLog> {
  const userId = caller.id;
  const userRole = caller.role;

  const expResult = await pool.query(
    'SELECT source_id FROM experiences WHERE id = $1',
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    throw notFound('Experience not found');
  }

  const { unrestricted, hasScopedRegion } = await resolveCurationLogScope(
    userId,
    userRole,
    experienceId,
    expResult.rows[0].source_id as number,
  );
  if (!unrestricted && !hasScopedRegion) {
    throw createError('You do not have curator permissions for this experience', 403);
  }

  // A row survives when the curator is unrestricted, when it names no region
  // (it identifies no region to leak), or when its region is one they cover.
  const result = await pool.query<CurationLogRow>(`${CURATOR_SCOPED_REGIONS_CTE}, ${LOG_PLACES_CTE}
    SELECT
      cl.id,
      cl.action,
      cl.region_id,
      r.name as region_name,
      cl.details,
      cl.created_at,
      u.display_name as curator_name,
      p.folded_id,
      f.name as folded_name
    FROM log_places p
    JOIN experience_curation_log cl ON cl.experience_id = p.id
    LEFT JOIN experiences f ON f.id = p.folded_id
    -- LEFT: the catalogue's own merge names no curator (ADR-0086).
    LEFT JOIN users u ON cl.curator_id = u.id
    LEFT JOIN regions r ON cl.region_id = r.id
    WHERE ($3::boolean OR cl.region_id IS NULL OR cl.region_id IN (SELECT id FROM curator_scoped_regions))
      -- A merge is logged on both places; the folded entry's copy of a merge
      -- or undo whose survivor this read covers is a row it already holds. One
      -- into another place, since undone, is held nowhere else here.
      AND NOT (p.folded_id IS NOT NULL AND cl.action IN ('merged', 'merge_undone')
        AND cl.details->>'foldedId' = p.id::text
        AND cl.details->>'survivorId' IN (SELECT id::text FROM log_places))
    ORDER BY cl.created_at DESC
    LIMIT 50
  `, [userId, experienceId, unrestricted]);

  return result.rows.map(row => ({
    id: row.id,
    // The column's CHECK list is `CURATION_LOG_ACTIONS` (`curationLogActions.test.ts`).
    action: row.action as CurationLogEntry['action'],
    region_id: row.region_id,
    region_name: row.region_name,
    details: row.details as CurationLogEntry['details'],
    created_at: row.created_at?.toISOString() ?? null,
    curator_name: row.curator_name,
    folded_id: row.folded_id,
    folded_name: row.folded_name,
  }));
}

/** One row of the log read, as the driver hands it over. */
type CurationLogRow = Pick<ExperienceCurationLogRow, 'id' | 'action' | 'region_id' | 'details' | 'created_at'> & {
  region_name: RegionsRow['name'] | null;
  curator_name: UsersRow['display_name'];
  folded_id: ExperiencesRow['id'] | null;
  folded_name: ExperiencesRow['name'] | null;
};
