/**
 * Which proposed fields the accept-source path will write back, and the column
 * each writes to.
 *
 * Its own module because two sides need the same answer and neither owns it: the
 * write path (`applyProposedFields`) uses it to build the assignment list, and
 * the review queue uses it to tell a curator which proposed fields are even
 * answerable — a card offering "accept" on a field the endpoint would refuse to
 * write is a button that lies. Kept together with `columnFor` so the set and the
 * mapping cannot drift.
 */

import { CURATED_KEY_BY_FIELD } from '../../services/sync/changeSet.js';

/**
 * Which of the fields a run can propose this endpoint will write back.
 *
 * Deliberately a subset. `location` and the country arrays need more than an
 * assignment, and `metadata` is claimed per key — `editExperience` writes
 * `metadata.website`, which is no column at all — so accepting it wholesale
 * would discard the keys the curator did not touch. These five are the ones
 * whose `curated_fields` entry happens to be exactly the column, which is why
 * `CURATED_KEY_BY_FIELD` can answer both questions for them without the two
 * ever drifting from what the upsert honours.
 */
export const ACCEPTABLE_FIELDS = new Set(['name', 'shortDescription', 'description', 'category', 'imageUrl']);

/** The column an accepted field writes to, or null if it is not acceptable. */
export function columnFor(field: string): string | null {
  if (!ACCEPTABLE_FIELDS.has(field)) return null;
  return CURATED_KEY_BY_FIELD[field] ?? null;
}
