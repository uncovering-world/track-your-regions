/**
 * A curator taking back a near pair's *part of* or *two places* (#1991).
 * POST /api/experiences/:id/merge-proposals/:proposalId/take-back
 *
 * The answer may be the pass's, read off Wikidata's statement that one
 * place's item is part of the other's (ADR-0150), or a curator's. Either way
 * the take-back opens the pair again, so it is back on the review queue, and
 * marks it, so the pass never answers it from Wikidata a second time: a
 * curator who said no to the statement is not overruled by the next drain.
 * *One place* is not taken back here: its merge is undone from the history,
 * which opens the pair with it (`reopenMergedPair`).
 *
 * Behind the pair's advisory lock, as an answer is (`answerOnePair`), then
 * both places' locks; scoped by the sources of both places' memberships, as
 * the answer was, falling back to the place as a whole where neither has one.
 */

import type { z } from 'zod/v4';
import type { MergeProposalTakenBack } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockTwoExperiences } from '../../db/experienceWriter.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type { mergeProposalParamsSchema } from '../../types/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { takeBackMergeProposal } from './mergeProposalAnswers.js';

/** The answered pair as the request finds it, with the sources of both places' memberships. */
interface AnsweredPair {
  id: number;
  place_a: number;
  place_b: number;
  other_name: string;
  source_ids: number[] | null;
}

const RELOAD = ' — reload the history to see where it stands';

export async function takeBackMergeProposalAnswer(
  { params: { id, proposalId }, caller }: { params: z.output<typeof mergeProposalParamsSchema>; caller: Express.User },
): Promise<MergeProposalTakenBack> {
  const found = await pool.query<AnsweredPair>(
    `SELECT p.id, p.place_a, p.place_b, b.name AS other_name,
            (SELECT array_agg(DISTINCT m.source_id) FROM ${MEMBERSHIPS} m
              WHERE m.experience_id IN (p.place_a, p.place_b)) AS source_ids
       FROM experience_merge_proposals p
       JOIN experiences b ON b.id = p.place_b
      WHERE p.id = $1 AND p.place_a = $2`,
    [proposalId, id],
  );
  const pair = found.rows[0];
  if (!pair) throw notFound('Pair not found');
  let logRegionId: number | null = null;
  let permitted = false;
  for (const sourceId of pair.source_ids?.length ? pair.source_ids : ['place' as const]) {
    const scope = await resolveExperienceScope(caller.id, caller.role, id, sourceId);
    if (scope.permitted) { ({ permitted, logRegionId } = scope); break; }
  }
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);

  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const refuse = async (status: number, error: string): Promise<never> => {
      unusable = await rollbackQuietly(client);
      throw new Refusal(status, { error });
    };
    // The pair's own lock first, as an answer takes it: a take-back and an
    // answer of one pair serialise rather than one overwriting the other.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`merge_proposal:${pair.id}`]);
    const locked = await lockTwoExperiences(client, pair.place_a, pair.place_b);
    if (!locked) return await refuse(404, `One of the two places is gone${RELOAD}`);
    const locks = { a: locked.get(pair.place_a)!.lock, b: locked.get(pair.place_b)!.lock };
    const taken = await takeBackMergeProposal(client, locks, pair.id);
    if (!taken) {
      return await refuse(409, `This pair is not answered part of or two places — a merge is undone from its own row${RELOAD}`);
    }
    await client.query(
      `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
       VALUES ($1, $2, 'merge_proposal_taken_back', $3, $4)`,
      [pair.place_a, caller.id, logRegionId, JSON.stringify({
        proposalId: pair.id, otherId: pair.place_b, otherName: pair.other_name, answer: taken.answer,
        ...(taken.partId === null ? {} : { partId: taken.partId }), ...(taken.catalogue ? { catalogue: 'wikidata' } : {}),
      })],
    );
    await client.query('COMMIT');
    return { proposalId: pair.id, answer: taken.answer, partId: taken.partId, catalogue: taken.catalogue };
  } catch (error) {
    if (!(error instanceof Refusal)) unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}
