/**
 * The review queue's per-kind open predicates, spelled once (#805, ADR-0051).
 *
 * `reviewQueueKeys.ts`'s union and the per-kind hydration statements in
 * `reviewQueueController.ts` / `reviewQueueContents.ts` ask the identical
 * question about a row — is this still open? — for two different purposes:
 * one orders and pages a key, the other draws a card. Before this module the
 * two sides spelled that question twice, which is exactly the cost ADR-0051
 * names for keeping both. Each function below is one kind's answer, composed
 * from the fragments the two files already shared, and its docblock carries
 * the reasoning the original inline comment gave for that kind's terms —
 * moved here rather than left behind at one call site or repeated at both.
 *
 * Every function takes the aliases its two callers already use and returns
 * bare SQL text with no leading `AND`: some callers open a `WHERE`, some
 * append to one already open, and a fragment that suited one read wrong in
 * the other (`db/readerPredicates.ts` sets the same rule).
 */

import { approximatePointOpenSql } from '../../services/sync/pointHints.js';
import {
  MEMBERSHIPS, admissionAnsweredSql, admissionPinnedSql, membershipAdmittedSql, membershipOfferedSql,
  placeHoldsRealKindSql, realKindSql,
} from '../../db/membership.js';
import { openViewFieldsSql } from '../../db/sourceViews.js';
import { CHANGESET_LANDED_SQL } from '../../services/sync/syncLogMarkers.js';
import {
  experienceOfferedToReaderSql,
  offeredLocationSql,
  placeOrPartOfferedSql,
  publishedContentSql,
} from '../../db/readerPredicates.js';
import {
  heldFieldExistsSql, heldPartExistsSql,
} from './waitingCounts.js';
import {
  answeringPlaceOfSql, itemHeldSql, pointItemClaimedSql, pointItemSql, somePointShownSql,
} from '../../db/placePoints.js';
import { COPIED_COORDINATE_M } from '../../services/sync/componentItemMatching.js';

/**
 * `missing`: a row the source stopped listing and nobody has judged
 * (ADR-0026). A refused row is excluded even though it also carries
 * `missing_since` — the same row under two headings would ask two
 * contradictory questions, "did this disappear?" beside "was refusing it
 * right?", and only the second has a true answer. An unread row is excluded
 * too (ADR-0025 § 3.6): nobody has ever seen it, so there is no verdict to
 * give about whether it disappeared from in front of anyone. A row readers
 * see is one a membership offers — one both admitted and passed
 * (`experienceOfferedToReaderSql`, #1275), the rule every reader-facing read
 * asks — so a place with one membership admitted but unread and another
 * passed but refused raises no card here: no reader ever saw it.
 */
export function missingOpenSql(e = 'e'): string {
  return `${e}.missing_since IS NOT NULL
    AND ${e}.source_membership = 'present'
    AND ${experienceOfferedToReaderSql(e)}`;
}

/**
 * `missing` of one kind (#1264): a clean run of this membership's source
 * stopped listing the place while another source still lists it, and nobody
 * has answered. The place itself is not missing — its flag reads missing only
 * once every membership is (`derive_place_listing()`), and that case is the
 * place's own card above — so this asks whether the place is still of this
 * kind. Only an offered membership: a pending one withdraws instead (ADR-0025
 * § 3.6), and a refused one is already out of its kind.
 */
export function membershipMissingOpenSql(m = 'm', e = 'e'): string {
  return `${m}.missing_since IS NOT NULL
    AND ${m}.source_membership = 'present'
    AND ${e}.missing_since IS NULL
    AND ${membershipOfferedSql(m)}`;
}

/**
 * `refused`: a rule turned this membership down (ADR-0024) and nobody has
 * answered it. A card's answer pins `admission` in the membership's
 * `curated_fields` (#822); a batch's confirmation pins nothing and marks
 * `admission_answered_at` instead (ADR-0067). `admissionAnsweredSql` is either,
 * and `keptOut` is the mirror that shows the answered rows instead of hiding
 * them.
 *
 * Asked only while no other membership of the place is offered to readers
 * (#1838): Archaeology refusing Reims Cathedral, which Places of worship
 * offers, changes nothing a traveller finds, so the card is work whose answer
 * is always yes. Nothing is written for it: the refusal stays the rule's and
 * unanswered, a later run may still admit the place, and the card comes back
 * once the other kind stops offering it, when the refusal decides whether the
 * place stays at all.
 */
export function refusedOpenSql(m = 'm'): string {
  return `${m}.admission = 'refused' AND NOT ${admissionAnsweredSql(m)}
    AND NOT EXISTS (SELECT 1 FROM ${MEMBERSHIPS} offered_elsewhere WHERE ${offeredElsewhereSql(m, 'offered_elsewhere')})`;
}

