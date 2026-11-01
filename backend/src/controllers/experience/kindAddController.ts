/**
 * A curator puts a place into a kind no run offers it in, from the place's own
 * card (#2035).
 *
 * POST /api/experiences/:id/kinds   { kindId, type?, note? }
 *
 * A run finds a place only through its kind's rule, and a place no rule reads
 * sits in no kind a traveller browses: Haus Schwarzenberg in Berlin, a
 * courtyard of street art filed under no English Wikipedia category and no
 * genre, is one no run of Public art finds. The curator's add is the way in: a membership admitted, published and pinned
 * (`insertCuratorKindMembership`), so the place joins that kind's lists, counts
 * and map at once and every later run leaves it there. The way back is the
 * card's own Take out… (`keepOutController.ts`).
 *
 * The kind is one the place has no membership in, in any state: a waiting
 * arrival, a rule's refusal or a kept-out place already has its answer on its
 * row, and a second membership in one kind is what the table refuses. World
 * Heritage Sites is never added to: a place is one only by UNESCO's
 * inscription, which no curator can make.
 */

import type { PoolClient } from 'pg';
import type { z } from 'zod/v4';
import type { KindAddedToPlace } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience, type LockedExperience } from '../../db/experienceWriter.js';
import { KINDS, MEMBERSHIPS, kindIsRealSql } from '../../db/membership.js';
import { CURATOR_SCOPED_REGIONS_CTE } from '../../middleware/auth.js';
import { badRequest, createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type { addToKindBodySchema, idParamSchema } from '../../types/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import type { AnswerRefusal } from './lifecycleController.js';
import { insertCuratorKindMembership } from './membershipWriter.js';
import { queueScopeSql } from './reviewQueueKeys.js';

type AddToKind = z.output<typeof addToKindBodySchema>;

/** World Heritage Sites: a place is one by UNESCO's inscription alone. */
export const INSCRIBED_KIND_ID = 1;

/** The source a kind is filed under: the one that fills it, first by display order, as a manual create's is. */
export function kindSourceSql(kindExpr: string): string {
  return `(SELECT s.id FROM experience_sources s WHERE s.kind_id = ${kindExpr} ORDER BY s.display_priority, s.id LIMIT 1)`;
}

export async function addPlaceToKind(
  { params: { id: experienceId }, body, caller }: {
    params: z.output<typeof idParamSchema>; body: AddToKind; caller: Express.User;
  },
): Promise<KindAddedToPlace> {
  if (body.kindId === INSCRIBED_KIND_ID) {
    throw badRequest('A place is a World Heritage Site only by UNESCO\'s inscription');
  }
  const source = await pool.query<{ source_id: number | null }>(
    `SELECT ${kindSourceSql('$1')} AS source_id`, [body.kindId],
  );
  const sourceId = source.rows[0]?.source_id ?? null;
  if (sourceId === null) throw badRequest('No such kind');
  const exists = await pool.query('SELECT 1 FROM experiences WHERE id = $1', [experienceId]);
  if (exists.rows.length === 0) throw notFound('Experience not found');
  // The kind's source decides the scope, as every answer about one kind does (#1264).
  const { permitted, logRegionId } = await resolveExperienceScope(caller.id, caller.role, experienceId, sourceId);
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);

  const outcome = await addUnderLock(experienceId, caller.id, logRegionId, sourceId, body);
  if (outcome.refusal) {
    const { status, ...refusal } = outcome.refusal;
    throw new Refusal(status, refusal);
  }
  return outcome.result!;
}

/** The membership written under the place's lock, the kind re-read in the statement after it. */
export async function addUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  sourceId: number,
  { kindId, type, note }: AddToKind,
): Promise<{ result?: KindAddedToPlace; refusal?: AnswerRefusal }> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const refuse = async (refusal: AnswerRefusal): Promise<{ refusal: AnswerRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal };
    };

    const locked = await lockExperience(client, experienceId);
    if (!locked) return await refuse({ status: 404, error: 'Experience not found' });
    const added = await addKindWithin(client, locked.lock, kindId, sourceId, type ?? null);
    if ('refusal' in added) return await refuse(added.refusal);
    const { membershipId, kind } = added;
    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'kind_added', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      membershipId, kindId, kind, type: type ?? null, note: note ?? null,
    })]);
    await client.query('COMMIT');
    return { result: { experienceId, membershipId, kindId } };
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

/**
 * The add itself, inside a transaction that holds the place's lock: the kind
 * re-read under the lock, refused where it is no kind or the place is in it
 * already, then the membership written (`insertCuratorKindMembership`). The
 * caller rolls back on a refusal — a unique violation leaves the transaction
 * aborted. Shared with the arrival answered by another kind (#2213), which
 * writes this beside its own refusal of the arrival in one transaction.
 */
export async function addKindWithin(
  client: PoolClient,
  lock: LockedExperience,
  kindId: number,
  sourceId: number,
  type: string | null,
): Promise<{ membershipId: number; kind: string } | { refusal: AnswerRefusal }> {
  const read = await client.query<{ kind: string; held: boolean }>(
    `SELECT kd.name AS kind,
            EXISTS (SELECT 1 FROM ${MEMBERSHIPS} m WHERE m.experience_id = $2 AND m.kind_id = kd.id) AS held
       FROM ${KINDS} kd
      WHERE kd.id = $1 AND ${kindIsRealSql('kd')}`,
    [kindId, lock.id],
  );
  const kind = read.rows[0];
  if (!kind) return { refusal: { status: 400, error: 'No such kind' } };
  if (kind.held) {
    return { refusal: { status: 409, error: `The place is in ${kind.kind} already — answer it on its row` } };
  }
  // Another place holding the item in this source is the one conflict the
  // read above cannot see; the caller's rollback ends the aborted transaction.
  try {
    return { membershipId: await insertCuratorKindMembership(client, lock, sourceId, type), kind: kind.kind };
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error;
    return { refusal: { status: 409, error: `Another place holds this place's Wikidata item in ${kind.kind}` } };
  }
}

/**
 * The kinds a curator may put the place into: every kind it has no membership
 * in, World Heritage Sites aside, whose source the caller's scope reaches.
 */
export async function addableKinds(
  experienceId: number,
  caller: Express.User,
): Promise<{ kindId: number; kindName: string }[]> {
  const result = await pool.query<{ kind_id: number; kind_name: string }>(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT kd.id AS kind_id, kd.name AS kind_name
      FROM experiences e
      JOIN ${KINDS} kd ON kd.id <> ${INSCRIBED_KIND_ID} AND ${kindIsRealSql('kd')}
      -- Aliased as a membership's source, which is what the scope reads.
      JOIN LATERAL (SELECT ${kindSourceSql('kd.id')} AS source_id) m ON m.source_id IS NOT NULL
     WHERE e.id = $2
       AND NOT EXISTS (SELECT 1 FROM ${MEMBERSHIPS} held WHERE held.experience_id = e.id AND held.kind_id = kd.id)
       AND ${queueScopeSql(caller.role === 'admin', 'm.source_id')}
     ORDER BY kd.display_priority, kd.name
  `, [caller.id, experienceId]);
  return result.rows.map(row => ({ kindId: row.kind_id, kindName: row.kind_name }));
}
