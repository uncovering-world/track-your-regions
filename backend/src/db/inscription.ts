/**
 * A World Heritage Site's inscription as a read asks for it (ADR-0153, #2068).
 *
 * UNESCO's facts about an inscription — the year, the danger flag and its
 * listing, the criteria, the area — are the World Heritage kind's, stored on
 * that kind's membership (`experience_kind_memberships.facts`), never on the
 * place. A reader is shown them while the membership is offered and not
 * judged former. A site a curator confirms UNESCO delisted, kept as a former
 * World Heritage Site (`KINDS_KEPT_AS_FORMER`), shows neither a danger badge
 * nor an inscription year: Liverpool was on the danger list when it was
 * delisted in 2021, and a badge then would claim a listing that ended. A
 * membership a run merely did not see (`missing_since`, not yet judged) keeps
 * both, since a source outage must not change what a reader sees
 * (`readerPredicates.ts`). Placement reads the inscribed area whatever the
 * membership's state: how far a site reaches is a fact about the ground.
 */

import { MEMBERSHIPS, membershipOfferedSql } from './membership.js';

/** World Heritage Sites, the kind whose membership holds a site's inscription. */
export const WORLD_HERITAGE_KIND_ID = 1;

/**
 * The inscription's facts a reader is shown, as a `jsonb` object, or NULL
 * where the place holds no offered World Heritage membership, or one judged
 * former. `experience` is the
 * `experiences` alias.
 */
export function inscriptionFactsSql(experience = 'e'): string {
  return `(SELECT wh.facts FROM ${MEMBERSHIPS} wh
            WHERE wh.experience_id = ${experience}.id AND wh.kind_id = ${WORLD_HERITAGE_KIND_ID}
              AND ${membershipOfferedSql('wh')} AND wh.source_membership = 'present')`;
}

/**
 * The area UNESCO inscribed, in hectares, as a `numeric`, or NULL where the
 * place holds no World Heritage membership or the list states no area.
 */
export function inscribedAreaSql(experience = 'e'): string {
  return `(SELECT (wh.facts->>'areaHectares')::numeric FROM ${MEMBERSHIPS} wh
            WHERE wh.experience_id = ${experience}.id AND wh.kind_id = ${WORLD_HERITAGE_KIND_ID})`;
}
