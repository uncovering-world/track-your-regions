/**
 * Two places that each claim one Wikidata item are one place, and are joined
 * without a question (ADR-0046 decision 2, ADR-0086, ADR-0143).
 *
 * A run finds the place an item names before it creates one
 * (`lockIdentifiedPlace`, ADR-0143 decision 3), so no run makes a second place
 * for an item. What still makes two places claim one item is an item that
 * arrives on a place that exists: a World Heritage run or the component-items
 * card recording, on a serial site's component point, the item another kind's
 * place already is (#1269, #1272) — the Tower of Belem as a part of the
 * Jerónimos site after Towers brought the tower. Which places claim an item is
 * the registry's word (decision 2, #1892): `place_identifiers.claims_identity`
 * on both, `identifies` on neither — through a Wikidata source's own id, a
 * World Heritage site's one item on a place of one standing point (#1248) or
 * a standing point's item (#1250), never an item two parts carry, which names
 * their ensemble, nor one a curator said only refers to the place (#1896); the
 * catalogue check `identifiers-on-several-places` lists the same rows.
 *
 * Each such item is joined into one place, one place at a time. The place
 * some kind offers, with the lowest id, keeps its id and its address: the
 * Temple of Karnak folds into the Karnak Temple Complex of Places of worship,
 * which becomes the part of Ancient Thebes and keeps its name, its list row
 * and its address. Where no kind offers any of them — a component part is
 * shown through its whole and holds no kind of its own — the part keeps its
 * row and the arrival nobody has passed folds into it, the state the resolver
 * reaches when a run finds the part by its item: the Tower of Belem holding
 * its pending Towers membership; otherwise the lowest id stays. A pair the
 * merge refuses — both places in one kind — is reported and left apart, for
 * the check to list.
 */

import { pool } from '../../db/index.js';
import { MEMBERSHIPS, placeOfferedSql } from '../../db/membership.js';
import { mergePlaces } from './placeMerge.js';

/** What a join did: the places merged, and the ones left apart with the reason. */
export interface EqualItemJoins {
  merged: Array<{ qid: string; survivorId: number; foldedId: number; mergeId: number; name: string }>;
  refused: Array<{ qid: string; placeIds: number[]; name: string; error: string }>;
}

/**
 * The Wikidata items two or more live places each claim as their own, one
 * row each: `qid`, its places in id order (`place_ids`), their names in that
 * order (`names`) and the place that keeps its id (`survivor_id`). Narrowed
 * to the items named by `onlyParam` — a placeholder bound to a `text[]`, or
 * `NULL` for every item. The rows are the registry's, the ones
 * `identifiers-on-several-places` lists, so the check and the join ask one
 * question.
 */
function sharedItemsSql(onlyParam: string): string {
  return `SELECT g.qid, g.place_ids, g.names, g.survivor_id
       FROM (
         SELECT held.qid,
                array_agg(held.place_id ORDER BY held.place_id) AS place_ids,
                array_agg(held.name ORDER BY held.place_id) AS names,
                -- The place that keeps its id: one some kind offers, whose address is
                -- known, with the lowest id; where none is, a serial site's component
                -- part — shown through its whole, of no kind — which a run would have
                -- found by its item (ADR-0143 decision 3); else the lowest id.
                COALESCE(min(held.place_id) FILTER (WHERE held.offered),
                         min(held.place_id) FILTER (WHERE NOT held.kinded),
                         min(held.place_id)) AS survivor_id
           FROM (
             SELECT pi.value AS qid, e.id AS place_id, e.name,
                    EXISTS (SELECT 1 FROM ${MEMBERSHIPS} own WHERE own.experience_id = e.id) AS kinded,
                    ${placeOfferedSql('e')} AS offered
               FROM place_identifiers pi
               JOIN experiences e ON e.id = pi.experience_id
              WHERE pi.scheme = 'wikidata' AND pi.claims_identity AND NOT pi.identifies
                AND (${onlyParam}::text[] IS NULL OR pi.value = ANY(${onlyParam}::text[]))
           ) held
          GROUP BY held.qid
         HAVING count(*) > 1
       ) g
      -- A pair a curator took apart is not joined again: the undone merge's record
      -- is their word that the two are not one place, which stands until they say
      -- otherwise; the registry goes on listing the item for them to settle.
      WHERE NOT EXISTS (SELECT 1 FROM experience_merges undone
                         WHERE undone.undone_at IS NOT NULL
                           AND undone.survivor_id = ANY(g.place_ids) AND undone.folded_id = ANY(g.place_ids))`;
}

/** The items `sharedItemsSql` finds, in item order. */
type SharedItem = { qid: string; place_ids: number[]; names: string[]; survivor_id: number };

async function sharedItems(only?: readonly string[]): Promise<SharedItem[]> {
  const result = await pool.query<SharedItem>(
    `${sharedItemsSql('$1')} ORDER BY g.qid`,
    [only ?? null],
  );
  return result.rows;
}

/**
 * Join every place that claims a Wikidata item with another into the one
 * that keeps its id (`sharedItemsSql`) — every such item, or the ones named.
 * The catalogue's own merge: it names no curator. Run after a real run of a
 * source (`syncController.ts`), once the run is over, since the join is a
 * curation write the sync layer sits below, and after the component-items
 * card's answer (`componentItemController.ts`), for the items it confirmed.
 * Never throws: a failure is logged and leaves the places apart for the
 * check to list and the next join to find.
 */
export async function joinPlacesClaimingOneItem(only?: readonly string[]): Promise<EqualItemJoins> {
  const report: EqualItemJoins = { merged: [], refused: [] };
  let items: SharedItem[];
  try {
    items = await sharedItems(only);
  } catch (error) {
    console.error('[merge] reading the items two places claim failed:', error);
    return report;
  }
  for (const item of items) {
    const survivorId = item.survivor_id;
    const name = item.names[item.place_ids.indexOf(survivorId)];
    for (const foldedId of item.place_ids.filter(id => id !== survivorId)) {
      await mergeOnePair(report, { qid: item.qid, survivorId, foldedId, name });
    }
  }
  for (const refused of report.refused) {
    console.log('[merge] places %s (%s) left apart: %s', refused.placeIds.join(' and '), refused.qid, refused.error);
  }
  return report;
}

/** Merge one place into the one its item keeps, and write the outcome into the report. */
async function mergeOnePair(
  report: EqualItemJoins,
  { qid, survivorId, foldedId, name }: { qid: string; survivorId: number; foldedId: number; name: string },
): Promise<void> {
  let outcome: Awaited<ReturnType<typeof mergePlaces>>;
  try {
    outcome = await mergePlaces({
      survivorId, foldedId, mergedBy: null, reason: 'equal_wikidata_item', detail: { qid },
    });
  } catch (error) {
    // Each merge is its own transaction, so one that threw changed nothing,
    // and the ones before it are committed: the join goes on and the report
    // says which pair failed, rather than losing what it already did.
    console.error('[merge] places %d and %d sharing %s could not be merged:', survivorId, foldedId, qid, error);
    outcome = { refusal: { status: 500, error: 'The merge failed and changed nothing' } };
  }
  if (outcome.refusal) {
    report.refused.push({ qid, placeIds: [survivorId, foldedId], name, error: outcome.refusal.error });
  } else {
    report.merged.push({ qid, survivorId, foldedId, mergeId: outcome.result!.mergeId, name });
  }
}
