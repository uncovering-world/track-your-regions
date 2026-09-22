/**
 * Whether two stored values are the same value.
 *
 * The question a run asks before it files a change (`computeChangeSet`,
 * `backend/src/services/sync/changeSet.ts`) and the question a review card asks
 * before it shows a key of that change (`changedKeys`,
 * `frontend/src/components/curation/objectDiff.ts`). The two have to answer
 * alike or the card contradicts the queue that raised it: disagreeing on key
 * order would put a row on screen for a key whose value never moved, and
 * disagreeing on `null` against a missing key would put up the 17 rows this
 * catalogue's log held where a `criteria` key merely appeared as `null` (#570).
 * One declaration, so the two sides cannot answer differently (#789).
 */

/**
 * Nothing, however it is spelled.
 *
 * `''` counts: a source that sends an empty string where the row holds `null`
 * has not proposed anything, and a row for it would be a question with no
 * content.
 */
function isAbsent(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/** A JSON object with named keys — not an array, not `null`. */
function isNamedObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep value equality, with object keys compared as a set and array items as
 * a sequence: a JSONB column keeps no key order, and a list's order is the
 * source's statement.
 */
export function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isAbsent(a) && isAbsent(b)) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => jsonEquals(item, b[i]));
  }

  if (isNamedObject(a) && isNamedObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every(key => jsonEquals(a[key], b[key]));
  }

  return false;
}
