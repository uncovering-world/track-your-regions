/**
 * A curator makes a place a part of a place made of parts, or takes it out,
 * from either place's card (#2118).
 *
 * POST /api/experiences/:id/parts            { partId, note?, makesWhole? }
 * POST /api/experiences/:id/parts/take-out   { partId, note? }
 *
 * `:id` is the whole in both, whichever card the curator stands on. The word is
 * a record of the Curators source in the whole (`setCuratorPartRecord`), and
 * "part of" follows the records (`parts_follow_records()`, ADR-0198 decision
 * 5): a curator's record decides the pair alone, so no run undoes it.
 *
 * - **Adding** a place no record keeps out writes an admitted record: the
 *   Giralda put into its Seville site, the three works of the Brâncuși
 *   ensemble into the ensemble. Adding one the curator kept out is putting it
 *   back: the refusal is withdrawn where a source still names the place, so
 *   the sources decide the pair again, and turned into an admission where none
 *   does.
 * - **Taking out** a place a source names writes a refused record, which keeps
 *   it out while UNESCO's list still names it: Thessaloniki's line "Rotunda",
 *   held by the Arch of Galerius and Rotunda. A place only the curator's word
 *   made a part loses that word, and with it the whole.
 *
 * Refused, with nothing written: a place in itself; a loop, where the whole is
 * already one of the place's parts, at any depth; a chain longer than
 * `MOST_LEVELS` places (#2126's rule, applied here since a curator can make
 * one); a place folded into another. Curators' words take one key in turn
 * (`holdPartWords`), so two words on disjoint pairs cannot make a chain too
 * deep together: with B over Z over C standing, B put under A and D under C. The first part of a place makes it a
 * place made of parts (ADR-0203), which is never merged and claims no item:
 * so a place a standing merge sits on is refused until the merge is undone,
 * and a place standing in a kind of its own takes its first part only when the
 * request says it knows (`makesWhole`), or when the part is one it had, put
 * back.
 *
 * The scope is both places': the edit changes the whole's places and the
 * part's card, so the caller's scope reaches each as a place
 * (`resolveExperienceScope(…, 'place')`), and each place's history names the
 * region its own authority came from.
 */

import type { PoolClient } from 'pg';
import type { z } from 'zod/v4';
import type { PartWordAnswered } from '../../api/responses/parts.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockTwoExperiences, type LockedExperience } from '../../db/experienceWriter.js';
import { PART_WORDS_LOCK } from '../../db/locks.js';
import { CURATOR_SOURCE_ID, MEMBERSHIPS, kindRecordSql } from '../../db/membership.js';
import { badRequest, createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type { idParamSchema } from '../../types/index.js';
import type { partWordBodySchema, takeOutPartBodySchema } from '../../types/partSchemas.js';
import { resolveExperienceScope } from './experienceScope.js';
import type { AnswerRefusal } from './lifecycleController.js';
import { setCuratorPartRecord, withdrawCuratorPartRecord } from './membershipWriter.js';

type PartWord = z.output<typeof partWordBodySchema>;
type TakeOut = z.output<typeof takeOutPartBodySchema>;

/** The longest chain of places, whole over part, a curator may make (#2126). */
export const MOST_LEVELS = 4;

/** Who may act, and the region each place's history names. */
interface Authority {
  userId: number;
  wholeRegionId: number | null;
  partRegionId: number | null;
}

/** What the pair holds, read under both locks. */
interface PairState {
  whole_name: string;
  part_name: string;
  standing: boolean;
  curator: 'admitted' | 'refused' | null;
  other_claims: number;
  whole_has_parts: boolean;
  whole_in_kind: boolean;
  whole_merged_onto: boolean;
  loop: boolean;
  above: string[];
  below: string[];
}

export async function addPart(
  { params: { id: wholeId }, body, caller }: {
    params: z.output<typeof idParamSchema>; body: PartWord; caller: Express.User;
  },
): Promise<PartWordAnswered> {
  const authority = await authorityOver(caller, wholeId, body.partId);
  return settle(await underLocks(wholeId, body.partId, (client, locks, state) =>
    addWithin(client, locks, state, authority, body)));
}

export async function takeOutPart(
  { params: { id: wholeId }, body, caller }: {
    params: z.output<typeof idParamSchema>; body: TakeOut; caller: Express.User;
  },
): Promise<PartWordAnswered> {
  const authority = await authorityOver(caller, wholeId, body.partId);
  return settle(await underLocks(wholeId, body.partId, (client, locks, state) =>
    takeOutWithin(client, locks, state, authority, body)));
}

function settle(outcome: { result?: PartWordAnswered; refusal?: AnswerRefusal }): PartWordAnswered {
  if (outcome.refusal) {
    const { status, ...refusal } = outcome.refusal;
    throw new Refusal(status, refusal);
  }
  return outcome.result!;
}

/** Both places exist and the caller's scope reaches each as a place; refused otherwise. */
async function authorityOver(caller: Express.User, wholeId: number, partId: number): Promise<Authority> {
  if (wholeId === partId) throw badRequest('A place cannot be a part of itself');
  const found = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM experiences WHERE id = ANY($1::int[])', [[wholeId, partId]],
  );
  if (found.rows[0].n < 2) throw notFound('Experience not found');
  const [whole, part] = await Promise.all([
    resolveExperienceScope(caller.id, caller.role, wholeId, 'place'),
    resolveExperienceScope(caller.id, caller.role, partId, 'place'),
  ]);
  if (!whole.permitted || !part.permitted) {
    throw createError('You do not have curator permissions for both places', 403);
  }
  return { userId: caller.id, wholeRegionId: whole.logRegionId, partRegionId: part.logRegionId };
}

