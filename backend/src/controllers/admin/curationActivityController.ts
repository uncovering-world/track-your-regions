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
import { AGAINST_THE_RULE_ACTIONS, EDITED_BY_HAND_ACTIONS } from '@tyr/shared/curationLog';
import { actKindNameSql } from '../../db/actKind.js';
import { likeParam } from '../experience/reviewQueueKeys.js';

/** One act of the log as the activity read selects it. */
type ActivityRow = Pick<ExperienceCurationLogRow, 'id' | 'details' | 'created_at' | 'region_id' | 'curator_id'> & {
  action: CuratorActivityEntry['action'];
  experience_id: ExperiencesRow['id'];
  experience_name: ExperiencesRow['name'];
  experience_image_url: ExperiencesRow['image_url'];
  experience_image_credit: unknown;
  kind_name: string | null;
  region_name: RegionsRow['name'] | null;
  curator_name: UsersRow['display_name'];
  /** Set where the entry stands for a batch publish: how many places, and the first names. */
  batch_size?: string | number | null;
  batch_names?: string[] | null;
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
    experience_image_url: row.experience_image_url ?? null,
    experience_image_credit: (row.experience_image_credit ?? null) as CuratorActivityEntry['experience_image_credit'],
    kind_name: row.kind_name ?? null,
    batch: row.batch_size ? { count: Number(row.batch_size), names: row.batch_names ?? [] } : null,
    region_id: row.region_id,
    region_name: row.region_name,
    curator_id: row.curator_id,
    curator_name: row.curator_name,
  };
}

type ActivityFilters = z.output<typeof curationActivityQuerySchema>;

/** The period's counts, as the driver hands a `count(*)` over: a string. */
interface CountsRow {
  entries_total: string;
  against: string;
  turned_away: string;
  kept_out: string;
  edited: string;
  published: string;
}

/** How many publications of one curator in one run read as one batch (#956). */
export const BATCH_MIN = 5;
/**
 * The longest pause inside one run of publications. A run is a curator's
 * publications each less than this after the one before, so a batch that
 * crosses a clock minute stays one.
 */
const BATCH_GAP_SECONDS = 60;
/** How many of a batch's places its entry names; the rest are counted. */
const BATCH_NAMES = 12;

/**
 * A page of the log, newest first, and how many entries the filters keep.
 *
 * A region keeps an act on a place assigned to it or to any region below it,
 * and an act naming such a region (an add or a removal): what happened in
 * Japan this week is about Japan's places, wherever in Japan they sit. `q`
 * keeps the acts on a place whose name holds it. The id breaks a tie between
 * acts one batch wrote in the same instant, so a page boundary never repeats
 * or skips one.
 *
 * A batch publish is one entry (#956): one curator's run of publications, each
 * less than `BATCH_GAP_SECONDS` after the one before, `BATCH_MIN` or more, read
 * as "Published 563 places" with its first names. On dev's log 1,007 of 1,286 acts in 30 days were publications, nearly
 * all in such batches, and the calls against the rule were lost among them. A
 * batch names no kind: its publications may be in several, each logging its
 * own (`details.kindId`, #863), and a place's first source is not the kind it
 * was published in (Belém Tower, brought by UNESCO, published in Towers).
 */
