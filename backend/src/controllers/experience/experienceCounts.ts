/**
 * The two counts a reader is shown, spelled once (ADR-0046 decision 8; #822).
 *
 * ADR-0045 gave the catalogue two words, and a count follows whichever it is
 * about:
 *
 * - **A kind's count is of memberships.** "12 art museums in Italy" counts
 *   Cologne Cathedral's art-museum membership, not the cathedral: a place in
 *   two kinds is in both lists and counts once in each. The group header, the
 *   Discover pill, the source panel's number and the tree's per-kind counts
 *   are all this count.
 * - **A region's count is of places.** The total above a region's list is the
 *   cards it offers — a place, or a serial site counted once in every region
 *   that holds one of its locations — and Cologne Cathedral is in it once.
 *
 * The two are equal today, since every place has one membership (migration
 * 046 refuses a database where it does not), and they part company with the
 * first merge (#755): the Statue of Liberty as one place with a World Heritage
 * membership and a public-art one counts once in each kind and once in New
 * York. Spelled here rather than at each count so that day changes no reader;
 * the counts are pinned as text in `experienceCounts.test.ts`, and the
 * semantics were checked live by adding a second membership to a place inside
 * a transaction and rolling it back.
 *
 * A membership a kind counts is one it offers: admitted and passed
 * (`membershipOfferedSql`), of a place still standing (`hideLostSql`) — the
 * same three questions every list under the header asks, so the number labels
 * the list it sits above.
 */

import { MEMBERSHIPS, membershipOfferedSql } from '../../db/membership.js';
import { hideLostSql } from './experienceLifecycle.js';

/**
 * The memberships a kind's count counts, over a membership alias and its
 * place's alias: offered by the kind, of a place still standing.
 */
export function countedMembershipSql(membership = 'm', experience = 'e'): string {
  return `${membershipOfferedSql(membership)} AND ${hideLostSql(experience)}`;
}

/** A kind's count: the memberships under `membership`, each once. */
export function countedMembershipsSql(membership = 'm'): string {
  return `COUNT(DISTINCT ${membership}.id)`;
}

/** A region's count: the places under `experience`, each once, whatever they belong to. */
export function countedPlacesSql(experience = 'e'): string {
  return `COUNT(DISTINCT ${experience}.id)`;
}

/**
 * A kind's whole count, as a scalar subquery correlated on `kindIdExpr` — the
 * number beside a kind wherever no region narrows it.
 *
 * Uncast on purpose: `COUNT` is a bigint, which the driver hands over as a
 * string, and the readers of `experience_count` have parsed it that way since
 * the column existed. A cast here would change the wire shape of a number the
 * frontend already reads.
 */
export function kindCountSql(kindIdExpr: string): string {
  return `(SELECT ${countedMembershipsSql('km')}
        FROM ${MEMBERSHIPS} km
        JOIN experiences ke ON ke.id = km.experience_id
        WHERE km.kind_id = ${kindIdExpr}
          AND ${countedMembershipSql('km', 'ke')})`;
}