/**
 * Whether `other` is another membership of the place of `m` that readers find
 * the place in: admitted and passed (`membershipOfferedSql`), as the place's
 * kinds are read (`placeKindsSql`). A membership whose source stopped listing
 * the place still counts until a curator says otherwise, as readers still find
 * the place there. One rule for the refusal that asks nothing
 * (`refusedOpenSql`) and for the line a card says where readers still see the
 * place (`seenInSql`, `reviewQueueController.ts`).
 */
export function offeredElsewhereSql(m: string, other: string): string {
  return `${other}.experience_id = ${m}.experience_id AND ${other}.id <> ${m}.id AND ${membershipOfferedSql(other)}`;
}

/**
 * `arrival`: a membership from a gated source nobody has passed yet
 * (ADR-0025) — the queue's own version of "created", for a source that does
 * not get to publish on its own say. Excludes a row the source has since
 * stopped offering, which withdraws instead (§ 3.6): there is nobody it could
 * be shown to either way, and `missing` excludes the same row so it raises no
 * card under that heading either.
 */
export function arrivalOpenSql(e = 'e', m = 'm'): string {
  return `${m}.curation_state = 'pending' AND ${membershipAdmittedSql(m)} AND ${e}.missing_since IS NULL`;
}

/**
 * `held`: an already-visible row whose newest content proposal — on a field
 * of its own, or of one of its parts (ADR-0037) — was kept out by the gate
 * rather than applied. `missing_since IS NULL` for the same reason `arrival`
 * carries it: a row the source has stopped offering is `missing`'s question,
 * not this one, and showing both would ask two things about one row. The
 * join from the changeset row to the membership's own
 * `pending_change_sync_log_id` stays with each caller — a join is not a
 * predicate.
 */
export function heldOpenSql(e = 'e', m = 'm', ch = 'ch'): string {
  return `${membershipAdmittedSql(m)}
    AND ${e}.missing_since IS NULL
    AND (${heldFieldExistsSql(ch)} OR ${heldPartExistsSql(ch)})`;
}

/**
 * `withdrawn`, the point half (ADR-0026, #541): the run's own observation,
 * then the two axes that say whether anyone has answered it — a verdict
 * deliberately leaves the flag standing, so without these an answered point
 * would come back for ever carrying its own answer — then the deferral
 * guard, which is here for the *other* row of a paired withdrawal, still on
 * the map while an arrival names it. `publishedContentSql` is the
 * gate: a point nobody ever saw raises no question about its departure, the
 * same reasoning ADR-0025 § 3.6 applies to an unread object. A point that
 * names the one it moved to raises none either: a short move took it there
 * (ADR-0140), and the move is its record. `el` is the `experience_locations`
 * alias.
 */
export function withdrawnPointOpenSql(el = 'el'): string {
  return `${el}.missing_since IS NOT NULL
    AND ${el}.source_membership = 'present'
    AND ${el}.existence = 'extant'
    AND ${el}.withdrawal_deferred_for_location_id IS NULL
    AND ${el}.moved_to_location_id IS NULL
    AND ${publishedContentSql(el)}`;
}

/**
 * `withdrawn`, the container half: the object's own lifecycle guards — a
 * refused or unread object has a card of its own, and the object's own
 * disappearance is `missing`'s question, answered before this one.
 */
export function withdrawnContainerOpenSql(e = 'e'): string {
  return `${experienceOfferedToReaderSql(e)} AND ${e}.missing_since IS NULL`;
}

/**
 * `conflict`: the newest changeset row for an object, from a run that
 * actually landed, still proposing a field a curator has claimed. `e`/`ch`/`l`
 * are the `experiences`, `experience_sync_changes` and `experience_sync_logs`
 * aliases.
 *
 * The staleness clause reads the `last_seen_sync_log_id` of the membership
 * whose source ran the proposing run — another source's run seeing the place
 * says nothing about whether this source still disagrees (ADR-0084) — against
 * `CHANGESET_LANDED_SQL` rather than trusting a closed log: a run that finds
 * the source agreeing again writes no new changeset row at all (see
 * `worthRecording`), so the absence of one is not by itself evidence the
 * disagreement stands — only a *later, landed* run's silence is. A run that
 * throws after its item loop records its changes and only then marks itself
 * `failed`, which is what `CHANGESET_LANDED_SQL` tells apart from a batch
 * that never reached the table; without that distinction the inference would
 * silence a standing disagreement for a whole sync cycle.
 *
 * The per-field claim/decision test that follows this in each statement is
 * built from the bound `$keyMap`/`$family` placeholders, which differ per
 * statement, so it stays where it is on each side; `claimKeySql` below shares
 * the one piece both can, the `COALESCE` itself.
 */
