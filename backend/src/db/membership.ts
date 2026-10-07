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
 * In `db/` for the reason `db/locks.ts` gives: the sync services ask the same
 * questions of the same rows, and a service may not import a controller
 * module. `readerPredicates.ts` beside it composes these into the reader
 * predicates, and a service imports either.
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
 * A source's own places: each of its memberships joined to the place it hangs
 * on, for `FROM` (ADR-0084 decision 2).
 *
 * A run reaches its places only through this — `WHERE sm.source_id = $1`,
 * matched by `sm.external_id`, the id the source knows the place by — and
 * never through the place's own `source_id` / `external_id`, which say only
 * which source first brought the row. On a place two sources fill, the
 * place's pair is the other source's, and a run matching it would refuse,
 * mark or miss a place it still lists.
 *
 * `experience` and `membership` are the aliases the two tables take.
 */
export function sourcePlacesSql(experience = 'e', membership = 'sm'): string {
  return `${MEMBERSHIPS} ${membership} JOIN experiences ${experience} ON ${experience}.id = ${membership}.experience_id`;
}

/**
 * The place carries a membership the source named by `sourceParam` brought —
 * the filter for "this source's places" in a read that is otherwise about the
 * place, such as rebuilding one source's region assignments. `alias` is the
 * `experiences` alias.
 */
export function placeOfSourceSql(alias = 'e', sourceParam = '$1'): string {
  return `EXISTS (SELECT 1 FROM ${MEMBERSHIPS} ${INNER}
        WHERE ${INNER}.experience_id = ${alias}.id AND ${INNER}.source_id = ${sourceParam})`;
}

/**
 * The claims a source's proposal about a place meets, as a `jsonb` array: the
 * place's own `curated_fields`, and the claim on the type held by the
 * membership of the proposing source — the type within a kind is the
 * membership's (ADR-0084), and so is a curator's pin on it. `source` is an SQL
 * expression naming the proposing source, such as the run log's `source_id`.
 */
export function claimsFacingSql(experience: string, source: string): string {
  return `(COALESCE(${experience}.curated_fields, '[]'::jsonb) || COALESCE((
          SELECT CASE WHEN cm.curated_fields ? 'type' THEN '["type"]'::jsonb END
            FROM ${MEMBERSHIPS} cm
           WHERE cm.experience_id = ${experience}.id AND cm.source_id = ${source}), '[]'::jsonb))`;
}

/**
 * The same claims in TypeScript, where a caller has read them: the place's own,
 * and `type` where the membership a proposal comes through claims it.
 */