type Locks = { whole: LockedExperience; part: LockedExperience };
type Within = (client: PoolClient, locks: Locks, state: PairState) =>
  Promise<{ result: PartWordAnswered } | { refusal: AnswerRefusal }>;

/**
 * The one key curators' words on parts take in turn (`db/locks.ts`, § A
 * curator's word on a part): two words on disjoint pairs read the same
 * chains, so the second waits for the first and is judged on what it wrote.
 */
export async function holdPartWords(client: PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1, 0)', [PART_WORDS_LOCK]);
}

/**
 * One transaction: both object locks in id order, then the key curators'
 * words take in turn (`holdPartWords`), then the region keys the relation's
 * refresh reaches, then the pair read in a statement of its own (`db/locks.ts`
 * § the snapshot), then the write and both histories.
 */
async function underLocks(
  wholeId: number,
  partId: number,
  within: Within,
): Promise<{ result?: PartWordAnswered; refusal?: AnswerRefusal }> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const refuse = async (refusal: AnswerRefusal): Promise<{ refusal: AnswerRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal };
    };
    const locked = await lockTwoExperiences(client, wholeId, partId);
    if (!locked) return await refuse({ status: 404, error: 'Experience not found' });
    const whole = locked.get(wholeId)!;
    const part = locked.get(partId)!;
    if (whole.mergedInto !== null || part.mergedInto !== null) {
      return await refuse({ status: 409, error: 'One of the two places has been merged into another' });
    }
    await holdPartWords(client);
    await client.query('SELECT lock_place_regions(ARRAY[$1::int, $2::int])', [wholeId, partId]);
    const state = await readPair(client, wholeId, partId);
    const outcome = await within(client, { whole: whole.lock, part: part.lock }, state);
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

/**
 * The pair as it stands: whether the relation stands, the curator's word on
 * it and how many sources' records claim it, whether the whole is one yet, and
 * the chains a new relation would join — the wholes above the whole, the
 * parts below the place, each the longest, by name, and whether the whole is
 * already under the place (a loop).
 */
async function readPair(client: PoolClient, wholeId: number, partId: number): Promise<PairState> {
  const read = await client.query<PairState>(
    `WITH RECURSIVE above AS (
       SELECT $1::int AS id, ARRAY[$1::int] AS chain
       UNION ALL
       SELECT prt.whole_id, prt.whole_id || a.chain FROM experience_parts prt JOIN above a ON prt.part_id = a.id
        WHERE NOT prt.whole_id = ANY(a.chain) AND cardinality(a.chain) <= ${MOST_LEVELS}
     ), below AS (
       SELECT $2::int AS id, ARRAY[$2::int] AS chain
       UNION ALL
       SELECT prt.part_id, b.chain || prt.part_id FROM experience_parts prt JOIN below b ON prt.whole_id = b.id
        WHERE NOT prt.part_id = ANY(b.chain) AND cardinality(b.chain) <= ${MOST_LEVELS}
     ),
     longest_above AS (SELECT chain FROM above ORDER BY cardinality(chain) DESC LIMIT 1),
     longest_below AS (SELECT chain FROM below ORDER BY cardinality(chain) DESC LIMIT 1)
     SELECT (SELECT name FROM experiences WHERE id = $1) AS whole_name,
            (SELECT name FROM experiences WHERE id = $2) AS part_name,
            EXISTS (SELECT 1 FROM experience_parts WHERE whole_id = $1 AND part_id = $2) AS standing,
            (SELECT rec.admission FROM ${MEMBERSHIPS} rec
              WHERE rec.source_id = ${CURATOR_SOURCE_ID} AND rec.whole_id = $1 AND rec.experience_id = $2) AS curator,
            (SELECT count(*)::int FROM ${MEMBERSHIPS} rec
              WHERE rec.source_id <> ${CURATOR_SOURCE_ID} AND rec.whole_id = $1 AND rec.experience_id = $2) AS other_claims,
            EXISTS (SELECT 1 FROM experience_parts WHERE whole_id = $1) AS whole_has_parts,
            EXISTS (SELECT 1 FROM ${MEMBERSHIPS} own WHERE own.experience_id = $1 AND ${kindRecordSql('own')}) AS whole_in_kind,
            EXISTS (SELECT 1 FROM experience_merges m WHERE m.survivor_id = $1 AND m.undone_at IS NULL) AS whole_merged_onto,
            EXISTS (SELECT 1 FROM below WHERE id = $1) AS loop,
            ARRAY(SELECT e.name FROM longest_above, unnest(longest_above.chain) WITH ORDINALITY AS c(id, n)
                    JOIN experiences e ON e.id = c.id ORDER BY c.n) AS above,
            ARRAY(SELECT e.name FROM longest_below, unnest(longest_below.chain) WITH ORDINALITY AS c(id, n)
                    JOIN experiences e ON e.id = c.id ORDER BY c.n) AS below`,
    [wholeId, partId],
  );
  return read.rows[0];
}

