/**
 * A curator moves a World Heritage list line from the place that holds it to
 * the place it names, in one act (#2527).
 *
 * POST /api/experiences/:id/parts/replace   { partId, withId, note? }
 *
 * `:id` is the whole. Thessaloniki's site names a line "Rotunda", and the line
 * is held by the place "Arch of Galerius and Rotunda", whose picture is the
 * arch; the Rotunda stands 151 m away as a place of its own. *Take out…* then
 * *Add* left the site a line short in between and took two Undos. This act
 * moves the line instead: its record of World Heritage components (reference,
 * ordinal, the list's name for it) and its line points go to `withId` together
 * (`movePartLineRecord`, `movePoints`), since a site's run finds a line by its
 * point and would pull a record that moved alone back to the arch (#2124 is
 * where a line is found by its record). The record's gate follows the new
 * place's line points (`refresh_part_record_gates()`). A line whose point is
 * the old place's own, under its own item and placed by its kind as well as by
 * the site (Thessaloniki's 456-002 on the arch's point), hands over the record
 * alone: the point stays where it stands, the answer says no point moved, and
 * the record, on a place with no line point, keeps its gate until #2124 reads
 * a part by its record alone.
 *
 * The place the line leaves is taken out as *Take out…* takes one out: kept out
 * by a refused curator record where another source still names it, and
 * otherwise left with no word, since no list names it now. A curator's refusal
 * of the place the line reaches is withdrawn, so the list's record decides it,
 * as it does every other line.
 *
 * The request names the line (`reference`), and is refused when `partId` holds
 * another one now. An Undo names the move it reverses (`undoes`, that move's
 * history row on the whole), which must be the line's latest move: it moves
 * back the points that move moved and no other, and sets both places' curator
 * words back to what they were before it, rather than applying the rules of a
 * new move to them. Each move records those for its Undo (`pointIds`,
 * `fromCurator`, `toCurator`).
 *
 * Refused, with nothing written: a place given twice; a place the line does
 * not hold; a line other than the one named; an Undo of a move that is not
 * the line's latest; a place that holds a line of this list already; a place the whole
 * may not take as a part (`addRefusal`: a loop, a chain too deep). The caller's
 * scope reaches all three places, and each place's history names the region
 * its own authority came from.
 */

import type { PoolClient } from 'pg';
import type { z } from 'zod/v4';
import type { PartLineMoved } from '../../api/responses/parts.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockPlaces, type LockedExperience } from '../../db/experienceWriter.js';
import { logCurationActs } from '../../db/curationLogWriter.js';
import { MEMBERSHIPS, componentRecordSql } from '../../db/membership.js';
import { badRequest, createError, notFound } from '../../middleware/errorHandler.js';
import type { idParamSchema } from '../../types/index.js';
import type { replacePartBodySchema } from '../../types/partSchemas.js';
import { resolveExperienceScope } from './experienceScope.js';
import { movePoints } from './experienceLocationWriter.js';
import type { AnswerRefusal } from './lifecycleController.js';
import {
  movePartLineRecord, setCuratorPartRecord, withdrawCuratorPartRecord,
} from './membershipWriter.js';
import { addRefusal, holdPartWords, readPair, settle, type PairState } from './partRecordController.js';

type Replace = z.output<typeof replacePartBodySchema>;

interface Places { whole: LockedExperience; from: LockedExperience; to: LockedExperience }

/** The line `from` holds in the whole, as the list gives it. */
interface Line { id: number; reference: string; name: string | null }

export async function replacePartPlace(
  { params: { id: wholeId }, body, caller }: {
    params: z.output<typeof idParamSchema>; body: Replace; caller: Express.User;
  },
): Promise<PartLineMoved> {
  const ids = [wholeId, body.partId, body.withId];
  if (new Set(ids).size < 3) throw badRequest('The whole, the place that holds the line and the place it moves to must be three places');
  const regions = await authorityOver(caller, ids);
  return settle(await underLocks(ids, (client, places) => replaceWithin(client, places, caller, regions, body)));
}

/** Every place exists and the caller's scope reaches each; the region each history names, by place. */
async function authorityOver(caller: Express.User, ids: number[]): Promise<Map<number, number | null>> {
  const found = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM experiences WHERE id = ANY($1::int[])', [ids]);
  if (found.rows[0].n < ids.length) throw notFound('Experience not found');
  const scopes = await Promise.all(ids.map(id => resolveExperienceScope(caller.id, caller.role, id, 'place')));
  if (scopes.some(scope => !scope.permitted)) {
    throw createError('You do not have curator permissions for all three places', 403);
  }
  return new Map(ids.map((id, i) => [id, scopes[i].logRegionId]));
}

type Within = (client: PoolClient, places: Places) => Promise<{ result: PartLineMoved } | { refusal: AnswerRefusal }>;

/**
 * One transaction under the three places' object locks in the place order
 * (`lockPlaces`), then the key curators' words take in turn, then the region
 * keys the points' and the relation's refresh reach, as a word on a pair takes
 * them (`partRecordController.ts`).
 */