export function withTypeClaim(placeClaims: string[] | null | undefined, typeClaimed: unknown): string[] {
  return [...(placeClaims ?? []), ...(typeClaimed ? ['type'] : [])];
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
 * order, then the id, so the answer is total.
 *
 * `namedExpr` is the membership the caller's card named (#1264), bound as an
 * `int` parameter or NULL: named, it is the answer when it belongs to the place
 * and there is none when it does not, which every caller already refuses as a
 * question no longer open.
 */
export function membershipToAnswerSql(
  experienceIdExpr: string,
  prefer: 'waiting' | 'refused',
  namedExpr = 'NULL::int',
): string {
  const first = prefer === 'refused'
    ? `(${INNER}.admission = 'refused') DESC`
    : `(${INNER}.curation_state = 'pending') DESC, (${INNER}.pending_change_sync_log_id IS NOT NULL) DESC`;
  return `(SELECT ${INNER}.id FROM ${MEMBERSHIPS} ${INNER}
        JOIN ${KINDS} k ON k.id = ${INNER}.kind_id
        WHERE ${INNER}.experience_id = ${experienceIdExpr}
          AND (${namedExpr} IS NULL OR ${INNER}.id = ${namedExpr})
        ORDER BY ${first}, k.display_priority, ${INNER}.id
        LIMIT 1)`;
}

/**
 * The kinds that keep a place their source stopped listing, marked former,
 * rather than letting it go (#1264): a site UNESCO delisted is still a former
 * World Heritage Site — Dresden's Elbe Valley, delisted in 2009, is worth
 * knowing as one — while a place Wikidata no longer classes as archaeology is
 * simply not archaeology any more. Read wherever a curator's "no longer this
 * kind" is written or offered, so the card's button and the write agree.
 * World Heritage Sites is kind 1, under the id of the source that fills it.
 */
export const KINDS_KEPT_AS_FORMER: readonly number[] = [1];

/** Whether the membership `alias` is of a kind that keeps a delisted place as former. */
export function keptAsFormerSql(alias = 'm'): string {
  return `${alias}.kind_id = ANY('{${KINDS_KEPT_AS_FORMER.join(',')}}'::int[])`;
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

/**
 * A refusal a person has answered (ADR-0067): pinned by a card's answer, or
 * confirmed by a batch answer, which pins nothing and leaves
 * `admission_answered_at` instead. The review queue's open refusal is its
 * negation; the kept-out list is the answered ones. `alias` is the
 * membership alias.
 */
export function admissionAnsweredSql(alias = 'm'): string {
  return `(${admissionPinnedSql(alias)} OR ${alias}.admission_answered_at IS NOT NULL)`;
}

/** A curator's pin on the must-see badge. `alias` is the membership alias. */
export function iconicPinnedSql(alias = 'm'): string {
  return `${alias}.curated_fields ? 'is_iconic'`;
}

/**
 * The kind a row is shown under — its group, its pin colour, the chip beside
 * its name — read from the membership the row's own source brought (#819).
 *
 * `experiences.source_id` names the source that brought the place, and that
 * source fills one kind (`experience_sources.kind_id`), so the membership
 * with `source_id = e.source_id` is the row's own: exactly one per place, the
 * equality the catalogue check `membership-source-disagrees-with-row` holds.
 * A place in two kinds (#755) has a card in each list by ADR-0045 decision 4,
 * and which membership a region's list shows it under — or whether it shows
 * both — is that merge's design; until then the join is one row per place and
 * reads exactly as `e.source_id` did, since the kinds carry their sources'
 * ids.
 *
 * A LEFT JOIN, deliberately. The kind is a column the row is shown with, not
 * a predicate that decides whether it is shown: the four questions that
 * decide that are asked of the place (`placeOfferedSql` and its parts), and
 * a count, a page of keys and the rows under them must agree. An inner join
 * here would drop a row whose membership names another source — the state
 * the catalogue check reports — from the list but not from its count, and
 * from the review queue's cards but not from its keys and facets. Such a row
 * comes back with a null kind instead, and the check names it.
 *
 * `experience` is the `experiences` alias; `membership` and `kind` the
 * aliases the two joined tables take, so a query that already joins the
 * membership as `m` can name another and a CTE called `m` can stay called
 * `m`.
 */
export function rowKindJoinSql(experience = 'e', membership = 'm', kind = 'k'): string {
  return `LEFT JOIN ${MEMBERSHIPS} ${membership} ON ${membership}.experience_id = ${experience}.id AND ${membership}.source_id = ${experience}.source_id
      LEFT JOIN ${KINDS} ${kind} ON ${kind}.id = ${membership}.kind_id`;
}

/**
 * The three columns a reader-facing row carries for its kind: `kind_id`,
 * `kind_name` and `kind_priority` (the kind's display order — what the list
 * groups and orders by). Over the aliases `rowKindJoinSql` introduced.
 */
export function rowKindSelectSql(membership = 'm', kind = 'k'): string {
  return `${membership}.kind_id, ${kind}.name AS kind_name, ${kind}.display_priority AS kind_priority`;
}

/**
 * Every kind the place is offered in, as a `json` array of `{ kind_id,
 * kind_name, kind_priority, type, source_id, external_id, source_membership }`
 * in the kinds' display order (ADR-0084, #1245). `source_membership` is the
 * kind's own listing (#1289): a World Heritage Site UNESCO delisted is former
 * in that kind while another kind still lists the place.
 *
 * A place belongs to no kind; kinds are properties hung on it, and none is the
 * primary one. So a reader that shows the place shows it in each of these: the
 * Capitoline Museums in Art Museums and in Archaeology, each with its own type
 * and the id its own source knows it by. Only offered memberships — admitted
 * and passed — since a kind that refused the place or has not shown it yet is
 * not one a reader finds it in.
 *
 * `json` rather than `jsonb`: nothing compares or indexes the array, and on the
 * region list of Europe (661 places) building it as `jsonb` cost 9 ms more.
 */
export function placeKindsSql(experience = 'e'): string {
  return `(SELECT COALESCE(json_agg(json_build_object(
             'kind_id', pk.kind_id, 'kind_name', pkk.name, 'kind_priority', pkk.display_priority,
             'type', pk.type, 'source_id', pk.source_id, 'external_id', pk.external_id,
             'source_membership', pk.source_membership)
           ORDER BY pkk.display_priority, pk.kind_id), '[]'::json)
         FROM ${MEMBERSHIPS} pk JOIN ${KINDS} pkk ON pkk.id = pk.kind_id
        WHERE pk.experience_id = ${experience}.id AND ${membershipOfferedSql('pk')})`;
}

/**
 * The kinds that hold a work a place shows, by the memberships that place its
 * link (`experience_treasure_placements`, #1252), in the kinds' display order
 * (#1263): of the Capitoline Museums' finds, the Capitoline Wolf is held by Art
 * Museums and Archaeology both. Only offered memberships, as `placeKindsSql`
 * reads them. A link no offered membership places reads as none, and the card
 * shows it whichever kind is chosen. `link` is the `experience_treasures` alias.
 */
export function linkKindsSql(link: string): string {
  return `(SELECT COALESCE(array_agg(lm.kind_id ORDER BY lk.display_priority, lm.kind_id), '{}')
         FROM experience_treasure_placements lp
         JOIN ${MEMBERSHIPS} lm ON lm.id = lp.membership_id
         JOIN ${KINDS} lk ON lk.id = lm.kind_id
        WHERE lp.link_id = ${link}.id AND ${membershipOfferedSql('lm')})`;
}

/**
 * The place's offered membership in one kind, joined as `membership` with its
 * kind as `kind`: the place in that kind, or no row at all (ADR-0084, #1245).
 *
 * What a kind filter is: a place is in a kind by any of its memberships, not by
 * the one its first source brought, and the row it answers with carries that
 * kind's type and colour. `(experience_id, kind_id)` is unique, so the join
 * adds no rows.
 */
export function kindMembershipJoinSql(
  experience: string, membership: string, kind: string, kindExpr: string,
): string {
  return `JOIN ${MEMBERSHIPS} ${membership} ON ${membership}.experience_id = ${experience}.id
                                          AND ${membership}.kind_id = ${kindExpr}
                                          AND ${membershipOfferedSql(membership)}
      JOIN ${KINDS} ${kind} ON ${kind}.id = ${membership}.kind_id`;
}

/**
 * The place has a membership in this kind, offered or not. For a person's own
 * record — the places they visited — which stays theirs whatever a kind's rule
 * or the gate later says (ADR-0024); a reader-facing set asks
 * `kindMembershipJoinSql` instead.
 */
export function placeHasKindSql(experience: string, kindExpr: string): string {
  return `EXISTS (SELECT 1 FROM ${MEMBERSHIPS} ${INNER}
        WHERE ${INNER}.experience_id = ${experience}.id AND ${INNER}.kind_id = ${kindExpr})`;
}
