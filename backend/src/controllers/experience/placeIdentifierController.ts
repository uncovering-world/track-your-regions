/**
 * A place's external identifiers, and a curator's word on one of them
 * (ADR-0143 decision 5, #1896).
 *
 * The registry (`place_identifiers`) is derived from the columns that carry
 * identifiers, so a curator's correction is not an edit of a column: it is a
 * row of `place_identifier_verdicts`, which the deriving functions read, and
 * the registry row follows it at once (the trigger on the verdicts). A run
 * writing the column again changes nothing, since the word stands over the
 * columns: that is the curator's pin. The common case of two places claiming
 * one identifier is two places that are one thing, which a merge settles; the
 * word is for an identifier that names another thing.
 *
 * GET /api/experiences/:id/identifiers      the place's identifiers, with the other places each is held by
 * POST /api/experiences/:id/identifiers     { scheme, value, verdict, note? }
 *
 * Both in the scope of the place as a whole (`resolveExperienceScope`, #1893).
 * This module is the one writer of `place_identifier_verdicts`.
 */

import type { z } from 'zod/v4';
import type { IdentifierSettled, PlaceIdentifiers } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience, type LockedExperience } from '../../db/experienceWriter.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type { idParamSchema, identifierVerdictBodySchema } from '../../types/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { takeBackIdentifierVerdict, writeIdentifierVerdict } from './placeIdentifierVerdictWriter.js';
import type { AnswerRefusal } from './lifecycleController.js';
import type { PoolClient } from 'pg';
import type { IdentifierScheme, IdentifierVerdict } from '@tyr/shared/identifiers';

type IdentifierVerdictBody = z.output<typeof identifierVerdictBodySchema>;

/**
 * The place's identifiers: every registry row, and every verdict, since a
 * `removed` one has no registry row and is still the curator's to take back.
 * Each carries the other live places the registry holds the value on, so a
 * curator sees who else claims it before deciding.
 */
const IDENTIFIER_ROWS_SQL = `
  WITH keys AS (
    SELECT scheme, value FROM place_identifiers WHERE experience_id = $1
    UNION
    SELECT scheme, value FROM place_identifier_verdicts WHERE experience_id = $1
  )
  SELECT k.scheme, k.value,
         COALESCE(pi.identifies, false) AS identifies,
         COALESCE(pi.claims_identity, false) AS claims_identity,
         COALESCE(pi.basis, '{}'::text[]) AS basis,
         v.verdict, v.note,
         COALESCE((SELECT json_agg(json_build_object('id', o.experience_id, 'name', oe.name, 'identifies', o.identifies)
                            ORDER BY o.experience_id)
                     FROM place_identifiers o JOIN experiences oe ON oe.id = o.experience_id
                    WHERE o.scheme = k.scheme AND o.value = k.value AND o.experience_id <> $1), '[]'::json) AS others
    FROM keys k
    LEFT JOIN place_identifiers pi ON pi.experience_id = $1 AND pi.scheme = k.scheme AND pi.value = k.value
    LEFT JOIN place_identifier_verdicts v ON v.experience_id = $1 AND v.scheme = k.scheme AND v.value = k.value
   ORDER BY k.scheme, k.value`;

type IdentifierRow = {
  scheme: IdentifierScheme; value: string; identifies: boolean; claims_identity: boolean; basis: string[];
  verdict: IdentifierVerdict | null; note: string | null;
  others: { id: number; name: string; identifies: boolean }[];
};

async function placeExists(experienceId: number): Promise<boolean> {
  return ((await pool.query('SELECT 1 FROM experiences WHERE id = $1', [experienceId])).rowCount ?? 0) > 0;
}

/** GET /api/experiences/:id/identifiers */
export async function getPlaceIdentifiers(
  { params: { id }, caller }: { params: z.output<typeof idParamSchema>; caller: Express.User },
): Promise<PlaceIdentifiers> {
  if (!(await placeExists(id))) throw notFound('Experience not found');
  const { permitted } = await resolveExperienceScope(caller.id, caller.role, id, 'place');
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  const rows = await pool.query<IdentifierRow>(IDENTIFIER_ROWS_SQL, [id]);
  return {
    experienceId: id,
    identifiers: rows.rows.map(row => ({
      scheme: row.scheme, value: row.value, identifies: row.identifies, claimsIdentity: row.claims_identity,
      basis: row.basis, verdict: row.verdict, note: row.note, others: row.others,
    })),
  };
}

