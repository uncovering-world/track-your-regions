/**
 * The curation log as the admin reads it (#611): one curator's acts, and the
 * feed across every curator. Both are one query, `readCurationActivity`, so a
 * filter means the same on either screen.
 */

import type { z } from 'zod/v4';
import type { CurationActivity, CuratorActivity, CuratorActivityEntry } from '../../api/responses/admin.js';
import { pool } from '../../db/index.js';
import type {
  ExperienceCurationLogRow, ExperiencesRow, RegionsRow, UsersRow,
} from '../../db/schema.generated.js';
import type {
  curationActivityQuerySchema, curatorActivityQuerySchema, userIdParamSchema,
} from '../../types/index.js';

/** One act of the log as the activity read selects it. */
type ActivityRow = Pick<ExperienceCurationLogRow, 'id' | 'details' | 'created_at' | 'region_id' | 'curator_id'> & {
  action: CuratorActivityEntry['action'];
  experience_id: ExperiencesRow['id'];
  experience_name: ExperiencesRow['name'];
  region_name: RegionsRow['name'] | null;
  curator_name: UsersRow['display_name'];
};

/** Key by key, the timestamp as the wire carries it and `details` as the object its action wrote. */
function activityEntryOf(row: ActivityRow): CuratorActivityEntry {
  return {
    id: row.id,
    action: row.action,
    created_at: row.created_at === null ? null : row.created_at.toISOString(),
    details: row.details as CuratorActivityEntry['details'],
    experience_id: row.experience_id,
    experience_name: row.experience_name,
    region_id: row.region_id,
    region_name: row.region_name,
    curator_id: row.curator_id,
    curator_name: row.curator_name,
  };
}

type ActivityFilters = z.output<typeof curationActivityQuerySchema>;

/**
 * A page of the log, newest first, and how many acts the filters keep.
 *
 * A region keeps an act on a place assigned to it or to any region below it,
 * and an act naming such a region (an add or a removal): what happened in
 * Japan this week is about Japan's places, wherever in Japan they sit. The id
 * breaks a tie between acts one batch wrote in the same instant, so a page
 * boundary never repeats or skips one.
 */
async function readCurationActivity(
  { curatorId, action, regionId, since, before, limit, offset }: ActivityFilters,
): Promise<CuratorActivity> {
  const where: string[] = [];
  const values: unknown[] = [];
  const param = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (curatorId !== undefined) where.push(`cl.curator_id = ${param(curatorId)}`);
  if (action !== undefined) where.push(`cl.action = ${param(action)}`);
  if (since !== undefined) where.push(`cl.created_at >= ${param(since)}::timestamptz`);
  if (before !== undefined) where.push(`cl.created_at < ${param(before)}::timestamptz`);
  const within = regionId === undefined ? '' : `
    WITH RECURSIVE subtree AS (
      SELECT id FROM regions WHERE id = ${param(regionId)}
      UNION ALL
      SELECT r.id FROM regions r JOIN subtree s ON r.parent_region_id = s.id
    )`;
  if (regionId !== undefined) {
    where.push(`(cl.region_id IN (SELECT id FROM subtree)
      OR EXISTS (SELECT 1 FROM experience_regions er
                  WHERE er.experience_id = cl.experience_id AND er.region_id IN (SELECT id FROM subtree)))`);
  }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await pool.query<ActivityRow>(`${within}
    SELECT
      cl.id,
      cl.action,
      cl.created_at,
      cl.details,
      cl.curator_id,
      u.display_name AS curator_name,
      e.id AS experience_id,
      e.name AS experience_name,
      r.id AS region_id,
      r.name AS region_name
    FROM experience_curation_log cl
    JOIN experiences e ON cl.experience_id = e.id
    LEFT JOIN regions r ON cl.region_id = r.id
    LEFT JOIN users u ON cl.curator_id = u.id
    ${filter}
    ORDER BY cl.created_at DESC, cl.id DESC
    LIMIT ${param(limit)} OFFSET ${param(offset)}
  `, values);

  const counted = await pool.query<{ count: string }>(
    `${within} SELECT COUNT(*) FROM experience_curation_log cl ${filter}`,
    values.slice(0, -2),
  );

  return {
    activity: result.rows.map(activityEntryOf),
    total: parseInt(counted.rows[0].count),
    limit,
    offset,
  };
}

/**
 * One curator's acts, an admin's without an assignment row included (#905).
 * GET /api/admin/curators/:userId/activity
 */
export async function getCuratorActivity(
  { params: { userId }, query }: {
    params: z.output<typeof userIdParamSchema>; query: z.output<typeof curatorActivityQuerySchema>;
  },
): Promise<CuratorActivity> {
  return readCurationActivity({ ...query, curatorId: userId });
}

/**
 * Every curator's acts, and a sync run's own merges, in one feed (#611), with
 * everyone the log names as having acted: the Curators directory lists only
 * who curates now, and an audit is often of someone whose scope was taken back.
 * GET /api/admin/curation-activity
 */
export async function getCurationActivity(
  { query }: { query: z.output<typeof curationActivityQuerySchema> },
): Promise<CurationActivity> {
  const [page, actors] = await Promise.all([
    readCurationActivity(query),
    pool.query<{ id: UsersRow['id']; name: UsersRow['display_name'] }>(`
      SELECT u.id, u.display_name AS name FROM users u
       WHERE EXISTS (SELECT 1 FROM experience_curation_log cl WHERE cl.curator_id = u.id)
       ORDER BY u.display_name NULLS LAST, u.id`),
  ]);
  return { ...page, curators: actors.rows };
}
