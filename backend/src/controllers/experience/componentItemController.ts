/**
 * A curator's answer to the candidate Wikidata items the finder proposed for a
 * serial World Heritage site's components (#1272).
 * POST /api/experiences/:id/component-items
 *
 * A candidate is a match by place and name, never a fact (ADR-0046): the
 * curator confirms or turns it down. Confirming records the item on the point
 * as the curator's choice (`claimPointItem`) — a claim no run overrides and
 * the finder reads as answered — and gives the point what the item gives it,
 * its picture with its credit and its description, read from Wikidata and
 * Commons before the lock, since the run's index knows only the items that
 * carry a World Heritage reference. Turning a candidate down keeps it from
 * being proposed again. Both are kept on the proposal row; the answer is one
 * act of the curation log naming every candidate it decided.
 *
 * What is asked is re-asked under the lock: a candidate answered meanwhile,
 * a point that gained its item, an item recorded on another point since, are
 * each refused with nothing written.
 */

import type { PoolClient } from 'pg';
import type { z } from 'zod/v4';
import type { ComponentItemsAnswered } from '../../api/responses/curation.js';
import { userAgent } from '../../config/userAgent.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience, type LockedExperience } from '../../db/experienceWriter.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import { contentsOf } from '../../services/sync/componentItemQueries.js';
import { fetchCommonsCredits, type ImageCredit } from '../../services/sync/imageCredit.js';
import { WaitBudget } from '../../services/sync/wikidataUtils.js';
import type { answerComponentItemsBodySchema, idParamSchema } from '../../types/index.js';
import { answerProposals, clearMootProposals, type ProposalAnswer } from './componentItemAnswers.js';
import { claimPointItem, type ClaimedItemContent } from './experienceLocationWriter.js';
import { resolveExperienceScope } from './experienceScope.js';
import { openProposalSql } from './reviewQueuePredicates.js';

const LOG_PREFIX = '[Component items]';
/** How long a curator's save waits on Wikidata or Commons for the item's content: a save must not hang on them. */
const CONTENT_TIMEOUT_MS = 5000;

interface AnswerRefusal {
  status: number;
  error: string;
}

/** One candidate and the answer the curator gives it. */
export interface CandidateAnswer {
  proposalId: number;
  answer: ProposalAnswer;
}

/** The contents of the items confirmed, keyed by item, read before the lock. */
export type ItemContents = ReadonlyMap<string, ClaimedItemContent>;

const RELOAD = ' — reload to see where it stands';

/**
 * What each confirmed item gives its point, read before the lock: the picture
 * and the description from Wikidata, the picture's credit from Commons. A
 * read that fails gives nothing — the point still takes its identity, which
 * is what the curator decided, and the picture waits for a curator's edit —
 * and never fails the save.
 */
export async function readItemContents(items: readonly string[]): Promise<ItemContents> {
  const contents = new Map<string, ClaimedItemContent>();
  if (items.length === 0) return contents;
  try {
    // No patience at all, as a curator's own picture edit has none: the person
    // who pressed Save is watching.
    const budget = new WaitBudget(0);
    const read = await contentsOf(items, { budget });
    const credits = await fetchCommonsCredits(
      [...read.values()].map(content => content.image), { userAgent: userAgent(), budget, timeoutMs: CONTENT_TIMEOUT_MS },
    );
    for (const [item, content] of read) {
      const credit: ImageCredit | null = content.image ? credits.get(content.image) ?? null : null;
      contents.set(item, { imageUrl: content.image, credit, description: content.description });
    }
  } catch (error) {
    // A literal format string: a template literal here trips the
    // unsafe-formatstring rule, and the count belongs in the arguments anyway.
    console.warn('%s The contents of %d confirmed items could not be read:', LOG_PREFIX, items.length, error);
  }
  return contents;
}

/** The candidates of this site's points the curator named, as they stand under the lock. */
interface NamedCandidate {
  id: number;
  location_id: number;
  wikidata_item: string;
  item_label: string;
  point_name: string | null;
  open: boolean;
  has_item: boolean;
  taken: boolean;
}

async function namedCandidates(client: PoolClient, lock: LockedExperience, ids: readonly number[]): Promise<NamedCandidate[]> {
  const result = await client.query<NamedCandidate>(
    `SELECT p.id, p.location_id, p.wikidata_item, p.item_label, el.name AS point_name,
            (${openProposalSql('p', 'el')}) AS open,
            (el.wikidata_item IS NOT NULL OR el.curated_fields ? 'wikidata_item') AS has_item,
            EXISTS (SELECT 1 FROM experience_locations taken WHERE taken.wikidata_item = p.wikidata_item) AS taken
       FROM experience_component_item_proposals p
       JOIN experience_locations el ON el.id = p.location_id
      WHERE p.id = ANY($2::int[]) AND el.experience_id = $1`,
    [lock.id, ids],
  );
  return result.rows;
}

