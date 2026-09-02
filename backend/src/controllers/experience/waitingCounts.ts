/**
 * How much a gated source is holding, per source.
 *
 * The sync panel needs one number per source to answer "is there work here",
 * and the number has to agree with the queue a curator opens next. So the
 * authority is `reviewQueueController.ts`'s three gated kinds, and these
 * predicates are written to match them row for row:
 *
 * | kind | a row counts when |
 * |---|---|
 * | `arrival` | nobody has read the row itself |
 * | `held` | a run's proposal against a *visible* row was refused by the gate, and no curator has published or refused it |
 * | `contents` | a visible row holds unread points or unread works |
 *
 * **Where this cannot share the queue's spelling, and what would catch a drift.**
 * The queue's `held` query reaches the held fields through
 * `CROSS JOIN LATERAL jsonb_array_elements(changed_fields)` because it has to
 * *show* them; a count only needs to know one exists, so it asks with `EXISTS`.
 * Two spellings of one rule is exactly the shape this branch has been closing,
 * and the honest defence is the case that separates them: a pointer whose
 * changeset holds only fields a **curator** claimed (`curatedConflict`, no
 * `held`) must count zero and raise no `held` card. `waitingCounts.test.ts` and
 * the live cross-check in the branch's report both drive that row.
 *
 * A `pending` row never carries a proposal pointer — `syncUtils` writes the
 * pointer only `WHERE curation_state <> 'pending'` — so `held` needs no
 * "not pending" clause, and adding one would spell a conjunction the database
 * already guarantees.
 */

import { pool } from '../../db/index.js';
import { hideRefusedSql, offeredLinkSql, offeredLocationSql } from './experienceLifecycle.js';
import { heldFieldAnsweredSql, heldPartAnsweredSql } from './heldDecisions.js';

/** A row nobody has read yet, and that the source still offers. */
export function arrivalWaitingSql(alias = 'e'): string {
  return `${alias}.curation_state = 'pending' AND ${alias}.missing_since IS NULL AND ${hideRefusedSql(alias)}`;
}

/**
 * Whether a changeset row carries a field of the object's own the gate held and
 * nobody has answered.
 *
 * `held: true` on the field itself rather than the absence of a curator's claim
 * (#519): a field can be refused for either reason, and only the gate's refusal
 * is answerable by publishing. `alias` is the `experience_sync_changes` alias.
 *
 * Answered means published — which clears the flag by clearing the proposal —
 * or refused (#722), which writes nothing and records the value. The second is
 * what this predicate adds: a curator who says "not this" to a run's only
 * proposal has answered the card, and a count that went on including it would
 * send them back to a queue with nothing in it.
 */
export function heldFieldExistsSql(alias = 'ch'): string {
  return `EXISTS (
      SELECT 1 FROM jsonb_array_elements(${alias}.changed_fields) AS f
      WHERE (f->>'held')::boolean
        AND NOT ${heldFieldAnsweredSql(`${alias}.experience_id`)}
    )`;
}

/**
 * Whether a changeset row carries a field of one of the object's *parts* the
 * gate held and nobody has answered (ADR-0037) — a place's name, a work's
 * attribution.
 *
 * The record keys contents by kind, so both kinds are asked by name; a kind the
 * run did nothing to is absent, which the COALESCE reads as an empty list. The
 * same positive flag as above, for the same reason: a part's field a claim
 * refused is the conflict card's, and never counted here. And the same refusal
 * clause, keyed on the part the record names as well as on the field.
 */
export function heldPartExistsSql(alias = 'ch'): string {
  return `EXISTS (
      SELECT 1 FROM (VALUES ('locations'), ('treasures')) AS k(kind)
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(${alias}.contents -> k.kind -> 'changed', '[]'::jsonb)) AS c
      CROSS JOIN LATERAL jsonb_array_elements(c -> 'fields') AS f
      WHERE (f->>'held')::boolean
        AND NOT ${heldPartAnsweredSql(`${alias}.experience_id`, 'k.kind')}
    )`;
}

