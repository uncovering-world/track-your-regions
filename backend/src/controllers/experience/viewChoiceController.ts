/**
 * A curator's answer to two data sources that describe one place differently
 * (#1246): which source's name, description, picture or point the place shows.
 * POST /api/experiences/:id/choose-views
 *
 * The question is open for a field two standing views under different ids
 * contradict and no choice has answered as the views stand
 * (`openViewFieldsSql`). Choosing a source writes its view of the field to the
 * place — the picture with its credit — and records the choice; choosing none
 * keeps what the place holds. Either way the choice stands until one of the
 * sources sends something different. No claim is written: while the views
 * contradict each other a run keeps the place's value anyway
 * (`contestedFields`), and once they no longer do there is nothing to pin.
 */

import type { PoolClient } from 'pg';
import type { z } from 'zod/v4';
import type { ViewsChosen } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience, updateExperienceColumns, type LockedExperience } from '../../db/experienceWriter.js';
import { KINDS, MEMBERSHIPS } from '../../db/membership.js';
import {
  openViewFieldsSql, placeViewValueSql, viewStandsSql, viewValueSql, type ViewField,
} from '../../db/sourceViews.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type { chooseViewsBodySchema, idParamSchema } from '../../types/index.js';
import { creditForOneImage, type ImageCredit } from '../../services/sync/imageCredit.js';
import { userAgent } from '../../config/userAgent.js';
import { resolveEverySourceScope } from './experienceScope.js';
import { recordViewChoices, type ViewChoice } from './viewChoices.js';

/** Why a picture is not taken: a photograph is never shown without its photographer (ADR-0043). */
const UNCREDITED = 'Who took this photograph could not be read from Wikimedia Commons, and a picture is never '
  + 'shown without its photographer. Try again in a moment.';

interface ChoiceRefusal {
  status: number;
  error: string;
}

/** What writing a membership's view of a field to the place sets, `$N` naming the membership. */
function assignmentOf(field: ViewField, membershipParam: string, creditParam: string): string {
  const from = (column: string) => `(SELECT ${column} FROM ${MEMBERSHIPS} WHERE id = ${membershipParam})`;
  if (field === 'name') return `name = ${from('reported_name')}`;
  if (field === 'description') return `description = ${from('reported_description')}`;
  if (field === 'location') return `location = ${from('reported_location')}`;
  // The picture's credit goes with the picture: the view's own, or the one
  // read from Commons when the view recorded none. Never without one — the
  // caller refuses a picture whose photographer nobody could name.
  return `image_url = ${from('reported_image_url')},
         metadata = COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object('imageCredit', COALESCE(${from('reported_image_credit')}, ${creditParam}::jsonb))`;
}

/**
 * The credit of the picture a choice would show, where its view recorded none
 * — a view under a curator's picture claim, or one the run's lookup missed —
 * read from Commons before the lock, as a curator's own picture edit reads it.
 * Null where no picture is chosen, or the view carries its credit.
 */
async function missingPictureCredit(
  experienceId: number, choices: readonly ViewChoice[],
): Promise<PictureCredit | null> {
  const picture = choices.find(choice => choice.field === 'imageUrl' && choice.membershipId !== null);
  if (!picture) return null;
  const view = await pool.query<{ url: string | null; credit: unknown }>(
    `SELECT reported_image_url AS url, reported_image_credit AS credit FROM ${MEMBERSHIPS}
      WHERE id = $1 AND experience_id = $2`,
    [picture.membershipId, experienceId],
  );
  const found = view.rows[0];
  if (!found?.url || found.credit !== null) return null;
  const credit = await creditForOneImage(found.url, userAgent());
  return credit ? { url: found.url, credit } : null;
}

/** A credit read from Commons, with the picture it names: it is that picture's only. */
export interface PictureCredit {
  url: string;
  credit: ImageCredit;
}

/**
 * The choice that keeps what readers see, per open field: the membership whose
 * view is the place's value, or none where the place holds a value of its own.
 * What a batch's "keep" answers (`reviewAnswerDispatch.ts`).
 */
export async function keepingChoices(experienceId: number): Promise<ViewChoice[]> {
  const result = await pool.query<{ field: ViewField; membership_id: number | null }>(
    `SELECT f AS field,
            (SELECT m.id FROM ${MEMBERSHIPS} m
              WHERE m.experience_id = e.id AND ${viewStandsSql('m')}
                AND ${viewValueSql('f', 'm')} = ${placeViewValueSql('f')}
              ORDER BY m.id LIMIT 1) AS membership_id
       FROM experiences e, unnest(${openViewFieldsSql('e.id')}) AS f
      WHERE e.id = $1`,
    [experienceId],
  );
  return result.rows.map(row => ({ field: row.field, membershipId: row.membership_id }));
}

/**
 * One choice, under the lock: the chosen view re-read — still this place's,
 * still standing, still reporting the field — and written to the place where
 * the place shows something else. A picture nobody can credit is refused.
 */
