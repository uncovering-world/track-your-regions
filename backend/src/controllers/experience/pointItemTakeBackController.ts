/**
 * A curator taking back the Wikidata item confirmed for a World Heritage
 * component (#1317).
 * POST /api/experiences/locations/:locationId/take-back-item
 *
 * The confirmation (#1314) wrote the item on the point as the curator's
 * choice — `wikidata_item` with a claim on it — and what the item gave the
 * point: its picture, credit and description. The take-back is the way back a
 * merge has (ADR-0086): the item and its claim come off, and the picture and
 * the description come off with them where no curator has claimed the field
 * since — a point with no item has no run-written picture or description, so
 * an unclaimed one is the confirmation's; the candidate is open again
 * (#1336), so the point is asked about on the card with it at once — a no or a
 * second yes there is the answer on record — and the point is searched again
 * on the finder's next pass, since it has no item. Only a confirmation is taken back:
 * an item a run recorded off the component's reference carries no claim, and
 * is the source's to change.
 *
 * In the scope the confirmation had (`componentItemsScope`): any of the
 * sources whose memberships place the point, falling back to the object's
 * first source where none does — `experiences.source_id` only names the
 * source that first brought the place (ADR-0084). The request names the item
 * the history showed: a history read before another curator took that item
 * back and confirmed a different one cannot take the newer one off.
 */

import type { z } from 'zod/v4';
import type { PointItemTakenBack } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import type { locationIdParamSchema, takeBackPointItemBodySchema } from '../../types/index.js';
import { reopenConfirmed } from './componentItemAnswers.js';
import { releasePointItem } from './experienceLocationWriter.js';
import { resolveExperienceScope } from './experienceScope.js';

interface TakeBackRefusal {
  status: number;
  error: string;
}

/** The point as the take-back finds it under the lock, with the label the candidate was confirmed under. */
interface ConfirmedPoint {
  name: string | null;
  wikidata_item: string | null;
  claimed: boolean;
  label: string | null;
}

/**
 * Take the confirmed item off one point, under the object's lock. Refuses,
 * changing nothing, a point with no item, one whose item is a run's rather
 * than a curator's, and one holding a different item than the caller saw.
 */
export async function takeBackPointItemUnderLock(
  locationId: number,
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  expectedItem: string,
): Promise<{ result?: PointItemTakenBack; refusal?: TakeBackRefusal }> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const refuse = async (status: number, error: string): Promise<{ refusal: TakeBackRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal: { status, error } };
    };
    const locked = await lockExperience(client, experienceId);
    if (!locked) return await refuse(404, 'Experience not found');
    const { lock } = locked;

    const found = await client.query<ConfirmedPoint>(
      `SELECT el.name, el.wikidata_item, (el.curated_fields ? 'wikidata_item') AS claimed,
              (SELECT p.item_label FROM experience_component_item_proposals p
                WHERE p.location_id = el.id AND p.wikidata_item = el.wikidata_item
                ORDER BY p.id DESC LIMIT 1) AS label
         FROM experience_locations el
        WHERE el.id = $1 AND el.experience_id = $2`,
      [locationId, experienceId],
    );
    const point = found.rows[0];
    if (!point) return await refuse(404, 'Location not found');
    if (point.wikidata_item === null) return await refuse(409, 'This point has no item to take back');
    if (!point.claimed) {
      return await refuse(409, "This point's item was recorded by a run off the component's reference, not confirmed by a curator — nothing to take back");
    }
    if (point.wikidata_item !== expectedItem) {
      return await refuse(409, 'This point now holds a different item than the one shown — reload the history');
    }

    const item = point.wikidata_item;
    const cleared = await releasePointItem(client, lock, locationId);
    await reopenConfirmed(client, lock, locationId, item);
    await client.query(
      `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
       VALUES ($1, $2, 'component_item_taken_back', $3, $4)`,
      [experienceId, userId, logRegionId, JSON.stringify({ locationId, point: point.name, item, label: point.label, cleared })],
    );
    await client.query('COMMIT');
    return { result: { locationId, item, cleared } };
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

export async function takeBackPointItem(
  { params: { locationId }, body, caller }: {
    params: z.output<typeof locationIdParamSchema>; body: z.output<typeof takeBackPointItemBodySchema>; caller: Express.User;
  },
): Promise<PointItemTakenBack> {
  // The sources whose memberships place the point, as the confirmation was
  // scoped; the object's first source where none does.
  const found = await pool.query<{ experience_id: number; source_ids: number[] | null; source_id: number }>(
    `SELECT el.experience_id, e.source_id,
            (SELECT array_agg(DISTINCT m.source_id)
               FROM experience_location_placements pl JOIN ${MEMBERSHIPS} m ON m.id = pl.membership_id
              WHERE pl.location_id = el.id) AS source_ids
       FROM experience_locations el JOIN experiences e ON e.id = el.experience_id
      WHERE el.id = $1`,
    [locationId],
  );
  const row = found.rows[0];
  if (!row) throw notFound('Location not found');
  let logRegionId: number | null = null;
  let permitted = false;
  for (const sourceId of row.source_ids?.length ? row.source_ids : [row.source_id]) {
    const scope = await resolveExperienceScope(caller.id, caller.role, row.experience_id, sourceId);
    if (scope.permitted) { ({ permitted, logRegionId } = scope); break; }
  }
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  const outcome = await takeBackPointItemUnderLock(locationId, row.experience_id, caller.id, logRegionId, body.item);
  if (outcome.refusal) {
    const { status, ...rest } = outcome.refusal;
    throw new Refusal(status, rest);
  }
  return outcome.result!;
}
