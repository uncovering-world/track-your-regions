/**
 * A place's membership in a kind, as every read asks about it (ADR-0045
 * decision 4; #822).
 *
 * A row of `experiences` is the place; a row of `experience_kind_memberships`
 * is what one kind says about it — the source that brought it, whether the
 * kind's rule admitted or refused it (ADR-0024), whether a curator has passed
 * its arrival (ADR-0025). Two of the four questions a reader-facing read has
 * to ask of a row therefore live on the membership, and this module is the
 * one spelling of them:
 *
 * | question | membership-level | place-level |
 * |---|---|---|
 * | does this kind accept it? | `membershipAdmittedSql` | `placeAdmittedSql` |
 * | has anyone looked at it? | `membershipVisibleSql` | `placeVisibleSql` |
 * | both, of the same membership | `membershipOfferedSql` | `placeOfferedSql` |
 *
 * The place-level forms ask "some membership of this place" with an `EXISTS`,
 * so a query written `FROM experiences e` reads exactly as it did when the
 * columns were the row's own; a place has one membership today (migration 046
 * refuses a database where it does not), so the answer is the same row for
 * row. The day a place has two (#755) the composition matters: a place with
 * one membership admitted and another passed is not offered by either alone,
 * which is why `placeOfferedSql` asks both of *one* membership and is what
 * every write that records a reader's claim composes
 * (`experienceOfferedToReaderSql`). #819 then switches each reader to the
 * membership row it means.
 *
 * In `db/` rather than beside the lifecycle fragments for the reason
 * `db/locks.ts` gives: the sync services ask the same questions of the same
 * rows, and a service importing a controller module would be the first such
 * import in the codebase. `experienceLifecycle.ts` composes these; the
 * services import them directly.
 *
 * `km` is the alias the `EXISTS` forms give the membership. Its own name, so
 * that a query which already joins the table as `m` — the review queue, the
 * waiting counts — can carry a place-level fragment beside it without the
 * inner alias shadowing the outer.
 */

/** The two tables, named once. */
export const MEMBERSHIPS = 'experience_kind_memberships';
export const KINDS = 'experience_kinds';

const INNER = 'km';

/**
 * This kind accepts the place (ADR-0024). `alias` is the membership alias.
 *
 * Not a claim about the world: the British Museum stands open and Wikidata
 * still lists it; what changed is which of our kinds claims the building.
 */
export function membershipAdmittedSql(alias = 'm'): string {
  return `${alias}.admission <> 'refused'`;
}

/**
 * A curator has passed this membership's arrival, or it was published unread
 * (ADR-0025). `alias` is the membership alias.
 */
export function membershipVisibleSql(alias = 'm'): string {
  return `${alias}.curation_state <> 'pending'`;
}

/** Both of the above, of the same membership. */
export function membershipOfferedSql(alias = 'm'): string {
  return `${membershipAdmittedSql(alias)} AND ${membershipVisibleSql(alias)}`;
}

function someMembershipSql(experienceAlias: string, predicate: (alias: string) => string): string {
  return `EXISTS (SELECT 1 FROM ${MEMBERSHIPS} ${INNER}
        WHERE ${INNER}.experience_id = ${experienceAlias}.id AND ${predicate(INNER)})`;
}

/** Some kind accepts the place. `alias` is the `experiences` alias. */
export function placeAdmittedSql(alias = 'e'): string {
  return someMembershipSql(alias, membershipAdmittedSql);
}

/** Some membership of the place has been passed. `alias` is the `experiences` alias. */
export function placeVisibleSql(alias = 'e'): string {
  return someMembershipSql(alias, membershipVisibleSql);
}

/**
 * Some membership of the place is both admitted and passed — the one predicate
 * a read that offers the place, or records a reader's claim about it, asks.
 */
export function placeOfferedSql(alias = 'e'): string {
  return someMembershipSql(alias, membershipOfferedSql);
}

/**
 * The membership a curator's click on `/:id/…` answers, as a scalar subquery
 * over the place's id.
 *
 * A curator's endpoints are keyed on the place — `/:id/publish`,
 * `/:id/decline-held`, `/:id/admission` — and the row they act on is the
 * membership. Exactly one per place until #755 makes a second, so this picks
 * the one there is; the order is what it means the day there are two: for a
 * publish or a decline, the one *waiting* — unread first, then one holding a
 * proposal; for an admission verdict, the *refused* one. Then the kind's
 * order, then the id, so the answer is total. #755's API names the
 * membership outright, and this helper is what it replaces.
 */
export function membershipToAnswerSql(
  experienceIdExpr: string,
  prefer: 'waiting' | 'refused',
): string {
  const first = prefer === 'refused'
    ? `(${INNER}.admission = 'refused') DESC`
    : `(${INNER}.curation_state = 'pending') DESC, (${INNER}.pending_change_sync_log_id IS NOT NULL) DESC`;
  return `(SELECT ${INNER}.id FROM ${MEMBERSHIPS} ${INNER}
        JOIN ${KINDS} k ON k.id = ${INNER}.kind_id
        WHERE ${INNER}.experience_id = ${experienceIdExpr}
        ORDER BY ${first}, k.display_priority, ${INNER}.id
        LIMIT 1)`;
}

/**
 * A curator's pin on the admission axis: the answer a confirmation or an
 * override leaves behind, which every run's admission write honours.
 * `alias` is the membership alias.
 *
 * No `COALESCE`, unlike the place's pins: the membership's `curated_fields`
 * is `NOT NULL DEFAULT '[]'`, so `?` answers false rather than NULL on a row
 * nobody has curated.
 */
export function admissionPinnedSql(alias = 'm'): string {
  return `${alias}.curated_fields ? 'admission'`;
}

/** A curator's pin on the must-see badge. `alias` is the membership alias. */
export function iconicPinnedSql(alias = 'm'): string {
  return `${alias}.curated_fields ? 'is_iconic'`;
}