/** Why one named candidate is no longer open, in the words the card shows. */
function closedBecause(candidate: NamedCandidate | undefined): string {
  if (!candidate) return `A candidate is not one of this site's, or was answered already${RELOAD}`;
  if (candidate.has_item) return `${candidate.point_name ?? 'A component'} already has its item${RELOAD}`;
  if (candidate.taken) return `${candidate.item_label} is already another component's item${RELOAD}`;
  return `A candidate was answered already${RELOAD}`;
}

/** Why the answers cannot be written as sent, or null where every one can. */
function refusalFor(answers: readonly CandidateAnswer[], found: ReadonlyMap<number, NamedCandidate>): string | null {
  const pointsTaken = new Set<number>();
  const itemsTaken = new Set<string>();
  for (const { proposalId, answer } of answers) {
    const candidate = found.get(proposalId);
    if (!candidate?.open) return closedBecause(candidate);
    if (answer !== 'accepted') continue;
    if (pointsTaken.has(candidate.location_id)) return 'A component is one item: confirm one candidate for it';
    if (itemsTaken.has(candidate.wikidata_item)) return 'An item is one component: confirm it for one point';
    pointsTaken.add(candidate.location_id);
    itemsTaken.add(candidate.wikidata_item);
  }
  return null;
}

/** A log line's record of one candidate: the point by name, the item by label and id. */
function logged(candidate: NamedCandidate, pictured?: boolean) {
  return {
    locationId: candidate.location_id, point: candidate.point_name, item: candidate.wikidata_item,
    label: candidate.item_label, ...(pictured === undefined ? {} : { pictured }),
  };
}

/**
 * Write the answers under the site's lock: every confirmed candidate's item
 * on its point with what the item gives it, every answer on its proposal, the
 * candidates the confirmations made moot cleared, and one log row. Refuses,
 * changing nothing, a batch any candidate of which cannot be answered as sent.
 */
