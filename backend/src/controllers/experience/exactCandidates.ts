/**
 * The catalogue's own answer to the component candidates whose answer is
 * already known (#1839, ADR-0141): an exact candidate, the point's own name
 * within `EXACT_DISTANCE_M` of it (`componentItemMatching.ts`), is accepted
 * without a curator when nothing about it could be a different answer:
 * - it is the point's only exact candidate;
 * - its item is proposed for no other point of the site;
 * - no heritage register disagrees with it;
 * - it is open: no curator has answered it, set the point's item by hand, or
 *   taken it back (`taken_back_at`), since a curator who took it back said
 *   "not yet" or "not it", and only a curator answers it again.
 *
 * Measured on the development catalogue on 2026-10-22: 151 of the 566 open
 * candidates were exact, none of them on a point with another exact one or
 * for an item proposed twice, the farthest 48 m off; curators had accepted
 * every exact candidate they answered, and every wrong candidate was a partial
 * name. The acceptance goes through the same writer a curator's does
 * (`answerComponentItemsUnderLock`), so the point takes the item's picture and
 * description, and the history can take it back like a curator's.
 */

import { pool } from '../../db/index.js';
import { answeringPlaceSql } from '../../db/placePoints.js';
import { SPARQL_WAIT_BUDGET_MS, WaitBudget } from '../../services/sync/wikidataUtils.js';
import {
  answerComponentItemsUnderLock, candidateItems, readItemContents, type ItemContents,
} from './componentItemController.js';
import { openProposalSql } from './reviewQueuePredicates.js';

/** What a pass accepted: the points recorded, on how many sites, and the candidates left for the next pass. */
export interface ExactAcceptance {
  accepted: number;
  sites: number;
  /** Candidates whose item's content could not be read, or whose site changed under the lock. */
  leftForNextPass: number;
}

/** How a pass reads and when it stops. */
export interface AcceptanceRun {
  /**
   * The items' content, read strictly: a read that fails leaves the site for the
   * next pass, and an item missing from the answer leaves its candidate.
   */
  readContents?: (items: readonly string[]) => Promise<ItemContents>;
  /** Asked between sites: a cancelled pass writes no further site. */
  isCancelled?: () => boolean;
}

/** The open candidates the rule accepts, by the site that answers for their points. */
async function acceptable(siteId?: number): Promise<Map<number, { id: number; item: string }[]>> {
  const result = await pool.query<{ site_id: number; id: number; wikidata_item: string }>(
    `WITH open AS (
       SELECT ${answeringPlaceSql('el')} AS site_id, p.id, p.location_id, p.wikidata_item,
              p.exact, p.register_disagrees, p.taken_back_at
         FROM experience_component_item_proposals p
         JOIN experience_locations el ON el.id = p.location_id
        WHERE ${openProposalSql('p', 'el')})
     SELECT c.site_id, c.id, c.wikidata_item FROM open c
      WHERE c.exact AND c.taken_back_at IS NULL AND NOT c.register_disagrees
        AND ($1::int IS NULL OR c.site_id = $1)
        AND NOT EXISTS (SELECT 1 FROM open other
                         WHERE other.location_id = c.location_id AND other.id <> c.id AND other.exact)
        AND NOT EXISTS (SELECT 1 FROM open other
                         WHERE other.wikidata_item = c.wikidata_item AND other.location_id <> c.location_id
                           AND other.site_id = c.site_id)
      ORDER BY c.site_id, c.id`,
    [siteId ?? null],
  );
  const bySite = new Map<number, { id: number; item: string }[]>();
  for (const row of result.rows) {
    bySite.set(row.site_id, [...(bySite.get(row.site_id) ?? []), { id: row.id, item: row.wikidata_item }]);
  }
  return bySite;
}

/**
 * Accept every candidate the rule accepts, one site per transaction, with no
 * curator named. A site whose candidates changed under the lock (a curator
 * answered one meanwhile) is refused by the writer and left for the next pass.
 */
export async function acceptExactCandidates(siteId?: number, run: AcceptanceRun = {}): Promise<ExactAcceptance> {
  // The patience of a run, not of a curator's save: nobody is watching, and a
  // site read in a hurry would be accepted without its picture for good.
  const budget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  const read = run.readContents ?? (items => readItemContents(items, { budget, strict: true }));
  let accepted = 0;
  let sites = 0;
  let leftForNextPass = 0;
  for (const [site, candidates] of await acceptable(siteId)) {
    if (run.isCancelled?.()) break;
    let contents: ItemContents;
    try {
      contents = await read(await candidateItems(site, candidates.map(c => c.id)));
    } catch (error) {
      console.warn('[Component items] The contents of site %d could not be read; it waits for the next pass:', site, error);
      leftForNextPass += candidates.length;
      continue;
    }
    // An item the read could not give its content, its picture's credit, waits
    // alone: the site's other candidates are accepted.
    const ready = candidates.filter(c => contents.has(c.item));
    leftForNextPass += candidates.length - ready.length;
    // Asked again after the read, which can take minutes: a pass cancelled
    // meanwhile writes this site no more than the next.
    if (ready.length === 0 || run.isCancelled?.()) continue;
    const outcome = await answerComponentItemsUnderLock(
      site, null, null, ready.map(c => ({ proposalId: c.id, answer: 'accepted' as const })), contents,
    );
    if (outcome.result) {
      accepted += outcome.result.accepted;
      sites += 1;
    } else {
      leftForNextPass += ready.length;
    }
  }
  return { accepted, sites, leftForNextPass };
}