async function underLocks(
  [wholeId, fromId, toId]: number[],
  within: Within,
): Promise<{ result?: PartLineMoved; refusal?: AnswerRefusal }> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const refuse = async (refusal: AnswerRefusal): Promise<{ refusal: AnswerRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal };
    };
    const locked = await lockPlaces(client, [wholeId, fromId, toId]);
    if (!locked) return await refuse({ status: 404, error: 'Experience not found' });
    if ([...locked.values()].some(place => place.mergedInto !== null)) {
      return await refuse({ status: 409, error: 'One of the three places has been merged into another' });
    }
    await holdPartWords(client);
    await client.query('SELECT lock_place_regions($1::int[])', [[wholeId, fromId, toId]]);
    const outcome = await within(client, {
      whole: locked.get(wholeId)!.lock, from: locked.get(fromId)!.lock, to: locked.get(toId)!.lock,
    });
    if ('refusal' in outcome) return await refuse(outcome.refusal);
    await client.query('COMMIT');
    return outcome;
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

/** The line `place` holds in `whole`, or null. */
async function lineOf(client: PoolClient, whole: LockedExperience, place: LockedExperience): Promise<Line | null> {
  const read = await client.query<Line>(
    `SELECT rec.id, rec.external_id AS reference, rec.reported_name AS name
       FROM ${MEMBERSHIPS} rec
      WHERE rec.whole_id = $1 AND rec.experience_id = $2 AND ${componentRecordSql('rec')}`,
    [whole.id, place.id],
  );
  return read.rows[0] ?? null;
}

/** What a move recorded of the places before it, for its Undo: the points it moved and both places' curator words. */
interface MoveRecord {
  fromId: number;
  toId: number;
  reference: string;
  pointIds: number[];
  fromCurator: CuratorWord;
  toCurator: CuratorWord;
}

type CuratorWord = 'admitted' | 'refused' | null;

/**
 * The move `logId` records, when it is the latest move of its line in the
 * whole, it moved the line from `withId` to `partId`, and no curator has said
 * a word on either place in the whole since: the act an Undo reverses. Null
 * otherwise, so a later move of the line, a move of another line, or a word
 * another curator said after it is never undone in its place.
 */
async function moveToUndo(
  client: PoolClient, whole: LockedExperience, logId: number, partId: number, withId: number, reference: string,
): Promise<MoveRecord | null> {
  const read = await client.query<{ details: MoveRecord }>(
    `SELECT l.details FROM experience_curation_log l
      WHERE l.id = $1 AND l.experience_id = $2 AND l.action = 'part_replaced'
        AND (l.details->>'fromId')::int = $4 AND (l.details->>'toId')::int = $3
        AND lower(l.details->>'reference') = lower($5)
        AND NOT EXISTS (SELECT 1 FROM experience_curation_log later
                         WHERE later.experience_id = $2 AND later.action = 'part_replaced' AND later.id > l.id
                           AND lower(later.details->>'reference') = lower($5))
        -- Nor a curator's word on either place in the whole since: an Undo
        -- that set the words back would erase it.
        AND NOT EXISTS (SELECT 1 FROM experience_curation_log said
                         WHERE said.experience_id IN ($3, $4) AND said.id > l.id
                           -- The move's own rows on its two places are not a word since.
                           AND said.details IS DISTINCT FROM l.details
                           AND said.action IN ('part_added', 'part_taken_out', 'part_put_back', 'part_replaced')
                           AND said.details->>'wholeId' = $2::text)`,
    [logId, whole.id, partId, withId, reference],
  );
  return read.rows[0]?.details ?? null;
}

/** A place's curator word on its pair with the whole, set back to `word`: written, or withdrawn where it had none. */
async function restoreWord(
  client: PoolClient, whole: LockedExperience, place: LockedExperience, word: CuratorWord, curatorId: number,
): Promise<void> {
  if (word) await setCuratorPartRecord(client, whole, place, word, curatorId);
  else await withdrawCuratorPartRecord(client, whole, place);
}

/**
 * What refuses the move before anything is written, or the line it moves and
 * the move it undoes: the line `from` holds must be the one named, `to` may
 * hold none and must be a place the whole can take, and an Undo's move must be
 * the line's latest between these two places.
 */
