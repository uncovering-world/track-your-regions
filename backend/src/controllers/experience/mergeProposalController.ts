/**
 * A curator's answer to pairs of near places with similar names (#1249,
 * ADR-0046 decisions 2 to 4). POST /api/experiences/:id/merge-proposals
 *
 * A pair is a proposal by place and name, never a fact (ADR-0046 decision
 * 2): the curator says what the two are. *One place* runs the merge the
 * equal-item pass runs for a shared item (`mergePlaces`, ADR-0086), the other
 * place folded into this one, the lower id; the merge is undone from the
 * history like any other. *Two places* keeps the pair apart and never
 * proposed again (decision 4). *Part of* records which place is the part on
 * the proposal, for #823, and merges nothing (decision 6). Each answer is one
 * act of the curation log on the place that stays, beside the merged row the
 * merge itself writes.
 *
 * Each pair is its own act, behind an advisory lock on the pair: the merge
 * owns its transaction (ADR-0086) and a pair it refuses — both places in one
 * kind, one already merged — is reported with why while the other pairs
 * stand; two curators answering one pair at once serialise, and the second
 * reads it as answered and writes nothing. Each pair is scoped on its own, by
 * the sources of its two places: a curator the card admits through one pair
 * may not answer another whose places are both outside their sources.
 */

import type { PoolClient } from 'pg';
import type { z } from 'zod/v4';
import type { MergeProposalsAnswered } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockTwoExperiences } from '../../db/experienceWriter.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type { answerMergeProposalsBodySchema, idParamSchema } from '../../types/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { answerMergeProposal, type MergeProposalAnswer } from './mergeProposalAnswers.js';
import { mergePlaces } from './placeMerge.js';
import { mergeProposalOpenSql } from './reviewQueuePredicates.js';

/** One pair and the answer the curator gives it; `partId` names the part for `part_of`. */
export interface PairAnswer {
  proposalId: number;
  answer: MergeProposalAnswer;
  partId?: number;
}

interface Refused {
  proposalId: number;
  error: string;
}

const RELOAD = ' — reload to see where it stands';

/** An open pair of the anchor's, as it stands, with the sources of both places' memberships. */
interface OpenPair {
  id: number;
  place_a: number;
  place_b: number;
  other_name: string;
  source_ids: number[];
}

/** The pair, read on `client` so the read sits behind the pair's advisory lock. */
async function openPair(client: PoolClient, anchorId: number, proposalId: number): Promise<OpenPair | null> {
  const result = await client.query<OpenPair>(
    `SELECT p.id, p.place_a, p.place_b, b.name AS other_name,
            (SELECT array_agg(DISTINCT m.source_id) FROM ${MEMBERSHIPS} m
              WHERE m.experience_id IN (p.place_a, p.place_b)) AS source_ids
       FROM experience_merge_proposals p
       JOIN experiences a ON a.id = p.place_a
       JOIN experiences b ON b.id = p.place_b
      WHERE p.id = $1 AND p.place_a = $2 AND ${mergeProposalOpenSql('p', 'a', 'b')}`,
    [proposalId, anchorId],
  );
  return result.rows[0] ?? null;
}

/**
 * Record one answer under both places' locks, with its log row: the pair is
 * read again under the lock, so one answered meanwhile is refused with
 * nothing written. `mergeId` is the merge *one place* ran before this.
 */
async function recordAnswer(
  pair: OpenPair, userId: number, logRegionId: number | null, answer: PairAnswer, mergeId: number | null,
): Promise<Refused | null> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const locked = await lockTwoExperiences(client, pair.place_a, pair.place_b);
    if (!locked) {
      unusable = await rollbackQuietly(client);
      return { proposalId: pair.id, error: `One of the two places is gone${RELOAD}` };
    }
    const locks = { a: locked.get(pair.place_a)!.lock, b: locked.get(pair.place_b)!.lock };
    const partId = answer.answer === 'part_of' ? answer.partId ?? null : null;
    const written = await answerMergeProposal(client, locks, userId, pair.id, answer.answer, partId, mergeId);
    if (!written) {
      unusable = await rollbackQuietly(client);
      return { proposalId: pair.id, error: `This pair was answered already${RELOAD}` };
    }
    await client.query(
      `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
       VALUES ($1, $2, 'merge_proposal_answered', $3, $4)`,
      [pair.place_a, userId, logRegionId, JSON.stringify({
        proposalId: pair.id, otherId: pair.place_b, otherName: pair.other_name, answer: answer.answer,
        ...(partId === null ? {} : { partId }), ...(mergeId === null ? {} : { mergeId }),
      })],
    );
    await client.query('COMMIT');
    return null;
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