export function conflictChangeOpenSql(e = 'e', ch = 'ch', l = 'l'): string {
  return `${l}.is_dry_run = FALSE
    AND ${ch}.changed_fields @> '[{"curatedConflict": true}]'
    AND NOT EXISTS (SELECT 1 FROM ${MEMBERSHIPS} seen
                      JOIN experience_sync_logs prev ON prev.id = seen.last_seen_sync_log_id
                     WHERE seen.experience_id = ${e}.id
                       AND seen.source_id = ${l}.source_id
                       AND ${ch}.sync_log_id < seen.last_seen_sync_log_id
                       AND ${CHANGESET_LANDED_SQL})`;
}

/**
 * A field's claim key: the column name a `curated_fields` claim uses, unless
 * the per-field map or the per-family fallback (`changeSet.ts`) name a
 * different one. `keyMapParam` and `familyParam` are the two lookup objects,
 * already bound as SQL parameters — the keys union binds them through its own
 * `bind()`, the controller by an explicit index — so this takes the two
 * placeholder strings rather than the values themselves.
 */
export function claimKeySql(field: string, keyMapParam: string, familyParam: string): string {
  return `COALESCE(${keyMapParam}::jsonb->>(${field}),`
    + ` ${familyParam}::jsonb->>split_part(${field}, '.', 1), ${field})`;
}

/**
 * Two data sources describe the place differently and a curator has not
 * answered as their views stand (#1246): some field two standing views under
 * different ids contradict (`openViewFieldsSql`). The pair test first, which an
 * index on the membership's place and one on the part answer, so the field
 * comparison runs only for a place two sources hold, or a part of a serial
 * site that holds a kind of its own (#2063), the site's view of the component
 * being the second. A place a merge folded holds no membership and is never
 * asked.
 */
export function sourcesOpenSql(e = 'e'): string {
  return `(EXISTS (SELECT 1 FROM ${MEMBERSHIPS} a JOIN ${MEMBERSHIPS} b
                     ON b.experience_id = a.experience_id AND a.external_id <> b.external_id
                    WHERE a.experience_id = ${e}.id AND ${realKindSql('a')} AND ${realKindSql('b')})
           OR (${placeHoldsRealKindSql(`${e}.id`)}
               AND EXISTS (SELECT 1 FROM experience_parts p WHERE p.part_id = ${e}.id AND p.reason = 'component')))
          AND cardinality(${openViewFieldsSql(e + '.id')}) > 0`;
}

/**
 * One candidate Wikidata item for a component (#1272) still asked about: no
 * curator has answered it, the point has no item yet and no claim on one, the
 * point is one readers see — a withdrawn, lost, folded or unread point raises
 * no question about its identity, by the reasoning `withdrawnPointOpenSql`
 * gives — and the item is not already recorded on some point, since a
 * component is one item and an item one component. `p` is the
 * `experience_component_item_proposals` alias and `el` the point's.
 */
export function openProposalSql(p = 'p', el = 'el'): string {
  return `${p}.answer IS NULL
    AND ${pointItemSql(el)} IS NULL
    AND NOT ${pointItemClaimedSql(el)}
    AND ${offeredLocationSql(el)}
    AND ${publishedContentSql(el)}
    AND NOT ${itemHeldSql(p + '.wikidata_item')}`;
}


export { approximatePointOpenSql };

/**
 * Whether something says where the roughly placed point `el` may really stand:
 * a hint the *Find component items* pass kept for it (`experience_point_hints`),
 * or a candidate item nobody has answered that is not the point copied. The
 * card asks about a point with one; a point with none is listed apart, since
 * all a curator can do there is keep it or place it by hand (#1903).
 */
export function pointHasHintSql(el = 'el'): string {
  return `(EXISTS (SELECT 1 FROM experience_point_hints hint WHERE hint.location_id = ${el}.id)
    OR EXISTS (SELECT 1 ${candidateHintsSql('hp', el)}))`;
}

/**
 * The candidate items that are hints of the point `el`: open, with a
 * coordinate, and not the point copied (`COPIED_COORDINATE_M`), as the `FROM`
 * and `WHERE` of a query over the proposals aliased `p`. The card lists them
 * (`reviewQueueApproximatePoints.ts`) and `pointHasHintSql` asks whether there
 * is one, so a point on the asking card always has a hint to show.
 */
export function candidateHintsSql(p = 'p', el = 'el'): string {
  return `FROM experience_component_item_proposals ${p}
   WHERE ${p}.location_id = ${el}.id AND ${p}.item_location IS NOT NULL AND ${openProposalSql(p, el)}
     AND ST_Distance(${p}.item_location::geography, ${el}.location::geography) >= ${COPIED_COORDINATE_M}`;
}

