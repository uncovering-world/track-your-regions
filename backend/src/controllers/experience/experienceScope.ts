/**
 * Curator scope for actions on an experience as a whole.
 *
 * Lives apart from the controllers because more than one of them needs it: an
 * edit, a lifecycle decision, or accepting a source value all change the
 * experience itself rather than its place in one region, and all ask the same
 * question of the caller's scope.
 */

import { pool } from '../../db/index.js';
import type { UserRole } from '../../types/auth.js';
import { CURATOR_SCOPED_REGIONS_CTE, CURATOR_UNRESTRICTED_SCOPE_EXISTS } from '../../middleware/auth.js';

/**
 * Resolve whether a caller may act on this experience, and which region the
 * audit row should name.
 *
 * Such an action changes the experience itself, not its place in one region, so the
 * grant is "any region the experience sits in falls within the caller's
 * scope" — not "the first row Postgres happened to return does" (#450).
 * `CURATOR_SCOPED_REGIONS_CTE` answers that in one query, by intersecting the
 * experience's assignments with the caller's closure.
 *
 * The region it hands back is the audit row's, and deliberately not just some
 * region the experience sits in. `unrestricted` callers — admins, global
 * curators, curators of the experience's category — get `null`: no single
 * region is where their authority came from, and since #442 the log is
 * filtered per row, so naming one arbitrarily would hide the edit from every
 * curator except whoever happens to cover that region. A row naming no region
 * stays visible to all of them. A region-scoped curator gets the lowest-id
 * region of the experience their scope covers — every candidate is a region
 * they genuinely cover, so a fixed choice among them is truthful and keeps the
 * row reproducible.
 */
export async function resolveExperienceScope(
  userId: number,
  userRole: UserRole,
  experienceId: number,
  categoryId: number,
): Promise<{ permitted: boolean; logRegionId: number | null }> {
  if (userRole === 'admin') return { permitted: true, logRegionId: null };

  const result = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT
      ${CURATOR_UNRESTRICTED_SCOPE_EXISTS} AS unrestricted,
      (
        SELECT MIN(er.region_id)
        FROM experience_regions er
        JOIN curator_scoped_regions s ON s.id = er.region_id
        WHERE er.experience_id = $2
      ) AS scoped_region_id
  `, [userId, experienceId, categoryId]);

  const row = result.rows[0] as { unrestricted: boolean; scoped_region_id: number | null };
  if (row.unrestricted === true) return { permitted: true, logRegionId: null };
  return { permitted: row.scoped_region_id !== null, logRegionId: row.scoped_region_id };
}

/**
 * May this caller see a `pending` row through one of the three by-id reads
 * (`GET /:id`, `/:id/locations`, `/:id/treasures` — ADR-0025)? Admins always
 * may. A curator may when `resolveExperienceScope` says their scope reaches
 * this experience — the same question that function already answers for a
 * curator's *write* actions, asked here for a read instead, so a curator
 * following a queue item through to an object's page sees exactly the object
 * their queue named. Everyone else may not, and the check costs them nothing:
 * an anonymous or non-curator caller returns before touching the database.
 *
 * The relaxation stops here on purpose. It widens `GET /:id`, `/:id/locations`
 * and `/:id/treasures` only — never a list, a count, the map feed or search —
 * because those describe a *set*, and a curator's set has to match a reader's
 * or the two could never agree on what the catalogue offers.
 *
 * Takes `experienceId` alone rather than a pre-fetched `categoryId`, unlike
 * `resolveExperienceScope`: none of the three by-id reads has a category to
 * hand before its row is fetched — the row is exactly what the pending gate
 * is deciding whether to return — so the lookup lives here once instead of
 * being repeated at each of the three call sites.
 */
export async function maySeeUnreadExperience(
  userId: number | undefined,
  userRole: UserRole | undefined,
  experienceId: number,
): Promise<boolean> {
  if (userRole === 'admin') return true;
  if (!userId || userRole !== 'curator') return false;

  const categoryResult = await pool.query('SELECT category_id FROM experiences WHERE id = $1', [experienceId]);
  if (categoryResult.rows.length === 0) return false;

  const { permitted } = await resolveExperienceScope(userId, userRole, experienceId, categoryResult.rows[0].category_id);
  return permitted;
}

