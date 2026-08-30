/**
 * Which keys of an object actually moved.
 *
 * A field whose value is an object has named parts, and a card that prints the object
 * whole asks a curator to find the difference by eye. On this catalogue that is the
 * common case rather than an edge: `metadata` is the most frequently changed field in
 * the sync log — 4314 entries, against 124 for every named `metadata.*` key together —
 * and 2927 of those 4314 differ in exactly one key. The whole of what run 68 proposed
 * about the Bamiyan Valley was `criteria` arriving and an `imageCredit` with it, asked
 * as eight named things on one side against six on the other (#570).
 *
 * The rule here is the **shape**, not the field's name. `metadata` is what raised the
 * issue, but `nameLocal` is a language map with the same defect and the same remedy,
 * and keying the behaviour off `field === 'metadata'` would be the "field with no named
 * parts" mistake written the other way round: a name deciding what a value is.
 *
 * One level deep, on purpose. A key whose own value is an object is named and handed to
 * the vocabulary whole — a picture credit is the photographer and the terms, said as such
 * (`fieldMeaning.tsx`), and `factRows.ts` keeps any value the vocabulary can say from
 * being split at all. Naming the key is what the curator was missing; flattening
 * `imageCredit.author` into a path is a different question, and it belongs with the
 * model #574 is for.
 */

/**
 * Nothing, however it is spelled.
 *
 * `''` counts, because `changeSet.ts` counts it: a source that sends an empty string
 * where the row holds `null` has not proposed anything, and a row for it would be a
 * question with no content.
 */
function isAbsent(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/** A JSON object with named keys — not an array, not `null`. */
function isNamedObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep value equality, with object keys compared as a set.
 *
 * A second copy of `jsonEquals` from `backend/src/services/sync/changeSet.ts`, and the
 * duplication is deliberate: the server decided the *field* changed, this decides which
 * *keys* to show for it, and the two have to answer alike or the card contradicts the
 * queue that raised it. Disagreeing on key order would put a row on screen for a key
 * whose value never moved; disagreeing on `null` against a missing key would put up 17
 * rows this catalogue's log holds where a `criteria` key merely appeared as `null`.
 *
 * There is no runtime the two can share — the packages share no build, which is what
 * #527 is open about — so nothing structural can hold them together and the pin is
 * behavioural, on **both** sides. `objectDiff.test.ts` states the properties against
 * this copy; `changeSet.test.ts` § "the equality a curation card mirrors" states the
 * same ones against the server's, through `computeChangeSet`, so relaxing either one
 * fails a test beside it rather than surfacing as a curator reading a row that should
 * not exist. Both were checked by injecting the drift they exist for. A third copy is
 * not the answer to a second one.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isAbsent(a) && isAbsent(b)) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => valuesEqual(item, b[i]));
  }

  if (isNamedObject(a) && isNamedObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every(key => valuesEqual(a[key], b[key]));
  }

  return false;
}

/** One named part of an object, and what the two sides say about it. */
export interface KeyChange {
  key: string;
  old: unknown;
  new: unknown;
}

/**
 * The keys that differ, alphabetically, or `null` when this pair has no named parts to
 * show.
 *
 * Alphabetical because there is no meaningful order to preserve: the values come out of
 * a JSONB column, which does not keep the order they went in, and the same card must
 * read the same way twice.
 *
 * `null` is the caller's signal to render the pair whole, and it covers three cases: a
 * value that is not an object at all (text, a coordinate, an array of tags — an array's
 * parts have positions, not names, and pairing them by index would call a reordering a
 * change), both sides absent, and an object pair this function finds nothing to say
 * about. The last should not reach a card — the server applies the same equality before
 * reporting a field — so falling back to today's rendering is a floor under a
 * disagreement, not a case to design for.
 *
 * A side that is absent against an object is read as an empty object, so a `metadata`
 * that did not exist before arrives as one row per key rather than as one wall marked
 * new.
 */
export function changedKeys(before: unknown, after: unknown): KeyChange[] | null {
  const objectOrAbsent = (v: unknown) => isNamedObject(v) || isAbsent(v);
  if (!objectOrAbsent(before) || !objectOrAbsent(after)) return null;
  if (!isNamedObject(before) && !isNamedObject(after)) return null;

  const left = isNamedObject(before) ? before : {};
  const right = isNamedObject(after) ? after : {};

  const changes = [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .sort()
    .filter(key => !valuesEqual(left[key], right[key]))
    .map(key => ({ key, old: left[key], new: right[key] }));

  return changes.length > 0 ? changes : null;
}

/**
 * Nothing, as a card reads it: the absence `valuesEqual` knows, and an empty list.
 *
 * Wider than `isAbsent` on purpose, and kept apart from it. This decides whether a row
 * reads as *new* — a fact appearing where there was none — or as *changed*, and an
 * empty list is nothing to a person: a place with no countries listed and then two is a
 * fact arriving. `valuesEqual` keeps the server's stricter reading, because it decides
 * which keys are shown and must agree with the server about that.
 */
export function isEmptyValue(value: unknown): boolean {
  return isAbsent(value) || (Array.isArray(value) && value.length === 0);
}