async function checkMove(
  client: PoolClient, { whole, from, to }: Places, leaving: PairState, reaching: PairState, body: Replace,
): Promise<{ line: Line; undone: MoveRecord | null } | { refusal: AnswerRefusal }> {
  const line = await lineOf(client, whole, from);
  if (!line) {
    return { refusal: { status: 409, error: `No line of ${leaving.whole_name}'s list names ${leaving.part_name}` } };
  }
  // The line the curator moves, by its reference: another line the place holds now is not it.
  if (line.reference.toLowerCase() !== body.reference.toLowerCase()) {
    return {
      refusal: {
        status: 409,
        error: `${leaving.part_name} holds the line ${line.reference} of ${leaving.whole_name}'s list, not ${body.reference}`,
      },
    };
  }
  const held = await lineOf(client, whole, to);
  if (held) {
    return {
      refusal: {
        status: 409,
        error: `${reaching.part_name} holds the line ${held.reference} of ${reaching.whole_name}'s list already`,
      },
    };
  }
  const refusal = addRefusal(reaching, true);
  if (refusal) return { refusal };
  if (body.undoes === undefined) return { line, undone: null };
  const undone = await moveToUndo(client, whole, body.undoes, from.id, to.id, line.reference);
  if (!undone) {
    return {
      refusal: { status: 409, error: `The line ${line.reference} or a word on its places has changed since, so that move is no longer the one to undo` },
    };
  }
  return { line, undone };
}

/**
 * Both places' curator words after the move. A new move takes the place the
 * line left out as *Take out…* does (the moved record no longer names it, so
 * another source's claim is what a refusal answers) and withdraws a refusal
 * of the place it reaches; an Undo sets each word back to what it was before
 * the move it reverses.
 */
async function settleWords(
  client: PoolClient, { whole, from, to }: Places, leaving: PairState, reaching: PairState,
  undone: MoveRecord | null, curatorId: number,
): Promise<{ keptOut: boolean; refusalId: number | null }> {
  if (undone) {
    await restoreWord(client, whole, from, undone.toCurator, curatorId);
    await restoreWord(client, whole, to, undone.fromCurator, curatorId);
    return { keptOut: undone.toCurator === 'refused', refusalId: null };
  }
  const keptOut = leaving.other_claims - 1 > 0;
  let refusalId: number | null = null;
  if (keptOut) refusalId = await setCuratorPartRecord(client, whole, from, 'refused', curatorId);
  else await withdrawCuratorPartRecord(client, whole, from);
  if (reaching.curator === 'refused') await withdrawCuratorPartRecord(client, whole, to);
  return { keptOut, refusalId };
}

async function replaceWithin(
  client: PoolClient, places: Places, caller: Express.User, regions: Map<number, number | null>, body: Replace,
): Promise<{ result: PartLineMoved } | { refusal: AnswerRefusal }> {
  const { whole, from, to } = places;
  const leaving = await readPair(client, whole.id, from.id, caller);
  const reaching = await readPair(client, whole.id, to.id, caller);
  const checked = await checkMove(client, places, leaving, reaching, body);
  if ('refusal' in checked) return checked;
  const { line, undone } = checked;

  // The line's points first, so the record's gate is read from where they now stand: those the
  // whole's list places and the place's own kind does not. A point the place's kind places too is
  // the place's own (the arch's, which Thessaloniki's line was pinned to) and stays where it is,
  // either way. An Undo moves back only the points its move moved, and no other point on the place.
  const ownPointSql = `EXISTS (SELECT 1 FROM experience_location_placements own_pl
                                 JOIN ${MEMBERSHIPS} own ON own.id = own_pl.membership_id
                                WHERE own_pl.location_id = el.id AND own.experience_id = el.experience_id
                                  AND own.kind_id IS NOT NULL)`;
  const points = await client.query<{ id: number }>(
    undone
      ? `SELECT el.id FROM experience_locations el
          WHERE el.experience_id = $1 AND el.merged_into_id IS NULL AND el.id = ANY($2::int[])
            AND is_part_line_point(el.id, $3) AND NOT ${ownPointSql}`
      : `SELECT el.id FROM experience_locations el
          WHERE el.experience_id = $2 AND el.merged_into_id IS NULL
            AND lower(el.external_ref) = lower($3) AND is_part_line_point(el.id, $1) AND NOT ${ownPointSql}`,
    undone ? [from.id, undone.pointIds, whole.id] : [whole.id, from.id, line.reference],
  );
  const movedPoints = await movePoints(client, from, to, points.rows.map(row => row.id));
  await movePartLineRecord(client, whole, from, to);

  const { keptOut, refusalId } = await settleWords(client, places, leaving, reaching, undone, caller.id);

  const details = {
    wholeId: whole.id, fromId: from.id, toId: to.id,
    wholeName: leaving.whole_name, fromName: leaving.part_name, toName: reaching.part_name,
    reference: line.reference, lineName: line.name, recordId: line.id, refusalId,
    points: movedPoints.length, pointIds: movedPoints, keptOut,
    fromCurator: leaving.curator, toCurator: reaching.curator, undoes: body.undoes ?? null,
    note: body.note ?? null,
  };
  // The one act on each of the three places' histories, about a record in a
  // whole, which has no kind (ADR-0198).
  const logged = await logCurationActs(client, [whole.id, from.id, to.id].map(place => ({
    experienceId: place, curatorId: caller.id, action: 'part_replaced' as const, regionId: regions.get(place), details,
  })));
  return {
    result: {
      wholeId: whole.id, fromId: from.id, toId: to.id, reference: line.reference, keptOut, points: movedPoints.length,
      logId: logged.find(row => row.experience_id === whole.id)!.id,
    },
  };
}