/**
 * A visible row holding a proposal the gate refused — on a field of its own,
 * or on a field of one of its parts. Both, because the queue's held card
 * carries both and this count has to agree with it row for row.
 */
export function heldWaitingSql(alias = 'e'): string {
  return `${alias}.pending_change_sync_log_id IS NOT NULL
    AND ${alias}.missing_since IS NULL AND ${hideRefusedSql(alias)}
    AND EXISTS (
      SELECT 1 FROM experience_sync_changes ch
      WHERE ch.experience_id = ${alias}.id
        AND ch.sync_log_id = ${alias}.pending_change_sync_log_id
        AND (${heldFieldExistsSql('ch')} OR ${heldPartExistsSql('ch')})
    )`;
}

/**
 * A visible row holding unread contents.
 *
 * Two tables, not one column: a link's state and its work's state are
 * independent axes (ADR-0025), so a work reviewed in one venue and unread in
 * another has to count here — which is why `getExperienceTreasures` gates both
 * separately and this asks both questions too.
 *
 * `offeredLocationSql` here, and both of its terms carry: a point the source has
 * withdrawn, or one a curator has declared gone from the world, is not "unread"
 * in any sense a reader notices, since every reader-facing location read carries
 * the same fragment — publishing either would change nothing on screen. Named the
 * same way, and in the same order, as the queue comment this count has to match
 * row for row.
 *
 * `curation_state = 'pending'` is spelled positively rather than through
 * `publishedContentSql`, which states the reader's side (`<> 'pending'`): this
 * asks the opposite question, and `NOT (…)` around a fragment named for the
 * other direction reads worse than the four words it replaces.
 */
export function contentsWaitingSql(alias = 'e'): string {
  return `${alias}.curation_state <> 'pending'
    AND ${alias}.missing_since IS NULL AND ${hideRefusedSql(alias)}
    AND (
      EXISTS (
        SELECT 1 FROM experience_locations el
        WHERE el.experience_id = ${alias}.id
          AND ${offeredLocationSql('el')} AND el.curation_state = 'pending'
      )
      OR EXISTS (
        SELECT 1 FROM experience_treasures et
        LEFT JOIN treasures t ON t.id = et.treasure_id
        WHERE et.experience_id = ${alias}.id
          -- Only a link the source still places here: a withdrawn one can never
          -- be published (the publish statement carries the same term), so
          -- counting it would promise work the card cannot offer (ADR-0044).
          AND ${offeredLinkSql('et')}
          AND (et.curation_state = 'pending' OR t.curation_state = 'pending')
      )
    )`;
}

/** What one source is holding, in the three kinds the queue asks about. */
export interface WaitingCounts {
  arrivals: number;
  held: number;
  contents: number;
}

/**
 * One pass over `experiences`, one row per category.
 *
 * Not scoped to a curator: this feeds the admin sync panel, which is behind
 * `requireAdmin`, and an admin's scope is every category. The queue itself
 * restricts what a *curator* is asked about, so the panel's number can be larger
 * than what a region-scoped curator will find there — the panel answers "is this
 * source holding anything", not "is there work for me".
 */
export async function waitingCountsByCategory(): Promise<Map<number, WaitingCounts>> {
  const result = await pool.query(`
    SELECT e.category_id,
           COUNT(*) FILTER (WHERE ${arrivalWaitingSql()})::int  AS arrivals,
           COUNT(*) FILTER (WHERE ${heldWaitingSql()})::int     AS held,
           COUNT(*) FILTER (WHERE ${contentsWaitingSql()})::int AS contents
    FROM experiences e
    GROUP BY e.category_id
  `);
  return new Map(result.rows.map(r => [
    r.category_id as number,
    { arrivals: r.arrivals as number, held: r.held as number, contents: r.contents as number },
  ]));
}