/** POST /api/experiences/:id/identifiers */
export async function settlePlaceIdentifier(
  { params: { id }, body, caller }: {
    params: z.output<typeof idParamSchema>; body: IdentifierVerdictBody; caller: Express.User;
  },
): Promise<IdentifierSettled> {
  if (!(await placeExists(id))) throw notFound('Experience not found');
  const { permitted, logRegionId } = await resolveExperienceScope(caller.id, caller.role, id, 'place');
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  const outcome = await settleIdentifierUnderLock(id, caller.id, logRegionId, body);
  if (outcome.refusal) {
    const { status, ...refusal } = outcome.refusal;
    throw new Refusal(status, refusal);
  }
  return outcome.result!;
}

/** The registry's row for one value of the place, as it stands in this transaction. */
async function registryRow(
  client: PoolClient, lock: LockedExperience, scheme: string, value: string,
): Promise<{ identifies: boolean; claims_identity: boolean } | null> {
  return (await client.query<{ identifies: boolean; claims_identity: boolean }>(
    `SELECT identifies, claims_identity FROM place_identifiers WHERE experience_id = $1 AND scheme = $2 AND value = $3`,
    [lock.id, scheme, value],
  )).rows[0] ?? null;
}

/**
 * The word, under the place's lock and the value's keys: the row before, the
 * refusals, the verdict row, the registry's refresh (by trigger), and one row
 * of the curation log. Exported for the database lane's spec.
 */
export async function settleIdentifierUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  { scheme, value, verdict, note }: IdentifierVerdictBody,
): Promise<{ result?: IdentifierSettled; refusal?: AnswerRefusal }> {
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
    // The value's keys, as every writer of an identifier takes them after the
    // place's row (ADR-0143 decision 3): a run about to create a place for this
    // value waits, then finds what this word made of it.
    await client.query(`SELECT lock_place_identifiers($1, ARRAY[$2::text])`, [scheme, value]);

    const before = await registryRow(client, locked.lock, scheme, value);
    const standing = (await client.query<{ verdict: string }>(
      `SELECT verdict FROM place_identifier_verdicts WHERE experience_id = $1 AND scheme = $2 AND value = $3`,
      [experienceId, scheme, value],
    )).rows[0]?.verdict ?? null;

    if (verdict === 'derived') {
      if (standing === null) {
        return await refuse({ status: 409, error: 'No curator’s word stands on this identifier — the sources already decide it' });
      }
      await takeBackIdentifierVerdict(client, { experienceId, scheme, value });
    } else {
      if (verdict !== 'identifies' && before === null && standing === null) {
        return await refuse({ status: 409, error: `This place does not carry ${value}` });
      }
      if (verdict === 'identifies') {
        // One live place per identifying value (ADR-0143 decision 2): the other
        // holder is named, since the answer is mostly a merge of the two.
        const holder = (await client.query<{ id: number; name: string }>(
          `SELECT pi.experience_id AS id, e.name FROM place_identifiers pi JOIN experiences e ON e.id = pi.experience_id
            WHERE pi.scheme = $1 AND pi.value = $2 AND pi.identifies AND pi.experience_id <> $3`,
          [scheme, value, experienceId],
        )).rows[0];
        if (holder) {
          return await refuse({
            status: 409,
            error: `${value} already identifies ${holder.name} (#${holder.id}) — merge the two if they are one place, or take it off that place first`,
          });
        }
      }
      await writeIdentifierVerdict(client, { experienceId, scheme, value, verdict, userId, note: note ?? null });
    }

    const after = await registryRow(client, locked.lock, scheme, value);
    await client.query(
      `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
       VALUES ($1, $2, 'identifier_settled', $3, $4)`,
      [experienceId, userId, logRegionId, JSON.stringify({
        scheme, value, verdict,
        before: { identifies: before?.identifies ?? false, claimsIdentity: before?.claims_identity ?? false, verdict: standing },
        after: { identifies: after?.identifies ?? false },
        note: note ?? null,
      })],
    );
    await client.query('COMMIT');
    return { result: { experienceId, scheme, value, verdict, identifies: after?.identifies ?? false } };
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}
