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
 * A `pending` membership never carries a proposal pointer — `heldProposalPointer.ts`
 * writes the pointer only `WHERE curation_state <> 'pending'` — so `held` needs no
 * "not pending" clause, and adding one would spell a conjunction the database
 * already guarantees.
 *
 * Each predicate takes two aliases since #822: the place (`experiences`, for
 * what the source observes about the row) and its membership in a kind
 * (`experience_kind_memberships`, for the gate state and the admission), which
 * the query has to join — an arrival *is* a membership arriving, and what a
 * source holds is counted per membership its runs brought.
 */

import { pool } from '../../db/index.js';
import { MEMBERSHIPS, membershipAdmittedSql, membershipOfferedSql } from '../../db/membership.js';
import { offeredLinkSql, offeredLocationSql } from './experienceLifecycle.js';
import { heldFieldAnsweredSql, heldPartAnsweredSql } from './heldDecisions.js';

/** A membership nobody has read yet, of a place the source still offers. */
export function arrivalWaitingSql(alias = 'e', membership = 'm'): string {
  return `${membership}.curation_state = 'pending' AND ${alias}.missing_since IS NULL AND ${membershipAdmittedSql(membership)}`;
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
export function heldWaitingSql(alias = 'e', membership = 'm'): string {
  return `${membership}.pending_change_sync_log_id IS NOT NULL
    AND ${alias}.missing_since IS NULL AND ${membershipAdmittedSql(membership)}
    AND EXISTS (
      SELECT 1 FROM experience_sync_changes ch
      WHERE ch.experience_id = ${alias}.id
        AND ch.sync_log_id = ${membership}.pending_change_sync_log_id
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
 * The unread terms are `unreadPointSql` and `unreadLinkSql`, the one spelling
 * of "unread and still asked about" every reader of that question shares.
 */
export function contentsWaitingSql(alias = 'e', membership = 'm'): string {
  return `${contentsAnswerableSql(alias, membership)}
    AND (
      EXISTS (
        SELECT 1 FROM experience_locations el
        WHERE el.experience_id = ${alias}.id
          AND ${offeredLocationSql('el')} AND ${unreadPointSql('el')}
      )
      OR EXISTS (
        SELECT 1 FROM experience_treasures et
        LEFT JOIN treasures t ON t.id = et.treasure_id
        WHERE et.experience_id = ${alias}.id
          -- Only a link the source still places here: a withdrawn one can never
          -- be published (the publish statement carries the same term), so
          -- counting it would promise work the card cannot offer (ADR-0044).
          AND ${offeredLinkSql('et')}
          AND ${unreadLinkSql('et', 't')}
      )
    )`;
}

/**
 * Whose unread contents may be answered at all — the object half of
 * `contentsWaitingSql`, on its own.
 *
 * The same three terms, and they are three questions with three other cards: an
 * object nobody has passed is its arrival's, one a rule kept out is the refusal
 * card's, one the source has dropped is `missing`'s. Its contents wait on that
 * answer, so every act on them composes this rather than spelling it.
 *
 * Read by four now: the count above, the refusal that turns contents down, the
 * take-back that asks about them again (#859) — both under their own lock, the
 * database evaluating it rather than each restating it in JavaScript — and the
 * list that draws the take-back's button, which is what keeps a card from
 * offering an answer the writer refuses. Two spellings of it is how a card comes
 * to offer one, and how a refusal and its own undoing come to disagree about
 * which objects they apply to.
 *
 * `${membership}.id IS NOT NULL` because the writers reach the membership by
 * LEFT JOIN, an object with none at all being neither admitted nor refused.
 */
export function contentsAnswerableSql(alias = 'e', membership = 'm'): string {
  return `${membership}.id IS NOT NULL AND ${membershipOfferedSql(membership)}
    AND ${alias}.missing_since IS NULL`;
}

/**
 * A point nobody has passed and nobody has refused — the one the queue asks
 * about and the publish reaches (#852, ADR-0053).
 *
 * `curation_state = 'pending'` is spelled positively rather than through
 * `publishedContentSql`, which states the reader's side (`<> 'pending'`): this
 * asks the opposite question, and `NOT (…)` around a fragment named for the
 * other direction reads worse than the four words it replaces. The refusal is
 * a mark beside the state rather than a fourth value of it, so a refused point
 * is still `pending` to every reader — hidden by the same word — and stops
 * being a question only here. Six statements compose this rather than spell
 * it, and the publish is one of them: a whole-object publish must not release
 * what a curator turned down.
 */
export function unreadPointSql(el = 'el'): string {
  return `${el}.curation_state = 'pending' AND ${el}.refused_at IS NULL`;
}

/**
 * A link nobody has passed here and nobody has refused here, on either axis:
 * the link says the work is *here*, the work says it is a work, and either
 * being unread is a question (ADR-0025 decision 2). The refusal sits on the
 * link, because "not this work here" is the link's axis; the work stays
 * askable at every other venue that holds it.
 */
export function unreadLinkSql(et = 'et', t = 't'): string {
  return `(${et}.curation_state = 'pending' OR ${t}.curation_state = 'pending') AND ${linkNotRefusedSql(et)}`;
}

/**
 * The refusal mark on its own, for the two publish statements that gate the
 * link's and the work's state separately and cannot take the pair above.
 */
export function linkNotRefusedSql(et = 'et'): string {
  return `${et}.refused_at IS NULL`;
}

/** What one source is holding, in the three kinds the queue asks about. */
export interface WaitingCounts {
  arrivals: number;
  held: number;
  contents: number;
}

/**
 * One pass over the memberships, one row per source.
 *
 * Not scoped to a curator: this feeds the admin sync panel, which is behind
 * `requireAdmin`, and an admin's scope is every source. The queue itself
 * restricts what a *curator* is asked about, so the panel's number can be larger
 * than what a region-scoped curator will find there — the panel answers "is this
 * source holding anything", not "is there work for me".
 *
 * Grouped by the membership's source rather than the row's `source_id`: what
 * a source holds is the memberships its runs brought, which is the same set
 * today and stops being one the day a place has two (#755).
 */
export async function waitingCountsBySource(): Promise<Map<number, WaitingCounts>> {
  const result = await pool.query(`
    SELECT m.source_id AS source_id,
           COUNT(*) FILTER (WHERE ${arrivalWaitingSql()})::int  AS arrivals,
           COUNT(*) FILTER (WHERE ${heldWaitingSql()})::int     AS held,
           COUNT(*) FILTER (WHERE ${contentsWaitingSql()})::int AS contents
    FROM ${MEMBERSHIPS} m
    JOIN experiences e ON e.id = m.experience_id
    GROUP BY m.source_id
  `);
  return new Map(result.rows.map(r => [
    r.source_id as number,
    { arrivals: r.arrivals as number, held: r.held as number, contents: r.contents as number },
  ]));
}
