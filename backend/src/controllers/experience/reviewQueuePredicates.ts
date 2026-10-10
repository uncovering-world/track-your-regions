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

import { MEMBERSHIPS, admissionAnsweredSql, membershipAdmittedSql, membershipOfferedSql } from '../../db/membership.js';
import { openViewFieldsSql } from '../../db/sourceViews.js';
import { CHANGESET_LANDED_SQL } from '../../services/sync/syncLogMarkers.js';
import {
  hidePendingSql,
  hideRefusedSql,
  offeredLocationSql,
  publishedContentSql,
} from '../../db/readerPredicates.js';
import {
  heldFieldExistsSql, heldPartExistsSql,
} from './waitingCounts.js';

/**
 * `missing`: a row the source stopped listing and nobody has judged
 * (ADR-0026). A refused row is excluded even though it also carries
 * `missing_since` — the same row under two headings would ask two
 * contradictory questions, "did this disappear?" beside "was refusing it
 * right?", and only the second has a true answer. An unread row is excluded
 * too (ADR-0025 § 3.6): nobody has ever seen it, so there is no verdict to
 * give about whether it disappeared from in front of anyone.
 */
export function missingOpenSql(e = 'e'): string {
  return `${e}.missing_since IS NOT NULL
    AND ${e}.source_membership = 'present'
    AND ${hideRefusedSql(e)}
    AND ${hidePendingSql(e)}`;
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
 */
export function refusedOpenSql(m = 'm'): string {
  return `${m}.admission = 'refused' AND NOT ${admissionAnsweredSql(m)}`;
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
 * same reasoning ADR-0025 § 3.6 applies to an unread object. `el` is the
 * `experience_locations` alias.
 */
export function withdrawnPointOpenSql(el = 'el'): string {
  return `${el}.missing_since IS NOT NULL
    AND ${el}.source_membership = 'present'
    AND ${el}.existence = 'extant'
    AND ${el}.withdrawal_deferred_for_location_id IS NULL
    AND ${publishedContentSql(el)}`;
}

/**
 * `withdrawn`, the container half: the object's own lifecycle guards — a
 * refused or unread object has a card of its own, and the object's own
 * disappearance is `missing`'s question, answered before this one.
 */
export function withdrawnContainerOpenSql(e = 'e'): string {
  return `${hidePendingSql(e)} AND ${hideRefusedSql(e)} AND ${e}.missing_since IS NULL`;
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
 * index on the membership's place answers, so the field comparison runs only
 * for a place two sources hold. A place a merge folded holds no membership and
 * is never asked.
 */
export function sourcesOpenSql(e = 'e'): string {
  return `EXISTS (SELECT 1 FROM ${MEMBERSHIPS} a JOIN ${MEMBERSHIPS} b
                    ON b.experience_id = a.experience_id AND a.external_id <> b.external_id
                   WHERE a.experience_id = ${e}.id)
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
    AND ${el}.wikidata_item IS NULL
    AND NOT (${el}.curated_fields ? 'wikidata_item')
    AND ${offeredLocationSql(el)}
    AND ${publishedContentSql(el)}
    AND NOT EXISTS (SELECT 1 FROM experience_locations taken WHERE taken.wikidata_item = ${p}.wikidata_item)`;
}

/**
 * `component-items`: a site some component of which has a candidate item
 * nobody has answered (#1272, `openProposalSql`), under the object's own
 * lifecycle guards — a refused, unread or missing site has a card of its own,
 * and the identity of its parts waits on that.
 */
export function componentItemsOpenSql(e = 'e'): string {
  return `${hidePendingSql(e)} AND ${hideRefusedSql(e)} AND ${e}.missing_since IS NULL
    AND EXISTS (SELECT 1 FROM experience_component_item_proposals p
                  JOIN experience_locations el ON el.id = p.location_id
                 WHERE el.experience_id = ${e}.id AND ${openProposalSql('p', 'el')})`;
}