/** The refusals an add meets before it writes, or null where none does. */
function addRefusal(state: PairState, makesWhole: boolean): AnswerRefusal | null {
  if (state.loop) {
    return {
      status: 409, code: 'loop',
      error: `${state.whole_name} is already one of ${state.part_name}'s parts. A whole cannot become a part of its own part.`,
    };
  }
  const chain = [...state.above, ...state.below];
  if (chain.length > MOST_LEVELS) {
    return {
      status: 409, code: 'too-deep', chain,
      error: `It would sit ${chain.length} levels down, and ${MOST_LEVELS} is the most. Add it to a whole higher up the chain.`,
    };
  }
  if (!state.whole_has_parts && state.whole_merged_onto) {
    return {
      status: 409, code: 'merged-onto',
      error: `Another place was merged into ${state.whole_name}, and a place made of parts is never merged. `
        + 'Undo that merge from its history first.',
    };
  }
  if (!state.whole_has_parts && state.whole_in_kind && !makesWhole) {
    return {
      status: 409, code: 'makes-whole',
      error: `Its first part makes ${state.whole_name} a place made of parts. It is then never merged, and its `
        + 'Wikidata item no longer finds it.',
    };
  }
  return null;
}

async function addWithin(
  client: PoolClient, locks: Locks, state: PairState, authority: Authority, body: PartWord,
): Promise<{ result: PartWordAnswered } | { refusal: AnswerRefusal }> {
  if (state.standing) {
    return { refusal: { status: 409, error: `${state.part_name} is a part of ${state.whole_name} already` } };
  }
  const puttingBack = state.curator === 'refused';
  // Putting back a part the whole had asks nothing: the curator emptied it.
  const refusal = addRefusal(state, body.makesWhole === true || puttingBack);
  if (refusal) return { refusal };
  // A refusal of a place a source names is withdrawn, so the sources decide
  // the pair again; with no source left to name it, the word becomes an
  // admission, since withdrawing it would leave the place out.
  let recordId: number | null = null;
  if (puttingBack && state.other_claims > 0) await withdrawCuratorPartRecord(client, locks.whole, locks.part);
  else recordId = await setCuratorPartRecord(client, locks.whole, locks.part, 'admitted', authority.userId);
  const becameWhole = !state.whole_has_parts;
  await logOnBoth(client, puttingBack ? 'part_put_back' : 'part_added', locks, authority, {
    wholeName: state.whole_name, partName: state.part_name, recordId, note: body.note ?? null, becameWhole,
  });
  return {
    result: {
      wholeId: locks.whole.id, partId: locks.part.id, act: puttingBack ? 'put_back' : 'added',
      standing: true, keptOut: false, recordId, becameWhole,
    },
  };
}

async function takeOutWithin(
  client: PoolClient, locks: Locks, state: PairState, authority: Authority, body: TakeOut,
): Promise<{ result: PartWordAnswered } | { refusal: AnswerRefusal }> {
  if (!state.standing) {
    return { refusal: { status: 409, error: `${state.part_name} is not a part of ${state.whole_name}` } };
  }
  // A place a source names is kept out by the curator's refusal, which no run
  // undoes; one only the curator's word made a part simply leaves.
  const keptOut = state.other_claims > 0;
  let recordId: number | null = null;
  if (keptOut) recordId = await setCuratorPartRecord(client, locks.whole, locks.part, 'refused', authority.userId);
  else await withdrawCuratorPartRecord(client, locks.whole, locks.part);
  await logOnBoth(client, 'part_taken_out', locks, authority, {
    wholeName: state.whole_name, partName: state.part_name, recordId, note: body.note ?? null, keptOut,
  });
  return {
    result: {
      wholeId: locks.whole.id, partId: locks.part.id, act: 'taken_out',
      standing: false, keptOut, recordId, becameWhole: false,
    },
  };
}

/** The same act on both places' histories, each naming the region its own authority came from. */
async function logOnBoth(
  client: PoolClient,
  action: 'part_added' | 'part_taken_out' | 'part_put_back',
  { whole, part }: Locks,
  { userId, wholeRegionId, partRegionId }: Authority,
  detail: Record<string, unknown>,
): Promise<void> {
  const details = JSON.stringify({ wholeId: whole.id, partId: part.id, ...detail });
  await client.query(
    `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
     VALUES ($1, $3, $4, $5, $7), ($2, $3, $4, $6, $7)`,
    [whole.id, part.id, userId, action, wholeRegionId, partRegionId, details],
  );
}