/**
 * Answer the named pairs of the anchor place, each on its own: *one place*
 * merges first (the merge's own transaction and locks, ADR-0086 decision 6)
 * and records the answer with the merge's id once it stands; the other two
 * answers are recorded alone. A pair the merge refuses, or one answered
 * meanwhile, is reported and the rest go on.
 */
export async function answerMergeProposalsOneByOne(
  anchorId: number, userId: number, logRegionId: number | null, answers: readonly PairAnswer[],
  permittedSources: readonly number[],
): Promise<MergeProposalsAnswered> {
  const outcome: MergeProposalsAnswered = { experienceId: anchorId, merged: [], two: 0, partOf: 0, refused: [] };
  for (const answer of answers) {
    const done = await answerOnePair(anchorId, userId, logRegionId, answer, permittedSources);
    if ('refused' in done) {
      outcome.refused.push(done.refused);
      continue;
    }
    if (done.mergeId !== null) {
      // A merge that committed is reported as one whatever happened after it.
      outcome.merged.push({ proposalId: answer.proposalId, mergeId: done.mergeId });
      if (done.unrecorded) {
        outcome.refused.push({ proposalId: answer.proposalId, error: `Merged, but the answer could not be recorded: ${done.unrecorded}` });
      }
    } else if (answer.answer === 'two') outcome.two += 1;
    else outcome.partOf += 1;
  }
  return outcome;
}

/** What one pair's act came to: a refusal with nothing written, or the merge's id (null for *two* and *part of*) and, where the record failed after a merge stood, why. */
type PairOutcome = { refused: Refused } | { mergeId: number | null; unrecorded?: string };

/**
 * One pair's answer, start to finish, under an advisory lock on the pair
 * held for the whole act: two curators answering one pair at once serialise,
 * and the second reads the pair as answered and writes nothing — without it
 * the merge, which owns its own transaction, could run after another answer
 * recorded the pair as two places. The lock is a session lock on a client of
 * its own, since the merge and the record are two transactions.
 */
