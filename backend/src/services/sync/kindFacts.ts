/**
 * The keys of a run's record that are its kind's own, and where they live:
 * on the run's membership, `experience_kind_memberships.facts` (ADR-0153,
 * #1775).
 *
 * A run sends one record about a place. Most of it is the place's — its name,
 * picture, item, website — and some of it is only its kind's: a monument's
 * year and makers, the classes the kind's rule read, the counts a run makes of
 * a venue's works, the question it asks a curator. Stored on the place, those
 * were written over by every other kind's run of it, and stood there after the
 * kind that wrote them refused the place: Charminar kept Monuments & memorials'
 * 1591 under Places of worship. On the membership no other run writes them, and
 * a refusal leaves them with the refused membership.
 *
 * Whose a field is is its entry in `@tyr/shared/placeFields`. UNESCO's facts
 * about an inscription are the World Heritage kind's (#2068): Liverpool's
 * inscription year and danger listing went with its membership when the site
 * was delisted.
 *
 * Most facts no reader is shown, and a run writes them whole past the gate.
 * Three of the inscription's are shown (the year, the danger flag and its
 * listing), so a held place's membership keeps them until a curator publishes
 * the run's proposal (`heldFacts`), as the place keeps its own shown fields.
 */

import { PLACE_FIELDS, placeFieldUnseen } from '@tyr/shared/placeFields';

const METADATA_PREFIX = 'metadata.';

/** The keys of a run's record its own membership stores. */
export const KIND_FACT_KEYS: readonly string[] = Object.entries(PLACE_FIELDS)
  .filter(([field, { owner }]) => owner === 'kind' && field.startsWith(METADATA_PREFIX))
  .map(([field]) => field.slice(METADATA_PREFIX.length));

/** Whether a key of a run's record is its kind's own, stored on its membership. */
export const isKindFact = (key: string): boolean => KIND_FACT_KEYS.includes(key);

/** A run's record split into what the place stores and what the run's membership does. */
export function splitKindFacts(metadata: Record<string, unknown>): {
  place: Record<string, unknown>;
  facts: Record<string, unknown>;
} {
  const entries = Object.entries(metadata);
  return {
    place: Object.fromEntries(entries.filter(([key]) => !isKindFact(key))),
    facts: Object.fromEntries(entries.filter(([key]) => isKindFact(key))),
  };
}

/**
 * The facts a held place's membership takes from its run: the ones it holds,
 * with the run's value of every fact no reader is shown and of each shown one
 * whose rewrite passes the gate (`passing`, the keys `passingMetadataKeys`
 * names), a removal included. So only a shown fact, such as the danger flag,
 * waits for a curator. `stored` is null on a membership the run is making.
 */
export function heldFacts(
  stored: Record<string, unknown> | null,
  incoming: Record<string, unknown>,
  passing: readonly string[],
): Record<string, unknown> {
  const next = { ...(stored ?? {}) };
  for (const key of new Set([...Object.keys(next), ...Object.keys(incoming)])) {
    if (!placeFieldUnseen(`${METADATA_PREFIX}${key}`) && !passing.includes(key)) continue;
    if (Object.hasOwn(incoming, key)) next[key] = incoming[key];
    else delete next[key];
  }
  return next;
}

/**
 * The place as the run's record names it: the place's own metadata and its
 * kind's facts off the run's membership, so a run's diff compares like with
 * like and its change records keep their `metadata.<key>` names.
 */
export function withOwnFacts(
  metadata: Record<string, unknown> | null,
  facts: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (facts === null || Object.keys(facts).length === 0) return metadata;
  return { ...(metadata ?? {}), ...facts };
}
