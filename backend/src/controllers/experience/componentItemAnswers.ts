/**
 * The curator's writes to `experience_component_item_proposals` — a candidate
 * Wikidata item for a World Heritage component (#1272) answered — under the
 * site's lock (ADR-0077 decision 4).
 *
 * The table's writers are a closed list the backend lint names
 * (`COMPONENT_ITEM_PROPOSAL_WRITE_RULES`): the finder, which proposes
 * (`services/sync/componentItemFinder.ts`), and this module. An answer is
 * kept, never deleted: a refusal is what keeps a candidate from coming back,
 * and an acceptance is the record of who chose the point's item. What an
 * acceptance makes moot — the point's other candidates, and the item's
 * candidacy for the site's other points — is cleared, since a component is one
 * item and an item one component. Every write names the site, so a token for
 * one site cannot be spent on another's candidates.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import type { CheckValue } from '../../db/schema.generated.js';

/** The two answers a candidate takes, in the table's own words. */
export type ProposalAnswer = CheckValue<'experience_component_item_proposals', 'answer'>;

/** One candidate answered: what the answer was about, for the log. */
export interface AnsweredProposal {
  id: number;
  locationId: number;
  item: string;
  label: string;
}

/**
 * Record one answer on the named open candidates of the site's points, and
 * say which were answered: a candidate already answered, or another site's,
 * is left out rather than rewritten.
 */
export async function answerProposals(
  client: PoolClient,
  lock: LockedExperience,
  userId: number,
  proposalIds: readonly number[],
  answer: ProposalAnswer,
): Promise<AnsweredProposal[]> {
  if (proposalIds.length === 0) return [];
  const result = await client.query<{ id: number; location_id: number; wikidata_item: string; item_label: string }>(
    `UPDATE experience_component_item_proposals p
        SET answer = $3, answered_by = $4, answered_at = NOW()
       FROM experience_locations el
      WHERE el.id = p.location_id AND el.experience_id = $1
        AND p.id = ANY($2::int[]) AND p.answer IS NULL
      RETURNING p.id, p.location_id, p.wikidata_item, p.item_label`,
    [lock.id, proposalIds, answer, userId],
  );
  return result.rows.map(row => ({ id: row.id, locationId: row.location_id, item: row.wikidata_item, label: row.item_label }));
}

/**
 * Clear the open candidates an acceptance made moot, on this site: every other
 * candidate of the points that now have their item, and every candidacy of
 * the items now taken for the site's other points. Answers how many.
 */
export async function clearMootProposals(
  client: PoolClient,
  lock: LockedExperience,
  locationIds: readonly number[],
  items: readonly string[],
): Promise<number> {
  if (locationIds.length === 0) return 0;
  const result = await client.query(
    `DELETE FROM experience_component_item_proposals p
      USING experience_locations el
      WHERE el.id = p.location_id AND el.experience_id = $1 AND p.answer IS NULL
        AND (p.location_id = ANY($2::int[]) OR p.wikidata_item = ANY($3::text[]))`,
    [lock.id, locationIds, items],
  );
  return result.rowCount ?? 0;
}

/**
 * A confirmed candidate taken back (#1317, #1336): its row is open again, so
 * the point is asked about on the card with that candidate at once — the
 * take-back undoes the confirmation, and the curator's next answer there,
 * a no or a second yes, is the one on record. A batch confirms more than a
 * curator has read, so a take-back is as often "not yet" as "not it"; the
 * "not it" costs one more click on the card. Marked taken back, so neither
 * batch confirmation takes it again: only a click on the candidate can.
 * Answers whether a row was found.
 */
export async function reopenConfirmed(
  client: PoolClient,
  lock: LockedExperience,
  locationId: number,
  item: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE experience_component_item_proposals p
        SET answer = NULL, answered_by = NULL, answered_at = NULL, taken_back_at = NOW()
       FROM experience_locations el
      WHERE el.id = p.location_id AND el.experience_id = $1
        AND p.location_id = $2 AND p.wikidata_item = $3`,
    [lock.id, locationId, item],
  );
  return (result.rowCount ?? 0) > 0;
}