async function applyChoice(
  client: PoolClient,
  lock: LockedExperience,
  choice: ViewChoice,
  pictureCredit: PictureCredit | null,
): Promise<{ refusal: ChoiceRefusal } | { changed: boolean; detail: Record<string, unknown> }> {
  if (choice.membershipId === null) return { changed: false, detail: { field: choice.field, membershipId: null } };
  const view = await client.query<{
    differs: boolean; kind_name: string; source_name: string; value: string | null; credited: boolean; url: string | null;
  }>(
    `SELECT ${viewValueSql('$3::text', 'm')} IS DISTINCT FROM (SELECT ${placeViewValueSql('$3::text')} FROM experiences e WHERE e.id = m.experience_id) AS differs,
            m.reported_image_credit IS NOT NULL AS credited, m.reported_image_url AS url,
            k.name AS kind_name, s.name AS source_name,
            CASE WHEN $3::text = 'location' THEN NULL ELSE ${viewValueSql('$3::text', 'm')} END AS value
       FROM ${MEMBERSHIPS} m
       JOIN ${KINDS} k ON k.id = m.kind_id
       JOIN experience_sources s ON s.id = m.source_id
      WHERE m.id = $2 AND m.experience_id = $1 AND ${viewStandsSql('m')}
        AND NULLIF(${viewValueSql('$3::text', 'm')}, '') IS NOT NULL`,
    [lock.id, choice.membershipId, choice.field],
  );
  const found = view.rows[0];
  if (!found) {
    return { refusal: { status: 409, error: 'That source no longer reports this for the place — reload to see where it stands' } };
  }
  // A credit read from Commons names the picture it was read for; a run that
  // replaced the picture since has made it someone else's.
  const credit = pictureCredit?.url === found.url ? pictureCredit.credit : null;
  if (found.differs && choice.field === 'imageUrl' && !found.credited && !credit) {
    return pictureCredit
      ? { refusal: { status: 409, error: 'That source sent another picture while you answered — reload to see it' } }
      : { refusal: { status: 503, error: UNCREDITED } };
  }
  if (found.differs) {
    // The credit is bound only for the picture, the one assignment that reads it.
    const params = choice.field === 'imageUrl' ? [choice.membershipId, JSON.stringify(credit)] : [choice.membershipId];
    await updateExperienceColumns(client, lock, [assignmentOf(choice.field, '$2', '$3')], params);
  }
  return {
    changed: found.differs,
    detail: {
      field: choice.field, membershipId: choice.membershipId, kind: found.kind_name, source: found.source_name,
      ...(found.value === null ? {} : { value: found.value }), changed: found.differs,
    },
  };
}

/**
 * Apply and record the choices under the place's lock. Refuses, changing
 * nothing, a field no longer asked about — answered meanwhile, or a source
 * that changed its view — and a membership that is not a standing view of
 * that field on this place.
 */
export async function chooseViewsUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  choices: readonly ViewChoice[],
  /** The scope's sources (`resolveEverySourceScope`): the place must hold no other under the lock. */
  scopedSourceIds: readonly number[],
  /** The chosen picture's credit where its view recorded none (`missingPictureCredit`). */
  pictureCredit: PictureCredit | null = null,
): Promise<{ result?: { fields: ViewField[]; changed: ViewField[] }; refusal?: ChoiceRefusal }> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const refuse = async (status: number, error: string): Promise<{ refusal: ChoiceRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal: { status, error } };
    };
    const locked = await lockExperience(client, experienceId);
    if (!locked) return await refuse(404, 'Experience not found');
    const { lock } = locked;

    // The question as it stands under the lock, in a statement of its own
    // (`db/locks.ts`): a run that changed a view during the wait has changed it.
    const open = await client.query<{ fields: ViewField[] }>(
      `SELECT ${openViewFieldsSql('e.id')} AS fields FROM experiences e WHERE e.id = $1`, [experienceId],
    );
    const openFields = new Set(open.rows[0]?.fields ?? []);
    // The curator was found in scope for the place's sources before the lock;
    // a merge since may have brought one more, which nobody checked.
    const held = await client.query<{ source_id: number }>(
      `SELECT DISTINCT source_id FROM ${MEMBERSHIPS} WHERE experience_id = $1 ORDER BY source_id`, [experienceId],
    );
    if (held.rows.map(row => row.source_id).join(',') !== [...scopedSourceIds].sort((a, b) => a - b).join(',')) {
      return await refuse(409, 'The place changed while you answered — reload to see where it stands');
    }
    const changed: ViewField[] = [];
    const details: Record<string, unknown>[] = [];
    for (const choice of choices) {
      if (!openFields.has(choice.field)) {
        return await refuse(409, 'The sources no longer disagree about this, or it was answered — reload to see where it stands');
      }
      const applied = await applyChoice(client, lock, choice, pictureCredit);
      if ('refusal' in applied) return await refuse(applied.refusal.status, applied.refusal.error);
      if (applied.changed) changed.push(choice.field);
      details.push(applied.detail);
    }
    await recordViewChoices(client, lock, userId, choices);
    await client.query(
      `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
       VALUES ($1, $2, 'views_chosen', $3, $4)`,
      [experienceId, userId, logRegionId, JSON.stringify({ choices: details })],
    );
    await client.query('COMMIT');
    return { result: { fields: choices.map(choice => choice.field), changed } };
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

/**
 * The curator answers for every source the place's views come from: a choice
 * between two sources is a question about both, as an undo of a merge is.
 */
export async function chooseViews(
  { params: { id }, body, caller }: {
    params: z.output<typeof idParamSchema>; body: z.output<typeof chooseViewsBodySchema>; caller: Express.User;
  },
): Promise<ViewsChosen> {
  const exists = await pool.query('SELECT 1 FROM experiences WHERE id = $1', [id]);
  if (exists.rows.length === 0) throw notFound('Experience not found');
  const { permitted, logRegionId, sourceIds } = await resolveEverySourceScope(caller.id, caller.role, id);
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  const outcome = await chooseViewsUnderLock(
    id, caller.id, logRegionId, body.choices, sourceIds, await missingPictureCredit(id, body.choices),
  );
  if (outcome.refusal) {
    const { status, ...rest } = outcome.refusal;
    throw new Refusal(status, rest);
  }
  return { experienceId: id, ...outcome.result! };
}