/**
 * A roughly placed point of a site (#1853) asked about on the *Where is it?*
 * card when `hinted`, listed apart when not (#1903). `el` is the point's alias.
 */
export function approximatePointAskedSql(hinted: boolean, el = 'el'): string {
  return `${approximatePointOpenSql(el)} AND ${hinted ? '' : 'NOT '}${pointHasHintSql(el)}`;
}

/**
 * `approximate-points`: a site some component of which the list placed only
 * roughly and nobody has placed since (#1853), with something saying where it
 * may stand; `approximate-unhinted`: one with such a point nothing says
 * anything about (#1903). Under the object's own lifecycle guards, as
 * `component-items` is.
 */
export function approximatePointsOpenSql(e = 'e', hinted = true): string {
  const site = e + '.id';
  return `${experienceOfferedToReaderSql(e)} AND ${e}.missing_since IS NULL
    AND ${somePointShownSql(site, 'el', approximatePointAskedSql(hinted, 'el'))}`;
}

/**
 * `component-items`: a site some component of which has a candidate item
 * nobody has answered (#1272, `openProposalSql`), under the object's own
 * lifecycle guards — a refused, unread or missing site has a card of its own,
 * and the identity of its parts waits on that.
 */
export function componentItemsOpenSql(e = 'e'): string {
  const candidates = 'JOIN experience_component_item_proposals p ON p.location_id = el.id';
  const site = `${e}.id`;
  return `${experienceOfferedToReaderSql(e)} AND ${e}.missing_since IS NULL
    AND ${somePointShownSql(site, 'el', openProposalSql('p', 'el'), candidates)}`;
}

/**
 * `merge-proposals`: a pair of near places with similar names nobody has
 * answered (#1249, ADR-0046 decision 2), on a proposal `p` whose places are
 * `a` (the lower id, which stays) and `b`. Open while unanswered and while
 * both places are still offered — a serial site's part through its site
 * (#1250) — and unmerged: a pair one side of which a run took away, or an
 * equal-item merge already made one, asks nothing. The keys phase, the
 * hydration (`reviewQueueMergeProposals.ts`) and the answer
 * (`mergeProposalController.ts`) read it alike.
 */
export function mergeProposalOpenSql(p = 'p', a = 'a', b = 'b'): string {
  return `${p}.answer IS NULL
    AND ${a}.merged_into_id IS NULL AND ${b}.merged_into_id IS NULL
    AND ${placeOrPartOfferedSql(a)} AND ${placeOrPartOfferedSql(b)}`;
}

/**
 * The memberships whose sources a pair `p` is in scope by, over the membership
 * alias `m`: every real kind of either place, and of the site a serial site's
 * part with no kind of its own is answered for under (`answeringPlaceOfSql`,
 * #1250), as a write on its point is. The keys phase, the card's scope and the
 * answer (`mergeProposalController.ts`) read it alike.
 */
export function pairMembershipSql(p = 'p', m = 'm'): string {
  const a = answeringPlaceOfSql(p + '.place_a');
  const b = answeringPlaceOfSql(p + '.place_b');
  return `${m}.experience_id IN (${a}, ${b}) AND ${realKindSql(m)}`;
}

/**
 * `pin-question`: a curator's admission pin a run no longer agrees with
 * (#1367, `questionPins`), on a membership `m`. The row's admission is the
 * curator's answer and stays so until someone answers the question; a pin
 * handed back takes its question with it, which the schema holds
 * (`experience_kind_memberships_question_check`).
 */
export function pinQuestionOpenSql(m = 'm'): string {
  return `${admissionPinnedSql(m)} AND ${m}.admission_questioned_at IS NOT NULL`;
}

/**
 * `visit-question`: a run's question about an offered place with nothing to
 * see (#1770, `askVisitQuestions`), on a question `q` about the membership
 * `m` of the place `e`. Open while nobody has answered it and while the kind
 * still offers the place as the run asked it: a place since refused, pinned by
 * a curator, delisted or gone from every source asks nothing, since its
 * admission was answered another way. The keys phase, the hydration
 * (`reviewQueueVisitQuestions.ts`) and the answer (`visitQuestionController.ts`)
 * read it alike.
 */
export function visitQuestionOpenSql(q = 'q', m = 'm', e = 'e'): string {
  return `${q}.answer IS NULL AND ${q}.membership_id = ${m}.id
    AND ${membershipOfferedSql(m)} AND NOT ${admissionPinnedSql(m)} AND ${e}.missing_since IS NULL`;
}
