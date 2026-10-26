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
 * about an inscription are the World Heritage kind's too and are still on the
 * place, kept by `fieldFamilies.ts`, until they move to its membership.
 */

import { PLACE_FIELDS } from '@tyr/shared/placeFields';
import { FAMILY_FIELDS } from './fieldFamilies.js';

const METADATA_PREFIX = 'metadata.';

/** The keys of a run's record its own membership stores. */
export const KIND_FACT_KEYS: readonly string[] = Object.entries(PLACE_FIELDS)
  .filter(([field, { owner }]) => owner === 'kind' && field.startsWith(METADATA_PREFIX))
  .map(([field]) => field.slice(METADATA_PREFIX.length))
  .filter(key => !FAMILY_FIELDS.unesco.metadata.includes(key));

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