async function readCurationActivity(
  { curatorId, action, regionId, since, before, q, limit, offset }: ActivityFilters,
): Promise<CuratorActivity> {
  const where: string[] = [];
  const values: unknown[] = [];
  const param = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (curatorId !== undefined) where.push(`cl.curator_id = ${param(curatorId)}`);
  if (action !== undefined) where.push(`cl.action = ${param(action)}`);
  if (since !== undefined) where.push(`cl.created_at >= ${param(since)}::timestamptz`);
  if (before !== undefined) where.push(`cl.created_at < ${param(before)}::timestamptz`);
  if (q !== undefined) where.push(`e.name ILIKE ${param(likeParam(q))} ESCAPE '\\'`);
  const subtree = regionId === undefined ? null : `subtree AS (
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
  // The acts the filters keep, each publication with the run it belongs to (a curator's
  // publications less than BATCH_GAP apart), and the entries a page lists: an act, or a
  // batch once.
  const regionCte = subtree ? subtree + ',' : '';
  const ctes = `WITH RECURSIVE ${regionCte}
    acts AS (
      SELECT cl.id, cl.action, cl.created_at, cl.details, cl.curator_id, cl.region_id, cl.experience_id,
             e.name AS experience_name, cl.action = 'published' AS is_publication
        FROM experience_curation_log cl
        JOIN experiences e ON cl.experience_id = e.id
        ${filter}
    ),
    starts AS (
      SELECT a.*,
             CASE WHEN a.is_publication AND (lag(a.created_at) OVER publications IS NULL
                    OR a.created_at - lag(a.created_at) OVER publications >= interval '${BATCH_GAP_SECONDS} seconds')
                  THEN 1 ELSE 0 END AS starts_run
        FROM acts a
      WINDOW publications AS (PARTITION BY a.curator_id, a.is_publication ORDER BY a.created_at, a.id)
    ),
    runs AS (
      SELECT s.*,
             CASE WHEN s.is_publication THEN sum(s.starts_run) OVER (
               PARTITION BY s.curator_id, s.is_publication ORDER BY s.created_at, s.id) END AS batch_no
        FROM starts s
    ),
    batched AS (
      SELECT r.*,
             CASE WHEN r.batch_no IS NULL THEN 1 ELSE count(*) OVER together END AS batch_size,
             row_number() OVER (together ORDER BY r.created_at DESC, r.id DESC) AS batch_rank
        FROM runs r
      WINDOW together AS (PARTITION BY r.curator_id, r.batch_no)
    ),
    entries AS (SELECT * FROM batched WHERE batch_size < ${BATCH_MIN} OR batch_rank = 1),
    -- The period's acts by what an auditor reads them for; a batch counts every place it published.
    counts AS (
      SELECT (SELECT count(*) FROM entries) AS entries_total,
             count(*) FILTER (WHERE action = ANY(${param(AGAINST_THE_RULE_ACTIONS)}::text[])) AS against,
             count(*) FILTER (WHERE action = 'arrival_refused') AS turned_away,
             count(*) FILTER (WHERE action = 'admission_confirmed') AS kept_out,
             count(*) FILTER (WHERE action = ANY(${param(EDITED_BY_HAND_ACTIONS)}::text[])) AS edited,
             count(*) FILTER (WHERE action = 'published') AS published
        FROM acts
    )`;

  // One statement, so the page and its counts read one snapshot: a batch a curator
  // completes between two statements would otherwise fold rows the total already counted.
  const result = await pool.query<ActivityRow & CountsRow>(`${ctes},
    page AS (
    SELECT
      en.id, en.action, en.created_at, en.details, en.curator_id,
      u.display_name AS curator_name,
      e.id AS experience_id,
      e.name AS experience_name,
      e.image_url AS experience_image_url,
      e.metadata->'imageCredit' AS experience_image_credit,
      ${actKindNameSql('en')} AS kind_name,
      r.id AS region_id,
      r.name AS region_name,
      CASE WHEN en.batch_size >= ${BATCH_MIN} THEN en.batch_size END AS batch_size,
      -- A batch's first names, read for the page's batches only.
      CASE WHEN en.batch_size >= ${BATCH_MIN} THEN ARRAY(
        SELECT b.experience_name FROM runs b
         WHERE b.curator_id IS NOT DISTINCT FROM en.curator_id AND b.batch_no = en.batch_no
         ORDER BY b.created_at DESC, b.id DESC LIMIT ${BATCH_NAMES}) END AS batch_names
    FROM entries en
    JOIN experiences e ON en.experience_id = e.id
    LEFT JOIN regions r ON en.region_id = r.id
    LEFT JOIN users u ON en.curator_id = u.id
    ORDER BY en.created_at DESC, en.id DESC
    LIMIT ${param(limit)} OFFSET ${param(offset)}
    )
    -- The counts' one row, with the page's rows beside it, or alone for an empty page.
    SELECT page.*, counts.* FROM counts LEFT JOIN page ON true
    ORDER BY page.created_at DESC, page.id DESC
  `, values);
  const counts = result.rows[0];

  return {
    activity: result.rows.filter((row) => row.id !== null).map(activityEntryOf),
    total: parseInt(counts.entries_total),
    limit,
    offset,
    counts: {
      againstTheRule: parseInt(counts.against),
      arrivalsTurnedAway: parseInt(counts.turned_away),
      keptOutAsTheRuleSaid: parseInt(counts.kept_out),
      editedByHand: parseInt(counts.edited),
      published: parseInt(counts.published),
    },
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