export async function answerComponentItemsUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  answers: readonly CandidateAnswer[],
  contents: ItemContents,
): Promise<{ result?: ComponentItemsAnswered; refusal?: AnswerRefusal }> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const refuse = async (status: number, error: string): Promise<{ refusal: AnswerRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal: { status, error } };
    };
    const locked = await lockExperience(client, experienceId);
    if (!locked) return await refuse(404, 'Experience not found');
    const { lock } = locked;

    // The site's lock serialises this site's answers; two sites confirming
    // one item for a point each would both read it as free, since no
    // constraint says an item is one component. So the items confirmed are
    // locked by name for the transaction, in one order, after the site and
    // before the candidates are read for the answer: the second site waits on
    // the first and then reads the item as taken.
    const ids = answers.map(one => one.proposalId);
    const named = await namedCandidates(client, lock, ids);
    const confirmedItems = [...new Set(answers
      .filter(one => one.answer === 'accepted')
      .map(one => named.find(c => c.id === one.proposalId)?.wikidata_item)
      .filter((item): item is string => item !== undefined))].sort();
    if (confirmedItems.length > 0) {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('wikidata_item:' || item)) FROM unnest($1::text[]) AS item`,
        [confirmedItems],
      );
    }
    const found = new Map((await namedCandidates(client, lock, ids)).map(c => [c.id, c]));
    const why = refusalFor(answers, found);
    if (why !== null) return await refuse(409, why);

    const confirmed = answers.filter(one => one.answer === 'accepted').map(one => found.get(one.proposalId)!);
    const turnedDown = answers.filter(one => one.answer === 'refused').map(one => found.get(one.proposalId)!);
    const nothing: ClaimedItemContent = { imageUrl: null, credit: null, description: null };
    const accepted: ReturnType<typeof logged>[] = [];
    let pictured = 0;
    for (const candidate of confirmed) {
      const written = await claimPointItem(
        client, lock, candidate.location_id, candidate.wikidata_item, contents.get(candidate.wikidata_item) ?? nothing,
      );
      if (written.pictured) pictured += 1;
      accepted.push(logged(candidate, written.pictured));
    }
    await answerProposals(client, lock, userId, confirmed.map(c => c.id), 'accepted');
    await answerProposals(client, lock, userId, turnedDown.map(c => c.id), 'refused');
    await clearMootProposals(client, lock, confirmed.map(c => c.location_id), confirmed.map(c => c.wikidata_item));
    await client.query(
      `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
       VALUES ($1, $2, 'component_items_answered', $3, $4)`,
      [experienceId, userId, logRegionId, JSON.stringify({ accepted, refused: turnedDown.map(c => logged(c)) })],
    );
    await client.query('COMMIT');
    return { result: { experienceId, accepted: confirmed.length, refused: turnedDown.length, pictured } };
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

/** The items the named open candidates of a site propose, for the content read before the lock. */
export async function candidateItems(experienceId: number, proposalIds: readonly number[]): Promise<string[]> {
  if (proposalIds.length === 0) return [];
  const result = await pool.query<{ wikidata_item: string }>(
    `SELECT DISTINCT p.wikidata_item
       FROM experience_component_item_proposals p
       JOIN experience_locations el ON el.id = p.location_id
      WHERE el.experience_id = $1 AND p.id = ANY($2::int[]) AND p.answer IS NULL`,
    [experienceId, proposalIds],
  );
  return result.rows.map(row => row.wikidata_item);
}

/**
 * The open candidates of a site, for the batch answer (`reviewAnswerDispatch.ts`):
 * the exact ones — the same name at the same spot — which a batch accept
 * confirms, or all of them, which a batch reject turns down.
 */
export async function openCandidates(experienceId: number, only: 'exact' | 'all'): Promise<number[]> {
  const result = await pool.query<{ id: number }>(
    `SELECT p.id
       FROM experience_component_item_proposals p
       JOIN experience_locations el ON el.id = p.location_id
      WHERE el.experience_id = $1 AND ${openProposalSql('p', 'el')}
        AND ($2::boolean OR p.exact)
      ORDER BY p.id`,
    [experienceId, only === 'all'],
  );
  return result.rows.map(row => row.id);
}

/**
 * The sources whose curators answer a site's candidate items: every source of
 * a membership that places a point with an open candidate — what the queue
 * scopes the question by, admitting the site for a curator of any of them —
 * or, where none is left, the site's own. Null for no such place.
 */
export async function componentItemsSourceIds(experienceId: number): Promise<number[] | null> {
  const result = await pool.query<{ source_ids: number[] | null; source_id: number }>(
    `SELECT (SELECT array_agg(DISTINCT m.source_id)
               FROM experience_component_item_proposals p
               JOIN experience_locations el ON el.id = p.location_id
               JOIN experience_location_placements pl ON pl.location_id = el.id
               JOIN ${MEMBERSHIPS} m ON m.id = pl.membership_id
              WHERE el.experience_id = e.id AND ${openProposalSql('p', 'el')}) AS source_ids,
            e.source_id
       FROM experiences e WHERE e.id = $1`,
    [experienceId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return row.source_ids?.length ? row.source_ids : [row.source_id];
}

/**
 * Whether this caller may answer a site's candidate items, and the region
 * the audit row names: in scope for any of the sources that place such a
 * point, as the queue admits the site (`componentItemsKeysSql`). The card's
 * endpoint and the batch answer (`reviewAnswerController.ts`) both ask this,
 * never the membership a client names. `permitted: false` where there is no
 * such place.
 */
export async function componentItemsScope(
  userId: number, userRole: Express.User['role'], experienceId: number,
): Promise<{ permitted: boolean; logRegionId: number | null; found: boolean }> {
  const sourceIds = await componentItemsSourceIds(experienceId);
  if (sourceIds === null) return { permitted: false, logRegionId: null, found: false };
  for (const sourceId of sourceIds) {
    const scope = await resolveExperienceScope(userId, userRole, experienceId, sourceId);
    if (scope.permitted) return { ...scope, found: true };
  }
  return { permitted: false, logRegionId: null, found: true };
}

/** The card's answer: confirm and turn down candidates, in the scope of a source that placed the points. */
export async function answerComponentItems(
  { params: { id }, body, caller }: {
    params: z.output<typeof idParamSchema>; body: z.output<typeof answerComponentItemsBodySchema>; caller: Express.User;
  },
): Promise<ComponentItemsAnswered> {
  const { permitted, logRegionId, found } = await componentItemsScope(caller.id, caller.role, id);
  if (!found) throw notFound('Experience not found');
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  const confirmed = body.answers.filter(one => one.answer === 'accepted').map(one => one.proposalId);
  const contents = await readItemContents(await candidateItems(id, confirmed));
  const outcome = await answerComponentItemsUnderLock(id, caller.id, logRegionId, body.answers, contents);
  if (outcome.refusal) {
    const { status, ...rest } = outcome.refusal;
    throw new Refusal(status, rest);
  }
  return outcome.result!;
}