async function answerOnePair(
  anchorId: number, userId: number, logRegionId: number | null, answer: PairAnswer, permittedSources: readonly number[],
): Promise<PairOutcome> {
  const client = await pool.connect();
  const key = `merge_proposal:${answer.proposalId}`;
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
    try {
      return await answerLockedPair(client, anchorId, userId, logRegionId, answer, permittedSources);
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

/** The act itself, behind the pair's lock: the scope of this pair, the merge where the answer is *one place*, then the record. */
async function answerLockedPair(
  client: PoolClient, anchorId: number, userId: number, logRegionId: number | null, answer: PairAnswer,
  permittedSources: readonly number[],
): Promise<PairOutcome> {
  const pair = await openPair(client, anchorId, answer.proposalId);
  if (!pair) {
    return { refused: { proposalId: answer.proposalId, error: `A pair is not one of this place's, or was answered already${RELOAD}` } };
  }
  // Scoped pair by pair: a curator admitted to the card through one pair may
  // not answer another whose places are both outside their sources.
  if (!pair.source_ids.some(sourceId => permittedSources.includes(sourceId))) {
    return { refused: { proposalId: pair.id, error: 'Neither place of this pair is in a source you curate' } };
  }
  if (answer.answer === 'part_of' && answer.partId !== pair.place_a && answer.partId !== pair.place_b) {
    return { refused: { proposalId: pair.id, error: 'The part named is neither place of the pair' } };
  }
  let mergeId: number | null = null;
  if (answer.answer === 'one') {
    const merged = await mergePlaces({
      survivorId: pair.place_a, foldedId: pair.place_b, mergedBy: userId, reason: 'curator', detail: { proposalId: pair.id },
    });
    if (merged.refusal) return { refused: { proposalId: pair.id, error: merged.refusal.error } };
    mergeId = merged.result!.mergeId;
  }
  // A merge that committed stands whatever the record does after it: the
  // history has its row and the undo, so it is reported as merged, and a
  // record that could not be written — the pair's row gone meanwhile, a
  // failure in the write — travels beside it as a note rather than turning a
  // merge that happened into a refusal that says nothing did.
  try {
    const refused = await recordAnswer(pair, userId, logRegionId, answer, mergeId);
    if (!refused) return { mergeId };
    if (mergeId === null) return { refused };
    console.warn('[Merge proposals] Pair %d merged as merge %d, but the answer was not recorded: %s', pair.id, mergeId, refused.error);
    return { mergeId, unrecorded: refused.error };
  } catch (error) {
    if (mergeId === null) throw error;
    console.warn('[Merge proposals] Pair %d merged as merge %d, but recording the answer failed:', pair.id, mergeId, error);
    return { mergeId, unrecorded: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The open pairs of a place, for the batch answer (`reviewAnswerDispatch.ts`):
 * the exact ones — one and the same name within fifty metres, which a batch
 * accept makes one place — or all of them, which a batch reject keeps apart.
 */
export async function openPairs(anchorId: number, only: 'exact' | 'all'): Promise<number[]> {
  const result = await pool.query<{ id: number }>(
    `SELECT p.id
       FROM experience_merge_proposals p
       JOIN experiences a ON a.id = p.place_a
       JOIN experiences b ON b.id = p.place_b
      WHERE p.place_a = $1 AND ${mergeProposalOpenSql('p', 'a', 'b')}
        AND ($2::boolean OR p.exact)
      ORDER BY p.id`,
    [anchorId, only === 'all'],
  );
  return result.rows.map(row => row.id);
}

/**
 * The sources whose curators answer a place's pairs: every source of a
 * membership of either place of an open pair — what the queue scopes the
 * question by — or, where none is left, the place's own. Null for no such
 * place.
 */
export async function mergeProposalSourceIds(anchorId: number): Promise<number[] | null> {
  const result = await pool.query<{ source_ids: number[] | null; source_id: number }>(
    `SELECT (SELECT array_agg(DISTINCT m.source_id)
               FROM experience_merge_proposals p
               JOIN experiences a ON a.id = p.place_a
               JOIN experiences b ON b.id = p.place_b
               JOIN ${MEMBERSHIPS} m ON m.experience_id IN (p.place_a, p.place_b)
              WHERE p.place_a = e.id AND ${mergeProposalOpenSql('p', 'a', 'b')}) AS source_ids,
            e.source_id
       FROM experiences e WHERE e.id = $1`,
    [anchorId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return row.source_ids?.length ? row.source_ids : [row.source_id];
}

/**
 * Whether this caller may answer a place's pairs at all, the region the audit
 * row names, and the sources they are in scope for among the pairs' places:
 * in scope for any source of either place of an open pair, as the queue
 * admits the row (`mergeProposalsKeysSql`). The card's endpoint and the batch
 * answer (`reviewAnswerController.ts`) both ask this, never the membership a
 * client names, and each pair is then held to `sourceIds` on its own
 * (`answerLockedPair`): admitted through one pair is not admitted to every
 * pair. `permitted: false` where there is no such place.
 */
export async function mergeProposalsScope(
  userId: number, userRole: Express.User['role'], anchorId: number,
): Promise<{ permitted: boolean; logRegionId: number | null; found: boolean; sourceIds: number[] }> {
  const sourceIds = await mergeProposalSourceIds(anchorId);
  if (sourceIds === null) return { permitted: false, logRegionId: null, found: false, sourceIds: [] };
  const permittedSources: number[] = [];
  let logRegionId: number | null = null;
  for (const sourceId of sourceIds) {
    const scope = await resolveExperienceScope(userId, userRole, anchorId, sourceId);
    if (!scope.permitted) continue;
    if (permittedSources.length === 0) logRegionId = scope.logRegionId;
    permittedSources.push(sourceId);
  }
  return { permitted: permittedSources.length > 0, logRegionId, found: true, sourceIds: permittedSources };
}

/** The card's answer: one place, two places or one part of the other, per pair, each in the scope of its own places' sources. */
export async function answerMergeProposals(
  { params: { id }, body, caller }: {
    params: z.output<typeof idParamSchema>; body: z.output<typeof answerMergeProposalsBodySchema>; caller: Express.User;
  },
): Promise<MergeProposalsAnswered> {
  const { permitted, logRegionId, found, sourceIds } = await mergeProposalsScope(caller.id, caller.role, id);
  if (!found) throw notFound('Experience not found');
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  const outcome = await answerMergeProposalsOneByOne(id, caller.id, logRegionId, body.answers, sourceIds);
  // Every pair refused and none written is the request refused, with the first reason.
  if (outcome.merged.length === 0 && outcome.two === 0 && outcome.partOf === 0 && outcome.refused.length > 0) {
    throw new Refusal(409, { error: outcome.refused[0].error, refused: outcome.refused });
  }
  return outcome;
}
